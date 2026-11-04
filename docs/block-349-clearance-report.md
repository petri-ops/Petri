# BLOCK-349 清偿报告 — 13 条实机证据终态（2026-11-05）

- 计划：`docs/block-349-evidence-clearance-plan.md`；总纲：`docs/next-phase-program-2026-11-05.md` 包 2/7
- 探针：`scripts/block349-subagent-live.cjs`（A）/ `block349-bigdir-live.cjs`（B）/ `block349-result-live.cjs`（C）/ `block349-segment-live.cjs`（D）/ `block349-retention-live.mjs`（E）；证据 `acceptance/block-349/`
- 执行环境：dev Electron 9223 测试实例（离屏；探针后即恢复）；结果页三件跑在**自有隔离后端**（`PETRI_PLUGINS_DIR` 注册兄弟仓 pack + real provider=deepseek-chat + R `/usr/local/bin/Rscript`），9223 经 `PETRI_TEST_BACKEND_PORT` 指向之，跑完即销
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## 0. 环境清单（开工第一步，逐条可得性）

| 需要 | 状态 | 说明 |
| --- | --- | --- |
| 真实子智能体数据 | **可得** | 主栈 active preset deepseek（key 在场）真跑 spawn_agent ×3（探针 A） |
| tool_jobs 老化数据 | **可得（部分）** | 真实库副本最老 6 天、无超 30 天行 → 删除语义由夹具腿承载（探针 E 双腿） |
| T5 状态门控复现环境 | **部分可得** | 真结果页已建立；但新 composer 入口需「会话选择」联调状态，headless 建不起来 |
| 真实隧道环境 | **不可得** | 需真隧道/真公网门；装第三方服务违反计划 §3 → UI-471 cancelled |
| R 运行时 | **可得（新事实）** | `/usr/local/bin/Rscript` 已装 + 8 个 R 包全在——UI-526 的「用户已裁决暂缓」前提已消失 |
| 结果面 job+artifact | **可得** | expression-qc 真跑出真 artifact（deseq2 撞 pack 仓 R 语法错，见 §2 观察） |
| 异常组件注入 | **可得** | 受控补丁（Vite HMR）+ 即抛即还原 + git diff 干净断言（探针 D） |
| 500+ 文件夹具 | **可得** | 工作区根落 520 夹具文件（探针 B） |

## 1. 十三条终态表

| UI | 终态 | 证据指针 | 一句话依据 |
| --- | --- | --- | --- |
| UI-382 子智能体实况卡内联 | **verified** | `acceptance/block-349/block349-subagent-live-darwin.json` T3 + `block349-subagent-timeline.png` | 真实 spawn ×3，内联卡 ×3（done/running/done）在 spawn 行展开处渲染 |
| UI-383 只读操作折叠 | **verified** | 同上 T4 | 真实工具行 ×12（已读取/已列出/已派发/已思考/已等待）单行折叠渲染、默认 0 展开 |
| UI-384 只读结果内容显示 | **verified** | 同上 T5 | 展开「已读取」行出现输出体：`[读取 topics/a.md · 第 1-4 行 / 共 4 行] # 方向A 缓存调研 要点 QED-11…`（真实文件内容回显） |
| UI-386 摘要卡图标带 | **verified** | 同上 T6 + `block349-subagent-summary.png` | `aside[aria-label="项目运行摘要"]` 智能体节 3 chips（organize,read,read） |
| UI-387 职能图标形状=职能 | **verified** | 同上 T7a | data-category 全部落在 AGENT_CATEGORIES 键集（形状=职能 emoji） |
| UI-390 spawn role 贯通 | **verified** | 同上 T7b | 时间线内联卡 + 摘要卡 chip + 团队列表三处 role/状态贯通（状态色 chip ×9、已完成 ×10） |
| UI-389 大目录游标加载 | **verified** | `block349-bigdir-live-darwin.json` B1/B2 + `block349-bigdir-tree.png` | 520 夹具：200 行截断 + 「加载更多（剩余 320 项）」显式在场；点击 200→400 游标增长（B3 复击惰性=观察区，见 §2） |
| UI-458 tool_jobs retention | **verified** | `acceptance/block-349/retention-live.json`（双腿） | 腿1=真实库副本跑生产 sweeper（删 0、边界全保护 PASS）；腿2=夹具证「只删超期非公开终态」（is_public=1/protected/未超窗/running 全保留）；菜单腿=BLOCK-137 走查已在案 |
| UI-459 解读入口锚定（T5 残留） | **cancelled** | `block349-result-live-darwin.json` C3 | 环境不可得：旧「询问 Agent」捕获点随入口形态演进而退场（composer-first）；新入口需「会话选择」联调状态，headless 建立不起来（conv 建了但结果页选择态不生效，prompt=null）。**何时可补**：人工在主实例打开真结果页点 composer 问一句、看对话是否收到 result_summary 锚定 prompt |
| UI-471 隧道 probe 三态端到端 | **cancelled** | 环境 | 真隧道/真公网门不可得（装第三方服务违计划 §3）；徽标本体与 mock 三态已在案（UI-468 verified）。**何时可补**：真隧道环境就位时观察断反代降级 |
| UI-526 真值徽标语义诚实化 | **verified** | `block349-result-live-darwin.json` C2 + `block349-result-page.png` | R 运行时已装（重开条件成立）→ 真 R artifact 结果页 live 徽标「已核验（未篡改）」×1 在场；detail 双重诚实声明=组件测 18/18 钉死（live 壳层未透出 title 属性，如实记录不冒充） |
| UI-532 pack resultSurface | **cancelled** | 同上 C1 | 环境不可得：最新可得 pack（兄弟仓 origin/main=c58d328，与本地同点、fetch 0 落后）**无 `views.resultSurfaces` 声明** → pack 正面渲染结构性缺席；host 侧真 job 诚实降级已实机证（`core-transitional` + `no_matching_surface`）。**何时可补**：pack 仓补交 resultSurfaces 声明后重跑真 job 页 |
| UI-535 段落级错误兜底 | **verified** | `block349-segment-live-darwin.json` D1-D3 + `block349-segment-crash.png` | 受控注入（子组件渲染时抛错）：段卡 `[data-segment="workspace-preview"][data-segment-crashed="true"]` 在场 + 标题/重试钮/诊断在场 + 页面骨架存活；补丁即抛即还原（git diff 干净） |

