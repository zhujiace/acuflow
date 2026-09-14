# AcuFlow 配置与作者指南

AcuFlow 的诊疗流程与知识可以由医学人员在不改代码的情况下配置。本目录是默认配置。

## 目录结构

```
.opencode/
  acuflow/
    flow.json              # 节点流程：节点、必需信息、同义词
    guidelines/*.md        # 共享临床指南（每轮注入）
  agent/                   # 主协调 agent 与专科 subagent
  skills/<node>-knowledge/SKILL.md   # 每个节点的知识库
  command/                 # /triage /labs 等手动命令
```

## 1. flow.json —— 节点流程

`episode_start` 时会读取本项目 `.opencode/acuflow/flow.json` 并绑定到本次 episode；若不存在则使用内置默认流程。

每个节点字段：

| 字段 | 说明 |
|---|---|
| `key` | 节点标识，必须是 `triage` / `history_exam` / `labs` / `imaging_consult` / `treatment_observation` / `disposition` 之一 |
| `seq` | 顺序（从 0 递增），决定推进顺序 |
| `title` | 展示名称 |
| `entryAgent` | 该节点默认使用的 agent（可选） |
| `requiredInputs` | 本节点必须收集的信息项名称；缺失时 agent 会向医生追问，信息不足不能提交产出 |
| `synonyms` | 每个信息项的同义词/关键词，用于从医生原话中自动识别已提供的信息，避免重复追问 |

修改示例：想让“分诊”节点额外强制记录“末次进食时间”，在 `triage.requiredInputs` 增加 `"末次进食时间"`，并在 `synonyms` 里加上 `"末次进食时间": ["进食", "禁食", "最后进食"]`。

## 2. skills/ —— 节点知识库

每个节点对应一个技能目录，`SKILL.md` 的 frontmatter 需要 `name` 与 `description`。节点 agent 通过 `permission.skill` 白名单只加载本节点知识与共享指南。

技能可包含 `reference/`、`scripts/` 等同级文件，`skill` 工具会把它们列给模型按需读取。

## 3. agent/ —— 主协调与专科

- `acuflow`（内置）：主协调，负责流程推进与信息追问。
- 本目录下的 `*.md` 为 subagent，可用于专科会诊或按节点聚焦推理。

## 4. command/ —— 手动命令

在 TUI 输入 `/triage`、`/labs` 等可让 agent 聚焦当前（或指定）节点。

## 5. 医生复核

产出草案后，医生可：
- 直接说“确认” → agent 调用 `flow_review(confirm)`；
- 给出修改 → agent 调用 `flow_review(edit)`；
- 说“驳回/继续讨论” → `flow_review(reject)`。

对已确认节点的回溯修改用 `flow_amend`，下游节点会被标记为 `stale`。

## 6. 影像分析（接口已保留，默认未启用）

`imaging_analyze` 工具已提供，但**默认不启用**：仅当 `.opencode/acuflow/imaging.json` 中 `enabled: true` 且配置了 `endpoint` 时，才会真正调用影像模型端点；否则只返回“未启用”，不进行任何外部调用。

配置字段：

| 字段 | 说明 |
|---|---|
| `enabled` | 是否启用（默认 false） |
| `provider` | 端点类型，如 `http`（预留 `local` 等） |
| `endpoint` | 影像模型 HTTP 端点，接收 `{ model, provider, image, modality, node, context }`，返回 `{ findings, impression? }` |
| `model` | 端点内的模型标识 |
| `timeoutMs` | 请求超时 |
| `routing` | 预留：按节点路由到 online/local |

`image` 目前接受本地文件路径或 URL。启用后，工具会把结果以 `kind=imaging` 写入 `clinical_data`。

## 7. 审计与证据回链

- 每个节点的确认/修改/驳回/回溯都会写入 `audit_log` 与 `node_revision`。
- agent 可用 `medical_audit`（可按 `nodeKey` 过滤）查看本 episode 的审计与各节点修订历史；用 `clinical_query` 回看检验/影像等原始记录。
