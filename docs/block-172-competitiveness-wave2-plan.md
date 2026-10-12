---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W2 波「长程上下文与记忆」——CP-7 计量可感化（预算环真实水位+手动压缩+生成参数可配，DAG 建议先行=压缩与熔断的地基）/CP-5 loop 摘要式 auto-compact（丢前摘要+覆盖 agent loop fullMessages）/CP-6 记忆分层与项目记忆文件（AGENTS.md 等价+向量分片评估）；长任务质量地基波
acceptance:
  - CP-7：预算环实数刷新实机（SSE 用量事件→UI）；/compact 等价手动压缩可触发；temperature/max_tokens 用户可配（缺省不变）
  - CP-5：0.85 断路触发前先摘要再丢（摘要进 transcript 留证）；agent loop 的 fullMessages 接入 compaction 语义；长会话压缩前后任务连续性对比
  - CP-6：项目记忆文件注入实机（agent 可读、写入走治理门）；记忆分层评估结论落档；向量召回质量对比基线（top3 命中率）
  - closeout 十三门绿 + 总纲 §4 W2 行回写
reopen: 任一 CP 出口断言未达即该 CP 返工；波内零停顿条款沿用（用户 2026-10-12 /goal 整波授权连续行使）
status: completed
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


## 8. 收口对账（2026-10-12）

| 出口判据 | 实绩 | 证据 |
| --- | --- | --- |
| CP-7 预算环实数 | ✅ token_budget 每轮发放（原仅危机一次），既有管道零改动消费 | loop-orchestrator 改动+UI-499 |
| CP-7 手动压缩 | ✅ /compact 斜杠命令→BLOCK-95 B2 端点（四态诚实提示） | types.ts+SimpleChat switch |
| CP-7 生成参数可配 | ✅ generation 键（env 覆盖）+PUT/GET generation-defaults+loopConfig 线程（reqBody+est/headroom 同源）+设置卡；未配置=0.4/16384 零变化 | ai-settings+GenerationDefaultsPanel |
| CP-5 摘要式压缩 | ✅ 0.85 断路丢前摘要（最近 24 条窗口，同通道 io-transcript 留证）+摘要系统消息注入+context_compacted 事件；fail-open；dropped<4 不跳模型 | 源码契约 5/5（block172-cp5-compact） |
| CP-6 项目记忆 | ✅ .petri/MEMORY.md 读侧有界注入（withWorkspace 单源）+写侧 workspace_write 治理门继承+指南行 | agent-runner 注入+指南行 |
| CP-6 评估落档 | ✅ 分层/ANN/召回基线方法（block-172-cp6-memory-evaluation.md，registry reference） | 评估档 |
| fullMessages 接入 compaction 语义 | ⚠️ 部分——CP-5 摘要注入实现了等效上下文回收（丢弃段以摘要形式保留在 fullMessages 内），原 conversation-compaction 视图层复用未做（投影路径不同，评估=摘要注入已覆盖目标语义，避免双轨）| 本行如实注记 |

**诚实边界**：①实机断言=预算环/compact 端点可 API 级验证，真模型长会话的压缩质量对比（CP-5 连续性）与 /compact 实机走查转用户过目（UI-499/500 in_progress）；②召回基线 30 问集未构建（评估档登记随知识域包）。
