---
name: petri-css-theme
description: Use when creating or modifying pages/components/styles, working on dark mode or theme tokens, fixing "color inconsistency" feedback, or reviewing CSS-touching diffs. 新建页面/组件、写样式、暗色模式与主题色工作、排查颜色不一致类反馈、评审涉及 CSS 的 diff 时使用。
---

# Petri CSS 主题一致性（海军蓝家族）

背景：UI-392/393 五层教训（灰 hover、slate 残留、infima 特异性死字、遗留 --color-* 零定义家族 103 处、卡片层级倒挂）+ UI-393 页头形态统一。本 skill 是这些事故的制度化；机械化门禁在 `frontend/src/styles/theme-token-contract.test.ts`，写样式后必跑。

## 1. 暗色 Token 阶梯（唯一合法的深色底来源，全部来自 --petri-*）

| 层 | token | 值 | 用途 |
| --- | --- | --- | --- |
| 画布 | `--petri-bg-canvas` | #0b1220 | 内容页画布；**卡内 inset**（代码块/终端） |
| 面板 | `--petri-bg-surface` | #111a2e | 页面级容器/左栏/标题栏/输入框（`--petri-input-bg`） |
| 卡片 | `--petri-bg-subtle` | #182339 | 页面上的卡片/建议卡/面板内嵌面板 |
| 浮层 | `--petri-bg-elevated` | #1d2945 | 弹层/强调浮面 |
| 边框 | `--petri-border` / `--petri-border-strong` | #243149 / #324466 | 分隔线 |
| 文字 | `--petri-text` / `-secondary` / `-tertiary` / `-muted` | #e6edf3 → #6b7689 | 文字四级 |

- 悬停 = `--petri-hover`（白蓝低透明提亮）；**选中/激活 = `--petri-accent-bg` + `--petri-accent`**（teal 或用户 data-accent 主题色）。两者语义不混用。
- 强调色一律走 `--petri-accent*`（随 data-accent 主题切换），禁止写死具体蓝/teal 值。

## 2. 铁律（门禁会咬）

1. **禁用未定义 token 与裸色值**：主题相关颜色必须 `var(--petri-*)`；禁止 `var(--color-*)` 遗留家族（零定义，暗色下漏白）、禁止裸 hex/rgba 写面板/文字/边框色。新 token 先在 custom.css 亮暗双套定义（`--petri-` 前缀）。
2. **禁 slate 灰系字面量**：`rgba(148,163,184,α)`、`#0f172a`、`#1b1b1d`、`#334155` 等（infima/docs 时代遗产，与 navy 族脱节）。
3. **infima 特异性战争**：infima 暗色默认用 `html[data-theme='dark']`（特异性 0,1,1）；本仓覆盖块若写 `[data-theme='dark']`（0,1,0）**全部是死字**。暗色覆盖块必须写 `html[data-theme='dark'], [data-theme='dark']` 双选择器（global/custom 的 @import 在 infima 之后，同特异性必胜；双写兼顾子树作用域）。
4. **层级方向**：卡片/面板不得比其所在页面更深。页面=surface 时卡片=subtle；canvas 只作内容页画布或卡内 inset。卡片画 canvas = 「页面上的洞」（UI-392 根因四）。
5. **全局元素级规则的溅射**（UI-437 v5.2 事故）：`global.css` 的元素选择器（`code`/`pre`/`a`/`table` 等）对**所有**组件生效——组件内使用这类语义元素时必须显式中性化（background/border/padding/border-radius）或改用中性元素（`span`/`div`，保留字族用 `font-family: var(--petri-font-mono)`）；反向亦然——在 global 新增/修改元素级规则前，必须评估对既有组件的溅射面。事故实录：`code { background: var(--petri-bg-subtle) }`（UI-240 行内代码样式）漏进会话时间线行，类选择器覆盖后仍因级联环境反复「复活」，根治=元素换 `span`。
5. **页头标准件**：独立页（/skills /knowledge /settings 形态）头部 = `global-page.module.css` 的 backBtn + 图标 + 标题/副标题；**页面级不放关闭钮**（关闭窗口归标题栏系统控件）。返回按钮样式单一真源就是该文件 `.backBtn`，勿复制。

## 3. 验证配方（本机实证）

