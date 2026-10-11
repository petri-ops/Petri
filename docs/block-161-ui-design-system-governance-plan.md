---
capability: design-system
goal: BLOCK-161 = UI 设计体系治理（视觉/布局/字体/配色/性能五维）；承接 2026-10-10 UI/UX 全面审计（9条 P0/P1，实测证据），分四波落地，每波独立验收
acceptance:
  - W1速赢（P0）：CommandPalette.tsx:10 误引入 simple-chat.css 删除（首屏 CSS 391KB→约150KB，零依赖已核实 cp- 前缀 17 类名 / sc- 引用 0 处）+ 4 处对比度改色（--petri-text-muted 亮 2.56→4.83、暗 3.78→5.94；CodeReviewDrawer.drawerError 亮色 1.45→≥4.5；extensions pill hover）+ projectTreeAddBtn focus-within 显形（实机 Tab 50 步困在左栏 → 焦点可进主区）+ 375 行死CSS 清理（run-modal/navbar/LoginModal/PageHeader 四项零 tsx 消费者已逐个核实）；实机 CDP 对比度+Tab 遍历双断言
  - W2 档位体系+ 门禁棘轮：间距 token 扩 8 档 + 圆角 4 档（当前 26 种裸值）+ z-index 7 档（当前 20+ 处散落、语义与数值倒挂：Toast 9999 < TitleBar 10001 且 > LoginModal 10000）+ 阴影收敛（84 种唯一值 → color-mix范式）；theme-token-contract.test.ts 补 4 条断言（重复定义 / 明暗成对 / 裸 font-size / 禁颜色 fallback）
  - W3 缩放闭环 + 可读性：112 处裸 font-size 清零（LlmTranscriptViewer 17 / command-center 16 / Federation 12 / MobileSync 11，含 11.5px·12.5px 无对应 token 值）→ 设置面板「界面字号」真生效；24 个明暗未配对 token 补齐（--petri-teal 暗色 3.17:1、--petri-info 3.02:1）；accent 接回 ifm（62 处 var(--ifm-color-primary) 在 5 个 [data-accent] 块零覆盖 → 切主题色对全局链接色失效）
  - W4 性能：WorkspaceSummaryCard 止血（0 useMemo + 6 setInterval → React.memo + 单 tick + useReducer）+ 长列表虚拟化（react-window 0 处；LeftPanel.tsx:437 全量 .map / RightFileTree 1029 行 / ToolActivityList 977 行）+ 首屏骨架（index.html #root 空节点；RouteFallback 留白决策保留，仅超大 chunk 条件 fallback）
  - 波末：closeout 门禁 + acceptance 证据 + UI 台账登记
reopen: 阻塞=BLOCK-160（W2 成熟度波）收口；启动前置=唯一 active 槽位空出或用户显式裁决插队（并行须写明文件面隔离边界）
status: active
---

# BLOCK-161：UI 设计体系治理（视觉 / 布局 / 字体 / 配色 / 性能）

> **状态：active（2026-10-11 翻正——BLOCK-166 已收口腾出唯一 active 槽位；用户裁决「继续 搞完下一个候选」按队列头发令开工 W1）**
> 立项：2026-10-10。用户裁决「是否根据这个立项 block？」→ 三选一 **B**（等BLOCK-160 收口后立项，不并行）。
> 审计基线：[`acceptance/ui-ux-audit-2026-10-10/ui-ux-audit-report.md`](../acceptance/ui-ux-audit-2026-10-10/ui-ux-audit-report.md)（51 条可定位问题）
> 升级方案：[`acceptance/ui-ux-audit-2026-10-10/ui-upgrade-plan.md`](../acceptance/ui-ux-audit-2026-10-10/ui-upgrade-plan.md)（五阶段 + 门禁固化）
> 编号注记：BLOCK-160 已由并行会话（成熟度蓝图 W2 波）占用并处 `active`，本包顺延 161。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## §1 为什么是 BLOCK 而非 UI 增量

按 `$petri-project-governance` `references/TASK-FORM-TAXONOMY.md` §2 分轨判据自检：

| 判据 | 判定 | 结论 |
|---|---|---|
| 文件面是否收敛在单一模块区？ | 否 — `styles/` + `components/copilot/` + `components/workspace-panels/` + `pages/extensions/` 四区 | ✗ 不符 UI 轨 |
| 呈现是否只重组既有通道与数据、不新增管道？ | 部分 — 但含`--petri-z-*`/`--petri-radius-*` 新增 token 体系 | ✗ |
| 是否需要多裁决项的 P0 评审？ | 是 — W1~W4 四波，每波含独立裁决（删哪些死CSS / 圆角档位取值 / 是否重命名 muted） | ✗ 不符 UI 轨 |
| 是否需要跨会话串行分阶段？ | 是 — 约 12 天工作量 | ✗ |

