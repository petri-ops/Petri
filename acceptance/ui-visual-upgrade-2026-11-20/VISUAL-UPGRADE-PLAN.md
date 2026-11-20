---
capability: ui-design-quality
goal: 把既有设计体系从「机械达标」推到「可见质感」，用可复跑判据而非一次性换皮
status: advisory
truthDomain: ui-visual-upgrade-2026-11-20
reopen: 任一 U 类裁决（范围/目标分/断点档/依赖/立项）由用户裁决后转正式工作包
---

# Petri UI 视觉质感升级方案（advisory）

> **性质**：只读审查 + 方案文档。**不占单工作包串行槽位**、不改产品代码、不回写 canonical roadmap/handoff/UI 台账、不翻任何观感状态。落地须逐期用户发令 + closeout 门禁，口径沿用 2026-11-11 专项评估的 `advisory` 先例（`acceptance/ui-design-assessment-2026-11-11/ASSESSMENT-AND-PLAN.md`）。
> **阶段纪律**：G0 开发期常态 · 不外推 packaged/Provider/GA。
> **读数纪律**：本文件所有机械数字标注取证时点；实施前必须现读复核，禁止把历史读数写成当前事实。

---

## 0. 执行摘要

**核心判断**：Petri 的问题不是「没有设计系统」。`theme-token-contract` 19/19、7970 处 `var(--petri-*)` 引用、海军蓝四阶 + 6 档字号 + 8 档间距 + 3 档动效齐备；静态评估 D 维 4.5/5。缺口在 **C 维 3.5/5（目标 4.5）**——标准没覆盖到的面 + 观感未闭合。因此"大幅升级"必须走 **refinement（在既有视觉世界内提高工艺底线）**，而非 redesign（换视觉世界）：后者违反 `reference-board-review.json` 的 `noGlobalReskin: true`、用户「少线条/单色阶/主题色一致」偏好与「对标不改魂」裁决。

**四个抓手**（对应本次任务四项要求）：

| # | 抓手 | 一句话 | 主证据 |
|---|---|---|---|
| 1 | 质感标准 | 把"看起来业余"翻译成 6 条可复算判据（浏览器表面/深度/节奏/字族/状态/文案） | 11-11 评估 C=3.5；craft-floor 的 browser surfaces 条款 |
| 2 | 配色体系 | **不是加颜色，是让强调色稀缺**：accent 引用 356 → 契约上限 130 | `visual-consistency.json` `colorBudget.total=356 / declaredCeiling=130 / targetMet=false` |
| 3 | 视觉层级 | frame-first 定区域预算；扫描型列表用行不用卡；四级表面阶梯禁止"页面上的洞" | product-ui-taste §3/§0.C；petri-css-theme §1/§2 层级方向 |
| 4 | 细节打磨 | 只做承载反馈的动效；浏览器默认面（caret/selection/scrollbar/focus ring/表格数字）主题化 | craft-floor "Browser surfaces … the cheapest signal that a page was built rather than assembled" |

**设计即产品质量的反映**：Petri 的"质感"不是装饰层，而是本地主权 / 全链可审计 / 证据自证的可见面——每一处视觉承诺都绑定一条机械门禁与一条证据链，这是与 ZCode/Codex 的差别形态（借工艺机制，不抄皮肤）。

---

## 1. 既有迭代与参考资料盘点（审查结果）

### 1.1 迭代记录（按对用户可感面的影响排序）

