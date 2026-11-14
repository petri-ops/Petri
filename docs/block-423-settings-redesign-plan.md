---
capability: block-423-settings-redesign
status: completed
goal: 参照 reference/ZCode 的设置页规范重建本仓设置页视觉语言——独立工作区、分组侧栏、中等阅读列、卡片化分组、统一控件，让它不再"业余"。
acceptance:
  - 左栏 264px 分组导航（窄屏 208px → 60px 图标栏），带分组标题与当前分区说明
  - 右栏正文最大 760px 居中，控件不再横跨全屏
  - 设置分组卡片化（bg-elevated + border-card + radius-lg + shadow-sm），组内用分隔线不嵌套卡片
  - 控件统一走 token（字号/时长/边框三语义），checkbox 走 accent
  - 所有门禁绿；`theme-token-contract` 19/19；零新增依赖、零放宽基线
---

# BLOCK-423 · 设置页视觉改版（参照 ZCode）

> **裁决**：用户 2026-11-11「可以的 开整吧」+「目前 petri 设置页面没有质感，看上去业余。你看看 reference 中的 ZCode 的源码来尽量的模仿，适当调整内容」。
> **形态边界**：只移植**布局与层级语言**（分栏/阅读列/卡片/控件语义），配色、字号档位、圆角、阴影全部落在本仓既有 token 体系内，不照搬 ZCode 的 tailwind 类名与色板；设置项内容与分区结构保持 Petri 自己的语义（`适当调整内容`）。

## 1. 参照与移植对照

| ZCode 规范（`reference/ZCode/docs/ui/settings-*.md`） | 本仓落地 |
| --- | --- |
| 外层 `bg-background + border-border` 独立工作区 | `[role='dialog'][aria-label='设置']` 加 `bg-subtle + border-card + radius-lg`，与主窗内容分层 |
| 左栏 264px（`lg` 以上）、低于 `lg` 收 64px 图标栏 | 264px；≤960 收 208px；≤700 收 60px 图标栏（`title` 暴露标题，隐藏分组标题与脚注） |
| 左栏承载返回 + 分组导航 + 当前分组说明 | 新增「应用 / 能力与模型 / 智能决策 / 系统」四个展示分组 + 底部「当前：X · 描述」 |
| 右侧正文收敛到中等阅读列 | `.petri-settings-content > *` 限 760px 居中（≤700 放开） |
| 设置项卡片 `bg-card + border-border` | `.petri-settings-section` = `bg-elevated + border-card + radius-lg + shadow-sm` |
| 表单不叠第二层卡片，用内边距与分隔线 | `.petri-field` 用 `padding + border-bottom(divider)`，末行无分隔线 |
| 控件走语义 token | 输入/选择/多行统一 `min-height:32px + border-input + radius-md`；`focus-visible` 用 accent 环；checkbox `accent-color` |

## 2. 非范围

- 不改分区 id / 路由深链 / 设置值读写与持久化（纯展示层）。
- 不改插件商店面板（共用 `.petri-desktop-panel`，用设置专属作用域隔离）。
- 不新增断点档位、不新增 plain CSS 文件、不新增依赖。

## 3. 实现要点（三条被门禁抓真后修正的地方）

1. **plain CSS 不允许新增** → 文件落 `settings-redesign.module.css`，用 `:global()` 精确指向既有 `petri-*` 类名（类名体系由 desktop.css + 1253 行面板 + 11 个分区子组件共用，整体改名属独立重构；先把视觉语言收进 CSS Modules 管道）。
2. **新增断点即红** → 初版用了 1100/880，撞「断点档数收敛」棘轮；改为既有 `960 / 700` 两档复用，零新增档位。
3. **token 契约抓出 5 类"业余"写法**（这正是问题根源）：
   - 11 处裸 `px` 字号 → 全部改 `var(--petri-font-size-*)`；
   - 2 处 `transition: …120ms` 字面量 → `var(--petri-duration-fast)`；
   - 结构性 `1px solid var(--petri-border)` → 只允许 `border-input / border-card / divider` 三语义 token；
   - 引用未定义 token `--petri-accent-text` → 改 `--petri-text`；
   - 6 处元信息小字 + 3 处 accent 交互态 → 按宪章语义域**逐文件登记**（对标 `button.module.css` / `AnnotationStatus` 先例），不是放宽：门的设计就是白名单外即红。

