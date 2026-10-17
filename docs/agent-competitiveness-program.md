---
capability: agent-competitiveness
goal: 以行业竞争力标尺（ZCode/Codex 桌面 agent 形态）取代 G0 内部天花板作为新量尺，把 Petri 从「G0 内部满级」推到「通用 agent 第一梯队 + 本地主权独有形态」——agent 通用能力（推理循环/上下文记忆/编排多智能体/治理信任/呈现交互）为主线核心，六波 19 个候选包（CP-1~CP-19）承载，借形长出自有形态（本地可审计/治理透明/证据自证/场景锚点）
acceptance:
  - 方向级验收 = 各波以独立工作包立项后按其 plan 验收为准（本文件不承载运行时证据）
  - 总纲达成判据 = §4 六波出口判据逐项被收口包证据覆盖，或经用户显式裁决出籍
reopen: 波次启动逐波用户发令（单工作包串行不变；波内零停顿沿用 blueprint §3.4 先例）；总纲重估 = 用户对标尺改判 / 对标产品形态代际变化 / G1+ 阶段启动（届时相关包整体出籍重估）
status: planned
---

# Agent 竞争力总纲（AGENT-COMPETITIVENESS-PROGRAM）

> 立项溯源（用户裁决三连，2026-10-12）：①「避免成为另一个 Zcode 或者 codex 呀 保留自己的特色 借鉴他们的优点」②「我觉得不够 好像你把要优化升级的部分大幅度的缩减了 agent的通用能力 仍旧是最核心的开发重点 它也应该突出自己的优势 不仅仅是增加数据资产」③「做更详细和全面的方案 目前好像太简单了 我们的petri开发进度远远不够」。
> 溯源证据：2026-10-12 双路只读探查（后端 agent 核心 8 域 / 前端产品面 9 节，60+ 文件锚点落 §1-§2）；对标知识=ZCode 宿主形态直接经验 + Codex 先例（BLOCK-55 已吸收 plan 模式）。
> 职责分工：本文件 = 竞争力标尺、差距矩阵、波次判据的 canonical；**排队序唯一登记在 [`pending-work-backlog.md`](./pending-work-backlog.md)**，波次发令时才入队列，本文件不预设进度。
> 与成熟度蓝图的关系：[`g0-agent-maturity-blueprint.md`](./g0-agent-maturity-blueprint.md)（reference，2026-10-10 达成）量的是 **G0 内部天花板**；本纲量的是**行业竞争力标尺**——两把尺子不同，蓝图满级 ≠ 竞争力达标，这正是本纲存在的原因。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 0. 为什么需要本纲：双口径的诚实

蓝图 25 种子当日达成、五层自评 4~4.5★，是**以「dev Electron 边界内可实机 verified」为满分**的内部口径。换行业标尺（用户拿 Petri 与 ZCode/Codex 并排使用）重新度量，多数维度要下调 1~1.5 星——不是退步，是量尺换了。用户判断「开发进度远远不够」在本口径下成立：**机制密度是一流的，用户可感的完成度是二流的**——大量能力「在库不可见」「在库默认关」「占位未接线」。本纲的主轴就是把这批存量机制变成用户可感的第一梯队体验，并补齐真正的结构性缺口。

## 1. 双口径评分卡（2026-10-12 静态推断 → 2026-10-17 锚点复测）

> **口径升级（BLOCK-195）**：「行业口径」列是 2026-10-12 读代码推断的，按评估报告 §2 铁律「未经 DOM/实机抽样不得定分」它只能算假设。现列的「锚点复测」= `node scripts/block195-anchors.mjs` 实跑导出：53 个点位（取自本纲 §1 判词 + §2 D1–D18，逐点 `derivesFrom` 可指回）× 62 条机械锚（unit/frontend/evals/live/probe 五层；10-17 两次加映分别补 D16 与 6 个原无锚点位），**分数 = 5 × 有点位通过锚 ÷ 点位数，无机械锚不计分**；证据=`acceptance/block-195/anchors-latest.json`，棘轮=`evals/anchors/baseline.json`（`--check` 对账）。原推断列与判词保留作对照，**判词里已被实测推翻的措辞以下方「Δ 归因」为准**。

