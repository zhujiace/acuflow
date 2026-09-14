import path from "path"
import { Effect, Option, Schema } from "effect"
import { Config } from "@/config/config"
import { MedicalFlow } from "@opencode-ai/core/medical/flow"
import { MedicalStore } from "@opencode-ai/core/medical/store"
import { Medical } from "@opencode-ai/schema/medical"
import * as Tool from "./tool"

type Metadata = Record<string, unknown>

function ok(title: string, data: unknown, metadata: Metadata = {}) {
  return { title, output: JSON.stringify(data, null, 2), metadata }
}

function allow(ctx: Tool.Context, permission: string) {
  return ctx.ask({ permission, patterns: ["*"], always: ["*"], metadata: {} })
}

function statusView(status: MedicalFlow.Status | undefined) {
  if (!status) return { active: false, message: "当前会话没有进行中的 episode，请先调用 episode_start" }
  return {
    episodeID: status.episode.id,
    title: status.episode.title,
    node: status.node.nodeKey,
    nodeTitle: status.definition.title,
    status: status.node.status,
    missing: status.missing,
    unavailable: status.unavailable,
    canSubmit: status.canSubmit,
    isLast: status.isLast,
    draft: status.node.outputAgent ?? null,
    final: status.node.outputFinal ?? null,
  }
}

// 读取会话中最后一条用户消息的文本，用于确定性摄取，避免依赖模型结构化。
function latestUserText(messages: Tool.Context["messages"]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.info.role !== "user") continue
    return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  }
  return ""
}

// 从项目的 .opencode/acuflow/flow.json 读取可自定义的节点流程（若存在且合法）。
function loadFlow(config: Config.Interface) {
  return Effect.gen(function* () {
    const dirs = yield* config.directories()
    for (const dir of dirs) {
      const file = path.join(dir, "acuflow", "flow.json")
      const exists = yield* Effect.promise(() => Bun.file(file).exists())
      if (!exists) continue
      const parsed = yield* Effect.promise(() => Bun.file(file).json()).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (parsed === undefined || parsed === null) continue
      const decoded = Schema.decodeUnknownOption(Medical.Flow)(parsed)
      if (Option.isSome(decoded)) return decoded.value
    }
    return undefined
  })
}

