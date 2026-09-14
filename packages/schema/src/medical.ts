export * as Medical from "./medical"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { statics } from "./schema"
import { SessionID } from "./session-id"

export const PatientID = Schema.String.check(Schema.isStartsWith("pat_")).pipe(
  Schema.brand("Medical.PatientID"),
  statics((schema) => ({ create: () => schema.make("pat_" + ascending()) })),
)
export type PatientID = typeof PatientID.Type

export const EpisodeID = Schema.String.check(Schema.isStartsWith("epi_")).pipe(
  Schema.brand("Medical.EpisodeID"),
  statics((schema) => ({ create: () => schema.make("epi_" + ascending()) })),
)
export type EpisodeID = typeof EpisodeID.Type

export const EpisodeNodeID = Schema.String.check(Schema.isStartsWith("epn_")).pipe(
  Schema.brand("Medical.EpisodeNodeID"),
  statics((schema) => ({ create: () => schema.make("epn_" + ascending()) })),
)
export type EpisodeNodeID = typeof EpisodeNodeID.Type

export const NodeRevisionID = Schema.String.check(Schema.isStartsWith("nrv_")).pipe(
  Schema.brand("Medical.NodeRevisionID"),
  statics((schema) => ({ create: () => schema.make("nrv_" + ascending()) })),
)
export type NodeRevisionID = typeof NodeRevisionID.Type

export const ClinicalDataID = Schema.String.check(Schema.isStartsWith("cld_")).pipe(
  Schema.brand("Medical.ClinicalDataID"),
  statics((schema) => ({ create: () => schema.make("cld_" + ascending()) })),
)
export type ClinicalDataID = typeof ClinicalDataID.Type

export const MedCalcLogID = Schema.String.check(Schema.isStartsWith("mcl_")).pipe(
  Schema.brand("Medical.MedCalcLogID"),
  statics((schema) => ({ create: () => schema.make("mcl_" + ascending()) })),
)
export type MedCalcLogID = typeof MedCalcLogID.Type

export const AuditLogID = Schema.String.check(Schema.isStartsWith("aud_")).pipe(
  Schema.brand("Medical.AuditLogID"),
  statics((schema) => ({ create: () => schema.make("aud_" + ascending()) })),
)
export type AuditLogID = typeof AuditLogID.Type

export const NodeKey = Schema.Literals([
  "triage",
  "history_exam",
  "labs",
  "imaging_consult",
  "treatment_observation",
  "disposition",
])
export type NodeKey = typeof NodeKey.Type

export const NodeStatus = Schema.Literals([
  "pending",
  "gathering",
  "ready_for_review",
  "confirmed",
  "completed",
  "stale",
  "skipped",
])
export type NodeStatus = typeof NodeStatus.Type

export const EpisodeStatus = Schema.Literals(["active", "closed"])
export type EpisodeStatus = typeof EpisodeStatus.Type

export const Actor = Schema.Literals(["agent", "doctor", "system"])
export type Actor = typeof Actor.Type

export const ClinicalKind = Schema.Literals(["vital", "lab", "imaging", "medication", "note", "consult", "history"])
export type ClinicalKind = typeof ClinicalKind.Type

export const ClinicalStatus = Schema.Literals(["captured", "unavailable"])
export type ClinicalStatus = typeof ClinicalStatus.Type

export const NodeRevisionAction = Schema.Literals(["draft", "confirm", "edit", "reject", "amend", "stale"])
export type NodeRevisionAction = typeof NodeRevisionAction.Type

export const Time = Schema.Struct({
  created: Schema.Finite,
  updated: Schema.Finite,
})
export interface Time extends Schema.Schema.Type<typeof Time> {}

export const NodeOutput = Schema.Struct({
  fields: Schema.Record(Schema.String, Schema.Json),
  summary: Schema.String,
}).annotate({ identifier: "Medical.NodeOutput" })
export interface NodeOutput extends Schema.Schema.Type<typeof NodeOutput> {}

export const FlowNode = Schema.Struct({
  key: NodeKey,
  seq: Schema.Int,
  title: Schema.String,
  entryAgent: Schema.optional(Schema.String),
  requiredInputs: Schema.Array(Schema.String),
  synonyms: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
}).annotate({ identifier: "Medical.FlowNode" })
export interface FlowNode extends Schema.Schema.Type<typeof FlowNode> {}

export const Flow = Schema.Array(FlowNode)
export type Flow = typeof Flow.Type