| # | 维度 | G0 内部口径 | 行业口径（10-12 推断） | **锚点复测（10-17）** | Δ | 判词（证据锚点见 §2） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 推理循环韧性 | 4★ | 3.5/5 | **5.0/5** | +1.5 | steer/resume/finalization/续写链/假成功诊断全在；缺摘要式压缩与 cache 友好分层 |
| 2 | 上下文与记忆 | 4★ | 2.5/5 | **4.2/5** | +1.7 | 混合检索（向量+FTS5+RRF）超配；记忆单层薄向量、loop 压缩是丢弃式 |
| 3 | 编排与多智能体 | 4.5★ | 2.5/5 | **5.0/5** | +2.5 | Spec/replan/角色/协作三件套完整；并发软上限 3+单层派生+工具不可取消+无可视化 |
| 4 | 治理与信任 | 4.5★ | 3/5 | **5.0/5** | +2.0 | 四档×动态判定×用户规则×密文=机制比两家都细；**确认弹卡缺失=用户全看不见** |
| 5 | 呈现与交互 | 4★ | 3/5 | **4.4/5** | +1.4 | 时间线/审阅/多窗口超配；**主聊天无 Stop、Cmd+K 空壳、队列不可见、预算环占位** |
| 6 | 表达面（Gen UI） | — | 3.5/5 | **5.0/5** ¹ | +1.5 | 沙箱+自愈+follow-up+放大+复制完整；~~无数据绑定~~（¹ D16 已于同日加映补锚并实测绿，见下方注）、不吃 accent、导出弱 |
| 7 | 数据资产面 | 4★ | 3.5/5 | **4.2/5** | +0.7 | viewer 9 类+血缘 DAG+选择总线；能力位全 false 占位、分屏固定 60/40 |
| 8 | 协作与多端 | 3.5★ | 3/5 | **4.2/5** | +1.2 | 联邦独有形态（无厂商中继）；委托 5s 轮询黑盒、数据桥仍 HTTP（任务流已 WS-first） |

**均值 4.6/5**（§2 合格线「无维 <3」达成）。² **加映复测（BLOCK-198，同日、同环境 dev 栈 + 9223 测试实例）**：6 个点位补锚/挂接转绿（prompt-layering · recursive-tree · cost-breaker · worktree-safety · split-compare · delegation-realtime），机械锚 56→**62**、零锚点位 10→**4**、**零 anchored-red**；剩余 4 个=**3 处实码核实真缺失**（ANN 记忆分层与召回质量基线 / 斜杠即执行的结构化 chip / >2 节点中继拓扑）+ 1 处环境档（R 运行面）。同批**四处 claim 按实码更正**：成本上限触发的是诚实收尾 system 提示（循环无 `break/return`）**不是硬中止**；委托事件流是**叠加在 5s 轮询之上**、轮询兜底未被替代；分屏比例可调**早已落地**（clamp 20–80/键盘步长/持久化恢复/坏值回落，原判词「分屏固定 60/40」失效）但 `canCompare` 未接进钉住入口、分隔件用 `role="separator"`+`aria-value*` 而非 slider；递归派生断到的是**判定链**（端到端实跑派发链未锚，写进 claim 不外推）。¹ **加映复测（BLOCK-196，同日、同环境 dev 栈+9223 测试实例）**：给 dim6 的 D16「卡片自取数数据绑定」补锚时发现该能力**自 BLOCK-174 即已落地**（`src/ipc/gen-ui.js` CP-11 中继：窗主绑定+跨会话归属校验+12KB 有界投影）只是零机械断言；补锚当场撞出真缺陷——归属校验按 `'/'` 切分路径而 win32 走 realpath 反斜杠，**跨会话拒读分支在 Windows 上整体空转**（会话 A 的卡片可读到会话 B 的任务结果）。已修（`/[\\/]+/` 切分 + 算不出归属改 fail-closed 拒读）并由 `test/block196-genui-data-binding.test.mjs` 7 项锁住，dim6 4.2→**5.0**（6/6 点位全绿）、棘轮基线已 `--update` 提升。教训：**「无锚点位」有两种——能力真缺失，或有实现无断言**，补锚正是分开二者的手段。Δ 归因：①**普遍上移是卡过时**——CP-19 十九包收官后 D1（摘要式压缩 CP-5）/D4（预算环真实数）/D5（并发与深度可配 CP-8）/D6（工具取消）/D7（编排 DAG CP-9）/D9（审批卡）/D12–D14（Stop/队列/Cmd+K）均已落地，原判词的「无/空壳/占位」措辞不再成立；②**dim7 当时的 −0.2 不是产品退步而是证据缺口**（成果回路实机腿需 R 运行面，本机未装→记 `env`；D18 分屏对照无锚）——BLOCK-198 已把 D18 补锚转绿（分屏比例可调早已落地却零断言），dim7 回升到 4.2，剩余缺口只有 R 运行面那一条环境档；③仍无机械锚的点位经 BLOCK-198 逐点实码普查后收敛为 4 个=dim2 ANN 分层与召回质量基线（**真缺失**：`memory-vectors.js:111-127` 暴力全表 cosine，全仓无 recall/MRR/nDCG 基线）、dim5 斜杠即执行（**部分实现**：动作族即执行、skill/template 只注入模板，结构化 chip 留 v2）、dim8 >2 节点中继拓扑（**真缺失**：只有按 baseUrl 平铺的点对点直连）+ dim7 成果回路实机腿（环境档·本机无 R 运行面）——**它们是下一波立项的证据入口，不是可以宣布已达成的地方**。

