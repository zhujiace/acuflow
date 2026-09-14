import type { MedicalEpisode } from "./data"
import { fetchEpisode } from "./fetch"

type Listener = (episode: MedicalEpisode | undefined) => void

type Config = {
  fetch: typeof fetch
  url: string
  directory?: string
  sessionID: string
}

const listeners = new Set<Listener>()
let config: Config | undefined
let timer: ReturnType<typeof setInterval> | undefined
let last = 0

function tick() {
  if (!config) return
  last = Date.now()
  const current = config
  void fetchEpisode(current.fetch, current.url, current.directory, current.sessionID).then((next) => {
    for (const listener of listeners) listener(next)
  })
}

// 立即刷新一次（例如复核操作后），复用同一批订阅者。
export function refresh() {
  tick()
}

// 单例轮询：无论面板挂载/重渲染多少次，始终只有一个定时器与一个请求在途。
export function subscribe(input: Config & { listener: Listener }): () => void {
  config = { fetch: input.fetch, url: input.url, directory: input.directory, sessionID: input.sessionID }
  listeners.add(input.listener)
  if (!timer) timer = setInterval(tick, 3000)
  if (Date.now() - last > 2500) tick()
  return () => {
    listeners.delete(input.listener)
    if (listeners.size === 0) {
      if (timer) clearInterval(timer)
      timer = undefined
      config = undefined
    }
  }
}
