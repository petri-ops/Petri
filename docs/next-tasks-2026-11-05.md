# 下一阶段精准任务卡（2026-11-05 · C-48 更新后复核）

> 形态：**任务卡（TASK-CARD）**，承接 `docs/Petri-Desktop-Evaluation-Report-2026-11-05.md`。
> 取数时点：HEAD `a8796ed7`；所有状态为**当次机械复核**，不沿用任何台账声称。
> 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**；出籍就绪 6/6 ≠ 已出籍。

---

## §0 增量核对：相对上一版评估的修订（必须先看）

| 项 | 上一版评估（11-05 早） | **当前事实** | 处置 |
| --- | --- | --- | --- |
| C-48 / 打包 GUI 直启 | T-4「GUI 直启用户实机验证」列 P1 待做 | **已修复并销号**：用户错误框截图推翻「框架 init 挂死/TCC/AMFI」判断，真因=打包 require 与 ABI 三层断链；完整重建 + 目录版/DMG 实机全绿（主进程/GPU/network/renderer helper/后端子进程、health ok、SPA 200、路由错误清零、codesign valid） | **移出任务清单**，仅余人工观察 O-1 |
| 353 结论 | 报告称「打包态与 dev 行为一致」 | 已修正为**不宣称打包态 GUI 可用**（修复前）；C-48 修复后重建实机全绿，但「屏幕观感与点击体感」仍待人工确认 | 表述修正已落 `docs/block-353-regression-report.md` |
| `quality:perf` | 判定「稳定红」（两次复跑 34–36ms > 32ms 阈值）→ T-2 列 P0 | 当次复跑 **4 绿 / 0 红**（long_conversation 27ms），`closeout` **PASS 16 门**；历史样本 20→36ms 说明是**波动**，阈值 32ms 正好卡在波动带中间 | **修正为「间歇性抖动」**，T-2 从 P0 降级为可选加固 J-1 |
| `closeout` | FAIL | **PASS** | — |
| 三票 C-45/46/47 + G1 裁决 | 待裁决 | **不变** | 保留，且每项启动条件写死（见 §1 A 组） |

**净效果**：上一版清单 10 项 → 移出 1 项（T-4）、降级 1 项（T-2）、保留并精确化 8 项 → **当前精准任务 8 项**。

---

## §1 精准任务清单（8 项，按「能否直接开工」分组）

### A 组：需你发令 / 授权才能开工（4 项）

这四项**不是我没做**，是启动条件卡在裁决或兄弟仓权限上。发令句式见 §3。

#### A-1 · C-45 上下文压缩破坏 tool 消息配对（**P1，最高优先**）

| 字段 | 内容 |
| --- | --- |
| 启动条件 | **用户裁决立项**（BLOCK-348 计划 §3 明确「不修只立票」；需新包，建议 BLOCK-355） |
| 精确文件 | `core/petri-server/helpers/message-trimmer.js:159-160`（`pickWithinBudget` / `scoreMessages`） |
| 缺陷 | 按打分贪心裁剪、无 tool 链配对约束 → 可裁掉 `assistant(tool_calls)` 而保留下属 `tool` 消息 → provider 整体 400 → 长任务中断 |
| 复现证据 | `acceptance/block-348/results-t7-rerun.json`；冻结场景 20k 窗口 7 次调用即复现 |
| 动作 | 裁剪时保持 `assistant(tool_calls)` ↔ `tool` **原子性**（成对裁 / 成对留）；补契约测试（构造不含 tool_calls 的 tool 消息 → 判红） |
| 验收 | ① T7 重跑 `completed`，8/8 完成率可复算 ② 20k 窗口场景无 provider 400 ③ `npm run closeout` 16 门绿 |
| 命令 | `node scripts/block348-task-runner.mjs --task t7 --tag c45-fix`；新契约测试；`npm run closeout` |
| 体量 | 1 会话 |

#### A-2 · C-46 pack 仓两件

