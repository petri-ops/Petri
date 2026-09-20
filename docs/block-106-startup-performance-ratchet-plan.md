# BLOCK-106-STARTUP-PERFORMANCE-RATCHET — 启动性能回退清偿与首屏负载治理

**状态**：`active（2026-09-20 Windows 侧立项即启动；用户裁决「开 BLOCK-106」；phase=P0-LAUNCH）`
**立项**：2026-09-20（Windows 会话，性能面系统性评估的产出直接结转为本包，评估证据即本包 §0）
**责任轨道**：BLOCK（多工作面：dev-verify 度量层 + 前端构建拓扑 + 桌面侧 SQLite 迁移，且含数据契约注释纠错）

## 0. 问题定义（全部为本次实测证据，非推测）

### 0.1 启动性能六段全量回退，且没有任何东西拦它

`npm run verify -- block101-startup-timeline`（自管测试实例，未扰动用户主窗）2026-09-20 复采 5 组，对 BLOCK-101 留在 HEAD 的 2026-09-18 基线：

| 段（ms） | 09-18 基线 | 09-20 复采 | 变化 |
| --- | --- | --- | --- |
| mainReady | 106 | 118 | +11.3% |
| preload | 313 | 360 | +15.0% |
| domContentLoaded | 589 | 629 | +6.8% |
| firstPaint | 796 | 860 | +8.0% |
| windowShown | 889 | 981 | +10.3% |
| didFinishLoad | 890 | 984 | +10.6% |
| **dataReady** | **984** | **1163** | **+18.2%** |

BLOCK-101 的目标语义是「瞬时加载 · 用户无感」，仪表（`src/main/startup-timeline-bridge.js` + `frontend/src/hooks/useStartupTimeline.ts`）当时建成了，但**没有配阈值断言**：`dataReady` 在本仓只出现在 `scripts/dev-electron-profile.mjs`（分析工具，非门禁），所以 12 天里六段齐涨无人报红。

同时该度量**不可归因**：`dataReady` 的定义是「左栏 projects 首次到货」（`useStartupTimeline.ts:25`），而证据 `raw[0] keys = main,paints,domContentLoaded` 不记录项目数、`task_events` 行数与前端构建产物字节数——旧基线是 9 个项目、当前是 10 个，这条曲线因此无法判定涨幅来自代码还是环境。

### 0.2 首屏负载：3 MB 单 chunk，页面全部静态引入

`cd frontend && npm run build` 实测：主 chunk **2,989.47 kB（gzip 945.66 kB）**，Vite 自身报 `Some chunks are larger than 500 kB`；CSS 单文件 544,695 B。成因以文件行可溯：

- `frontend/src/App.tsx:23-41` 将 home / welcome / project-workspace / result-studio / skills / plugins / settings / knowledge / review / 窗口面 全部**静态 import**；同文件 `:4` 已引入 `lazy/Suspense`、`:7` 已在用 `lazy(() => import(...))`——分路由懒加载是接现成管道，不是新增机制。
- 按需功能被打进主包：`@xterm/xterm` 及其 CSS 在 `frontend/src/hooks/useTerminalTabs.ts:2-3` 静态引入；`highlight.js` + `rehype-highlight` 静态引入（聊天 markdown 路径）。
- 对照组（同仓已存在的正确做法）：`pdfjs-dist` 走动态 import，独立成 365.12 kB chunk。xterm / highlight.js 照此办理。

### 0.3 数据层规模债集中在一张表

只读探针在**临时副本**上跑（活动库零写入）：

- `task_events` = **236,087 行 / 13 天 ≈ 18k 行/天**；dev 库文件 47.8 MB。
- 行体积倒挂：`payload` 合计 11.6 MB，而 `task_id + event_type + created_at` 文本合计 **15.4 MB**（`avg_taskid=36` vs `avg_payload=52`）——36 字符 UUID 在 23.6 万行逐行重复。
- 保留清扫缺索引：`core/biof3-server/agent-task-store.js:321` 的 `DELETE ... WHERE created_at < datetime('now','-30 day')` 计划为 `SCAN task_events`，该条件扫描实测 **35ms**；调用周期 24h 一次（`:337-340` 递归 `setTimeout`），**当前不痛，但成本随表线性增长**（表到千万行级即单次阻塞事件循环秒级）。副本实测补 `idx_task_events_created_at` 建索引 110ms，之后计划转 `SEARCH ... USING INDEX`。
- 契约错标：`agent-task-store.js:315` 注释写「created_at 为 SQLite `datetime('now')` 格式」，实测列值为 JS ISO 串（`2026-09-07T13:53:33.759Z`，含 `T`/`Z`）。与空格分隔的 cutoff 串做字典序比较时，边界当日行永不落入删除窗——注释是错的，且这个错会误导后续改动者。