## 4. 证据

`acceptance/ui-design-assessment-2026-11-11/settings-redesign/`：`settings-before.png`（改前）、`settings-after4.png`（改后）、`gate-readout.json`。
实机读数：1600×1000、CDP 9223 离屏、跑完立即 kill、未设 `PETRI_TEST_ONSCREEN`。

## 5. 顺带修掉的真实配置缺陷

`reference/`（本地第三方源码镜像，已在 `.gitignore:118` 排除、未入仓）此前被 ESLint 纳入扫描，产生 **560+ 项本仓不该承担的违规**。按同类先例（`codex/**`、`_external-ref/**`、`openclaw/**`）补 `reference/**` 到 `eslint.config.mjs` ignores —— 属扫描范围修正，不是放宽基线（第三方参考代码不属本项目代码面）。

## 6. 完成语义

改版完成且全门绿 ⇒ `completed`；**观感本身 `pending_human_eye`**，等你验收签字，不写 verified。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 第二版修正（用户反馈：割裂 / 主题色不一致 / 线条太多）

首版按 ZCode 的**布局结构**移植，但违反了它同一份 DESIGN.md §Color Usage Rules 的三条硬规则，导致用户看到的「割裂」：

| ZCode 原文规则 | 首版怎么犯的 | 第二版怎么改 |
| --- | --- | --- |
| *Prefer text hierarchy to create information density before adding more borders or colors.* | 用卡片边框 + 字段分隔线 + 导航右边框分层（10+ 条线） | 全页只留**顶栏底边 1 条线**；分组靠 34px 间距 + 16px 标题，字段靠 16px 行距 |
| *Never mix bg-background / bg-card / bg-surface without a clear layering reason.* | 底 subtle + 卡片 elevated + 控件 surface 三层色阶叠在一起 | 降到**两层**：页面底 canvas + 左侧栏 subtle；section 无背景无边框直接铺底 |
| *Keep brand color usage sparse and intentional.* | accent 用在图标彩底 / 选中左色条 / checkbox / 焦点环 4 类位置 | 收到**2 类**：选中态淡底（`--petri-accent-bg`）+ checkbox 与焦点（`--petri-accent`）；图标回归中性色、去掉左色条 |

**量化对照（同一文件同一次读数）**：`1px solid` 3 处（顶栏 1 + 输入控件 2）、`border-bottom` 4 处（其中 3 条在媒体查询内的同一条规则）、裸 px 字号 0、accent 精确引用 2 处。

证据：`settings-v2.png`（去线条后）、`settings-v3.png`（层级微调后）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. 第三版修正（用户反馈：搜索框优化 / 内容区上下边界 / 内容居中）

**实测定位到两个硬 bug + 一处规范不符**：

| 问题 | 当次读数 / 证据 | 修正 |
| --- | --- | --- |
| 内容不居中 | `sectionCenter=652` vs `contentInnerCenter=924`，**偏左 272px** | 上一版把 `desktop.css` 的 `margin: 0 auto` 覆盖成 `margin: 0 0 32px`，auto 丢失；恢复 `margin: 0 auto 32px` 后 `sectionCenter=920`（余差来自 15px 滚动条） |
| 搜索框位置违反 ZCode 规范 | 原本在 layout 之外的全宽工具条，顶栏被撑高、左栏上方留空 | 按 `settings-sidebar-layout.md`「设置导航顶部提供搜索设置」把 `SettingsToolbar` 移入新增 `.petri-settings-sidebar`，与分组导航同列；右栏因此拿到完整上下边界 |
| 搜索框体质弱 | 整行长条 + 右侧「10 个分区」挤占输入宽度 | 铺满左栏、34px 高、圆角、内联放大镜 SVG、hover 淡底、focus 主题色描边；左栏加宽到 **264px**（ZCode 规范值）容纳完整占位文案；「N 个分区」收起（当前分区说明已由脚注承担） |

**上下边界的表达方式（不加线）**：上 = 顶栏分隔线 + 24px 顶部留白；下 = 64px 收口留白；水平方向 = 720px 阅读列居中。全页线条仍只有顶栏 1 条。

