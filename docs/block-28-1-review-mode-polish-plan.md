# BLOCK-28.1-REVIEW-MODE-POLISH — 主区审阅模式主题适配 + Codex 级打磨 Plan

- **Plan ID**: `BLOCK-28.1-REVIEW-MODE-POLISH`（BLOCK-28 交付缺陷修复 + UX 打磨，用户裁决 2026-08-29）
- **状态**: `active`
- **truthDomain**: `block-28-review-mode-polish`
- **阶段**: P1 主题适配（UI-208）→ P2 布局打磨（UI-209）→ P3 实机取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 缺陷诊断（2026-08-29 用户反馈 + CDP 截图实锤）

浅色主题（`data-theme="light"`）下主区审阅页呈"半暗半亮"：暗色 summary 条/侧栏/状态栏
浮在主题浅色画布（`--biof3-surface-dim: #f8fafc`）上，CM 高亮文字用暗色调配色。

根因：BLOCK-28 沿用旧抽屉 CSS（WorkingTreeReview.css + 新增 ReviewMode.css），其中
`--biof3-fg` / `--biof3-fg-muted` / `--biof3-bg-elev` / `--biof3-bg-list` /
`--biof3-bg-button` / `--biof3-mono` / `--biof3-status-danger` 等变量名**在本仓
token 体系中不存在**，回退常量全是暗色硬编码。旧抽屉是全暗浮层未暴露；进主区后与
Infima + `--biof3-*` 语义 token 体系混用即串色。

本仓真实 token（frontend/src/styles/custom.css，明暗双套齐备）：
- 表面：`--biof3-bg-canvas` / `--biof3-bg-surface` / `--biof3-bg-subtle` / `--biof3-bg-elevated`
- 文字：`--biof3-text` / `--biof3-text-secondary` / `--biof3-text-tertiary` / `--biof3-text-muted`
- 边框：`--biof3-border` / `--biof3-border-strong` / `--biof3-border-subtle`
- 强调：`--biof3-accent` / `--biof3-accent-soft` / `--biof3-hover`
- 状态：`--biof3-status-success-fg/-bg` / `--biof3-status-error-fg/-bg` 等
- 字体：`--biof3-font-mono`

## 2. 范围

**P1（UI-208）主题适配**：重写 `WorkingTreeReview.css`（仅保留在用 wt-* 类）与
`ReviewMode.css` 为全 token 驱动（明暗双主题自适配）；hunkControls / 标记条 / toast /
commitbox 全部换真实 token。BLOCK-22 CM 层已用存在 token，0 改动。

**P2（UI-209）Codex 级布局打磨**：summary 条重排（标题+统计+进度左置、操作右置精简）、
文件树树形缩进 + folder/file 图标（Icon.tsx additive 4 图标）+ 缩进参考线、diff sticky 头
加状态徽标与统计、commit box 强调色主按钮、空态居中图形化、hover/选中态统一。

**非范围**：0 新增 IPC / 0 新 npm 依赖 / 不动 BLOCK-22 CM 扩展行为 / AI 审阅 0 重新引入 /
packaged / Provider / GA / P7 G1+。

## 3. 门禁与完成语义

- 每阶段：tsc 0 / 定向 vitest（reviewModeHelpers + ReviewMode + CodeMirrorDiffView）/
  ui:audit:check / docs:check；提交信息含 UI-### 且同提交更新台账。
- P3：dev Electron CDP 取证浅色 + 暗色双主题截图与 DOM 断言落 `acceptance/ui-208/`，
  UI-208/209 转 verified；台账（AUDIT-LOG / DOC-REGISTRY completed / roadmap / handoff /
  README）+ docs:reconcile + docs:check + ui:audit:check + git diff --check 全绿后提交推送。
- G0 开发期常态 · 不外推 packaged/Provider/GA.