| 字段 | 内容 |
| --- | --- |
| 启动条件 | **pack 仓（gewu-pack-bio）工作授权**——兄弟仓，不在本仓 `touchSurface`，未授权不得改 |
| 精确文件 | `plugins/deseq2/scripts/deseq2.R:72-73`；兄弟仓 `origin/main=c58d328` |
| 缺陷 | ① 跨行字符串常量（R 无隐式拼接）→ **任何 deseq2 运行必失败** ② pack 0.2.x 交付（`views.resultSurfaces` 等）未回流 latest → UI-532 正面渲染结构性缺席 |
| 动作 | ① `paste0` 合并两行 ② pack 仓补交声明并回流 |
| 验收 | deseq2 实机跑通一次（有输出产物）；回流差异清单归零；UI-532 证据补齐 |
| 命令 | 授权后在 pack 仓内定；本仓仅更新 backlog 状态 |
| 体量 | 0.5 会话 + 兄弟仓操作 |

#### A-3 · G1 启动裁决

| 字段 | 内容 |
| --- | --- |
| 启动条件 | **用户显式发令**（`docs/block-354-readiness-report.md` 红线：6/6 就绪 ≠ 已出籍；总纲与计划均不是 G1 授权） |
| 前置事实 | `scripts/block354-readiness.mjs` 复算 **6/6 达标**；`closeout` 16 门绿 |
| 动作 | 这不是「干活」：发令 → 撤宣称红线 → AUDIT-LOG 出籍登记 → roadmap/registry 状态回写 |
| 验收 | 就绪度可复算；宣称口径与阶段一致；G1+ 项（真实 Provider 矩阵 / 生态市场 / i18n / hooks）另行立项 |
| 建议 | **先清 A-1 再裁决**——C-45 是 P1 产品缺陷，带病出籍会把韧性问题带进 G1 |

#### A-4 · C-47 文件树连翻页惰性 / 回弹

| 字段 | 内容 |
| --- | --- |
| 启动条件 | **人工复现归因后立票**（当前是「观察，未归因」，backlog 明确写了启动条件） |
| 证据 | `acceptance/block-349/block349-bigdir-live-darwin.json` B3 |
| 现象 | 首击游标 200→400 正常；其后单击不增长，轮询收敛可把根列表重置回第 1 页；疑似 BLOCK-96 F2 分页 × BLOCK-110 软上限脏位图 / 面板轮询竞态 |
| 动作 | 先复现 + 归因 → 再立票 → 才进入修复 |
| 验收 | 有可复现步骤 + 根因判定；未归因前不得开工 |

---

### B 组：本仓内可直接执行（3 项，仍需逐项发令）

#### B-1 · 348 任务套件 v2

| 字段 | 内容 |
| --- | --- |
| 精确文件 | `acceptance/block-348/tasks.json`（判据）、`scripts/block348-task-runner.mjs`、`docs/block-348-eval-report.md` §3 |
| 动作 | ① T3 判据「英文原句逐字在场」→ 内容等价物 / 双语关键词 ② 补 headless 浏览器链（348 P2：`core/petri-server/helpers/browser-connector.js` 依赖桌面 webview 事件桥，无桥时 25s `transport_timeout`）③ T7 纳入回归（依赖 A-1 修完） |
| 验收 | 8 任务重跑；T3 机械判据与使命判定一致；T4 不再因环境不可得跳过；判据表重新冻结并留指纹 |
| 命令 | `node scripts/block348-task-runner.mjs --all --tag v2`（复跑须带冻结 env） |
| 依赖 | A-1（T7）；不影响其余任务 |
| 体量 | 1 会话 |

#### B-2 · 352 的 4 个 detour 处置

