---
capability: ui-productization
goal: BLOCK-187 = 黄金路径脚本化与零断点验收批——TTFS 产品化程序（评估报告 §5.1 阶段 1 ②「黄金路径 onboarding 脚本化 + 遥测端点化 + 冷启动深链修复」拆三串行批的第三批，收官批）。①深链=BLOCK-185 completed、②遥测=BLOCK-186 completed，本批=③。把新 Petri 用户的 agent 驱动黄金路径（开应用→建项目→问 Agent→首个任务成功→看结果）脚本化为可机械重跑的验收，断言「≤7 步零断点且 TTFS 可度量」= 阶段 1 出口判据，消费 BLOCK-186 本地漏斗台账的 TTFS。用户授权「按照推荐的进行下去」（2026-10-16）+ 承接「我不希望人参与」→ 验收 100% 自动化无人眼。
acceptance:
  - P1 脚本化：以既有 evals harness（scripts/lib/evals-harness.mjs：spawnIsolatedBackend + startMockProvider + runGoldenTask，已跑 project→conversation→agent 三 POST）为载体，把黄金路径定义为一条（或按模态数条）golden task + criteria，headless 驱动全程；不新建 onboarding 向导 UI（Reading B 显式 defer）
  - P2 零断点审计：逐项核验 ≤7 步 UI 路径无死钮/TODO/未实现/崩溃；`welcome.tsx` sendGuard 项目门控定性为 by-design 非断点；发现真断点则最小修（涉前端产品码随提交带 UI-### 台账行）
  - P3 TTFS 机械门禁：黄金路径脚本收口处断言 funnel_events 落 app_started/project_created/first_job_succeeded 三行 + computeTTFS 非 null，使阶段 1「TTFS 可度量」由脚本机械证明（无人眼）；优先给 evals harness 增 `funnel`/`ttfs` 判据 kind（复用 funnel-log 原语，不重实现 SQL）
  - P4 施工图对账：stale `docs/first-success-path.md`（描述已删 `frontend/src/pages/tools.tsx` 旧 DESeq2 tools-runner 路径）→ 改写/supersede 为 agent 驱动黄金路径真相，保持 tests/fixtures 对它的引用不断链（该 doc 自标 maintained as regression contract）
  - 门禁：docs:check / ui:audit:check（若 P2 触及前端才需 UI-###，纯脚本免）/ golden-path 契约单测 + 自动化实机（隔离后端跑黄金路径断言 ≤7 步零断点 + TTFS 可算，acceptance/block-187/，无人眼）/ test:changed 全绿
  - 完成语义：黄金路径已脚本化且机械重跑绿；≤7 步零断点核验完成；TTFS 从台账机械算出（阶段 1 出口判据闭合）；onboarding 向导 UI 作为独立 UI 包显式 defer 待用户发令
reopen: onboarding 向导式引导 UI（对标 ZCode 六步、需人眼设计评审 + 产品个性自检）→ 另立 UI 工作包，用户显式发令后启动
status: completed
---

# BLOCK-187 — 黄金路径脚本化与零断点验收批（TTFS 程序 ③ 收官批）

- 状态：`completed`（2026-10-16 用户「按照推荐的进行下去」发令 → P0-P5 单会话闭环；验收全自动化无人眼；closeout 十三门全绿）
- 前序：①冷启动深链 = BLOCK-185 completed；②本地漏斗台账 = BLOCK-186 completed（本批消费其 funnel_events + computeTTFS）

## 1. 立项自检（产品个性纪律问句）

「这个能力的形态与 ZCode/Codex 的差别在哪？本地可审计/证据自证体现了吗？」——本批**刻意不做** ZCode 式六步 onboarding 向导 UI（那是借形不改魂里「形」的复刻，且需人眼评审、与用户「不希望人参与」冲突）。自有形态=**证据自证**：把黄金路径变成一条本机可机械重跑的脚本化验收，TTFS 从用户本机 SQLite 台账算出（非厂商遥测），零断点由自动化断言而非人眼确认。向导 UI 若要建，是独立 UI 包（reopen 条款），届时先过产品个性自检再立项。

## 2. 范围（P0 勘察定位，2026-10-16）

