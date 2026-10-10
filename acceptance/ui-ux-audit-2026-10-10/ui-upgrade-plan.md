# Gewu Desktop UI 升级方案

- **基线**：`acceptance/ui-ux-audit-2026-10-10/ui-ux-audit-report.md`（2026-10-10 审计，9 条 P0/P1）
- **分支 / 提交**：`main` @ `569ce9d7`
- **性质**：方案文档，尚未实施。落地需逐阶段走 closeout 门禁

---

## 升级总纲

审计暴露的不是"若干处没做好"，而是**四个维度各自缺一个"单一真源"**：

| 维度 | 现状 | 缺什么 | 升级主线 |
|---|---|---|---|
| 布局 | 间距 token 引用率 0.1%，圆角 26 种裸值，z-index 20+ 处散落 | **档位 token + lint 棘轮** | 建档位 → 机械归并 → 门禁防回潮 |
| 字体 | 字号 token 化 89%，但 112 处裸值**不响应 `--gewu-font-scale`** | **缩放闭环** | 裸值清零，让"界面字号"真生效 |
| 配色 | 主色阶 40+ 变体完整，但 `--gewu-text-muted` 2.56:1、24 个 token 明暗未配对 | **对比度契约** | 修色值 + 补配对 + 门禁 |
| 性能 | 路由分割已做（BLOCK-106），但首屏 CSS 391KB、零虚拟化 | **首屏瘦身 + 列表窗口化** | 砍首屏 + 治长列表 |

**一条贯穿原则**：所有治理都用**门禁（lint/test）棘轮**收口，而不是靠人肉自觉。没有棘轮的治理必然回潮——现有 `theme-token-contract.test.ts` 4 条断言是这个项目已经验证过的有效范式，直接扩展它。

---

## 阶段一：零风险速赢（0.5 天）

这一阶段的每一条都不改变视觉表现，或只改单点值，可独立提交、独立回滚。

### 1.1 首屏 CSS 瘦身（性能，最大杠杆）

**问题**：`CommandPalette.tsx:10` 的 `import './simple-chat.css'` 是纯副作用。已核实：该组件 17 个类名**全部** `cp-` 前缀，`sc-` 引用 **0 处**。

```diff
  import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
- import './simple-chat.css';
```

**预期**：首屏 CSS 391KB → 约 150KB。**验证**：`vite build` 后对比 `dist/assets/index-*.css` 体积；实机打开 `/extensions` 与 `/` 用 CDP `document.styleSheets` 确认 `cp-*` 规则仍在（防误删）。

**根因治理**：`welcome.tsx:10` 静态引入 `SimpleChat`，而 `App.tsx:28` 唯独把欢迎页直包（首屏优化刻意保留）。若后续要彻底隔离，把 `welcome.tsx:567` 的 `<SimpleChat composerOnly>` 抽成 `React.lazy` 子组件。**本阶段不做**（改动面大，等阶段四）。

### 1.2 对比度速修（配色，4 处改色解决 92+ 处）

| 改动 | 前 | 后 | 影响面 |
|---|---|---|---|
| `--gewu-text-muted`（亮） | `#a1a1aa` (2.56:1) | `#71717a` (**4.83:1**) | 92 处正文色 |
| `--gewu-text-muted`（暗） | `#6b7689` (3.78:1) | `#8b98ad` (**5.94:1**) | 同上 |
| `.drawerError` 文字 | `#ffc8c8` (亮色 1.45:1) | `var(--gewu-danger)` | `CodeReviewDrawer.module.css:107` |
| 分类 pill hover 文字 | `--gewu-text-muted` | `--gewu-text-secondary` | `extensions.module.css:14,340` |

**注意**：暗色 `--gewu-text-muted` 改后与 `--gewu-text-tertiary` **同值**（都是 `#8b98ad`），语义上"最弱文字"和"弱化文字"不再有梯度。建议同时把 `--gewu-text-muted` **重命名为 `--gewu-text-disabled`**（BREAKING，需同步 92 处引用），强制调用方区分"禁用态"与"弱化正文"。若不想动 92 处，先只改色值，重命名留到阶段三。

### 1.3 键盘可达性（无障碍，2 行 CSS + 若干 aria-label）

```diff
  /* project-workspace.module.css */
  .projectTreeRow:hover .projectTreeAddBtn { opacity: 1; }
+ .projectTreeRow:focus-within .projectTreeAddBtn { opacity: 1; }
```

