import { createMemo, Show } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useMedicalEpisode } from "./medical-panel"
import { postMedicalReview, type ReviewBody } from "../medical/fetch"
import { refresh } from "../medical/poller"

export function MedicalReview(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const episode = useMedicalEpisode(() => props.sessionID)
  const node = createMemo(() => {
    const value = episode()
    if (!value) return undefined
    return value.nodes.find((item) => item.key === value.episode.currentNode)
  })
  const visible = createMemo(() => node()?.status === "ready_for_review")

  const send = (body: ReviewBody) => {
    void postMedicalReview(sdk.fetch, sdk.url, sdk.directory, body).then(() => refresh())
  }
  const confirm = () => send({ sessionID: props.sessionID, decision: "confirm" })
  const reject = () => send({ sessionID: props.sessionID, decision: "reject", reason: "医生驳回" })
  const edit = () => {
    dialog.replace(() => (
      <DialogPrompt
        title="修改节点结论"
        value={node()?.draft ?? ""}
        onConfirm={(value) => {
          send({ sessionID: props.sessionID, decision: "edit", summary: value })
          dialog.clear()
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }

  useBindings(() => ({
    enabled: visible(),
    priority: 5,
    commands: [],
    bindings: [
      { key: "ctrl+y", desc: "确认节点结论", group: "AcuFlow", cmd: () => confirm() },
      { key: "ctrl+e", desc: "修改节点结论", group: "AcuFlow", cmd: () => edit() },
      { key: "ctrl+r", desc: "驳回节点结论", group: "AcuFlow", cmd: () => reject() },
    ],
  }))

  return (
    <Show when={visible()}>
      <box
        backgroundColor={theme.backgroundElement}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <text fg={theme.warning}>
          <b>节点待复核：</b>
          <span style={{ fg: theme.text }}>{node()?.title}</span>
        </text>
        <Show when={node()?.draft}>
          <text fg={theme.textMuted} wrapMode="word">
            {node()?.draft}
          </text>
        </Show>
        <box flexDirection="row" gap={2}>
          <text fg={theme.success} onMouseUp={confirm}>
            [ 确认 ctrl+y ]
          </text>
          <text fg={theme.primary} onMouseUp={edit}>
            [ 修改 ctrl+e ]
          </text>
          <text fg={theme.error} onMouseUp={reject}>
            [ 驳回 ctrl+r ]
          </text>
        </box>
      </box>
    </Show>
  )
}
