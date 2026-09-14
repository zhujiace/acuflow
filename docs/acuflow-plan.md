# AcuFlow Agent 实施计划

基于 opencode 构建的急腹症固定流程诊疗辅助 agent。本文件是总体设计与实施路线图，配合 `docs/acuflow-requirements.md`（需求原文）使用。

## 0. 目标与不变量

- 一个 **session = 一次完整诊疗 episode**（1:1）。
- 患者信息 + 所有节点输入/输出/证据 **持久化、绑定 session、永不丢弃**（存 DB，独立于对话历史，compaction 不影响）。
- 流程由 **硬状态机** 门控；每节点有指定产出；**医生确认后方可推进**，且可回溯修改。
- agent 在每节点自由对话、抓取医生输入，并主动提示缺失信息，直到满足产出要求。
- 医学人员通过配置文件 / markdown 定义节点、prompt、知识与门控，无需改代码。

## 1. 架构基线

- **对话运行时**：沿用 **V1 live 栈**（`packages/opencode/src/session` + `/session` instance API + `@opencode-ai/sdk/v2`）。理由：TUI 与 agent/skill/tool/permission 均已接通。
- **医学域**：新增到 `packages/core`（表/服务/事件），经 instance API + 重生成 SDK 暴露给 TUI。
- **V2 新栈**（`packages/protocol`、`packages/server`、`packages/client`、`packages/sdk-next`）：冻结不投入，Tier 3 再删。
- 依赖方向遵循根 `AGENTS.md`：schema → core/protocol → server。

## 2. 裁剪策略（分层）

| 层级 | 动作 |
|---|---|
| **Tier 1** | `packages/opencode/src/tool/registry.ts` 的 `builtin[]` 移除 `shell/edit/write/apply_patch/glob/grep/lsp/patch/code-mode/plan_exit`；`packages/opencode/src/agent/agent.ts` 的内置 `build/plan/explore/general` 替换为 AcuFlow 主协调 + 节点/专科 subagent |
| **Tier 2** | TUI 更名 **AcuFlow Agent**；患者侧栏替换 `sidebar/context.tsx`；加入节点时间轴；隐藏 `files/lsp` 侧栏与 coding 提示 |
| **Tier 3** | 隔离后删除 `packages/{web,console,stats,desktop,slack,enterprise,storybook}` 与 V2 栈；删除 V1 的 lsp/git/worktree/snapshot/ide/share；替换 `session/prompt/*.txt` 为医学基础提示 |

先做 Tier 1+2 跑通闭环，Tier 3 增量验证。

## 3. 领域数据模型（`packages/core/src/medical/sql.ts`）

```
patient         id(pat_) name sex birth_date weight height allergies(json)
                comorbidities(json) baseline(json) created/updated
episode         id(epi_) patient_id→patient.id session_id→session.id UNIQUE
                title status current_node time_opened time_closed
episode_node    id episode_id→episode.id node_key seq status revision
                input_snapshot(json) missing(json) unavailable(json)
                output_agent(json) output_final(json) output_diff(json)
                edited_by confirmed_by confirmed_at reject_reason
                stale(bool) time_started time_ended
node_revision   id node_id revision output(json) actor action reason time   (append-only)
clinical_data   id episode_id kind(vital|lab|imaging|medication|note|consult)
                collected_at source version status(captured|unavailable)
                is_negative(bool) payload(json) payload_previous(json) changed(bool)
med_calc_log    id episode_id calc input(json) output(json) time
audit_log       id episode_id actor(agent|doctor|system) action target detail(json) time
```

- `output_agent` = agent 草案；`output_final` = 最终（医生确认/修改后）；`node_revision` 记录每次变更，支持回溯与回滚。
- `clinical_data.status` 三态：未采集（无行）、`captured`（含阴性）、`unavailable`（无法获取）。
- 全部外键 `ON DELETE CASCADE`；迁移在 `packages/core` 执行 `bun run script/migration.ts --name add-medical-domain`。

## 4. 节点生命周期与状态机

```
pending → gathering → ready_for_review → confirmed → completed → (next.pending)
              ↑______________rejected__________________|
                              回溯: confirmed/completed → stale → (re-evaluate)
```

**产出契约（混合输出）**：每节点 `output` schema =
`{ fields: { <结构化字段...> }, summary: <自由文本> }`

- `fields` 用于校验与表单渲染；`summary` 为临床叙述。
- `required_inputs` 支持条件项；医生可标 `unavailable`。
- `flow_submit_draft` 校验 `required_inputs` 与 `output`；不满足返回缺失项，不进入 review。

**双通道修改**

- 弹窗（权威）：确认 / 编辑 fields+summary / 驳回；`flow_review({decision, output?, reason?})`。
- 对话（快捷）：医生口述修改 → agent 重新 `flow_submit_draft` 更新草案 → 回到 `ready_for_review` 确认。

**默认强制 + 回溯修改**

