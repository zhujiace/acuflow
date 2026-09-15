# AcuFlow · 医疗诊断辅助系统

> 面向成人**非创伤性急腹症**（急性腹痛）的固定流程临床决策辅助系统。
> AcuFlow 与执业医师协同工作：系统按固定流程采集信息、提示缺失项、给出建议；**最终判断与决策始终由医生完成**。

本仓库是基于开源项目 [opencode](https://github.com/anomalyco/opencode) 二次开发的医疗分支（`minimal-agent` 构建）。它保留 opencode 的终端交互（TUI）以及 agent / 技能 / 工具 / 权限框架，并将工作流替换为 AcuFlow 的急腹症诊疗流程。

> ⚠️ **免责声明**
> AcuFlow 仅用于科研、教学与流程演示，**不能替代医生的临床判断**，不得作为唯一的诊疗依据。
> 所有临床决策与治疗执行必须由具备资质的医师作出。正式上线前请完成伦理审查与数据安全评审。

---

## 目录

- [一、项目简介](#一项目简介)
- [二、给临床医护人员：安装与使用教程](#二给临床医护人员安装与使用教程)
- [三、给医学开发人员：流程 / 提示词 / 知识库配置接口](#三给医学开发人员流程--提示词--知识库配置接口)
- [四、本地开发与测试](#四本地开发与测试)
- [五、许可与出处](#五许可与出处)

---

## 一、项目简介

### 工作流程（六个固定节点）

一次诊疗称为一个 **episode**，按顺序经过六个节点。每个节点都必须先补齐「需要采集的信息」，再由医生确认后才能进入下一节点。

| 顺序 | 节点 `key` | 名称 | 需要采集的信息（`requiredInputs`） |
|---|---|---|---|
| 0 | `triage` | 分诊、首次接诊 | 主诉、起病时间、生命体征、意识、重点病史 |
| 1 | `history_exam` | 问诊、查体完成 | 症状特点、腹部体征、既往手术、用药、过敏、妊娠可能 |
| 2 | `labs` | 第一批检验返回 | 血常规、生化、肝胆胰指标、凝血、血气及乳酸、尿液、妊娠相关检验 |
| 3 | `imaging_consult` | 影像及会诊结果返回 | 影像报告、影像分析、会诊意见 |
| 4 | `treatment_observation` | 治疗、留观期间 | 给药、补液、引流、疼痛变化、生命体征趋势 |
| 5 | `disposition` | 住院、转院、出院前 | 最新状态、未解决问题、待回报结果、随访条件 |

### 核心特性

- **固定流程 + 硬门控**：信息不全不允许产出结论；未获医生确认不允许推进节点。
- **医生全程主导**：agent 只给建议，确认 / 修改 / 驳回都由医生完成。
- **证据可追溯**：检验、影像、会诊等原始记录持久化保存，可随时回看；每次确认 / 修改 / 驳回都写入审计日志与修订记录。
- **三态区分**：「未采集」「阴性」「客观无法获取」严格区分，绝不臆造数值。
- **回溯修改**：修改已确认的历史节点时，其下游节点会被标记为「过期（stale）」并提示重新评估。
- **配置驱动**：节点、提示词、知识库、指南都可由医学人员在配置文件中修改，无需改代码（详见第三节）。

### 一次 episode 的状态流转

```
待开始(pending) → 采集中(gathering) → 待复核(ready_for_review) → 已确认(confirmed) → 完成(completed) → 下一节点
                         ↑____________________ 驳回 ____________________|
                                              回溯：已确认 → 过期(stale) → 重新评估
```

---

## 二、给临床医护人员：安装与使用教程

> 本节假设你**不熟悉计算机操作**。请严格按顺序执行；每一步都给出了「预期结果」，若与预期不符，请查阅本节末尾的[常见问题](#9-常见问题)。

### 1. 运行环境

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10/11、macOS 或 Linux |
| 网络 | 需要联网（访问大模型服务） |
| 显示 | 建议 15 英寸以上屏幕，终端窗口尽量全屏 |
| 其他 | 无需额外安装数据库等组件（内置本地存储） |

### 2. 安装

**第 1 步：安装 Bun（运行时环境，只需一次）**

- Windows：打开「开始菜单」搜索 **PowerShell** → 右键「以管理员身份运行」→ 粘贴并回车：

  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```

- macOS / Linux：打开「终端」→ 粘贴并回车：

  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

安装完成后**关闭并重新打开**终端，输入以下命令验证，应显示类似 `1.3.x`：

```bash
bun --version
```

**第 2 步：获取 AcuFlow 代码**

- 若已获得 Git 访问权限：

  ```bash
  git clone -b minimal-agent https://github.com/zhujiace/acuflow.git acuflow
  ```

- 或直接解压获取到的 `acuflow.zip`（假设解压到 `acuflow` 文件夹）。

**第 3 步：安装依赖**

```bash
cd acuflow
bun install
```

> 首次执行会下载依赖，视网络情况需要几分钟。看到没有红色报错即成功。

### 3. 配置大模型（首次使用）

AcuFlow 需要连接一个大模型服务（医院内网关或公有云均可）。配置只需做一次：

1. 启动 AcuFlow（见下一步），你会看到一个深色终端界面。
2. 在底部输入框输入 `/connect` 并回车，选择你的模型提供商，按屏幕提示粘贴 **API Key**。
3. 输入 `/models`，从列表中选择要使用的模型。
4. 配置会自动保存，下次启动无需重复。

### 4. 启动

在 `acuflow` 文件夹中执行：

```bash
bun run dev
```

看到带有 **ACUFLOW** 字样和副标题「AcuFlow · 医疗诊断辅助系统」的欢迎界面即启动成功。

> 提示：默认 agent 已经是 AcuFlow 主协调助手，无需手动切换。
> （可选）也可以构建独立可执行文件：进入 `packages/opencode` 目录后执行 `bun run build --single`，产物位于 `packages/opencode/dist/` 下。

### 5. 开始一次诊疗（episode）

在输入框中**用自然语言描述患者**即可，系统会自动登记患者、绑定本次会话并进入「分诊」节点。

**示例（分诊）：**

> 新接诊一位患者。男，52 岁，1974-03-02 生，72 公斤，青霉素过敏。主诉转移性右下腹痛，伴发热恶心。生命体征 T 38.2℃、HR 102、BP 118/72、RR 20、SpO2 98%，意识清醒。

**AcuFlow 会：**

1. 调用 `episode_start` 登记患者并进入分诊节点；
2. 若你提供的信息不完整，列出「**待补充信息**」清单，逐项向你追问；
3. 信息齐全后给出节点结论草案，等待你确认。

**你补充信息：**

> 起病 18 小时前，脐周隐痛后转移至右下腹。重点病史：既往体健，无腹部手术史、无抗凝药。

**某信息客观无法获取时**，直接说明，例如：

> 患者为男性，妊娠相关检验无法获取。

系统会记录为「无法获取」，而**不会**伪造数据。

### 6. 节点复核：确认 / 修改 / 驳回

当某个节点产出结论后，会话底部会出现**复核条**，你可以用鼠标点击，也可以使用快捷键：

| 操作 | 快捷键 | 说明 |
|---|---|---|
| 确认 | `Ctrl` + `Y` | 接受当前结论，节点完成，进入下一节点 |
| 修改 | `Ctrl` + `E` | 弹出编辑框，修改结构化字段与文字结论；系统会保留原稿与医生修订版及差异 |
| 驳回 | `Ctrl` + `R` | 退回本节点继续讨论（可附理由） |

也可以直接在对话里说：

> 确认

> 修改结论：补充处理计划，建议急诊腹腔镜阑尾切除。

> 驳回，理由：腹膜刺激征描述不完整。

### 7. 查看时间轴与证据

随时可以输入：

> 查看当前节点状态和时间轴。

或使用命令 `/acuflow-status`。系统会显示所在节点、待补充项、是否可提交，以及全部节点的状态与最终结论。

需要回看检验 / 影像原始记录时，可以说：

> 回看检验的原始记录。

### 8. 回溯修改（下游会标记为「过期」）

如果发现某个**已确认**节点的内容需要更正，例如检验复读结果：

> 回到检验节点，复读血常规白细胞应为 18.4，原因：检验复读结果更正。

系统会更新该节点，并把其**之后**已确认的节点标记为「过期（stale）」，提示你重新评估。建议随后逐个复核并确认下游节点。

### 9. 常见问题

| 现象 | 处理办法 |
|---|---|
| 启动后没有模型、无法回答 | 输入 `/connect` 配置提供商与 API Key；再输入 `/models` 选择模型 |
| 一直提示「待补充信息」 | 这是正常的门控行为，按清单逐项补充即可；确实拿不到的信息直接说明无法获取 |
| 想让系统直接给出结论 | 流程强制医生确认，这是安全设计；门控细节可在配置中调整 |
| 想更正中途的结论 | 对**未确认**节点用「驳回 / 修改」；对**已确认**节点用「回溯修改」 |
| 数据保存在哪里 | 保存在本机数据库（与对话历史分离），不会因对话压缩而丢失；退出后仍可查询 |
| 提示某信息无法获取 | 直接说明「XX 无法获取」，系统会按「无法获取」记录，不伪造数据 |
| 界面显示错乱 | 将终端窗口最大化后重开；或换用 Windows Terminal / iTerm 等现代终端 |

---

## 三、给医学开发人员：流程 / 提示词 / 知识库配置接口

AcuFlow 的诊疗流程与知识**由配置文件定义，无需改代码**。所有配置文件位于项目根目录的 `.opencode/` 与 `docs/` 下。

### 配置目录总览

```
.opencode/
  opencode.jsonc                     # 默认 agent 与 instructions 注入（一般不改）
  acuflow/
    flow.json                        # ① 节点流程：节点、必需信息、同义词
    guidelines/*.md                  # ④ 共享临床指南（每轮注入系统上下文）
    imaging.json                     # ⑥ 影像模型接口配置（默认关闭）
  agent/<node>.md                    # ② 各节点 subagent 的 prompt
  skills/<node>-knowledge/SKILL.md   # ③ 各节点知识库
  command/<name>.md                  # ⑤ 手动命令（/triage、/labs 等）
docs/acuflow-guidelines/*.md         # 共享指南 / 需求（同为 instructions）

packages/opencode/src/agent/prompt/acuflow.txt   # 主协调 agent 的 prompt（内置）
docs/acuflow-scenarios/acute-appendicitis.md     # 人工测试用例
packages/core/test/medical-scenario.test.ts      # 可执行回归测试
```

### ① 节点流程：`.opencode/acuflow/flow.json`

`episode_start` 时会读取本文件并绑定到本次 episode；文件不存在时使用内置默认流程。每个节点字段：

| 字段 | 说明 |
|---|---|
| `key` | 节点标识，必须是 `triage` / `history_exam` / `labs` / `imaging_consult` / `treatment_observation` / `disposition` 之一 |
| `seq` | 顺序（从 0 递增），决定推进顺序 |
| `title` | 界面展示名称 |
| `entryAgent` | 该节点默认使用的 agent（默认全部为 `acuflow` 主协调；也可改为 `agent/` 下的专用 subagent，如 `triage`） |
| `requiredInputs` | 本节点必须收集的信息项；缺失时 agent 会追问，信息不足不能提交产出 |
| `synonyms` | 每个信息项的同义词 / 关键词，用于从医生原话中自动识别已提供的信息，避免重复追问 |

示例（为分诊节点新增一个强制项「末次进食时间」）：

```json
{
  "key": "triage",
  "seq": 0,
  "title": "分诊、首次接诊",
  "entryAgent": "acuflow",
  "requiredInputs": ["主诉", "起病时间", "生命体征", "意识", "重点病史", "末次进食时间"],
  "synonyms": {
    "末次进食时间": ["进食", "禁食", "最后进食", "末次进食"]
  }
}
```

> 修改 `flow.json` 后，**新建 episode 时生效**（已开始的 episode 保持其绑定的流程）。

### ② 节点 Prompt：`.opencode/agent/<node>.md`

每个节点可有一个专用 subagent，文件正文即该节点的提示词，frontmatter 控制权限：

```markdown
---
description: 分诊/首次接诊节点专用 subagent。聚焦危险信号识别与首诊信息补齐。
mode: subagent
permission:
  skill:
    "*": deny
    "triage-knowledge": allow   # 只允许加载本节点知识库
  read: allow
  task: deny
  todowrite: deny
---

你是 AcuFlow 的分诊节点助手。只在“分诊、首次接诊”节点工作。
...
```

- 文件名（不含 `.md`）即 agent 名称，例如 `triage.md` → agent `triage`。
- 想在某节点使用专用 subagent，把 `flow.json` 中该节点的 `entryAgent` 改为对应名称。
- **主协调 agent** 的提示词是内置的：`packages/opencode/src/agent/prompt/acuflow.txt`。修改它属于改代码，需要重新构建 / 重启。

### ③ 节点知识库：`.opencode/skills/<node>-knowledge/SKILL.md`

每个节点对应一个技能目录，`SKILL.md` 的 frontmatter 必须包含 `name` 与 `description`：

```markdown
---
name: triage-knowledge
description: 分诊/首次接诊节点的知识：危险信号优先识别、主诉与起病时间、生命体征与意识、重点病史，以及是否需立即床旁评估。
---

# 分诊、首次接诊
## 目标产出
- ...
## 危险信号（先于资料齐全）
- ...
## 必须追问
- ...
```

- 技能目录下可放 `reference/`、`scripts/` 等同级文件，`skill` 工具会按需列给模型读取。
- 节点 subagent 通过 `permission.skill` 白名单**只加载本节点的知识**（见上一条示例的 `triage-knowledge: allow`）。
- 现有技能：`triage-knowledge`、`history-exam-knowledge`、`labs-knowledge`、`imaging-consult-knowledge`、`treatment-observation-knowledge`、`disposition-knowledge`。

### ④ 共享临床指南：`.opencode/acuflow/guidelines/*.md`

这些文件会被**每一轮注入**系统上下文（不区分节点）。适合放跨节点的通用内容，如危险信号、鉴别诊断、治疗范围等：

```
.opencode/acuflow/guidelines/
  red-flags.md          # 急腹症危险信号（共享指南）
  differential.md       # 鉴别诊断
  treatment-scope.md    # 治疗范围与原则
```

同时，`docs/acuflow-guidelines/*.md` 也会作为 instructions 注入。两处路径在 `.opencode/opencode.jsonc` 中配置：

```jsonc
"instructions": ["docs/acuflow-guidelines/*.md", ".opencode/acuflow/guidelines/*.md"]
```

### ⑤ 手动命令：`.opencode/command/<name>.md`

在输入框输入 `/triage`、`/labs` 等可让 agent 聚焦当前或指定节点：

```markdown
---
description: 聚焦分诊节点，检查缺失信息并推进
agent: acuflow
---

调用 `episode_status`。若尚未开始 episode，先请我提供患者基本信息并用 `episode_start` 登记。
...
```

现有命令：`/triage`、`/history`、`/labs`、`/imaging`、`/treatment`、`/disposition`、`/acuflow-status`。

### ⑥ 主协调 Prompt 与影像接口

- **主协调 Prompt**：`packages/opencode/src/agent/prompt/acuflow.txt`（内置）。它规定了「每轮必须调用 `episode_status`、信息不全只列待补充、信息齐全才提交草案、只由 `flow_review` 推进」等硬性规则。
- **影像分析接口**：`imaging_analyze` 工具已提供，但**默认不启用**。仅当 `.opencode/acuflow/imaging.json` 中 `enabled: true` 且配置了 `endpoint` 时才会真正调用影像模型；否则只返回“未启用”，不做任何外部调用。

```json
{
  "enabled": false,
  "provider": "http",
  "endpoint": "",
  "model": "",
  "timeoutMs": 15000,
  "routing": {}
}
```

### ⑦ 改动如何生效 & 如何验证

- `flow.json`：**新建 episode 时**读取生效。
- `agent/*.md`、`skills/*/SKILL.md`、`command/*.md`、`guidelines/*.md`：新会话或下一次注入时生效；不确定时重启 AcuFlow。
- 建议每次修改后运行回归测试（不调用模型，直接驱动状态机）：

  ```bash
  cd packages/core
  bun test test/medical-scenario.test.ts test/medical.test.ts
  ```

- 人工走查脚本见 `docs/acuflow-scenarios/acute-appendicitis.md`（转移性右下腹痛 / 急性阑尾炎的完整对话样例）。

### 数据与审计

- 患者、节点、原始证据、审计日志、修订记录持久化在数据库（Drizzle / SQLite）。
- 审计与证据可通过 `medical_audit`、`clinical_query` 工具查询；TUI 侧读取服务端 `/medical/view` 与 `/medical/evidence`。
- 表结构见 `packages/core/src/medical/sql.ts`；迁移见 `packages/core/src/database/migration/20260913175104_add-medical-domain.ts`。

---

## 四、本地开发与测试

> 以下命令需在**仓库目录内**执行。

| 目的 | 命令 |
|---|---|
| 安装依赖 | `bun install` |
| 启动 TUI | `bun run dev` |
| 代码检查 | `bun run lint` |
| 类型检查 | `bun turbo typecheck`（或在某个包目录内 `bun typecheck`，使用 `tsgo`，不要用 `tsc`） |
| 医学域回归测试 | `cd packages/core && bun test test/medical.test.ts test/medical-scenario.test.ts` |
| 数据库迁移 | `cd packages/core && bun run script/migration.ts --name <name>`（校验用 `--check`） |
| 构建独立可执行文件 | `cd packages/opencode && bun run build --single`，产物在 `packages/opencode/dist/` |

注意事项：

- **不要在仓库根目录直接运行 `bun test`**（会被守卫脚本拒绝）；请在具体包目录内运行。
- 不要手改生成的 SDK 产物；需要时按 `AGENTS.md` 的说明重新生成。

---

## 五、许可与出处

- 本项目基于开源项目 **opencode** 二次开发，遵循其 **MIT License**（见 [`LICENSE`](./LICENSE)）。
- AcuFlow 是独立的医疗领域分支，与 opencode 官方团队无隶属关系。
- 所有临床指南与知识内容仅用于演示，**不替代临床判断**。
