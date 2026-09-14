import { Database } from "@opencode-ai/core/database/database"
import { MedicalFlow } from "@opencode-ai/core/medical/flow"
import { MedicalStore } from "@opencode-ai/core/medical/store"
import { EpisodeNodeTable, EpisodeTable, PatientTable, AuditLogTable, ClinicalDataTable, NodeRevisionTable } from "@opencode-ai/core/medical/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Medical } from "@opencode-ai/schema/medical"
import { SessionPrompt } from "@/session/prompt"
import { InstanceRef } from "@/effect/instance-ref"
import { desc, eq } from "drizzle-orm"
import { Cause, Effect, Schema, Scope } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

const CONTINUE_TEXT: Record<"confirm" | "edit" | "reject", string> = {
  confirm: "已确认本节点结论，请继续当前节点。",
  edit: "已修改并确认本节点结论，请继续当前节点。",
  reject: "本节点草案已被驳回，请与我确认需要补充或修改的内容后再提交。",
}

function ageFrom(birthDate: string | null): number | null {
  if (!birthDate) return null
  const date = new Date(birthDate)
  if (Number.isNaN(date.getTime())) return null
  return Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000))
}

function outputFrom(fields: Record<string, unknown> | undefined, summary: string) {
  return { fields: (fields ?? {}) as Record<string, Schema.Json>, summary }
}

