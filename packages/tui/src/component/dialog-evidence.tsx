import { createSignal, For, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { fetchEvidence } from "../medical/fetch"
import type { MedicalEvidence } from "../medical/data"

export function DialogEvidence(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const [data, setData] = createSignal<MedicalEvidence | undefined>(undefined)

  onMount(() => {
    dialog.setSize("large")
    void fetchEvidence(sdk.fetch, sdk.url, sdk.directory, props.sessionID).then(setData)
  })

  const short = (value: string | null | undefined) => (value && value.length > 0 ? value : "—")
  const payload = (value: Record<string, unknown>) => {
    const text = JSON.stringify(value)
    return text === "{}" ? "" : " · " + (text.length > 80 ? text.slice(0, 80) + "…" : text)
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>证据与审计</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={data()} fallback={<text fg={theme.textMuted}>加载中…</text>}>
        {(value) => (
          <scrollbox height={22} gap={1}>
            <text fg={theme.text}>
              <b>临床数据 ({value().clinical.length})</b>
            </text>
            <For each={value().clinical}>
              {(item) => (
                <text fg={theme.textMuted} wrapMode="word">
                  [{item.kind}] {item.label} · {item.status}
                  {item.negative ? " · 阴性" : ""} · {short(item.source)}
                  {payload(item.payload)}
                </text>
              )}
            </For>
            <text fg={theme.text}>
              <b>审计 ({value().audit.length})</b>
            </text>
            <For each={value().audit}>
              {(item) => (
                <text fg={theme.textMuted} wrapMode="word">
                  {item.actor} · {item.action} · {short(item.target)}
                </text>
              )}
            </For>
            <text fg={theme.text}>
              <b>节点修订 ({value().revisions.length})</b>
            </text>
            <For each={value().revisions}>
              {(item) => (
                <text fg={theme.textMuted} wrapMode="word">
                  {item.node} r{item.revision} · {item.actor} · {item.action}
                  {item.reason ? " · " + item.reason : ""}
                </text>
              )}
            </For>
          </scrollbox>
        )}
      </Show>
    </box>
  )
}