| 工作包 / 文档 | 留下了什么 | 对本次的约束 |
|---|---|---|
| `docs/block-167-product-quality-program-plan.md`（五波 W0–W4 completed） | 设计宪章、`theme-token-contract`、按钮五件套单源、动效 token | 字符集/色预算/档位是冻结项，棘轮只减不增 |
| `docs/block-161-ui-design-system-governance-plan.md`（completed） | 圆角 4 档、间距 8 档、84 种阴影收敛、裸字号清零、24 组明暗配对 | 阶梯外不新造；阴影是既有资产，不重写 |
| `docs/block-418-ui-design-d3-visual-plan.md` / `block-422-ui-readability-plan.md` / `block-423-settings-redesign-plan.md` | hover 单源、selected 专用 token（已在 `global.css:54-56/75-77` 在场）、860px 阅读宽、设置页"少线条/单色阶/居中" | BLOCK-423 用户原话「设置页面没有质感，看上去业余」是本次问题的最早正式留痕 |
| `docs/design-review-2026-09.md` §4 | 「交互僵硬」= 每条 stream token 全树重建 + Markdown 现算 + 无虚拟化 | 质感不只是 CSS；渲染管线是"顺不顺"的根因，属独立候选，不在本方案样式范围 |
| `acceptance/ui-ux-audit-2026-10-10/ui-upgrade-plan.md`（方案，未全实施） | 四维总纲（布局/字体/配色/性能）；对比度速修 4 处；accent 接 ifm 的 A/B 方案 | 其中"对比度 4 处改色""22 处裸字号"已由后续包落地；**实施前逐条现读，不重复做** |
| `acceptance/ui-design-assessment-2026-11-11/ASSESSMENT-AND-PLAN.md`（advisory） | 静态评分卡 A3.0/B3.5/C3.5/D4.5≈3.6；UI-D0–D5 分期；量化门槛表 | 本方案是它的 C/D 维聚焦升级，复用其评分卡口径，不另立第二套计分 |
| C-53 P0–P7（`docs/block465-…` 至 `block476-…`，全 completed） | 12 份 `resources/design-context/*.json` 机器可读设计输入；`humanEyeSigned=false`；P7 完成仅指"非观感准备就绪" | 所有方案决策从 design-context 现读；观感槽保持 in_progress，不代签 |
| UI-716 + 2026-11-20 观感签字裁决（`docs/AUDIT-LOG.md` 头部） | 偏好预审闭环：用户给标准→截图预审→优化建议→自动优化呈现面→复验翻 verified，≤3 轮 | 观感项有偏好裁决可走闭环；无裁决保持 in_progress |

**台账现读**（`acceptance/block-332/ui-ledger-triage.json`，2026-11-20T07:03）：sections 509 / uniqueIds 500 / verified 461 / debt 36（live-missing 13 + blocked 23）/ closed 12。设计上下文快照较旧（sections 503 / debt 38）——实施前以现读 triage 为准。

### 1.2 审美参考与 skills 梳理

**项目内 canonical（不可绕过）**

- `docs/design-charter.md`：字号 6 档（body 14px 占比 ≥50%）、中性:强调 ≥10:1、accent ≤130 且每视图 ≤8、accent 五语义、线条三语义、无语义 1px 细线终态 0、动效 3+2 档、控件五件套。
- `docs/ui-design-acceptance-checklist-v1.md`：八态矩阵、几何四块、长内容三态、断点表、**静态分 ≠ 观感分**。
- `resources/design-context/` 12 件：`design-context.json`（档位/预算/棘轮/19 断言）、`ia-map.json`（12 路由 + 5 高频路径）、`visual-consistency.json`（海军蓝阶梯 ascending、颜色预算未达标）、`responsive-a11y.json`（32 对对比度 0 违规、24/30px 触摸目标）、`performance-trust.json`、`manifest.json`，以及 `skill-contract.json` / `human-eye-closeout.json` / `assistant-ui-pattern.json` / `react-bits-motion.json` / `21st-snippet-library.json` / `reference-board-review.json`。
- `docs/user-preferences-codification.md` §维度 3 + §裁决结果：3.5/3.6 升格为跨 UI 审美通则。

**项目 skills（已在包内，发现桥真 symlink）**

