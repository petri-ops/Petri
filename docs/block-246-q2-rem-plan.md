---
capability: q2-rem
goal: 把 Q2 首切片（BLOCK-245）留下的七项余项一次做完，并全部挂在那条唯一的 `ComposerContextItem` 通道上：C13 速记板（旁路用户资产表 + 面板 + 搜索 + 来源）、C12 划词动作生产者（让 `selectionQuote` 从「有消费无生产」变成真管线）、C4 消息动作注册表化（+加入上下文/评价）、C11 图片预览（保存/多图/缩放预设）、B2 计划反馈输入（keep-planning 不再吞意见）、C16 上下文形态补全（文件夹整体引用/选中代码块/应用快照）、C17 跨会话引用（有界摘要 + 拖放）。
acceptance:
  - 不建第四注入通道：一切「加入上下文」产 `ComposerContextItem`（BLOCK-245 P2 单列表），事件面继续复用 `petriEvents.selectionQuote` / `imageQuote`（`lib/events.ts:243-247` D2 裁决有效）；引用上行仍是正文内引用块，不新增第二份落库真相。
  - C13 速记板：用户数据表只走 `src/migrations/016_scratchpad.sql`，该文件由 `core/shared-backend/scratchpad-schema.js` 的 build 函数生成且**逐字节一致**（Node 测试强制，先例 015 ↔ result-annotation-schema）；片段/图片可存·列·搜·删，每条记来源会话与来源文件；图片有体积上限且超限可见提示；搜索命中片段正文。
  - C12 划词动作：`WorkspaceFilePreview` 选区 → 浮动动作条（复制 / 加入对话 / 侧聊提问 / 加入速记 / 批注不可用如实说明）；「加入对话」派发 `selectionQuote`，载荷满足 `SelectionQuoteDetail` 契约（path/text/startLine/endLine/projectId），不新增事件类型。
  - C4 消息动作：行内按钮收进 `messageActions.ts` 注册表（id/label/icon/适用条件/执行），新增「加入上下文」（回复正文 → ContextItem）与「评价」（赞/踩 + 可选理由，落既有 feedback 通道）；既有复制/编辑/分支行为逐字不变。
  - C11 图片预览：保存（下载原图，文件名保留扩展名）/ 多图上一张下一张（含 N/M 计数与 ←/→ 键，首尾边界不越界）/ 缩放预设（50%/100%/200%）；单图调用方保持向后兼容。
  - B2 计划反馈：批准卡「继续讨论」带输入框，输入意见 → `send` 留在计划档（不退档、不批准）；空输入给出可见提示而非静默返回。
  - C16 形态补全：文件夹整体引用（递归展开、有条数上限并如实标注总数/截断）、选中代码块（带语言围栏）、应用快照（当前项目 + 活动页面 + 在跑任务摘要）三类上下文可组装进 `composeContextMessage`，且**拆前基线 12 条一字不改仍绿**。
  - C17 跨会话引用：历史会话可作上下文资源，引用后组装**有界摘要**（条数/字符双上限 + 截断如实标注）；会话列表可拖入 composer 产同一 ContextItem；同源多会话有上限。
  - 测试与实机：逐阶段 Node/前端定向测试绿 + types 0 + `test:changed` unknown 为空；隔离 9223 实机腿（mock provider）覆盖速记板/划词动作/消息动作/图片预览/计划反馈/上下文形态/会话引用，亮暗截图入 `acceptance/ui-554/`、`acceptance/ui-555/` 并复制到 `acceptance/block-246/`；closeout 十三门 PASS。
reopen: C13 图片批注（并入 Q6 速记面）、C12 跨 viewer 选择总线重构、C4 结果统计（Q3 执行轨迹）、C11 旋转/裁剪/图片编辑、B2 修订案自动生成、C16 20 项附件上限改造、C17 跨设备会话同步、G1+。
status: active
---

# BLOCK-246 — Q2 余项（C13 速记板 / C12 划词动作 / C4 消息动作 / C11 图片预览 / B2 计划反馈 / C16 形态补全 / C17 跨会话引用）

用户发令：「Q2 余项 整完」（2026-10-23）。BLOCK-245 首切片已收口（单一 `ComposerContextItem` 通道 + 统一 `@` 菜单 + 上限诚实化），本包把 §6.5 第 2 行剩下的七项一次做完，**全部挂在那条唯一通道上**，不新建第二条注入通道、不新建第二份落库真相。