## 2. 差距矩阵（18 项，证据 → 行业形态 → Petri 自有形态方向）

> 「自有形态方向」列 = 反克隆纪律的落点：借形必须长出 本地可审计 / 治理透明 / 证据自证 / 场景锚 之一的差别形态。

### 2.1 推理循环（dim1）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| D1 loop 压缩丢弃式 | `loop-orchestrator.js:622-662`+`message-trimmer.js:188-193`（仅注入 note） | Claude Code auto-compact 丢前摘要 | 摘要进 transcript 留证=可审计压缩（竞品摘要不可取证） |
| D2 系统提示静态巨拼接 | `agent-runner.js:331-585` 十余段每轮重算 | cache 友好分层（静态前缀+动态尾） | 分层后决策留痕不丢；temperature/max_tokens 硬编码一并可配 |

### 2.2 上下文与记忆（dim2）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| D3 记忆单层无 ANN | `memory-vectors.js:111-127`（topK=3 暴力扫） | 分层记忆+项目记忆文件 | AGENTS.md 等价项目记忆=用户可直接审计编辑（竞品记忆是黑盒） |
| D4 预算环无真实数 | `ContextBudgetBar.tsx` idle 渲染 `—` | 真实 token 进度 | 计量本身已在（ai_usage/校准系数），只差投影——补齐即「计量可信」可感化 |

### 2.3 编排与多智能体（dim3）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| D5 并发软上限 3+单层派生 | `spawn-agent-tools.js:38`、`:217-219` | 数十并行 fan-out+递归树 | 上限用户可配+树形评估；保守缺省保留=治理卖点（并发即预算） |
| D6 工具执行不可取消 | `agent-tools/registry.js:224`（cancellable: false 全量） | Stop 贯通到工具中断 | AbortSignal 贯通+取消留痕入 task_events=可审计取消 |
| D7 编排不可视 | spawn/tool_plan 两链已统一门面但无图 | Codex 计划视图/agent 画布 | DAG 投影复用血缘画布（@xyflow 已在库）=本地编排图 |
| D8 Jev 原语默认关 | `tool-router.js:41-48`、`report-guard.js:20-21` | 无直接对标（自研优势闲置） | 转正=独有「决策可观测」卖点，别家没有的东西在库里睡觉 |

### 2.4 治理与信任（dim4）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| D9 确认弹卡缺失 | `agent-tool-policy.js:95`（ack 通道在）+前端零确认卡；`AgentRulesPanel.tsx:6` 自认 rider | ZCode permission prompt | 弹卡+审批中心=「最细粒度治理」从暗债变招牌 |
| D10 无工作树安全网 | policy 有 sha256 乐观锁但无快照原语 | git 围栏兜底一切写 | checkpoint/一键回滚原语+回滚留痕=证据自证的安全网 |
| D11 成本无硬熔断 | `agent-runner.js:655-665`（事件只观测）；`ai-usage.js:188` 价格硬编码 | 预算上限停机 | 用户级预算熔断+价格表可配=本地计量的最后一环 |

