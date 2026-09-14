export * as MedicalStore from "./store"

import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { Schema } from "effect"
import { Medical } from "@opencode-ai/schema/medical"
import type { SessionID } from "@opencode-ai/schema/session-id"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import {
  AuditLogTable,
  ClinicalDataTable,
  EpisodeNodeTable,
  EpisodeTable,
  MedCalcLogTable,
  NodeRevisionTable,
  PatientTable,
} from "./sql"

export type PatientID = Medical.PatientID
export type EpisodeID = Medical.EpisodeID
export type EpisodeNodeID = Medical.EpisodeNodeID
export type NodeKey = Medical.NodeKey
export type NodeStatus = Medical.NodeStatus
export type Actor = Medical.Actor
export type NodeOutput = Medical.NodeOutput
export type ClinicalData = Medical.ClinicalData

export const Patient = Medical.Patient
export const Episode = Medical.Episode
export const EpisodeNode = Medical.EpisodeNode
export const NodeRevision = Medical.NodeRevision
export const AuditLog = Medical.AuditLog
export const MedCalcLog = Medical.MedCalcLog

export type CreatePatientInput = {
  name: string
  sex?: string
  birthDate?: string
  weightKg?: number
  heightCm?: number
  allergies?: readonly string[]
  comorbidities?: readonly string[]
  baseline?: Record<string, unknown>
}

export type UpdatePatientInput = Partial<CreatePatientInput>

export type CreateEpisodeInput = {
  patientID: Medical.PatientID
  sessionID: SessionID
  title?: string
  flow?: Medical.Flow
}

export type CreateNodeInput = {
  episodeID: Medical.EpisodeID
  nodeKey: Medical.NodeKey
  seq: number
  status?: Medical.NodeStatus
}

export type UpdateNodeInput = {
  status?: Medical.NodeStatus
  revision?: number
  missing?: string[]
  unavailable?: string[]
  outputAgent?: Medical.NodeOutput | null
  outputFinal?: Medical.NodeOutput | null
  outputDiff?: string | null
  editedBy?: Medical.Actor | null
  confirmedBy?: string | null
  confirmedAt?: number | null
  rejectReason?: string | null
  stale?: boolean
  timeStarted?: number | null
  timeEnded?: number | null
}

export type AppendRevisionInput = {
  nodeID: Medical.EpisodeNodeID
  revision: number
  output?: Medical.NodeOutput | null
  actor: Medical.Actor
  action: Medical.NodeRevisionAction
  reason?: string
}

export type RecordClinicalInput = {
  episodeID: Medical.EpisodeID
  nodeID?: Medical.EpisodeNodeID
  kind: Medical.ClinicalKind
  label: string
  collectedAt?: number
  source?: string
  version?: string
  status?: Medical.ClinicalStatus
  negative?: boolean
  payload?: Record<string, unknown>
  changed?: boolean
}

export type AppendAuditInput = {
  episodeID: Medical.EpisodeID
  nodeID?: Medical.EpisodeNodeID
  actor: Medical.Actor
  action: string
  target?: string
  detail?: Record<string, unknown>
}

export type RecordMedCalcInput = {
  episodeID: Medical.EpisodeID
  nodeID?: Medical.EpisodeNodeID
  calc: string
  input: Record<string, unknown>
  output: Record<string, unknown>
}

export interface Interface {
  readonly createPatient: (input: CreatePatientInput) => Effect.Effect<Medical.Patient>
  readonly getPatient: (id: Medical.PatientID) => Effect.Effect<Medical.Patient | undefined>
  readonly listPatients: () => Effect.Effect<ReadonlyArray<Medical.Patient>>
  readonly updatePatient: (id: Medical.PatientID, input: UpdatePatientInput) => Effect.Effect<Medical.Patient | undefined>

  readonly createEpisode: (input: CreateEpisodeInput) => Effect.Effect<Medical.Episode>
  readonly getEpisode: (id: Medical.EpisodeID) => Effect.Effect<Medical.Episode | undefined>
  readonly getEpisodeBySession: (sessionID: SessionID) => Effect.Effect<Medical.Episode | undefined>
  readonly getEpisodeFlow: (id: Medical.EpisodeID) => Effect.Effect<Medical.Flow | undefined>
  readonly setEpisodeFlow: (id: Medical.EpisodeID, flow: Medical.Flow) => Effect.Effect<void>
  readonly setEpisodeNode: (id: Medical.EpisodeID, node: Medical.NodeKey | null) => Effect.Effect<void>
  readonly setEpisodeStatus: (id: Medical.EpisodeID, status: Medical.EpisodeStatus) => Effect.Effect<void>