- `$petri-ui-design`：读取顺序 charter → checklist → 台账 → token 契约 → css-theme → design-context；硬规则含"禁第二套 token / 禁放宽棘轮 / 禁默认装饰动效 / 禁静态证据称 verified"。
- `$petri-css-theme`：海军蓝四阶 + 文字四级；悬停/选中语义分离；禁裸色/遗留 `--color-*` / slate 字面量；暗色块双选择器；卡片不得比页面更深；**布局层重构不追加**、高度链路完整。

**用户级已装设计 skills（11-11 评估 §5 清单；只借方法，不成项目依赖）**

| skill | 本方案取用的机制 | 不取用 |
|---|---|---|
| `impeccable`（`craft-floor.md` / `operate.md` / `colorize.md` / `typeset.md`） | browser surfaces 主题化、阴影需 offset+soft blur、间距"紧内松外"、正文 65–75ch、一处 authored motion、状态齐全 | 换字体世界、渐变文字、玻璃拟态、kicker/eyebrow、emoji 当图标、全页编排式动效 |
| `product-ui-taste` | frame-first 区域像素预算、扫描型用 rows 不用 cards、DENSITY/DATA_COMPLEXITY/CONSEQUENCE 三档、house system first | 引入 Carbon/Fluent/Ant 组件库；为密度牺牲"文字少" |
| `ui-ux-pro-max` / `ux-heuristics` / `accessibility` / `UI/UX Design Review` / `web-design-guidelines` / `figma-generate-library` / `penpot-uiux-design` / `tailwind-design-system` | 作为评审视角池与启发式清单，按需调用 | 当作产品运行时依赖或第二套 token 源 |

**借鉴许可边界**（`reference-board-review.json` LICENSE_REGISTER）：assistant-ui MIT（仅形态）、React Bits MIT + Commons Clause（仅反馈型微动效模式、复用 `--petri-duration/ease`）、21st.dev 逐组件查许可、Pinterest/Refero 仅评审方法。零品牌标志/文案/插画/整页布局复制，零新增产品依赖。

### 1.3 用户裁决原话（已定稿，作为预审判据）

1. 「目前 petri 设置页面没有质感，看上去业余」（`block-423…plan.md:15`）——本次问题的原始动机。
2. 「很割裂 / 主题色保持一致 / 不要那么多线条」——升为跨 UI 通则（少线条、单色阶、内容居中）。
3. 「简单文字少，布局和谐」（UI-716 首例偏好预审）；「默认就收起，别占空间」；「中间栏固定宽度太宽…手机屏幕宽度更合适」。
4. 「避免成为另一个 Zcode 或者 codex 呀 保留自己的特色 借鉴他们的优点」——对标只借形。
5. 「输出简洁」最高优先；emoji 不滥用；标题名词短语、按钮动词短语；中英文混排专名保留英文。
6. 2026-11-20：「观感项偏好预审通过即视为签字」——≤3 轮、仅呈现面、逐条判据 + 证据留痕。

---

## 2. 诊断：为什么"质感仍显普通"

| ID | 发现 | 现读证据 | 性质 |
|---|---|---|---|
| G-1 | **强调色过量，稀缺性失效** | `visual-consistency.json` `total=356` vs `declaredCeiling=130`，`targetMet=false`；`project-workspace.module.css` 102、`simple-chat.css` 31、`desktop.css` 24 处 accent 引用 | 配色平庸首因：不是颜色少，是信号被稀释 |
| G-2 | **浏览器默认面未接管** | 11-11 评估：内联样式 331、裸 z-index 111（38 文件）、`;;` 58 文件、fallback 189 处；`::selection` 已唯一但 caret/scrollbar/tabular numerals 未成体系 | craft-floor 明列"最便宜的'做过设计'信号"，也是模型最常漏的面 |
| G-3 | **层级阶梯空转 / 布局非单源** | z 8 档仅 13 处引用 vs 111 裸数字；17 个断点阈值；`CenterPanel` 双层 layout、同名 class 两处定义（H9 K-16 未闭环） | "看着割裂"的结构根因，样式层修不好 |
| G-4 | **观感判据没落档** | 22 条 E 类人眼槽 + UI-706/707/709/710 未签；`humanEyeSigned=false`；静态 3.6 vs 目标 4.4（U 类） | 无判据→无法收敛→每轮"凭感觉" |
| G-5 | **渲染"僵硬"不在样式层** | `design-review-2026-09.md` §4：每 token 全树重建、Markdown 现算、无虚拟化 | 与 G-1~G-4 独立，属性能/体验候选 |

