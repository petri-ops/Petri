# BLOCK-74 — 文件预览头部减负：取消按钮行，保存走快捷键 + 自动保存

> 状态：`completed`（2026-09-10 收口；2026-09-09 用户裁决立项即开工）
> 立项日期：2026-09-09
> truthDomain: `block-74-preview-header-cleanup`
> UI 台账：UI-323（实现同提交登记）
> 来源：用户观察预览/编辑头部「引用到对话 / 保存 / 恢复」按钮行没有实际意义——
> 「修改后保存使用快捷键 或者自动保存就好啦」

## 1. 用户裁决

- 取消文件预览/编辑头部的按钮行（引用到对话 / 保存 / 恢复）。
- 保存 = 快捷键（Ctrl/Cmd+S）或自动保存（两者都做）。

## 2. 设计裁决

- **D1 按钮行整体移除**（BLOCK-68 不预留空壳先例）：文本/JSON/Markdown 工具条的
  引用到对话、保存、恢复、「有未保存修改」提示全删；图片预览的「引用到对话」行删除；
  仅 Markdown 保留 编辑/预览 tabs。编辑器（CodeMirror 桥）与文件面包屑不动。
- **D2 自动保存**：文本族（markdown/text/json）编辑停顿 1.2s 后自动保存；
  保存链不变（local 走既有 workspace IPC，ssh 走 BLOCK-67 P1c REST PUT + D3 mtime 冲突诚实面）。
- **D3 快捷键**：Ctrl/Cmd+S 立即保存（容器级 keydown，preventDefault 浏览器默认）。
- **D4 错误诚实面保留**：保存失败（含 ssh 409 冲突/断线 502）仍以红字 alert 行如实显示
  （data-testid="ssh-save-error" 保留）；成功静默（自动保存心智：无声 = 已保存）。
- **D5 BLOCK-52 头部触发点随裁决退役**：选中即引用/图片引用的头部队列按钮删除
  （用户裁决无实际意义）；对话内既有 @文件 引用链不受影响。

## 3. 验收门

- tsc 0；docs:check + ui:audit:check
- 实机 CDP：头部按钮行不存在；编辑停顿 ~2s 后文件内容落盘（自动保存）；Ctrl+S 立即落盘；
  错误面保留（ssh-save-error 元素在保存失败场景渲染——以组件级可测性为准）
- UI-323 台账与实现同提交登记；G0 开发期常态 · 不外推 packaged/Provider/GA

## 4. 范围外

- 审阅面板/对话引用链/底部终端不动；BLOCK-67 收口语义（409/502 行为）不改
- G0 开发期常态 · 不外推 packaged/Provider/GA

## 5. 加映（2026-09-10 用户三选一裁决）：md 编辑/预览切换悬浮化

- 用户观察：按钮行移除后，md 文件因「编辑/预览」tabs 仍常驻一条工具条行（D1 原文「仅 Markdown 保留 编辑/预览 tabs」）——头部又回来了。
- 三选一（悬浮铅笔图标 / 悬浮 编辑|预览 双 chip / 并入面包屑行）用户裁决**悬浮铅笔图标**：预览态右上角铅笔（aria-label=编辑）进 CodeMirror，编辑态变眼睛（aria-label=预览）回渲染；工具条行整体退役，`workspaceMarkdownDiffToolbar/Tabs/Tab/TabActive/Hint` 类名随之删除（`DiffActions` 保留，ResultArtifactShell 仍在用）。
- 保存失败红字条悬浮化：顶部 overlay（仅出错时出现，不再占常驻行），`data-testid="ssh-save-error"` 保留。
- 实机抓真修：验收脚本原用 CDP `Input.insertText`，焦点不在编辑器时不达（且误落聊天输入框）——改 `block67-p1-live` 同款 `cm.focus()` + `document.execCommand('insertText')` 配方后 5/5 全绿。

## 6. 收口（2026-09-10）

- 组件定向 5/5（按钮移除 + 悬浮切换双向 + 自动保存 + Ctrl+S + null↔file 双向 rerender 回归）+ tsc 0
- 实机 CDP：`scripts/ui323-preview-header-live.cjs` 5/5 断言 allPass（`acceptance/ui-323/`）：C1a 悬浮钮出现且工具条行不存在 / C1 编辑态零按钮行零工具条 / C2 自动保存落盘 / C3 Ctrl+S 立即落盘 / C4 眼睛回预览
- 门禁：hygiene ✅ / docs:check ✅ / ui:audit:check ✅；test:changed 4 处 node 存量失败（g0-api-route / tool-job-conversation / g0-rs-p6×2）**stash 复验同败**——与 90d393c8 基线同源（20293c3d 已登记），非本包文件面，如实归属不表述为本包通过
- UI-323 台账 verified；G0 开发期常态 · 不外推 packaged/Provider/GA
