# BLOCK-28.9-COMMIT-BAR-ON-DEMAND — 审阅底部提交条按需出现（隐藏常驻输入框） Plan

- **Plan ID**: `BLOCK-28.9-COMMIT-BAR-ON-DEMAND`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 19/19 / ui:audit:check / docs:check；CDP 实机 5/5，证据 `acceptance/ui-218/`）
- **truthDomain**: `block-28-commit-bar-on-demand`
- **阶段**: 单 PHASE（UI-218）实施 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「优化审阅界面内容的呈现效果，为什么底部还有输入框？？？」

## 2. 方案（单 PHASE，UI-218）

ReviewMode 底部提交框原先**常驻**渲染 2 行 textarea（VS Code SCM 风格），
无决策时也占位、观感像聊天输入框。改为**按需出现**：

- 无审阅决策（`!hasDecisions`）→ 底部 footer 整体不渲染。
- 有决策 → 单行紧凑提交条：决策摘要（接受 n / 拒绝 n / 待定 n，绿/红着色）
  + 单行 input（placeholder 含 ⌘+Enter 提示与决策计数）+ 主按钮「提交 (n)」。
  ⌘+Enter 提交、错误提示、成功 toast（wt-commit-success）保留。
- 提交按钮禁用条件简化为「信息为空」（决策存在由渲染条件保证）。

**非范围**：0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入 / G1+ 不外推。

## 3. 门禁

tsc 0 / 定向 vitest 19/19（新增「无决策隐藏 / accept 后出现且为单行 INPUT」
用例）/ ui:audit:check / docs:check；CDP 实机 5/5（无决策无 commitbox、
接受后出现含「接受 1」摘要与单行 INPUT、全部还原后消失），
截图落 `acceptance/ui-218/`。G0 开发期常态 · 不外推 packaged/Provider/GA.
