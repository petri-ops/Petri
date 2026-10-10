# Gewu Desktop UI / 使用体验评估报告

- **评估日期**：2026-10-10
- **评估范围**：`frontend/src/`（253 个 `.tsx` / 约 36.7k 行，70 个 `.css` / 约 29.6k 行）
- **评估方式**：源码静态审计 + CDP 实机 DOM 探针（对比度逐元素计算、真实 Tab 键遍历、6 档视口合成、暗色主题切换）+ 构建产物分析
- **分支 / 提交**：`main` @ `569ce9d7`
- **性质**：只读评估，未修改任何产品代码（唯一新增只读工具 `scripts/ui-audit-probe.cjs`）

---

## 总体判断

这个项目的设计体系**底子比预期好得多**，不是"UI 很乱"的局面：颜色 token 双主题完整、字号 token 化率 89%、语义化属性投放到位（321 个 `aria-label`）、响应式在 4 条路由 × 6 档视口下**零横向溢出**、动效无一处触发重排。

但存在**三个结构性问题**，它们不是"细节没做好"，而是地基与入口出了故障：

1. **键盘用户几乎无法使用主区**——Tab 键连按 50 次全部困在左栏项目树内，主区聊天输入框完全不可达（P0，实机复现）
2. **间距 token 形同虚设**——定义了 6 档 `--gewu-space-*`，全仓仅 **2 处**引用，裸px 间距 **1718 处**（P1）
3. **Cmd+K 是一个死功能**——快捷键全局劫持了，但命令列表传的是空数组，用户按下必得空面板（P0）

外加一条**零风险高收益**优化：`CommandPalette.tsx:10` 误引入 4312 行聊天 CSS 污染首屏，删一行可让首屏 CSS 从 391KB 降到约 150KB。

---

## 一、视觉与布局

### 1.1 间距：token 体系名存实亡（影响：高）

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `styles/global.css:38-43` | 定义 6 档 `--gewu-space-1..6`（4/6/8/12/16/24px），全仓 `var(--gewu-space-*)` 仅 **2 处**引用；裸 px 间距（padding/margin/gap）**1718 处** | 高 | 这是间距不一致的**根因**。档外高频值：10px×150、5px×102、3px×75、7px×55、14px×52、9px×24。建议先做一轮机械替换：把能对齐到档位的值（10→12、14→16、9→8、7→8）批量归一，剩余零碎值保留但登记清单 |
| `pages/project-workspace.module.css`（7642 行） | 单文件承载全部工作区样式，含 `@media` 断点 20+ 处 | 中 | 拆分建议：按面板（left/center/right）拆为3 个 module，避免任何局部改动都要加载全文 |

### 1.2 层级：z-index 军备竞赛（影响：高）

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `components/ui/Lightbox.css:6`<br>`components/desktop/TitleBar.module.css:341`<br>`components/branch/BranchTabs.module.css:159`<br>`components/auth/LoginModal.css:7`<br>`components/common/ToastProvider.module.css:8`<br>`components/desktop/desktop.css:17` | 散落 **20+ 处** z-index，取值横跨 9998 / 9999 / 10000 / 10001 / 100000，**无语义层级 token**。数值与语义倒挂：Lightbox(100000) > 登录弹窗(10000) > 分支标签(10001) > Toast(9999) > 全屏遮罩(9998) | 高 | Toast 通知被标题栏悬浮层(10001)压住、却又在登录弹窗(10000)之下——**通知在最需要时可能不可见**。建议定义 6 档层级 token：`--z-base/-sticky/-dropdown/-overlay/-modal/-toast`，全部替换 |

### 1.3 配色（影响：中，体系本身达标）

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `styles/custom.css:88-89` | `--gewu-text-muted: #a1a1aa`（亮）on 白 = **2.56:1**；暗色 `#6b7689` on `#111a2e` = **3.78:1**，均低于 4.5:1 | 高 | 见第二节，这是被用作正文色 92 处的系统性问题 |
| `styles/custom.css:220-221` | 暗色 `--gewu-surface-dim` 与 `--gewu-bg-surface` 同为 `#111a2e`，消除双暗底分叉——UI-392 历史问题**已修复** | 已达标 | 无需处理，登记为正面案例 |
| 全仓 CSS | 457 处 hex 颜色，TSX 内 21 处硬编码色；多数走 `var(--gewu-*, fallback)` 模式 | 低 | 模式健康，硬编码量可控 |
| `styles/custom.css` | **色板化执行良好**：主色阶 50–900 + `*-lightest/light/dark` 派生阶共 40+ 变体；状态色（success/warning/error/info/online/loading/offline）、图表系列色、终端 ANSI 色均已成体系 | 已达标 | 建议补一条 token 契约测试，冻结"调色板只增不改" |
| `styles/custom.css` 各强调色（blue/violet/rose/amber） | **色阶塌缩**：每个强调色只有 `--gewu-accent` + `-soft` + `-bg` + `-hover` 4 个派生，而 teal 主色有 40+ 档。同一套组件在非 teal 主题下色阶层次明显不足 | 中 | 为其余 4 个强调色补 `-surface`/`-border`/`-emphasis` 等常用派生，否则暗色模式下 rose/amber 档会因亮度不足而失真 |

