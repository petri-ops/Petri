---
capability: block-331-tool-output-and-list-scale
status: completed
goal: 按用户裁决「先实测量化再定形，不硬造」处理 C-14（工具输出压缩）与 C-01（长列表虚拟化）：先产出可复核测量，再由数字决定形态（含「不做」这个结论）。
acceptance:
  - 测量腿 scripts/block331-tool-output-measure.mjs → acceptance/block-331/tool-output-measure.json：6 类真实形态样本经模型可见出口，单条 290–1500 tokens；60 次工具调用 ≈ 52110 tokens（64k 窗口 79.5%）；与 computeContextBreakdown 的 toolResults 同量级对账。
  - 契约 test/block331-tool-result-compaction.test.mjs 5/5：超限结果头尾双保留 + 精确省略字符数 + 合法 JSON；未超限逐字节不变；exec 尾部优先不变；极小预算退化仍有界；测量证据在册可回读。
  - 邻域回归 test/agent-tool-result.test.mjs 15/15（1 skip=未装 deseq2 包，存量）+ 前端 DOM 棘轮 1/1（user 7 / assistant 42 节点 ≤60）。
  - 决策落地：不引入压缩器（单条已有硬上限）、不引入虚拟化依赖（重开条件量化），只做「超限摘要头尾双保留」与「每行 DOM 节点棘轮」两处真修复/防线。
reopen: C-14=单轮工具结果 tokens > 窗口 50% 的真实会话（候选：按轮次渐进压缩）；C-01=真实会话 ≥400 条 + 用户卡顿或 DOM 节点 >10k（首选零依赖 content-visibility + contain-intrinsic-size，先做滚动锚定回归）。
---

# BLOCK-331 — 工具输出压缩（C-14）与长列表虚拟化（C-01）· 先量后定形

状态：**completed（2026-11-02 当日立项当日收口；两项均按"先实测量化再定形、不硬造"交付）**
truthDomain：`block-331-tool-output-and-list-scale`
canonical 入口：本文件
关联：`docs/pending-work-backlog.md` C-14 / C-01 候选（重开条件见 §5）

## 1. 裁决来源与切入方式

用户 2026-11-02：「其它几项都确定开整」——其中 D 项=C-14（RTK 型工具输出压缩）+ C-01（长列表虚拟化）。
两项原重开条件**都未触发**（C-14=实测 token 痛点 + ZCode hooks 适配；C-01=用户实测卡顿报告）。裁决给的切入方式是"以尊重条件的方式切入：先实测量化再定形，不硬造"，因此本包的交付物=**测量 + 由测量决定的形态**，不是"把两个候选都实现成最大形态"。

## 2. C-14：测量结论与形态

### 2.1 测什么、怎么测

`scripts/block331-tool-output-measure.mjs`（可重复执行）把 6 个按真实工具返回形态构造的样本（构建日志 / git diff / 大 JSON / MCP 大载荷 / 搜索命中 / 目录列表）喂进**真实模型可见出口** `serializeToolResultForModel`，并在每个样本头/尾各埋哨兵串，据此判定"截断是保留信息还是丢弃信息"。

语料诚实标注：本机没有历史会话库（桌面版 userData 从未落过数据），样本是构造的，只用于"机制是否丢信息"与"量级"判断，**不冒充线上分布**。

证据：`acceptance/block-331/tool-output-measure.json`。

### 2.2 实测数字（darwin-arm64，`MODEL_RESULT_LIMIT=6000` chars）

| 样本 | 源 chars | 模型可见 chars | tokens | 头保留 | 尾保留 |
| --- | --- | --- | --- | --- | --- |
| exec_build_log（2000 行，末尾报错） | 59207 | 2145 | 537 | ✗ | ✓ |
| exec_git_diff（3000 行） | 128200 | 2124 | 531 | ✗ | ✓ |
| run_tool 大结果（40k） | 48104 | 5999 | 1500 | ✓ | ✓（本包修） |
| mcp 大载荷（44k） | 44608 | 6000 | 1500 | ✓ | ✓（本包修） |
| workspace_search（120 命中→12 条） | 7087 | 1159 | 290 | ✓ | ✗（按设计投影） |
| workspace_list（300 条目→40 条） | 22857 | 3412 | 853 | — | — |

单轮累积：6 类各来一次 ≈ **5211 tokens（64k 窗口 8.0%）**；各来十次（60 次工具调用）≈ **52110 tokens（64k 的 79.5% / 128k 的 39.8%）**。既有计量面对账：`computeContextBreakdown` 的 `toolResults` = 5235，与逐条求和 5211 同量级（口径未漂移）。

