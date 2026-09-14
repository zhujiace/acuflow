export * as MedicalFlow from "./flow"

import { Context, Effect, Layer, Schema } from "effect"
import { Medical } from "@opencode-ai/schema/medical"
import { MedicalEvent } from "@opencode-ai/schema/medical-event"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { MedicalStore } from "./store"

export type NodeDefinition = Medical.FlowNode

export const defaultNodes: ReadonlyArray<NodeDefinition> = [
  {
    key: "triage",
    seq: 0,
    title: "分诊、首次接诊",
    entryAgent: "acuflow",
    requiredInputs: ["主诉", "起病时间", "生命体征", "意识", "重点病史"],
    synonyms: {
      主诉: ["主诉", "腹痛", "疼痛", "痛"],
      起病时间: ["起病", "发病", "小时前", "多久", "病程", "几小时", "几天", "突发", "渐进"],
      生命体征: ["生命体征", "血压", "心率", "呼吸", "体温", "血氧", "SpO2", "SpO₂", "BP", "HR"],
      意识: ["意识", "清醒", "嗜睡", "烦躁", "昏迷"],
      重点病史: ["既往", "病史", "手术史", "基础疾病", "基础病", "用药", "抗凝", "抗血小板", "过敏"],
    },
  },
  {
    key: "history_exam",
    seq: 1,
    title: "问诊、查体完成",
    entryAgent: "acuflow",
    requiredInputs: ["症状特点", "腹部体征", "既往手术", "用药", "过敏", "妊娠可能"],
    synonyms: {
      症状特点: ["症状", "疼痛", "性质", "转移", "恶心", "呕吐", "腹泻", "食欲", "排便", "排气"],
      腹部体征: ["查体", "腹部", "压痛", "反跳痛", "肌紧张", "麦氏点", "腹膜", "包块"],
      既往手术: ["手术史", "既往手术", "手术"],
      用药: ["用药", "药物", "抗凝", "抗血小板", "激素"],
      过敏: ["过敏"],
      妊娠可能: ["妊娠", "怀孕", "月经", "HCG"],
    },
  },
  {
    key: "labs",
    seq: 2,
    title: "第一批检验返回",
    entryAgent: "acuflow",
    requiredInputs: ["血常规", "生化", "肝胆胰指标", "凝血", "血气及乳酸", "尿液", "妊娠相关检验"],
    synonyms: {
      血常规: ["血常规", "白细胞", "WBC", "中性", "血红蛋白", "血小板"],
      生化: ["生化", "肌酐", "尿素", "血糖", "电解质"],
      肝胆胰指标: ["肝胆", "胰", "胆红素", "转氨酶", "淀粉酶", "脂肪酶", "ALT", "AST"],
      凝血: ["凝血", "PT", "INR", "APTT"],
      血气及乳酸: ["血气", "乳酸", "Lac", "PaO2", "pCO2"],
      尿液: ["尿液", "尿常规", "尿"],
      妊娠相关检验: ["妊娠", "HCG", "怀孕"],
    },
  },
  {
    key: "imaging_consult",
    seq: 3,
    title: "影像及会诊结果返回",
    entryAgent: "acuflow",
    requiredInputs: ["影像报告", "影像分析", "会诊意见"],
    synonyms: {
      影像报告: ["影像", "CT", "超声", "B超", "MRI", "报告", "平片"],
      影像分析: ["影像分析", "AI 分析", "AI分析", "重建"],
      会诊意见: ["会诊", "专科意见", "外科建议", "建议手术"],
    },
  },
  {
    key: "treatment_observation",
    seq: 4,
    title: "治疗、留观期间",
    entryAgent: "acuflow",
    requiredInputs: ["给药", "补液", "引流", "疼痛变化", "生命体征趋势"],
    synonyms: {
      给药: ["给药", "用药", "抗生素", "头孢", "甲硝唑", "止痛", "镇痛"],
      补液: ["补液", "输液", "液体", "生理盐水", "林格"],
      引流: ["引流", "胃管", "减压", "置管"],
      疼痛变化: ["疼痛", "缓解", "加重", "VAS", "NRS"],
      生命体征趋势: ["生命体征", "血压", "心率", "体温", "趋势", "复查"],
    },
  },
  {
    key: "disposition",
    seq: 5,
    title: "住院、转院、出院前",
    entryAgent: "acuflow",
    requiredInputs: ["最新状态", "未解决问题", "待回报结果", "随访条件"],
    synonyms: {
      最新状态: ["最新状态", "平稳", "稳定", "一般情况"],
      未解决问题: ["未解决", "待明确", "待查"],
      待回报结果: ["待回报", "病理", "培养", "回报", "结果未回"],
      随访条件: ["随访", "复诊", "交接", "出院"],
    },
  },
]

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MedicalFlow.NotFoundError", {
  message: Schema.String,
}) {}

