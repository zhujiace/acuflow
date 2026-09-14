import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"

export function Logo() {
  const { theme } = useTheme()

  return (
    <box alignItems="center">
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        AcuFlow Agent
      </text>
      <text fg={theme.textMuted}>急腹症诊疗辅助 · 固定流程人机协同</text>
    </box>
  )
}
