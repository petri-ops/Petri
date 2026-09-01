# BLOCK-36 — 会话区工具执行记录独立小窗口（ToolActivityDock）

> status: active · truthDomain: `block-36-tool-activity-dock` · registered: 2026-09-02
> owner: main agent · branch: main（单工作包串行，前置 BLOCK-34/35 已 completed）

## 1. 背景（用户需求）

用户：「帮我优化会话区，把工具执行记录独立成小窗口」。

当前会话区内联渲染 [ToolActivityList]（摘要条 + 可展开逐条详情 + 流式输出尾部），
BLOCK-34 的 [BackgroundProcessDock] 浮窗只承接 `workspace_exec_background` 后台进程。
工具执行详情（尤其流式输出）内联展开会打断会话区阅读流。

## 2. 设计裁决（用户 2026-09-02 三选一确认）

1. **内联留一行摘要条**：消息流里保留极简摘要（如「已完成 3 项 · 3.9 s」），
   点击打开小窗口并定位到该消息的工具组；不再内联展开详情。
2. **会话级统一浮窗**：把 BackgroundProcessDock 扩展为统一「执行记录」浮窗
   （ToolActivityDock）——tab 按消息分组列出本会话全部工具活动组（含历史恢复，
   数据源即消息 meta.toolActivities 持久化快照），后台进程作为一个特殊 tab。
3. **执行时弹出 + 完成后保留**：检测到 running 工具活动自动弹出；完成后窗口保留
   可随时回看；手动关闭（×）后新运行再弹出；可折叠为 chip（运行数 + 状态点）。

## 3. 范围

**改动面**：
- 新增 `frontend/src/components/copilot/ToolActivityDock.tsx` + `.module.css`（吸收
  BackgroundProcessDock 全部行为：事件弹出、1s 轮询进程表、tab、chip、自动滚动）。
- `SimpleChat.tsx`：displayMessages → 工具活动组 memo；内联 ToolActivityList 收敛为
  摘要条 + onOpen 回调；挂载点换 ToolActivityDock。
- 删除 `BackgroundProcessDock.tsx` / `.module.css` / `.test.tsx`（行为被吸收，按
  项目约定组件连带状态链一起移除）。
- `backgroundProcesses.ts`、`toolActivity.ts`、conversationRunStore 链路不变。

**非范围**：工具活动持久化结构（BLOCK-34 已收口）、后台进程后端端点、
右栏审阅/文件面板、G1+ 阶段事项（packaged/Provider/GA）。

## 4. 验收判据

- P2（定向测试）：ToolActivityDock vitest 覆盖——历史组 tab 渲染 / running 自动弹出 /
  摘要条点击定位（focusRequest）/ 折叠 chip / 关闭后新运行 re-pop / 后台进程 tab 兼容
  （迁移 BLOCK-34 既有断言）；SimpleChat 摘要条渲染；tsc 0 错误。
- P3（实机）：dev Electron 发起带工具执行的任务 → 浮窗自动弹出、完成后保留、
  可折叠/关闭/re-pop、历史会话恢复后组仍可查看；截图存 acceptance/ui-267/。
- 门禁：`npm run docs:check`、`npm run ui:audit:check`（每提交必跑）。

## 5. 完成语义

P1–P2 完成并门禁全绿 → 代码提交（含 UI 台账 UI-267 in_progress）；P3 实机证据
齐 → UI-267 verified + 本 plan status completed + DOC-REGISTRY/AUDIT-LOG/README 同步。

G0 开发期常态 · 不外推 packaged / Provider / GA。