export class MissingInformationError extends Schema.TaggedErrorClass<MissingInformationError>()(
  "MedicalFlow.MissingInformationError",
  { missing: Schema.Array(Schema.String) },
) {}

export class InvalidTransitionError extends Schema.TaggedErrorClass<InvalidTransitionError>()(
  "MedicalFlow.InvalidTransitionError",
  { message: Schema.String },
) {}

export type Status = {
  readonly episode: Medical.Episode
  readonly node: Medical.EpisodeNode
  readonly definition: NodeDefinition
  readonly missing: ReadonlyArray<string>
  readonly unavailable: ReadonlyArray<string>
  readonly canSubmit: boolean
  readonly isLast: boolean
}

export type RecordInput = {
  episodeID: Medical.EpisodeID
  kind: Medical.ClinicalKind
  label: string
  collectedAt?: number
  source?: string
  version?: string
  negative?: boolean
  payload?: Record<string, unknown>
}

export type SubmitDraftInput = {
  episodeID: Medical.EpisodeID
  output: Medical.NodeOutput
}

export type ReviewInput = {
  episodeID: Medical.EpisodeID
  decision: "confirm" | "edit" | "reject"
  output?: Medical.NodeOutput
  reason?: string
  confirmedBy?: string
}

export type AmendInput = {
  nodeID: Medical.EpisodeNodeID
  output: Medical.NodeOutput
  reason?: string
}