export const medicalHandlers = HttpApiBuilder.group(InstanceHttpApi, "medical", (handlers) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const store = yield* MedicalStore.Service
    const flow = yield* MedicalFlow.Service
    const promptSvc = yield* SessionPrompt.Service
    const scope = yield* Scope.Scope

    const episodeRow = (sessionID: string) =>
      db
        .select()
        .from(EpisodeTable)
        .where(eq(EpisodeTable.session_id, SessionSchema.ID.make(sessionID)))
        .get()
        .pipe(Effect.orDie)

    const reload = (episodeID: Medical.EpisodeID) =>
      db.select().from(EpisodeTable).where(eq(EpisodeTable.id, episodeID)).get().pipe(Effect.orDie)

    // 复核/回溯后自动触发一次会话，让 agent 针对新的当前节点继续工作。
    const continueSession = (sessionID: string, text: string) =>
      Effect.gen(function* () {
        const instance = yield* InstanceRef
        const session = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, SessionSchema.ID.make(sessionID)))
          .get()
          .pipe(Effect.orDie)
        const model = session?.model
        yield* promptSvc
          .prompt({
            sessionID: SessionSchema.ID.make(sessionID),
            agent: session?.agent ?? undefined,
            model: model
              ? { providerID: ProviderV2.ID.make(model.providerID), modelID: ModelV2.ID.make(model.id) }
              : undefined,
            parts: [{ type: "text", text }],
          })
          .pipe(
            Effect.provideService(InstanceRef, instance),
            Effect.catchCause((cause) =>
              Effect.logError("medical.review continue failed", { cause: Cause.pretty(cause) }),
            ),
            Effect.forkIn(scope, { startImmediately: true }),
          )
      })

    const buildView = (episode: typeof EpisodeTable.$inferSelect) =>
      Effect.gen(function* () {
        const patient = yield* db
          .select()
          .from(PatientTable)
          .where(eq(PatientTable.id, episode.patient_id))
          .get()
          .pipe(Effect.orDie)

        const rows = yield* db
          .select()
          .from(EpisodeNodeTable)
          .where(eq(EpisodeNodeTable.episode_id, episode.id))
          .all()
          .pipe(Effect.orDie)
        const byKey = new Map(rows.map((node) => [node.node_key as string, node]))
        const definitions =
          Array.isArray(episode.flow) && episode.flow.length > 0 ? episode.flow : MedicalFlow.defaultNodes

        const nodes = [...definitions]
          .sort((a, b) => a.seq - b.seq)
          .map((definition) => {
            const node = byKey.get(definition.key)
            if (!node) {
              return {
                key: definition.key,
                title: definition.title,
                seq: definition.seq,
                status: "pending",
                stale: false,
                missing: [] as string[],
                draft: null,
                final: null,
              }
            }
            return {
              key: node.node_key,
              title: definition.title,
              seq: node.seq,
              status: node.status,
              stale: node.stale,
              missing: node.missing ?? [],
              draft: node.output_agent?.summary ?? null,
              final: node.output_final?.summary ?? null,
            }
          })

        return {
          episode: {
            id: episode.id,
            title: episode.title,
            status: episode.status,
            currentNode: episode.current_node ?? null,
          },
          patient: {
            name: patient?.name ?? "匿名",
            sex: patient?.sex ?? null,
            age: ageFrom(patient?.birth_date ?? null),
            weightKg: patient?.weight_kg ?? null,
            allergies: patient?.allergies ?? [],
            comorbidities: patient?.comorbidities ?? [],
          },
          nodes,
        }
      })

    const view = Effect.fn("MedicalHttpApi.view")(function* (ctx: { query: { sessionID: string } }) {
      const episode = yield* episodeRow(ctx.query.sessionID)
      if (!episode) return null
      return yield* buildView(episode)
    })

    const review = Effect.fn("MedicalHttpApi.review")(function* (ctx: {
      payload: {
        sessionID: string
        decision: "confirm" | "edit" | "reject"
        summary?: string
        fields?: Record<string, unknown>
        reason?: string
      }
    }) {
      const episode = yield* episodeRow(ctx.payload.sessionID)
      if (!episode) return null
      yield* flow
        .review({
          episodeID: episode.id,
          decision: ctx.payload.decision,
          output: ctx.payload.decision === "edit" ? outputFrom(ctx.payload.fields, ctx.payload.summary ?? "") : undefined,
          reason: ctx.payload.reason,
        })
        .pipe(Effect.orDie)
      yield* continueSession(ctx.payload.sessionID, CONTINUE_TEXT[ctx.payload.decision])
      const row = yield* reload(episode.id)
      return row ? yield* buildView(row) : null
    })

    const amend = Effect.fn("MedicalHttpApi.amend")(function* (ctx: {
      payload: {
        sessionID: string
        nodeKey: string
        summary: string
        fields?: Record<string, unknown>
        reason?: string
      }
    }) {
      const episode = yield* episodeRow(ctx.payload.sessionID)
      if (!episode) return null
      const node = yield* store.getNode(episode.id, ctx.payload.nodeKey as Medical.NodeKey)
      if (!node) return null
      yield* flow
        .amend({
          nodeID: node.id,
          output: outputFrom(ctx.payload.fields, ctx.payload.summary),
          reason: ctx.payload.reason,
        })
        .pipe(Effect.orDie)
      yield* continueSession(ctx.payload.sessionID, `已回溯修改节点「${ctx.payload.nodeKey}」，请重新评估下游节点。`)
      const row = yield* reload(episode.id)
      return row ? yield* buildView(row) : null
    })

    const evidence = Effect.fn("MedicalHttpApi.evidence")(function* (ctx: { query: { sessionID: string } }) {
      const episode = yield* episodeRow(ctx.query.sessionID)
      if (!episode) return null
      const clinical = yield* db
        .select()
        .from(ClinicalDataTable)
        .where(eq(ClinicalDataTable.episode_id, episode.id))
        .orderBy(desc(ClinicalDataTable.time_created))
        .all()
        .pipe(Effect.orDie)
      const audit = yield* db
        .select()
        .from(AuditLogTable)
        .where(eq(AuditLogTable.episode_id, episode.id))
        .orderBy(desc(AuditLogTable.time_created))
        .all()
        .pipe(Effect.orDie)
      const revisions = yield* db
        .select({
          id: NodeRevisionTable.id,
          node: EpisodeNodeTable.node_key,
          revision: NodeRevisionTable.revision,
          actor: NodeRevisionTable.actor,
          action: NodeRevisionTable.action,
          reason: NodeRevisionTable.reason,
          time: NodeRevisionTable.time_created,
        })
        .from(NodeRevisionTable)
        .innerJoin(EpisodeNodeTable, eq(NodeRevisionTable.node_id, EpisodeNodeTable.id))
        .where(eq(EpisodeNodeTable.episode_id, episode.id))
        .orderBy(desc(NodeRevisionTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return {
        clinical: clinical.map((row) => ({
          id: row.id,
          kind: row.kind,
          label: row.label,
          status: row.status,
          source: row.source,
          collectedAt: row.collected_at,
          negative: row.is_negative,
          payload: (row.payload ?? {}) as Record<string, unknown>,
        })),
        audit: audit.map((row) => ({
          id: row.id,
          actor: row.actor,
          action: row.action,
          target: row.target,
          time: row.time_created,
        })),
        revisions: revisions.map((row) => ({
          id: row.id,
          node: row.node,
          revision: row.revision,
          actor: row.actor,
          action: row.action,
          reason: row.reason,
          time: row.time,
        })),
      }
    })

    return handlers.handle("view", view).handle("review", review).handle("amend", amend).handle("evidence", evidence)
  }),
)