const PatientInput = Schema.Struct({
  name: Schema.String.annotate({ description: "患者姓名或匿名标识" }),
  sex: Schema.optional(Schema.String),
  birthDate: Schema.optional(Schema.String),
  weightKg: Schema.optional(Schema.Finite),
  heightCm: Schema.optional(Schema.Finite),
  allergies: Schema.optional(Schema.Array(Schema.String)),
  comorbidities: Schema.optional(Schema.Array(Schema.String)),
  baseline: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const PatientPatch = Schema.Struct({
  name: Schema.optional(Schema.String),
  sex: Schema.optional(Schema.String),
  birthDate: Schema.optional(Schema.String),
  weightKg: Schema.optional(Schema.Finite),
  heightCm: Schema.optional(Schema.Finite),
  allergies: Schema.optional(Schema.Array(Schema.String)),
  comorbidities: Schema.optional(Schema.Array(Schema.String)),
  baseline: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const ObservationInput = Schema.Struct({
  label: Schema.String.annotate({ description: "对应节点要求的信息项名称，如 主诉、起病时间、生命体征" }),
  kind: Schema.optional(
    Schema.Literals(["vital", "lab", "imaging", "medication", "note", "consult", "history"]),
  ).annotate({ description: "默认为 note" }),
  value: Schema.optional(Schema.String.annotate({ description: "该项的原始内容/数值" })),
  negative: Schema.optional(Schema.Boolean),
  source: Schema.optional(Schema.String),
})
type Observation = {
  label: string
  kind?: Medical.ClinicalKind
  value?: string
  negative?: boolean
  source?: string
}

const applyObservations = (
  flow: MedicalFlow.Interface,
  episodeID: Medical.EpisodeID,
  observations: ReadonlyArray<Observation>,
) =>
  Effect.gen(function* () {
    // 只记录当前节点仍缺失的项，避免模型重复提交造成数据与事件洪泛。
    const status = yield* flow.status(episodeID)
    const missing = new Set(status?.missing ?? [])
    const usable = observations.filter(
      (item) =>
        missing.has(item.label) &&
        (item.negative === true || (item.value !== undefined && !isPlaceholder(item.value))),
    )
    yield* Effect.forEach(
      usable,
      (item) =>
        flow.record({
          episodeID,
          kind: item.kind ?? "note",
          label: item.label,
          payload: item.value === undefined ? undefined : { value: item.value },
          negative: item.negative,
          source: item.source,
        }),
      { discard: true },
    )
  })

// 防止把“未提供/待补充”等占位内容当作已采集，从而绕过缺失信息门控。
function isPlaceholder(value: string): boolean {
  const text = value.trim()
  if (text.length === 0) return true
  return /^(未提供|待补充|未知|不详|无数据|无资料|待查|不适用|不詳|暂无|n\/?a|unknown|not\s*provided|pending|tbd)/i.test(
    text,
  )
}

export const EpisodeStartTool = Tool.define(
  "episode_start",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    const config = yield* Config.Service
    return {
      description:
        "开始一次新的诊疗 episode：登记患者并绑定当前会话，进入第一个节点（分诊）。新患者接诊时先调用本工具。请把医生本次已提供的临床信息一并放进 observations（如 主诉/起病时间/生命体征/意识/重点病史），避免重复追问。若当前会话已有 episode，则返回其状态而不重复创建。",
      parameters: Schema.Struct({
        patient: PatientInput,
        title: Schema.optional(Schema.String.annotate({ description: "本次诊断标题，如主诉" })),
        observations: Schema.optional(Schema.Array(ObservationInput).annotate({
          description: "医生已提供的临床信息项（可选；本工具也会自动从医生原话中提取）",
        })),
      }),
      execute: (
        params: { patient: typeof PatientInput.Type; title?: string; observations?: ReadonlyArray<Observation> },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* allow(ctx, "episode_start")
          const observations = params.observations ?? []
          const existing = yield* store.getEpisodeBySession(ctx.sessionID)
          if (existing) {
            yield* applyObservations(flow, existing.id, observations)
            yield* flow.ingestNarrative({ episodeID: existing.id, text: latestUserText(ctx.messages) })
            const status = yield* flow.status(existing.id)
            return ok("已有进行中的 episode", { episodeID: existing.id, reused: true, status: statusView(status) })
          }
          const patient = yield* store.createPatient(params.patient)
          const episode = yield* store.createEpisode({
            patientID: patient.id,
            sessionID: ctx.sessionID,
            title: params.title,
          })
          yield* flow.start(episode.id, yield* loadFlow(config))
          yield* applyObservations(flow, episode.id, observations)
          yield* flow.ingestNarrative({ episodeID: episode.id, text: latestUserText(ctx.messages) })
          const status = yield* flow.status(episode.id)
          yield* store.appendAudit({
            episodeID: episode.id,
            actor: "doctor",
            action: "episode.start",
            target: "episode",
            detail: { patientID: patient.id },
          })
          return ok(`Episode ${episode.id}`, {
            episodeID: episode.id,
            patientID: patient.id,
            status: statusView(status),
          })
        }).pipe(Effect.orDie),
    }
  }),
)

export const PatientGetTool = Tool.define(
  "patient_get",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    return {
      description: "查看患者档案。可传 patientID，或省略以读取当前会话对应 episode 的患者。",
      parameters: Schema.Struct({ patientID: Schema.optional(Schema.String) }),
      execute: (params: { patientID?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "patient_get")
          const id = params.patientID
            ? (params.patientID as Medical.PatientID)
            : (yield* store.getEpisodeBySession(ctx.sessionID))?.patientID
          if (!id) return ok("未找到患者", { found: false })
          const patient = yield* store.getPatient(id)
          return ok(patient ? patient.name : "未找到患者", { found: patient !== undefined, patient: patient ?? null })
        }),
    }
  }),
)

export const PatientUpdateTool = Tool.define(
  "patient_update",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    return {
      description: "更新患者档案字段（姓名、性别、出生日期、体重、身高、过敏史、基础疾病、基线信息）。",
      parameters: Schema.Struct({ patientID: Schema.optional(Schema.String), patch: PatientPatch }),
      execute: (params: { patientID?: string; patch: typeof PatientPatch.Type }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "patient_update")
          const id = params.patientID
            ? (params.patientID as Medical.PatientID)
            : (yield* store.getEpisodeBySession(ctx.sessionID))?.patientID
          if (!id) return ok("未找到患者", { updated: false })
          const patient = yield* store.updatePatient(id, params.patch)
          return ok("已更新患者档案", { updated: patient !== undefined, patient: patient ?? null })
        }),
    }
  }),
)

