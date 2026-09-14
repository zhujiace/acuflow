import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { MedicalFlow } from "@opencode-ai/core/medical/flow"
import { MedicalStore } from "@opencode-ai/core/medical/store"
import { EpisodeTable, PatientTable } from "@opencode-ai/core/medical/sql"
import { MedicalEvent } from "@opencode-ai/schema/medical-event"
import { Medical } from "@opencode-ai/schema/medical"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, MedicalStore.node, MedicalFlow.node])),
)

it.effect(
  "concurrent durable medical publish and reads complete",
  () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const episodeID = Medical.EpisodeID.create()

      const tasks: Array<Effect.Effect<unknown, never, never>> = []
      for (let index = 0; index < 40; index++) {
        tasks.push(
          events
            .publish(MedicalEvent.DataRecorded, {
              episodeID,
              timestamp: Date.now(),
              kind: "note",
              label: `x${index}`,
              status: "captured",
            })
            .pipe(Effect.asVoid),
        )
        tasks.push(db.select().from(EpisodeTable).where(eq(EpisodeTable.id, episodeID)).all().pipe(Effect.orDie))
        tasks.push(db.select().from(PatientTable).all().pipe(Effect.orDie))
        tasks.push(db.select().from(EpisodeTable).all().pipe(Effect.orDie))
      }

      yield* Effect.all(tasks, { concurrency: "unbounded" })
      expect(true).toBe(true)
    }),
  20_000,
)

it.effect(
  "durable medical event stream is replayable",
  () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const episodeID = Medical.EpisodeID.create()
      yield* events.publish(MedicalEvent.DataRecorded, {
        episodeID,
        timestamp: Date.now(),
        kind: "note",
        label: "one",
        status: "captured",
      })
      const seen = yield* events.durable({ aggregateID: episodeID }).pipe(Stream.take(1), Stream.runCollect)
      expect(Array.from(seen).length).toBe(1)
    }),
  20_000,
)
