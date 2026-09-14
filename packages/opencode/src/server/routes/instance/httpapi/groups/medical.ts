import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"

const EpisodeView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  currentNode: Schema.NullOr(Schema.String),
})

const PatientView = Schema.Struct({
  name: Schema.String,
  sex: Schema.NullOr(Schema.String),
  age: Schema.NullOr(Schema.Number),
  weightKg: Schema.NullOr(Schema.Number),
  allergies: Schema.Array(Schema.String),
  comorbidities: Schema.Array(Schema.String),
})

const NodeView = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  seq: Schema.Number,
  status: Schema.String,
  stale: Schema.Boolean,
  missing: Schema.Array(Schema.String),
  draft: Schema.NullOr(Schema.String),
  final: Schema.NullOr(Schema.String),
})

const View = Schema.Struct({
  episode: EpisodeView,
  patient: PatientView,
  nodes: Schema.Array(NodeView),
}).annotate({ identifier: "Medical.View" })

const ReviewPayload = Schema.Struct({
  sessionID: Schema.String,
  decision: Schema.Literals(["confirm", "edit", "reject"]),
  summary: Schema.optional(Schema.String),
  fields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  reason: Schema.optional(Schema.String),
}).annotate({ identifier: "Medical.ReviewPayload" })

const AmendPayload = Schema.Struct({
  sessionID: Schema.String,
  nodeKey: Schema.String,
  summary: Schema.String,
  fields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  reason: Schema.optional(Schema.String),
}).annotate({ identifier: "Medical.AmendPayload" })

export const MedicalApi = HttpApi.make("medical").add(
  HttpApiGroup.make("medical")
    .add(
      HttpApiEndpoint.get("view", "/medical/view", {
        query: Schema.Struct({ sessionID: Schema.String }),
        success: described(Schema.NullOr(View), "Medical episode view for a session"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "medical.view",
          summary: "Get medical episode view",
          description: "Return patient, episode and node timeline for a session's diagnostic episode.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("review", "/medical/review", {
        payload: ReviewPayload,
        success: described(Schema.NullOr(View), "Updated medical episode view"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "medical.review",
          summary: "Review current node output",
          description: "Physician confirms, edits or rejects the current node draft, then advances.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("amend", "/medical/amend", {
        payload: AmendPayload,
        success: described(Schema.NullOr(View), "Updated medical episode view"),
      }      ).annotateMerge(
        OpenApi.annotations({
          identifier: "medical.amend",
          summary: "Amend a settled node output",
          description: "Retroactively edit a settled node; downstream nodes are marked stale.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