export const EpisodeStatusTool = Tool.define(
  "episode_status",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    return {
      description:
        "查看当前诊疗节点状态：所在节点、节点要求的产出、已采集/待补充/无法获取的信息、是否可提交产出，以及完整节点时间轴。每轮对话都应调用本工具。若本轮医生又提供了新的临床信息，请放进 observations，本工具会先记录再返回最新的待补充清单。",
      parameters: Schema.Struct({
        observations: Schema.optional(Schema.Array(ObservationInput).annotate({
          description: "本轮医生新提供的临床信息项（可选；本工具也会自动从医生原话中提取）",
        })),
      }),
      execute: (params: { observations?: ReadonlyArray<Observation> }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "episode_status")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", statusView(undefined))
          yield* applyObservations(flow, episode.id, params.observations ?? [])
          yield* flow.ingestNarrative({ episodeID: episode.id, text: latestUserText(ctx.messages) })
          const status = yield* flow.status(episode.id)
          const definitions = yield* flow.definitions(episode.id)
          const titleByKey = new Map(definitions.map((item) => [item.key, item.title]))
          const nodes = yield* store.listNodes(episode.id)
          const timeline = nodes.map((node) => ({
            node: node.nodeKey,
            title: titleByKey.get(node.nodeKey) ?? node.nodeKey,
            status: node.status,
            stale: node.stale,
            missing: node.missing,
            unavailable: node.unavailable,
            final: node.outputFinal ?? null,
          }))
          return ok(statusView(status).nodeTitle ?? "episode", {
            episodeID: episode.id,
            patientID: episode.patientID,
            title: episode.title,
            episodeStatus: episode.status,
            currentNode: episode.currentNode,
            timeline,
            current: statusView(status),
          })
        }).pipe(Effect.orDie),
    }
  }),
)

export const ClinicalRecordTool = Tool.define(
  "clinical_record",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    return {
      description:
        "记录医生提供的临床数据（生命体征、检验、影像、用药、病史、笔记、会诊）。必须区分正常采集、阴性结果与无法获取：无法获取请用 flow_mark_unavailable。",
      parameters: Schema.Struct({
        kind: Schema.Literals(["vital", "lab", "imaging", "medication", "note", "consult", "history"]),
        label: Schema.String.annotate({ description: "对应节点要求的信息项名称，如 主诉、生命体征、血常规" }),
        collectedAt: Schema.optional(Schema.Finite.annotate({ description: "实际采集时间（epoch 毫秒）" })),
        source: Schema.optional(Schema.String),
        version: Schema.optional(Schema.String),
        negative: Schema.optional(Schema.Boolean.annotate({ description: "是否为阴性结果" })),
        payload: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      }),
      execute: (
        params: {
          kind: Medical.ClinicalKind
          label: string
          collectedAt?: number
          source?: string
          version?: string
          negative?: boolean
          payload?: Record<string, unknown>
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* allow(ctx, "clinical_record")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", statusView(undefined))
          const payloadEmpty = params.payload === undefined || Object.keys(params.payload).length === 0
          const placeholder =
            typeof params.payload?.value === "string" ? isPlaceholder(params.payload.value) : false
          if (params.negative !== true && (payloadEmpty || placeholder)) {
            const current = yield* flow.status(episode.id)
            return ok(`未记录 ${params.label}：请提供实际内容，或标记阴性 / 无法获取`, statusView(current))
          }
          const status = yield* flow.record({
            episodeID: episode.id,
            kind: params.kind,
            label: params.label,
            collectedAt: params.collectedAt,
            source: params.source,
            version: params.version,
            negative: params.negative,
            payload: params.payload,
          })
          return ok(`已记录：${params.label}`, statusView(status))
        }).pipe(Effect.orDie),
    }
  }),
)

export const ClinicalQueryTool = Tool.define(
  "clinical_query",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    return {
      description: "查询本 episode 已记录的临床数据（可按类型或节点过滤），用于回看检验、影像、生命体征等原始证据。",
      parameters: Schema.Struct({
        kind: Schema.optional(
          Schema.Literals(["vital", "lab", "imaging", "medication", "note", "consult", "history"]),
        ),
        nodeID: Schema.optional(Schema.String),
      }),
      execute: (params: { kind?: Medical.ClinicalKind; nodeID?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "clinical_query")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", { records: [] })
          const records = yield* store.queryClinical({
            episodeID: episode.id,
            kind: params.kind,
            nodeID: params.nodeID as Medical.EpisodeNodeID | undefined,
          })
          return ok(`临床数据 ${records.length} 条`, { records })
        }),
    }
  }),
)