- **读 token 实况**：CDP `getComputedStyle(documentElement).getPropertyValue('--petri-x')` 对比意图值——定义了 ≠ 生效（特异性战争会让它死掉）。
- **找画底元素**：`elementFromPoint(x,y)` 向上走、取首个非透明 backgroundColor 的元素+类名 → 定位具体规则。
- **像素取证**：PowerShell System.Drawing 采样/分布统计（System.Drawing 采样法 + 分布直方图见 gates 记忆）；对比「页面底 vs 卡片底 vs hover 底」。
- **生效通道**：dev 栈 CSS 走 Vite HMR 即时生效；打包版不跟随（G0 不外推）。合成 CDP mouseMoved 不触发 `:hover`——hover 色验证用内联注入色值+截图像素采样。

### 视觉验收红线（UI-437 v5.11/v5.12 事故制度化，2026-09-23）

DOM/几何断言通过 ≠ 视觉验收通过。涉及悬浮元素、滚动容器、长内容或嵌套布局的 CSS 工作包，以下四条是硬要求：

1. **必须元素级截图过目**：对组件区域裁剪放大（System.Drawing crop 或等价物）确认视觉形态，不允许只引用 boundingClientRect 合格就宣布修复。事故：复制钮几何量测 `copyWithinFrame=true` 但实际被顶进右栏下方——量测通过、用户看不见。
2. **溢出量测参照系=可视列边界 + 祖先链走查**：escape 对比对象必须是可视列（如消息列 `.sc-msg-body`/视口），并从目标元素向上逐层检查祖先右缘 ≤ 可视列右缘；**禁止**用组件子树内部容器当 host——它可能与目标同处逃逸子树（事故：对 `sc-tool-activity-inline` 量测得 escapePx=-4「假绿」，真实逃逸 334px）。
3. **长内容三态必测**：完整容纳 / 框内滚动（滚动条必须可见——`overflow:auto` 在覆盖式滚动条环境下不渲染滚动条，需显式 `::-webkit-scrollbar` token 化样式，否则长行看起来像被截断）/ 窄视口 ≤900px 不越出宿主列。
4. **`min-width: 0` 贯穿整条 flex/grid 祖先链**：从可视列容器到滚动容器逐层检查 grid/flex 项的 `min-width:auto`（自动最小尺寸会把长内容的最小宽度逐级上传）；只给最内层补漏是打地鼠——v5.9/v5.10/v5.11 三连事故的逃逸均发生在结果块之上三层。

## 4. 门禁与评审

- `cd frontend && npx vitest run src/styles/theme-token-contract.test.ts`：token 定义覆盖 + slate/遗留 token 零残留 + 暗色块特异性形态，写样式后必跑。
- 评审涉及 CSS 的 diff：按 `$petri-code-review` 流程，并对照本 skill 第 1/2 节逐条过。

## 5. 布局层修改的硬性规定（用户裁决 2026-11-03，事故制度化）

**背景事故**：BLOCK-342 SVG 编辑器右栏在 9 轮迭代里被反复「追加覆盖」——抽屉→浮层→底部坞→两行 grid→三卡并排，每轮只加不删，早期规则（`display:flex` 与后来的 `display:grid`、固定 `max-height` 与 `1fr` 行高）互相打架，特异性越叠越高，最终表现为「改一条冒一个新坑」：画布宽度塌到 35px、历史卡与属性栏重叠、内容横向溢出。

**硬性规定（写 CSS 前先读本节）**：

1. **布局层改动一律「重构」不「追加」**：涉及容器尺寸/行列/定位（`display` / `grid-template-*` / `flex-*` / `position` / `width` / `height` / `inset` / `gap` / `padding` 的容器级规则）时，**禁止**在文件末尾新增覆盖规则；必须直接改写该类的主定义，或抽成独立 layout 文件。
2. **单一真源文件**：一个可视区的布局只能有一个定义处。建议 `XxxLayout.module.css`（只放容器类 + 容器外观），组件里容器只引用 `layout.*`；主样式表只放**内容/元素**样式（按钮、输入、列表项），不碰容器几何。
3. **旧规则必须失效而不是被覆盖**：类名迁移比「加 !important / 加更高特异性」正确——元素不再带旧类名，旧规则自然成为死代码，可后续统一清理。
4. **改完必须量测四块几何再宣布完成**：`getBoundingClientRect()` 取 `{x, y, w, h}`，断言「无重叠（A.right ≤ B.left）+ 同行同宽（y/w 相等）+ 不溢出父容器」。截图只能验观感，量测才验结构——只看截图曾导致「面板内控件看着对、画布被挤成 35px」的误判。
5. **每轮迭代前先数规则条数**：同一文件里同一类名的容器规则 > 3 处 → 立即重构，不再调参。
6. **布局改动不写进「视觉精修层」**：精修层（字号/间距/颜色/过渡）与布局层分离，混写是上一轮失控的直接原因。