**结构改动代价**：`DesktopSettingsPanel.tsx` 675→672 行、33719→33616 字节（删冗余历史注释配平，锚点下降后重打）。
**测试**：设置面板 + token 契约 **107/107**；`gate:ui-program` 6/6、`css-modules` / `ui-breakpoints` / `code-size` PASS、`lint:ledger` 仅剩并发写入者 W 文件。

证据：`settings-v6.png`（搜索归位）、`settings-v7.png`（左栏 264 + 计数收起）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. 第四版修正（用户反馈：显得不和谐、像多了一层）

**诊断**：左栏整块浅灰从顶栏下方单独起一层——上边与白底顶栏形成硬切边、右边与白底内容区形成色差，合成一条 **L 形灰带**，就是"多了一层"的来源。这是「先减线、又用色块分区」的补偿性错误。

**修正**：
- 左栏背景 `subtle → canvas`，与顶栏、内容区同底，L 形灰带消失；
- 搜索框从「浅灰无边框色块」改为「白底 + `border-input` 描边」，成为唯一的控件级边界；
- 分区感改由**分组标题 + 间距 + 选中项淡底**表达（`--petri-accent-bg`），不靠色块。

**改后分层（实测）**：页面底 / 左栏 / 内容区同为 `canvas`；线条只剩顶栏底边 1 条 + 控件自身边框。

证据：`settings-v8.png`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 10. 第五版修正（用户：边框是不是不应该包住导航）

**ZCode 源码证据**（`packages/ui/src/SettingsPage.tsx`）：
- `:1493` 最外层是 `grid grid-cols-[268px_minmax(0,1fr)]`，**无边框、无圆角**；
- `:1514` 左栏 `<aside>` **无边框、无圆角、背景透明**；
- `:1697-1699` 只有右侧内容区是 `border border-border bg-background` + `rounded-xl` 的**独立卡片**。

**我错在**：面板级 `border-radius + overflow: hidden` 把左栏和内容区一起包住，形成"边框包导航"。另外 `desktop.css:277` 遗留 `width: 176px` 是显式宽度，`flex: 1` 覆盖不了，左栏实际只占 176px。

**修正**：
1. 面板去掉圆角与边框；边框只给内容区卡片（`1px solid var(--petri-divider)` + `radius-lg` + 右/下 14px 留白），与 ZCode 结构一致；
2. header 去掉底边（边界交给内容卡片）；
3. 左栏 `.petri-settings-nav` 显式 `width: 100%` 归位到 264px；
4. 内容卡片边框色从 `--petri-border-card`（64% 透明，几乎不可见）改为 `--petri-divider`。

**改后实测**：panel 0–1600 无边框；sidebar 0–264 无边框；content 264–1586 为卡片；nav 宽 264。

证据：`settings-v9.png`（边框只包内容）、`settings-v10.png`（边框加深）、`settings-v11.png`（左栏归位 264）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 11. 第六版修正（置顶 + 外部导入面板）

**① 右侧内容区没有置顶**：内容滚动时分区标题随正文一起滚走，顶部直接露出半截文字。
改为 `position: sticky; top: -1px`（`z-index: var(--petri-z-sticky)`，背景 `canvas`）——滚动时分区标题与描述吸顶，与 ZCode 卡片内固定 header 行（`SettingsPage.tsx:1723` `h-12 shrink-0`）同义。裸 `z-index: 2` 撞了主题门的 z 棘轮，已改 token。

**② 从外部 Agent 导入配置**：`data-external-import-panel` 在**全仓没有任何 CSS**——`textarea` 是浏览器默认尺寸（约 180×100）、`fieldset` 带原生边框、radio 是裸控件；连 `petr-hint` 类名都是未定义的（疑为 `petri-hint` 笔误）。补齐：
- 配置来源的两项做成**可点选卡片**（154×37，选中项 accent 描边 + accent 淡底）；
- 配置内容 `width: 100%`、`min-height: 132px`（实测 720×132）、等宽字体、可纵向拉伸；
- 标题/说明按设置页层级（body 600 / sm tertiary）。

**棘轮登记更新（合法语义域，非放宽）**：小字 6→8（导入面板元信息 + 等宽内容）、accent 3→4（选中卡片描边）。

