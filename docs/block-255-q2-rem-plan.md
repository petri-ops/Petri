---
capability: q2-rem
goal: 收掉 Q2 最后两项——C4 让每条助手回复有可核的逐消息统计（耗时/工具步数/迭代/字符 + 本条模型调用的 token 合计；无数据时诚实说未记录），C17 让会话列表条目可拖入 composer，复用唯一 ComposerContextItem 通道与既有有界摘要，不建第二条注入通道。
acceptance:
  - C4：助手消息动作注册表出现「统计」，面板展示本条真实可用的耗时/工具步数/迭代/字符/模型；有 usage 时展示输入/输出/缓存读/缓存写 token 与有 usage 的调用数，无 usage 时明确写「未记录」，不得用 0 冒充不可算。
  - C4：本条 token 合计来自本轮模型调用 usage 的累加，随助手消息 meta 落库（`copilot_messages.meta_json.usage`）并在历史恢复时还原；不新增表/迁移，不改 `ai_usage` 会话级口径。
  - C17：左栏会话条目可拖到 composer；落下后只产一条 `ConversationContextItem`（kind=conversation，reference 组），带标题/conversationId/消息数与有界摘要；上限、去重、移除走既有 `appendContextItem` 单源。
  - C17：拖当前会话不得自引用（可见提示）；摘要拉取失败仍可引用标题与元数据并如实标注；`@` 会话源与键盘路径保持不变。
  - 定向测试全绿：Node 新增 usage 累加/契约测 + 既有 UI-523 测；前端统计动作/面板/拖放/摘要构造/行 memo 回归；`quality:types` 0、`quality:lint` 0 error、theme 契约 17/17。
  - 隔离 9223 离屏实机：统计按钮可见可开、面板断言真实字段（无 usage 时断言诚实文案）；会话拖入 composer 出现会话 chip 且正文含【引用会话】；亮/暗各一轮；截图不可得如实 `unavailable`。
  - closeout 十三门 PASS；canonical 回写（plan/roadmap/handoff/AUDIT-LOG/UI-566/Q-MATRIX C4/C17）。
reopen: 逐消息成本（人民币）与按模型价目表计费；BLOCK-255 之前的历史消息无 token（只显示耗时/工具/迭代）；统计面板导出/复制；从项目树、结果面、知识空间拖放；跨设备同步；G1+。
status: completed
---

# BLOCK-255 · Q2-REM：C4 逐消息统计 + C17 会话拖入 composer

用户发令：「搞定 Q2-REM」（2026-10-25）。本包是 Q2 的收尾包，只做 C4 逐消息统计与 C17 会话拖入 composer，不扩到 Q3/Q4/Q7。

## 0. P0 实码对账（2026-10-25）

| 项 | 实码事实 | 结论 |
| --- | --- | --- |
| 消息动作 | `SimpleChat/messageActions.ts` 注册表已有 edit/copy/regenerate/fork/quote-context/rate-up/rate-down；行组件按 spec 渲染，无统计动作 | 加 `stats` 进注册表，不硬编码 JSX |
| 逐消息可得数据 | `SimpleMessage.processingDurationMs`（meta 持久化）、`toolActivities`、`progressUpdates`、`reasoningByIteration`、`resultNodes`；`modelName` 仅流式期赋值，历史不还原 | 耗时/工具/迭代/字符可直接用；模型取自 usage.models 或 m.modelName |
| 逐消息 token | `ai_usage` 只有 `conversation_id` 维度（无 message/run 列）；`runLoop` 每次 provider 调用发 `usage` 事件，但不聚合、不返回；`copilot_messages.meta_json` 无 usage | 在 loop 内累加本轮 usage，随助手消息 meta 落库；零迁移 |
| 实时 usage | `agentTaskStream` 把 `usage` 事件派发为 `petriEvents.runUsage`；`useRunUsage` 只保留最近一次调用；`conversationRunStore` 不累计 | 新增 `useRunUsageTotals`，按 runStartedAt 重置，供最新助手行实时展示；历史行走 meta.usage |
| 会话上下文 | `contextSources.buildConversationCandidates` 已产 `kind=conversation` 的 ComposerContextItem，摘要三重有界（8×300×2000）；`useContextSources` 最多给 6 个会话补摘要 | 拖放复用同一 builder/上限，不建新通道 |
| 会话列表 | `LeftPanel` 的 `ConversationItem` 是 `<li>`，不可拖；当前桌面模式无标题栏会话选择器（UI-334 已移除） | 只在 LeftPanel 会话行加 `draggable` + 自定义 MIME |
| composer 放下 | `SimpleChat` 的 `handleDrop` 只处理 Files（`attachments.onDrop`）；`onDragOver` 只对 Files 点亮拖拽态 | 抽出 `useComposerDrop`：先识别会话 MIME，再回落文件；`onDragOver` 接受会话 MIME |
| 通道纪律 | `useComposerContext.addItem` 是唯一 append 入口（上限/去重/notice 单源） | 拖放只调 `addItem`，零第二通道 |

