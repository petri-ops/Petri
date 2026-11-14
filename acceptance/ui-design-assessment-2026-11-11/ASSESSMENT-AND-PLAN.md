# Petri 界面设计专项评估与优化计划（2026-11-11）

> **形态**：`advisory` — 只读评估 + 待发令计划。不设 `active`、不占单包串行槽位、不回写 canonical roadmap / handoff / AUDIT-LOG / UI 台账 / DOC-REGISTRY。
> **串行槽位（双时点）**：会话开始 = `BLOCK-413`（主题门扩面，L-66/L-67 续）；会话期间由并发写入者收口并推进，会话结束 = `BLOCK-414`（W5b 拆分第一刀 / `SimpleChat.tsx` 内聚抽取）。**本文件不占串行槽位**，与两者文件面零交集；会话起始的 6 个在制跟踪文件与 13 项 untracked 用户资产全程零触碰（并发写入者的在制变化不归本交付）。
> **证据等级**：静态只读 + 机械门禁当次读数。**不含实机观感、不含用户测试、不含读屏签字**。观感归人眼（E 类），Agent 不代答；本报告所有评分均为「静态评估分」，不得写成 `verified`。
> **口径声明**：UI 台账存在多套并存计数（标题计数 / 分诊 JSON canonical 分段解析 / 机械 grep），本报告并列标注，禁止混用。
> G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 0. 执行摘要

| 维度 | 静态评估分 | 目标分 | 一句话判词 |
|---|---:|---:|---|
| A 布局与信息架构 | **3.0** | 4.3 | 路由与导航体系完整，但重复入口多、弱可达页多、巨型文件集中、布局非单源 |
| B 用户体验与交互 | **3.5** | 4.5 | 机械可达性投入扎实（焦点/ARIA/降级可见），但人眼验收 22 项未签、命令面板无可见入口 |
| C 视觉一致性与设计感 | **3.5** | 4.5 | token 阶梯与门禁成熟度远超同级项目，缺口在「标准没覆盖到的面」：hover/selected 语义、层级档位、响应式 |
| D 工程化标准与验收能力 | **4.5** | 4.7 | 19 条机械断言 + 棘轮 + 三门禁，已具备把设计标准变成 CI 判据的能力 |
| **综合（静态口径）** | **≈3.6** | **≥4.4** | — |

**核心结论**：Petri 的问题**不是「没有设计系统」，而是「设计系统很强但覆盖面不匀 + 人眼验收未闭合」**。工程 A-/产品 C+ 的既有落差（11-04 报告）在界面层具体表现为：7970 处 `--petri-*` 引用与 19/19 全绿的 token 契约门，和 331 处内联样式、111 处裸 z-index、17 个互不统一的响应式断点、≥89 个零响应式 CSS 文件并存。

**因此优化主线不是「重新设计」，而是「把已有标准覆盖到未覆盖的面，并把观感验收补齐」**。这条形态与通用编码工具不同：Petri 的 UI 优化每一期都必须落成可复跑的机械门禁与证据链（本地可审计 / 治理透明 / 证据自证），而不是一次性视觉精修。

**与既有评估的关系**（并列，不调和）：11-06 全量报告「用户界面与交互体验 3.7/5」、H9 蓝图复核 4.1、K7 蓝图复核 4.0、11-04 报告「用户价值层 2.5/5」。本报告是**界面专项静态口径**，与上述工程/产品口径不同，不可互相替代。

---

## 1. 现状量化基线（当次读数，2026-11-11）

### 1.1 规模

| 项 | 读数 | 口径 |
|---|---:|---|
| `.tsx` / `.ts` | 454 / 431 | `find frontend/src` |
| CSS 总数 | 104（93 `.module.css` + 11 全局） | `find frontend/src -name '*.css'` |
| 页面 `.tsx` / 组件 `.tsx` / hooks | 50 / 385 / 48 | `find` |
| 前端测试文件 | 362 | `find -name '*.test.ts*'` |
| 路由页 | 主窗 11 条 + 独立窗 4 条 + 2 兜底 | `frontend/src/App.tsx:198-223, 246-281` |
| Top10 巨型文件行数 | 1430 / 1345 / 1225 / 1062 / 1027 / 759 / 728 / 677 / 676 / 614 | DET-IA §4，逐个复核末行号 |

### 1.2 视觉与一致性债务