证据：`settings-v12.png`（标题吸顶）、`settings-import.png`（导入面板）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 12. 第七版修正（内容区边框其实"看不见"）

**核对结论**：边框在 DOM 里一直在（`1px` + `radius 8px` + 位置 264–1586），但颜色取错了 token 层级：

| token | 实际值 | 白底上等效 | 可用性 |
| --- | --- | --- | --- |
| `--petri-border` | `#e4e4e7` | 可见 | **不在 1px 门禁白名单** |
| `--petri-border-input` | `#d4d4d8`（`border-strong`） | 可见 | ✅ 白名单内 |
| `--petri-border-card` | `border 64% 透明` | ≈`#f5f5f6` | 几乎不可见 |
| `--petri-divider`（我原用） | `border 55% 透明` | ≈`#f2f2f3` | **肉眼等于没有** |

**修正**：改 `1px solid var(--petri-border-input)`；同时把卡片留白改成 `margin: 14px 14px 14px 0`（原顶部 0、左右 14px 不对称），四周边界一致。

**实测**：content `x=264 y=110 w=1322 h=876`、`border 1px rgb(212,212,216)`、`radius 8px`。

证据：`settings-v13.png`（换色后）、`settings-v14.png`（补顶部间隙）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 13. 第八版修正（分区标题与「设置」齐平）

**问题**：顶栏（返回 + 设置）是全宽占位块，把右侧内容整块压下去 60px，导致分区标题「常规」比「设置」低一截。

**结构修正（纯 CSS，零 DOM 改动）**：顶栏改为 `position: absolute; top:0; left:0; width:264px; height:60px`，收进左栏上方——与 ZCode `SettingsPage.tsx:1514` 把返回按钮放在 `aside` 顶部同构。左栏用 `padding-top: 60px` 让位；内容卡片改为从面板顶开始（`margin-top: 8px`，`padding-top: 16px`）。

**副标题处理**：264px 内放不下图标章与副标题，用 CSS 隐藏（`display: none`），副标题信息由右侧分区标题的说明行承担，不丢信息。

**实测**：`settingsTitleY=59`、`sectionHeadingY=62`，差 **3px**；`contentTop=46`。

证据：`settings-v15.png`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 14. 第九版（去掉冗余的「齿轮 + 设置」标题）

**判断**：已经在设置页内、左栏分区名就是当前位置、右侧卡片已有分区标题——顶部再放「齿轮 + 设置」是重复的身份块。ZCode `SettingsPage.tsx:1514` 的 `aside` 顶部同样只放返回按钮。

**改动**：隐藏 `.petri-desktop-panel__icon` 与 `.petri-desktop-panel__titles`（dialog 自带 `aria-label="设置"`，页面语义不丢）；顶栏 60→56px、`padding 14→12`、返回按钮 `justify-content: flex-start`。

**一次真实的自纠**：首改后齿轮仍在——同文件后段残留 `.petri-desktop-panel__icon { display: inline-flex }`，同特异性、后出现，把前面的 `display: none` 覆盖了。删掉这段死规则后实测三项分别为 `backBtn=flex / icon=none / titles=none`。

证据：`settings-v17.png`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 15. 第十版（取消标题悬浮 + 返回按钮统一）

**根因**：上一版为解决"标题不吸顶"给 `.petri-settings-section__heading` 加了 `position: sticky`。sticky 是**浮层**——滚动到一定位置就压住下方字段，实拍里「外观主题」这个 label 被标题盖住，就是用户看到的"标题悬浮、不合理"。**这是我上一版引入的新问题，不是原有缺陷。**

**修正**：
1. 分区标题改回 `position: static`，回到文档流；分区信息由卡片顶部位置与左栏脚注承担，不靠吸顶重复。
2. 返回按钮统一：`min-width: 104px`、`height: 36px`、`padding: 0 14px 0 12px`、`gap: 10px`，图标 `18×18` 并与左栏导航项同列起点；补 hover 反馈。

**实测**：`headingPosition=static`、`headingBottom=100`、首个字段 label `top=120`、`overlap=false`；`backBtnWidth=104`、`backIconWidth=18`。