**Patch vs refactor 判定**：patch。动作加进既有注册表；拖放复用既有 builder 与 ContextItem 通道；token 聚合是 loop 返回值的增量字段 + 既有 `meta_json` 落库。唯一抽卡点是把 `SimpleChat.handleDrop` 抽成 `useComposerDrop`，用于守住 `SimpleChat.tsx` 的 code-size 棘轮（只减不增）。

## 1. 范围

### C4 逐消息统计

- 助手消息动作新增「统计」（`bar-chart` 图标，开合面板；`aria-expanded`/`aria-controls`）。
- 面板字段：本条处理耗时、工具步数、模型迭代数、字符数、模型（usage.models / 行内 modelName）、输入/输出/缓存读/缓存写 token、有 usage 的调用数；有未返回 usage 的调用时单列。
- 数据来源：
  - 本条 `processingDurationMs`、`toolActivities`、`progressUpdates`、`reasoningByIteration`、`resultNodes`（已有）。
  - `meta_json.usage`：本轮 `runLoop` 内每次 provider 调用的 usage 累加（calls/prompt/completion/cacheRead/cacheCreation/durationMs/models/unmeasuredCalls）。
  - 实时：`useRunUsageTotals` 在 run 进行/刚结束时累加 `petriEvents.runUsage`，由 `buildBaseDisplayMessages` 挂到最新助手行；落库后以 meta 为准。
- 无 usage：面板明确写「本条未记录 token（旧消息或渠道未返回 usage）」，其余字段照常显示；不写 0。

### C17 会话拖入 composer

- `ConversationItem` 加 `draggable`，`dragstart` 写入 `application/x-petri-conversation`（id/title/messageCount/updatedAt）。
- composer drop：识别会话 MIME → 拉最近 12 条消息生成同一个 `buildConversationDigest` 摘要 → `buildConversationCandidates` 产条目 → `addItem`；当前会话拒绝并提示；拉取失败时退化为元数据条目并加一行「摘要未能载入」。
- `onDragOver` 同时接受 Files 与会话 MIME；拖拽态高亮沿用 `.sc-composer-dragging`。
- 键盘替代：既有 `@` 会话源保持；会话行 title 提示「拖到输入框引用；也可用 @ 选择会话」。

## 2. 非范围

- 不新增表/迁移；不改 `ai_usage` 的会话级聚合口径；不做逐消息人民币成本（无稳定价目表口径）。
- 不做 BLOCK-255 之前历史消息的 token 回填（无数据源，不伪造）。
- 不做统计面板导出/复制、图表、跨消息汇总（既有 `RunStatsBar` 已覆盖运行/会话级）。
- 不做项目树/结果面/知识空间拖放；不做标题栏会话选择器（UI-334 已移除）；不做跨设备。
- 不改 `@` 会话源上限/摘要算法；不建第二条 composer 注入通道。
- G1+（Provider/GA/packaged/公证）不涉及。

## 3. 阶段与交付

| 阶段 | 内容 | 证据 |
| --- | --- | --- |
| P0 | 本对账与立项登记 | 本文件 §0；AUDIT-LOG 启动行；DOC-REGISTRY active |
| P1 | loop usage 累加 + assistant meta 落库 + 前端恢复 | Node `test/block255-message-stats.test.mjs`；既有 UI-523 测 |
| P2 | 统计动作 + `MessageStatsPanel` + 实时 `useRunUsageTotals` + 行 memo 回归 | 前端 `messageActions` / `MessageStatsPanel` / `SimpleChatMessageRow` 定向测试 |
| P3 | 会话拖拽源 + `useComposerDrop` + `conversationDrag` 构造/摘要 | 前端 `conversationDrag` / `useComposerDrop` / `attachments` 测试 |
| P4 | 定向测试 + types/lint/theme + impact-map 登记 | 命令输出；`test:changed` EXIT=0 |
| P5 | 隔离 9223 离屏实机（亮/暗） | `acceptance/block-255/q2rem-live*.json` |
| P6 | closeout 十三门 + canonical 回写 | closeout 日志；plan/roadmap/handoff/AUDIT-LOG/UI-566/Q-MATRIX |

## 4. 验收门禁

- `node --test test/block255-message-stats.test.mjs test/ui523-usage-event.test.mjs`
- `npm run test:files --prefix frontend -- src/components/copilot/SimpleChat/messageActions.test.ts src/components/copilot/SimpleChat/MessageStatsPanel.test.tsx src/components/copilot/SimpleChat/SimpleChatMessageRow.test.tsx src/components/copilot/SimpleChat/SimpleChatMessageRow.stats.test.tsx src/components/copilot/SimpleChat/conversationDrag.test.ts src/components/copilot/SimpleChat/useComposerDrop.test.tsx src/components/copilot/SimpleChat/attachments.test.ts src/components/copilot/SimpleChat/contextSources.test.ts src/styles/theme-token-contract.test.ts`
- `npm run quality:types` / `npm run quality:lint` / `npm run ui:audit:check`
- `npm run test:changed`（impact-map 先登记新生产路径与 acceptance 目录）
- `npm run closeout` 十三门
- 隔离 9223：`bash scripts/start-test-instance.sh`（离屏；禁 `PETRI_TEST_ONSCREEN`），跑 `scripts/block255-q2-rem-live.mjs`；证据落 `acceptance/block-255/`；截图不可得标 `unavailable`。