### 1.4 排版（影响：低，总体达标）

| 指标 | 数值 | 判定 |
|---|---|---|
| `var(--gewu-font-size-*)` 引用 | **923 处** | 达标 |
| 裸 `font-size: Npx` | **112 处**（12px×46、11px×29、10px×11） | 低优先级收尾 |

字号 token 化率 89%，排版一致性是本项目做得最好的维度之一，不建议夸大成问题。零碎裸值集中在小字号场景（徽标/角标），逐一替换为 `--gewu-font-size-xs/sm` 即可。

### 1.5 设计规范落地（影响：高）

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `components/ui/PageHeader.tsx`<br>`components/ui/WorkbenchEmpty.module.css` | **零引用死组件**——`PageHeader` / `WorkbenchEmpty` 被 0 个文件引用。每个页面各写各的页头与空状态 | 高 | 这是"同类组件各写一套"的直接证据。要么强制推广（改造现有页面接入），要么删除并在 `docs/` 留一条"页头规范"说明，避免后人重复造轮子 |
| `styles/custom.css:1208-1233`（`.run-modal`）、`827-875`（`.navbar`）、`components/auth/LoginModal.css`（341 行）、`components/ui/PageHeader.css` | **约 375 行死 CSS**：这4 处均**零 tsx 消费者**（已逐个核实） | 中 | 死代码会持续误导后人参考错误范式。建议删除，并在 `hygiene:check` 增加"孤立 CSS 文件"检测 |
| **圆角档位无 token** | `--gewu-radius` 引用 **0 处**，实测 **26 种**裸圆角值（3/4/5/6/7/8/9/10/11/12/13/14/16/20/24px…） | 中 | 圆角是"视觉形状语言"的核心，26 种值等于没有形状语言。建议收敛为 5 档：4/6/8/12/999px(胶囊) |
| `styles/global.css:37` | 注释自承"零碎值（3/5/10/14px）保留" | 中 | 这条决策直接导致了 1.1 的 1718 处裸 px。间距与圆角应同批治理 |
| `styles/theme-token-contract.test.ts` | 已有 token 契约测试，但**仅覆盖颜色 token**，未覆盖间距/字号/圆角/z-index | 中 | 把 spacing / radius / z-index 档位一并纳入契约，治理才有防回退护栏 |
| `components/desktop/desktop.css`（2150 行）<br>`components/copilot/simple-chat.css`（4312 行） | 全局 CSS（非 Modules）与 CSS Modules 混用，边界不清 | 中 | 明确规则：全局 CSS 只允许放 token 与 reset，组件样式一律 Modules |

---

## 二、无障碍

### 2.1 键盘可达性 —— P0 缺陷（影响：高）

**实机复现**：CDP 派发真实 Tab 键遍历欢迎页，**连按 50 次全部困在左栏项目树内**（`_projectTreeName` / `_projectTreeAddBtn` 之间循环），主区聊天输入框完全不可达；Shift+Tab 可逆但同样出不去。

**根因**（`pages/project-workspace.module.css:1028-1045`）：

```css
.projectTreeAddBtn { opacity: 0; transition: opacity 0.15s; }
.projectTreeRow:hover .projectTreeAddBtn { opacity: 1; }
```