### 2.5 呈现与交互（dim5）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| D12 主聊天无 Stop | `SimpleChat.tsx:1032-1034`（BLOCK-28.8 用户裁决移除；hook 能力在） | 常驻 Stop | 复出+取消留痕；工具级取消见 D6 |
| D13 Cmd+K 空壳 | `App.tsx:176-181` `commands={[]}`（395 行组件在） | 命令面板即动作中枢 | 命令源=真数据（会话/项目/技能/设置深链） |
| D14 队列/steer 不可见 | `useChatStream.ts:437-445` drain 在、无 UI | 排队可见可撤 | 队列列表+撤销+插队位次=编排透明的一部分 |
| D15 斜杠只注入不执行 | `slashSources.ts` v1 文本注入 | 斜杠即动作 | chip v2 结构化执行意图（复用 BLOCK-139 注入通道） |

### 2.6 表达面 Gen UI（dim6）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| D16 ~~无数据绑定~~ **已推翻** | 10-12 静态推断只看渲染侧（guest 仅 setState RPC，`GenUiCard.tsx`）；实际 `src/ipc/gen-ui.js` CP-11 中继早已落地，自 BLOCK-174 起零机械断言 | ZCode widget 数据直连 | artifact/job 数据源通道=「分析产物→交互件」独有闭环；BLOCK-196 补锚时撞出 win32 跨会话拒读空转缺陷（已修+契约测） |
| D17 不吃 accent+导出弱 | `GenUiCard.tsx:247-258` 只推 data-theme | 主题全量跟随 | accent 透传+文件导出；联邦回流 Gen UI 化=独有协作叙事 |

### 2.7 数据资产面（dim7）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| D18 viewer 能力位未接线 | 10-12 原判：`viewerRegistry.ts:56-66` canSelect/canCompare 全 false。**BLOCK-198 复核更正**：`viewerRegistry.ts:63` table `canCompare=true`（不再全 false），分屏与比例可调也已落地（`ArtifactPinPane.tsx:45-90` clamp 20–80/键盘 ±5/持久化，`ArtifactPinPane.ratio.test.tsx` 5 项断言）；**残余=钉住入口未消费 canCompare**（`ResultArtifactShell.tsx:1019` 只按 `previewLoading` 禁用）+ 分隔件 `role="separator"` 而非 slider（读屏不播报值） | 选择跨视图通 | 切片 C/D 收尾=表格/图表选择→agent 链路（选择总线已在） |

### 2.8 协作多端（dim8）

| 差距 | 证据 | 行业形态 | Petri 自有形态方向 |
| --- | --- | --- | --- |
| — 委托轮询黑盒 | `federation-tools.js:141-170`（5s 轮询+末条消息回执） | 无对标（独有域） | 事件流回传+artifact 引用+Gen UI 回流=联邦从可用到好用 |
| — 数据桥 HTTP | `projectionDataBridges.ts`（任务流已 WS-first=`agentTaskStream.ts`，BLOCK-162 非范围余量） | — | 数据桥 WS 化候补（优先级低，SSE+横幅已诚实） |

**随批清偿（名实不符两件，随首个触域包带走）**：tool-defs 头注「71 工具」实测 77（注释漂移）；`emitToolResult` 死参自注释（`loop-orchestrator.js:145-149`）。

## 3. 原则（横切，与 AGENTS.md 产品个性纪律同源）

1. **agent 通用能力是主线核心**——本纲 19 包中 14 包是通用能力（dim1-5），议程不因对标收缩。
2. **借形长自有形态**——每个包立项自检：「这个能力的形态与 ZCode/Codex 差别在哪？本地可审计/治理透明/证据自证体现了吗？」（§2 第四列即预答题）。
3. **G1+ 画线不动**——Provider 矩阵/签名公证/远程市场/packaged 验证不进本纲。
4. **存量优先**——「在库不可见/默认关/占位未接线」三类存量（D4/D8/D12/D13/D14/D18）单包成本低于新建，优先变现。
5. 单工作包串行不变；波内零停顿条款（blueprint §3.4 先例）逐波援引。

## 4. 六波总纲（19 个候选包）

> 包代号 CP-x 仅为总纲内引用；立项时定 BLOCK 编号。每波出口判据 = 机械可验或实机可断言。

### W1 交互主权与信任可见化（用户可感最强，预计 3-4 包）——**completed（2026-10-12 BLOCK-171 四包全交付；closeout 十三门 PASS；w1-live 实机 8/8；证据=acceptance/block-171/）**

