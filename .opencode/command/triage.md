---
description: 聚焦分诊节点，检查缺失信息并推进
agent: acuflow
---

调用 `episode_status`。若尚未开始 episode，先请我提供患者基本信息并用 `episode_start` 登记。

若当前不在“分诊、首次接诊”节点，请说明当前节点并询问是否继续。

若在分诊节点：加载 `triage-knowledge` 技能，先列出不能等待资料齐全的危险信号，然后只针对 `missing` 中的项向我追问。信息齐全后产出分诊结论草案（fields + summary）并等待我确认。