export interface Interface {
  readonly nodes: () => ReadonlyArray<NodeDefinition>
  readonly definitions: (episodeID: Medical.EpisodeID) => Effect.Effect<ReadonlyArray<NodeDefinition>, NotFoundError>
  readonly start: (episodeID: Medical.EpisodeID, flow?: Medical.Flow) => Effect.Effect<Status, NotFoundError>
  readonly status: (episodeID: Medical.EpisodeID) => Effect.Effect<Status | undefined, NotFoundError>
  readonly record: (input: RecordInput) => Effect.Effect<Status, NotFoundError>
  readonly ingestNarrative: (input: {
    episodeID: Medical.EpisodeID
    text: string
  }) => Effect.Effect<Status, NotFoundError>
  readonly markUnavailable: (input: {
    episodeID: Medical.EpisodeID
    label: string
  }) => Effect.Effect<Status, NotFoundError>
  readonly submitDraft: (
    input: SubmitDraftInput,
  ) => Effect.Effect<Medical.EpisodeNode, NotFoundError | MissingInformationError | InvalidTransitionError>
  readonly review: (
    input: ReviewInput,
  ) => Effect.Effect<Medical.EpisodeNode, NotFoundError | InvalidTransitionError>
  readonly amend: (input: AmendInput) => Effect.Effect<Medical.EpisodeNode, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MedicalFlow") {}

function missingFor(
  definition: NodeDefinition,
  records: ReadonlyArray<Medical.ClinicalData>,
): { missing: string[]; unavailable: string[] } {
  const captured = new Set(records.filter((row) => row.status === "captured").map((row) => row.label))
  const unavailable = new Set(records.filter((row) => row.status === "unavailable").map((row) => row.label))
  return {
    missing: definition.requiredInputs.filter((label) => !captured.has(label) && !unavailable.has(label)),
    unavailable: Array.from(unavailable),
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const events = yield* EventV2.Service

    const resolveFlow = (episodeID: Medical.EpisodeID) =>
      Effect.gen(function* () {
        const stored = yield* store.getEpisodeFlow(episodeID)
        return stored && stored.length > 0 ? stored : defaultNodes
      })

    const statusOf = (episodeID: Medical.EpisodeID) =>
      Effect.gen(function* () {
        const episode = yield* store.getEpisode(episodeID)
        if (!episode) return yield* new NotFoundError({ message: `episode ${episodeID} not found` })
        if (!episode.currentNode) return undefined
        const node = yield* store.getNode(episodeID, episode.currentNode)
        if (!node) return undefined
        const definitions = yield* resolveFlow(episodeID)
        const index = definitions.findIndex((item) => item.key === node.nodeKey)
        const definition = index >= 0 ? definitions[index] : undefined
        if (!definition) return undefined
        const records = yield* store.queryClinical({ episodeID })
        const { missing, unavailable } = missingFor(definition, records)
        return {
          episode,
          node,
          definition,
          missing,
          unavailable,
          canSubmit: missing.length === 0 && (node.status === "gathering" || node.status === "ready_for_review"),
          isLast: index === definitions.length - 1,
        } satisfies Status
      })

    const requireStatus = (episodeID: Medical.EpisodeID) =>
      Effect.gen(function* () {
        const status = yield* statusOf(episodeID)
        if (!status) return yield* new NotFoundError({ message: `episode ${episodeID} has no active node` })
        return status
      })

    const refreshNode = (episodeID: Medical.EpisodeID, definition: NodeDefinition, node: Medical.EpisodeNode) =>
      Effect.gen(function* () {
        const records = yield* store.queryClinical({ episodeID })
        const { missing, unavailable } = missingFor(definition, records)
        return yield* store.replaceNode(node, { missing, unavailable })
      })

    const start = Effect.fn("MedicalFlow.start")(function* (episodeID: Medical.EpisodeID, flow?: Medical.Flow) {
      const episode = yield* store.getEpisode(episodeID)
      if (!episode) return yield* new NotFoundError({ message: `episode ${episodeID} not found` })
      const existing = yield* store.listNodes(episodeID)
      if (existing.length === 0) {
        if (flow && flow.length > 0) yield* store.setEpisodeFlow(episodeID, flow)
        const definitions = yield* resolveFlow(episodeID)
        const first = definitions[0]!
        const node = yield* store.createNode({ episodeID, nodeKey: first.key, seq: first.seq, status: "gathering" })
        yield* store.setEpisodeNode(episodeID, first.key)
        yield* refreshNode(episodeID, first, node)
        yield* events.publish(MedicalEvent.NodeStarted, {
          episodeID,
          timestamp: Date.now(),
          nodeID: node.id,
          nodeKey: first.key,
        })
      } else if (!episode.currentNode) {
        yield* store.setEpisodeNode(episodeID, existing[existing.length - 1]!.nodeKey)
      }
      return yield* requireStatus(episodeID)
    })

    const definitions = Effect.fn("MedicalFlow.definitions")(function* (episodeID: Medical.EpisodeID) {
      const episode = yield* store.getEpisode(episodeID)
      if (!episode) return yield* new NotFoundError({ message: `episode ${episodeID} not found` })
      return yield* resolveFlow(episodeID)
    })

    const status = Effect.fn("MedicalFlow.status")(function* (episodeID: Medical.EpisodeID) {
      const episode = yield* store.getEpisode(episodeID)
      if (!episode) return yield* new NotFoundError({ message: `episode ${episodeID} not found` })
      return yield* statusOf(episodeID)
    })

    const record = Effect.fn("MedicalFlow.record")(function* (input: RecordInput) {
      const current = yield* requireStatus(input.episodeID)
      yield* store.recordClinical({
        episodeID: input.episodeID,
        nodeID: current.node.id,
        kind: input.kind,
        label: input.label,
        collectedAt: input.collectedAt,
        source: input.source,
        version: input.version,
        negative: input.negative,
        payload: input.payload,
      })
      yield* events.publish(MedicalEvent.DataRecorded, {
        episodeID: input.episodeID,
        timestamp: Date.now(),
        nodeID: current.node.id,
        kind: input.kind,
        label: input.label,
        status: "captured",
      })
      yield* refreshNode(input.episodeID, current.definition, current.node)
      return yield* requireStatus(input.episodeID)
    })

    const ingestNarrative = Effect.fn("MedicalFlow.ingestNarrative")(function* (input: {
      episodeID: Medical.EpisodeID
      text: string
    }) {
      const current = yield* requireStatus(input.episodeID)
      const text = input.text.trim()
      if (!text) return current
      const existing = yield* store.queryClinical({ episodeID: input.episodeID })
      const captured = new Set(existing.filter((row) => row.status === "captured").map((row) => row.label))
      const lower = text.toLowerCase()
      const matched = current.definition.requiredInputs.filter((label) => {
        if (captured.has(label)) return false
        const patterns = [label, ...(current.definition.synonyms?.[label] ?? [])]
        return patterns.some((pattern) => lower.includes(pattern.toLowerCase()))
      })
      yield* Effect.forEach(
        matched,
        (label) =>
          store.recordClinical({
            episodeID: input.episodeID,
            nodeID: current.node.id,
            kind: "history",
            label,
            source: "对话自动提取",
            payload: { text },
          }),
        { discard: true },
      )
      yield* refreshNode(input.episodeID, current.definition, current.node)
      return yield* requireStatus(input.episodeID)
    })

    const markUnavailable = Effect.fn("MedicalFlow.markUnavailable")(function* (input: {
      episodeID: Medical.EpisodeID
      label: string
    }) {
      const current = yield* requireStatus(input.episodeID)
      yield* store.recordClinical({
        episodeID: input.episodeID,
        nodeID: current.node.id,
        kind: "note",
        label: input.label,
        status: "unavailable",
      })
      yield* events.publish(MedicalEvent.DataRecorded, {
        episodeID: input.episodeID,
        timestamp: Date.now(),
        nodeID: current.node.id,
        kind: "note",
        label: input.label,
        status: "unavailable",
      })
      yield* refreshNode(input.episodeID, current.definition, current.node)
      return yield* requireStatus(input.episodeID)
    })

    const submitDraft = Effect.fn("MedicalFlow.submitDraft")(function* (input: SubmitDraftInput) {
      const current = yield* requireStatus(input.episodeID)
      if (current.node.status === "completed" || current.node.status === "confirmed") {
        return yield* new InvalidTransitionError({ message: `node ${current.node.nodeKey} is already settled` })
      }
      if (current.missing.length > 0) {
        return yield* new MissingInformationError({ missing: [...current.missing] })
      }
      const next = yield* store.replaceNode(current.node, {
        outputAgent: input.output,
        status: "ready_for_review",
      })
      yield* store.appendRevision({
        nodeID: current.node.id,
        revision: current.node.revision,
        output: input.output,
        actor: "agent",
        action: "draft",
      })
      yield* events.publish(MedicalEvent.NodeReviewRequested, {
        episodeID: input.episodeID,
        timestamp: Date.now(),
        nodeID: current.node.id,
        nodeKey: current.node.nodeKey,
        output: input.output,
      })
      return next
    })

    const advance = (current: Status) =>
      Effect.gen(function* () {
        const definitions = yield* resolveFlow(current.episode.id)
        const index = definitions.findIndex((item) => item.key === current.node.nodeKey)
        const nextDefinition = index >= 0 ? definitions[index + 1] : undefined
        if (!nextDefinition) {
          yield* store.setEpisodeNode(current.episode.id, null)
          yield* store.setEpisodeStatus(current.episode.id, "closed")
          return undefined
        }
        const node = yield* store.createNode({
          episodeID: current.episode.id,
          nodeKey: nextDefinition.key,
          seq: nextDefinition.seq,
          status: "gathering",
        })
        yield* store.setEpisodeNode(current.episode.id, nextDefinition.key)
        return node
      })

    const review = Effect.fn("MedicalFlow.review")(function* (input: ReviewInput) {
      const current = yield* requireStatus(input.episodeID)
      if (input.decision === "confirm" || input.decision === "edit") {
        if (current.node.status !== "ready_for_review") {
          return yield* new InvalidTransitionError({
            message: `node ${current.node.nodeKey} is not awaiting review`,
          })
        }
      }
      if (input.decision === "reject") {
        const next = yield* store.replaceNode(current.node, {
          status: "gathering",
          rejectReason: input.reason ?? null,
        })
        yield* store.appendRevision({
          nodeID: current.node.id,
          revision: current.node.revision + 1,
          output: current.node.outputAgent,
          actor: "doctor",
          action: "reject",
          reason: input.reason,
        })
        yield* store.appendAudit({
          episodeID: current.episode.id,
          nodeID: current.node.id,
          actor: "doctor",
          action: "reject",
          target: current.node.nodeKey,
          detail: { reason: input.reason ?? null },
        })
        yield* events.publish(MedicalEvent.NodeRejected, {
          episodeID: current.episode.id,
          timestamp: Date.now(),
          nodeID: current.node.id,
          nodeKey: current.node.nodeKey,
          reason: input.reason,
        })
        return next
      }

      const finalOutput = input.decision === "confirm" ? current.node.outputAgent : input.output
      if (!finalOutput) {
        return yield* new InvalidTransitionError({ message: `node ${current.node.nodeKey} has no output to settle` })
      }
      const edited = input.decision === "edit"
      const next = yield* store.replaceNode(current.node, {
        outputFinal: finalOutput,
        outputDiff: edited ? JSON.stringify({ agent: current.node.outputAgent, final: finalOutput }) : null,
        editedBy: edited ? "doctor" : "agent",
        confirmedBy: input.confirmedBy ?? "doctor",
        confirmedAt: Date.now(),
        status: "completed",
        stale: false,
        timeEnded: Date.now(),
      })
      yield* store.appendRevision({
        nodeID: current.node.id,
        revision: current.node.revision + 1,
        output: finalOutput,
        actor: "doctor",
        action: edited ? "edit" : "confirm",
        reason: input.reason,
      })
      yield* store.appendAudit({
        episodeID: current.episode.id,
        nodeID: current.node.id,
        actor: "doctor",
        action: edited ? "edit" : "confirm",
        target: current.node.nodeKey,
      })
      const nextNode = yield* advance(current)
      yield* events.publish(MedicalEvent.NodeConfirmed, {
        episodeID: current.episode.id,
        timestamp: Date.now(),
        nodeID: current.node.id,
        nodeKey: current.node.nodeKey,
        output: finalOutput,
        edited,
      })
      yield* events.publish(MedicalEvent.NodeCompleted, {
        episodeID: current.episode.id,
        timestamp: Date.now(),
        nodeID: current.node.id,
        nodeKey: current.node.nodeKey,
        nextNode: nextNode?.nodeKey,
      })
      if (nextNode) {
        yield* events.publish(MedicalEvent.NodeStarted, {
          episodeID: current.episode.id,
          timestamp: Date.now(),
          nodeID: nextNode.id,
          nodeKey: nextNode.nodeKey,
        })
      }
      return next
    })

    const amend = Effect.fn("MedicalFlow.amend")(function* (input: AmendInput) {
      const node = yield* store.getNodeByID(input.nodeID)
      if (!node) return yield* new NotFoundError({ message: `node ${input.nodeID} not found` })
      const next = yield* store.replaceNode(node, {
        outputFinal: input.output,
        outputDiff: JSON.stringify({ previous: node.outputFinal, final: input.output }),
        editedBy: "doctor",
        revision: node.revision + 1,
      })
      yield* store.appendRevision({
        nodeID: node.id,
        revision: node.revision + 1,
        output: input.output,
        actor: "doctor",
        action: "amend",
        reason: input.reason,
      })
      const downstream = (yield* store.listNodes(node.episodeID)).filter(
        (item) => item.seq > node.seq && (item.status === "completed" || item.status === "confirmed"),
      )
      yield* Effect.forEach(
        downstream,
        (item) =>
          Effect.gen(function* () {
            yield* store.replaceNode(item, { stale: true })
            yield* store.appendRevision({
              nodeID: item.id,
              revision: item.revision + 1,
              output: item.outputFinal,
              actor: "system",
              action: "stale",
              reason: `amended upstream node ${node.nodeKey}`,
            })
            yield* events.publish(MedicalEvent.NodeStale, {
              episodeID: node.episodeID,
              timestamp: Date.now(),
              nodeID: item.id,
              nodeKey: item.nodeKey,
              reason: `amended upstream node ${node.nodeKey}`,
            })
          }),
        { discard: true },
      )
      yield* store.appendAudit({
        episodeID: node.episodeID,
        nodeID: node.id,
        actor: "doctor",
        action: "amend",
        target: node.nodeKey,
        detail: { reason: input.reason ?? null, stale: downstream.map((item) => item.nodeKey) },
      })
      return next
    })

    return Service.of({
      nodes: () => defaultNodes,
      definitions,
      start,
      status,
      record,
      ingestNarrative,
      markUnavailable,
      submitDraft,
      review,
      amend,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [MedicalStore.node, EventV2.node] })