→ **走 BLOCK 轨**，四波序列形态对标 **BLOCK-154-OPTIMIZATION-SERIES**（轻量批 + 波次推进 + 收口笔录 §8）。

---

## §2 启动前置（BLOCK-161 启动时逐项核对）

| 检查项 | 当前状态（2026-10-10 16:41） |
|---|---|
| 无 🔴 阻塞项 | ✅ AUDIT-LOG 无红项 |
| 无未知 WIP | ⚠️ `docs/block-160-maturity-wave2-plan.md` 为并行会话在制（`status: active`），本包**启动前须确认其已收口** |
| 唯一 active 槽位 | ❌ **当前被 BLOCK-160 占用** → 这是本包暂列 `planned` 的唯一原因 |
| 用户裁决留痕 | ✅ 「B」=等 160 收口后立项，不并行 |

**启动动作**：BLOCK-160 收口（其 plan 状态头翻 `completed`）→ 本包状态头翻 `active`、DOC-REGISTRY `planned → active`、AUDIT-LOG 插启动登记行、README 插入口行。

---

## §3 波次序列（照抄 BLOCK-154 成功形态）

### W1 速赢（P0 缺陷修复 · 约 0.5 天）

四条互不依赖，可同一提交落地，独立可回滚。

| 项 | 位置 | 依据 |
|---|---|---|
| 删 CSS 误引入 | `frontend/src/components/copilot/CommandPalette.tsx:10` | 组件 17 类名全 `cp-` 前缀、`sc-` 引用 **0 处**（已逐项核实）；`simple-chat.css` 4312 行 |
| 对比度改色 ×4 | `custom.css:89,221` / `CodeReviewDrawer.module.css:107` / `extensions.module.css:14,340` | WCAG 实测：muted 亮 2.56→4.83、暗 3.78→5.94；drawerError 亮色 1.45→≥4.5 |
| 键盘可达性 | `project-workspace.module.css:1039-1045` + `LeftPanel.tsx:601-640` | `.projectTreeAddBtn{opacity:0}` 仅 `:hover` 显形；实机 Tab 50 步困左栏 |
| 死 CSS 375 行 | `custom.css:1208-1233`(run-modal) / `:827-875`(navbar) / `LoginModal.css`(341) / `PageHeader.css`(131) | 四项**零 tsx 消费者**已逐个 grep 核实 |

**W1 验收**：`vite build` 后`dist/assets/index-*.css` 体积对比 + 实机 CDP 双断言（对比度逐元素计算 + 真实 Tab 遍历 50 步断言可进主区）+ `theme-token-contract` 4/4 + closeout。

**W1 禁项**：不删 `.petri-docs-*`（需先确认 MDX 文档页消费者）；不重命名 `--petri-text-muted`（92 处引用，重命名单独排期至 W3）。

### W2 档位体系 + 门禁棘轮（约 3-5 天）

**顺序不可颠倒**：必须先建 token 与门禁，再做机械替换。

1. 间距 token 扩 8 档（补 `--petri-space-7:32px` / `-8:48px`）
2. 圆角 4 档（`--petri-radius-sm/md/lg/pill`，当前 26 种裸值）
3. z-index 7 档（`--petri-z-base/raised/sticky/dropdown/overlay/modal/toast/lightbox`）—— **Toast 必须最高**，当前 9999 < TitleBar 10001
4. 阴影收敛（84 种唯一值 → `color-mix(--petri-text X%, transparent)` 范式）
5. `theme-token-contract.test.ts` 补 4 条断言：重复定义 / 明暗成对 / 裸 font-size /禁颜色 fallback
6. 机械归并（映射表见升级方案 §2.1）

**W2 风险**：大面积 CSS 替换易引入视觉回归 → 每批 ≤1 文件，每批实机 CDP 截图对比，`git revert` 单批回退。

### W3 缩放闭环 + 可读性（约 3-5 天，可与 W2 并行 · 文件不重叠）

1. 112 处裸 `font-size` 清零 → **设置面板「界面字号」对设置面板自身文字、徽标、状态标签真生效**（当前是功能缺陷，不是仅不一致）
2. 24 个明暗未配对 token 补齐（`--petri-teal` 暗色 3.17:1、`--petri-info` 3.02:1、三个"成功绿"合并为一套家族）
3. accent 接回 ifm：5 个 `[data-accent]` 块补 7 色阶，或反向把 62 处 `var(--ifm-color-primary*)` 换 `var(--petri-accent*)`

**W3 并行判据**：W2 动 `styles/*.css` + 组件 CSS Modules，W3 动组件 CSS + `custom.css` token 块——`custom.css` 同文件不同行区，提交按 hunk 精确暂存。

