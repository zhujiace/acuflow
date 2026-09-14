import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { subscribe } from "../medical/poller"
import { nodeGlyph, type MedicalEpisode, type MedicalNode } from "../medical/data"

const SEX: Record<string, string> = { male: "男", female: "女" }

export function useMedicalEpisode(sessionID: () => string) {
  const sdk = useSDK()
  const [episode, setEpisode] = createSignal<MedicalEpisode | undefined>(undefined)
  createEffect(() => {
    const stop = subscribe({
      fetch: sdk.fetch,
      url: sdk.url,
      directory: sdk.directory,
      sessionID: sessionID(),
      listener: (next) => {
        if (JSON.stringify(next) !== JSON.stringify(episode())) setEpisode(next)
      },
    })
    onCleanup(stop)
  })
  return episode
}

function demographics(value: MedicalEpisode) {
  const parts: string[] = []
  if (value.patient.sex) parts.push(SEX[value.patient.sex] ?? value.patient.sex)
  if (value.patient.age !== null) parts.push(`${value.patient.age} 岁`)
  if (value.patient.weightKg !== null) parts.push(`${value.patient.weightKg} kg`)
  return parts.join(" · ") || "—"
}

export function PatientPanel(props: { sessionID: string }) {
  const { theme } = useTheme()
  const episode = useMedicalEpisode(() => props.sessionID)
  const current = (value: MedicalEpisode) => value.nodes.find((node) => node.key === value.episode.currentNode)

  return (
    <Show when={episode()}>
      {(value) => {
        const data = () => value()
        return (
          <box gap={1}>
            <box>
              <text fg={theme.text}>
                <b>患者</b>
              </text>
              <text fg={theme.text}>{data().patient.name}</text>
              <text fg={theme.textMuted}>{demographics(data())}</text>
              <text fg={theme.textMuted}>过敏：{data().patient.allergies.join("、") || "无"}</text>
              <text fg={theme.textMuted}>基础病：{data().patient.comorbidities.join("、") || "无"}</text>
            </box>
            <box>
              <text fg={theme.text}>
                <b>本次诊断</b>
              </text>
              <text fg={theme.text}>{data().episode.title || "（未命名）"}</text>
              <text fg={theme.textMuted}>
                节点：{current(data())?.title ?? (data().episode.status === "closed" ? "已完成" : "—")}
              </text>
            </box>
            <Show when={(current(data())?.missing.length ?? 0) > 0}>
              <box>
                <text fg={theme.warning}>
                  <b>待补充信息</b>
                </text>
                <For each={current(data())?.missing ?? []}>{(item) => <text fg={theme.warning}>□ {item}</text>}</For>
              </box>
            </Show>
          </box>
        )
      }}
    </Show>
  )
}

export function TimelinePanel(props: { sessionID: string }) {
  const { theme } = useTheme()
  const episode = useMedicalEpisode(() => props.sessionID)

  const color = (value: MedicalEpisode, node: MedicalNode) => {
    if (node.stale) return theme.warning
    if (node.status === "completed") return theme.success
    if (node.key === value.episode.currentNode) return theme.primary
    return theme.textMuted
  }

  const label = (node: MedicalNode) => {
    if (node.stale) return "已过期"
    if (node.status === "completed") return "已确认"
    if (node.status === "ready_for_review") return "待复核"
    if (node.status === "gathering") return node.missing.length > 0 ? `缺 ${node.missing.length} 项` : "整理中"
    return ""
  }

  return (
    <Show when={episode()}>
      {(value) => {
        const data = () => value()
        return (
          <Show when={data().nodes.length > 0}>
            <box>
              <text fg={theme.text}>
                <b>诊疗时间轴</b>
              </text>
              <For each={data().nodes}>
                {(node) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={color(data(), node)}>
                      {nodeGlyph(node)}
                    </text>
                    <text flexGrow={1} wrapMode="word" fg={color(data(), node)}>
                      {node.title}
                    </text>
                    <text flexShrink={0} fg={theme.textMuted}>
                      {label(node)}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        )
      }}
    </Show>
  )
}