| 指标 | 读数 | 性质判断 |
|---|---:|---|
| `var(--petri-*)` 引用 | 7970 | 正面：token 化程度高 |
| `--petri-*` 定义 | 280 处 / 4 文件 | 阶梯 L0–L8 |
| 遗留 `var(--color-*)` | **0** | 门禁断言 2 已清零 |
| slate 字面量 | 9（剥离注释/豁免后 0 违规） | 门禁断言 3 仅 4 条 FORBIDDEN，存在绕过面（C4） |
| CSS 内裸 hex | 421 | `custom.css` 185 处多为 token 单一真源定义，**合法非债**；债集中在组件 CSS |
| `var(--petri-*, #hex)` fallback | 17 文件 / 189 处 | 门禁快照仍记 19 文件 / 235 处 → 快照滞后（C8） |
| 内联 `style={{` | 331 处 / 73 文件 | 集中在 `ContextBudgetBar.tsx` 39、`PluginStorePanel.tsx` 37、`AgentRulesPanel.tsx` 23、`ChatArtifactCard.tsx` 20 |
| `!important` | 48 处 / 7 文件 | 14 处是 reduced-motion 功能性兜底，其余 33 处为布局/主题覆盖 |
| 数字 `z-index` | 111 处 / 38 文件 | 对照 `var(--petri-z-*)` 仅 13 处 / 10 文件 → 8 档层级 token 空转（C3） |
| `@media` | 32 处 / 15 文件（13 文件含宽度断点） | ≥89 个 CSS 文件零响应式声明 |
| `@container` | 10 条 / 8 文件 | 容器查询迁移起步，与 `@media` 双判据并存 |
| 断点阈值 | 17 个互不统一值 | 520/560/577/640/680/700/720/760/768/820/860/960/996/997/1120/1200/1380；JS `767` vs CSS `768` 差 1px |
| ARIA 属性 / `tabIndex` | 687 / 26 | 正面：可达性已有实质投入 |
| `;;` 双分号 | 58 文件 | 疑似批量替换残留，非功能性但影响可维护性（C9） |

### 1.3 门禁与台账读数（当次实跑）

| 门禁 | 结果 | 备注 |
|---|---|---|
| `frontend` `npx vitest run src/styles/theme-token-contract.test.ts` | **19/19 PASS**（311ms） | 含 BLOCK-413 在制的 `theme-token-contract.test.ts` 当前树读数 |
| `npm run docs:check` | **PASS**（当次 556 registered） | 末次复核 557，增量来自并发写入者注册 `block-414` 计划，非本交付 |
| `npm run hygiene:check` | **PASS** | 用户资产 untracked 仅列出，不判红 |
| `npm run ui:audit:check` | **红**：「当前工作区包含 UI 改动，但没有同步 `docs/ui-productization-audit.md`」 | 归属 BLOCK-413 的 CSS WIP，非本次引入；本次零 UI 文件改动 |
| UI 台账（机械 grep 口径） | verified 1176 / in_progress 296 / deferred 16 / planned 2 | 词频计数，含正文，非 canonical |
| UI 台账（canonical 分诊 JSON 口径） | sections 497 / uniqueIds 488 / verified 450 / **debt 35**（13 live-missing + 22 blocked） | `acceptance/block-332/ui-ledger-triage.json`；22 条 `pending_human_eye` 不代答 |

### 1.4 工具链现状

- **已有**：`vitest`、`@testing-library/react`、`@testing-library/jest-dom`、`happy-dom`；`theme-token-contract.test.ts`（19 断言 + 只减棘轮）；`docs:check` / `ui:audit:check` / `hygiene:check` / `closeout` 门禁链。
- **未见**（`package.json` / `frontend/package.json` / 源码 / docs 检索）：Storybook、Style Dictionary、Tokens Studio、Chromatic/Percy、Pa11y、Lighthouse、Figma 集成。`axe-core` 仅在 3 份 docs 中被提及，**不在依赖清单** → 无障碍自动化门禁当前未接线（未确认是否有等价自研门）。

---

## 2. 四维度诊断

### 2.1 A · 布局与信息架构（3.0/5）

**已有的好形态**：主窗/独立窗双路由面 + 主进程 `CONTENT_TYPES` 白名单 fail-closed（`src/main/_window-manager.js:39-109`）；左栏 `AppRail`、三段式 `TitleBar`、扩展中心 4 货架 tab、设置 11 分区、右栏 16 core tab，层级最深三级；历史上已完成多轮入口收敛（会话选择器裁撤、插件/Skills 合并为扩展中心）。

