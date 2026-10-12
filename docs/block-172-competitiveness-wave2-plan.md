---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W2 波「长程上下文与记忆」——CP-7 计量可感化（预算环真实水位+手动压缩+生成参数可配，DAG 建议先行=压缩与熔断的地基）/CP-5 loop 摘要式 auto-compact（丢前摘要+覆盖 agent loop fullMessages）/CP-6 记忆分层与项目记忆文件（AGENTS.md 等价+向量分片评估）；长任务质量地基波
acceptance:
  - CP-7：预算环实数刷新实机（SSE 用量事件→UI）；/compact 等价手动压缩可触发；temperature/max_tokens 用户可配（缺省不变）
  - CP-5：0.85 断路触发前先摘要再丢（摘要进 transcript 留证）；agent loop 的 fullMessages 接入 compaction 语义；长会话压缩前后任务连续性对比
  - CP-6：项目记忆文件注入实机（agent 可读、写入走治理门）；记忆分层评估结论落档；向量召回质量对比基线（top3 命中率）
  - closeout 十三门绿 + 总纲 §4 W2 行回写
reopen: 任一 CP 出口断言未达即该 CP 返工；波内零停顿条款沿用（用户 2026-10-12 /goal 整波授权连续行使）
status: active
---

# BLOCK-172 — 竞争力总纲 W2 波（长程上下文与记忆）

## 0. 来源与授权

- 总纲：[`agent-competitiveness-program.md`](./agent-competitiveness-program.md) §4-W2（CP-5/6/7）。
- 用户授权：2026-10-12 /goal「按照波次 逐个推进 能自己判断就自己判断 不需要问我」——整波授权+波内零停顿条款连续行使（W1 同款，plan=block-171-competitiveness-wave1-plan.md §0 先例）。
- 排序依据：总纲依赖 DAG「CP-7（软）→ CP-5/CP-18——真实计量是压缩决策与熔断的地基，建议先行」。

## 1. 范围（CP-7 → CP-5 → CP-6 串行）

### CP-7 计量可感化（先行，地基）
- ContextBudgetBar 真实水位：loop 已有 token 预算事件与 0.85 断路器实测口径（EWMA 校准），把用量经既有 task 事件流投影到预算环（替代 idle 占位 `—`）。
- 手动压缩：/compact 等价入口（斜杠命令）触发会话级 compaction（既有 conversation-compaction 管线）。
- temperature/max_tokens 用户可配：loop 硬编码 0.4/16384 → 设置面（缺省=现值，零行为变化）。

### CP-5 loop 摘要式 auto-compact
- 0.85 断路器触发时：先对将丢弃历史生成摘要（走既有模型通道，摘要原文进 io-transcript 留证=可审计压缩）再修剪。
- compaction 语义接入 agent loop 的 fullMessages（现仅覆盖 chat 历史拼装路径）。

### CP-6 记忆分层与项目记忆文件
- 项目记忆文件（AGENTS.md 等价）：workspace 根记忆文件注入 system prompt（有界）；写入走治理门（工具化，非任意写）。
- 向量分片索引评估（chunk>50k 仅告警现状）；记忆分层（episodic/semantic）评估结论落档（实施视结论另裁）。
- 召回质量对比基线（分片前后 top3 命中率）。

## 2. 非范围

- 成本硬熔断（W6 CP-18）；联邦/Gen UI（W4/W6）；跨会话持久记忆格式重设计（CP-6 评估结论另裁）；G1+ 不外推。

## 3. 门禁与完成语义

每 CP：定向红绿+tsc+lint+涉 UI 加 build。波末：closeout 十三门+实机断言（acceptance/block-172/）+UI 台账。四 CP 出口全过+closeout 绿=completed；总纲 §4 W2 行回写。
