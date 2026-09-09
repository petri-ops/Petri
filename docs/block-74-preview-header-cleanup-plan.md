# BLOCK-74 — 文件预览头部减负：取消按钮行，保存走快捷键 + 自动保存

> 状态：`active`（2026-09-09 用户裁决，同日立项即开工）
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