## 5. 风险与诚实边界

- **实时 usage 与落库口径差异**：实时只能看到已发 usage 的调用；`unmeasuredCalls` 只有后端知道。UI 对实时值只报「有 usage 的调用」，落库后以 meta 为准；两者不混写成同一数字。
- **历史消息**：BLOCK-255 前的助手消息无 token，只显示耗时/工具/迭代；面板明写「未记录」。
- **拖放兼容**：Chromium/Electron 的 HTML5 drag 自定义 MIME 在离屏测试实例中需用 `DragEvent` + `DataTransfer` 合成；若 CDP 合成不达，按无人化阶梯如实降级并在台账标注，不伪造通过。
- **code-size 棘轮**：`SimpleChat.tsx` 只允许变短；`handleDrop` 抽成 hook，新增行由抽取抵消。
- **memo 边界**：统计面板状态留在行内；实时 usage 只挂最新助手行（`displayMessages` 对尾行做副本），不得把所有历史行拖入每事件重渲染。

## 6. 完成语义

`completed` 需同时满足：C4/C17 验收项有测试/实机证据；closeout 十三门 PASS；canonical 回写完成；UI-566 在实机证据后 `verified`；未提交 WIP 如实登记。未获用户提交发令时保持 WIP，不代提交。

## 7. 执行记录（2026-10-25，P1–P6 completed）

- **P1 backend**：`helpers/run-usage.js` 新增 `createRunUsageTotals` / `accumulateRunUsage`；`loop-orchestrator` 在每次 provider 调用结束后累加（有 usage 计 calls/tokens/cache/duration/models，无 usage 计 unmeasuredCalls），随 `runLoop` 返回；`agent-runner` 传 `assistantUsage`；`conversation-adapter` 写 `assistantMeta.usage`（既有 `meta_json`，零迁移）。Node `test/block255-message-stats.test.mjs` **6/6**。
- **P2 C4 前端**：`SimpleMessage.usage` + `restoreMessageUsage`；消息动作新增「统计」；`MessageStatsPanel` 展示耗时/工具/迭代/字符/模型/token/cache/调用；`useRunUsageTotals` 按 `runStartedAt` 归零并累加实时 `runUsage`；`displayMessages` 把实时合计挂到运行投影/尾行。C4 定向 **46/46**（含行 memo 回归、theme 17/17）。
- **P3 C17 前端**：`ConversationItem` 加 `draggable` + 自定义 MIME；`useComposerDrop` 先识别会话、再回落文件；`conversationDrag` 复用 `buildConversationCandidates` / `buildConversationDigest`，当前会话拒自引用，摘要失败退化为元数据并注明。C17 定向 **49/49**（conversationDrag 8 + useComposerDrop 5 + attachments 10 + contextSources 23 + useRunUsageTotals 3）。
- **P4 门禁**：`test:changed` EXIT=0（Node **1692** / 1683 pass / 0 fail / 9 skipped；前端 **79** 文件 / **602** tests）；`quality:types` 0；`quality:lint` 0 error；theme **17/17**；impact-map 无 unknown；knip 保留面 **+1**（`q2rem-stats-drag-live.cjs` 为脚本 `require(FLOW_PATH)` 动态入口，已定性并 `--update`）；code-size `SimpleChat.tsx` **2109→2106**（drop 逻辑外移抵消新增）。
- **P5 实机**：隔离 9223 离屏，亮/暗各 **17/17**（`acceptance/block-255/q2rem-live.json` / `q2rem-live-dark.json`；截图如实 `unavailable`）。断言链：左栏两会话行 → 当前会话种子消息 → 统计动作/面板（2 次有 usage / 1 次未返回 / 输入 1K / 2 步 / 2 轮）→ 无 usage 行「未记录」→ 当前会话自拖被拒（提示 + 0 chip）→ 目标会话拖入产唯一 conversation chip（conversationId + 有界摘要）→ chip 可移除 → 收尾回 `?test=1`。
- **P6 收口**：closeout 十三门**逐门取证 PASS**（整链收尾在 test:affected 的收尾 UI 检查处挂起，按 BLOCK-254 先例结束挂起进程并逐门补证：hygiene/docs/ui-audit/test:changed/code-size/arch-cycles/css-modules/secret/arch/lint/types/knip 全 0；audit:compact 已幂等执行）；canonical 回写（plan/roadmap/handoff/AUDIT-LOG/UI-566/Q-MATRIX C4/C17/backlog/DOC-REGISTRY）。
- **诚实边界**：实机覆盖「落库 `meta.usage` 恢复 + 会话拖放真实 DOM」；实时 `runUsage` 累加由 `useRunUsageTotals` / `messageStats` 单测覆盖；BLOCK-255 之前的历史消息无 token，面板显示「未记录」；未做逐消息人民币成本与统计导出（reopen）。