同时给 `LeftPanel.tsx:601-640` 的 4 类图标按钮补 `aria-label`（ssh连接/新建会话/展开会话/加号）。**验证**：复跑实机 Tab 遍历脚本，断言 50 步内焦点能进入主区。

### 1.4 死代码清理（规范，-375 行）

已逐个核实**零 tsx 消费者**：

| 文件 | 行数 | 处置 |
|---|---|---|
| `custom.css:1208-1233` `.run-modal*` | ~130 | 删 |
| `custom.css:827-875` navbar 段 | ~180 | 删 |
| `components/auth/LoginModal.css` | 341 | 删（无引用） |
| `components/ui/PageHeader.css` | 131 | 删（无组件） |

**风险**：`global.css:110-132` 的 `.gewu-docs-frame*` 也无消费者，但 `global.css:136-137` 注释提到 `.gewu-docs-content` 例外——**先查清这两处是否为 MDX 文档页预留**，不要一并删。删除后必须跑 `theme-token-contract.test.ts`（它会检出悬空 var 引用）。

---

## 阶段二：档位 token 体系建设（2-3 天）

### 2.1 间距与圆角：建档位 + 机械归并

**扩 token 档位**（`global.css:37-43`）：

```css
/* 现有 1-6 档：4/6/8/12/16/24px */
--gewu-space-1: 4px;   --gewu-space-2: 6px;   --gewu-space-3: 8px;
--gewu-space-4: 12px;  --gewu-space-5: 16px;  --gewu-space-6: 24px;
+ --gewu-space-7: 32px;  --gewu-space-8: 48px;  /* 补页面级大间距 */
```

**圆角 4 档**（新建，当前 0 定义）：

```css
--gewu-radius-sm: 4px;    /* 徽标、内嵌 chip */
--gewu-radius-md: 8px;    /* 输入框、按钮、卡片（主力档） */
--gewu-radius-lg: 12px;   /* 大面板、模态 */
--gewu-radius-pill: 999px;/* 状态点、胶囊标签 */
```

**归并映射表**（机械替换，先跑 dry-run 报表再落地）：

| 现值 | 归并到 | 涉及声明数 |
|---|---|---|
| `3px` / `5px` / `7px` | `--gewu-radius-sm` / `md` | 81 |
| `9px` / `11px` / `13px` | `--gewu-radius-md` / `lg` | 21 |
| 间距 `10px` | `--gewu-space-4`(12px) | 150 |
| 间距 `14px` | `--gewu-space-5`(16px) | 52 |
| 间距 `9px` | `--gewu-space-3`(8px) | 24 |

**同时改掉 `global.css:37` 的注释**——它现在写着"零碎值（3/5/10/14px）保留"，等于在规范层面对齐了散落。改为"间距一律走 `--gewu-space-*`，例外需登记"。

### 2.2 z-index：7 档层级体系

现状 `Lightbox:100000` 与 `TitleBar:9999` 并存，语义与数值倒挂。建：

```css
--gewu-z-base: 0;
--gewu-z-raised: 10;      /* 卡片悬浮 */
--gewu-z-sticky: 100;     /* 粘性表头 */
--gewu-z-dropdown: 1000;  /* 下拉菜单 */
--gewu-z-overlay: 10000;  /* 遮罩 */
--gewu-z-modal: 10001;    /* 模态 */
--gewu-z-toast: 10002;    /* 通知（必须最高，保证最需要时可见） */
--gewu-z-lightbox: 10003; /* 图片灯箱 */
```

替换后 Toast(10002) > TitleBar 悬浮(10001)，"通知被标题栏压住"的隐患消除。

### 2.3 阴影收敛

`--gewu-shadow-float` / `--gewu-shadow-menu` 已定义却被 12 处手写绕过，且存在**三套阴影色系**（纯黑 `rgba(0,0,0,·)` / slate `rgba(15,23,42,·)` / `color-mix(--gewu-text ·)`）。统一到 `TitleBar.module.css` 已验证的正确范式：`color-mix(in srgb, var(--gewu-text) X%, transparent)`。

---

## 阶段三：可读性与缩放闭环（2-3 天）

### 3.1 字号缩放闭环（当前是真功能缺陷）