| 面 | 实况（勘察结论） | 本批处置 |
| --- | --- | --- |
| onboarding 层 | **不存在**：`App.tsx:2` 注释称「首次启动引导」但零代码；无 welcome/first-run 引导层 | 不建向导 UI（defer）；落地页 `pages/welcome.tsx` 即黄金路径起点 |
| agent 黄金路径 | ≈7 步（触顶）：开 `/`→选/建项目→（文件夹对话框→命名→createProject→POST /api/data/projects）→ SimpleChat 输入→POST /api/ai/conversations+/api/ai/agent→任务 done→结果 | 脚本化为 golden task + ≤7 步零断点核验 |
| sendGuard | `welcome.tsx:167-171` 无项目时拦发送、只展开项目选择器——**by-design**（chip 是项目域），非断点 | 定性登记，不修 |
| 旧施工图 | `docs/first-success-path.md` 指已删 `tools.tsx` 的 DESeq2 tools-runner 旧路径，`§B onboarding wiring` 未闭合且过时 | P4 supersede/改写为 agent 真相 |
| evals harness | `scripts/lib/evals-harness.mjs` 已具备隔离后端+mock provider+runGoldenTask（同三 POST），bootstrapDb 应用全部 src/migrations→**014 funnel 表在场**；smoke 9 题全 PASS | P1 直接以它为脚本化载体（复用，不内联重实现——block186-p4-live 曾内联，本批优先归一到 harness） |
| report_generated | 仅 `final-report.js materializeFinalReport` 经 legacy `tools-executor.js` 触发，agent 路径不发 | 终端锚定 `first_job_succeeded`（TTFS 所需）；report_generated 保持 legacy-only 不硬塞 |

## 3. 非范围（红线）

- **不建 onboarding 向导 UI**（Reading B）：需人眼设计评审 + 产品个性自检，与「不希望人参与」冲突；另立 UI 包待发令。
- **不动 BLOCK-186 单写入器裁决**：`app_started` 仍后端 `server.listen` 记录；TTFS 口径=「系统可用起算」非「Electron 冷启起算」，诚实标注差值（不含窗口创建耗时）。
- **不接 runtime_install / update_succeeded**：承接 186 诚实边界。
- **不引第二路由真相 / 第二度量真相**：黄金路径步数以脚本枚举为真值；TTFS 从 funnel_events 算，不另建计数。
- **G1+ 不外推**：不碰 packaged/Provider/GA/远程端点。

## 4. 执行方案

- **P0 勘察**：已完成（onboarding 缺位实况 + agent 黄金路径 7 步 + evals harness 复用面 + stale 施工图 + funnel 锚点）。
- **P1 脚本化**：黄金路径落地为**永久回归门**——给 `scripts/lib/evals-harness.mjs` 增 `funnel_event_present`/`ttfs_computable` 判据 kind（读父进程经 `readFunnelSnapshot` 注入的快照，复用**已发布** funnel-log 原语 `recentFunnelEvents`/`computeTTFS`，零重实现 SQL）+ 新增 `evals/suites/golden/first-success.json` golden task（`runGoldenTask` 已跑 project→conversation→agent→done，天然发 project_created/first_job_succeeded，后端 boot 发 app_started）；`npm run evals:run -- --suite=golden` 驱动，`evals:gate --suite=golden --update` 建 `evals/baselines/golden.json` 棘轮。**不新建 bespoke `scripts/block187-*.mjs`**（原计划如此，实作改判：evals 套件更耐久且修正 block186-p4-live 曾内联重实现 harness 的债）。契约单测覆盖两判据 kind（纯 ctx）。
- **P2 零断点审计**：以 `frontend/src/pages/welcome.tsx` 共置 vitest 组件测为机械证据（项目选择/创建入口在场、composer 在场、sendGuard 无项目拦发送定性 by-design 非断点、有项目后可发送）；真断点最小修（涉前端带 UI-###），否则登记「零断点核验通过」。
- **P3 TTFS 机械门禁**：golden task 的 `funnel_event_present`×3 + `ttfs_computable` 判据 = 阶段 1「TTFS 可度量」由 evals 套件机械证明（无人眼）；判据 kind 在 P1 一并实现。
- **P4 施工图对账**：改写/supersede `docs/first-success-path.md` 为 agent 驱动黄金路径真相，保 tests/fixtures 引用不断链。
- **P5 收口**：closeout 全链 + 五件套回写 → completed（阶段 1 出口判据闭合注记）。

## 5. 回退路径与并行隔离

- 回退：黄金路径某步产品面若确断且需前端改，走 UI-### 微修随提交；若断点属 G1+/packaged 依赖，诚实分档挂起不硬翻。
- 并行隔离：触碰面=`scripts/lib/evals-harness.mjs`（增 funnel/ttfs 判据 kind + readFunnelSnapshot）+ `evals/suites/golden/**` + `evals/baselines/golden.json` + `test/evals-harness.test.mjs`（新判据单测）+ `frontend/src/pages/welcome*.test.ts(x)`（零断点组件测）+ 黄金路径相关前端最小修（如触发，带 UI-###）+ `docs/first-success-path.md`；当前唯一 active 包，无文件面交叠。
- 环境纪律：走隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录 + bootstrapDb 应用 src/migrations），用户空间零残留、无人眼、不依赖 dev 栈。