  readonly createNode: (input: CreateNodeInput) => Effect.Effect<Medical.EpisodeNode>
  readonly getNode: (episodeID: Medical.EpisodeID, nodeKey: Medical.NodeKey) => Effect.Effect<Medical.EpisodeNode | undefined>
  readonly getNodeByID: (id: Medical.EpisodeNodeID) => Effect.Effect<Medical.EpisodeNode | undefined>
  readonly listNodes: (episodeID: Medical.EpisodeID) => Effect.Effect<ReadonlyArray<Medical.EpisodeNode>>
  readonly updateNode: (id: Medical.EpisodeNodeID, input: UpdateNodeInput) => Effect.Effect<void>
  readonly replaceNode: (
    node: Medical.EpisodeNode,
    input: UpdateNodeInput,
  ) => Effect.Effect<Medical.EpisodeNode>

  readonly appendRevision: (input: AppendRevisionInput) => Effect.Effect<void>
  readonly listRevisions: (nodeID: Medical.EpisodeNodeID) => Effect.Effect<ReadonlyArray<Medical.NodeRevision>>

  readonly recordClinical: (input: RecordClinicalInput) => Effect.Effect<Medical.ClinicalData>
  readonly queryClinical: (input: {
    episodeID: Medical.EpisodeID
    kind?: Medical.ClinicalKind
    nodeID?: Medical.EpisodeNodeID
  }) => Effect.Effect<ReadonlyArray<Medical.ClinicalData>>

  readonly recordMedCalc: (input: RecordMedCalcInput) => Effect.Effect<Medical.MedCalcLog>

