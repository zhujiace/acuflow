import { describe, expect } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { MedicalFlow } from "@opencode-ai/core/medical/flow"
import { MedicalStore } from "@opencode-ai/core/medical/store"
import type { Medical } from "@opencode-ai/schema/medical"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, MedicalStore.node, MedicalFlow.node])),
)

const sessionID = SessionSchema.ID.make("ses_acuflow_scenario")

const seed = (id: typeof sessionID = sessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: "scenario",
        directory: "/project",
        title: "急腹症样例",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
  })

const output = (fields: Record<string, unknown>, summary: string): Medical.NodeOutput => ({
  fields: fields as Record<string, Schema.Json>,
  summary,
})

// 走完一个节点：补齐必需信息（无法获取的标记 unavailable），提交草案，医生确认。
const completeNode = (
  episodeID: Medical.EpisodeID,
  draft: Medical.NodeOutput,
  options?: { unavailable?: ReadonlyArray<string>; decision?: "confirm" | "edit"; edited?: Medical.NodeOutput },
) =>
  Effect.gen(function* () {
    const flow = yield* MedicalFlow.Service
    const status = (yield* flow.status(episodeID))!
    for (const label of status.definition.requiredInputs) {
      if (options?.unavailable?.includes(label)) {
        yield* flow.markUnavailable({ episodeID, label })
      } else {
        yield* flow.record({ episodeID, kind: "note", label, source: "医生口述", version: "v1" })
      }
    }
    yield* flow.submitDraft({ episodeID, output: draft })
    if (options?.decision === "edit") {
      yield* flow.review({ episodeID, decision: "edit", output: options.edited })
    } else {
      yield* flow.review({ episodeID, decision: "confirm" })
    }
  })