**关键矛盾与解法**：用户要"质感提升"，同时偏好"文字少、少线条、默认收敛、色彩一致"。若用"加渐变/加装饰/加阴影"回应，会同时违反偏好与 noGlobalReskin。解法是 **提高工艺底线而非提高装饰量**：深度靠 offset+soft blur 的既有阴影 token、层级靠表面阶梯与留白、质感靠浏览器表面主题化和排版节奏、配色靠收敛到 10:1。

---

## 3. 质感标准（Pillar 1 · 建立判据）

**定义**：质感 = 在既有视觉世界内，每个可见面都能通过 6 条可复算判据。验收沿用评分卡口径，静态分与观感分分列，**Agent 不写 verified**。

| 判据 | 可复算口径（静态/机械） | 观感判据（偏好预审用） |
|---|---|---|
| Q1 浏览器表面 | `::selection` 唯一；caret-color / scrollbar thumb-track / focus ring（`--petri-ring-width:2px`）/ 表格 `font-variant-numeric: tabular-nums` / 下划线偏移均有 `var(--petri-*)` 来源，裸色 = 0 | 选中、聚焦、滚动、长表格数字对齐无一处"系统默认蓝/灰"突入 |
| Q2 深度 | 阴影仅用 `--petri-shadow-sm/menu/float`；offset + soft blur；无零偏移彩色光晕；border 与 wide shadow 不同时出现（禁 ghost card） | 浮层"浮得起来"，卡片不靠描边假装层级 |
| Q3 节奏 | 间距 8 档引用率单调上升；标题上方留白 > 下方；同组紧、异组松；正文 65–75ch | 「布局和谐」：不挤、不散、分组一眼可读 |
| Q4 字族与字阶 | 单字族（系统 sans），6 档字号 + 500/600/700 三档字重；body 14px 占比 ≥50%；裸 px 只减不增 | 「文字少」优先于信息密度；相邻角色不靠 1px 差硬分 |
| Q5 状态完整 | 每个可交互元素覆盖八态；hover 与 selected 各 1 真源；loading 用骨架不用转圈；empty 教界面而非"暂无数据" | 禁用/错误态说明真实原因与恢复动作，不静默 |
| Q6 文案 | 标题名词短语、按钮动词短语；无 emoji 当图标；错误给问题 + 恢复 | 「输出简洁」：不啰嗦、不营销腔 |

**评分卡协议**：D0 冻结 `baseline.json`；每期用**同一组命令**复算 A/B/C/D，Before/After 并列；`targetPerDimension=4.4` 仍是 **U 类建议值，不擅自当门槛**。静态分只证明判据覆盖，不证明好看。

---

## 4. 配色体系优化（Pillar 2 · 稀缺化而非加色）

### 4.1 角色地图（唯一语义来源 = design-charter §2 + petri-css-theme §1）

| 角色 | token | 纪律 |
|---|---|---|
| 画布 | `--petri-bg-canvas` | 内容页画布 / 卡内 inset；不用于页面上的卡片 |
| 面板 / 卡片 / 浮层 | `--petri-bg-surface` / `-subtle` / `-elevated` | 单调 ascending（现读 specAligned=true）；卡片不得比宿主页面更深 |
| 文字四级 | `--petri-text` / `-secondary` / `-tertiary` / `-muted` | 正文 ≥4.5:1、大字 ≥3:1 硬底线，不因偏好放宽 |
| 强调五语义 | 主按钮 / 激活选中 / 链接 / 焦点环 / 状态语义 | 只走 `--petri-accent*`；图标、次级动作、装饰默认中性 |
| 悬停 / 选中 | `--petri-hover` / `--petri-selected-{bg,border,text}` | 语义不混用（已各 1 真源，保持） |
| 明暗 | 亮色 zinc + 纯白 purity；暗色 navy 四阶 | 暗色不是亮色机械反转，分别构图；新 token 先亮暗双套定义 |