export const Patient = Schema.Struct({
  id: PatientID,
  name: Schema.String,
  sex: Schema.NullOr(Schema.String),
  birthDate: Schema.NullOr(Schema.String),
  weightKg: Schema.NullOr(Schema.Finite),
  heightCm: Schema.NullOr(Schema.Finite),
  allergies: Schema.Array(Schema.String),
  comorbidities: Schema.Array(Schema.String),
  baseline: Schema.Record(Schema.String, Schema.Json),
  time: Time,
}).annotate({ identifier: "Medical.Patient" })
export interface Patient extends Schema.Schema.Type<typeof Patient> {}

export const Episode = Schema.Struct({
  id: EpisodeID,
  patientID: PatientID,
  sessionID: SessionID,
  title: Schema.String,
  status: EpisodeStatus,
  currentNode: Schema.NullOr(NodeKey),
  time: Schema.Struct({
    opened: Schema.Finite,
    closed: Schema.NullOr(Schema.Finite),
    created: Schema.Finite,
    updated: Schema.Finite,
  }),
}).annotate({ identifier: "Medical.Episode" })
export interface Episode extends Schema.Schema.Type<typeof Episode> {}

export const EpisodeNode = Schema.Struct({
  id: EpisodeNodeID,
  episodeID: EpisodeID,
  nodeKey: NodeKey,
  seq: Schema.Int,
  status: NodeStatus,
  revision: Schema.Int,
  missing: Schema.Array(Schema.String),
  unavailable: Schema.Array(Schema.String),
  outputAgent: Schema.NullOr(NodeOutput),
  outputFinal: Schema.NullOr(NodeOutput),
  outputDiff: Schema.NullOr(Schema.String),
  editedBy: Schema.NullOr(Actor),
  confirmedBy: Schema.NullOr(Schema.String),
  confirmedAt: Schema.NullOr(Schema.Finite),
  rejectReason: Schema.NullOr(Schema.String),
  stale: Schema.Boolean,
  time: Schema.Struct({
    started: Schema.NullOr(Schema.Finite),
    ended: Schema.NullOr(Schema.Finite),
    created: Schema.Finite,
    updated: Schema.Finite,
  }),
}).annotate({ identifier: "Medical.EpisodeNode" })
export interface EpisodeNode extends Schema.Schema.Type<typeof EpisodeNode> {}

export const NodeRevision = Schema.Struct({
  id: NodeRevisionID,
  nodeID: EpisodeNodeID,
  revision: Schema.Int,
  output: Schema.NullOr(NodeOutput),
  actor: Actor,
  action: NodeRevisionAction,
  reason: Schema.NullOr(Schema.String),
  time: Schema.Struct({ created: Schema.Finite }),
}).annotate({ identifier: "Medical.NodeRevision" })
export interface NodeRevision extends Schema.Schema.Type<typeof NodeRevision> {}

export const ClinicalData = Schema.Struct({
  id: ClinicalDataID,
  episodeID: EpisodeID,
  nodeID: Schema.NullOr(EpisodeNodeID),
  kind: ClinicalKind,
  label: Schema.String,
  collectedAt: Schema.Finite,
  source: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  status: ClinicalStatus,
  negative: Schema.Boolean,
  payload: Schema.Record(Schema.String, Schema.Json),
  changed: Schema.Boolean,
  time: Time,
}).annotate({ identifier: "Medical.ClinicalData" })
export interface ClinicalData extends Schema.Schema.Type<typeof ClinicalData> {}

export const MedCalcLog = Schema.Struct({
  id: MedCalcLogID,
  episodeID: EpisodeID,
  nodeID: Schema.NullOr(EpisodeNodeID),
  calc: Schema.String,
  input: Schema.Record(Schema.String, Schema.Json),
  output: Schema.Record(Schema.String, Schema.Json),
  time: Schema.Struct({ created: Schema.Finite }),
}).annotate({ identifier: "Medical.MedCalcLog" })
export interface MedCalcLog extends Schema.Schema.Type<typeof MedCalcLog> {}

export const AuditLog = Schema.Struct({
  id: AuditLogID,
  episodeID: EpisodeID,
  nodeID: Schema.NullOr(EpisodeNodeID),
  actor: Actor,
  action: Schema.String,
  target: Schema.NullOr(Schema.String),
  detail: Schema.Record(Schema.String, Schema.Json),
  time: Schema.Struct({ created: Schema.Finite }),
}).annotate({ identifier: "Medical.AuditLog" })
export interface AuditLog extends Schema.Schema.Type<typeof AuditLog> {}