**代价与替代方案**：标题不再吸顶（滚动随内容滚走）。若确实需要常驻标题，应在卡片内做独立的**非滚动头**（DOM 改动），而不是给 section 标题上 sticky——sticky 必然遮挡。

证据：`settings-v18.png`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 16. 信息架构核对（用户：左栏不够紧凑 / 内容少 / 大量内容用户不需要）

### 16.1 实机盘点（不凭印象）

用 CDP **逐分区点击**读取（不能用 pushState 改 URL——`useSearchParams` 不响应，首版盘点因此全部读到 general，已废弃不复用）：

| 分区 | 体量 | 判定 |
| --- | --- | --- |
| 决策原语 | **29 输入 / 118 下拉 / 9152 字符** | 开发者向 → 高级 |
| 运行时与诊断 | 8846 字符 | 纯诊断 → 高级 |
| 计算与数据 | 12 输入 / 1430 字符，6 件事挤一处（SSH·数据目录·环境包·代理·联网·回收站） | 分类过粗 → 拆分 |
| 常规 | 12 项 / 505 字符，外观 4 + 桌面行为 3 + 外部导入 混住 | 分类过粗 → 拆分 |
| 实验特性 | 5 开关 | 未定型 → 高级 |

**结论**：左栏"空"不是内容少，而是**分类粒度太粗 + 高级内容全暴露**——两个问题同时存在。

### 16.2 改动

**拆分**（3 个新分区）：
- `appearance` 外观 ← 常规的主题 / 字号 / 主题色 / 动效
- `desktop` 通知与桌面 ← 常规的系统通知 / 关闭到托盘 / 免打扰
- `network` 联网与代理 ← 计算与数据的代理与自签 CA / 联网检索授权

**收敛**：`general` 收窄为「配置迁移」（只剩外部 Agent 导入）；默认落点 `general → appearance`。

**分层**（`tier` 字段）：core 9 项常驻、advanced 4 项（决策原语 / 推理档位 / 实验特性 / 运行时与诊断）收进左栏「▸ 高级 4」折叠组，默认收起；深链或搜索命中高级分区时自动展开，避免"点了没反应"。

**代码拆分**（被 `code-size` 只减约束逼出的正确形态）：外观 DOM 外迁为 `sections/AppearanceSection.tsx`，通知与桌面为 `DesktopSection.tsx`，联网与代理为 `NetworkSection.tsx`。面板 **672→621 行 / 33616→31221 字节**（净减，未放宽任何基线）。

### 16.3 同步的三处真相

1. `types.ts` 的 `SETTINGS_SECTIONS` 加 `tier` + 13 项重排；
2. `settingsSearch.ts` 索引逐项跟随（`settingsSearch.test.ts` 双向钉，8/8）；
3. `block201-settings-baseline.test.mjs` 的分区清单冻结 **10→13**，按项目惯例在断言处写明重打理由（分区粒度变更，不是放宽）。

### 16.4 实测

- 折叠态：**9 项**（外观 / 通知与桌面 / 模型接口 / 联网与代理 / 计算与数据 / 用量与资源 / 快捷键 / 配置迁移 / 隐私与维护）
- 展开态：**13 项**
- 密度：项内 padding 8→6、`line-height` 1.4→1.3、组间距 14→12
- 测试 115/115、`gate:ui-program` 6/6、`code-size` 锚点下降重打

证据：`settings-ia1.png`（新 IA）、`settings-ia2.png`（压紧密度）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 17. 第十一版（返回按钮与搜索框同宽）

**问题**：返回按钮用 `min-width: 104px` 由内容撑开，与下方 240px 的搜索框宽度不一致，左栏顶部看起来缺一块。

**修正**：`width: 100%` + `justify-content: flex-start` + `padding: 0 12px`，与搜索框同宽同起点。

**实测**：`backBtn { x: 12, w: 240 }` / `search { x: 12, w: 240 }` ⇒ `aligned: true`。

**底色来源**：沿用 `global-page.module.css` 的 `.backBtn` 原生 `background: var(--petri-surface)` + `border: 1px solid var(--petri-border-card)`，未新增任何颜色——所以它和搜索框、输入框属于同一控件族。

证据：`settings-v20.png`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 18. 第十二版（分区图标逐一适配，消除重复）