### 4.2 优化动作（按收益排序，均不改 token 家族）

1. **G-1 收敛**：把 `project-workspace.module.css`（102）、`simple-chat.css`（31）、`desktop.css`（24）等文件中的装饰性 / 次级动作 accent 引用改回中性；机械门只减不增，目标 356 → ≤130（契约口径）。每视图可见强调点 ≤8。
2. **误用面归位**：强调色只保留五语义；图标与次级动作走 `-secondary/-muted`；状态色走既有 status token，不新造色值。
3. **ifm 派生复核**：旧方案提出"5 个 `[data-accent]` 块未覆盖 `--ifm-color-primary`"——**实施前现读确认是否仍成立**；若成立，用 `color-mix` 从 `--petri-accent` 派生补齐，禁止写死 5 套十六进制。
4. **亮暗配对**：任何新增 `--petri-*` 必须亮暗双套定义；契约的明暗成对断言覆盖不到组件 CSS 外溢定义，新增时人工过一遍。
5. **对比度**：保持 `gate:ui-a11y` 32 对 0 违规；`--petri-text-muted` 亮 5.3 / 暗 5.94 的后置值不回退。

**机械验收**：`theme-token-contract` 19/19 且 accent 棘轮**下调**；`visual-consistency.json` 的 `colorBudget.targetMet` 由 false 转 true（需重跑生成器）；slate / 遗留 token 零残留；对比度门禁绿。

---

## 5. 视觉层级完善（Pillar 3）

1. **frame-first 区域预算**：先给顶栏 / 左栏 / 主区 / 右栏定像素预算与容器策略，再填内容（product-ui-taste §3）。Petri 已有 AppRail + 三段 TitleBar + 左栏 + 主区 + 右栏 16 tab 的骨架——**不重构 IA**，只把现有区域的宽度/间距预算显式化并对齐「列宽克制」偏好。
2. **扫描型面用 rows 不用 cards**：会话列表、模型表、Endpoint 表、文件树等"扫描/筛选/选择"面保持行式 + 分隔线；卡片只作 KPI / 面板 / 设置分组容器。禁止把记录逐条包成 Card + Badge。
3. **表面阶梯**：canvas → surface → subtle → elevated 四级语义固定；卡片画 canvas =「页面上的洞」（UI-392 根因四）。层级用底色差 + 留白 + 一处柔和阴影表达，不用描边堆叠。
4. **排版层级**：6 档字号 + 三档字重；每页 ≤1 处 2xl；相邻角色至少跨一档字号或一档字重；正文默认 14px，`text-wrap: balance/pretty` 可用于标题/短正文（渐进增强）。
5. **信息层级**（每模块统一）：① 主行动 1 个 → ② 次行动 2–3 个 → ③ 支撑信息默认可见 → ④ 高级/过程默认收起、运行时展开。与 UI-713 chat-first / Studio-on-demand 一致。
6. **层级清理**：裸 z-index 111 → `--petri-z-*`（Toast 最高语义不动）；`CenterPanel` 双层 layout 与同名 class 双定义合并为单一 layout 文件（布局层重构不追加，改完量测四块几何）。断点 17 → ≤4 档属 **U 类**（档位数值需裁决），本方案只给出收敛方向。

---

## 6. 细节打磨（Pillar 4）