`global.css:25-35` 的 11 档字号全部走 `calc(基准rem × var(--gewu-font-scale))`，机制设计正确。但**112 处裸 px 字号完全不响应缩放**——用户在设置里调"界面字号"，这些文字纹丝不动。

优先清理（按集中度）：

| 文件 | 裸字号数 | 备注 |
|---|---|---|
| `LlmTranscriptViewer.css` | 17 | 含 `11.5px`/`12.5px` 这类**无对应 token**的值 |
| `command-center.module.css` | 16 | 另含 34 处陈旧颜色 fallback（`#9aa3b8`/`#5a9cff` 等前一朝值） |
| `Federation.module.css` | 12 | |
| `MobileSync.module.css` | 11 | |

清理后设置面板自身文字、徽标、状态标签才能跟随缩放。

### 3.2 明暗成对补齐

审计发现 24 个 token 在暗色下未定义、沿用亮色值，实测跌到 3.02–3.17:1：

- `--gewu-teal` `#0f766e` → 暗色下 on `#111a2e` = **3.17:1**，8 处引用
- `--gewu-info` `#1565c0` → **3.02:1**，3 处引用
- 三个"成功绿"并存（`--gewu-success` / `--gewu-status-success` / `--gewu-status-success-fg`），建议合并为一套家族

补法：暗色块加 `--gewu-teal: var(--gewu-accent)`（8 处引用自动适配）。

### 3.3 accent 体系接回 ifm

`--ifm-color-primary` 有 **62 处**引用（含 `a { color }` 全局链接色），但 5 个 `[data-accent]` 块（`custom.css:2228-2301`）**一个 ifm token 都没覆盖**。后果：切 accent 到 blue/violet/rose 后，全局链接色仍是绿/青——**主题色功能对 62 处失效**。

方案二选一：
- **A（推荐）**：在 5 个 accent 块内补 7 个 ifm-primary 色阶（由 `--gewu-accent` 经 `color-mix` 派生）
- **B**：把 62 处 `var(--ifm-color-primary*)` 全换 `var(--gewu-accent*)`

同时删掉 `custom.css` 中 **62 处颜色 fallback**（保留 `monospace`/`inherit` 类无害值），让 token 拼写错误能被契约测试立刻暴露。

---

## 阶段四：性能与长列表（3-5 天）

### 4.1 `WorkspaceSummaryCard` 止血（改动最小、收益确定）

审计实测：**0 个 `useMemo`/`useCallback`，6 个 `setInterval`**（5s/30s/60s 各若干）。任何一次 tick 都重渲 1014 行卡片，且该卡片挂在流式输出期间会随父级高频重渲的浮层里。

**三步**：
1. `React.memo` 包导出（一行）
2. 6 个 interval 合并为单 tick，按需分片请求
3. 6 个独立 state 收进 `useReducer`

### 4.2 长列表虚拟化

当前 `react-window`/`react-virtual` 使用 **0 处**：

- `LeftPanel.tsx:437` 直接 `.map()` 全量渲染项目树
- `RightFileTree.tsx`（1029 行）`FileTreeList.tsx:54` `.map()`，递归渲染；已做单目录分页（`TREE_DIR_PAGE_LIMIT`），但**已展开目录的总条目数无上限**——展开 10 个各 500 文件的目录 = 5000 个 DOM 行
- `ToolActivityList.tsx`（977 行）多处 `.map()`

建议引入 `@tanstack/react-virtual`，先做 `LeftPanel` 项目树（收益最直接），`RightFileTree` 可先用"折叠时不渲染子树"（`expandedDirs` 已有，改条件渲染而非 CSS 隐藏）低成本缓解。

### 4.3 首屏骨架

`frontend/index.html` 的 `<div id="root"></div>` 无骨架，Electron 启动到首帧纯白。同时 `App.tsx:62-64` 的 `RouteFallback` 是刻意留白（注释：「本地加载通常 <1 帧，闪一下比空白更扰人」）——**这个决策本身是合理的，不要改**。

建议只给超长 chunk 加骨架：`project-workspace` 单 chunk 689KB / CSS 7642 行，加载远超 1 帧。做法是按 chunk 名条件渲染不同 fallback。

---

## 阶段五：门禁固化（与每阶段同步，不单独排期）

**没有门禁的治理必然回潮**。扩展现有 `theme-token-contract.test.ts`（已有 4 条断言，是本项目已验证的有效范式）：

