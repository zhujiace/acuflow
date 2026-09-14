import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Config.node, AgentSvc.node])))

it.instance(
  "agent color parsed from project config",
  () =>
    Effect.gen(function* () {
      const cfg = yield* Config.use.get()
      expect(cfg.agent?.["acuflow"]?.color).toBe("#FFA500")
      expect(cfg.agent?.["consultant"]?.color).toBe("primary")
    }),
  {
    git: true,
    config: {
      agent: {
        acuflow: { color: "#FFA500" },
        consultant: { color: "primary" },
      },
    },
  },
)

it.instance(
  "Agent.get includes color from config",
  () =>
    Effect.gen(function* () {
      const consultant = yield* AgentSvc.use.get("consultant")
      expect(consultant?.color).toBe("#A855F7")
      const acuflow = yield* AgentSvc.use.get("acuflow")
      expect(acuflow?.color).toBe("accent")
    }),
  {
    git: true,
    config: {
      agent: {
        consultant: { color: "#A855F7" },
        acuflow: { color: "accent" },
      },
    },
  },
)
