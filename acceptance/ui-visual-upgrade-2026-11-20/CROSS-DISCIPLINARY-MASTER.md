---
capability: ui-design-quality
goal: 用建筑/影视/绘画/艺术史的修养底座支撑格物视觉语境，形成 Petri 自有主题与产品力
status: advisory
truthDomain: ui-visual-art-direction-2026-11-20
companion: ART-DIRECTION.md（身份与色/形/图标）· VISUAL-UPGRADE-PLAN.md（门禁与分期）
---

# 格物视觉修养底座（Cross-Disciplinary Master Plan · advisory）

> **回答你的问题**：是，建筑、影视、绘画、艺术史都能纳入——但它们不是"贴皮素材库"，而是**做设计判断的底层语法**。本文件把四门学科各抽取 2–3 条"能落到桌面 agent UI 的真原则"，全部收束到一个目标：**让界面一眼是格物，且这个"像格物"本身就是产品力**（本地主权、全链可审计、证据自证、通用 agent）。
> **诚实边界**：本机没有专门的建筑/影视/绘画 skill（已核 `~/.codebuddy/skills/` 全表）；这部分是**专业知识综合**，不是引用某个已装技能。专业设计库 `ui-ux-pro-max` 提供风格/配色/字体/图标的旁证（见 §5），但**玻璃拟态、视差、胶片颗粒、霓虹辉光这类流派明确不采纳**——它们与格物"平面、克制、无渐变无辉光"冲突（品牌资产 `v2-colour-directions.png` 原文：*"Flat colour only - no gradients, no glow, no transparency"*）。
> **边界**：advisory，不占串行槽位、不改代码、不翻观感状态。身份级换色 U 类待你裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 0. 总纲：产品力 = 可辨识的视觉主题 × 可被验证的承诺

格物的产品力不在"界面好看"，而在三件事：**本地主权 / 全链可审计 / 证据自证**。视觉修养要服务这三件事，而不是掩盖它：

| 产品力 | 视觉转译（来自品牌资产） | 跨学科依据 |
|---|---|---|
| 本地主权 | 开环 mark（缺口朝下）= 不闭合、不云端托管、留有余地；宣纸暖中性 = 本机桌面而非网页 | 建筑：结构诚实（形式 telling 你它怎么被支撑） |
| 全链可审计 | 发丝线分隔 + 错落四格（一格点睛）= 每步可见、轨迹可追 | 影视：剪辑连续性（每一帧交代来源）；绘画：经营位置 |
| 证据自证 | 点睛色只落"那一格" <5% = 结论醒目、装饰退场 | 绘画：计白当黑、宾主分明；建筑：光作为材料 |

**一句话主题**：*"一台跑在宣纸上的精确仪器"*——仪器感来自建筑/影视的秩序与光，宣纸感来自绘画的留白与和声，最终指向格物的"可审计 agent"。

---

## 1. 建筑学（Architecture）：空间秩序、结构诚实、光作为材料

建筑给 UI 的不是装饰，是**组织空间的语法**。三条可落地：

1. **结构诚实（structural honesty）**：形式应告诉你它如何被支撑。落到 UI = 卡片/面板的边界反映真实层级（父子从属、包含关系），不用假阴影假装浮起、不用描边假装分组。与既有 `petri-css-theme §2` "卡片不得比页面更深 / 层级方向" 同源，建筑给了它理论根据。
2. **框架即叙事（frame-first）**：先定房间的墙与门，再放家具。落到 UI = 顶栏/左栏/主区/右栏的像素预算先定，内容后填（与 `product-ui-taste §3` frame-first 一致）。格物三段式 TitleBar + AppRail + 左栏 + 主区 + 右栏是这个语法的既有骨架，不重构。
3. **光作为材料（light as material）**：建筑用光定义空间而非照亮它。落到 UI = **亮暗不是反色，是两种光**：亮色=宣纸受光（暖白、发丝线、低饱和），暗色=墨底微光（深墨 #1C1B19 为结构、点睛色发光但不铺满）。这与品牌 `00-palette.png` 的宣纸/墨对位完全吻合，也满足 charter "dark 不是 light 机械反转"。
4. **留白率**：建筑中"空"是被设计的。品牌 board 规定**内容占比 ≤40%**，其余留白——这条直接进 A3 排版期的人眼判据。

**不采纳**：玻璃墙/镜面反射/材质拟真（spatial-ui 风格库里的 `backdrop-filter: blur(40px)`）——会变成装饰性深度，违反品牌 flat only。