按钮 `opacity: 0` 仅在父行 **`:hover`** 时显现——键盘聚焦时无 hover，**焦点落在完全不可见的控件上**。这些按钮还普遍无 `aria-label`（CDP 读到的文本为 `[submit]` 空串）。

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `pages/project-workspace.module.css:1039-1045` | hover-only 显形导致键盘焦点不可见 | **高** | 补 `.projectTreeRow:focus-within .projectTreeAddBtn { opacity: 1 }`，一行修复 |
| `components/workspace-panels/LeftPanel.tsx:601-640` | 4 类图标按钮（ssh连接/新建会话/展开会话/加号）无 `aria-label` | 高 | 补 `aria-label="新建会话"` 等 |
| `pages/welcome.module.css` | 整个文件 `grep focus` **返回空**——首屏所有输入框键盘聚焦零反馈 | 中 | 补 `:focus-visible` 样式 |
| `pages/window/CommandCenterJobsWall.tsx:513` | `all: 'unset'` 抹掉焦点环（全仓唯一） | 中 | 改为 `all: unset` + 显式 `outline` 还原 |
| `components/RouteErrorBoundary.tsx` | 两个按钮仅有 `:hover`，无 `:focus-visible` | 中 | 补焦点样式 |

### 2.2 对比度（影响：高）

实测数值（WCAG 2.1 公式逐元素计算，非估算）：

| 前景 / 背景 | 对比度 | 要求 | 判定 |
|---|---|---|---|
| `--gewu-text-muted #a1a1aa` on `#ffffff` | **2.56:1** | 4.5 | **不达标** |
| `--gewu-text-muted #6b7689` on `#111a2e`（暗） | **3.78:1** | 4.5 | **不达标** |
| `--gewu-accent`亮色作文字 | **3.74:1** | 4.5 | **不达标** |
| `--gewu-border` | **1.27:1** | 3（非文本） | **不达标** |
| `--gewu-text-tertiary #71717a` on 白 | 4.83:1 | 4.5 | 达标 |
| 暗色 tertiary `#8b98ad` on `#111a2e` | 5.94:1 | 4.5 | 达标 |

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `styles/custom.css:89`<br>`styles/custom.css:221` | `--gewu-text-muted` 双主题均不达标，却被用作正文色 **92 处**，多为 11px 小字（最坏组合：最低对比 + 最小字号） | 高 | 亮色改`#71717a`（4.83:1），暗色改 `#8b98ad`（5.94:1），一次性解决 92 处 |
| `styles/custom.css` | `--gewu-accent` 作正文文字仅 3.74:1 | 中 | 区分 accent-as-decoration 与 accent-as-text，后者用 `--gewu-accent-strong` |
| `--gewu-border #243149` | 1.27:1，作为输入框/卡片边界远低于 3:1 | 中 | 边框提亮到 3:1，或改用双线（边框 + 背景色差）表达边界 |
| `components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css:103-107` | **全仓最严重的对比度缺陷**：`.drawerError` 文字色 `#ffc8c8`（浅粉）配`rgba(220,80,80,0.18)` 半透明红底，该文件 `data-theme` 出现 **0 次** → 亮色模式下对比度约 **1.45:1**（要求 4.5） | **高** | 错误文字在亮色下几乎不可读，而这是"出错了"的唯一提示。改用 `var(--gewu-status-error-fg)` / `var(--gewu-danger)` 主题变量，背景走 token 化的 `--gewu-danger-bg` |
| `pages/extensions/extensions.module.css:14,340` | 分类 pill hover 态 `color: var(--gewu-text-muted)` 在灰底(`#f4f4f5`)上约 2.46:1 | 中 | 改用 `var(--gewu-text-secondary)`（4.5:1） |

### 2.3 语义化（影响：低，已达标）

| 指标 | 数值 | 判定 |
|---|---|---|
| `aria-label` | 321 处 | 达标 |
| `role="alert"` / `role="status"` | 49 / 28 | 达标 |
| `role="dialog"` / `aria-modal` | 9 / 4 | 达标 |
| `aria-live` | 5 处，含 `ToastProvider.tsx:115` assertive/polite 分流 | 达标 |
| `div` 冒充 button | 仅 6 处，其中 4 处为正确的 overlay 模式 | 达标 |
| 危险操作二次确认 | 14 处 `window.confirm` 覆盖全部破坏性操作，`window.alert` 真实调用 **0 处** | 达标 |

**键盘焦点环本身达标**：真实 Tab 键下浏览器默认 `outline: auto` 正常生效（标题栏按钮 1.93px 蓝环）。缺口在于"部分区域无自定义 `:focus-visible`"，而非"焦点环消失"。

---

## 三、交互反馈与易用性

### 3.1 命令面板是死功能（影响：高）

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `App.tsx:176-181` + `components/copilot/CommandPalette.tsx:389-397` | `useCommandPalette` 全局劫持 `Ctrl/Cmd+K`，但 `App.tsx` 给 `CommandPalette` 传 `commands={[]}` `recentConversations={[]}` → 用户按下快捷键必得一个空面板 | 高 | 二选一：① 接入真实命令表（导航/切换主题/新建任务等）；② **摘掉 Cmd+K 监听**，不要暴露一个无功能的入口 |

