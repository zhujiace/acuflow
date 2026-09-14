---
description: 聚焦问诊/查体节点
agent: acuflow
---

调用 `episode_status`，并使用 `history-exam-knowledge` 技能。

只针对 `missing` 中的项追问：症状特点、腹部体征、既往手术、用药、过敏、妊娠可能。

整理关键遗漏与主要鉴别诊断，给出检查建议，产出结论草案并等待我确认。