---

## 2. 影视设计（Film）：镜头层级、色彩剧本、焦点即注意力

影视给 UI 的是**注意力的调度**，而不是电影感特效：

1. **镜头层级（shot hierarchy）**：远景建空间 → 中景交代关系 → 特写给关键信息。落到 UI = 页面 hero（远）→ 区块（中）→ 数值/状态点（特写点睛），一屏只有一个"特写"（点睛格 <5%）。与 A1/A2 的"一屏一格点睛"同源。
2. **色彩剧本（color script）**：整部片的配色随情绪走一条线，不每场乱换。落到 UI = 四套和声试样不是四个并列主题，而是**一条剧本里的四场**：工作态青瓷（冷静执行）、证据态群青铜（归档贵重）、品牌面宣纸朱砂（身份落印）、数据态靛雾（克制清晰）。切换由语义触发，不由用户随手切——这是"主题色一致"偏好的影视化表达。
3. **焦点即注意力（rack focus）**：电影用浅景深把注意力给一个人。落到 UI = 用 `--petri-ring-width:2px` 焦点环、点睛色选中、发丝线引导，而不是给整页加动效。**全产品只保留一处 authored motion**（与 VISUAL-UPGRADE-PLAN §6 一致），像一次落印，不是整页转场。
4. **剪辑连续性（continuity）**：跳切会让人失去空间感。落到 UI = 浮层/抽屉/Escape/焦点返回要交代来路（模块矩阵 §7 已覆盖），不闪现不跳位。

**不采纳**：胶片颗粒、light leak、VHS tracking（`vintage-analog-retro-film` 风格库）——品牌原文 flat colour only，且颗粒会破坏发丝线的精度。

---

## 3. 绘画（Painting）：计白当黑、随类赋彩、骨法用笔

绘画给 UI 的是**用色与用笔的东方语法**，正好接住品牌资产 `01-system-board.png`：

1. **计白当黑（count white as black）**：空白不是没画，是主角。落到 UI = 留白 ≥60% 是主动设计，不是剩余空间；容器不用填满，发丝线分隔而非框线。这条比 charter 的"分隔优先序 留白>底色差>divider"更彻底——东方绘画给了它美学根据。
2. **随类赋彩（color by category）**：色彩按物类分，不按装饰分。落到 UI = 色只跟随语义角色（骨架/点睛/状态），不为好看给某个区块单独上色。与 A1"点睛色只映射 accent/selected/focus/brand-mark"同位。
3. **骨法用笔（structural stroke）**：笔画有骨力、每一笔承担结构。落到 UI = 图标 1.5px 线性笔画、端点齐平、开环缺口有"笔断意连"；自绘 SVG 而非堆砌图标库（与 ART-DIRECTION §3/§4 一致）。
4. **宾主分明（guest-host distinction）**：画面有主有宾，不平均用力。落到 UI = 主行动 1 个、次行动 2–3 个、点睛格 1 个（VISUAL-UPGRADE-PLAN §5 信息层级同构）。

**调和色的绘画根据**：品牌四套试样都是"一骨架+一点睛"的**类似色/互补色和声**——青瓷（类似绿青，宁静）、群青铜（蓝橙互补，贵气）、朱砂墨（暖冷对比，火气）、靛雾（低饱和冷调，国际感）。这正是绘画调色学里的和声关系，不是随机取值；落地时保持 <5% 点睛面积，就守住了"和声不吵"。

---

## 4. 艺术史（Art History）：风格取法与"不抄皮肤"

艺术史给的是**取舍的坐标**，让格物不滑向通用：

| 流派 | 可取的语法 | 格物化 | 不取 |
|---|---|---|---|
| 瑞士国际主义（Swiss 2.0） | 12 栏网格、数学间距、非对称平衡、单一强调 | 区域预算 frame-first、8 档间距、单一点睛 | Helvetica 硬套中文 |
| 风格派 / 构成主义（De Stijl/Constructivism） | 正交几何、原色点题、错落构图 | 开环 + 错落四格 mark 的造型原子 | 大块纯色铺满界面 |
| 宋元文人画 / 东方留白 | 留白、平远、墨分五色 | 宣纸语境、发丝线、内容 ≤40% | 水墨贴图/毛笔笔触装饰 |
| 极简主义（Minimalism） | 少即是多、去除装饰 | 少线条、无渐变无辉光、八态齐全 | 冷冰冰无身份 |