### 3.2 加载态与空状态（影响：中）

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| 全仓 | 骨架屏 / Skeleton 组件生产代码 **0 处**（仅测试文件命中）；`EmptyState` 仅 3 处使用 | 中 | 首屏与路由切换目前是纯留白。可参考 `WorkbenchEmpty`（已存在但零引用）建立统一空状态/加载态组件 |
| `App.tsx:62-64` | `RouteFallback` 是刻意留白（注释：「本地加载通常 <1帧，闪一下比空白更扰人」） | 低 | **这是有意识的合理决策**，不建议改。但长耗时场景（工作区首载）仍需骨架 |
| `components/copilot/copilotClient/agentTaskApi.ts:57,86,114,136` 等 18 处 | 空 `catch {}` / `.catch(() => {})` 静默吞错 | 中 | 多数是"取消任务"语义可接受，但应加注释标明为何吞；否则用户看到"操作没反应"却无提示 |

### 3.3 信息架构（影响：低，整体清晰）

一级导航经 BLOCK-156 收敛后已相当克制：扩展中心四货架单入口、旧 `/plugins` `/skills` 深链重定向保底、`/settings` 设备级独立页。术语统一（"任务"统一指会话，"包"统一指领域包）。此项**无重大问题**。

### 3.4 触控目标（影响：低）

50 处可点击元素小于 24×24px，典型为 `_projectTreeAddBtn`（20×20）、`_iconBtn`。桌面端指针操作影响有限，但投影到手机端（BLOCK-87 L3 形态）时会失效，建议投影形态下提升至 44×44。

---

## 四、响应式与多尺寸适配（影响：低，已达标）

实机合成 6 档视口 × 4 条路由：

| 视口 | `/` | `/projects` | `/extensions` | `/settings` |
|---|---|---|---|---|
| 1920×1080 | 无溢出 | 无溢出 | 无溢出 | 无溢出 |
| 1440×900 | 无溢出 | 无溢出 | 无溢出 | 无溢出 |
| 1180×800 | 无溢出 | 无溢出 | 无溢出 | 无溢出 |
| 1024×768 | 无溢出 | 无溢出 | 无溢出 | 无溢出 |
| 860×720 | 无溢出 | 无溢出 | 无溢出 | 无溢出 |
| 700×600 | 无溢出 | 无溢出 | 无溢出 | **溢出** |

唯一失效点：

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `components/desktop/desktop.css:297-304` | `.gewu-settings-nav` 固定 `width: 176px` 且 `flex-shrink: 0`，700px 窄窗下主内容区被挤至负宽，实测右侧导航项 `right=673` 溢出视口 | 中 | 加 `@media (max-width: 820px)` 收窄为 56px 图标栏，或改为顶部横向 tab |

UI-479「侧栏自适应收起」已处理侧栏随列宽/视口折叠（阈值 140/560/640，带迟滞与手动优先），机制设计扎实。

---

## 五、性能感知（影响：中）

| 文件:行号 | 问题 | 影响 | 改进建议 |
|---|---|---|---|
| `components/copilot/CommandPalette.tsx:10` | `import './simple-chat.css'` 是**纯副作用误引入**——该组件全部使用 `cp-` 前缀类名、零 `sc-` 使用，却把 4312 行聊天 CSS 注入主 chunk | **高**（零风险高收益） | 删这一行。首屏 CSS 从 391KB → 约 150KB |
| `pages/welcome.tsx:10` | 静态引入 `SimpleChat`（首屏直包），导致聊天 CSS 无法被路由分割裁剪 | 中 | 该CSS 污染的根因。配合上一条修复；若 SimpleChat 首屏确需展示，改为只抽输入区组件 |
| 构建产物 | 主 chunk `index.js` 422KB（gzip **128KB**）；最大异步 chunk `pdf.worker.min.mjs` **1.34MB**、`exceljs.min.js` **908KB** | 低 | pdf/exceljs 已是异步 chunk，未进首屏，**处理正确**。但建议 pdf.worker 确认按需加载而非随结果页预取 |
| 全仓 | 长列表零虚拟化——`react-window`/`react-virtual` 使用 **0 处**；`LeftPanel.tsx:437` 直接 `.map()` 全量渲染项目树 | 中 | 项目数/会话数上三位数后左栏会卡。建议对 `LeftPanel` 项目树与 `RightFileTree`（1029 行）上虚拟滚动 |
| `pages/project-workspace.module.css`（7642 行） | 巨型 CSS 随工作区 chunk 一次性加载 | 低 | 随 1.1 拆分建议一并处理 |

