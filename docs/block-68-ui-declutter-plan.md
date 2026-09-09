# BLOCK-68 — 聊天工作台界面减负：⋯ 菜单清空 + 模型 I/O 迁右栏 + 空态极简

> 状态：`planned`（2026-09-09 用户裁决立项；启动待用户裁决）
> 立项日期：2026-09-09
> truthDomain: `block-68-ui-declutter`
> UI 台账：UI-317（实现提交同一提交内登记）
> 来源：用户 2026-09-09 两条界面减负反馈（composer ⋯ 菜单两项放错位置；右侧边栏空态太啰嗦），裁决原文见 §1

## 1. 用户裁决（范围即裁决）

1. **「刷新文件链接」清理掉**——composer ⋯ 菜单第一项不属于消息会话框；"这个应该是自动的过程不需要主动点击"
2. **「模型 I/O 信息流」迁右侧边栏**——与每个会话绑定，"统一转移到右侧边栏的内容中，与文件、审阅等并列"
3. **右侧边栏空态减负**——"太啰嗦了，去掉副标题，简化界面内容；图2（头部区：闪电图标 + 开始工作标题 + 描述行 + 项目行）的内容可以不要"

## 2. 代码事实基线

- **⋯ 菜单**：[SimpleChat.tsx:1756-1795](../frontend/src/components/copilot/SimpleChat.tsx)（BLOCK-60 产物 `sc-toolbar-more`），当前恰好仅两项：刷新文件链接 + 模型 I/O 信息流
- **刷新机制**：[SimpleChat.tsx:1016-1022](../frontend/src/components/copilot/SimpleChat.tsx) `handleRefresh` = `__resetFileReferenceCache()`（[chat-file-references.ts](../frontend/src/lib/chat-file-references.ts) 模块级解析缓存）+ `resolveNonce++`；`resolveNonce` 在 [SimpleChat.tsx:1365](../frontend/src/components/copilot/SimpleChat.tsx) 传入 `CopilotMarkdown` 触发已落地消息文件链接重解析（T83 反馈层，无核心逻辑）
- **模型 I/O 查看器**：[LlmTranscriptViewer.tsx](../frontend/src/components/copilot/LlmTranscriptViewer.tsx)（BLOCK-37 P3 / UI-274）overlay 形态（`role="dialog"` + 遮罩），数据面 [llmTranscripts.ts](../frontend/src/components/copilot/llmTranscripts.ts) 按 `conversationId` 拉取，只读
- **右侧边栏 tab 体系**：`RightPanelMode` 八值 union（[project-workspace.tsx:84](../frontend/src/pages/project-workspace.tsx) `'home'|'results'|'files'|'terminal'|'browser'|'chat'|'analyze'|'review'`）+ [useRightPanelTabs.ts](../frontend/src/hooks/useRightPanelTabs.ts)（`openRightPanel`/`rightToolMenuOpen` 工具飞出菜单）+ [RightPanel.tsx](../frontend/src/components/workspace-panels/RightPanel.tsx) tab 内容分发；`ctx.activeConvId` 已在 `RightPanelContext`（会话绑定天然可得）
- **空态件**：[EmptyResult.tsx](../frontend/src/pages/project-workspace/EmptyResult.tsx)（UI-305 P1 从 project-workspace.tsx 平移）= 头部四件套（`emptyResultIcon`/`Title`/`Desc`/`Project`）+ 六卡片（结果/后端/浏览器/文件/侧边聊天/审阅，均带 `<small>` 副标题）
- **自动刷新挂钩点（既有信号）**：`gewuEvents.projectWorkspaceChanged`（[conversationRunStore.ts:683](../frontend/src/components/copilot/conversationRunStore.ts) agent 写档后 dispatch；[DataIntakeControl.tsx:74](../frontend/src/components/workspace-panels/DataIntakeControl.tsx) 数据导入后 dispatch；[RightFileTree.tsx:107](../frontend/src/pages/project-workspace/RightFileTree.tsx) 已是该信号的消费者）——文件链接自动重解析直接订阅同源信号，**不新建第二套文件变更真相**

## 3. 设计裁决