| 面 | 具体动作 | 判据 |
|---|---|---|
| 浏览器表面 | caret / selection / scrollbar / focus ring / 表格数字 / 下划线偏移全部 `--petri-*` 化 | 裸色 0；focus-visible 覆盖所有可交互元素 |
| 深度 | 阴影只用既有三档；offset + 柔和 blur；同一元素不同时 border + wide shadow | 元素级裁剪截图过目（不只看 boundingClientRect） |
| 节奏 | 紧内松外；标题上方留白 > 下方；长内容三态（完整容纳 / 框内滚动且滚动条可见 / ≤900px 不越界）；`min-width:0` 贯穿 flex/grid 祖先链 | 几何四块 + 三态 flow |
| 动效 | 只在状态变化/反馈处用 150/200/300ms + 两档 ease；全产品只保留一处 authored moment；`prefers-reduced-motion` 豁免保持 | 禁整页编排、禁装饰性 hover 微动效堆叠 |
| 文案 | 按钮动词短语、标题名词短语；错误 = 问题 + 恢复；空态教界面；无 emoji 图标 | 文案走产品语言，不夹营销腔 |
| 状态 | 八态矩阵逐格填齐；骨架屏；hover/selected 真源不混 | `focus-visible` 与键盘路径实机可达 |

---

## 7. 分期路线（建议序 · 每期独立发令 · 单工作包串行）

| 期 | 范围 | 机械验收 | 观感 |
|---|---|---|---|
| **V0 基线冻结** | 现读重扫 baseline（评分卡 / 颜色预算 / 台账 triage / design-context sha）；注册为对账基线 | `theme-token-contract` 19/19、`docs:check`、`hygiene:check` 绿；字段与现读逐项相等 | 无 UI 改动，不涉及 |
| **V1 配色稀缺化** | G-1 收敛 356→≤130；ifm 派生复核；亮暗配对复核 | accent 棘轮下调、`targetMet` 转 true、对比度 32 对 0 违规 | 颜色观感走偏好预审（标准=主题色一致、少线条） |
| **V2 层级与布局单源** | z 裸值迁移；`CenterPanel` 双 layout 合并；宽度预算显式化；rows-not-cards 扫描面盘点 | 四块几何全绿、≤900px 不越界、长内容三态、拆前拆后同套测试绿 | 不代签；布局改动只重构不追加 |
| **V3 浏览器表面与细节** | Q1/Q2/Q6 落地：caret/selection/scrollbar/focus/tabular、阴影归位、文案句式 | 裸色 0、focus-visible 覆盖、`;;` 归零、`gate:ui-a11y` 绿 | 截图预审（≤3 轮、仅呈现面） |
| **V4 复测与台账回写** | 同套评分卡 Before/After；新判据植入违规必红负测；UI 台账同批回写 | `ui:audit:check` 转绿、新增判据负测 100%、`closeout` 绿 | 观感项按 11-20 裁决走预审闭环或留 in_progress |

与 11-11 评估 D0–D5 的关系：V0=D0、V2≈D2+D3、V3≈D4 的样式面、V4=D5；**D1 信息架构收敛与 D4 人测腿不并入本方案**，保持独立候选。V1 是本方案新增的配色专期。

---

## 8. Design Brief（canonical 10 节 · 设计产物最小可检形态）

1. **Goal / non-goals**：Goal = 提高既有视觉世界的工艺底线；Non-goal = 全局换皮、换字族、引组件库、改 IA、改交互语义、提 G1+。
2. **Canonical anchors**：UI issue = 11-11 评估 C 维 + UI-716 偏好；charter = `docs/design-charter.md`；contract = `theme-token-contract.test.ts` 19 断言；单源 = `components/ui/controls/`。
3. **Information hierarchy**：每模块 1 主行动 / 2–3 次行动 / 支撑可见 / 过程默认收起（ia-map.json 5 条高频路径优先）。
4. **Module state matrix**（每个可交互元素按此填格）：

