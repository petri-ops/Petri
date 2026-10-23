---
capability: q3-execution-trace
goal: 让用户能看懂「这一轮到底发生了什么」并能定位失败——事件级执行轨迹（右栏「轨迹」surface，与模型 I/O 互链）、活动卡诚实态、轮次/工具级错误边界、证据面聚合；轨迹与模型 I/O 互相链接而不是互相替代。
acceptance:
  - 真源单一：轨迹只读 `task_events`（含终态 delta 合并后的快照行）；分类/摘要/统计是后端单源 `helpers/trajectory-events.js`，前端不建第二套事件映射。
  - 有界且诚实：`GET /api/ai/agent/trajectory` 支持 `afterSeq` + `limit`（默认 200 / 上限 500），命中上限给 `truncated`；`recordedOnly` 明示"只显示已记录事件"；未上报的耗时显示"—"，不显示 0；任务不存在 / 无事件 / 无会话区分 `availability` 原因。
  - 鉴权：会话归属（copilot_conversations.user_id）+ 任务 `user_id` 双校验；跨用户 403；子代理任务不混入主轨迹（`kind != 'subagent'`）。
  - 轨迹视图：右栏新增「轨迹」surface；9 类筛选（全部 + 工具/文本/思考/错误/压缩/用户/助手/系统）；跟随最新 + 手动回到最新。
  - 定位失败：错误筛选 + 最近失败跳转 + 失败计数（不把 denied/timeout 记成 0）。
  - C1 对账：**既有 `MessageRail`（UI-262）已提供用户消息导航（刻度点击/悬浮预览/滚轮逐条）+ 「回到底部」**——本包不重复造第二套导航，实机断言其仍在（`aria-label="跳转到第 N 条用户消息"`）。
  - C2 对账：压缩提示/提问卡/轮次失败卡/截断标记已存在（只对账，不重复造）；写工具无 diff 时显示"未记录逐行改动"诚实态。
  - K1 边界：轮次级 + 工具行级 `SegmentBoundary`（局部失败不白屏），注入测试覆盖。
  - H3/C4：证据面聚合执行事件计数与轨迹入口；轨迹头部展示 run 级统计（事件/工具/失败/tokens/用时；缺失如实）。
  - 实机：隔离栈亮/暗各一轮——真实失败工具链 → 新装载读轨迹 → 按错误筛选 → 定位失败 → 模型 I/O 互链 → 证据面聚合；离屏（测试窗不出现），截图可用则落、不可用如实标 `screenshot_unavailable`。
status: completed
---

# BLOCK-248 · Q3：执行轨迹与可观测性

> **一句话**：把「这一轮到底发生了什么」从聊天流里的折叠行，变成一条**可筛选、可定位失败、只读已记录事件**的执行轨迹；轨迹是事件级（`task_events`），模型 I/O 是请求级（`llm-transcripts`），两者互相链接。

## 0. 交接摘要（换 agent 先读这一节）

- **母纲**：`docs/qoder-essence-absorption-plan.md` §Q3（C1/C2/C3/H3 + K1）与 §6.5 第 4 行；C4「结果统计」按 §6.5 随本包落 run 级统计（逐消息动作留 reopen，理由见 §7）。
- **当前状态**：`completed`。Node `block248-trajectory` 6/6 + `live-window-policy` 1/1；前端定向 54/54；实机隔离 9223 **亮 20/20 · 暗 20/20**（离屏，无可见测试窗）；**`npm run closeout` 十三门 PASS**；**截图在隐藏窗下不可得 → 如实记 `screenshot_unavailable`**（DOM 证据：`elementFromPoint` 命中 + 行几何）。
- **本包只做**：事件轨迹 API + 轨迹 surface + 既有导航对账 + 诚实态 + 边界 + 证据面入口。**不建** hook 系统（母纲 ⛔ 明确）、不建第二套事件真源、不引入虚拟化库。
- **红线**：零新依赖；轨迹分类/摘要后端单源；只读 `task_events`；未记录的时间/耗时显示"—"；跨用户数据一律 403。
- **G0 开发期常态 · 不外推 packaged/Provider/GA。**

## 1. 范围与判据

