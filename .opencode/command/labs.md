---
description: 录入并解读第一批检验
agent: acuflow
---

我将提供检验结果。请用 `clinical_record`（或直接在下一条消息里给出，由系统自动摄取）逐项记录，并使用 `labs-knowledge` 技能。

调用 `episode_status`，只针对 `missing` 追问剩余检验项；说明哪些结果改变风险或诊断、哪些异常需核实、哪些检查仍缺失。

产出检验节点结论草案并等待我确认。
