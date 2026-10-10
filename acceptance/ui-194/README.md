# UI-194 验收证据 — pending-scroll 桥接层

## BLOCK-42 P4 实机收口（2026-09-02，dev Electron CDP :9222，项目 tinkspace / ThinkSpace 工作区）

**前置**：BLOCK-24 P2 曾取证「生产侧已接、消费侧未挂载」（`electron-pending-scroll-dev.{json,png}`，passed:false）。BLOCK-42 完成消费侧挂载后重验。

**场景与结果**（6/6 PASS）：

| # | 场景 | 结果 |
|---|------|------|
| 1 | `petri:project-open-workspace-file` 事件（聊天卡片同路径）跳 300 行文件第 250 行 → CodeMirror 挂载、`.cm-line` 目标行在视口内 | PASS |
| 2 | pulse 高亮：跳转后 `.cm-pulse-highlight` Decoration 出现（截图 `b42-codemirror-jump-pulse.png`） | PASS（relay 补 `pulseMs:3000` 后） |
| 3 | 编辑回归：CM contenteditable insertText → onChange → 「有未保存修改」+ 保存可用 → 保存 → 磁盘文件核对含插入标记、badge 清除 | PASS |
| 4 | 同文件重开跳转（rAF 修复场景）：已开文件再次 jump 不同行 → refetch 重建后滚动落点正确（可见 1-91、目标行 30 可见） | PASS |
| 5 | 大文件降级：163KB 文件 → 120KB 截断 +「文件较大，仅预览前 120KB」注记，编辑器滚动正常 | PASS |
| 6 | 路径覆盖：text / json / markdown-edit 三条路径 CodeMirror 均挂载渲染 | PASS |

**走查中就地修复的缺陷**（均在本工作包收口提交内）：

1. **relay 缺 pulse**：`project-workspace.tsx` 事件 relay 派发 pendingRequest 未传 `pulseMs`，跳转无高亮（BLOCK-24 取证中的遗留项）→ 补 `pulseMs: 3000`（与 `highlight:true` 简写一致）。
2. **打开即误报 dirty（BLOCK-20 遗留）**：`textSaved` 基线恒 `''`，文本/JSON/markdown 文件一打开就显示「有未保存修改」→ fetch 完成后同步 `setTextSaved(formatted)`。

**G0 开发期常态 · 不外推 packaged / Provider / GA。**
