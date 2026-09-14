import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
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

const setup = (suffix: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const sessionID = SessionSchema.ID.make(`ses_medical_${suffix}`)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "medical",
        directory: "/project",
        title: "medical",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    return sessionID
  })

const openEpisode = (suffix: string) =>
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const sessionID = yield* setup(suffix)
    const patient = yield* store.createPatient({ name: "张三", sex: "male", allergies: ["青霉素"] })
    const episode = yield* store.createEpisode({ patientID: patient.id, sessionID, title: "急腹症" })
    return { store, patient, episode }
  })

const fill = (flow: MedicalFlow.Interface, episodeID: Medical.EpisodeID, labels: ReadonlyArray<string>) =>
  Effect.forEach(labels, (label) => flow.record({ episodeID, kind: "note", label }), { discard: true })

const draft = (summary: string): Medical.NodeOutput => ({ fields: { risk: "high" }, summary })

describe("MedicalStore + MedicalFlow", () => {
  it.effect("start creates the first node and reports missing required inputs", () =>
    Effect.gen(function* () {
      const { store, patient, episode } = yield* openEpisode("start")
      const flow = yield* MedicalFlow.Service

      expect(patient.allergies).toEqual(["青霉素"])
      const status = yield* flow.start(episode.id)
      expect(status.node.nodeKey).toBe("triage")
      expect(status.node.status).toBe("gathering")
      expect(status.missing).toEqual(["主诉", "起病时间", "生命体征", "意识", "重点病史"])
      expect(status.canSubmit).toBe(false)

      const after = yield* flow.record({
        episodeID: episode.id,
        kind: "vital",
        label: "生命体征",
        payload: { sbp: 90, hr: 110 },
      })
      expect(after.missing).not.toContain("生命体征")
      const persisted = yield* store.queryClinical({ episodeID: episode.id, kind: "vital" })
      expect(persisted).toHaveLength(1)
      expect(persisted[0]?.payload).toEqual({ sbp: 90, hr: 110 })
      expect(persisted[0]?.status).toBe("captured")
    }),
  )

  it.effect("submit is blocked while required information is missing", () =>
    Effect.gen(function* () {
      const { episode } = yield* openEpisode("blocked")
      const flow = yield* MedicalFlow.Service
      yield* flow.start(episode.id)

      const exit = yield* flow.submitDraft({ episodeID: episode.id, output: draft("early") }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("unavailable inputs clear the missing list without fabricating data", () =>
    Effect.gen(function* () {
      const { episode } = yield* openEpisode("unavailable")
      const flow = yield* MedicalFlow.Service
      yield* flow.start(episode.id)

      const status = yield* flow.markUnavailable({ episodeID: episode.id, label: "意识" })
      expect(status.missing).not.toContain("意识")
      expect(status.unavailable).toContain("意识")
    }),
  )

  it.effect("confirm settles the node, records the final output, and advances", () =>
    Effect.gen(function* () {
      const { store, episode } = yield* openEpisode("confirm")
      const flow = yield* MedicalFlow.Service
      const status = yield* flow.start(episode.id)
      yield* fill(flow, episode.id, status.definition.requiredInputs)

      const submitted = yield* flow.submitDraft({ episodeID: episode.id, output: draft("分诊结论") })
      expect(submitted.status).toBe("ready_for_review")
      expect(submitted.outputAgent?.summary).toBe("分诊结论")

      const settled = yield* flow.review({ episodeID: episode.id, decision: "confirm" })
      expect(settled.status).toBe("completed")
      expect(settled.outputFinal?.summary).toBe("分诊结论")
      expect(settled.editedBy).toBe("agent")

      const updated = yield* store.getEpisode(episode.id)
      expect(updated?.currentNode).toBe("history_exam")
      expect((yield* flow.status(episode.id))?.node.nodeKey).toBe("history_exam")
      expect(yield* store.listAudit(episode.id)).toHaveLength(1)
      expect(yield* store.listRevisions(settled.id)).toHaveLength(2)
    }),
  )

  it.effect("doctor edit records the final conclusion and who changed it", () =>
    Effect.gen(function* () {
      const { store, episode } = yield* openEpisode("edit")
      const flow = yield* MedicalFlow.Service
      const status = yield* flow.start(episode.id)
      yield* fill(flow, episode.id, status.definition.requiredInputs)
      yield* flow.submitDraft({ episodeID: episode.id, output: draft("agent 草案") })

      const edited = yield* flow.review({
        episodeID: episode.id,
        decision: "edit",
        output: { fields: { risk: "moderate" }, summary: "医生修订" },
      })
      expect(edited.status).toBe("completed")
      expect(edited.outputAgent?.summary).toBe("agent 草案")
      expect(edited.outputFinal?.summary).toBe("医生修订")
      expect(edited.editedBy).toBe("doctor")
      expect(edited.outputDiff).toBeDefined()
      const revisions = yield* store.listRevisions(edited.id)
      expect(revisions.map((row) => row.action)).toEqual(["draft", "edit"])
    }),
  )

  it.effect("reject returns the node to gathering with a reason", () =>
    Effect.gen(function* () {
      const { store, episode } = yield* openEpisode("reject")
      const flow = yield* MedicalFlow.Service
      const status = yield* flow.start(episode.id)
      yield* fill(flow, episode.id, status.definition.requiredInputs)
      yield* flow.submitDraft({ episodeID: episode.id, output: draft("agent 草案") })

      const rejected = yield* flow.review({ episodeID: episode.id, decision: "reject", reason: "证据不足" })
      expect(rejected.status).toBe("gathering")
      expect(rejected.rejectReason).toBe("证据不足")
      expect((yield* store.getEpisode(episode.id))?.currentNode).toBe("triage")
      expect((yield* store.listRevisions(rejected.id)).map((row) => row.action)).toEqual(["draft", "reject"])
    }),
  )

  it.effect("amending an upstream node marks settled downstream conclusions stale", () =>
    Effect.gen(function* () {
      const { store, episode } = yield* openEpisode("amend")
      const flow = yield* MedicalFlow.Service

      const triage = yield* flow.start(episode.id)
      yield* fill(flow, episode.id, triage.definition.requiredInputs)
      yield* flow.submitDraft({ episodeID: episode.id, output: draft("分诊") })
      yield* flow.review({ episodeID: episode.id, decision: "confirm" })

      const history = (yield* flow.status(episode.id))!
      yield* fill(flow, episode.id, history.definition.requiredInputs)
      yield* flow.submitDraft({ episodeID: episode.id, output: draft("问诊") })
      yield* flow.review({ episodeID: episode.id, decision: "confirm" })

      const triageNode = yield* store.getNode(episode.id, "triage")
      yield* flow.amend({ nodeID: triageNode!.id, output: draft("分诊修正"), reason: "补充生命体征" })

      const amended = yield* store.getNode(episode.id, "triage")
      expect(amended?.outputFinal?.summary).toBe("分诊修正")
      const downstream = yield* store.getNode(episode.id, "history_exam")
      expect(downstream?.stale).toBe(true)
      const audit = yield* store.listAudit(episode.id)
      expect(audit.map((row) => row.action)).toContain("amend")
    }),
  )

  it.effect("rejects a second episode for the same session", () =>
    Effect.gen(function* () {
      const { store, patient, episode } = yield* openEpisode("unique")
      const exit = yield* store.createEpisode({ patientID: patient.id, sessionID: episode.sessionID }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("ingestNarrative 从医生原话中抽取所需信息（不依赖模型结构化）", () =>
    Effect.gen(function* () {
      const { episode } = yield* openEpisode("ingest")
      const flow = yield* MedicalFlow.Service
      yield* flow.start(episode.id)

      // 样例节点一的原始输入（未提“起病时间”）。
      const opening =
        "男，52 岁，1974-03-02 生，72 公斤，青霉素过敏。主诉转移性右下腹痛，伴发热恶心。生命体征 T 38.2℃、HR 102、BP 118/72、RR 20、SpO2 98%，意识清醒。"
      const after = yield* flow.ingestNarrative({ episodeID: episode.id, text: opening })
      expect(after.unavailable).toEqual([])
      // 主诉/生命体征/意识/重点病史(过敏) 被抽取，“起病时间”仍缺失 —— 这正是应向医生追问的项。
      expect(after.missing).toEqual(["起病时间"])

      const done = yield* flow.ingestNarrative({
        episodeID: episode.id,
        text: "起病 18 小时前，脐周隐痛后转移至右下腹。",
      })
      expect(done.missing).toEqual([])
      expect(done.canSubmit).toBe(true)
    }),
  )

  it.effect("自定义 flow 覆盖默认节点图与必需项", () =>
    Effect.gen(function* () {
      const { episode } = yield* openEpisode("customflow")
      const flow = yield* MedicalFlow.Service
      const custom: Medical.Flow = [
        { key: "triage", seq: 0, title: "自定义分诊", entryAgent: "acuflow", requiredInputs: ["甲项"], synonyms: { 甲项: ["甲"] } },
        { key: "labs", seq: 1, title: "自定义检验", entryAgent: "acuflow", requiredInputs: ["乙项"] },
      ]

      const status = yield* flow.start(episode.id, custom)
      expect(status.definition.title).toBe("自定义分诊")
      expect(status.definition.requiredInputs).toEqual(["甲项"])
      expect(status.missing).toEqual(["甲项"])
      expect((yield* flow.definitions(episode.id)).map((item) => item.key)).toEqual(["triage", "labs"])

      const after = yield* flow.ingestNarrative({ episodeID: episode.id, text: "甲" })
      expect(after.missing).toEqual([])

      yield* flow.submitDraft({ episodeID: episode.id, output: { fields: {}, summary: "自定义分诊结论" } })
      yield* flow.review({ episodeID: episode.id, decision: "confirm" })
      const next = (yield* flow.status(episode.id))!
      expect(next.node.nodeKey).toBe("labs")
      expect(next.definition.title).toBe("自定义检验")
      expect(next.missing).toEqual(["乙项"])
    }),
  )
})