### 0.4 一个安全路径文件在 diff 里不可见

`src/ipc/file-dialog.js:171` 的文件名校验正则里嵌的是**真实 U+0000 与 U+001F 控制字节**，不是 `\u0000-\u001f` 转义文本。后果实测：git 判定该文件为二进制（`git diff --numstat` 输出 `- -`），任何对这条文件名安全校验的改动在 diff / grep / 评审工具中**完全不可见**。跨版本核对（`5a4df305^`、`6117e7fc`、`81ea1364` 三个版本均含同 2 字节）确认属长期存量，非 2026-09-20 Mac lint 批引入。正则语义本身等价（类内真实控制字符仍能匹配），故这是**可评审性缺陷而非功能缺陷**。

### 0.5 明确不成立的性能命题（防止反向过度优化）

实测证据支持「不做」下列常见建议：

- 接口层不慢：`/api/health` 1.35ms、`/api/ai/conversations?limit=1` 2.89ms（本地 :3001 直采）。
- 事件读路径已正确：`listEvents` 带 `seq > ? ORDER BY seq LIMIT ?` 游标（`agent-task-store.js:392-395`），最热 task 全量 15,646 行读取 14ms 且命中 `idx_task_events_task_seq`。
- WAL / `busy_timeout=10000` / `synchronous=NORMAL` / 66 个索引 / `cache_size=-16000` 均在位。
- ANALYZE：`sqlite_stat1` 确实不存在，但副本实测 ANALYZE 后查询计划**无变化**（主读路径本就命中索引）→ 收益在当前规模≈0，不为它立项。
- `mmap_size=0`：同一大扫描实测 42.09ms → 64MB mmap 后 19.44ms（2.2x），但当前无全表热路径 → 登记 §7 候选，不随包做。

结论：本地单进程 + 无网络瓶颈形态下，任何缓存层、读写分离、分库分表建议均无依据，本包不采纳。

## 1. 范围（P0→P3）

- **P0 度量可归因化 + 阈值棘轮**（先让回退可被抓住，再谈优化）：
  - `block101-startup-timeline` flow 侧补记归因上下文：项目数、`task_events` 行数、前端主 chunk 字节数、`HEAD` SHA；
  - 新增中位数上限断言（首轮以 09-20 复采中位数 + 20% 裕量设线，之后**只许收缩不许放宽**，与 BLOCK-105 lint 抑制基线同族棘轮语义）；
  - 连采两轮估计方差，避免把抖动当回退。
- **P1 首屏负载治理**：`App.tsx` 路由级 `lazy` + 共享 `Suspense` 骨架（不得出现白屏/布局跳动）；`@xterm/xterm`、`highlight.js`/`rehype-highlight` 改按需动态引入（pdfjs 为现成参照）；复测 `npm run build` chunk 报告。
- **P2 数据层与可评审性**：补 `idx_task_events_created`（**实施时对 plan 原写法的一处纠正**：原写「新增 `src/migrations/0NN_*.sql`」，实查 `task_events` 的 DDL 与索引由 `core/biof3-server/agent-task-store.js:271/:300` 自持、桌面 `src/migrations` 不管这张表，故按模块既有姿势在 schema 数组补 `CREATE INDEX IF NOT EXISTS`，幂等且无需迁移文件）；纠正 `agent-task-store.js:315` 格式错标并把清扫谓词改为 **JS 侧 ISO cutoff 作参数**（原实现拿 SQLite 空格格式串比 ISO 列值，字典序在 `T`(0x54) vs 空格(0x20) 处失配 → cutoff 当日早于该时刻的行漏删 ≤24h；实测该表 236,087 行全为 ISO 形态、无混合行）；`src/ipc/file-dialog.js:171` 真实控制字节改转义写法；`hygiene:check` 增检查项 5「文本源码含真实控制字节」。
- **P3 收口对账**：closeout 八门 + 启动 timeline 前后对账（**门禁必须变绿且 `dataReady`/`windowShown` 中位数实测下降**；未达成则如实登记未达成，不得以「方向正确」替代数字）+ canonical 回写（plan/registry/roadmap/AUDIT-LOG/handoff）。

## 2. 非范围（红线）