| 新增断言 | 拦截什么 |
|---|---|
| 同一 `--gewu-*` token 在多个文件重复定义 | `--gewu-surface-dim` 双真源（`custom.css` + `global.css` 各写一遍） |
| `:root` 与 dark 块的 `--gewu-*` 集合差集为空（或在显式白名单内） | 24 个明暗未配对 token |
| `font-size` 不允许裸 `px`（先 warn 后 error） | 112 处不响应缩放的字号 |
| 颜色 token 不允许 fallback（保留 `monospace`/`inherit`） | 62 处陈旧 fallback 掩盖拼写错误 |

另建议引入 **stylelint**（当前仓库**没有**任何 CSS lint 工具），配 `declaration-property-value-allowed-list` 限制 padding/margin/gap/font-size 的裸值。注意：仓库有 `eslint-suppressions.json` 基线机制，stylelint 也应采用同样的"存量豁免 + 新增即红"棘轮，避免一次性 1700 处报错淹没收口。

---

## 落地顺序与依赖

```
阶段一（0.5天，零风险速赢）
  ├─ 1.1 删 CSS 引入 ─────────┐
  ├─ 1.2 对比度改色 ──────────┤ 互不依赖，可并行
  ├─ 1.3 focus-within ────────┤
  └─ 1.4 死代码删 ────────────┘
         ↓
阶段二（2-3天，档位体系）─── 必须先有阶段一的门禁认知
  ├─ 2.1 间距+圆角档位
  ├─ 2.2 z-index 7 档
  └─ 2.3 阴影收敛
         ↓
阶段三（2-3天，可读性）──── 可与阶段二并行（改的文件不重叠）
  ├─ 3.1 字号缩放闭环
  ├─ 3.2 明暗成对
  └─ 3.3 accent 接 ifm
         ↓
阶段四（3-5天，性能）────── 独立，随时可插
  ├─ 4.1 WorkspaceSummaryCard
  ├─ 4.2 虚拟化
  └─ 4.3 首屏骨架
         ↓
阶段五（贯穿）────────────── 每阶段同步加断言，不排期
```

---

## 预期收益

| 项 | 前 | 后 |
|---|---|---|
| 首屏 CSS | 391KB | ~150KB |
| 正文最弱文字对比度 | 2.56:1 | 4.83:1 |
| 错误提示对比度 | 1.45:1 | ≥4.5:1 |
| 间距 token 引用率 | 0.1% | >60% |
| z-index 取值数 | 26（无体系） | 8（有语义） |
| 圆角取值数 | 26（无体系） | 4 |
| 不响应字号缩放的声明 | 112 | 0 |
| 死 CSS | ~375 行 | 0 |

---

## 风险与回退

| 风险 | 概率 | 缓解 |
|---|---|---|
| 大规模 CSS 替换引入视觉回归 | 高 | 按文件分批（每批 ≤1 个文件），每批走一次实机 CDP 截图对比；`git revert` 单批回退 |
| 对比度改色后某处视觉过重 | 中 | `text-muted` 改 `#71717a` 已是保守选择；实机过目欢迎页 + 工作区 + 设置页 |
| 删死 CSS 误删 MDX 文档页依赖 | 中 | 先查 `.gewu-docs-*` / `.gewu-docs-content` 是否有 MDX 消费者，再删 |
| 虚拟化破坏现有滚动/拖拽行为 | 中 | 先做 `LeftPanel` 单点，保留旧实现分支便于对比 |
| 新门禁一次性报 1700 处导致收口卡死 | 高 | 必须"存量豁免 + 新增即红"棘轮，参照 `eslint-suppressions.json` 既有机制 |

---

## 显式禁项

- ❌ **不引入 stylelint 却不配豁免基线** —— 会让 1700 处存量报错淹没收口链
- ❌ **不改 `RouteFallback` 的留白决策** —— 那是经过权衡的合理设计，只给超大 chunk 加条件 fallback
- ❌ **不一次性重命名 `--gewu-text-muted`** —— 92 处引用，先改色值，重命名单独排期
- ❌ **不删除 `.gewu-docs-*` 样式** —— 需先确认 MDX 文档页是否仍需要
- ❌ **不在未建门禁前做阶段二的大规模机械替换** —— 无法验证是否漏改，无棘轮必回潮
- ❌ **不把动效流畅度纳入本次验收** —— 本机 `prefers-reduced-motion: reduce = true`，动效无法实测，属环境限制