  readonly appendAudit: (input: AppendAuditInput) => Effect.Effect<void>
  readonly listAudit: (episodeID: Medical.EpisodeID) => Effect.Effect<ReadonlyArray<Medical.AuditLog>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MedicalStore") {}

function patientFromRow(row: typeof PatientTable.$inferSelect): Medical.Patient {
  return Medical.Patient.make({
    id: row.id,
    name: row.name,
    sex: row.sex,
    birthDate: row.birth_date,
    weightKg: row.weight_kg,
    heightCm: row.height_cm,
    allergies: row.allergies,
    comorbidities: row.comorbidities,
    baseline: row.baseline as Record<string, Schema.Json>,
    time: { created: row.time_created, updated: row.time_updated },
  })
}

function episodeFromRow(row: typeof EpisodeTable.$inferSelect): Medical.Episode {
  return Medical.Episode.make({
    id: row.id,
    patientID: row.patient_id,
    sessionID: row.session_id,
    title: row.title,
    status: row.status,
    currentNode: row.current_node,
    time: {
      opened: row.time_opened,
      closed: row.time_closed,
      created: row.time_created,
      updated: row.time_updated,
    },
  })
}

function nodeFromRow(row: typeof EpisodeNodeTable.$inferSelect): Medical.EpisodeNode {
  return Medical.EpisodeNode.make({
    id: row.id,
    episodeID: row.episode_id,
    nodeKey: row.node_key,
    seq: row.seq,
    status: row.status,
    revision: row.revision,
    missing: row.missing,
    unavailable: row.unavailable,
    outputAgent: row.output_agent,
    outputFinal: row.output_final,
    outputDiff: row.output_diff,
    editedBy: row.edited_by,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    rejectReason: row.reject_reason,
    stale: row.stale,
    time: {
      started: row.time_started,
      ended: row.time_ended,
      created: row.time_created,
      updated: row.time_updated,
    },
  })
}

function clinicalFromRow(row: typeof ClinicalDataTable.$inferSelect): Medical.ClinicalData {
  return Medical.ClinicalData.make({
    id: row.id,
    episodeID: row.episode_id,
    nodeID: row.node_id,
    kind: row.kind,
    label: row.label,
    collectedAt: row.collected_at,
    source: row.source,
    version: row.version,
    status: row.status,
    negative: row.is_negative,
    payload: (row.payload ?? {}) as Record<string, Schema.Json>,
    changed: row.changed,
    time: { created: row.time_created, updated: row.time_updated },
  })
}

function auditFromRow(row: typeof AuditLogTable.$inferSelect): Medical.AuditLog {
  return Medical.AuditLog.make({
    id: row.id,
    episodeID: row.episode_id,
    nodeID: row.node_id,
    actor: row.actor,
    action: row.action,
    target: row.target,
    detail: (row.detail ?? {}) as Record<string, Schema.Json>,
    time: { created: row.time_created },
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const createPatient = Effect.fn("MedicalStore.createPatient")(function* (input: CreatePatientInput) {
      const row = yield* db
        .insert(PatientTable)
        .values({
          id: Medical.PatientID.create(),
          name: input.name,
          sex: input.sex ?? null,
          birth_date: input.birthDate ?? null,
          weight_kg: input.weightKg ?? null,
          height_cm: input.heightCm ?? null,
          allergies: [...(input.allergies ?? [])],
          comorbidities: [...(input.comorbidities ?? [])],
          baseline: input.baseline ?? {},
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return patientFromRow(row)
    })

    const getPatient = Effect.fn("MedicalStore.getPatient")(function* (id: Medical.PatientID) {
      const row = yield* db.select().from(PatientTable).where(eq(PatientTable.id, id)).get().pipe(Effect.orDie)
      return row ? patientFromRow(row) : undefined
    })

    const listPatients = Effect.fn("MedicalStore.listPatients")(function* () {
      const rows = yield* db.select().from(PatientTable).orderBy(desc(PatientTable.time_created)).all().pipe(Effect.orDie)
      return rows.map(patientFromRow)
    })

    const updatePatient = Effect.fn("MedicalStore.updatePatient")(function* (
      id: Medical.PatientID,
      input: UpdatePatientInput,
    ) {
      const set: Partial<typeof PatientTable.$inferInsert> = {}
      if (input.name !== undefined) set.name = input.name
      if (input.sex !== undefined) set.sex = input.sex
      if (input.birthDate !== undefined) set.birth_date = input.birthDate
      if (input.weightKg !== undefined) set.weight_kg = input.weightKg
      if (input.heightCm !== undefined) set.height_cm = input.heightCm
      if (input.allergies !== undefined) set.allergies = [...input.allergies]
      if (input.comorbidities !== undefined) set.comorbidities = [...input.comorbidities]
      if (input.baseline !== undefined) set.baseline = input.baseline
      const row = yield* db.update(PatientTable).set(set).where(eq(PatientTable.id, id)).returning().get().pipe(Effect.orDie)
      return row ? patientFromRow(row) : undefined
    })

    const createEpisode = Effect.fn("MedicalStore.createEpisode")(function* (input: CreateEpisodeInput) {
      const row = yield* db
        .insert(EpisodeTable)
        .values({
          id: Medical.EpisodeID.create(),
          patient_id: input.patientID,
          session_id: input.sessionID,
          title: input.title ?? "",
          status: "active",
          flow: input.flow ?? null,
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return episodeFromRow(row)
    })

    const getEpisode = Effect.fn("MedicalStore.getEpisode")(function* (id: Medical.EpisodeID) {
      const row = yield* db.select().from(EpisodeTable).where(eq(EpisodeTable.id, id)).get().pipe(Effect.orDie)
      return row ? episodeFromRow(row) : undefined
    })

    const getEpisodeBySession = Effect.fn("MedicalStore.getEpisodeBySession")(function* (sessionID: SessionID) {
      const row = yield* db.select().from(EpisodeTable).where(eq(EpisodeTable.session_id, sessionID)).get().pipe(Effect.orDie)
      return row ? episodeFromRow(row) : undefined
    })

    const getEpisodeFlow = Effect.fn("MedicalStore.getEpisodeFlow")(function* (id: Medical.EpisodeID) {
      const row = yield* db
        .select({ flow: EpisodeTable.flow })
        .from(EpisodeTable)
        .where(eq(EpisodeTable.id, id))
        .get()
        .pipe(Effect.orDie)
      return row?.flow ?? undefined
    })

    const setEpisodeFlow = Effect.fn("MedicalStore.setEpisodeFlow")(function* (id: Medical.EpisodeID, flow: Medical.Flow) {
      yield* db.update(EpisodeTable).set({ flow }).where(eq(EpisodeTable.id, id)).run().pipe(Effect.orDie)
    })

    const setEpisodeNode = Effect.fn("MedicalStore.setEpisodeNode")(function* (
      id: Medical.EpisodeID,
      node: Medical.NodeKey | null,
    ) {
      yield* db.update(EpisodeTable).set({ current_node: node }).where(eq(EpisodeTable.id, id)).run().pipe(Effect.orDie)
    })

    const setEpisodeStatus = Effect.fn("MedicalStore.setEpisodeStatus")(function* (
      id: Medical.EpisodeID,
      status: Medical.EpisodeStatus,
    ) {
      yield* db
        .update(EpisodeTable)
        .set({ status, time_closed: status === "closed" ? Date.now() : null })
        .where(eq(EpisodeTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    const createNode = Effect.fn("MedicalStore.createNode")(function* (input: CreateNodeInput) {
      const row = yield* db
        .insert(EpisodeNodeTable)
        .values({
          id: Medical.EpisodeNodeID.create(),
          episode_id: input.episodeID,
          node_key: input.nodeKey,
          seq: input.seq,
          status: input.status ?? "gathering",
          time_started: Date.now(),
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return nodeFromRow(row)
    })

    const getNode = Effect.fn("MedicalStore.getNode")(function* (
      episodeID: Medical.EpisodeID,
      nodeKey: Medical.NodeKey,
    ) {
      const row = yield* db
        .select()
        .from(EpisodeNodeTable)
        .where(and(eq(EpisodeNodeTable.episode_id, episodeID), eq(EpisodeNodeTable.node_key, nodeKey)))
        .get()
        .pipe(Effect.orDie)
      return row ? nodeFromRow(row) : undefined
    })

    const getNodeByID = Effect.fn("MedicalStore.getNodeByID")(function* (id: Medical.EpisodeNodeID) {
      const row = yield* db.select().from(EpisodeNodeTable).where(eq(EpisodeNodeTable.id, id)).get().pipe(Effect.orDie)
      return row ? nodeFromRow(row) : undefined
    })

    const listNodes = Effect.fn("MedicalStore.listNodes")(function* (episodeID: Medical.EpisodeID) {
      const rows = yield* db
        .select()
        .from(EpisodeNodeTable)
        .where(eq(EpisodeNodeTable.episode_id, episodeID))
        .orderBy(EpisodeNodeTable.seq)
        .all()
        .pipe(Effect.orDie)
      return rows.map(nodeFromRow)
    })

    function nodeSet(input: UpdateNodeInput): Partial<typeof EpisodeNodeTable.$inferInsert> {
      const set: Partial<typeof EpisodeNodeTable.$inferInsert> = {}
      if (input.status !== undefined) set.status = input.status
      if (input.revision !== undefined) set.revision = input.revision
      if (input.missing !== undefined) set.missing = input.missing
      if (input.unavailable !== undefined) set.unavailable = input.unavailable
      if (input.outputAgent !== undefined) set.output_agent = input.outputAgent
      if (input.outputFinal !== undefined) set.output_final = input.outputFinal
      if (input.outputDiff !== undefined) set.output_diff = input.outputDiff
      if (input.editedBy !== undefined) set.edited_by = input.editedBy
      if (input.confirmedBy !== undefined) set.confirmed_by = input.confirmedBy
      if (input.confirmedAt !== undefined) set.confirmed_at = input.confirmedAt
      if (input.rejectReason !== undefined) set.reject_reason = input.rejectReason
      if (input.stale !== undefined) set.stale = input.stale
      if (input.timeStarted !== undefined) set.time_started = input.timeStarted
      if (input.timeEnded !== undefined) set.time_ended = input.timeEnded
      return set
    }

    const updateNode = Effect.fn("MedicalStore.updateNode")(function* (id: Medical.EpisodeNodeID, input: UpdateNodeInput) {
      yield* db.update(EpisodeNodeTable).set(nodeSet(input)).where(eq(EpisodeNodeTable.id, id)).run().pipe(Effect.orDie)
    })

    const replaceNode = Effect.fn("MedicalStore.replaceNode")(function* (
      node: Medical.EpisodeNode,
      input: UpdateNodeInput,
    ) {
      yield* updateNode(node.id, input)
      const next = yield* getNodeByID(node.id)
      return next ?? node
    })

    const appendRevision = Effect.fn("MedicalStore.appendRevision")(function* (input: AppendRevisionInput) {
      yield* db
        .insert(NodeRevisionTable)
        .values({
          id: Medical.NodeRevisionID.create(),
          node_id: input.nodeID,
          revision: input.revision,
          output: input.output ?? null,
          actor: input.actor,
          action: input.action,
          reason: input.reason ?? null,
        })
        .run()
        .pipe(Effect.orDie)
    })

    const listRevisions = Effect.fn("MedicalStore.listRevisions")(function* (nodeID: Medical.EpisodeNodeID) {
      const rows = yield* db
        .select()
        .from(NodeRevisionTable)
        .where(eq(NodeRevisionTable.node_id, nodeID))
        .orderBy(NodeRevisionTable.revision)
        .all()
        .pipe(Effect.orDie)
      return rows.map((row): Medical.NodeRevision => ({
        id: row.id,
        nodeID: row.node_id,
        revision: row.revision,
        output: row.output,
        actor: row.actor,
        action: row.action,
        reason: row.reason,
        time: { created: row.time_created },
      }))
    })

    const recordClinical = Effect.fn("MedicalStore.recordClinical")(function* (input: RecordClinicalInput) {
      const row = yield* db
        .insert(ClinicalDataTable)
        .values({
          id: Medical.ClinicalDataID.create(),
          episode_id: input.episodeID,
          node_id: input.nodeID ?? null,
          kind: input.kind,
          label: input.label,
          collected_at: input.collectedAt ?? Date.now(),
          source: input.source ?? null,
          version: input.version ?? null,
          status: input.status ?? "captured",
          is_negative: input.negative ?? false,
          payload: input.payload ?? {},
          changed: input.changed ?? false,
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return clinicalFromRow(row)
    })

    const queryClinical = Effect.fn("MedicalStore.queryClinical")(function* (input: {
      episodeID: Medical.EpisodeID
      kind?: Medical.ClinicalKind
      nodeID?: Medical.EpisodeNodeID
    }) {
      const filters = [eq(ClinicalDataTable.episode_id, input.episodeID)]
      if (input.kind) filters.push(eq(ClinicalDataTable.kind, input.kind))
      if (input.nodeID) filters.push(eq(ClinicalDataTable.node_id, input.nodeID))
      const rows = yield* db
        .select()
        .from(ClinicalDataTable)
        .where(and(...filters))
        .orderBy(ClinicalDataTable.time_created)
        .all()
        .pipe(Effect.orDie)
      return rows.map(clinicalFromRow)
    })

    const recordMedCalc = Effect.fn("MedicalStore.recordMedCalc")(function* (input: RecordMedCalcInput) {
      const row = yield* db
        .insert(MedCalcLogTable)
        .values({
          id: Medical.MedCalcLogID.create(),
          episode_id: input.episodeID,
          node_id: input.nodeID ?? null,
          calc: input.calc,
          input: input.input,
          output: input.output,
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return Medical.MedCalcLog.make({
        id: row.id,
        episodeID: row.episode_id,
        nodeID: row.node_id,
        calc: row.calc,
        input: (row.input ?? {}) as Record<string, Schema.Json>,
        output: (row.output ?? {}) as Record<string, Schema.Json>,
        time: { created: row.time_created },
      })
    })

    const appendAudit = Effect.fn("MedicalStore.appendAudit")(function* (input: AppendAuditInput) {
      yield* db
        .insert(AuditLogTable)
        .values({
          id: Medical.AuditLogID.create(),
          episode_id: input.episodeID,
          node_id: input.nodeID ?? null,
          actor: input.actor,
          action: input.action,
          target: input.target ?? null,
          detail: input.detail ?? {},
        })
        .run()
        .pipe(Effect.orDie)
    })

    const listAudit = Effect.fn("MedicalStore.listAudit")(function* (episodeID: Medical.EpisodeID) {
      const rows = yield* db
        .select()
        .from(AuditLogTable)
        .where(eq(AuditLogTable.episode_id, episodeID))
        .orderBy(AuditLogTable.time_created)
        .all()
        .pipe(Effect.orDie)
      return rows.map(auditFromRow)
    })

    return Service.of({
      createPatient,
      getPatient,
      listPatients,
      updatePatient,
      createEpisode,
      getEpisode,
      getEpisodeBySession,
      getEpisodeFlow,
      setEpisodeFlow,
      setEpisodeNode,
      setEpisodeStatus,
      createNode,
      getNode,
      getNodeByID,
      listNodes,
      updateNode,
      replaceNode,
      appendRevision,
      listRevisions,
      recordClinical,
      queryClinical,
      recordMedCalc,
      appendAudit,
      listAudit,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