1. **⋯ 菜单整体移除**——两项一删一迁后菜单为空，`sc-toolbar-more` 按钮、`composerMoreOpen` state、菜单 DOM 全部移除，不预留空壳；composer 右侧收敛为 `上下文预算环 | 供应商 | 模型 | 发送`
2. **刷新自动化**——SimpleChat 订阅 `projectWorkspaceChanged`（debounce ~500ms 防抖）→ `__resetFileReferenceCache()` + `resolveNonce++`；`refreshing` 手动反馈态随入口一并删除（自动化后用户无感，无需 700ms 反馈层）；`__resetFileReferenceCache` 导出与既有测试面不动
3. **模型 I/O 成为右栏 tab**——`RightPanelMode` 新增 `'io'`；工具飞出菜单（`rightToolMenuOpen`）加「模型 I/O」入口；`RightPanel` 增 `tab === 'io'` 分支；`LlmTranscriptViewer` 抽出 dock 形态 body（标题行 + 滚动正文，去 overlay/dialog 外壳），SimpleChat 内 `ioTranscriptOpen` state 与 overlay 挂载移除
4. **会话绑定语义**——tab 内容读 `ctx.activeConvId`；会话切换内容随动；无会话（`activeConvId === null`）渲染诚实空态（"当前无会话"）；只读语义不变（BLOCK-37 契约延续，不新增任何写面）
5. **空态极简**——`EmptyResult` 删除头部四件套与六卡片 `<small>` 副标题，仅留「图标 + 名称」卡片网格；对应 CSS 类（`emptyResultIcon`/`emptyResultTitle`/`emptyResultDesc`/`emptyResultProject` 及 launchText small 样式）清理
6. **0 新 npm 依赖**——纯 TSX + CSS

## 4. 改动清单

| 文件 | 改动 |
| --- | --- |
| `frontend/src/components/copilot/SimpleChat.tsx` | 删 ⋯ 菜单块 / `composerMoreOpen` / `handleRefresh` / `refreshing` / `ioTranscriptOpen` / LlmTranscriptViewer 挂载；增 `projectWorkspaceChanged` 订阅自动 bump resolveNonce（含组件卸载清理） |
| `frontend/src/components/copilot/LlmTranscriptViewer.tsx` | 抽 dock 形态 body 组件；dialog overlay 外壳随 SimpleChat 迁移一并退役 |
| `frontend/src/pages/project-workspace.tsx` | `RightPanelMode` 增 `'io'`；工具飞出菜单加「模型 I/O」入口 |
| `frontend/src/hooks/useRightPanelTabs.ts` | tab 集合同步（如 union 消费面需要） |
| `frontend/src/components/workspace-panels/RightPanel.tsx` | `tab === 'io'` 分支渲染（activeConvId 传入 + 空态） |
| `frontend/src/pages/project-workspace/EmptyResult.tsx` | 删头部四件套 + 卡片副标题 |
| `frontend/src/pages/project-workspace.module.css` | 清理 `emptyResult*` 头部类与 small 样式；llm-tr dock 形态样式（如放全局 css 则对应文件） |
| 测试 | SimpleChat 相关 vitest 更新（⋯ 菜单断言移除 / 自动 bump 用例新增）；tab 契约；EmptyResult 轻量渲染用例 |

## 5. 验收门

- `tsc` 0 错误
- 受影响 vitest（SimpleChat / events / useRightPanelTabs / EmptyResult）
- `npm run docs:check` + `npm run ui:audit:check`
- dev Electron 实机 CDP 断言（证据落 `acceptance/block-68/`）：
  1. composer 右侧仅剩 预算环 | 供应商 | 模型 | 发送，⋯ 按钮不存在
  2. agent 写档（或数据导入）后已落地消息的文件链接自动重解析，无需手动刷新
  3. 右栏「模型 I/O」tab 与文件/审阅并列；点开显示当前会话请求/响应原文（只读）；切换会话内容随动；无会话时空态诚实
  4. 右栏 home 空态无头部区，六卡片仅图标 + 名称
- UI-317 台账与实现同一提交登记

## 6. 范围外

- 不动 `composerWidth` 弹性宽度逻辑（BLOCK-60 契约：工具栏只读宽度）
- 不动 llm-transcripts 后端数据面（BLOCK-37 契约）
- 不动 RightPanel 其余 tab 与窗口系统（BLOCK-59/65 契约）
- ⋯ 菜单不预留空按钮；未来新低频项届时再议入口形态

## 7. 排队与串行

- 当前无 active 工作包；排队候选：BLOCK-67-SSH-REMOTE-PROJECT（大包）+ 本包（小包，预计一次会话收口）
- **工作区现状（2026-09-09 登记时核实）**：UI-316 已由并行会话收口提交（`863dd8d2`，台账 verified，实机 CDP 验收）；另有并行会话进行中的 UI-315 终端块跟进 WIP（`ToolActivityList.tsx` 未提交）——本包启动前按串行纪律待其落定。本包若需改 `simple-chat.css`（llm-tr dock 形态样式），与该 WIP 文件面相邻，注意先后
- 启动顺序由用户裁决