**根因**：`types.ts` 把 `icon` 类型限死成 5 个字面量 `'settings' | 'brain' | 'cpu' | 'wrench' | 'flag'`。13 个分区只能循环复用，于是出现：

- 齿轮 ×3：外观 / 通知与桌面 / 快捷键
- 方块网格 ×3：联网与代理 / 计算与数据 / 用量与资源
- 扳手 ×2：配置迁移 / 隐私与维护

**修正**：类型改为 Icon 组件已导出的 `IconName`（支持 58+ 图标），13 个分区各配一个语义贴切的图标：

| 分区 | 图标 | 分区 | 图标 |
| --- | --- | --- | --- |
| 外观 | `sun` | 配置迁移 | `download` |
| 通知与桌面 | `bell` | 隐私与维护 | `shield` |
| 模型接口 | `bot` | 决策原语 | `zap` |
| 联网与代理 | `globe` | 推理档位 | `brain` |
| 计算与数据 | `database` | 实验特性 | `sparkles` |
| 用量与资源 | `bar-chart` | 运行时与诊断 | `terminal` |
| 快捷键 | `key` | | |

**13 个 icon 名互不相同**，类型由 `IconName` 保证不会写错拼写。

**测试**：115/115、`block201` 基线 4/4、`gate:ui-program` 6/6、`code-size` / `types` PASS。

证据：`settings-v21.png`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 19. 设置项排版重构（BLOCK-425 第一批）

**用户要求**：每项重新设计排版——减少大段文字、说明精简、明确功能名与用途、图标与文字并存、参考 ZCode「简洁不冗余、层级清晰」。

### 19.1 建立统一模式

新增 `DesktopSettingsPanel/SettingsField.tsx`：**左侧语义图标 + 名称（右侧可挂当前值）+ 控件 + 一句说明**。两种模式：

- 默认：控件在名称下方（选择 / 输入类）
- `trailing`：控件贴右侧与名称同行（开关 / 按钮类）

参照 `reference/ZCode/docs/ui/settings-form-layout.md` 的信息密度原则。

### 19.2 第一批：11 个设置项（3 个高频分区）

| 分区 | 项数 | 图标 | 典型文案压缩 |
| --- | --- | --- | --- |
| 外观 | 4 | sun / list-details / sparkles / zap | 「调整应用界面的文字大小（100% = 默认；80%–140%），图标和布局尺寸不受影响。」→「只改文字大小（80–140%），不改动布局与图标」 |
| 通知与桌面 | 3 | bell / panel-bottom / moon | 「关闭后后端与正在运行的工具继续执行；从托盘菜单可以真正退出。」→「后台继续运行，从托盘菜单可真正退出」 |
| 隐私与维护 | 4 | shield / refresh / download | 「开启后，分析出错时仅上报错误分类与应用版本（不含任何用户数据、文件路径或文件名），用于改进工具稳定性。可随时关闭。」→「仅上报错误分类与应用版本，不含用户数据、文件路径或文件名」 |

最长说明从 **56 字压到约 30 字**，全部一行内可读完。

### 19.3 剩余分区的真实障碍（不粉饰）

设置页存在 **3 套字段样式体系**，统一需分批：

1. `petri-field`（面板内联 + 外观/桌面/维护）——**已统一**
2. CSS Module 自有 `styles.field`（NetworkProxyPanel / WebAccessPanel / RemoteTargets 等）
3. 特殊信息形态（用量统计卡、快捷键键位表）

| 剩余分区 | 障碍 |
| --- | --- |
| 模型接口 | 298 行 DOM + 19 输入 / 8 下拉，改动会碰渠道/凭据编辑流程 |
| 联网与代理 | 两个面板用自有 `styles.field` |
| 计算与数据 | 4 个子组件各自样式 |
| 用量与资源 / 快捷键 | 统计卡与键位表，行式字段不适用，需各自信息设计 |
| 高级 4 项 | 决策原语 29 输入 / 118 下拉，建议独立成「开发者选项」二级页而非逐项美化 |

**测试**：115/115、`block201` 4/4、`gate:ui-program` 6/6、`code-size` / `css-modules` / `types` PASS。

证据：`settings-v22.png`（外观）、`settings-desktop.png`（通知与桌面）、`settings-maintenance.png`（隐私与维护）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
