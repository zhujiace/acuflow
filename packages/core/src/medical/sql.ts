import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Medical } from "@opencode-ai/schema/medical"
import type { SessionID } from "@opencode-ai/schema/session-id"
import { Timestamps } from "../database/schema.sql"
import { SessionTable } from "../session/sql"

export const PatientTable = sqliteTable("patient", {
  id: text().$type<Medical.PatientID>().primaryKey(),
  name: text().notNull(),
  sex: text(),
  birth_date: text(),
  weight_kg: real(),
  height_cm: real(),
  allergies: text({ mode: "json" })
    .$type<string[]>()
    .notNull()
    .$default(() => []),
  comorbidities: text({ mode: "json" })
    .$type<string[]>()
    .notNull()
    .$default(() => []),
  baseline: text({ mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .$default(() => ({})),
  ...Timestamps,
})

export const EpisodeTable = sqliteTable(
  "episode",
  {
    id: text().$type<Medical.EpisodeID>().primaryKey(),
    patient_id: text()
      .$type<Medical.PatientID>()
      .notNull()
      .references(() => PatientTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    title: text().notNull().default(""),
    status: text().$type<Medical.EpisodeStatus>().notNull().default("active"),
    current_node: text().$type<Medical.NodeKey>(),
    flow: text({ mode: "json" }).$type<Medical.Flow>(),
    time_opened: integer()
      .notNull()
      .$default(() => Date.now()),
    time_closed: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("episode_session_idx").on(table.session_id),
    index("episode_patient_idx").on(table.patient_id),
  ],
)

export const EpisodeNodeTable = sqliteTable(
  "episode_node",
  {
    id: text().$type<Medical.EpisodeNodeID>().primaryKey(),
    episode_id: text()
      .$type<Medical.EpisodeID>()
      .notNull()
      .references(() => EpisodeTable.id, { onDelete: "cascade" }),
    node_key: text().$type<Medical.NodeKey>().notNull(),
    seq: integer().notNull(),
    status: text().$type<Medical.NodeStatus>().notNull(),
    revision: integer().notNull().default(1),
    missing: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .$default(() => []),
    unavailable: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .$default(() => []),
    output_agent: text({ mode: "json" }).$type<Medical.NodeOutput>(),
    output_final: text({ mode: "json" }).$type<Medical.NodeOutput>(),
    output_diff: text(),
    edited_by: text().$type<Medical.Actor>(),
    confirmed_by: text(),
    confirmed_at: integer(),
    reject_reason: text(),
    stale: integer({ mode: "boolean" }).notNull().default(false),
    time_started: integer(),
    time_ended: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("episode_node_episode_key_idx").on(table.episode_id, table.node_key),
    index("episode_node_episode_seq_idx").on(table.episode_id, table.seq),
  ],
)

export const NodeRevisionTable = sqliteTable(
  "node_revision",
  {
    id: text().$type<Medical.NodeRevisionID>().primaryKey(),
    node_id: text()
      .$type<Medical.EpisodeNodeID>()
      .notNull()
      .references(() => EpisodeNodeTable.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    output: text({ mode: "json" }).$type<Medical.NodeOutput>(),
    actor: text().$type<Medical.Actor>().notNull(),
    action: text().$type<Medical.NodeRevisionAction>().notNull(),
    reason: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("node_revision_node_idx").on(table.node_id, table.revision)],
)

export const ClinicalDataTable = sqliteTable(
  "clinical_data",
  {
    id: text().$type<Medical.ClinicalDataID>().primaryKey(),
    episode_id: text()
      .$type<Medical.EpisodeID>()
      .notNull()
      .references(() => EpisodeTable.id, { onDelete: "cascade" }),
    node_id: text().$type<Medical.EpisodeNodeID>(),
    kind: text().$type<Medical.ClinicalKind>().notNull(),
    label: text().notNull().default(""),
    collected_at: integer()
      .notNull()
      .$default(() => Date.now()),
    source: text(),
    version: text(),
    status: text().$type<Medical.ClinicalStatus>().notNull().default("captured"),
    is_negative: integer({ mode: "boolean" }).notNull().default(false),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>(),
    payload_previous: text({ mode: "json" }).$type<Record<string, unknown>>(),
    changed: integer({ mode: "boolean" }).notNull().default(false),
    ...Timestamps,
  },
  (table) => [index("clinical_data_episode_kind_idx").on(table.episode_id, table.kind)],
)

export const MedCalcLogTable = sqliteTable("med_calc_log", {
  id: text().$type<Medical.MedCalcLogID>().primaryKey(),
  episode_id: text()
    .$type<Medical.EpisodeID>()
    .notNull()
    .references(() => EpisodeTable.id, { onDelete: "cascade" }),
  node_id: text().$type<Medical.EpisodeNodeID>(),
  calc: text().notNull(),
  input: text({ mode: "json" }).$type<Record<string, unknown>>(),
  output: text({ mode: "json" }).$type<Record<string, unknown>>(),
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const AuditLogTable = sqliteTable(
  "audit_log",
  {
    id: text().$type<Medical.AuditLogID>().primaryKey(),
    episode_id: text()
      .$type<Medical.EpisodeID>()
      .notNull()
      .references(() => EpisodeTable.id, { onDelete: "cascade" }),
    node_id: text().$type<Medical.EpisodeNodeID>(),
    actor: text().$type<Medical.Actor>().notNull(),
    action: text().notNull(),
    target: text(),
    detail: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("audit_log_episode_time_idx").on(table.episode_id, table.time_created)],
)
