# AcuFlow 人工测试样例：转移性右下腹痛（急性阑尾炎）

本文件用于人工模拟 AcuFlow 的真实使用场景。它对应可执行回归测试
`packages/core/test/medical-scenario.test.ts`（不调用模型，直接驱动状态机）。

## 虚构病例

- 患者：男，52 岁（1974-03-02），72 kg。
- 主诉：转移性右下腹痛 18 小时，伴发热、恶心、食欲差。
- 过敏：青霉素。
- 既往：体健，无腹部手术史。

诊断路径：`分诊 → 问诊查体 → 第一批检验 → 影像及会诊 → 治疗留观 → 去向决策`。

## 启动

```bash
# 在 WSL 中
export PATH="$HOME/.bun/bin:$PATH"
cd /home/zjc/projects/opencode/packages/opencode
tmux new-session -d -s acuflow-dev 'bun dev'
tmux attach -t acuflow-dev          # 或直接在终端前台运行 bun dev
```

默认 agent 是 `acuflow`。新建会话后，按下面的对话逐步输入（可直接复制）。

---

## 节点 1：分诊、首次接诊

**你输入：**

> 新接诊一位患者。男，52 岁，1974-03-02 生，72 公斤，青霉素过敏。主诉转移性右下腹痛，伴发热恶心。生命体征 T 38.2℃、HR 102、BP 118/72、RR 20、SpO2 98%，意识清醒。

**预期 agent 行为：**
1. 调用 `episode_start`（登记患者、绑定本会话、进入 `triage`）；系统会从你的原话中自动抽取已提及的信息项。
2. 调用 `episode_status`，发现仍缺少“起病时间”等尚未提及项，**必须向你追问**（不得直接输出临床结论或提交草案）。
3. 你补充后，用 `clinical_record` 记录（或继续由系统自动抽取）。

**你补充：**

> 起病 18 小时前，脐周隐痛后转移至右下腹。重点病史：既往体健，无腹部手术史、无抗凝药。

**agent 产出草案（`flow_submit_draft`）**，例如：

```json
{
  "fields": { "suspected": "急性阑尾炎", "urgency": "high", "immediateReview": false },
  "summary": "青年男性转移性右下腹痛伴发热，考虑急性阑尾炎，需急诊评估，暂无需立即床旁抢救。"
}
```

**你确认：** 输入“确认”。→ 节点完成，进入 `history_exam`。

---

## 节点 2：问诊、查体完成

**你输入：**

> 疼痛由脐周转移至右下腹，伴恶心、食欲差，无呕吐腹泻。查体麦氏点压痛、反跳痛、肌紧张。既往手术无，用药无抗凝药，过敏青霉素。患者男性，妊娠可能不适用。

**agent 行为：** `clinical_record` 记录各项；“妊娠可能”用 `flow_mark_unavailable` 标记无法获取（不伪造数据）。随后提交草案。

**你确认。** → 进入 `labs`。

> 想测试驳回：此时先输入“驳回，理由：腹膜刺激征描述不完整”，agent 应回到采集中；补充后再次提交。

---

## 节点 3：第一批检验返回

**你输入：**

> 检验回报：血常规 WBC 15.2、中性粒 88%；生化大致正常；肝胆胰指标正常；凝血正常；血气乳酸 2.1；尿常规阴性。妊娠相关检验不适用。

**agent 行为：** 记录检验并标记“妊娠相关检验”unavailable；提交草案：

```json
{ "fields": { "wbc": 15.2, "lactate": 2.1 }, "summary": "白细胞升高，乳酸轻度升高，余无特殊。" }
```

**你确认。** → 进入 `imaging_consult`。

---

## 节点 4：影像及会诊结果返回（演示医生修改）

**你输入：**

> 腹部 CT：阑尾增粗、周围渗出。影像 AI 分析支持急性阑尾炎。普外科会诊建议手术。

**agent 提交草案：** `severity = uncomplicated`，summary 为“CT 与临床一致，支持急性阑尾炎。”

**你不直接确认，而是修改：**

> 修改结论：补充处理计划，诊断为急性阑尾炎（uncomplicated），建议急诊腹腔镜阑尾切除。

**agent 行为：** 以 `flow_review(decision="edit")` 落稿，保留 agent 原稿与医生修订版及差异。→ 进入 `treatment_observation`。

> 验证点：`node_revision` 与 `audit_log` 均记录医生编辑；最终产出 `output_final` 为医生版本。

---

## 节点 5：治疗、留观期间

**你输入：**

> 已给头孢 + 甲硝唑，补液 1000 ml，无引流。疼痛较前缓解，T 37.6℃，HR 92，BP 120/76。

**agent 提交草案并确认。** → 进入 `disposition`。

---

## 节点 6：住院、转院、出院前

**你输入：**

> 最新状态平稳，无未解决问题，待回报病理，随访条件具备。去向：转入普外科行手术治疗。

**agent 提交草案并确认。** → episode 关闭，时间轴全部完成。

---

## 演示回溯修改（stale 传播）

> 回到检验节点，复读血常规白细胞应为 18.4，原因：检验复读结果更正。

**预期：** agent 调用 `flow.amend`，更新检验节点最终结论；其后已确认的影像/治疗/去向节点被标记 `stale`，并在时间轴与审计中体现。你应要求 agent 对下游节点重新评估。

## 查看证据与时间轴

随时可输入：

> 查看当前节点状态和时间轴。

agent 会调用 `episode_status` 返回：所在节点、待补充项、`canSubmit`、以及全部节点的状态与最终结论。也可让它 `clinical_query` 回看检验/影像原始记录。

---

## 命令与技能（P4）与复核按钮（P6）

- 每个节点都有对应命令：`/triage`、`/history`、`/labs`、`/imaging`、`/treatment`、`/disposition`；`/acuflow-status` 查看时间轴。
- agent 进入节点时会加载对应技能（如 `triage-knowledge`、`labs-knowledge`）。
- 流程可由 `.opencode/acuflow/flow.json` 自定义（节点、必需信息、同义词）；共享指南在 `.opencode/acuflow/guidelines/*.md`。详见 `.opencode/acuflow/README.md`。
- **节点产出后**，会话底部会出现复核条（也可用鼠标点击）：
  - `ctrl+y` 确认 → 节点完成，进入下一节点；
  - `ctrl+e` 修改 → 弹出编辑框，改完提交（保留原稿与医生版本）；
  - `ctrl+r` 驳回 → 回到本节点继续讨论。

## 无模型快速自检

不启动 TUI 也能验证同一场景：

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /home/zjc/projects/opencode/packages/core
bun test test/medical-scenario.test.ts test/medical.test.ts
```

覆盖：缺失信息门控、unavailable、确认推进、医生修改、驳回、回溯 stale 传播。
