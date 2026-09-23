---
name: gewu-css-theme
description: Use when creating or modifying pages/components/styles, working on dark mode or theme tokens, fixing "color inconsistency" feedback, or reviewing CSS-touching diffs. 新建页面/组件、写样式、暗色模式与主题色工作、排查颜色不一致类反馈、评审涉及 CSS 的 diff 时使用。
---

# Gewu CSS 主题一致性（海军蓝家族）

背景：UI-392/393 五层教训（灰 hover、slate 残留、infima 特异性死字、遗留 --color-* 零定义家族 103 处、卡片层级倒挂）+ UI-393 页头形态统一。本 skill 是这些事故的制度化；机械化门禁在 `frontend/src/styles/theme-token-contract.test.ts`，写样式后必跑。

## 1. 暗色 Token 阶梯（唯一合法的深色底来源，全部来自 --gewu-*）

| 层 | token | 值 | 用途 |
| --- | --- | --- | --- |
| 画布 | `--gewu-bg-canvas` | #0b1220 | 内容页画布；**卡内 inset**（代码块/终端） |
| 面板 | `--gewu-bg-surface` | #111a2e | 页面级容器/左栏/标题栏/输入框（`--gewu-input-bg`） |
| 卡片 | `--gewu-bg-subtle` | #182339 | 页面上的卡片/建议卡/面板内嵌面板 |
| 浮层 | `--gewu-bg-elevated` | #1d2945 | 弹层/强调浮面 |
| 边框 | `--gewu-border` / `--gewu-border-strong` | #243149 / #324466 | 分隔线 |
| 文字 | `--gewu-text` / `-secondary` / `-tertiary` / `-muted` | #e6edf3 → #6b7689 | 文字四级 |

- 悬停 = `--gewu-hover`（白蓝低透明提亮）；**选中/激活 = `--gewu-accent-bg` + `--gewu-accent`**（teal 或用户 data-accent 主题色）。两者语义不混用。
- 强调色一律走 `--gewu-accent*`（随 data-accent 主题切换），禁止写死具体蓝/teal 值。

## 2. 铁律（门禁会咬）

1. **禁用未定义 token 与裸色值**：主题相关颜色必须 `var(--gewu-*)`；禁止 `var(--color-*)` 遗留家族（零定义，暗色下漏白）、禁止裸 hex/rgba 写面板/文字/边框色。新 token 先在 custom.css 亮暗双套定义（`--gewu-` 前缀）。
2. **禁 slate 灰系字面量**：`rgba(148,163,184,α)`、`#0f172a`、`#1b1b1d`、`#334155` 等（infima/docs 时代遗产，与 navy 族脱节）。
3. **infima 特异性战争**：infima 暗色默认用 `html[data-theme='dark']`（特异性 0,1,1）；本仓覆盖块若写 `[data-theme='dark']`（0,1,0）**全部是死字**。暗色覆盖块必须写 `html[data-theme='dark'], [data-theme='dark']` 双选择器（global/custom 的 @import 在 infima 之后，同特异性必胜；双写兼顾子树作用域）。
4. **层级方向**：卡片/面板不得比其所在页面更深。页面=surface 时卡片=subtle；canvas 只作内容页画布或卡内 inset。卡片画 canvas = 「页面上的洞」（UI-392 根因四）。
5. **全局元素级规则的溅射**（UI-437 v5.2 事故）：`global.css` 的元素选择器（`code`/`pre`/`a`/`table` 等）对**所有**组件生效——组件内使用这类语义元素时必须显式中性化（background/border/padding/border-radius）或改用中性元素（`span`/`div`，保留字族用 `font-family: var(--gewu-font-mono)`）；反向亦然——在 global 新增/修改元素级规则前，必须评估对既有组件的溅射面。事故实录：`code { background: var(--gewu-bg-subtle) }`（UI-240 行内代码样式）漏进会话时间线行，类选择器覆盖后仍因级联环境反复「复活」，根治=元素换 `span`。
5. **页头标准件**：独立页（/skills /knowledge /settings 形态）头部 = `global-page.module.css` 的 backBtn + 图标 + 标题/副标题；**页面级不放关闭钮**（关闭窗口归标题栏系统控件）。返回按钮样式单一真源就是该文件 `.backBtn`，勿复制。

## 3. 验证配方（本机实证）

- **读 token 实况**：CDP `getComputedStyle(documentElement).getPropertyValue('--gewu-x')` 对比意图值——定义了 ≠ 生效（特异性战争会让它死掉）。
- **找画底元素**：`elementFromPoint(x,y)` 向上走、取首个非透明 backgroundColor 的元素+类名 → 定位具体规则。
- **像素取证**：PowerShell System.Drawing 采样/分布统计（System.Drawing 采样法 + 分布直方图见 gates 记忆）；对比「页面底 vs 卡片底 vs hover 底」。
- **生效通道**：dev 栈 CSS 走 Vite HMR 即时生效；打包版不跟随（G0 不外推）。合成 CDP mouseMoved 不触发 `:hover`——hover 色验证用内联注入色值+截图像素采样。

## 4. 门禁与评审

- `cd frontend && npx vitest run src/styles/theme-token-contract.test.ts`：token 定义覆盖 + slate/遗留 token 零残留 + 暗色块特异性形态，写样式后必跑。
- 评审涉及 CSS 的 diff：按 `$gewu-code-review` 流程，并对照本 skill 第 1/2 节逐条过。