## 1. 批内纪律（红线）

1. **零新依赖**：不引入编辑器/剪贴板/搜索库；能复用既有 API（`EditorApi.getSelection`、`Clipboard`、既有 client）就复用。
2. **不建第四注入通道**：一切"引用/加入上下文"产 `ComposerContextItem`（BLOCK-245 P2 单列表）；事件面继续复用 `petriEvents.selectionQuote` / `imageQuote`（`lib/events.ts:243-247` D2 裁决）。
3. **引用上行仍是正文内引用块**（`composeContextMessage`），不新增落库真相；速记板是**用户资产**（旁路表），不参与上行组装。
4. **用户数据表一律走 `src/migrations/NNN_*.sql`**：DDL 单源在 `core/shared-backend/*-schema.js`，`.sql` 由其 build 函数生成并逐字节一致（先例 `015_result_annotations.sql` ↔ `result-annotation-schema.js`）。
5. **`SimpleChat.tsx` 只许变短**：新逻辑落 `SimpleChat/*` 与 hooks；code-size 棘轮随批下调。
6. `contextChannels.baseline.test.ts` 12 条逐字断言**任何改动都必须一字不改地继续绿**。

## 2. 范围（七项，逐项判据）

| # | 余项 | 交付判据 | 非范围 |
| --- | --- | --- | --- |
| C13 | 速记板 | 片段（文本）与图片可存/列/搜/删；每条记来源会话与来源文件；图片有体积上限与超限可见提示；搜索命中片段正文；入口在右侧栏与 composer 速记按钮 | 图片批注（并入 Q6，已裁决合并）；跨设备同步（G1+） |
| C12 | 划词动作 | `WorkspaceFilePreview` 选区 → 浮动动作条：复制 / 加入对话（`selectionQuote` 产 ContextItem）/ 侧聊提问 / 加入速记（写 C13）/ 批注（文本批注不可用→如实提示原因） | 图片/PDF 批注（BLOCK-219 已有）；跨 viewer 选择总线改造 |
| C4 | 消息动作 | 动作注册表（`messageActions.ts`）替代行内硬编码按钮；新增「加入上下文」（回复正文 → ContextItem）与「评价」（赞/踩 + 可选理由，落既有 feedback 通道） | 从回复建分支（`onForkAt` 已有）、结果统计（Q3） |
| C11 | 图片预览 | 保存（下载原图，文件名带扩展名）/ 多图上一张下一张（含 N/M 与 ←/→）/ 缩放预设（50%/100%/200%） | 旋转/裁剪/图片编辑 |
| B2 | 计划反馈 | 批准卡「继续讨论」带输入框：用户写调整意见 → `send(意见)` 留在计划档；空意见时如实提示"写一句要改什么" | 修订案自动生成；计划编辑器 |
| C16 | 上下文形态 | 文件夹整体引用（递归展开、有条数上限与如实条数）/ 选中代码块（带语言围栏）/ 应用快照（当前项目+活动页面+在跑任务摘要） | 20 项附件上限改造（既有 `MAX_ATTACHMENTS` 已诚实提示） |
| C17 | 跨会话引用 | 历史会话作为上下文资源：引用后组装**有界摘要**（条数/字符双上限 + 如实标注截断）；会话列表可拖入 composer；同源多会话有上限 | 跨设备会话同步；会话内容编辑 |

## 3. 阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 立项：本 plan + registry + roadmap/handoff/AUDIT-LOG + `test/impact-map.json` 规则 | docs:check 绿 |
| P1 | C13 速记板：`016_scratchpad.sql`（由 `scratchpad-schema.js` 生成）+ `scratchpad-store.js` + `routes/scratchpad.js` + `lib/scratchpadClient.ts` + `ScratchpadPanel` | Node：schema↔sql 逐字节 + store CRUD/搜索/上限；前端：面板渲染/搜索/超限提示 |
| P2 | C12 划词动作：`WorkspaceFilePreview` 选区探针 + `SelectionActionBar` + 五动作（批注不可用如实） | 前端：动作条出现/复制/加入对话事件载荷/速记落库调用 |
| P3 | C4 消息动作注册表 + 加入上下文 + 评价 | 前端：注册表纯函数 + 行渲染 + 回调；后端：评价落 feedback |
| P4 | C11 图片预览保存/多图/缩放预设 | 前端：多图导航边界、保存 URL、缩放预设 |
| P5 | B2 计划反馈输入 | 前端：`keep-planning` + 反馈 → `send` 带计划上下文；空输入提示 |
| P6 | C16 形态补全：文件夹整体引用 / 选中代码块 / 应用快照 | 纯函数 + 组装块断言（`composeContextMessage` 扩展，基线测不变） |
| P7 | C17 跨会话引用：会话摘要有界组装 + 拖放 | pure：摘要组装上限/截断标注；前端：拖放产 ContextItem |
| P8 | 实机腿（隔离 9223 + mock provider）+ closeout 十三门 + canonical 回写 | live 全绿；13 门 PASS |

