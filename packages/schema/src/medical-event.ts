export * as MedicalEvent from "./medical-event"

import { Schema } from "effect"
import { Event } from "./event"
import { Medical } from "./medical"
import { optional } from "./schema"

const durable = { aggregate: "episodeID", version: 1 } as const

const Base = {
  episodeID: Medical.EpisodeID,
  timestamp: Schema.Finite,
}

export const NodeStarted = Event.define({
  type: "medical.node.started",
  durable,
  schema: {
    ...Base,
    nodeID: Medical.EpisodeNodeID,
    nodeKey: Medical.NodeKey,
  },
})
export type NodeStarted = typeof NodeStarted.Type

export const NodeReviewRequested = Event.define({
  type: "medical.node.review_requested",
  durable,
  schema: {
    ...Base,
    nodeID: Medical.EpisodeNodeID,
    nodeKey: Medical.NodeKey,
    output: Medical.NodeOutput,
  },
})
export type NodeReviewRequested = typeof NodeReviewRequested.Type

export const NodeConfirmed = Event.define({
  type: "medical.node.confirmed",
  durable,
  schema: {
    ...Base,
    nodeID: Medical.EpisodeNodeID,
    nodeKey: Medical.NodeKey,
    output: Medical.NodeOutput,
    edited: Schema.Boolean,
  },
})
export type NodeConfirmed = typeof NodeConfirmed.Type

export const NodeRejected = Event.define({
  type: "medical.node.rejected",
  durable,
  schema: {
    ...Base,
    nodeID: Medical.EpisodeNodeID,
    nodeKey: Medical.NodeKey,
    reason: optional(Schema.String),
  },
})
export type NodeRejected = typeof NodeRejected.Type

export const NodeCompleted = Event.define({
  type: "medical.node.completed",
  durable,
  schema: {
    ...Base,
    nodeID: Medical.EpisodeNodeID,
    nodeKey: Medical.NodeKey,
    nextNode: optional(Medical.NodeKey),
  },
})
export type NodeCompleted = typeof NodeCompleted.Type

export const NodeStale = Event.define({
  type: "medical.node.stale",
  durable,
  schema: {
    ...Base,
    nodeID: Medical.EpisodeNodeID,
    nodeKey: Medical.NodeKey,
    reason: optional(Schema.String),
  },
})
export type NodeStale = typeof NodeStale.Type

export const DataRecorded = Event.define({
  type: "medical.data.recorded",
  durable,
  schema: {
    ...Base,
    nodeID: optional(Medical.EpisodeNodeID),
    kind: Medical.ClinicalKind,
    label: Schema.String,
    status: Medical.ClinicalStatus,
  },
})
export type DataRecorded = typeof DataRecorded.Type

export const DurableDefinitions = Event.inventory(
  NodeStarted,
  NodeReviewRequested,
  NodeConfirmed,
  NodeRejected,
  NodeCompleted,
  NodeStale,
  DataRecorded,
)
