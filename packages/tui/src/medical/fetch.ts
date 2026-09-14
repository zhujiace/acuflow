import type { MedicalEpisode, MedicalEvidence } from "./data"

function buildHeaders(directory: string | undefined, json: boolean) {
  const headers: Record<string, string> = {}
  if (json) headers["content-type"] = "application/json"
  if (directory) headers["x-opencode-directory"] = encodeURIComponent(directory)
  return headers
}

// 通过 server 的 /medical 端点读写，避免在 TUI 进程内再开 SQLite 连接。
export async function fetchEpisode(
  fetchFn: typeof fetch,
  url: string,
  directory: string | undefined,
  sessionID: string,
): Promise<MedicalEpisode | undefined> {
  try {
    const target = new URL("/medical/view", url)
    target.searchParams.set("sessionID", sessionID)
    const response = await fetchFn(target.toString(), {
      headers: buildHeaders(directory, false),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return undefined
    const data = (await response.json()) as MedicalEpisode | null
    return data ?? undefined
  } catch {
    return undefined
  }
}

export async function fetchEvidence(
  fetchFn: typeof fetch,
  url: string,
  directory: string | undefined,
  sessionID: string,
): Promise<MedicalEvidence | undefined> {
  try {
    const target = new URL("/medical/evidence", url)
    target.searchParams.set("sessionID", sessionID)
    const response = await fetchFn(target.toString(), {
      headers: buildHeaders(directory, false),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return undefined
    const data = (await response.json()) as MedicalEvidence | null
    return data ?? undefined
  } catch {
    return undefined
  }
}

export type ReviewBody = {
  sessionID: string
  decision: "confirm" | "edit" | "reject"
  summary?: string
  fields?: Record<string, unknown>
  reason?: string
}

export async function postMedicalReview(
  fetchFn: typeof fetch,
  url: string,
  directory: string | undefined,
  body: ReviewBody,
): Promise<MedicalEpisode | undefined> {
  return post(fetchFn, url, directory, "/medical/review", body)
}

export async function postMedicalAmend(
  fetchFn: typeof fetch,
  url: string,
  directory: string | undefined,
  body: { sessionID: string; nodeKey: string; summary: string; fields?: Record<string, unknown>; reason?: string },
): Promise<MedicalEpisode | undefined> {
  return post(fetchFn, url, directory, "/medical/amend", body)
}

async function post(
  fetchFn: typeof fetch,
  url: string,
  directory: string | undefined,
  path: string,
  body: unknown,
): Promise<MedicalEpisode | undefined> {
  try {
    const target = new URL(path, url)
    const response = await fetchFn(target.toString(), {
      method: "POST",
      headers: buildHeaders(directory, true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return undefined
    const data = (await response.json()) as MedicalEpisode | null
    return data ?? undefined
  } catch {
    return undefined
  }
}