## 4. 证据

- 单测：Node（迁移/store/路由）+ 前端（组件/纯函数）逐阶段。
- 实机：`acceptance/ui-554/`（速记板 + 划词动作）、`acceptance/ui-555/`（消息动作 + 图片预览 + 计划反馈 + 上下文形态 + 会话引用）；同份报告落 `acceptance/block-246/`。
- 收口夹具复用 BLOCK-245：隔离 :3001/:3000/:9223 + mock provider + 首启浮层先点掉 + `elementFromPoint` 命中红线。

## 5. 阶段进度（换 agent 接手锚点）

| 阶段 | 状态 | 备注 |
| --- | --- | --- |
| P0 立项 | ✅ | registry/impact-map/README/roadmap/handoff/AUDIT-LOG 同步 |
| P1 C13 速记板 | ✅ | `016_scratchpad.sql`（由 `scratchpad-schema.js` 生成，Node 测逐字节一致）+ `scratchpad-store.js`（正文 8000 字 / 图片约 1.5MB / 单页 ≤100，超限返可读原因）+ `routes/scratchpad.js`（GET/POST/DELETE，注册于 routes/index.js）+ `lib/scratchpadClient.ts` + `ScratchpadPanel`/`ScratchpadDock`（composer 底栏 Ⓟ 钮）+ `scratchpadContextItem`（引用入单一通道）；Node 12/12 + 前端 6+6+27（基线 12 条仍绿）；`SimpleChat.tsx` 2119→**2118**（基线随批下调） |
| P2 → P8 | 未做 | 见 §3 |

**实码锚点（已核实）**

- 划词动作生产者缺位：`frontend/src/pages/project-workspace/WorkspaceFilePreview.tsx`（组件**存在**，1400+ 行文件已拆出；`selectionQuote` 只有消费方 `useComposerContext.ts:102`）；选区能力 `EditorApi.getSelection() → {text,startLine,endLine}`（`components/editor/CodeMirror/types.ts`）；事件契约 `SelectionQuoteDetail`（`lib/events.ts:364-377`，注释即写明生产者是 WorkspaceFilePreview）。
- 速记板零实现：`src/migrations/` 现有 001–015，无速记表；后端路由注册在 `core/petri-server/routes/index.js`（`require('./xxx')(app)` 逐条注册），DB 取 `require('../db').getDatabase()`。
- 消息行动作现状：`SimpleChat/SimpleChatMessageRow.tsx` 已硬编码「复制回复」「编辑」「分支（`onForkAt`）」；无注册表、无「加入上下文」、无「评价」。
- 图片预览：`SimpleChat/ImagePreviewModal.tsx`（128 行）只有缩小/放大/1:1/关闭，无保存、无多图；调用点在 `SimpleChat.tsx:2106-2109`（单张 `previewImage` 状态，`:334`）。
- B2：`hooks/usePlanApprovalFlow.ts:83` `if (action === 'keep-planning') return;`——批准 `keep-planning` 后既不退档也不发消息，用户意见无处可去。
- 上下文形态：`SimpleChat/contextSources.ts` 文件源已含**目录条目**（非递归展开）；`contextItems.ts` 已有 `file/artifact/skill/knowledge/session/selection/image` 七 kind，无 folder/code/snapshot。
- 会话资源：`lib/copilotConversationsClient.ts` 提供列表（`listConversations`）；`@` 菜单会话源上限 6 且只产 label/描述，未组装摘要。

## 6. 非范围

C13 图片批注（并入 Q6）、C12 跨 viewer 选择总线重构、C4 结果统计、C11 旋转/裁剪、B2 修订案自动生成、C16 附件上限改造、C17 跨设备同步；G1+（Provider/公证/GA/打包发布）一律不提不做。
