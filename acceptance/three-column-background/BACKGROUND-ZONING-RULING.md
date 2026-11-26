# 三栏背景分区 · 低侵入方案材料（试用反馈⑧）

> 发令：Orca bb8dddaf msg_df6c87d28352（owner「左中右三部分区分…用不同背景色，渐变但不突兀」）。
> 性质：**方案材料 + 静态视觉稿，零代码改动**。owner 拍板后才实现；前提=owner 已裁决维持原 UI 风格、不搞大改版。观感零代签。

## §0 核码真源

- 三栏当前背景**完全相同**：`project-workspace.module.css` `.leftCol:587` / `.centerCol:1190` / `.rightCol:2796` 均 `background: var(--petri-bg-surface)`；CDP 实机读三处 computed backgroundColor 一致（x=0/254/990，实机亮色 ≈ `color(srgb .929 .943 .956)`）——分区缺失是事实，不是错觉。
- 可用既有 token（亮/暗双定义，custom.css）：亮 `--petri-bg-surface:#fff` / `-subtle:#f4f4f5` / `-canvas:#fff`；暗 `#111a2e` / `#182339` / `#0b1220`。**亮色 canvas/surface/elevated 同值**，故亮色分区只能靠 `-subtle` 或 `color-mix` 派生，不能靠"换一个现成背景 token"。
- 与反馈⑤分隔线兼容：接缝用 `--petri-border-strong`（亮 #d4d4d8 / 暗 #324466，opacity 1）清晰；本方案 tint 强度 ≤4%，不改接缝规则即可保持可见——两方案不冲突。

## §1 三方案对比（每方案：做法/token/暗色/可读性/侵入面）

### 方案 A — 极淡单色差分区（三栏各一层 2-4% tint）
- 做法：左栏 `color-mix(in srgb, var(--petri-bg-surface) 96%, var(--petri-text) 4%)`（略深）；中栏保持 `--petri-bg-surface`（主底）；右栏 `color-mix(in srgb, var(--petri-bg-surface) 96%, var(--petri-accent) 4%)`（略冷）。分界处用 8-16px `linear-gradient` 淡出，避免硬边。
- token：全用既有 `color-mix` 派生，**零新 token**；暗色随 `-bg-surface`/`-text`/`-accent` 双定义自动适配。
- 可读性：中栏纯主底，消息气泡（`-bg-subtle`）/卡片对比不变；左右辅助栏文字为 `-text` 系列，4% tint 不改变对比度等级。
- 侵入面：三条 CSS 背景声明 + 分界过渡（纯外观，不改布局/功能/消息渲染）。

### 方案 B — 仅左右两侧 tint（推荐）
- 做法：左栏略深 `color-mix(bg-surface 96%, text 4%)`，中栏**纯主底不动**，右栏略浅 `color-mix(bg-surface 80%, bg-subtle 20%)`（亮色 subtle 比 surface 深，暗色 subtle 比 surface 亮——方向随主题自然反转，恰好都是"外围辅助、中心主内容"）。
- token：零新 token；暗色自动适配（subtle 在暗色更亮 → 右栏微亮，符合层次）。
- 可读性：中栏完全不动——消息气泡/卡片/流式内容零影响，最安全；两侧为辅助信息（项目树/文件预览），tint 不改变阅读。
- 侵入面：两条 CSS 声明；不动中栏、不动分隔线，最小。
- 取舍：分区感最柔和（"注意到有层次但说不出哪里变了"正中 owner 要的克制），中栏主体地位最突出。

### 方案 C — 顶部纵向渐变 tint
- 做法：每栏 `linear-gradient(180deg, color-mix(bg-surface 94%, accent/text 6%) 0, var(--petri-bg-surface) 120px)`——从顶部极淡渐到主底，无横向硬边。
- token：零新 token；暗色随双定义走。
- 可读性：中栏顶部有 6% 渐变，消息列表滚动时顶部区域气泡对比略变（仍达标，需 CDP 抽色确认）；对长对话顶部第一行影响最明显。
- 侵入面：三条 background 声明（gradient 替代纯色），稍复杂但仍纯外观。
- 取舍：最柔和但"分区"信号最弱（竖向渐变强调高度而非左右分区），且长列表滚动时渐变锚在容器顶部、内容滚走后层次感减弱。

## §2 推荐与请 owner 拍板

- **推荐 B**：中栏（对话主体）完全不动=可读性零风险、侵入面最小；左右两侧微差建立"外围辅助 / 中心主内容"层次，强度 4% 内契合"渐变但不突兀、克制到说不出哪里变了"；零新 token、暗色自动双适配、与分隔线统一修复无冲突。
- 若 owner 想三栏都有微妙差异选 A；若偏好更柔和的纵向层次选 C。
- **请 owner 回 A/B/C**（或"都不采纳维持现状"）。裁决前零实现代码、零 HMR。

## §3 边界与验证

- 红线：tint ≤4%、克制、零新 token/新依赖、暗色双套、与反馈⑤分隔线兼容、不改布局/功能/消息语义。
- 视觉稿：`visual-direction.html`（现状与三方案并排、右上切亮/暗，浏览器直接开），静态稿非可运行原型。
- 拍板后验证：HK-01 红绿（三栏背景差异 token 断言）+ theme-token-contract + CDP 实机抽色（亮暗两态、气泡对比）+ 观感零代签（owner 过目）。

status: pending_user_ruling（Agent 不代答、不写实现代码）
