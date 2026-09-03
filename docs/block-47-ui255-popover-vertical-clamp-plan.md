# BLOCK-47 — UI-255 增量修复：悬停浮窗纵向越界（内容异步膨胀后 top 重算）

## 1. 背景

UI-255（悬停预览浮窗位置/尺寸自适应）已在 BLOCK-46 实机复核升 verified，但复测发现纵向边界缺陷：`HoverPreviewPopover` 的 `useLayoutEffect` 仅在 `anchor` 变化时实测渲染高度并钳制 `top`；浮窗内容（`CodeMirrorDiffView` 只读 diff）为异步渲染，内容膨胀后 `top` 不重算——当内容达到 CSS `max-height: 60vh` 上限时，浮窗底边可越出应用窗口约 145px（实测 winH 1277 / bottom 1422）。用户裁决（2026-09-03）启动修复，roadmap 增量候选已登记。

## 2. 范围

- **只改** [HoverPreviewPopover.tsx](../frontend/src/components/desktop/WorkingTreeReview/HoverPreviewPopover.tsx) 单组件：纵向钳制重算时机从「仅 anchor 变化」扩展为「anchor 变化 + 内容高度变化」。
- 修法：在组件根元素上挂 `ResizeObserver`，观察内容盒高度变化后按同一钳制公式重算 `top`（`Math.max(MARGIN, Math.min(anchor.top - MARGIN, window.innerHeight - h - MARGIN))`）。保留 `useLayoutEffect` 首帧测量（避免闪跳），RO 覆盖后续异步膨胀。
- 宽度/左右翻转逻辑不动；两个消费方（ReviewMode UI-250 / AgentChangesCard UI-252）零改动（定位逻辑已收敛单组件）。

## 3. 非范围

- 不改 CSS（`max-height: 60vh` 上限保留）；不改 hover 触发/关闭时序；不改横向翻转阈值。
- 不改 CodeMirrorDiffView 渲染链路。
- 非 darwin / packaged 边界；G1+ 不外推。

## 4. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + README + roadmap + AUDIT-LOG。
- **P1 实现**：HoverPreviewPopover 增加 ResizeObserver 纵向重钳（0 新依赖，单组件 ~15 行）。
- **P2 定向门禁**：新增/更新组件 vitest（happy-dom 下 RO 语义验证或等价单测）+ 消费方既有测试回归 + tsc + docs:check + ui:audit:check。
- **P3 dev Electron 实机**：复现越界场景（中等体量 diff，如 +42/−103），验证内容膨胀后底边 ≤ winH - MARGIN；横向翻转不回归。
- **P4 收口**：UI-255 台账补 BLOCK-47 修复记录、registry completed、roadmap active 清空、提交。

## 5. 验收门

- P2 定向测试全绿 + 治理门禁 PASS。
- P3 实机证据落盘 `acceptance/block-47/`（截图或 DOM 断言 JSON）。
- 收口笔录用语：「G0 开发期常态 · 不外推 packaged/Provider/GA」一句。

## 6. 进度记录

- 2026-09-03 P0 立项：用户裁决启动 roadmap 增量候选「UI-255 浮窗纵向越界修复」；根因与修法见 §1/§2。
- 2026-09-03 P1 完成：ResizeObserver 纵向重钳落地（单组件 ~8 行净增，0 新依赖）；新增 HoverPreviewPopover.test.tsx 3 用例。
- 2026-09-03 P2 完成：组件+消费方 vitest 50/50、tsc 0、docs:check 187、ui:audit:check PASS。
- 2026-09-03 P3 完成：dev Electron 实机（证据 `acceptance/block-47/`）——底行场景 src/main.js (+280/−72) 行落位 y≈965、内容达 60vh 上限 766px 后 RO 重钳 top 942.6→502.6、底边 1268.99 贴合 winH-8=1269（修复前会达 1724 越界 455px）；顶行场景 + 横向翻转不回归。验收备注：窗口被遮挡时 Electron 渲染管线节流（rAF/RO 回调冻结），实机断言须在前置窗口后进行。
- 2026-09-03 P4 收口：UI-255 台账修复记录转 verified、registry completed、roadmap active 清空、提交。G0 开发期常态 · 不外推 packaged/Provider/GA。
