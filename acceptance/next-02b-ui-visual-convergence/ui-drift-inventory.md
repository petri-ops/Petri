# NEXT-02B UI 漂移清单（2026-10-30）

对 UI-A~F 与当前台账/代码逐项对账。结论只分三档：**已实现（有证据）**、**漂移（已修/待修）**、**证据债（不冒充完成）**。

| 维度 | 当前状态 | 本轮处置 |
| --- | --- | --- |
| UI-A token/控件/状态词典 | theme-token-contract 17/17；新增 3D 面板全部使用 `--petri-*`，无新按钮类定义、无裸 font-size/颜色 fallback | 已实现；本轮矩阵验证明暗 token 实际切换（composer 背景 `#fff → #1d2945`） |
| UI-B 壳层/信息架构 | 应用壳/项目/会话/工作面分层沿用既有；右栏宽度模型与侧聊独立窗已由 BLOCK-321c/321 验证 | 已实现；矩阵在 1440/1024/720/480/1280@2x 下无文档横向溢出，3D 面板 340px 内无内部溢出 |
| UI-C 会话/工具/工作流时间线 | NEXT-01/02A 已验证工作流/工具行/轨迹/证据面 | 已实现（证据沿用）；本轮未改 |
| UI-D composer/提示词/上下文 | NEXT-03 提示词增强已验证；窄视口 composer 旧缺陷（651px）复测未复现：592px 视口下 551.88px、无横向溢出 | 旧缺陷关闭（按实测）；焦点落在 `textarea.sc-input` |
| UI-E 成果/3D/预览 | NEXT-04A/B/05 已验证 SceneSpec/视觉 QA/编辑/测量/对比/导入导出 | 已实现；本轮修复 3D 面板响应式改用容器查询 |
| UI-F 性能/可访问性/韧性 | reduced-motion 全局降级、WebGL 丢失边界、错误边界沿用；矩阵模拟 reduced motion | 已实现；动画时长实测 `1e-06s`；暗色无溢出 |
| 旧 SideChatDock 假设 | 仅历史注释/对标引用，无旧 dock 复活 | 不复活 |

## 本轮实际漂移与修复

1. **3D 面板响应式错用视口媒体查询**：`Model3DSurface` 是 340px 右栏内的 workSurface，`@media (max-width: 820px)` 永远不触发，双栏布局在窄面板内被挤压。改为 `container-type: inline-size` + `@container`；`Model3DReviewPanel`/`Model3DEditPanel` 同步加窄容器行布局。
2. **GLB/STL/OBJ 文件预览被 CSP 拦截**（NEXT-05 实机抓真）：`connect-src` 不含 `blob:`，Three 文件加载器 `fetch(blob:)` 报 `Failed to fetch`。`buildCspHeader` 放行 `blob:` 并加回归测试。
3. **NEXT-05 实机矩阵截图不可得**：`Page.captureScreenshot` 在离屏测试实例返回 `cdp_command_failed:-32000`，按纪律标 `screenshot_unavailable`，布局几何/计算样式为证据。

## 证据债（不冒充完成）

- `docs/ui-productization-audit.md` 仍有 71 条 `in_progress`（截至本轮前）；它们需要各自实机证据，不能用本轮的矩阵/新 UI 覆盖。
- 旧批注/独立窗历史证据存在过期（见项目记忆）；本轮只复核了 NEXT-02B 矩阵涉及的面，不宣称全量 UI 已验证。
- 原生对话框/OS 权限类仍属无人化阶梯第 3/4 级，未在本轮重验。

## 矩阵证据

- `acceptance/next-02b-ui-visual-convergence/next02b-ui-matrix-live-live.json`（19/19）
- `acceptance/next-02b-ui-visual-convergence/layout-matrix.json`（各视口 composer/surface 几何、明暗 token、reduced motion）