| ID | 级别 | 发现 | 证据 | 影响 |
|---|---|---|---|---|
| IA-P1 | P1 | **同一功能多路径**：欢迎页 5 路径、扩展中心 6 路径、设置 4 路径、知识空间 3 路径；「审阅」同时以 `/review` 路由页与右栏 work surface 双承载 | `App.tsx:200-222`；`useAppCommands.ts:79-84,99-125`；`LeftPanel.tsx:349-390`；`workSurface/registry.ts:60` | 用户心智模型分裂；树测试寻路成功率不可控 |
| IA-P1 | P1 | **弱可达/孤儿页**：`/projects` 与 `/review` 左栏无入口，仅靠命令面板 + 快捷键；`/window/rail` 主进程标 `internal:true` 无生产 popOut 路径 | `App.tsx:201,213,274`；`AppRail.tsx:69-75`；`_window-manager.js:69-75,84-86,107` | 功能存在但用户够不着 |
| IA-P2 | P2 | 页头 `isStandalonePagePath` 清单残留 `/backend`/`/skills`/`/plugins`（已退役/重定向），而 `/extensions`、`/review`、`/projects` 反而不在清单 | `titlebar/shared.tsx:87-89`；`App.tsx:204-213` | 页头标准件判定与实际路由漂移 |
| IA-P1 | P1 | **布局非单源**：`CenterPanel` 双层 layout + `project-workspace.module.css` 同名 class 两处定义（既有蓝图 K-16 未闭环） | H9 蓝图 `§2.7:220-225`；`project-workspace.module.css:1546, 2836` | 改一条冒新坑；几何量测与截图易假绿 |
| IA-P2 | P2 | **巨型文件集中**：Top5 均 1000+ 行，`ReviewMode.tsx` 1430、`ResultArtifactShell.tsx` 1345、`project-workspace.tsx` 1225 | DET-IA §4 | 布局与内容样式混写，违反「布局层单一真源」纪律 |
| IA-P2 | P2 | 命令面板是唯一全局命令入口但**无可见 UI 按钮**（仅 `Mod+K`），新用户仅靠欢迎页一行提示 | `App.tsx:229-235`；`appKeymap.ts:62`；`welcome.tsx:386-388` | 可发现性低 |

### 2.2 B · 用户体验与交互（3.5/5）

**已有的好形态**：`CommandPalette` 焦点管理（Tab 循环 / 焦点还原 / listbox+activedescendant，BLOCK-410 L6-1 已交付）、`ThemeProvider` 读侧失败可见、`RouteFallback` 可见文本、本地主权说明、窄屏抽屉 dialog 语义、687 处 ARIA、断线横幅四消费方。

| ID | 级别 | 发现 | 证据 | 影响 |
|---|---|---|---|---|
| UX-P0 | P0 | **人眼验收未闭合**：debt 35（13 live-missing + 22 blocked），其中 22 条 `pending_human_eye`；人眼路线已生成但**无签字记录** | `ui-productization-audit.md:8,11,15`；`acceptance/block-332/ui-ledger-triage.json`；H9 蓝图 `§0.3:55` | 观感与读屏无证据，任何「体验达标」声明都不成立 |
| UX-P1 | P1 | `ui:audit:check` 当次红（UI 改动未同步台账） | 当次实跑 | 台账与实现漂移，属 BLOCK-413 归属 |
| UX-P1 | P1 | **状态矩阵未经统一盘点**：hover token 5 个并存、selected 无专用 token（仅 `::selection` + accent 人工登记），八态（默认/hover/active/disabled/loading/empty/error/focus-visible）无机械覆盖检查 | `custom.css:70,101,103,144,165`；DET-VISUAL §7.2/§7.3 | 交互态观感不一致，暗色尤其 |
| UX-P2 | P2 | 长内容三态 / 窄视口 ≤900px 的实机几何证据分散在多个历史包，未形成统一回归 flow | `petri-css-theme` §3 视觉验收红线 | 固定高度/逃逸类缺陷只有布局变化时才显形 |
| UX-P2 | P2 | 无用户侧量化基线（SUS / UMUX-Lite / 任务成功率 / 树测试寻路率） | 全仓未见 | 「体验变好」不可证伪 |

### 2.3 C · 视觉一致性与设计感（3.5/5）