### 2.3 由数字定出的形态

1. **单条结果本来就有硬上限**（341–1500 tokens/条），所以"RTK 型压缩器"在**单条**维度上没有可压缩空间——不做。真实成本驱动是**单轮调用次数**（`MAX_AGENT_ITERS=Infinity`，工具结果不跨轮回放，只在本次 turn 的 messages 里累积），这不是压缩器能解决的：再压就是把 agent 自己要来的内容丢掉。
2. 但测出一个**真缺陷**：通用超限路径（`fitValidJson`）原本 `dataSummary = dataText.slice(0, room)`——**只留头，尾巴整段丢**；而 shell/构建/JSON 的关键信息常在尾部。本包改为**头 40% + 尾 60% + 带精确省略字符数的标记**（`…[省略 N 字符，原文见工具执行记录]…`），模型可据此判断是否用更窄的参数重跑。原文仍完整留在 `tool_trace_store` / `tool_jobs` 执行记录里可回读（审计留痕不丢）。
3. `workspace_exec` 投影**保持尾部优先**（`stdoutTail`）不动：shell 的结论在尾部，改成头尾混合会同时增加 token 并模糊字段语义；该不对称是**故意的**，契约测显式钉住。

## 3. C-01：测量结论与形态

### 3.1 测什么

`frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.domBudget.test.tsx` 渲染真实消息行组件并数 DOM 节点（`querySelectorAll('*').length`，与 DOM Inspector "Total nodes" 同量纲），把"每行节点数"钉成棘轮。

### 3.2 实测数字

- user 行 **7 节点**；assistant 行 **42 节点**（预算 60）。
- 线性外推：100 条 ≈ 4200 节点；**500 条 ≈ 21000 节点**（Chromium 经验掉帧阈值 ~10000）；1000 条 ≈ 42000。
- 缺的那一半：本机取不到真实会话长度分布（无 userData 数据），所以"什么时候会到 500 条"无法实测。

### 3.3 由数字定出的形态

**不引入依赖、不做虚拟化**（`react-virtuoso` 属 DEPENDENCY-CHANGE-CHECKLIST「默认 no，需用户裁决」；2026-09-25 勘察的 cv-vs-prepend 锚定结构性冲突仍在）。理由：重开条件（用户实测卡顿）未触发，而外推到 500 条只是"有可能"，不是"已发生"；在自动滚底的聊天面上做锚定改造，回归风险高于当前收益。

保留的机械面：**每行 ≤60 节点棘轮**，防止"顺手加个嵌套"让 500 条会话的节点数悄悄翻倍而无人发现——这条不需要依赖，也不改变任何渲染行为。

## 4. 非范围

- 不引入任何新依赖（无 `react-virtuoso`、无 tiktoken 之外的 tokenizer）。
- 不做按轮次/按 token 预算的渐进压缩（会破坏前缀复用与 tool_call 链完整性，属另案）。
- 不改 `message-trimmer` 的降级策略（"工具结果永不跨轮回放"是既有事实，本包只测量它）。
- 不改 `workspace_exec` 的 `stdoutTail` 语义。

## 5. 重开条件（量化）

- **C-14 二次重开**：出现"单轮工具结果 tokens > 窗口 50%"的真实会话（用 `token_budget` 的 `toolResults` 分类读），届时考虑按轮次渐进压缩（而不是按单条压缩）。
- **C-01 重开**：真实会话 ≥400 条且用户报告滚动卡顿，或 DOM 节点数实测 >10k。第一选择=**零依赖的 `content-visibility: auto` + `contain-intrinsic-size`**（风险：滚动锚定与估计高度跳动，需先做锚定回归）；仍不够再走依赖裁决。

## 6. 验收门禁与证据

| 门禁 | 结果 |
| --- | --- |
| `node --test test/block331-tool-result-compaction.test.mjs` | **5/5**（头尾双保留 + 精确省略数 + 合法 JSON / 未超限逐字节不变 / exec 尾部优先不变 / 极小预算退化仍有界 / 测量证据在册可回读） |
| `node --test test/agent-tool-result.test.mjs` | 15 pass + 1 skip（skip=未装 deseq2 包，存量） |
| `node scripts/block331-tool-output-measure.mjs` | 产出 `acceptance/block-331/tool-output-measure.json`，数字见 §2.2 |
| `npx vitest run SimpleChatMessageRow.domBudget.test.tsx` | 1/1（行节点数 7/42 ≤ 60，外推打印） |

G0 开发期常态 · 不外推 packaged/Provider/GA。