- `require_doctor_review` 默认 true；仅 `ready_for_review` 可推进，agent 无法跳过产出。
- 回溯：医生对已确认节点 N 提交修改 → 写 `node_revision`，更新 `output_final`，将 N 之后节点标记 `stale`，发 `episode.node.stale` 事件；agent/医生可对下游触发再评估。
- 每次确认/修改/驳回均写 `audit_log` 并回写会话一条 `Synthetic/System` 消息（可回放审计）。

**节点图（默认，可由 `flow.jsonc` 覆盖）**

`triage → history_exam → labs → imaging_consult → treatment_observation → disposition`

| node | 输入 | 产出 |
|---|---|---|
| triage | 主诉、起病时间、生命体征、意识、重点病史 | 危险信号、是否需立即床旁评估 |
| history_exam | 症状特点、腹部体征、既往手术、用药、过敏、妊娠可能 | 关键遗漏、鉴别诊断、有目的检查建议 |
| labs | 原始数值、单位、参考范围、标本信息 | 风险/诊断改变、需核实异常、仍缺失检查 |
| imaging_consult | 影像报告、影像分析、会诊意见 | 临床影像一致性、诊断/严重程度/处理调整 |
| treatment_observation | 给药、补液、引流、疼痛、生命体征趋势 | 是否达预期、恶化/失败信号、未执行事项 |
| disposition | 最新状态、未解决问题、待回报、随访条件 | 去向建议依据与限制、未排除危险、交接复诊 |

## 5. 工具集

**移除**：`bash/edit/write/apply_patch/glob/grep/lsp/patch/execute/plan_exit`。
**保留**：`read`、`skill`、`question`、`task`(专科会诊)、`todo`、`webfetch/websearch`(证据检索，可选)。

**新增**（`.opencode/tool/*.ts` 的 zod 形态或 core 内置）：

| 工具 | 作用 |
|---|---|
| `patient_get` / `patient_update` | 患者档案 |
| `episode_get` / `episode_timeline` | 当前 episode 与节点时间轴 |
| `clinical_record` | 录入数据（kind/source/time/version/negative/unavailable） |
| `clinical_query` | 检索既往节点 I/O 与证据 |
| `flow_status` | 当前节点、已采集、缺失、unavailable、草案状态 |
| `flow_submit_draft` | 提交节点产出草案（校验） |
| `flow_review` | 医生确认/修改/驳回 |
| `flow_mark_unavailable` | 标记客观无法获取的信息 |
| `med_calc` | 医学计算（qSOFA/Alvarado/Ranson/eGFR/剂量） |
| `imaging_analyze` | 调用可配置影像模型端点，返回结构化所见 |

节点 `allowed_tools` 在切换节点时通过 session permission ruleset 动态下发（`packages/opencode/src/permission/index.ts`）。

## 6. 作者面（医学人员配置，无需代码）

```
docs/acuflow-guidelines/*.md          # 由 docs/*.docx 转换，纳入 instructions
.opencode/
  acuflow/flow.jsonc                  # 节点图+gate+输入/输出 schema+工具/skill+确认要求
  acuflow/guidelines/                 # 共享临床指南
  agent/acuflow.md                    # 主协调（default_agent）
  agent/{triage,history,labs,imaging,treatment,disposition}.md   # 正文即 prompt
  agent/consult-*.md                  # 妇产/泌尿/心内/血管/普外 subagent
  skills/<node>-knowledge/SKILL.md    # 每节点知识库 + reference/ scripts/
  command/*.md                        # 手动驱动作业
  tool/*.ts                           # 自定义医学工具（可选）
```

- 节点 agent 用 `permission.skill` 白名单只暴露本节点知识：`skill: { "*": deny, "<node>-*": allow }`。
- `flow.jsonc` 由 `MedicalFlow` 服务加载；改流程/门控/绑定是配置工作。
- `docs/` 转为 markdown 并加入 `opencode.jsonc` 的 `instructions`，agent 可直接读取。

## 7. 患者上下文注入与信息补全

1. **每轮强制注入**：经 `experimental.chat.system.transform`（或 V1 `SystemPrompt`）注入 `患者摘要 / 当前节点 / 已采集 / 待补充 / unavailable / 草案状态`。
2. **工具可查**：`flow_status`、`clinical_query` 同构返回，不依赖模型记忆。
3. **TUI 待补充清单**：患者侧栏渲染，可勾选 unavailable 或直接对话录入。
4. **收敛环**：信息不足 → `flow_submit_draft` 拒绝并回缺失项 → agent 追问 → 补录 → 再提交。
5. `SystemContext` registry 为 **Location 作用域**（`load` 无 sessionID），**不用于** per-session 患者上下文；用注入 + 工具。

## 8. API / 事件 / SDK

- `packages/schema/src/medical.ts`：ID（`pat_`/`epi_`）与记录 schema。
- `packages/core/src/medical.ts` + `medical/sql.ts`：`MedicalFlow`、`MedicalStore`，注册进 `packages/server/src/routes.ts` 的 `applicationServices`。
- `packages/protocol/src/groups/medical.ts` + `packages/server/src/handlers/medical.ts`：`patient.*`、`episode.*`、`episode.node.*`、`clinical.record/query`、review 端点、SSE。
- TUI 桥接：在 `packages/opencode/src/server/routes/instance/httpapi/{groups,handlers}/medical.ts` 暴露同名端点并在 `api.ts`/`server.ts` 注册。
- 事件：`episode.node.started/review_requested/confirmed/rejected/stale/completed`，`durable.aggregate="episodeID"`；注册于 `packages/schema/src/{event,durable-event}-manifest.ts`，经 `packages/opencode/src/event-v2-bridge.ts` → `bus/global.ts` 推送。
- 重生成：V2 `packages/client` 跑 `bun run generate`；legacy `packages/sdk/js/script/build.ts`。**不手改生成目录**。