**已有的好形态（不要重做）**：`custom.css` + `global.css` 构成 L0–L8 token 阶梯——四级表面（canvas/surface/subtle/elevated）、文字四级、状态语义色、字号 6 档、间距 8 档、圆角 4 档、z 8 档、motion 3 档、边框三语义、4 主题色 × 明暗 8 块；Infima 七档由 accent 派生；`theme-token-contract.test.ts` 19 断言全部「新增即红、只减不增」。

| ID | 级别 | 发现 | 证据 |
|---|---|---|---|
| VI-P1 | P1 | **层级档位空转**：z 8 档仅 13 处引用 vs 111 处裸数字（38 文件）；门禁只冻结裸值，不强制迁移 | `custom.css:177-184`；`test.ts:587-648`；DET-VISUAL C3 |
| VI-P1 | P1 | **交互语义分裂**：hover 5 个 token 并存且无「用哪一档」约束；selected 无 token；`--petri-surface-dim` 跨文件 4 处定义，门禁只查块内重复 | `custom.css:70,101,102,103,144,165,259`；`global.css:49,61`；DET-VISUAL C1/C11/C12 |
| VI-P1 | P1 | **响应式碎片化**：17 个阈值、≥89 个 CSS 零响应式、JS/CSS 767 vs 768 不对齐、`@media` 与 `@container` 双判据混用 | DET-VISUAL §6；`useWorkspacePanels.ts:130` vs `custom.css:819` |
| VI-P2 | P2 | token 单一真源外溢：10 个 `--petri-*` 定义在组件 CSS（不在 `:root`/dark 块），明暗成对断言与块内重复断言均覆盖不到 | `desktop.css:10-12`；`code-highlight.css:72-78`；DET-VISUAL C6/C15 |
| VI-P2 | P2 | 门禁快照滞后（颜色 fallback 现值 17 文件/189 处 vs 快照 19/235）；slate FORBIDDEN 仅 4 条，4 个色阶字面量绕过；暗色 html 前缀断言只管 `styles/` 且需含 `--ifm-` | `test.ts:72,90-110,245-266`；DET-VISUAL C4/C5/C8 |
| VI-P2 | P2 | 组件 CSS 裸色值 Top：`simple-chat.css` 97、`project-workspace.module.css` 64、`command-center.module.css` 37；内联样式 Top 见 §1.2 | DET-VISUAL §4/§5 |
| VI-P3 | P3 | `;;` 双分号 58 文件；注释与实现不符（`custom.css:919-920` 声称的 @import 实际不存在） | DET-VISUAL C9/C10 |

### 2.4 D · 工程化标准与验收能力（4.5/5）

**强项**：19 条机械断言把 token / 暗色特异性 / 字号 / 间距 / z / motion / 裸值 / 内联债固化成 CI 判据；`docs:check`（556 注册）+ `ui:audit:check` + `hygiene:check` + `closeout` 十三门；`PETRI_TEST_ONSCREEN` 静态门防开窗；视觉验收红线（元素级截图、长内容三态、`min-width:0` 祖先链、四块几何量测）。

**缺口**：门禁多为「棘轮冻结」而非「收敛迁移」，所以债务只不增、不会自动减；跨文件重复定义、反向明暗成对、tsx 内联裸字号是盲区；无障碍自动化（axe 类）未接线；无视觉回归（Chromatic/Percy 类）；设计标准与组件库之间缺 Storybook 类单一真源文档面。

---

## 3. 分期优化计划（待发令 · 单包串行）

> **纪律**：每期独立立项、独立发令、独立收口；同一时间只有一个 active 工作包。当前串行槽位（会话结束时 = `BLOCK-414`）收口前，下列任何一期不得开工。
> **形态自检**（对标不改魂）：每期都必须产出「机械门禁 + 证据链」，让 UI 变更在本地可审计、治理透明、证据自证；不做一次性视觉精修，不做无差别形态复刻。
> **零新增依赖为默认**；任何新工具引入须先过 `DEPENDENCY-CHANGE-CHECKLIST` 并取得用户显式裁决。