主轴：把「用户对 run 的控制权」和「治理的可见性」补到第一梯队——这是两家对标产品的基本盘，也是 Petri 机制最厚却最不可见的面。

| 包 | 范围 | 出口判据 | 依赖 |
| --- | --- | --- | --- |
| CP-1 停止与取消全线贯通 | 主聊天 Stop UI 复出（流式中常驻，接既有 stop 能力）+ 工具级 cancellable 从 false 起步族（长任务族先：spawn_wait/learning run/文件搜索）AbortSignal 贯通 + 取消事件入 task_events | 流式中可停且会话状态一致；至少 3 个长任务工具取消实机留痕 | — |
| CP-2 确认弹卡与审批中心 | dynamicGuardAck 聊天流确认卡（放行/拒绝/总是）+ 审批复审面板（task_events 聚合） | require-ack 触发→弹卡→ack 放行全链实机；审批历史可查 | — |
| CP-3 CommandPalette 真命令源 | 命令源=导航/项目/会话/技能/设置深链（≥15 条）+ recentConversations 接线 | Cmd+K 执行 5 类命令实机 | — |
| CP-4 队列与 steer 可视化 | 排队列表（撤销/位次）+ steer 状态行内持续可见 | 排队可见可撤实机 | — |

### W2 长程上下文与记忆（长任务质量的地基，3 包）——**completed（2026-10-12 BLOCK-172 三包全交付；CP-5 源码契约 5/5+CP-6 评估档 reference；实机与 UI 过目随 UI-499/500）**

| 包 | 范围 | 出口判据 | 依赖 |
| --- | --- | --- | --- |
| CP-5 loop 摘要式 auto-compact | 0.85 断路触发前先摘要再丢（摘要进 transcript 留证）+ compaction 覆盖 agent loop 的 fullMessages（现只覆盖 chat 拼装） | 长会话压缩前后任务连续性对比；摘要可在 io-transcript 取证 | CP-7（软） |
| CP-6 记忆分层与项目记忆文件 | AGENTS.md 等价项目记忆（agent 可读、写入走治理门）+ episodic/semantic 分层评估 + 向量分片索引（chunk>50k 加速） | 项目记忆注入实机；召回质量对比基线（top3 命中率） | — |
| CP-7 计量可感化 | ContextBudgetBar 真实 token 水位（SSE 推送）+ /compact 等价手动命令 + temperature/max_tokens 可配 | 预算环实数刷新实机；手动压缩可触发 | — |

### W3 编排与多智能体深化（3 包）——**completed（2026-10-12 BLOCK-173 三包全交付；w3-live 实机 2/2+契约 5/5；CP-9 可视链路随 UI-501 过目）**

| 包 | 范围 | 出口判据 | 依赖 |
| --- | --- | --- | --- |
| CP-8 并发与派生升级 | 并发上限用户可配（1-8，缺省仍 3）+ 多层派生（子生孙）评估与受控放开 + 汇报门（report-guard）转正评估 | 上限调整实机；多层派生红绿或「不放开」的实证裁决 | — |
| CP-9 编排 DAG 可视化 | run 结构（spawn 树+tool_plan 步骤）投影到画布（复用血缘 DAG 先例）+ checkpoint/恢复统一叙事 | 编排图实机可看可追（点击下钻任务） | — |
| CP-10 工具路由转正 | tool-route 默认开（九域路由）+ 精度校准门 + 决策可观测面板消费 | 路由精度门绿；decision_log 可视消费实机 | — |

### W4 表达面 Gen UI 双轨（3 包）——**completed（2026-10-12 BLOCK-174 三包全交付；w4-live 3/3；十二门绿+test:changed 2 红=block93 凭据环境债存量归因；CP-9 同波 CP-13 可视随 UI-502 过目）**

| 包 | 范围 | 出口判据 | 依赖 |
| --- | --- | --- | --- |
| CP-11 数据面绑定 | artifact/job 数据源通道进沙箱（只读投影+引用留痕）+ visualize skill 教模型绑定 | 真实分析数据驱动的交互件实机（非手写数据） | — |
| CP-12 模板库 | 场景锚定 widget 模板（图表/表格/KPI/流程）+ 模板命中契约 | 模板命中率统计；输出一致性抽检 | CP-11（软） |
| CP-13 表达面收尾 | accent 透传+文件导出+联邦委托回流 Gen UI 化 | accent 生效；委托结果为交互件（双机） | CP-11（硬） |