| 项 | 判据 |
| --- | --- |
| 事件真源 | `task_events(task_id, seq, event_type, payload, created_at)`；终态 delta 合并是透明快照，轨迹按行展示并标注"已合并"不另行推断 |
| API | `GET /api/ai/agent/trajectory?conversationId=&taskId=&afterSeq=&limit=`：解析最近主任务 → 分页事件 + run 统计 + `availability/truncated/recordedOnly` |
| 分类 | 8 组：tool / text / reasoning / error / compaction / user / assistant / system；未知事件落 system 并保留原名 |
| 视图 | 右栏「轨迹」surface：统计头 + 筛选 chips + 跟随最新 + recordedOnly 说明 + 空/载/错态 |
| 链接 | 轨迹 ↔ 模型 I/O（`io` surface）双向可达；证据面（`evidence`）给出事件计数与轨迹入口 |
| 导航 | C1 对账：既有 `MessageRail`（用户消息刻度/悬浮预览/滚轮逐条）+ 「回到底部」继续有效；本包只断言不重建 |
| 边界 | 每条消息行、每个工具行各包一层 `SegmentBoundary`（无错误时不产生 DOM） |
| 非范围 | hook 事件系统、虚拟化、跨会话/跨联邦轨迹聚合、逐消息 token 统计动作（reopen） |

## 2. 架构（谁负责什么）

```
core/petri-server/helpers/trajectory-events.js     ← 单源：事件分类 + 有界摘要 + 统计形状（纯函数）
core/petri-server/agent-task-store.js              ← 最近主任务查询 + 事件统计聚合（SQL，只读）
core/petri-server/routes/ai-agent/trajectory.js    ← GET /api/ai/agent/trajectory（鉴权/分页/availability）
frontend/src/components/work-surface/TraceSurface.tsx ← 轨迹视图（筛选/跟随/统计/空态）
frontend/src/lib/workSurface/registry.ts           ← core surface `trace`（标题/图标/顺序单源）
frontend/src/pages/project-workspace/rightPanelTabs.ts ← RightPanelMode + 'trace'
frontend/src/components/workspace-panels/RightPanel.tsx ← 挂载 TraceSurface
frontend/src/components/workspace-panels/EvidenceSurface.tsx ← 执行事件计数 + 入口
```

**为什么轨迹不复用 `LlmTranscriptViewer`**：transcript 是模型请求/响应原文（I/O），轨迹是 agent 运行时事件（工具、错误、压缩、插话）。两者粒度不同、隐私边界不同；互相链接，不做第二真相。

## 3. 阶段与状态

| 阶段 | 状态 | 产出 |
| --- | --- | --- |
| P0 对账 + 立项 | ✅ | 本文件；C1/C2 已有项逐个实证（MessageRail / 压缩提示 / 提问卡 / 失败卡 / 截断标记） |
| P1 事件轨迹 API | ✅ | `trajectory-events.js`（分类/摘要/编排单源）+ `agent-task-store` 尾部/更早分页 + 统计聚合 + `/api/ai/agent/trajectory` + Node 6/6 |
| P2 轨迹视图 | ✅ | `TraceSurface`（9 chips/跟随最新/失败定位/统计头/recordedOnly）+ `trace` surface 注册 + 组件 6/6 |
| P3 对账/诚实态/边界 | ✅ | C1 对账（MessageRail 实机断言）+ 写工具 diff-absent 诚实态 + `TurnBoundary`/`ToolRowBoundary` + 注入测试 2/2 |
| P4 实机 + 收口 | ✅ | 亮/暗各 20/20（离屏）+ 证据面聚合 + 台账回写 + closeout |

## 4. 实码锚点（接手者可直接查）

- 事件写入：`core/petri-server/agent-runner.js`（`_emit` → `appendAgentTaskEvent`），终态 delta 合并在 `agent-task-store.js:coalesceTaskDeltas`。
- 事件读取：`agent-task-store.js:getAgentTaskEventsSince(taskId, afterSeq, limit)`。
- 任务主/子判定：`json_extract(params,'$.kind')`；主任务为 `COALESCE(kind,'primary') <> 'subagent'`（沿用 `listInFlightPrimaryTasks` 口径）。
- 既有提示/卡片：`SimpleChat.tsx` 压缩提示（BLOCK-95 B2/A5）、`ask_user_question` 问题卡（BLOCK-244）、`ErrorBanner` 失败卡、`changeDiff.truncated` 截断标记。
- 边界原语：`frontend/src/components/shell/SegmentBoundary.tsx`（无错误时不产生 DOM）。
- 右栏 surface 注册：`frontend/src/lib/workSurface/registry.ts:CORE_WORK_SURFACES`。
- 模型 I/O surface：`RightPanel.tsx` 的 `tab === 'io'`。

## 5. P0 对账（避免重复开发）

