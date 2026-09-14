import { expect, test } from "bun:test"
import { analyzeImaging, parseImagingConfig } from "../../src/tool/imaging"

test("parseImagingConfig defaults to disabled", () => {
  expect(parseImagingConfig({})).toEqual({ enabled: false, provider: "http", endpoint: undefined, model: undefined, timeoutMs: 15000, routing: undefined })
  expect(parseImagingConfig(null)).toBeUndefined()
})

test("parseImagingConfig reads enabled config", () => {
  const config = parseImagingConfig({
    enabled: true,
    provider: "local",
    endpoint: "http://localhost:9000/analyze",
    model: "ct-abdomen",
    timeoutMs: 5000,
    routing: { imaging_consult: "local" },
  })
  expect(config?.enabled).toBe(true)
  expect(config?.endpoint).toBe("http://localhost:9000/analyze")
  expect(config?.routing).toEqual({ imaging_consult: "local" })
})

test("analyzeImaging is a no-op while disabled", async () => {
  const result = await analyzeImaging(fetch, { enabled: false, provider: "http", timeoutMs: 1000 }, { image: "./ct.dcm" })
  expect(result.enabled).toBe(false)
  if (!result.enabled) expect(result.reason).toContain("未启用")
})

test("analyzeImaging requires an endpoint", async () => {
  const result = await analyzeImaging(fetch, { enabled: true, provider: "http", timeoutMs: 1000 }, { image: "./ct.dcm" })
  expect(result.enabled).toBe(false)
  if (!result.enabled) expect(result.reason).toContain("endpoint")
})

test("analyzeImaging calls the configured endpoint when enabled", async () => {
  const mockFetch = (async () => ({
    ok: true,
    json: async () => ({ findings: { appendix: "增粗" }, impression: "急性阑尾炎" }),
  })) as unknown as typeof fetch
  const result = await analyzeImaging(
    mockFetch,
    { enabled: true, provider: "http", endpoint: "http://localhost/analyze", timeoutMs: 1000 },
    { image: "./ct.dcm", modality: "CT" },
  )
  expect(result.enabled).toBe(true)
  if (result.enabled) {
    expect(result.findings).toEqual({ appendix: "增粗" })
    expect(result.impression).toBe("急性阑尾炎")
  }
})

test("analyzeImaging reports endpoint failures", async () => {
  const mockFetch = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
  const result = await analyzeImaging(
    mockFetch,
    { enabled: true, provider: "http", endpoint: "http://localhost/analyze", timeoutMs: 1000 },
    { image: "./ct.dcm" },
  )
  expect(result.enabled).toBe(false)
  if (!result.enabled) expect(result.reason).toContain("503")
})