### W5 数据资产面接线（artifact plane 切片 C/E 收尾，2 包）——**completed（2026-10-12 BLOCK-175 两包全交付；canSelect 四类接线+分屏可拖拽；docs 门绿）**

| 包 | 范围 | 出口判据 | 依赖 |
| --- | --- | --- | --- |
| CP-14 选择总线跨 viewer | canSelect/canCompare 能力位接线（表格/markdown/图表≥4 类）+「选择→agent」链路 | 表格选行→继续分析引用实体实机 | — |
| CP-15 分屏与 renderer 补课 | ArtifactPinPane 可拖拽比例+切片 E renderer 补课 | 分屏自由排布实机；renderer 清单对账 | — |

### W7 Agent Skill 知识面（3 包）——**completed（2026-10-12 整波交付；closeout 十三门 PASS；w7-live 9/9，acceptance/block-176/w7-live.json。BLOCK-176）**

> 波报：CP-20 双格式常驻注册（skill.json 契约不动+SKILL.md 直装载；依赖字段 os/requires.bins/install 经 normalizeDependencies 归一，skills:check 双格式校验 14 技能全绿）/CP-21 skill_preflight 工具+GET /api/skills/preflight 路由+Skills 页依赖三态徽章；安装治理对齐既有 run_cmd guard-ack 审批链（未建第二通道）；**全链本机实证：defuddle 探测(installable)→本地隔离安装(npm --prefix 临时目录零全局污染)→复核(available)**/CP-22 Obsidian 九技能迁移在册（生成五+CLI 三挂依赖+setup 转写），mermaid 手册打通 Gen UI+visualize 模板优先节。尾巴清偿：defuddle/knap 全局就位（13 available/1 installable）；obsidian-cli 如实 blocked=本机无 Obsidian 本体（官方 CLI 随应用分发，不装第三方同名件）。G0 开发期常态 · 不外推 packaged/Provider/GA。

> 来源：用户 2026-10-12 演示 ZCode Obsidian 插件后裁决「应该加到 petri 并且应该是作为主要的功能之一」+ AskUserQuestion「W7 先行」；roadmap 研究候选池③「skill 声明式依赖三件套」（2026-09-06 登记）由 CP-20 承接转正。防重复开发：KNW-4（BLOCK-160 P5）已有 SKILL.md 受限解析导入（合成 skill.json 落库）——CP-20 为导入通道扩展，不重建。

| 包 | 范围 | 出口判据 | 依赖 |
| --- | --- | --- | --- |
| CP-20 skill 格式 v2·声明式依赖 | SKILL.md 常驻双格式注册（KNW-4 导入通道扩展：frontmatter 新增 os 门控+requires.bins+install 配方字段进注册表面）+skills:check 扩展校验 | 双格式同注册表可发现；依赖字段过门禁 | — |
| CP-21 依赖自检与安装治理 | skill 可用性 preflight（bins/平台探测，缺什么如实报告）+安装动作走审批确认+留痕（对齐 guard-ack 链）+Skills 页状态可视化（可用/缺依赖/待装） | 带外部依赖技能实机走通「探测→审批→安装→可用」 | CP-20（硬） |
| CP-22 首批通用技能包迁移 | Obsidian 九技能转写 Petri 形态（生成类五直接迁；CLI 三挂依赖声明+安装配方）；可视化技能产出与 Gen UI 模板优先节打通 | w7-live：discover→get→按手册产出全链留痕实机（acceptance/block-176/） | CP-20（硬） |

### W6 协作多端与可靠性长尾（4 包）

| 包 | 范围 | 出口判据 | 依赖 |
| --- | --- | --- | --- |
| CP-16 联邦委托 v2 | 事件流回传替代 5s 轮询+跨机 artifact 引用+回执结构化 | 双机委托流式回传延迟 <1s 实机 | — |
| CP-17 工作树安全网 | workspace checkpoint 快照原语+一键回滚+回滚留痕 | 任意写后一键回滚实机（含 R 产物域） | — |
| CP-18 成本硬熔断 | 用户级预算上限+超限自动停机（走 finalization 语义）+价格表可配 | 预算熔断实机；价格改动生效 | CP-7（软） |
| CP-19 移动数据桥 WS 化 | projectionDataBridges WS-first（复用 BLOCK-162 服务端）+降级回退 | 数据桥推送延迟对比（轮询→推送） | **BLOCK-183 completed（2026-10-14 当日立项当日收口=总纲 19 包全闭环；探针 allPass；loopback 延迟持平，隧道增益属 riders）** |