| 期 | 名称 | 体量 / 类型 | 范围 | 非范围 | 交付物 | 机械验收判据 |
|---|---|---|---|---|---|---|
| **UI-D0** | 基线冻结与判据立标 | 小 / 治理 | 把本报告 `baseline.json` 注册为对账基线；补《UI 验收清单 v1》（八态矩阵、几何四块、长内容三态、断点表、评分卡口径）；跑一次干净树门禁全量读数 | 不改任何 UI 代码、不动台账状态词 | `baseline.json`、`UI-ACCEPTANCE-CHECKLIST.md`、门禁读数快照 | `docs:check` / `hygiene:check` / `theme-token-contract` 19/19 PASS；基线字段与本报告逐项相等；评分卡每项有可复算口径 |
| **UI-D1** | 信息架构收敛 | 中 / 重构 | 单一入口表：每个功能一条 canonical 路径；`/projects`、`/review` 补左栏入口或显式退役；清理 `isStandalonePagePath`；统一「审阅」双承载 | 不改视觉 token、不动布局几何 | 页面→路由→入口矩阵、重定向表、导航层级图、寻路测试 | 无重复入口（每功能 1 canonical 路径）；孤儿页 = 0 或有显式 `cancelled` 留因；核心任务 ≤3 次点击；树测试寻路成功率 ≥80%（需人测，人眼项） |
| **UI-D2** | 布局单源与响应式统一 | **大 / 重构** | 落地既有 K-16：`CenterPanel` 双层 layout → 独立 `XxxLayout.module.css` 单一真源；同名 class 两处定义合并；断点表收敛到 4 档 + 常量单源；JS/CSS 阈值对齐；容器查询迁移 | 不动 token 语义、不改交互逻辑、不追加覆盖规则 | 布局文件拆分、断点 token 表、几何量测 flow | 同一可视区布局定义处 = 1；四块几何（无重叠 / 同行同宽 / 不溢出父容器 / 祖先右缘 ≤ 可视列）全绿；≤900px 不越界；长内容三态通过；元素级截图过目；拆前拆后同套测试绿 |
| **UI-D3** | 视觉语义统一 | 中 / 重构 | hover 收敛到 1 档 + selected 新增专用 token；`--petri-surface-dim` 跨文件重复收敛；z 裸值向 `--petri-z-*` 迁移；token 定义外溢回 `styles/`；颜色 fallback 快照重打；清 `;;` | 不改布局几何、不动交互状态机 | token 表 v2、状态矩阵、迁移 diff、门禁快照更新 | `theme-token-contract` 19/19 PASS 且棘轮**下调**（不是放宽）；裸 z 值单调下降；hover/selected 语义各 1 个真源；跨文件重复定义 = 0；`;;` = 0 |
| **UI-D4** | 交互状态与无障碍闭环 | 中 / 实机 | 组件八态矩阵逐格补齐；引入自动化无障碍扫描（先评估自研或最小依赖，默认不加依赖）；22 条 `pending_human_eye` 生成人测路线并集中过目；键盘/读屏路径 | 不改 IA、不改 token 阶梯 | 八态覆盖表、无障碍报告、人眼路线 + 签字记录 | WCAG AA 零严重项（机械可算部分）；`focus-visible` 覆盖所有可交互元素；八态矩阵无空格；人眼项必须由人签字，Agent 不代答 |
| **UI-D5** | 门禁化与复测 | 小 / 治理 | 把 D1–D4 的可机械判据写进门禁；视觉/几何回归 flow；同一评分卡 Before/After 复测；台账同批回写 | 不新开功能 | CI 门禁脚本、复测报告、台账回写 | 新增判据均有负测（植入违规必红）；Before/After 评分卡逐维可比；`ui:audit:check` 转绿；`docs:check` PASS |

**依赖顺序**：D0 → D1 → D2 → D3 → D4 → D5。D2 是唯一大包，建议单独切片发令（按 `petri-css-theme` §5「布局层只重构不追加」）；D4 的人眼腿不可被自动化替代。

---

## 4. 可机械验收标准

### 4.1 评分卡复测协议

- 同一批评分维度（A/B/C/D）、同一静态口径、同一组证据命令；D0 冻结基线，D5 用**同套**复测出 Before/After 对照。
- 静态分 ≠ 实机观感分；观感分只能由人测签字产生，Agent 不写 `verified`。
- 出口（建议，需用户裁决）：A/B/C/D 各 ≥4.4，且无 P0 未闭合项。

### 4.2 量化门槛表（可直接抄为验收清单）