### W4 性能（约 3-5 天）

1. `WorkspaceSummaryCard.tsx`（1014 行）止血：`React.memo` + 6 个 interval 合并单 tick + 6 个 state 收 `useReducer`（当前 0 个 `useMemo`/`useCallback`）
2. 长列表虚拟化：`LeftPanel.tsx:437` 项目树优先（`@tanstack/react-virtual`），`RightFileTree` 可先用「折叠时不渲染子树」低成本缓解
3. 首屏骨架：`index.html` `#root` 内联骨架；**`RouteFallback` 留白决策保留不改**（仅超大 chunk 加条件 fallback）

---

## §4 范围与非范围

### 范围
- `frontend/src/styles/`（token 体系 + 契约测试）
- `frontend/src/components/`（CommandPalette / workspace-panels / WorkingTreeReview / common）
- `frontend/src/pages/extensions/` `pages/project-workspace.module.css`
- `frontend/index.html`（首屏骨架）

### 非范围（显式排除）
- ❌ 不改 `AGENTS.md` 阶段纪律、不引入 packaged/Provider/GA 相关工作（G0 常态）
- ❌ 不动 `.petri-docs-*` 样式（先确认 MDX 消费者）
- ❌ 不重命名 `--petri-text-muted`（92 处引用，W3 单独裁决）
- ❌ 不改 `RouteFallback` 留白决策（已权衡的合理设计）
- ❌ 不改 `App.tsx` 路由结构、不引入新路由
- ❌ 不做动效流畅度验收（本机 `prefers-reduced-motion: reduce = true`，动效不可测，属环境限制）

---

## §5 依赖与并行互认

| 依赖 | 状态 |
|---|---|
| 硬依赖 | 无（不依赖 BLOCK-160 的交付物） |
| 启动阻塞 | **BLOCK-160 收口**（唯一 active 槽位） |
| 若用户裁决并行 | 文件面与 BLOCK-160 **不相交**（本包动 `styles/`+`components/copilot/CommandPalette`+`pages/extensions/`；160 动后端审批/规则/skills/MCP + `DesktopSettingsPanel`）。潜在交叉仅 `DesktopSettingsPanel`，本包 W1~W3 不触|

**新增 npm 依赖**：`@tanstack/react-virtual`（W4 虚拟化）。按 `DEPENDENCY-CHANGE-CHECKLIST` 默认答案为「不新增」——W4 启动前须先评估自研 spacer 方案（先例：`ScientificInteractionViewer` 自研 spacer；`BLOCK-154` 波次 3「深水区从紧」）。

---

## §6 证据位置

| 内容 | 路径 |
|---|---|
| 审计报告 | `acceptance/ui-ux-audit-2026-10-10/ui-ux-audit-report.md` |
| 升级方案 | `acceptance/ui-ux-audit-2026-10-10/ui-upgrade-plan.md` |
| 只读 CDP 探针（可复用） | `scripts/ui-audit-probe.cjs` |
| 各波验收证据 | `acceptance/block-161/`（收口时落） |

**探针登记待办**：BLOCK-159 收口笔录记「`test:changed` 卡 `scripts/ui-audit-probe.cjs` 未登记分类」——本探针属本包工具，须在启动时按 `test/impact-map.json` `classifiesScripts: true` 规则登记（`scripts/archive/` 不参与）。

---

## §7 收口预期

- **节奏**：四波串行，W1 单会话可收口，W2/W3/W4 各需跨会话
- **门禁**（逐波）：定向测试 + `tsc 0` + `lint 触碰面清零` + `theme-token-contract` + `docs:check` + `ui:audit:check` + `closeout`
- **W1 专项**：实机 CDP 对比度逐元素计算 + 真实 Tab 键遍历（本项目「困难 UI 缺陷必须实地验证、禁纯静态推断」纪律）
- **完成语义**：`dev Electron` 边界内 verified（当前 G0 阶段最高证据等级）

---

## §8 波次出口判据

| 波 | 出口判据 |
|---|---|
| W1 | 首屏 CSS ≤200KB；`--petri-text-muted` 双主题 ≥4.5:1；drawerError ≥4.5:1；实机 Tab 50 步可进主区；死 CSS 清零 |
| W2 | 间距 token 引用率 >60%；圆角 ≤4 种；z-index ≤8 取值；契约测试 8 条全绿 |
| W3 | 裸 `font-size` = 0；明暗未配对 token = 0（白名单除外）；切accent 后全局链接色跟随 |
| W4 | 首屏关键路径 ≤700KB；LeftPanel 项目树虚拟化生效；WorkspaceSummaryCard 重渲次数可测下降 |