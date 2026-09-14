import path from "path"
import { Effect, Schema } from "effect"
import { Config } from "@/config/config"
import { MedicalFlow } from "@opencode-ai/core/medical/flow"
import { MedicalStore } from "@opencode-ai/core/medical/store"
import * as Tool from "./tool"

// 影像分析接口（P7）。默认不启用：仅在 .opencode/acuflow/imaging.json 且 enabled=true 时才会真正调用端点。
// 当前先保留接口与配置；未启用时工具只会返回“未启用”，不进行任何外部调用。

export type ImagingConfig = {
  enabled: boolean
  provider: string
  endpoint?: string
  model?: string
  timeoutMs: number
  routing?: Record<string, string>
}

export const DEFAULT_IMAGING: ImagingConfig = {
  enabled: false,
  provider: "http",
  timeoutMs: 15_000,
}

export function parseImagingConfig(value: unknown): ImagingConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const timeout = typeof record.timeoutMs === "number" && record.timeoutMs > 0 ? record.timeoutMs : DEFAULT_IMAGING.timeoutMs
  return {
    enabled: record.enabled === true,
    provider: typeof record.provider === "string" ? record.provider : DEFAULT_IMAGING.provider,
    endpoint: typeof record.endpoint === "string" && record.endpoint.length > 0 ? record.endpoint : undefined,
    model: typeof record.model === "string" && record.model.length > 0 ? record.model : undefined,
    timeoutMs: timeout,
    routing:
      typeof record.routing === "object" && record.routing !== null
        ? (record.routing as Record<string, string>)
        : undefined,
  }
}

export type ImagingRequest = {
  image: string
  modality?: string
  node?: string
  context?: Record<string, unknown>
}

export type ImagingResult =
  | { enabled: false; reason: string }
  | { enabled: true; findings: unknown; impression?: string }

export async function analyzeImaging(
  fetchFn: typeof fetch,
  config: ImagingConfig,
  request: ImagingRequest,
): Promise<ImagingResult> {
  if (!config.enabled) return { enabled: false, reason: "影像分析未启用（接口已保留，可在 .opencode/acuflow/imaging.json 中开启）。" }
  if (!config.endpoint) return { enabled: false, reason: "未配置影像模型端点（endpoint）。" }
  try {
    const response = await fetchFn(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        provider: config.provider,
        image: request.image,
        modality: request.modality,
        node: request.node,
        context: request.context ?? {},
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    if (!response.ok) return { enabled: false, reason: `影像端点返回 ${response.status}` }
    const data = (await response.json()) as Record<string, unknown>
    return {
      enabled: true,
      findings: data.findings ?? data,
      impression: typeof data.impression === "string" ? data.impression : undefined,
    }
  } catch (error) {
    return { enabled: false, reason: `影像分析请求失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

export function loadImagingConfig(config: Config.Interface) {
  return Effect.gen(function* () {
    const dirs = yield* config.directories()
    for (const dir of dirs) {
      const file = path.join(dir, "acuflow", "imaging.json")
      const exists = yield* Effect.promise(() => Bun.file(file).exists())
      if (!exists) continue
      const parsed = yield* Effect.promise(() => Bun.file(file).json()).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const value = parseImagingConfig(parsed)
      if (value) return value
    }
    return DEFAULT_IMAGING
  })
}

function allow(ctx: Tool.Context, permission: string) {
  return ctx.ask({ permission, patterns: ["*"], always: ["*"], metadata: {} })
}

function ok(title: string, data: unknown) {
  return { title, output: JSON.stringify(data, null, 2), metadata: {} as Record<string, unknown> }
}

export const ImagingAnalyzeTool = Tool.define(
  "imaging_analyze",
  Effect.gen(function* () {
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    const config = yield* Config.Service
    return {
      description:
        "分析医学影像并返回结构化所见。默认不启用：需在项目 .opencode/acuflow/imaging.json 中设置 enabled=true 并配置 endpoint。未启用时仅返回提示，不进行外部调用。",
      parameters: Schema.Struct({
        image: Schema.String.annotate({ description: "影像引用：本地文件路径或 URL" }),
        modality: Schema.optional(Schema.String.annotate({ description: "模态，如 CT/MRI/US" })),
        note: Schema.optional(Schema.String.annotate({ description: "补充上下文，如临床问题" })),
      }),
      execute: (params: { image: string; modality?: string; note?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* allow(ctx, "imaging_analyze")
          const imaging = yield* loadImagingConfig(config)
          const episode = yield* store.getEpisodeBySession(ctx.sessionID)
          const result = yield* Effect.promise(() =>
            analyzeImaging(fetch, imaging, {
              image: params.image,
              modality: params.modality,
              node: episode?.currentNode ?? undefined,
              context: params.note ? { note: params.note } : undefined,
            }),
          )
          if (!result.enabled) return ok("影像分析未启用", { enabled: false, reason: result.reason })
          if (episode) {
            yield* flow.record({
              episodeID: episode.id,
              kind: "imaging",
              label: "影像分析",
              source: imaging.provider,
              payload: { image: params.image, findings: result.findings, impression: result.impression ?? null },
            })
          }
          return ok("影像分析完成", { enabled: true, findings: result.findings, impression: result.impression ?? null })
        }).pipe(Effect.orDie),
    }
  }),
)