### 4.7 总对账表（基线 → 终态承诺）

| 指标 | 基线（2026-10-12） | 终态 |
| --- | --- | --- |
| 主聊天 Stop 可达 | 0 | 1 |
| 工具级 cancellable | 0/77 | 长任务族 ≥3 |
| 确认弹卡链路 | 0 | 1 |
| Cmd+K 可执行命令 | 0 | ≥15 |
| loop 压缩形态 | 丢弃式 | 摘要式（留证） |
| 项目记忆文件 | 0 | 1 |
| 预算环 | 占位 `—` | 真实水位 |
| 子代理并发上限 | 固定 3 | 用户可配 1-8 |
| 编排 DAG 可视化 | 0 | 1 |
| Gen UI 数据绑定 | 0 | 1 |
| viewer canSelect 接线 | 0/9 | ≥4 |
| 分屏比例 | 固定 60/40 | 可拖拽 |
| 联邦回传延迟 | ~5s 轮询 | <1s 事件流 |
| 工作树安全网 | 0 | checkpoint+回滚 |
| 成本熔断 | 仅观测 | 硬停机 |
| skill 双格式注册 | 0（仅 SKILL.md 导入合成） | 1（常驻双格式） |
| 外部依赖技能治理链 | 0 | 探测→审批→安装→可用 |
| 内置通用技能包 | 2（coding-playbook/visualize） | ≥7 |

## 5. 依赖 DAG 与推进规则

```text
硬依赖
  CP-11 ──▶ CP-13（表达面收尾需数据绑定先在）
  CP-20 ──▶ CP-21 / CP-22（技能依赖语义是治理链与迁移包的地基）
  CP-7（软）──▶ CP-5 / CP-18（真实计量是压缩决策与熔断的地基，建议先行）
软依赖
  CP-11 ──▶ CP-12（模板命中统计在数据通道上更有意义）
独立件（可任意插队）
  CP-1/2/3/4/6/8/9/10/14/15/16/17/19/20
```

- **排序理由**：W1 全部独立件且用户可感最强，先做；W2 是长任务质量地基（CP-7 建议排波内首位）；W3-W6 依价值密度排；波内零停顿条款逐波援引（blueprint §3.4 先例，需用户逐波授权）。
- **插队规则**：实机出现上下文相关缺陷（熔断失准/压缩误伤）→ CP-5/CP-7 立即插队；联邦双机使用出现阻塞 → CP-16 插队。
- 每包启动照常过立项检查单 + 产品个性自检问句（§3.2）。

## 6. 与既有文档的关系（防重复开发）

- 蓝图（reference）：G0 内部口径已达成；其 G1+ 画线残余中「确认 UI 弹卡/KNW-3 chip v2/ORC-4 DAG 化」三件由本纲 CP-2/CP-15(CP-3)/CP-9 拉回 G0 承载——**拉回依据=用户 2026-10-12 裁决「agent 通用能力仍是最核心开发重点」**，蓝图 §7 残余清单随之注记出籍。
- roadmap 研究候选池③「skill 声明式依赖三件套」（2026-09-06 登记自 OpenClaw 对标解剖）由本纲 W7 CP-20 承接转正（2026-10-12 用户裁决「W7 先行」），候选行随之出籍注记。
- artifact-plane-direction（reference）：切片 C/E 由本纲 W5 承接，方向文档不重写。
- roadmap/backlog：本纲不预设队列；波次发令时按治理纪律入 backlog 队列区。
- 设计宪章（BLOCK-167）：W1/W4 涉 UI 的包沿用宪章与 controls 单源。

## 7. 治理语义

- 本文件状态 planned=方向已获用户裁决采纳、未发令任何波次；首波（建议 W1）发令时 roadmap/backlog 同步行，本文件不承载进度。
- 各包收口时在本文件 §4 表格回写状态注记（不另立第二进度文档）。
- 证据落 acceptance/<block>/；每包验收=定向测试+tsc/lint+docs/ui 门禁+实机断言（涉 UI 面需用户过目）。
