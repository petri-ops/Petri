# BLOCK-121 — 开发态结果闭环垂直切片（Result Loop Vertical）

> 立项：2026-09-25（active，P0-LAUNCH）。
> 用户裁决：本会话阶段评估（三维进展盘点）后用户裁决「可以的 开始吧 一次性搞定」+「开始」——
> 批准三件套：①D7 领域中立红门清偿（本日已完成，2f1314a/71b24c9f）②CK-11 保留面冻结为
> knip 棘轮（本日已完成，c819f144）③**结果闭环工作包立项（本文件）**。
> 阶段定位：G0 开发期。工程治理面已连续多批收口（CK 表全清、棘轮双门就位），下一阶段
> 价值主线是把产品主闭环在开发态收实，而不是继续清债或提前进入发布面。

## 1. 一句话目标

用户在 dev Electron 里对一个真实项目跑完一次插件分析，在 Result Studio 看见**可信**
（标注真实、非占位）结果，并让 Copilot **基于该结果**继续提问与操作，整条路径有实机
验收证据——把「页面做了、标 experimental」的松散面收成一条端到端 verified 的路径。

## 2. 范围（scope）

1. **选一条组学分析路径做垂直闭环**（P0 勘察定夺，候选=scrna_standard 标准分析：插件
   执行 → 结果产物入库/打开 → Result Studio 展示与复核 → Copilot 引用该结果继续问答/
   建议下一步）。选择判据=现有能力最完整、断点最少、对用户最有代表性。
2. **该路径的实机验收 flow**（`.agents/skills/gewu-dev-infra/dev-verify/flows/`），断言
   覆盖：分析产出落库、Studio 展示与真实数据一致（非占位/非实验态文案）、Copilot 能取
   到并引用该结果内容作答。
3. **该路径上咬人的洞就地修**：定向测试图漏掉的契约、实机暴露的断链。flaky 零容忍
   （重跑变绿必须登记并有归宿，不得计为通过）。
4. **体验只修该路径上观测到的失败**（有实机观测再动，不做无观测支撑的重写）。

## 3. 非范围（exclusions，红线）

- **不启动 G1+ 事项**：Provider / 公证 / 签名 / GA / dist staleness / `qualificationEligible`
  ——维持「G0 开发期常态 · 不外推 packaged/Provider/GA」。
- **不摊开 Result Studio 剩余阶段**：RS-P7 维持 deferred；Result Studio 整体保持
  `implemented_unverified / experimental`，本包只对**选定路径**给出 verified 证据，
  不改全局资格状态。
- 不做无观测支撑的体验重写（长列表虚拟化等维持观察态，重开条件在案）。
- 不新增运行时依赖（DEPENDENCY-CHANGE-CHECKLIST 默认 no）。
- 不重跑发布前全量门禁；定向优先纪律不变。

## 4. 依赖与环境纪律

- dev 栈：fnm Node 24 + `npm run dev`（remote-debugging-port）；**后端变更须重启**才生效。
- 并行包文件面零触碰：当前无其它 active 工作包（CK 队列全清）。
- 复用既有能力，不另起炉灶：插件执行链、Result Studio 展示、`/api/ai/interpret`、
  Copilot result-context 工具面、BLOCK-98 steer、BLOCK-119 评判门（汇报质量）均已在册。

## 5. 阶段划分与完成语义

| 阶段 | 内容 | 出口判据 |
| --- | --- | --- |
| P0 勘察 | 选定路径 + 盘断点清单 + 定 flow 断言清单（写入本文件 §6 附录） | 路径与断言清单定稿；若发现路径已基本通，P1/P2 相应收缩（诚实收缩入册） |
| P1 路径走通 | 实机把选定路径端到端走通，断点修复 | dev-verify flow 全断言绿（真实模型/真实插件执行，非 mock） |
| P2 Copilot 接线 + 收口 | Copilot 引用该结果的语义核验（答非所问=断点）+ 定向测试补洞 + 收口 | flow verified + 定向 0 红（flaky 登记制）+ closeout 十一门绿 + output:judge PASS |

**完成语义**：completed = 选定路径在 dev Electron 边界内 verified（G0 阶段最高证据等级）
+ 收口链绿 + canonical 回写（本文件/roadmap/handoff/backlog/AUDIT-LOG/UI 台账若有 UI 面）。
不宣称超出 dev 边界的资格。

## 6. 证据位置

- 实机 flow 证据：`acceptance/block-121/`
- UI 台账：涉 UI 增量时同步 `docs/ui-productization-audit.md`（UI-###，in_progress →
  用户过目/实机取证后 verified）
- 定向测试：随改动文件面登记 impact-map，`npm run test:changed` 可复现

## 7. 验收门禁清单（收口逐项对账）

- [ ] dev-verify flow（P0 定名，建议 `block121-result-loop`）N 断言全绿，证据落 acceptance/block-121/
- [ ] 定向测试 0 红，flaky 零容忍（如有登记+归宿）
- [ ] closeout 十一门绿（含 quality:knip:check 保留面棘轮——本包新增死代码即红）
- [ ] output:judge 判收口声明 PASS（首判 RETRY 按判词重写复判）
- [ ] canonical 五件套回写 + docs:check PASS

## 8. P0 勘察结论（2026-09-26 定稿）

### 8.1 选定路径：deg / deseq2 差异表达分析（deg-analysis-standard）

