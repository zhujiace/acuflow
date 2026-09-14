import { expect, test } from "bun:test"
import { calculate } from "../../src/tool/medical"

test("shock_index accepts common aliases and computes", () => {
  expect(calculate("shock_index", { hr: 102, sbp: 118 })).toEqual({ shockIndex: 0.86, highRisk: false })
  expect(calculate("shock_index", { heartRate: 130, systolicBp: 90 })).toEqual({ shockIndex: 1.44, highRisk: true })
})

test("qsofa computes score", () => {
  expect(calculate("qsofa", { respiratoryRate: 24, systolicBp: 95, gcs: 14 })).toEqual({ score: 3, highRisk: true })
})

test("bmi computes", () => {
  expect(calculate("bmi", { weightKg: 72, heightCm: 172 })).toEqual({ bmi: 24.3 })
})

test("missing inputs return an error instead of an empty result", () => {
  const result = calculate("shock_index", { hr: 102 }) as { error?: string; missing?: string[] }
  expect(result.error).toContain("缺少必要输入")
  expect(result.missing).toContain("systolicBp")
})

test("non-numeric inputs are treated as missing", () => {
  const result = calculate("qsofa", { rr: "未知", sbp: 100, gcs: 15 }) as { error?: string }
  expect(result.error).toContain("respiratoryRate")
})