| Element | default | hover | active | disabled | loading | empty | error | focus-visible |
|---|---|---|---|---|---|---|---|---|
| Button / Input / Select / Chip / Empty（复用五件套） | 既有 token | `--petri-hover` | `--petri-selected-*` | muted + 真实原因 | 骨架 | 教界面的文案 | 问题 + 恢复 | `--petri-ring-width` focus ring |

   注：按模块落地时逐格替换为真实元素；空格 = 未覆盖 = 验收不通过。

5. **Layout / responsive contract**：容器边界按 frame-first 预算；窄屏（≤900px）抽屉/收起；长内容三态；浮层用 portal 逃出 `overflow` 祖先；z 走 8 档。
6. **Token / component mapping**：颜色仅 `--petri-*`；字号仅 6 档；边框仅 input/card/divider 三语义；动效仅 `--petri-duration-*` + `--petri-ease-*`；组件复用五件套，新组件需单一真源。
7. **Interaction / keyboard**：指针流与键盘流同构；焦点返回原位；Escape 关闭浮层；异步反馈用骨架/行内回执不跳位。
8. **Anti-patterns / exclusions**：见 §10。
9. **External references / licenses**：见 §1.2 表；`Do-not-copy` = 品牌标志 / 文案 / 插画 / 整页布局 / 组件实现代码。
10. **Verification plan**：见 §3 评分卡 + §7 分期门禁。

---

## 9. 需用户裁决点（U 类，不擅自决定）

1. **范围定形**：本方案推荐 refinement（不换视觉世界）。若用户要 redesign，须走 `$petri-ui-design` new-work 并更新 DESIGN.md，属另一裁决。
2. **目标分**：`targetPerDimension=4.4` 是否正式采纳为门槛（11-11 评估标为 U 类）。
3. **断点档位**：17 → ≤4 的具体数值与 JS/CSS 单源常量（U 类，出决策材料）。
4. **状态色家族合并**（`--petri-success` / `--petri-status-success` / `--petri-status-success-fg` 三套并存）：合并属 breaking，需单独裁决。
5. **立项**：V0–V4 每期均为新工作包，须用户逐期发令；本文件不构成开工。

---

## 10. 红线与边界

- 不建第二套 color/font/token 体系；不放宽任何棘轮；不在阶梯外新造档位。
- 不做全局换皮、不复制参考品牌资产、不引入产品级新依赖（含 UI kit / 组件库 / stylelint 等，须走 DEPENDENCY-CHANGE-CHECKLIST 并裁决）。
- 不替换 `SimpleChat`；不改 IPC / 状态管理 / 交互语义；不把静态证据写成 `verified`。
- 观感项无裁决保持 `in_progress`；有裁决走 ≤3 轮偏好预审闭环，仅改呈现面，逐条判据 + 截图证据留痕。
- E-03 真人样本评分已 cancelled（G0 常态），本方案不重启用户测试。
- 不触碰工作区既有 WIP 与 untracked 用户资产（`git status` 现读：block462/463 diagnostics、block503-outputs 探针、`petri-logo-concepts*`、`tmp-*` 等）。

---

## 11. 证据索引

- 评估与方案：`acceptance/ui-design-assessment-2026-11-11/ASSESSMENT-AND-PLAN.md`、`acceptance/ui-ux-audit-2026-10-10/ui-upgrade-plan.md`、`docs/design-review-2026-09.md`
- 契约与基线：`docs/design-charter.md`、`docs/ui-design-acceptance-checklist-v1.md`、`frontend/src/styles/theme-token-contract.test.ts`、`frontend/src/styles/custom.css`、`frontend/src/styles/global.css`
- 设计上下文：`resources/design-context/*.json`（manifest sha 为准）
- 台账与观感：`docs/ui-productization-audit.md`、`acceptance/block-332/ui-ledger-triage.json`、`docs/ui-design-human-eye-route.md`
- 决策建议器：本次 `test:suggest` = 零建议（area_none）、`doc:suggest` = 零建议；如实附记，不因零建议跳过静态下限。