**机械复算与口径漂移（如实登记）**：A 类 13 条 100% 终态化 = 本包实义判据（10 verified + 3 cancelled，`test/block349-clearance.test.mjs` 机械复算）。计划验收行「in_progress 28 → ≤15」的 28 = **2026-11-04 对账基线**；其间并行包（344/345/346 收口与新 UI 入账）已使全量口径漂移——现行台账 in_progress 全量计数 **51**（含 mention）/ **23**（纯 status token），本包只处置 A 类、不为凑 ≤15 越权改其他条目（越界=总纲红线 1）。`npm run ui:audit:check` PASS。

复核：10 verified（382/383/384/386/387/389/390/458/526/535）+ 3 cancelled（459/471/532）= 13 ✓

## 2. 过程发现（另立票/观察区，本包不修）

| 级 | 发现 | 证据 | 处置 |
| --- | --- | --- | --- |
| P2 | **pack 仓 deseq2 R 脚本语法错**：`plugins/deseq2/scripts/deseq2.R:72-73` 跨行字符串常量（R 无隐式拼接）→ 任何 deseq2 运行必失败（`Error: unexpected string constant`）。兄弟仓 HEAD=c58d328、工作区干净、仅此 1 处该模式 | 本次真跑 error 全文（`/api/tools/status` error 字段） | pack 仓工作项（不在本仓 touchSurface）；修法=paste0 合并两行。**已登记 backlog C-46** |
| P3 | **pack resultSurfaces 交付回流缺失**：BLOCK-218/220 时代的 pack 0.2.x（views.resultSurfaces/promptFragments 等）不在兄弟仓 latest（c58d328 只到 BLOCK-215）——host 侧能力已交付但 pack 侧声明无处可装 | `git -C ../petri-pack-bio fetch` + `main..origin/main`=0 | 归 pack 仓交付管理（C-46 同批）；UI-532 重开条件随此 |
| P3 | **文件树连翻页第二次点击惰性/回弹**：首击游标增长正常（200→400），其后单击不增长且轮询收敛可把根列表重置回第 1 页；未归因（疑似 BLOCK-96 F2 分页与面板轮询收敛竞态） | `block349-bigdir-live-darwin.json` B3 | 观察区；人工复现后立票 |
| 观察 | 结果页 composer-first 入口形态（旧「询问 Agent」按钮退场）——UI-459 T5 口径随之失效 | C3 detail | 已并入 UI-459 cancelled 记录 |

## 3. 探针工程注记（诚实边界）

- 探针 A/B/D 的 DOM 断言历经 4-5 轮实机迭代修正（run 折叠态两击回弹、内联卡需展开 spawn 行、JSX 子表达式急切求值 vs 子组件渲染时抛错、摘要卡悬浮态）——每轮修正都有失败报告在 acceptance/block-349/ 时间戳副本里，未删改。
- 探针 D 的注入永不进提交：finally 强制还原 + D3 git diff 干净断言。
- 结果页三件使用自有隔离后端（pack env + real provider），共享 dev 栈零改动；跑完即销（tmp DB）。
- C2 的 detail 双重诚实声明以组件测（18/18）承载、live 只证 label 在场——组合口径在断言 detail 里写明，不以组件测冒充实机。

*G0 开发期常态 · 不外推 packaged / Provider / GA。*