| 层 | 判据 | 门槛 |
|---|---|---|
| IA | 单一入口 | 每功能 canonical 路径 = 1；孤儿页 = 0（或显式 `cancelled` 留因） |
| IA | 任务可达 | 核心任务 ≤3 次点击；树测试寻路成功率 ≥80%、首击正确率 ≥70%（人测项） |
| UX | 量表 | SUS ≥68 且较基线 +10；核心任务成功率 ≥90%（人测项） |
| UX | 问题清零 | P0/P1 启发式问题 = 0；debt 35 逐件终态、零 `in_progress` 悬挂 |
| 视觉 | token | `var(--petri-*)` 覆盖率维持高位；组件 CSS 裸色值只减不增；`--color-*` = 0；slate 违规 = 0 |
| 视觉 | 语义 | hover / selected 各 1 个真源；跨文件重复 token 定义 = 0 |
| 视觉 | 无障碍 | WCAG AA 零严重项；对比度 ≥4.5:1（大字 3:1） |
| 布局 | 几何 | 无重叠 / 同行同宽 / 不溢出父容器 / 祖先右缘 ≤ 可视列；≤900px 不越界 |
| 布局 | 长内容 | 完整容纳 / 框内滚动（滚动条可见）/ 窄视口三态全过 |
| 布局 | 断点 | 断点阈值 ≤4 档且 JS/CSS 同源；`min-width:0` 贯穿 flex/grid 祖先链 |
| 回归 | 门禁 | `theme-token-contract` 19/19；`docs:check` / `ui:audit:check` / `hygiene:check` PASS；新增判据均有植入违规必红的负测 |
| 证据 | 观感 | 元素级裁剪截图过目 + 人测签字；DOM 几何断言通过 ≠ 视觉验收通过 |

### 4.3 参考框架与工具类别（落地建议）

| 层 | 框架 | 在 Petri 的状态 | 建议 |
|---|---|---|---|
| 原则 | Nielsen 十大启发式、ISO 9241-210、WCAG 2.2 AA、格式塔、CRAP | 部分内化（焦点/ARIA/降级可见） | 写进《UI 验收清单 v1》，转成可勾选项 |
| 体系 | Apple HIG / Fluent 2 / IBM Carbon（桌面优先）、Material 3、Ant Design | 未确认有显式对标 | 只借交互范式与质感基线，不引入组件库依赖 |
| 度量 | HEART+GSM、SUS、UMUX-Lite、Nielsen 严重度分级 | 未见用户侧量化基线 | D0 立口径，D4 采集；**不新增埋点依赖**，先复用现有事件面 |
| 资产 | W3C DTCG tokens、Figma Variables、Storybook、Style Dictionary | token 阶梯已在 `custom.css`/`global.css`；Storybook/Style Dictionary 未见 | token 表已是事实单源，短期不必引入同步管线；组件文档面缺口记为 D2/D3 交付物 |
| 门禁 | axe-core / Pa11y / Lighthouse、stylelint、Chromatic/Percy、Playwright 几何+像素断言 | `theme-token-contract` 已有；axe 仅在 docs 提及未入依赖 | 默认**零新增依赖**；先用现有 vitest + happy-dom + `@testing-library` 写可算断言，需引入时走依赖清单 + 用户裁决 |

---

## 5. 本次已安装的 Agent 设计技能

安装通道：`npx skills add <owner/repo@skill> -g -y`（落 `~/.agents/skills/`），发现桥 symlink 到 `~/.codebuddy/skills/`。**均装在用户级，不进仓库 `.agents/skills/`（项目级 canonical 不受影响）**。