| 字段 | 内容 |
| --- | --- |
| 精确文件 | `acceptance/block-352/shelf-matrix.json`、`docs/block-352-shelf-report.md` |
| 现状 | 三货架 21 项全判定 **17A / 4D / 0S**；4 个 D 项有绕路步骤但无直连路径 |
| 动作 | 逐项给直连路径，或**逐件**显式下架裁决（总纲 §7：不批量删、不为清零下架有用能力） |
| 验收 | 矩阵更新为 `21A/0D/0S` 或每个保留 D 项带裁决理由；`test/block352-shelf-audit.test.mjs` 绿；负测仍判红 |
| 命令 | `node scripts/block352-shelf-audit.mjs`；`npm run closeout` |
| 体量 | 0.5 会话 |

#### B-3 · 用户向能力地图

| 字段 | 内容 |
| --- | --- |
| 精确文件 | 新建 `docs/capability-map.md`（由矩阵生成，勿手改）+ 生成脚本 |
| 动作 | 按**任务**组织（不按工具组织），从 `scripts/functional-surface-audit.mjs` 的结果自动产出「当前能做什么 / 需要什么条件 / 边界在哪」 |
| 验收 | 可复跑生成；纳入 `docs:check`；不出现「能力宣称超出 G0 边界」的表述 |
| 体量 | 0.5 会话 |

---

### C 组：观察 / 人工，不列为自动任务（1 项）

| 编号 | 内容 | 归属 |
| --- | --- | --- |
| **O-1** | C-48 修复后**屏幕观感与点击体感仍待人工确认**（完整重建与进程级实机已全绿，但 UI 观感不是自动化能判的） | 需你实机看一眼； roadmap 明确「未开新工作包」，不单独立包 |

另有两项**长期 reopen**（上轮报告已登记，不进本清单）：MCP 会话档位协商、外部请求审计面。它们属 G1 邻界，需单独裁决。

---

## §2 推荐执行顺序

```
① A-1（C-45，P1 产品缺陷）  ← 先发这条令
   ↓
② A-3（G1 裁决）或 B-1（套件 v2，含 T7 回归）
   ↓
③ B-2（4 个 detour） / B-3（能力地图） 可并行但按单包纪律串行
   ↓
④ A-2（需 pack 仓授权）/ A-4（需人工复现）/ O-1（人工观感）三项按条件触发
```

**单一建议**：先发 `BLOCK-355 开整（C-45）`。它是唯一把「能做」变成「做不完」的 P1 缺陷，修完能把自主完成率从 6/8 推到 8/8，也是 G1 裁决前最该清掉的账。

## §3 发令句式（精准，避免歧义）

| 目的 | 发令 |
| --- | --- |
| 修 C-45 | `BLOCK-355 开整（C-45 压缩 tool 配对），按 docs/next-tasks-2026-11-05.md A-1 执行` |
| 授权 pack 仓 | `授权 gewu-pack-bio，按 A-2 执行` |
| 套件 v2 | `BLOCK-356 开整（348 套件 v2），按 B-1 执行` |
| detour | `按 B-2 执行，下架项逐件给我确认` |
| 能力地图 | `按 B-3 执行` |
| G1 | `G1 启动`（**建议 A-1 收口后再发**） |
| 观感确认 | `O-1 我已实机确认：{结论}` 或 `O-1 挂起` |

## §4 明确不做

- 不重复 C-48 相关工作（已销号）
- 不把 `quality:perf` 波动当 P0 必修（当前 PASS；若要加固见下）
- 不新增功能域 / 工具族；不再做代码面审计
- 不复活已取消四项；未经发令不启动 G1、不宣称 GA / Provider
- 不在 C-47 未归因前立修复票
- 不在 pack 仓未授权前改兄弟仓

**可选加固 J-1**（非任务，仅在 perf 门再次红时触发）：低耗时场景（12–20ms）改「绝对上限 + 相对容差」双判据，避免纯百分比阈值卡在波动带中间；验收=连续 5 次 `npm run quality:perf` PASS 且负测仍判红。

---

*复核命令：`git log --oneline 7a2acfcf..HEAD` / `npm run closeout` / `npm run quality:perf` / `node scripts/block354-readiness.mjs`。*