describe("AcuFlow 样例：转移性右下腹痛（急性阑尾炎）", () => {
  it.effect("从分诊推进到去向决策，并支持医生回溯修正", () =>
    Effect.gen(function* () {
      yield* seed()
      const store = yield* MedicalStore.Service
      const flow = yield* MedicalFlow.Service

      // 接诊：52 岁男性，转移性右下腹痛 18 小时。
      const patient = yield* store.createPatient({
        name: "样例患者-急性阑尾炎",
        sex: "male",
        birthDate: "1974-03-02",
        weightKg: 72,
        allergies: ["青霉素"],
        comorbidities: [],
      })
      const episode = yield* store.createEpisode({ patientID: patient.id, sessionID, title: "转移性右下腹痛" })
      const triage = yield* flow.start(episode.id)
      expect(triage.node.nodeKey).toBe("triage")
      expect(triage.missing).toEqual(["主诉", "起病时间", "生命体征", "意识", "重点病史"])

      yield* completeNode(episode.id, output(
        { suspected: "急性阑尾炎", urgency: "high", immediateReview: false },
        "青年男性转移性右下腹痛伴发热，考虑急性阑尾炎，需急诊评估，暂无需立即床旁抢救。",
      ))
      expect((yield* store.getEpisode(episode.id))?.currentNode).toBe("history_exam")

      // 问诊查体：妊娠可能不适用（男性）。
      yield* completeNode(
        episode.id,
        output({ location: "麦氏点", peritonism: true }, "符合急性阑尾炎体征，无弥漫性腹膜炎证据。"),
        { unavailable: ["妊娠可能"] },
      )
      expect((yield* store.getEpisode(episode.id))?.currentNode).toBe("labs")

      // 检验：妊娠相关检验不适用；其余返回。
      yield* completeNode(
        episode.id,
        output({ wbc: 15.2, lactate: 2.1 }, "白细胞升高，乳酸轻度升高，余无特殊。"),
        { unavailable: ["妊娠相关检验"] },
      )
      expect((yield* store.getEpisode(episode.id))?.currentNode).toBe("imaging_consult")

      // 影像+会诊：医生修改 agent 结论后确认。
      yield* completeNode(
        episode.id,
        output({ diagnosis: "急性阑尾炎", severity: "uncomplicated" }, "CT 与临床一致，支持急性阑尾炎。"),
        {
          decision: "edit",
          edited: output(
            { diagnosis: "急性阑尾炎", severity: "uncomplicated", plan: "急诊腹腔镜阑尾切除" },
            "CT 与临床一致，支持急性阑尾炎，建议急诊腹腔镜阑尾切除。",
          ),
        },
      )
      const imaging = yield* store.getNode(episode.id, "imaging_consult")
      expect(imaging?.editedBy).toBe("doctor")
      expect(imaging?.outputAgent?.summary).toBe("CT 与临床一致，支持急性阑尾炎。")
      expect(imaging?.outputFinal?.summary).toContain("急诊腹腔镜阑尾切除")
      expect((yield* store.getEpisode(episode.id))?.currentNode).toBe("treatment_observation")

      yield* completeNode(
        episode.id,
        output({ antibiotics: true, painImproved: true }, "抗感染与补液后疼痛缓解，生命体征平稳。"),
      )
      yield* completeNode(
        episode.id,
        output({ disposition: "surgery", pending: ["病理"] }, "转入普外科行手术治疗，交代随访与病理回报。"),
      )

      const closed = yield* store.getEpisode(episode.id)
      expect(closed?.status).toBe("closed")
      expect(closed?.currentNode).toBeNull()
      const timeline = yield* store.listNodes(episode.id)
      expect(timeline.map((node) => node.nodeKey)).toEqual([
        "triage",
        "history_exam",
        "labs",
        "imaging_consult",
        "treatment_observation",
        "disposition",
      ])
      expect(timeline.every((node) => node.status === "completed")).toBe(true)

      // 回溯：医生修正检验节点结论，下游已确认节点标记为 stale。
      const labs = yield* store.getNode(episode.id, "labs")
      yield* flow.amend({
        nodeID: labs!.id,
        output: output({ wbc: 18.4, lactate: 2.1 }, "复读血常规白细胞进一步升高。"),
        reason: "检验复读结果更正",
      })
      const downstream = yield* store.listNodes(episode.id)
      expect(downstream.filter((node) => node.seq > labs!.seq).every((node) => node.stale)).toBe(true)
      expect((yield* store.listAudit(episode.id)).map((row) => row.action)).toContain("amend")
    }),
  )

  it.effect("分诊信息不全时必须追问，补齐信息前不得提交草案", () =>
    Effect.gen(function* () {
      const partialSession = SessionSchema.ID.make("ses_acuflow_partial")
      yield* seed(partialSession)
      const store = yield* MedicalStore.Service
      const flow = yield* MedicalFlow.Service

      const patient = yield* store.createPatient({ name: "样例患者-分诊缺项", sex: "male" })
      const episode = yield* store.createEpisode({ patientID: patient.id, sessionID: partialSession })
      yield* flow.start(episode.id)

      // 对标脚本节点一的开场：只提供了 主诉 / 生命体征 / 意识。
      yield* flow.record({ episodeID: episode.id, kind: "history", label: "主诉", payload: { text: "转移性右下腹痛伴发热" } })
      yield* flow.record({ episodeID: episode.id, kind: "vital", label: "生命体征", payload: { t: 38.2, hr: 102 } })
      yield* flow.record({ episodeID: episode.id, kind: "note", label: "意识" })

      const status = (yield* flow.status(episode.id))!
      // 这正是 agent 应向医生追问的清单。
      expect(status.missing).toEqual(["起病时间", "重点病史"])
      expect(status.canSubmit).toBe(false)

      // 信息不全时提交必须被拒绝。
      const blocked = yield* flow.submitDraft({ episodeID: episode.id, output: output({}, "过早结论") }).pipe(Effect.exit)
      expect(Exit.isFailure(blocked)).toBe(true)

      // 医生补齐缺失信息后，方可提交。
      yield* flow.record({ episodeID: episode.id, kind: "history", label: "起病时间", payload: { hours: 18 } })
      yield* flow.record({ episodeID: episode.id, kind: "history", label: "重点病史", payload: { priorSurgery: false } })
      const complete = (yield* flow.status(episode.id))!
      expect(complete.missing).toEqual([])
      expect(complete.canSubmit).toBe(true)

      const submitted = yield* flow.submitDraft({
        episodeID: episode.id,
        output: output({ suspected: "急性阑尾炎" }, "分诊草案"),
      })
      expect(submitted.status).toBe("ready_for_review")
    }),
  )
})