| 技能 | 类别 | 适用场景 | 产出物 | 状态 |
|---|---|---|---|---|
| `web-design-guidelines` | 评审准则 | 逐条审查现有界面是否违反网页设计准则 | 违规清单 + 修复建议 | ✅ |
| `ui-ux-pro-max` | 综合方案 | IA→交互→视觉全链路方案 | 完整优化方案 / 设计规范 | ✅ |
| `ux-heuristics` | 启发式走查 | 无用户时快速可用性摸底 | 严重度分级问题清单 | ✅ |
| `ui-ux-design-review` | 页面评审 | 单页/单流程出评审报告 | 表格式评审报告 | ✅ |
| `impeccable` | 设计感精修 | 「不好看但说不出哪不对」 | 逐条打磨建议 | ✅ |
| `figma-generate-library` | 设计系统 | 建组件库 / 设计资产 | 组件库草案 | ✅ |
| `penpot-uiux-design` | 设计稿 | 开源设计稿协作 | 设计稿 / 组件规范 | ✅ |
| `tailwind-design-system` | token 体系 | 设计系统 token 组织方式对照 | token 组织参考 | ✅ |
| `accessibility` | 无障碍 | 自动化无障碍审计 | WCAG 审计报告 | ✅ |
| `accessibility-review` | 无障碍评审 | 人工/半自动可达性评审 | 评审清单 | ✅ |
| `product-ui-taste`（替代） | 设计感 | 产品界面品味评分 | 品味维度清单 | ✅ 同类替代，见下 |
| `ui-taste`（`uizze.sh@ui-taste`） | 设计感 | 设计品味评分 | — | ❌ 源仓库不存在（`SKILLS_GIT_CLONE_FAILED: repository 'uizze.sh@ui-taste' does not exist`）；已装 `product-ui-taste` + `impeccable` 覆盖同维度 |
| `extract`（`pbakaus/impeccable@extract`） | 组件提取 | 从存量代码抽可复用组件 | — | ❌ 源 repo 已无此 skill（`SKILLS_NO_MATCHING_SKILLS: available = impeccable`）；本体已装 |

SkillHub 中文语义检索对「界面设计 / UX 评估」返回的全是低分（≤0.05）无关技能，故本次以 skills.sh / ClawHub 为准。

---

## 6. 证据索引

| 类别 | 位置 / 命令 |
|---|---|
| 量化基线 | `acceptance/ui-design-assessment-2026-11-11/baseline.json`（同目录） |
| 信息架构探查 | DET-IA 只读报告（路由清单 / 导航树 / 重复入口 / Top10 规模，`App.tsx:198-281` 等） |
| 视觉探查 | DET-VISUAL 只读报告（token 阶梯 L0–L8 / 19 断言逐条 / 分布计数 / 断点表 / C1–C17 线索） |
| 台账与既有蓝图 | DET-LEDGER 只读报告（台账三口径 / debt 35 / 11-04 & 11-06 评分 / H9 K3 / K7 L6 / BLOCK-413 边界 / 文档治理结论） |
| 门禁当次读数 | `npx vitest run src/styles/theme-token-contract.test.ts`（19/19）、`npm run docs:check`（556 PASS）、`npm run hygiene:check`（PASS）、`npm run ui:audit:check`（红，WIP 归属） |
| 决策建议器 | `test:suggest` → `suggested=false`（confidence 0.73 < 0.8）、`doc:suggest` → 全部 `suggested=false`、`next:suggest` → 单一建议 `POST-K7-FULL-AUDIT-AND-BLUEPRINT-2026-11-10`（confidence 0.37） |
| 治理依据 | `AGENTS.md`；`petri-project-governance`（单包串行 / canonical 唯一）；`petri-dev-infra`（门禁 / 视觉验收红线 / 委派契约）；`petri-css-theme`（token 阶梯 / 布局层纪律） |

**文档治理结论**：`docs/**.md`（不含 `docs/archive/`）必须注册 `DOC-REGISTRY.json` 否则 `docs:check` 失败；`acceptance/` 不在 `managedRoots` 内，不受 `docs:check` 管辖。本文件因此落 `acceptance/`，且 `docs/DOC-REGISTRY.json` 是 BLOCK-413 在制 WIP，**零写入**。

---

## 7. 未确认项与边界（不推断填充）

1. 本报告**未做实机观感**、未做用户测试、未做读屏；22 条 `pending_human_eye` 保持原状，Agent 不代答。
2. `axe-core` 是否在工程内有等价自研门禁：未确认（仅确认不在依赖清单、docs 有 3 处提及）。
3. `ui:audit:check` 当次红归属 BLOCK-413 的 CSS WIP；本次零 UI 文件改动，未新增红。
4. `acceptance/` 新增 md 是否触发「证据元数据门」等非 `docs:check` 判红：已在落盘后复跑 `docs:check` / `hygiene:check` 核对（见交付说明），其他门未逐一验证。
5. UI 台账 `planned` / `deferred` 两态无 canonical 口径，本报告的 2 / 16 仅为机械 grep 词频，不可与分诊 JSON 的 497/450/35 混用。
6. 部分目录（`components/knowledge/`、`viewers/`、`ui/`、`editor/` 等）未做逐文件行数统计；Top10 表口径见 DET-IA §4。
7. 本计划为 `advisory`，**未启动任何新工作包**；每一期均需用户显式发令。
