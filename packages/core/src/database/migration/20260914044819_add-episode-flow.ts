import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260914044819_add-episode-flow",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`episode\` ADD \`flow\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