export const FlowSubmitDraftTool = Tool.define(
  "flow_submit_draft",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    return {
      description:
        "提交当前节点的产出草案，交由医生复核。产出为混合结构：fields 为节点结构化字段，summary 为临床小结。信息不足时会被拒绝并返回待补充项，请先补齐。",
      parameters: Schema.Struct({
        fields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        summary: Schema.String,
      }),
      execute: (params: { fields?: Record<string, unknown>; summary: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "flow_submit_draft")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", statusView(undefined))
          const result = yield* flow
            .submitDraft({
              episodeID: episode.id,
              output: { fields: (params.fields ?? {}) as Record<string, Schema.Json>, summary: params.summary },
            })
            .pipe(
              Effect.catchTag("MedicalFlow.MissingInformationError", (error) =>
                Effect.succeed({ kind: "missing" as const, missing: error.missing }),
              ),
              Effect.catchTag("MedicalFlow.InvalidTransitionError", (error) =>
                Effect.succeed({ kind: "invalid" as const, message: error.message }),
              ),
            )
          if ("kind" in result) {
            if (result.kind === "missing") return ok("信息不足，草案未提交", { submitted: false, missing: result.missing })
            return ok("当前节点状态不允许提交", { submitted: false, message: result.message })
          }
          return ok("草案已提交，等待医生确认", {
            submitted: true,
            node: result.nodeKey,
            status: result.status,
            draft: result.outputAgent,
          })
        }).pipe(Effect.orDie),
    }
  }),
)

export const FlowReviewTool = Tool.define(
  "flow_review",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    return {
      description:
        "医生对当前节点产出的复核：confirm 直接确认；edit 修改后确认（需提供 summary，可选 fields）；reject 驳回并说明原因。确认或修改后 episode 进入下一节点。",
      parameters: Schema.Struct({
        decision: Schema.Literals(["confirm", "edit", "reject"]),
        summary: Schema.optional(Schema.String.annotate({ description: "edit 时的修订小结" })),
        fields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        reason: Schema.optional(Schema.String.annotate({ description: "reject 或修订原因" })),
      }),
      execute: (
        params: {
          decision: "confirm" | "edit" | "reject"
          summary?: string
          fields?: Record<string, unknown>
          reason?: string
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* allow(ctx, "flow_review")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", statusView(undefined))
          if (params.decision === "edit" && !params.summary) {
            return ok("edit 需要提供 summary", { settled: false })
          }
          const result = yield* flow
            .review({
              episodeID: episode.id,
              decision: params.decision,
              output:
                params.decision === "edit"
                  ? { fields: (params.fields ?? {}) as Record<string, Schema.Json>, summary: params.summary ?? "" }
                  : undefined,
              reason: params.reason,
            })
            .pipe(
              Effect.catchTag("MedicalFlow.InvalidTransitionError", (error) =>
                Effect.succeed({ kind: "invalid" as const, message: error.message }),
              ),
            )
          if ("kind" in result) return ok("复核被拒绝", { settled: false, message: result.message })
          return ok("复核完成", {
            settled: true,
            decision: params.decision,
            node: result.nodeKey,
            status: result.status,
            final: result.outputFinal,
          })
        }).pipe(Effect.orDie),
    }
  }),
)

export const FlowMarkUnavailableTool = Tool.define(
  "flow_mark_unavailable",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    return {
      description:
        "将当前节点某项必需信息标记为“客观无法获取”。这会把它从待补充列表移除，但不会伪造数据；需医生明确确认无法获取时使用。",
      parameters: Schema.Struct({ label: Schema.String }),
      execute: (params: { label: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "flow_mark_unavailable")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", statusView(undefined))
          const status = yield* flow.markUnavailable({ episodeID: episode.id, label: params.label })
          return ok(`已标记无法获取：${params.label}`, statusView(status))
        }).pipe(Effect.orDie),
    }
  }),
)

const CALC_FIELDS: Record<string, ReadonlyArray<{ key: string; aliases: ReadonlyArray<string> }>> = {
  qsofa: [
    { key: "respiratoryRate", aliases: ["respiratoryRate", "rr", "RR", "呼吸频率", "呼吸"] },
    { key: "systolicBp", aliases: ["systolicBp", "sbp", "SBP", "收缩压", "血压"] },
    { key: "gcs", aliases: ["gcs", "GCS", "意识"] },
  ],
  shock_index: [
    { key: "heartRate", aliases: ["heartRate", "hr", "HR", "心率"] },
    { key: "systolicBp", aliases: ["systolicBp", "sbp", "SBP", "收缩压", "血压"] },
  ],
  bmi: [
    { key: "weightKg", aliases: ["weightKg", "weight", "体重"] },
    { key: "heightCm", aliases: ["heightCm", "height", "身高"] },
  ],
}