- **轮询改推流不属本包**：`ToolActivityDock.tsx:104/:133` 两处 1s 轮询并入 SSE（`core/biof3-server/routes/ai-agent/events.js` 已有通道）属独立候选包——需先有帧时/事件循环基线，本包 P0 只登记不改。
- **长列表虚拟化不属本包**：聊天消息流 / 文件树 / 知识文档列表无虚拟化是实测事实，但引入虚拟化库要过 `DEPENDENCY-CHANGE-CHECKLIST`（默认答案「不做」），且需实机帧时验收，另包裁决。
- **`task_events` 数据模型改造不属本包**：UUID `task_id` → 整型外键可省约 8 MB 冗余，但涉跨表写入契约与历史行迁移，当前无实测痛点，不在本包动。
- **`RightFileTree.tsx:199`「本地 fs 轮询零成本」断言**：本包只做度量取证与登记，优化另议。
- **不做依赖新增**、**不碰 `frontend/package.json` 与 `frontend/package-lock.json`**（P6 源绑定集合）、**不碰 vite 8 / vitest 5 / react-router 7 升级**（🟡 已裁决归 P6 重打同批）。
- **packaged / Provider / 双架构构建性能矩阵属 G1+**，本包全部证据为 dev 态，不外推。

## 3. 依赖、环境纪律与并行文件面隔离

- dev 栈在跑（:3001 后端 / :3005 网关 / :9222 主窗 CDP）；后端代码变更后必须重启 dev Electron 再采数。
- 实机验收一律走 BLOCK-100 自管测试实例（`:9223`），零扰动用户主窗口。
- **与 Mac 侧 BLOCK-105 §7 Batch-2 的文件面隔离**：本包**不触碰** `eslint-suppressions.json`、`frontend/eslint-suppressions.json`、`eslint.config.mjs`、`scripts/check-ui-productization-audit.mjs`（Mac 在制面）。若 P1 改动触发 lint 新增违规，按 BLOCK-105 三分类处置并把基线刷新动作**留到收口时与 Mac 协调后单独一批**，不抢改基线文件。
- P1 主改面 `frontend/src/App.tsx`、`frontend/src/hooks/useTerminalTabs.ts` 与 markdown 渲染路径：开工与收口前各 `git fetch` 一次对账，撞车以内容合并、不覆盖对端。

## 4. 证据位置

`acceptance/block-106/`（P0 两轮基线 + 阈值断言输出、P1 build chunk 前后报告、P3 前后 timeline 对账）。BLOCK-101 既有 canonical 证据 `acceptance/block-101/block101-startup-timeline.json` 由本包 P0 改写时保留旧值在 §0.1 表内可溯。

## 5. 验收门禁清单（收口时逐项对账）

1. `npm run verify -- block101-startup-timeline` 全断言 allPass，且证据含 §1-P0 新增的归因上下文字段。
2. 阈值棘轮：人为把上限调低于当前中位数时断言必须红（自测证明门禁非空转），恢复后绿。
3. `cd frontend && npm run build` 主 chunk 字节数下降并留前后对比；Vite 500 kB 警告是否消除如实记录（未消除要写明原因）。
4. 前端定向测试：`npm run test:files --prefix frontend -- src/App`（及相关组件）+ `tsc --noEmit` 0 错。
5. 迁移门禁：`npm run test:changed`（含 migration-runner / schema 相关定向）绿；`schema_migrations` 版本推进可断言；`EXPLAIN QUERY PLAN` 由 `SCAN task_events` 转 `SEARCH`（前后各一次实采）。
6. `hygiene:check` 含新检查项 5 且 `src/ipc/file-dialog.js` 不再被判二进制（`git diff --numstat` 出现行列数）。
7. closeout 八门全绿 + `docs:check` PASS。

## 6. 完成语义

- 本包 `completed` 的判据是「**门禁能抓住回退** + **首屏负载实测下降** + **规模债转为索引级可控**」三条同时成立，缺一条按实际状态登记（例如 `completed-with-gap`）。
- 「启动更快」不得只由 bundle 变小推断——必须有 timeline 数字前后对账。
- 预期节奏：P0→P3 目标一次会话收口；若 P1 触发前端渲染回归需跨会话，按阶段登记 `P#-COMPLETED`，不外溢后续阶段范围。

## 7. 遗留候选（只登记，不随包做）

- `mmap_size` 由 0 调到 64MB（实测大扫描 2.2x，本地盘适用；需与 SQLite 域包一起裁决）。
- ANALYZE 启动期一次性执行（当前规模收益≈0）。
- `task_events` 事件按天/按 task 归档或摘要压缩（18k 行/天的长期治理）。
- 轮询→SSE 与长列表虚拟化（各自独立包）。
- `RightFileTree` 本地 2s 全树刷新的实测结论与可能的降频。
