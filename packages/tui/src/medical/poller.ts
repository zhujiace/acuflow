import type { MedicalEpisode } from "./data"
import { fetchEpisode } from "./fetch"

type Listener = (episode: MedicalEpisode | undefined) => void

type EventSource = {
  on: (type: "event", handler: (event: { payload: { type?: string } }) => void) => () => void
}

type Config = {
  fetch: typeof fetch
  url: string
  directory?: string
  sessionID: string
  events?: EventSource
}

const listeners = new Set<Listener>()
let config: Config | undefined
let timer: ReturnType<typeof setInterval> | undefined
let unsubscribeEvents: (() => void) | undefined
let last = 0

function tick() {
  if (!config) return
  const now = Date.now()
  if (now - last < 400) return
  last = now
  const current = config
  void fetchEpisode(current.fetch, current.url, current.directory, current.sessionID).then((next) => {
    for (const listener of listeners) listener(next)
  })
}

// 立即刷新一次（例如复核/回溯操作后）；带 400ms 限速，复用同一批订阅者。
export function refresh() {
  tick()
}

// 单例轮询 + 事件驱动：始终只有一个定时器与一个请求在途；收到医疗事件时即时刷新。
export function subscribe(input: Config & { listener: Listener }): () => void {
  config = { fetch: input.fetch, url: input.url, directory: input.directory, sessionID: input.sessionID }
  listeners.add(input.listener)
  if (!unsubscribeEvents && input.events) {
    unsubscribeEvents = input.events.on("event", (event) => {
      const type = event?.payload?.type
      if (typeof type === "string" && type.startsWith("medical.")) tick()
    })
  }
  if (!timer) timer = setInterval(tick, 3000)
  if (Date.now() - last > 2500) tick()
  return () => {
    listeners.delete(input.listener)
    if (listeners.size === 0) {
      if (timer) clearInterval(timer)
      timer = undefined
      unsubscribeEvents?.()
      unsubscribeEvents = undefined
      config = undefined
    }
  }
}