| 母纲项 | 实码结论 | 处置 |
| --- | --- | --- |
| C1 时间线锚点 | **P0 对账纠正**：`MessageRail`（UI-262/BLOCK-29）已提供用户消息刻度导航 + 悬浮预览 + 滚轮逐条；`useScrollGuard` 已有「回到底部」 | **不重复造**；实机断言既有导航仍在 |
| C2 压缩卡 | `sc-compaction-notice` 已存在（BLOCK-95 B2/A5，含"仍显示原文"诚实说明） | 对账，不重做 |
| C2 提问卡 | `ask_user_question` 问题卡已存在（BLOCK-244） | 对账，不重做 |
| C2 失败卡 | `ErrorBanner` + `resumable` 继续执行已存在 | 对账，不重做 |
| C2 diff 诚实态 | `truncated` 标记已存在；**写工具无 diff 时无说明** | **补"未记录逐行改动"** |
| C3 事件轨迹 | 只有模型 I/O（`LlmTranscriptViewer`），无事件级轨迹 | **本包新建** |
| H3 证据面 | `EvidenceSurface` 聚合 artifact/job/workflow；无事件级计数 | **补计数 + 轨迹入口** |
| K1 边界 | `SegmentBoundary` 只挂结果/文件预览 | **补轮次/工具行级** |
| C4 结果统计 | run 级 usage/tool 事件可得；逐消息 token 无真相 | 轨迹头部出 run 级统计；逐消息动作 reopen |

## 6. 验收（结果）

- Node：`test/block248-trajectory.test.mjs` **6/6**（8 组分类/未知事件保留原名、摘要截断、工具状态与耗时、未上报耗时不补 0、分页收敛、鉴权/归属/404/403/会话不匹配、尾部/增量/更早三种读法、存储层最近主任务与统计真值）+ `test/live-window-policy.test.mjs` **1/1**（脚本不得开可见测试窗）。
- 前端定向 **54/54**：TraceSurface 6（空/载/错、统计、筛选、失败定位、加载更早）、EvidenceSurface 4（事件统计 + 入口 + 诚实占位）、ToolActivityList 30（含无 diff 诚实态）、TimelineBoundaries 2（注入抛错只坏一段）、registry 6、SimpleChat 6。
- 实机（隔离 9223，mock provider；**离屏**）：**亮 20/20 · 暗 20/20**（`acceptance/ui-558/`、`acceptance/block-248/`）。断言链见 §5.1；失败定位同时断言 `inList` 与 `elementFromPoint` 命中。
- **截图边界（用户裁决优先）**：测试窗必须离屏（用户 2026-10-23 再次要求「不要屏幕出现」），隐藏窗的 `Page.captureScreenshot` 等不到合成帧 → 两轮均如实记 `unavailable:screenshot_timeout(offscreen)`（`ui558-screenshots-{light,dark}.json`）。**不开窗换截图**；`acceptance/ui-558/` 里现存 3 张 PNG 是改规则前（20:46）的 onscreen 运行产物，仅作视觉参考，不代表本轮证据。
- 门禁：`npm run closeout` 十三门 **PASS**（test:changed 542s + ui:audit 143s + lint 0 error + types 0 + knip 279 键冻结 + `skills:check` 报告级 OK）+ canonical 回写 + 本地提交（不推送）。

### 5.1 实机断言链（亮/暗各一轮，20 条）

`E1/E1b/E2/E3` 隔离栈 + 项目/工作区 + mock provider · `W0` 工作区路由与项目选中 · `W1` 轨迹 surface 可见 · `R1` 会话解析 · `R2` 轨迹 API 收尾且 **toolFailures=1** · `W2` 既有 MessageRail（C1）仍在 · `W3` 新装载读轨迹 · `R3` 轨迹可见 · `R4` 事件行渲染（13 条）· `R5` 工具失败行可见（`status=error`, ENOENT）· `R6` recordedOnly 口径 · `R7` 错误镜头只筛失败 · `R8` 定位最近失败（inList + hit）· `R9` 模型 I/O 互链 · `W4` 证据面装载 · `R10` 事件统计（事件 13 · 工具 1 · 失败 1）· `R11` 证据面入口打开轨迹。

## 7. 非范围与诚实边界

- **hooks 事件系统不建**（母纲 ⛔：需用户显式解锁）；轨迹只渲染已上报事件。
- **不做虚拟化**：轨迹单页上限 500 条，靠分页而不是一次性渲染全量；长任务靠 `afterSeq` 续读。
- **记录语义**：`recordedOnly` 表示本视图只显示落库事件，不推断未上报的耗时/正文。终态 delta 合并**没有逐行标记**（合并对回放透明），所以只在口径说明里写「文本为终态合并快照」，不逐行猜测。
- **逐消息结果统计（C4 消息动作）**：reopen——`task_events.usage` 只有 run 级调用记录，没有"某条消息消耗多少 token"的独立真相；强行分摊会造第二真相。
- **跨会话/联邦轨迹**：reopen。
- **轨迹/模型的边界**：轨迹是事件级（工具/错误/压缩/插话），模型 I/O 是请求级（messages/参数/响应）；互链但不合并，避免第二真相。
- **离屏截图**：G0 开发期常态下按「测试窗不可见」执行；若后续需要截图证据，走 Electron `webContents.capturePage` 的测试实例 IPC（reopen），**不得**恢复可见窗口。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