**"大师级"不是堆流派，是知道哪些流派为你所用、哪些要拒绝**——拒绝的理由都写进 ART-DIRECTION §0 和本文件各节"不采纳"。这就是对标不改魂的实操。

---

## 5. 专业数据库旁证（诚实标注来源与拒绝项）

`~/.codebuddy/skills/ui-ux-pro-max/data/` 实查（192 配色 / 90 风格 / 105 图标 / 75 字体配对）：

- `swiss-modernism-2-0`：网格 / 数学间距 / 单一 accent / best-for "architecture, editorial, museums" → **采纳**网格与单一 accent 纪律，**拒绝**其 Helvetica 字体落地（中文栈优先）。
- `dimensional-layering`：四级阴影 / z-index 层级 → **有限采纳**浮层阴影，拒绝视差/translateZ。
- `spatial-ui-visionos`：blur(40px)/玻璃/视差 → **全部拒绝**（与 flat only 冲突）。
- `vintage-analog-retro-film`：颗粒/漏光 → **全部拒绝**。
- typography 库 `Developer Mono`(JetBrains Mono+IBM Plex Sans)、`Science/Tech`(Exo+Roboto Mono) → **仅作"精确仪器"气质对照，不引字体依赖**，中英混排按用户偏好（专名英文、系统中文栈）。
- icons 库（Phosphor 105 枚）→ 只借 outline 语义与 a11y 规则，自绘 SVG，零依赖。

---

## 6. 收束：格物自有主题与产品力（最终答案）

把四门学科收束成一个**别人抄不走的形态**：

> **格物主题 = 东方纸墨和声（绘画）× 结构诚实的空间秩序（建筑）× 单焦点色彩剧本（影视）× 瑞士网格的克制（艺术史）**。
> **产品力表达**：开环=本地不闭环；错落四格一格点睛=证据自证（结论只亮一格）；发丝线+留白=全链可审计的轨迹与余地；和声四场随语义切换=通用 agent 的多场景一致身份。

**落地不改上一份的分期**：A0 身份转译裁决（新增一项：确认四门学科取舍与"不采纳清单"一并写入裁决）→ A1 色板 token → A2 造型/图标原子 → A3 排版/留白。每期判据沿用 VISUAL-UPGRADE-PLAN §3 评分卡 + ART-DIRECTION §7，观感走 11-20 偏好预审闭环。

**新增人眼判据（艺术修养可检化）**：① 点睛色只有一格且 <5%；② 留白 ≥40%；③ 图标同视角同笔宽；④ 明暗是两种光而非反色；⑤ 一屏只有一处动效。五条都用元素级截图 + 逐条 pass/fail 留痕。

---

## 7. 审美技能底座（用户级 skill · 已落地）

本机 34 个用户级技能中**没有**建筑/影视/绘画专门技能（已列全表核实）；为让这套跨学科修养可复用，已创建用户级技能 `~/.codebuddy/skills/aesthetic-atlas/`（经 skill-creator 脚手架 + `quick_validate.py` 校验 PASS）：
- `SKILL.md`：触发条件 + 6 步工作流 + 7 条硬规则；
- `references/00-map.md`～`09-identity-test.md`：10 份参考覆盖共同语法（格式塔/平衡/层级/节奏）、调和色（Itten 七对比 / OKLCH / 中性着色）、建筑、影视、绘画（谢赫六法原文核实）、艺术史取舍表、音乐/雕塑/戏剧/文学/摄影/字体/工业设计、UI 翻译表、五问身份测试；
- `scripts/audit_harmony.py`：零依赖调色审计（实测宣纸/墨 14.97:1、朱砂/宣纸 4.64:1，<5% 面积预算）。
- 来源：专业知识综合 + 网络权威锚（gestaltprinciples.com / 新华网·文汇报六法 / creativehut 色彩和声 / Northwestern Open Books）；不复制任何参考资产。

## 8. 证据与出处

- 品牌源资产（只读用户资产）：`petri-logo-concepts_assets/{01-system-board,00-palette,v2-colour-directions,FINAL-grid-contact,FINAL-main,final-brand,water-final-frame}.png`
- 设计库：`~/.codebuddy/skills/ui-ux-pro-max/data/{styles,colors,icons,typography}.csv`（检索命令见 §5）
- 既有方案：`acceptance/ui-visual-upgrade-2026-11-20/{VISUAL-UPGRADE-PLAN,ART-DIRECTION}.md`
- canonical：`docs/design-charter.md`、`docs/user-preferences-codification.md`、`resources/design-context/reference-board-review.json`（noGlobalReskin / 只取设计原子）