判据（「现有能力最完整、断点最少」）逐项对照后 **deg 胜出，scrna_standard 出局**：

| 事实 | deg/deseq2 | scrna_standard（seurat-standard） |
| --- | --- | --- |
| 插件态 | **激活**：运行栈 catalog 实证 deseq2 已载（`/api/tools/catalog` 唯一工具） | **休眠**：`../gewu-pack-bio/plugins.dormant/seurat-standard`，需先激活 |
| 演示数据 | 包内自带（`demo-data/deseq2/demo-counts.csv + demo-coldata.csv`） | **包内无 scrna 演示数据**，需外部获取数据集 |
| 运行时 | 本机 R 运行时在位（`.biof3-dev-user-data/data/runtimes/R/bin/Rscript.exe`） | 同一 R 运行时，但 Seurat 库在位未实证 |
| 历史证据 | pack-lifecycle A8 曾在本机真实跑通（deseq2→completed） | 无 |
| 语义层 | interpret.js 原生支持 `deg` 解读分支 | 支持 `scrna_standard`，但链路断头同 deg |

scrna 登记为后续候选（重开条件=包内激活 seurat-standard + scrna 演示数据入库）。

### 8.2 链路事实（三路探查实证，file:line 见勘察记录）

1. **发起**：主路径=自然语言 → agent loop → `run_tool(deseq2)`（`agent-tools/learning.js:700`；
   AnalysisLaunchPanel 把「运行」转成 chat 消息，`RightPanel.tsx:225`）。执行核=`tools-executor.js`
   → 插件脚本 → 产物带 sha256 artifact-truth（`tools-executor\result-files.js:37`）。
2. **落库与自动打开**：`tool_jobs.result_json` + 产物落 jobDir；agent 通道成功后前端自动派发
   `projectOpenResult`（`conversationRunStore.ts:549-559`）→ workspace result 模式 →
   `ResultView`/`ResultArtifactShell`（`CenterPanel.tsx:148`）。
3. **可信徽标**：truthStatus=`valid` → 「可信结果」（`result-studio/resultSurface.ts:164-175`），
   真值链=`Revision.validationStatus ?? deliveryManifest.status ?? artifactTruth`
   （`ResultArtifactShell.tsx:618,966-970`）。**与 G0 qualificationEligible 完全解耦**（前端零
   引用资格评估器），无需触碰资格面。
4. **Copilot 引用（真实缺口所在）**：跨轮无任何工具可按 jobId 读回结果内容——
   `result_studio_context` 明示不含结果值（`tool-defs/result-studio.js:313-319`）；run_tool 摘要
   仅同轮可见且截断 6000 字符（`tool-execution.js:10`）；服务端表格查询
   `result-studio-table-query.js:228-258`（limit≤100）**已存在但未接 agent 工具**；
   `/api/ai/interpret` 前端调用已删（孤链，不接回）。

### 8.3 断点清单

- **B1（P2 修）**：Copilot 跨轮读结果无工具 → 新增有界只读工具 `result_summary`（jobId →
  工具/状态/产物清单/manifest 分节/主表前 N 行与关键统计，走既有 table-query 服务，遵守
  result_studio_context 同款有界纪律）+ 注册四件套（tool-defs/registry/contracts/前端
  label+icon fixture 三面同步，BK-04 先例）+ system prompt 分析历史块提示该工具。
- B2（不修，契约在案）：工具输出 6000 字符截断、harness headers 截断。
- B3（不修，legacy 面）：interpret 孤链维持孤链，新工具直读 tool_jobs 内容。
- B4（环境事实）：scanpy 面本机无 Python 运行时，Py 侧断言不做（同 pack-lifecycle 诚实边界）。

### 8.4 flow 断言清单（`block121-result-loop`，P1 落地 A1-A4，P2 增 A5）

- A1 `catalog_deseq2_loaded`：/api/tools/catalog 含 deseq2（包装载前置）。
- A2 `real_deseq2_run_completed`：经**真实 chat 路径**（POST /api/ai/agent，演示数据先入
  项目工作区）发起，模型自主 run_tool → job completed（真实 Rscript；不走 REST 直跑，
  因 Studio 打开有 conversationId 归属守卫 `project-workspace.tsx:716-721`，且 chat 才是
  用户真实路径与语义本体）。
- A3 `artifact_truth_valid`：result_json.artifactTruth.status='valid' 且产物文件在盘。
- A4 `studio_trusted_badge`：CDP 实机——结果自动打开 result 模式，truthBadge=「可信结果」，
  正文含真实数据元素（非占位/非错误态）。
- A5 `copilot_cross_turn_citation`（P2）：同会话新轮追问「这个结果说明了什么」→ 回答内容
  引用结果真实值（基因名/上下调数字可对回 result_json），证明 B1 工具生效。
- A6 cleanup：临时项目/会话清理。

### 8.5 P1 环境前置（全部实证在位）

- 主 dev 栈在跑（:3001 health ok；`BIOF3_LOCAL_DATA_DIR=.biof3-dev-user-data/data`）；
- 测试实例 CDP 9223（`bash scripts/start-test-instance.sh`，零 fork 直连主栈后端）；
- R 运行时 + deseq2 插件 + 演示数据（`../gewu-pack-bio`）；
- 真实模型供给（dev 栈既有配置，block111/116 系列 flow 同款）。
