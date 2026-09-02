# BLOCK-42 — pending-scroll 消费侧挂载（UI-194 收口）计划

> status: active · truthDomain: `block-42-pending-scroll-consumer-mount` · registered: 2026-09-02

## 1. 背景

UI-194（BLOCK-22 P3 桥接层）自 2026-08-28 起 `in_progress`：生产侧已接（聊天 workspace-file link → `projectOpenWorkspaceFile` 事件 → `project-workspace.tsx` `setPendingRequest`），但消费侧未挂载——`WorkspaceFilePreviewBridge` / `ChatCardLinkBridge` 仅 barrel 导出，pendingRequest 无消费者，预览不滚动、无 pulse。

2026-09-02 P0 摸底发现缺口比台账描述更深：`WorkspaceFilePreviewBridge` 是 **CodeMirrorEditor 的包装**，而工作区文件预览（`WorkspaceFilePreview`，project-workspace.tsx L2452 起）的文本/代码/JSON/markdown-edit 路径全部用纯 `textarea`——CodeMirrorEditor 至今无任何页面级挂载。因此「消费侧挂载」实质是**把预览编辑器切换到 CodeMirrorEditor**。

## 2. 用户裁决（2026-09-02）

- BLOCK-41 收口提交 `38c6edf1` 推送后，用户从剩余候选（UI-194 消费侧挂载 / ui:audit --report schema 债务 / UI-193 widget 业务路径）中裁决启动 **UI-194 消费侧挂载**（BLOCK-42）。
- 实现方案二选一，用户裁决 **方案 A：预览切 CodeMirror**（textarea → `WorkspaceFilePreviewBridge`，语法高亮 + 行号，与审阅面板 inline diff 同一套编辑器）；否决 textarea 原生滚动保守方案。

## 3. 目标

聊天卡片（SimpleChat workspace-file link）点击 → 文件预览打开 → CodeMirror 滚动到目标行 + pulse 高亮，全链路实机可用；UI-194 升 `verified`。

## 4. 非范围

- `ChatCardLinkBridge` 组件不挂载：聊天卡片生产链路已由 `projectOpenWorkspaceFile` 事件路径承担，该组件保持 barrel 导出供未来 AgentChangesCard 内嵌跳转复用，本包不接。
- inline-diff 联动（`diffRevision` 从聊天卡片带入预览）不外推：预览挂载只做 normal 模式，diff 联动留后续候选。
- CSV 表格 / 图片 / PDF / HTML / office 预览路径不动；markdown preview（ReactMarkdown）只读视图不动，仅 `mdView === 'edit'` 换 CodeMirror。
- UI-193（widget 业务路径）不在本包。
- 0 新依赖。G0 开发期常态 · 不外推 packaged / Provider / GA。

## 5. 阶段

- **P0 摸底 + 本计划**（已完成）：链路盘点、CodeMirrorEditor 接口确认（无 `onChange`，需 additive 扩展）。
- **P1 编辑器扩展**：`CodeMirrorEditorProps` 新增 `onChange?: (value: string) => void`（updateListener 实现，normal 模式 only，inline-diff 模式不派发），additive 不破坏既有调用方。
- **P2 预览切换**：project-workspace.tsx `WorkspaceFilePreview`：fallbackKind 为 text / json / markdown-edit 的 textarea 替换为 `WorkspaceFilePreviewBridge`（filePath=file.path、value=text、language=codeLanguage、readOnly 按现 textarea 行为、onChange→setText 保持 BLOCK-20 dirty/save 链路）；PendingScrollProvider 由 Bridge 自动检测（外层 project-workspace 已用 `usePendingScroll()`，需确认 Provider 树覆盖）。
- **P3 门禁**：定向 vitest（editor integration 既有 53/53 不破坏 + 新增 onChange 用例）+ tsc 0 + docs:check + ui:audit:check。
- **P4 实机收口**：dev Electron 走查——聊天 link 点击（带行号）→ 预览打开 → 滚动定位 + pulse；文本编辑 + 保存回归；大文件 120KB 截断降级行为确认；UI-194 台账升 verified，证据更新 `acceptance/ui-194/`。

## 6. 验收门

- 聊天卡片点击后预览打开并滚动到指定行，pulse 高亮可见（实机）
- dirty/保存链路（isDirty → writeTextFile）回归通过（实机）
- editor integration 定向 vitest 全绿 + tsc 0 + docs:check + ui:audit:check
- BLOCK-41 DOC-REGISTRY 状态补正为 completed（P0 发现收口时漏改 registry，随本包首提交修正）

## 7. 进度记录

- 2026-09-02 P0 完成：两轮 explore 摸底（桥接层组件实现 / 预览承载现状）；确认生产侧链路已通、消费侧根因为预览用 textarea 而 CodeMirrorEditor 无页面挂载、CodeMirrorEditorProps 无 onChange；用户裁决方案 A（预览切 CodeMirror）；发现 BLOCK-41 DOC-REGISTRY 状态漏改，登记入验收门。本计划落盘并注册 DOC-REGISTRY。
- 2026-09-02 P1-P3 完成：onChange 落地（updateListener + lastValueRef 防反馈回路，inline-diff 不派发）；三条 textarea 路径切 `WorkspaceFilePreviewBridge`；App.tsx 挂全局 `PendingScrollProvider`。P4 准备期实机预检发现同文件重开滚动丢失，Bridge 消费改 rAF 延迟一帧（unmount 取消 rAF、保留 pendingRequest 给重建实例）。P3 门禁：定向 vitest 59/59（新增 onChange 3 用例；P4.2 one-shot 用例按 rAF 语义修正）+ tsc 0 + docs:check + ui:audit:check 全绿。
- 2026-09-02 **P4 实机收口完成，工作包 completed**：dev Electron（CDP :9222，tinkspace/ThinkSpace）6 场景全 PASS——事件跳转 250 行落点可见、pulse 高亮（截图留证）、CM insertText 编辑→dirty→保存→磁盘核对、同文件重开跳转（rAF 修复生效）、163KB 大文件 120KB 截断注记、text/json/markdown-edit 三路径挂载。走查就地修复两个缺陷：①relay 未传 `pulseMs` 跳转无高亮（补 3000ms）；②BLOCK-20 遗留「打开即误报有未保存修改」（`textSaved` 基线恒 `''`，fetch 后同步基线）。UI-194 升 verified，证据 `acceptance/ui-194/`（README + b42-codemirror-jump-pulse.png）。scratch 探针文件验收后已清理。G0 开发期常态 · 不外推 packaged/Provider/GA。
