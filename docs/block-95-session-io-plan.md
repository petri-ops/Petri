# BLOCK-95-SESSION-IO — 会话信息流 I/O 优化（连贯易读 + 上下文经济）

最后更新：2026-09-16

状态：`completed（2026-09-17 整包收口：六工作面 A1-A5+B1-B5 全收口无半拆。提交链 8d98194e→f4b49e0e→dfe038f6→fc0142dc→de525eaa→59567047→a1e19848→28a620dc。门禁总账：契约 4/4+6/6+6/6+3/3 + copilot 293 + tsc 0 + theme 4/4 + 棘轮 PASS；实机 dev Electron 四脚本 8/8+6/6+8/8+3/3 allPass；closeout 三绿+test:changed 3 红全 D8 源绑定例外族〔本包 impact-map 合法登记触发，BLOCK-92 同款先例，归 G0-RS〕+棘轮单独 PASS。核心数字：长会话最新窗口+补页修复；增量拼装逐字对账；compaction 省 47.6%/轮；cache 96.8% 命中修复实证。两开关默认关翻默认待用户裁决；UI-394 in_progress 待用户复看。G0 开发期常态 · 不外推 packaged/Provider/GA）`active（2026-09-17 P0/P1/P2 完成：P1=A1+A3+A4 实机 8/8〔UI-394 in_progress〕；P2=B1 后端拼装开关 PETRI_SERVER_HISTORY_ASSEMBLY 默认关，契约 6/6 + 实机 diff 对账 6/6 allPass〔增量形态请求下 LLM 收到 DB 全量拼装逐字一致〕；P3=B2 会话级 compaction〔契约 6/6 + 实机 8/8：token 对账 46297→24258 每轮省 22039（-47.6%），covers=29-31 条，原文红线契约+实机双证〕+ A5 压缩标记卡实机渲染确认（截图 acceptance/block-95/block95-a5-compaction-notice.png；PETRI_SESSION_COMPACTION 默认关，翻默认待 P6 裁决；resume 续接卡已由 BLOCK-38/UI-275 ResumePrompt 覆盖，A5 增量=压缩标记卡如实登记）；P4=B3 cache 断链修复〔deepseek/anthropic 落库补 cache 字段；修复前基线 957 万 tokens 恒 0 → 修复后同渠道 96.8% 命中（15744/16260）实锤；前缀稳定评估=既有顺序+静态缓存达标零改动；ContextBudgetBar 审计视图=数据面已具备、UI 增量列后续候选；契约 3/3 + 基线脚本可复跑 scripts/block95-b3-cache-baseline.cjs〕；P5=A2 渲染性能〔displayMessages 派生链 useMemo 化（消除 keystroke/菜单 state 的全量重拼）；实机帧率观测 scripts/block95-a2-frame-live.cjs 3/3：25s 流式窗口 recalc+layout≈0ms、script 303.8ms（1.2%）、DOM 1985 节点——虚拟化评估结论=当前规模无必要，阈值（>5000 条或 recalc 占比>40%）触发时再议〕+ B4 评估结论〔system prompt/tool guide ~1K tokens/请求，B3 修复后 cache 96.8% 命中吸收其成本，裁剪必要性显著降低——只评估不动码（用户裁决③）〕+ B5 评估结论〔30K 硬截断已与 Anthropic BASH_MAX_OUTPUT_LENGTH 同语义；quiet/tail 指南注入=行为敏感（prompt 变更须逐项对账）列后续候选〕。P6 整包收口进行中）`

计划编号：`BLOCK-95-SESSION-IO`

用户裁决原话：「需要新建一个block用来优化 信息流 I/O  主要目的是让每个session的连贯性好看易读 还有一个方面是性能 省token」（2026-09-16），并指定参考文章：Anthropic《Maximizing the value of your Claude Code sessions》（Lydia Hallie，2026-08-14，claude.com/blog）。

主模块：`core/petri-server`（会话/事件流数据面 + LLM 请求拼装）+ `frontend/src/components/copilot/`（信息流呈现面）

关联：UI-382~387（信息流呈现面既有增量，in_progress 待用户复看，本包不重做）；BLOCK-79（ai_usage 用量/缓存字段）；BLOCK-91（composer 附件引用注入）；BLOCK-65（子智能体上下文隔离基线）；BLOCK-37（io-transcript 全量落盘）

## 0. 参考观念（文章核心 → 本包翻译原则）

文章的成本模型：**一次 session 的成本 ≈ 上下文里的 token 数 × 它们驻留的轮数 × 并发上下文数**。token 单价 = 模型 × 输入/输出（输出约 5× 输入）× 是否缓存（cache 读 0.1×、写至多 2×、TTL 5 分钟 API / 1 小时订阅，每轮续期）。四个最值得盯的抓手（按成本影响粗排）：**① 上下文驻留轮数**（长会话第 40 轮还在重读前 39 轮——/clear 分任务、/compact 收尾段）；**② cache buster**（会话中途切模型/effort/fast-mode、过期后才 /compact——切换要挑「便宜时机」：会话开头或 /clear 之后）；**③ 工具输出噪声**（中等体量噪声输出比超限大输出更贵——quiet flags、@-mention 直接附文件、大输出落盘只留预览、噪声活派 subagent）；**④ 启动载荷**（工具定义 + 系统提示 + CLAUDE.md 在打第一个字之前就已驻留——/context 审计、工作流文档移入 skills 按需加载）。

Claude Code 把这些做成**给用户的手动杠杆**（/clear //compact //rewind //context）；我们的产品里对应机制必须是**运行时自动 + 用户可见可控**的产品能力——这是本包把文章观念翻译成 Petri 实现的总原则。

## 1. 两目标 → 六工作面（2026-09-16 代码摸底证据）

用户目标「连贯性好看易读 + 性能省 token」映射为 A/B 两个面共六工作面。每面独立可验收、独立提交；优先级与裁剪在 P0 评审由用户裁决。

### §1.1 P0 代码事实复核记录（2026-09-17，启动日逐项抽查）

六工作面 11 处承重代码**全部实证在位，零失实**。BLOCK-92 Wave A 拆分致 3 处行号漂移，P1 起以本节为准：

| 面 | plan 摸底行号 | 复核实证（HEAD=8d98194e） | 结论 |
| --- | --- | --- | --- |
| A1 | ai-conversations.js:121-122 / useConversationResume.ts:45 | `ORDER BY ts ASC LIMIT ?` 在 **L122**；拉 200 条在 useConversationResume.ts **三处 L45/65/92**（主加载 + 对账镜像两处，plan 只记一处——P1 须三处同改） | 成立，发现新增 |
| A2 | SimpleChat.tsx L693-792 / L1401-1576 | BLOCK-92 Wave A-3 后派生链外迁 displayMessages.ts（buildBaseDisplayMessages/applyConversationNotices），SimpleChat.tsx **L551-556** 每次 render 全量重拼；全量重渲染主体不变 | 成立，行号更新 |
| A3 | SimpleChat.tsx:809-813 | scrollTop=scrollHeight 直写在 **L574**，无上翻守卫 | 成立，行号更新 |
| A4 | conversations.js:163-205 / conversation-adapter.js:192 | topic_shift 检测 helpers/conversations.js **L166-192**、投递 adapter **L192**；渲染仍平铺 | 成立 |
| A5 | resume.js:36-49 | buildProgressDigest **L36**，两处续接链调用 | 成立 |
| B1 | useChatStream.ts:206-211 | 前端全量上报 **L206-208**（messagesRef map role/content） | 成立 |
| B2 | message-trimmer.js:123-211 / loop-orchestrator.js:561-600 | trimMessagesToBudget **L123**（SUMMARY_TRIGGER_DROP=5 合成提示非 LLM 摘要 L29/L184）；85% 熔断 loop-orchestrator **L561-572** | 成立 |
| B3 | ai_usage cache 字段 / loop-orchestrator.js:637 | cache_read/creation 列 ai-usage.js **L26-27/39-40**；model_fallback 事件 **L632-637** | 成立 |
| B4 | agent-runner.js:400 / L438-553 | renderSiteSnapshotForPrompt(snap, 3500) 在 **L408**；system-prompt.js 静态预缓存在（L8/L17） | 成立，行号更新 |
| B5 | conversations.js:100 | content 硬截 30000 在 helpers/conversations.js **L100** | 成立 |

**P0 用户裁决（2026-09-17，AskUserQuestion 三项）**：①推进顺序=**按 plan 全序 P1→P6 串行**；②B1 切换方式=**开关灰度**（新链路开关落地默认关 → 同会话请求体 io-transcript diff 对账逐字一致 + resume/fork/多端镜像三链路契约全绿 → 才默认开；可回退）；③B4=**只评估不动码**（量化 token 账落 acceptance，结论回写本文件；不动工具指南内容，省 token 主力靠 B1/B2/B3）。

### A 面：信息流连贯易读（呈现面）

- **A1 长会话加载游标化（真缺陷先行）**：历史消息 `ORDER BY ts ASC LIMIT ?`（`core/petri-server/routes/ai-conversations.js:121-122`，前端拉 200 条 `useConversationResume.ts:45`）——超过 200 条的会话前端拿到的是**最旧** 200 条，且无向上分页游标。长会话恰恰是「看不到最近、连贯性断裂」的重灾区。→ 改「最新优先加载 + 向上滚动补页 + 游标协议」，前端对账逻辑（5s 轮询镜像）同步适配。
- **A2 流式渲染性能**：`SimpleChat.tsx` 的 displayMessages 每个流式事件全量重拼（L693-792 两次 slice 拷贝）+ 全量重渲染（L1401-1576），无虚拟化；`ChatScrollbar.tsx` MutationObserver 全量测高。流式 delta 期间整列表重算是卡顿直接来源。→ 尾部流式块局部更新（memo/分区渲染），虚拟化列为评估项。
- **A3 自动滚动守卫**：`scrollTop = scrollHeight` 直写（`SimpleChat.tsx:809-813`），无「用户上翻则不打扰」守卫。→ 上翻暂停跟随 + 新内容浮标 + 一键回底部。
- **A4 语义分段**：`topic_shift` 事件已在流里（`conversations.js:163-205` 检测、`conversation-adapter.js:192` 投递）、`loop_phase`/`loop_iteration`/`agent_status` 生命周期事件齐备——但渲染为平铺行。→ 渲染成小节分隔/呼吸感，让长信息流有「章节」；与 UI-383 只读折叠、UI-387 图标带风格合流，同真值只留一张皮。
- **A5 压缩与续接可视化**：现状 trim/摘要发生时信息流**毫无痕迹**。→ 凡 B 面压缩落地，流内出现诚实标记卡（「以上已折叠为摘要，原文可展开」）；resume 续接点（`routes/ai-agent/resume.js:36-49` buildProgressDigest）同样以续接卡呈现。**压缩不悄悄发生是本包红线**（见 §4 原则 1）。

### B 面：上下文经济（省 token / I/O 面）

- **B1 历史拼装权收归后端（架构前提）**：现状历史由**前端整段上报**（`useChatStream.ts:206-211` filter 后全量 role/content），后端不为 LLM 调用回读 `copilot_messages`。这使一切服务端 compaction/cache 优化没有抓手。→ LLM 请求历史改由后端从 DB 拼装（+注入摘要），前端只发增量；P2 设计评审确认落库时机与增量协议。这是文章「一切都会每轮重发」教训的结构性解法，也是「每个 session 连贯」的单一真相前提。
- **B2 会话级 rolling compaction（真 /compact）**：现状 `message-trimmer.js` 只丢不摘要（`trimMessagesToBudget` L123-211，丢历史 >5 条注入合成提示；85% 窗口熔断每 run 一次 `loop-orchestrator.js:561-600`）。→ 升级为「旧 turns → LLM 摘要替换 + 关键工具结果保留 tombstone 行」，阈值自动 + 手动触发；复用 `chat-summary.js` 的 LLM 摘要能力但粒度改**会话级**（project 级摘要 `project_chat_summaries` 现状保留不动）。**DB 原文不动**：compaction 只发生在发给 LLM 的视图层（对齐文章 /rewind 免费语义——我们天然可做「视图回退/展开原文」，因为 SQLite 原文永在）。
- **B3 prompt cache 感知与稳定前缀**：`ai_usage` 已记录 cache 字段（BLOCK-79）——**可度量是本包的运气**。→ 先建 cache 命率 / token-per-task 基线（io-transcript + ai_usage 证据），再做：请求前缀顺序稳定（工具定义→系统提示→对话，文章 prefix-match 语义）、`model_fallback`（`loop-orchestrator.js:637`）与模型/思考档位中途切换的成本提示对齐「便宜时机」原则；ContextBudgetBar（UI-301）可扩展为上下文构成审计视图（评估项）。**cache 结论以 ai_usage 实测为准，不虚设断言**（各 provider 缓存行为不一，BLOCK-82 验收抓真同款纪律）。
- **B4 启动载荷瘦身（评估项为主）**：系统提示每轮重拼含站点快照 3500 字（`agent-runner.js:400`）+ 工具指南数百行（L438-553，静态段内存缓存已有 `system-prompt.js:8-72` 但每次请求仍全量发送）。→ 对齐文章「工作流文档移入 skills 按需加载」：工具指南按需化/压缩评估 + 裁剪；落点与数字在 P0 评审定，**不盲改**（工具指南影响行为，改动须逐项对账）。
- **B5 工具输出整形**：30K 硬截断已存在（`conversations.js:100`）——文章同款（BASH_MAX_OUTPUT_LENGTH 30k 落盘）。缺口是**中等噪声输出**（400 行通过测试逐行打印这类「限下噪声」）。→ 系统提示注入 quiet/tail 使用指南（文章 CLAUDE.md quiet flags 建议的产品化）；大输出「截断」升级为「落盘 + 预览 + 可展开」（io-transcript 落盘先例）。

## 2. 事实基线（2026-09-16 摸底）

| 领域 | 现状 | 位置 |
| --- | --- | --- |
| 会话持久化 | `copilot_conversations` / `copilot_messages`（content 硬截 30000）/ `tasks`+`task_events` / `project_chat_summaries` / `ai_usage` | `helpers/conversations.js:20-43`、`agent-task-store.js:252-285`、`helpers/chat-summary.js:27-35`、`helpers/ai-usage.js:17-49` |
| 流订阅 | HTTP SSE + afterSeq 续传，后端 500ms 轮询 task_events 增量 | `copilotClient.ts:506,847-934`、`routes/ai-agent/events.js:122-147` |
| 历史加载 | ASC+LIMIT 拿最旧 200 条、无游标分页 | `routes/ai-conversations.js:121-122`、`useConversationResume.ts:45` |
| LLM 历史拼装 | 前端每轮全量上报；后端拼系统提示（快照/事实/摘要/plan/知识召回/工具指南/桌面指令） | `useChatStream.ts:206-211`、`agent-runner.js:373-633` |
| 裁剪/摘要 | trim 只丢不摘要（85% 熔断每 run 一次）；chat-summary 项目级（22/14 阈值）；`context_checkpoints` 表现成挂点 | `message-trimmer.js:123-211`、`loop-orchestrator.js:561-600`、`chat-summary.js:89-132`、`db.js:67` |
| 用量/缓存观测 | ai_usage 含 tokens/latency/cache/cost_cny/provider；io-transcript JSONL 全量落盘（8MB/64MB 上限） | `helpers/ai-usage.js`、`llm-providers/io-transcript.js` |
| 渲染 | displayMessages 全量重拼+全量重渲染、无虚拟化、滚动无守卫；UI-382~387 折叠/图标/内联卡已交付 | `SimpleChat.tsx:693-792,809-813,1401-1576`、`ToolActivityList.tsx` |
| 续接 | task resume + 进度摘要 + llm-transcript 取证；localStorage 可续任务；fork 分支 | `routes/ai-agent/resume.js:110-273`、`copilotClient.ts:518-596`、`routes/ai-conversations.js:140-180` |

已有资产对账（**避免重复开发**）：@-mention 等价物 = BLOCK-91 附件引用注入（已交付，不再做）；subagent 上下文隔离 = wait_agent 4000 token 摘要回父（BLOCK-65 基线，已是文章模式；噪声活+专职+便宜模型与 BLOCK-93 衔接，本包零触碰其文件面）；token 计数/窗口表 = `token-estimator.js` + `model-context-windows.js`（复用）。

## 3. 非范围（exclusions，写死）

- **BLOCK-92 文件面零触碰**：SimpleChat.tsx（2024 行）拆分归 BLOCK-92 Wave A（硬门槛=UI-386 WIP 收编）；本包只改其行为不搬不拆；撞期即停手上报裁决；
- **BLOCK-93 文件面零触碰**：agentCategories / 子智能体 UI 三处 / 角色注册表 / 只读白名单；
- **BLOCK-94 召回质量面零触碰**：知识召回注入的挂点收敛已在彼包 F1，本包只消费注入结果；
- project 级 `project_chat_summaries` 粒度与策略不变（B2 只做会话级，不动项目摘要）；
- 思考行渲染位置（BLOCK-82 遗留候选）不在本包重开；
- 手机投影信息流（桌面-only 先行，BLOCK-89 先例）；
- 多模型路由策略 / Provider 矩阵 / 成本计费产品化 = G1+；G0 开发期常态 · 不外推 packaged/Provider/GA；
- 0 新依赖预期（tiktoken 已在）；若评估引入新依赖须走 `DEPENDENCY-CHANGE-CHECKLIST` + 用户裁决。

## 4. 原则（本包家法）

1. **压缩诚实可见（红线）**：任何 compaction/trim 在信息流中有可见标记（A5 与 B2 绑定交付），不悄悄丢上下文；DB 原文永不删改——compaction 只作用于发给 LLM 的视图层，用户可展开原文/视图回退（/rewind 免费语义的产品化）；
2. **度量先行**：B 面任何「省了 token」的宣称必须有 ai_usage/io-transcript 同任务前后对账数字，不写没有数字的性能宣称；cache 结论以各 provider 实测为准；
3. UI 增量同提交登记 `docs/ui-productization-audit.md`（UI-### 顺延）；信息流样式与 UI-382~387 既有风格合流（停靠承载、同真值一张皮）；
4. 每工作面独立提交、可中断可续作；面内动前存受影响测试基线、动后对账归属（红禁静默）——B 面触碰 `agent-runner.js` / `loop-orchestrator.js` 高危区，loop/agent 族存量基线红（continuation guard 2 项 🟡）归属对账照 BLOCK-94 §5 同款纪律；
5. 历史行为兼容：B1 改拼装权须保持 resume/fork/多端镜像（BLOCK-87 5s 轮询）三链路契约测试全绿后才切换；
6. dev 纪律：core/petri-server 变更须重启 dev 栈并预告用户窗口闪动；fnm Node 24。

## 5. 阶段草案（P0 评审裁剪优先级后串行执行）

| 阶段 | 内容 | 验收门禁 |
| --- | --- | --- |
| P0 | 设计评审：六工作面逐项代码事实复核 + 用户裁决优先级与 B1 增量协议、B4 取舍 | 评审结论回写本文件 + 用户确认 |
| P1 | A1 游标加载（修最旧 200 条）+ A3 滚动守卫 + A4 语义分段 | conversations 路由契约测试扩展全绿 + 组件测试 + 实机长会话（>200 条）真轮次 |
| P2 | B1 历史拼装收归后端（含落库时机确认、增量协议、三链路兼容切换） | agent/conversation 契约族全绿 + resume/fork/多端镜像回归 + 实机真轮次对账 |
| P3 | B2 会话级 rolling compaction + A5 压缩/续接可视化（绑定交付） | trimmer/摘要契约测试 + 视图层投影断言（DB 原文不变）+ 实机长会话压缩前后 token 对账数字 |
| P4 | B3 cache 感知（ai_usage 基线报告 → 前缀稳定 → 切换成本提示；审计视图评估项） | 基线数字落 acceptance + 提示面组件测试 |
| P5 | A2 渲染性能（尾部局部更新；虚拟化评估）+ B4/B5 评估项收尾 | 渲染路径组件测试 + 实机流式帧率观测 + 评估结论登记 |
| P6 | 整包收口 | `npm run closeout` + dev-verify 实机 flow allPass + 证据落 `acceptance/block-95/`（新目录必配 impact-map） |

**完成语义**：整包 `completed` = 已启动工作面全部收口 + 实机证据落 `acceptance/block-95/`；未启动工作面必须经用户显式裁决 `deferred` 并回写本状态头，不允许「半拆无主」状态跨包存续。

## 6. 风险与红线

- **SimpleChat 三重敏感**（全仓最大前端文件 + P6 绑定源 + UI-38x 高频迭代面）：本包是继 BLOCK-94 之后又一个落点涉及它的排队包，撞期即停手上报，参照 BLOCK-92 §5 / BLOCK-94 §5 同款纪律；
- **B1 是行为等价性最脆弱的改造**：历史拼装换手可能 subtly 改变发给 LLM 的内容（转义/顺序/截断差异）——P2 必须有「切换前后同会话请求体 diff 对账」（io-transcript 可直接比对）；
- **B2 摘要质量风险**：摘要丢关键约束 → tombstone 保留策略 + 原文可展开兜底 + P3 实机对账；
- **cache 语义 provider 差异**：不虚设缓存断言，以 ai_usage 实测为准（BLOCK-82 验收抓真同款）；无 cache 字段的 provider 诚实标注；
- **诚实边界**：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 收口预期预先声明（对账清单）

- 每工作面门禁实况数字（定向测试 x/x / tsc / 实机断言数）记入本文件状态头与 AUDIT-LOG 行；
- B 面优化前后 token/cache 对账数字落 `acceptance/block-95/`，与 UI-### 台账行一一对应，impact-map 同步登记；
- 「压缩可见」红线逐面验收（每处 compaction 落地点都有对应 UI 标记断言）；
- `npm run docs:check` 与 `npm run ui:audit:check` 收口必绿。