## 9. TUI（AcuFlow Agent）

| 项 | 文件 | 说明 |
|---|---|---|
| 品牌 | `feature-plugins/sidebar/footer.tsx`、home 路由 | 更名，移除 OpenCode/coding 文案 |
| 患者侧栏 | 改写 `feature-plugins/sidebar/context.tsx` 或新增 `sidebar/patient.tsx` | 人口学/过敏/基础病/关键体征/当前 episode/待补充清单 |
| 节点时间轴 | 新增 `sidebar/timeline.tsx`（`sidebar_content` order≈150）或 `packages/plugin/src/tui.ts` 加 `sidebar_timeline` slot | 标记：○待开始 ◐采集中 ●待复核 ✓已确认 ⚠已过期；复用 `component/todo-item.tsx` |
| 复核弹窗 | 新增 `routes/session/node-review.tsx` | 参考 `permission.tsx`(`EditBody`) + `question.tsx`；表单(fields)+编辑器(summary)；确认/修改/驳回；挂载于 `routes/session/index.tsx` 一带，纳入 `disabled` 门禁 |
| 数据同步 | `context/sync.tsx` | reduce `episode.*` / `episode.node.*`（仿 `permission.asked`/`question.asked`） |
| 命令/快捷键 | `config/keybind.ts` + `useBindings`/`api.keymap.registerLayer` | `node.review`、`node.mark_unavailable`、`episode.timeline`、`patient.edit` |
| 回溯入口 | 时间轴 + 节点复核弹窗 | 选已确认节点 → 修改 → 下游标 `stale` |

## 10. 模型与影像

- 首期线上 API；每节点可 frontmatter 固定 `model/temperature/steps`。
- 新增 `acuflow` 配置：`imaging { provider, endpoint, model, timeout }`、`routing { <node>: online|local }`；`imaging_analyze` 按配置调独立 CV 模型，返回结构化 `findings` 存入 `clinical_data(kind=imaging)`，LLM 只消费结果与报告。
- 本地模型选项用于 PHI；`OPENCODE_DB` 可指向院内路径。

## 11. 安全 / 审计 / 合规

- 诊断广覆盖、治疗窄范围；系统只建议，**治疗执行不经 `flow_review` 自动放行**。
- 所有复核/修改/回溯写 `audit_log` + `node_revision` + 会话审计消息。
- PHI 本地化选项、访问权限、脱敏；上线前伦理与数据安全评审。

## 12. 实施里程碑

| 阶段 | 交付 | 验证 |
|---|---|---|
| P0 | 基线跑通 TUI/会话 | 手动冒烟 |
| P1 | Tier 1 裁剪 + 医学基础提示 + docs 转 md | `bun typecheck`、`bun run lint` |
| P2 | 领域表 + 迁移 + `MedicalFlow`/`MedicalStore` | 迁移脚本 + core 单测 |
| P3 | 工具 + 状态机 + 事件/projector | 状态机 gate/review/回溯单测 |
| P4 | flow.jsonc + 节点 agent/skill/command | 端到端 分诊→去向 |
| P5 | TUI 更名/患者栏/时间轴/复核弹窗 | 组件测试 + 手动 |
| P6 | API/事件/SDK 重生成 + TUI 桥接 | 端点集成测试 |
| P7 | 影像接口 + 审计 + 证据回链 | mock 影像端点测试 |
| P8 | Tier 3 清理与栈收敛 | 全量 typecheck + 回归 |

## 13. 验证方式

- 类型：各包目录内 `bun typecheck`（勿用 `tsc`）。
- Lint：仓库根 `bun run lint`。
- 迁移：`packages/core` 内 `bun run script/migration.ts --check`。
- 测试：**不能从仓库根跑**；在 `packages/opencode`、`packages/core` 等包目录内运行。
- 端到端：以 `OPENCODE_DB` 临时库跑一遍完整 episode 并断言审核/回溯事件。

## 14. 主要风险

1. 押注 V1 live 栈；迁 V2 需重建 TUI sync/event 与 SDK，成本高 → P0 起冻结 V2 新功能。
2. 门控过严拖慢临床 → `require_doctor_review` 虽默认强制，但门控细节（`required_inputs`、条件项）保持可配置，且支持 unavailable。
3. 上下文注入必须每轮重做，原始数据只进 DB/evidence，不进易被压缩的对话。
4. 回溯修改会引发下游陈旧 → 必须有 stale 传播与再评估提示。
5. Tier 3 深删影响上游同步 → 医学域保持低耦合，集中于新目录与明确 patch 点。