**动效流畅度：本机无法实测**。环境事实：`prefers-reduced-motion: reduce` 为 `true`，全局兜底（`global.css:199-218`）把全仓 219 个元素的 `transition-duration` 压到 `1e-06s`。这属**环境导致不可测**，非代码缺陷。

不过静态代码层面动效质量**优秀**：

| 指标 | 数值 | 判定 |
|---|---|---|
| `@keyframes` 含布局属性（触发重排） | 47 个中 **0 个** | 达标 |
| `will-change` 使用 | 仅 2 处，用途正当（scroll-position、进度条宽度） | 达标，无滥用 |
| reduced-motion 兜底 | `global.css:199-218`，并用 `[data-gewu-motion='functional']`（权重 0,1,0 > `*` 0,0,0）豁免功能性过渡 | 达标 |

---

## Top 8 优先修复清单

| # | 优先级 | 问题 | 位置 | 收益 |
|---|---|---|---|---|
| 1 | **P0** | 删 `import './simple-chat.css'` | `CommandPalette.tsx:10` | 首屏 CSS 391KB→150KB，零风险 |
| 2 | **P0** | `.drawerError` 亮色下对比度 1.45:1，错误提示几乎不可读且无暗色适配 | `CodeReviewDrawer.module.css:103-107` | 错误信息可读性，改用状态色 token |
| 3 | **P0** | hover-only 显形导致键盘焦点不可见 + Tab 困陷左栏 | `project-workspace.module.css:1039-1045` | 一行 CSS 修复键盘可达性 |
| 4 | **P0** | `--gewu-text-muted` 对比度 2.56/3.78 不达标，用作正文 92 处 | `custom.css:89,221` | 一次改色解决 92 处可读性 |
| 5 | **P1** | Cmd+K 死功能（传空数组） | `App.tsx:176-181` | 消除无效入口 |
| 6 | **P1** | z-index 军备竞赛，语义与数值倒挂（20+ 处，0 档位token） | 全仓 | 定义 6 档层级 token |
| 7 | **P1** | 间距 token 零引用（2/1718）+ 圆角 26 种裸值无 token | `global.css:38-43` | 间距/形状语言一致性根因 |
| 8 | **P2** | 约 375 行死 CSS（run-modal / navbar / LoginModal / PageHeader 零消费者）+ 零引用死组件 | `custom.css:1208` 等 | 消除错误范式误导 |
| 9 | **P2** | 长列表零虚拟化 | `LeftPanel.tsx:437`、`RightFileTree` | 规模上来前的性能护栏 |

---

## 已达标项（附证据，避免重复排查）

- **响应式**：4 路由 × 6 档视口零横向溢出，仅 `/settings` 在 700px 单点失效
- **语义化**：321 `aria-label`、49 `role=alert`、9 `role=dialog`、`aria-live` 含 assertive/polite 分流
- **焦点环**：真实 Tab 键下 UA 默认 outline 正常生效
- **危险操作**：14 处 confirm 覆盖全部破坏性操作，`window.alert` 真实调用 0 处
- **路由分割**：BLOCK-106 已做（主 chunk 从 3,061,221 B 降至 422KB）
- **动效**：47 个 keyframes 零布局属性，`will-change` 无滥用
- **reduced-motion**：全局兜底教科书级，含功能性豁免
- **色彩 token**：双主题语义色完整，主色阶 50–900 + 派生阶 40+ 变体，暗色双底分叉（UI-392）已修复
- **字号 token**：使用率 89%
- **动效**：47 个 keyframes 零布局属性，`will-change` 无滥用

---

## 方法论说明

1. **不做静态推断**。对比度、焦点环、层级遮挡、响应式溢出四类结论全部经 CDP 实机计算/遍历得出。首轮"焦点环全部缺失"的结论经真实 `Input.dispatchKeyEvent` 复验后**被推翻**（编程式 `el.focus()` 读不到 `:focus-visible`），已修正为"焦点环达标，局部缺自定义样式"。
2. **性能数据读构建产物**，不按源码行数推算——这才能定位到 `CommandPalette` 误引 CSS 这条真实的首屏污染链路。
3. **量化优先**：凡能给数字的不给形容词（间距 1718 处、z-index 20+ 处、对比度 92 处使用、`aria-label` 321 处）。
4. **区分事实与环境**：本机 `prefers-reduced-motion: reduce` 导致动效不可测，报告中明确标注为环境限制而非代码缺陷。