function pick(input: Record<string, unknown>, aliases: ReadonlyArray<string>): number | undefined {
  for (const alias of aliases) {
    const value = input[alias]
    if (value === undefined || value === null) continue
    const number = typeof value === "number" ? value : Number(value)
    if (Number.isFinite(number)) return number
  }
  return undefined
}

export function calculate(calc: string, input: Record<string, unknown>) {
  const fields = CALC_FIELDS[calc]
  if (!fields) return { error: `不支持的计算：${calc}` }
  const values: Record<string, number> = {}
  const missing: string[] = []
  for (const field of fields) {
    const value = pick(input, field.aliases)
    if (value === undefined) missing.push(field.key)
    else values[field.key] = value
  }
  if (missing.length) return { error: `缺少必要输入：${missing.join("、")}`, missing }
  if (calc === "qsofa") {
    const score =
      (values.respiratoryRate! >= 22 ? 1 : 0) + (values.systolicBp! <= 100 ? 1 : 0) + (values.gcs! < 15 ? 1 : 0)
    return { score, highRisk: score >= 2 }
  }
  if (calc === "shock_index") {
    const index = values.heartRate! / values.systolicBp!
    return { shockIndex: Math.round(index * 100) / 100, highRisk: index >= 0.9 }
  }
  const meters = values.heightCm! / 100
  const bmi = values.weightKg! / (meters * meters)
  return { bmi: Math.round(bmi * 10) / 10 }
}

export const MedCalcTool = Tool.define(
  "med_calc",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    return {
      description:
        "执行确定性医学计算并记录结果。qsofa 需要 respiratoryRate/systolicBp/gcs；shock_index 需要 heartRate/systolicBp；bmi 需要 weightKg/heightCm。优先使用本工具而非心算；若返回 error 表示输入不足，请补齐后重试。",
      parameters: Schema.Struct({
        calc: Schema.Literals(["qsofa", "shock_index", "bmi"]),
        input: Schema.Record(Schema.String, Schema.Unknown),
      }),
      execute: (params: { calc: string; input: Record<string, unknown> }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "med_calc")
          const output = calculate(params.calc, params.input)
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (episode) {
            yield* store.recordMedCalc({
              episodeID: episode.id,
              calc: params.calc,
              input: params.input,
              output,
            })
          }
          return ok(`计算 ${params.calc}`, { calc: params.calc, input: params.input, output })
        }),
    }
  }),
)

export const MedicalAuditTool = Tool.define(
  "medical_audit",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    return {
      description:
        "查看本 episode 的审计记录与各节点修订历史（证据回链）。可用 nodeKey 只看某个节点。",
      parameters: Schema.Struct({ nodeKey: Schema.optional(Schema.String) }),
      execute: (params: { nodeKey?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "medical_audit")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", { audit: [], revisions: [] })
          const audit = yield* store.listAudit(episode.id)
          const nodes = yield* store.listNodes(episode.id)
          const target = params.nodeKey ? nodes.filter((node) => node.nodeKey === params.nodeKey) : nodes
          const revisions = yield* Effect.forEach(target, (node) =>
            store
              .listRevisions(node.id)
              .pipe(Effect.map((rows) => rows.map((row) => ({ node: node.nodeKey, ...row })))),
          )
          return ok("审计与修订历史", { audit, revisions: revisions.flat() })
        }).pipe(Effect.orDie),
    }
  }),
)

export const FlowAmendTool = Tool.define(
  "flow_amend",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    return {
      description:
        "回溯修改某个已确认节点的最终结论（例如检验复读更正）。该节点之后的已确认节点会被标记为 stale，需要重新评估。",
      parameters: Schema.Struct({
        nodeKey: Schema.String.annotate({ description: "要修改的节点，如 labs、imaging_consult" }),
        summary: Schema.String,
        fields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        reason: Schema.optional(Schema.String),
      }),
      execute: (
        params: { nodeKey: string; summary: string; fields?: Record<string, unknown>; reason?: string },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* allow(ctx, "flow_amend")
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          if (!episode) return ok("无进行中的 episode", statusView(undefined))
          const node = yield* store.getNode(episode.id, params.nodeKey as Medical.NodeKey)
          if (!node) return ok("未找到该节点", { amended: false, nodeKey: params.nodeKey })
          const result = yield* flow.amend({
            nodeID: node.id,
            output: {
              fields: (params.fields ?? {}) as Record<string, Schema.Json>,
              summary: params.summary,
            },
            reason: params.reason,
          })
          return ok(`已回溯修改：${params.nodeKey}`, {
            amended: true,
            node: result.nodeKey,
            outputFinal: result.outputFinal,
          })
        }).pipe(Effect.orDie),
    }
  }),
)
