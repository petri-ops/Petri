# 审计广播台 (AUDIT-LOG)

> 本文件只保存需要主 Agent 看见的活跃广播与最近处理记录。
> 每次会话先读本文件；只有追溯问题来源时才读取[完整历史归档](./archive/checkpoints/audit-log-through-2026-07-26.md)。
> 非主 Agent 发现阻塞、可安全合并或需评估事项时追加到“当前待处理项”，不要把长篇完成历史重新堆回本文件。

最后更新：2026-08-03（P4R-0～P4R-6、P5 与 P6 已完成 source-bound 收口；P7 经用户裁决 deferred；无 🔴 审计阻塞或 🟢 待合并项）

## 当前待处理项

| 状态 | 日期 | 事项 | 处置边界 |
| --- | --- | --- | --- |
| 🟡证据边界 | 2026-08-03 | **P6 stored evidence 不再匹配当前 Result Studio 前端源码。** UX1A 修改了 P6 绑定的八个前端文件，`npm run test:changed` 的 `p6_current_source_tree_not_exact` 按设计 fail-closed | P6 evidence 继续诚实绑定 `ad1e2ce`；只有重跑完整 P6 矩阵才能刷新。P7 deferred 期间不阻塞 UX 小切片，但不得宣称当前源码仍由旧 P6 evidence 覆盖 |
| 🟡延期 | 2026-08-03 | **G0-RS-P7 Honest Product Requalification。** 用户裁决发布级资格工作后移；Result Studio 保持 `implemented_unverified / experimental`，没有 canonical P7 PASS evidence | 重开前必须先解决 selection→enrichment 无 candidate/compare/lifecycle、existing Git consent UI、五条独立 task trace、双 Provider、packaged 六格与 literal OS reboot；历史 RS9、P4R/P6 开发态证据不得冒充资格 |
| 🟡待评估 | 2026-07-26 | **G0 `macos-arm64: qualified` 的视觉证据不成立。** `acceptance/g0-qualification/packaged-ui/` 5 张 PNG 只有 4 个唯一 sha256：`chat-summary-light-wide.png` 与 `restart-restored-light-wide.png` 逐字节相同（均为 `bb54acff…`），即「重启后恢复」证据是重启前截图的副本。`scripts/g0-qualification-visual.mjs:59-62` 只校验哈希格式/宽高/字节数，无唯一性断言；配套 `inspection.json` 为 811 字节九个人工布尔值，仓库内无任何写入者。该形态与 `core/shared-backend/result-studio-qualification.js:113-121` 判 RS9 non-qualifying 的理由（`inspection_booleans_are_human_assertions`）完全一致，但该理由未推及 G0 自身 | 仅登记事实。**不得**由 Agent 擅自变更 `core/shared-backend/g0/support-matrix.json` 的 `qualified` 状态或 `evidence-ledger.json` 的 `visual_state_convergence`——资格状态变更属用户决定。修补检查脚本（加 `distinctStates` 唯一性断言）会使当前 G0 门变红，需先获批。**2026-07-27 用户裁决：暂不发布，故本项降级为待评估、不阻塞开发。** 重开条件：任何对外发布、资格声明或 G0 重新资格之前必须先处理——发布时若仍以此证据支撑 `qualified`，即为不诚实声明 |
| 🟡产品待续 | 2026-08-03 | **Result Studio existing Git 显式同意 UI。** 后端无同意写入风险已在 `e14a8e6` 修复：默认 managed、独立持久 consent truth、生产调用零硬编码 `true` | 前端尚未提供 detected/decisionRequired/dirty risk 与 affirmative opt-in 产品操作；因此 existing clean/dirty 不进入 P7 支持范围，未来不得用直接 API 调用冒充用户同意 |
| 🟡建议 | 2026-07-17 | `capability-provisioning.js` 的下载实现与 plugin-manager 各自维护 | host 白名单已经修复；共享下载 helper 只在改动该能力时评估，不阻塞 RH0 |
| 🟡待评估 | 2026-07-17 | 本地分支 `codex/fix-collapsed-right-titlebar` 尚未采用，且与当前 UI 已有语义重叠 | 不直接 merge；进入相关 UI 工作时先比较当前实现，再决定删除或重做 |

当前没有 🔴 阻塞项，也没有 🟢 待合并项。

## 最近处理记录

| 日期 | 结果 | 检查点 |
| --- | --- | --- |
| 2026-08-03 | `G0-RS-UX1A` 短闭环完成：结果会话首次进入收起左右栏、会话内不反复覆盖用户布局、返回对话恢复；Artifact 409/加载失败以独立“文件不可用”状态替代破图，Header/Inspector/主画布一致并提供重试与 Agent 恢复。开发态 Electron 真实旧 Job 观察通过；前端 32/32、受影响 Node 368/368、P4R 7/7，P6 历史 source freshness 例外单独登记 | UI-116 / UX1A |
| 2026-08-03 | `G0-RS-UX1B` 短闭环完成：展示层把同一科学图的 PNG/SVG/PDF 归并为一个结果项，PNG 默认预览，SVG/PDF 为导出格式，技术/中间文件移入相关文件折叠区；纯函数 9/9、TypeScript、docs/UI 门禁通过。开发态 Electron 真实旧 GO/KEGG Job 确认 PNG 默认预览与相关文件折叠，因该 Job 无同图 SVG/PDF，变体实机观察边界已明确 | UI-117 / UX1B |
| 2026-08-03 | `G0-RS-UX1C` 已启动：主结果卡只保留结果、类型、可用性/校验状态和必要动作；原始路径、导出、脚本、重放等技术信息进入“更多操作”。聚焦前端 16/16、TypeScript 已通过，待开发态 Electron 观察后收口 | UI-118 / UX1C |
| 2026-08-03 | `G0-RS-UX1C` 短闭环完成：主结果卡收窄为结果名、类型、可用性/校验状态和必要动作，技术信息进入“更多操作”；前端 16/16、TypeScript、docs/UI 门禁通过。开发态 Electron 真实旧 GO/KEGG Job 观察确认结果优先层级与文件不可用恢复入口无回归 | UI-118 / UX1C |
| 2026-08-02 | `G0-RS-P6 / P6-1` source-bound 收口：canonical evidence `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json` 绑定 `ad1e2ce`，10/10。真实本地矩阵覆盖 stop、R/validator 失败、精确 R 进程组中断、Electron/owned backend 冷重启、drift、GC、并发候选与资源压力；开发态 Electron recovery 15/15 且低于 5 秒，压力链实际读取 10 万行表、复杂 SVG/PNG、长报告与 100+ 版本。201 条 synthetic Revision 只作为 alias 压力，1500ms 是开发态冷 Vite+Electron 首画布预算；真实 Provider、packaged、literal OS reboot、packaged/in-app 1000ms 与资格仍归 P7。证据为 `qualificationEligible:false`、`p7Eligible:false`；P7 是下一阶段但未启动 | `ad1e2ce` + `rs-p6-durability-recovery-performance.json` |
| 2026-07-31 | `G0-RS-P6 / P6-0` 与 UI-110 source-bound Electron trace 收口：`acceptance/g0-result-studio/rs-p6-ui110-electron-scientific-trace.json` 绑定 source commit `6f5271e`，观测期间 source binding 稳定；空 disposable ledger 的同一真实 BrowserWindow 完成 Result/Compare/History、Composer、高级抽屉、adopt/revert/restore/reopen，并与 7 个 Job、6 个 ChangeSet、26 个 Revision、26 个物理 Artifact 及 Git/validator 精确对账，默认公开 DOM 的敏感路径泄漏断言全部为 false。UI-110 仅在该开发态 Electron 边界内升为 `verified`；证据仍为 `qualificationEligible:false`，P6 当前推进 P6-1，Provider、packaged 与 P7 资格未启动 | `6f5271e` + `rs-p6-ui110-electron-scientific-trace.json` |
| 2026-07-30 | `G0-RS-P5` 真实本地科学编辑收口：`e7f271c` 与 `acceptance/g0-result-studio/rs-p5-scientific-editing.json` 绑定，20/20、无 seeded Revision/ChangeSet/产品账本；SQLite/Job/Artifact Truth 持久 DAG 已建立，缺 graph 的科学/数据/流程编辑明确 fail-closed。五条 admitted 任务覆盖 DEG→GO/KEGG、volcano、heatmap、受影响子图与历史 restore，候选 validator、不可变输入、完整 cohort ReplayPackage 均有独立检查。证据为本地 deterministic context-bound、`qualificationEligible:false`，不宣称 Provider、packaged、恢复/压力或 GA；P6 是下一阶段但未启动 | `e7f271c` |
| 2026-07-28 | P4R-6 与整包收口：`cb73132` 把 canonical Git/SQLite cold work 移入持久 background child，超时/关闭隔离、排空或终止其树，并重读 Project/Job/Artifact Truth；performance 14/14，event-loop 17.99ms ≤ 250ms。`c449e57` 绑定 live 连续 Truth 链和同一 Electron BrowserWindow 的明暗 × 1440/1024/820、键盘/focus、候选 lifecycle、次级失败/重试及服务重启恢复；`252e806` product 20/20。UI-112～UI-115 升为 verified。全部新证据 source-bound、脱敏、non-qualifying；不宣称 Provider、packaged 或 GA。P5 已解锁但未启动 | `cb73132` `c449e57` `252e806` |
| 2026-07-28 | P4R-5 Per-result Code & Reproduce 完成：exact Revision source、历史版本 script identity、独立/共享 scope、复制/下载/项目内打开与 Agent 解释/修改已进入单一 Truth 链；`replayable` Revision 才开放两阶段受控 replay，材料不足明确 unavailable。调用方 script/params/tool/workflowPlan/shell 拒绝，standalone volcano 真实 replay 只生成非 current 候选且重复确认幂等。四类真实 completed Job exact source observation（DESeq2、standalone volcano、gene-correlation heatmap、go-kegg GO-BP）4/4 且 source-bound，不外推为四类均可 replay；P4R-5 Node 15/15，product runner 前端 114/114、Node 137/137，umbrella 前端 151/151，P4R product 17/17。UI-113/UI-114/UI-115 保持 `in_progress`，阶段推进 P4R-6 | `f5c50db` `f72f8ac` `ae6d9c4` `c6b3d72` |
| 2026-07-28 | P4R-4 Version Selector + Codex-like Change Review 完成：Result/Compare/History 真实互斥且可路由；历史主体/interaction/Selection/contextToken 显式绑定 viewed Revision，首次 GET 不写 SQLite、不创建 managed Git；版本按项目/family truth 分页并标注原始/当前/候选/历史。审查摘要来自服务端受信持久元数据；checkpoint 故障与参数/source commit/parent family/project 漂移 fail-closed。focused frontend 104/104、affected Node 258/258、related frontend 48/48、P4R product 13/13；P2/P3/P4/P4R 五份 evidence 全部 source-bound。UI-113/UI-114 保持 `in_progress`，唯一不变量红项仍属 P4R-5 source projection | `f710261` |
| 2026-07-28 | P4R-3 Agent-first Editing 完成：中央自然语言 Composer + 高级参数抽屉；点击时 Artifact/Revision/Selection/token 原子绑定；同 turn 受信 intent、防 selection 重放/分类篡改/script patch/伪 DAG；task/legacy terminal 持久化与 SQLite 重开展示。专项 76/76 Node、134/134 frontend；affected 700/700 + related 102/102；P2/P3/P4/P4R 五份 source-bound evidence 通过。workspace-status 跨 npm/direct 性能比较改为 Git-spawn equivalents，6.785→2.040（-69.9%），不再用不可比裸毫秒 | `3d3eb29` `59b33c4` |
| 2026-07-27 | G0-CHF0 首次完成结论经反例撤销后完成 CHF0-R1～R5 审计修复：volcano 统计量/输出/报告诚实，PCA sample-ID 严格，R/Python raw execution 与真实 `/api/files` 来源/路径边界 fail-closed，PID-gated heartbeat、独立硬预算、确认式 TERM→KILL、cancel/zombie DB 终态一致。专项 5/5、22 tests；29 个 source/producer hashes 与可达实现提交逐一匹配；影响范围 206 pass / 0 fail / 4 skipped | `41a365f` + `acceptance/g0-critical-crosscut-hardening/acceptance.json` |
| 2026-07-27 | P4R-2 子阶段完成：实现 result↔chat 滚动位置保持（新增 `frontend/src/components/result-studio/resultScrollMemory.ts` 纯模块按 jobId 缓存 `.resultView` scrollTop，`ResultArtifactShell` 成功态 div 挂 ref/onScroll，mount 时恢复；选择状态因 `activeArtifact` 是宿主 state 且 `updateWorkspaceMode` 不重置而天然保持）。7/7 单测，result-studio 全量 84/84 无回归。证据 `rs-p4r-performance.json` 13/13、`rs-p4r-product-reframe.json` 7/7 已刷新至 HEAD `4f9d89f`（FROZEN_BASELINE 常量未动）。不变量 3 仍红（归 P4R-5）。当前阶段推进至 P4R-3 | P4R-2 scroll preservation |
| 2026-07-27 | 六维度横切审计（科学正确性/安全/用户旅程/后端/前端/治理）完成，完整依据登记为 `docs/project-wide-audit-2026-07.md`（`AUDIT-PROJECT-WIDE-2026-07`，`status:reference`，`qualificationEligible:false`），`docs/README.md` 加入口，关键硬伤进本表 🟡待评估。发现 14 项科学正确性缺陷、8 项安全/隐私问题、`POST /api/run` 执行真相旁路、`fetchData` 错误不清 bug 等。审计只读代码未跑全量，不升级任何资格，不动 P4R 主线 | `project-wide-audit-2026-07.md` |
| 2026-07-26 | 空转前端门共 8 处（`be0a6de` 只修了 p2/p3/p4）。实测确认比原判更糟：不带文件过滤的 `npm test --prefix frontend` 在工作树干净时同样返回「No test files found」并退出 0，而干净正是提交与验收时的常态，因此 underwrite G0 `maintained` 的 LF0/wave 门一直在用零测试的前端结果背书。已修 7 处活跃门（修后同一门真跑 39 文件 / 294 测试）；`g0-rs9-product-acceptance.mjs` 属 RH0 封存的历史证据读取器，刻意不动并单独登记 | `295dd73` |
| 2026-07-27 | P4R-1 服务端与前端主体规则落地。实测推翻计划对成本构成的判断（工作区扫描 0%、hashing <5%，93% 为 git 子进程），故未做架构改造：`detectGitRuntime` memo、`repositoryState()` 三次 fork 改惰性、每 revision 的 rev-parse 批量化。`changesets` 42.102→1.203ms；`workspace-status` 以同次 Git spawn 校准从 6.785→2.040 equivalents（-69.9%，不跨 npm/direct 比裸毫秒）；增长斜率 20ms/revision → 0.18（200 revision：4179ms → 66ms）。另按 `write` 标志停止只读路径写绑定，并抽出 `resultBodyState.ts` 接线三处无条件清空点。不变量 2b 与 4 转绿，仅剩 3（归 P4R-5）。P4R-0 基线已冻结为常量，重跑不再覆盖 | `225ca0f` `2a160df` `2004008` `b6e7e91` `b5d073a` |
| 2026-07-26 | P4R-0 补齐此前遗漏的「失败测试先行」交付物：`test/p4r-invariants.test.mjs` 四条不变量按代码实况书写，①/②a 通过（锁为防回归），②b/③/④ 如实为红并各自指向精确缺陷位置（`result-studio.js:320-330`、缺失的源投影路由、`project-workspace.tsx:3602-3612` 与 `:3366-3378`）。独立入口 `g0:result-studio:p4r:invariants`，**不并入聚合门**。专项门 `g0:result-studio:p4r` 12/12 | P4R-0 invariants |
| 2026-07-26 | `g0:lf0` 红门根因查明并修复：`G0-START-01/09` 断言的是 `AUDIT-LOG.md` 里一句中文散文（`HLE-C4R/HLE-C5 已完成生产收口`），而 `5bb2263`（RH0 按治理规则压缩广播台）把它移入归档，于是遵守规则反而打断了 G0 门，并级联使 `G0-LF0-01` 失败。改为断言该句所报告的真实证据（`hle-all-gate` 12/12 + 三份生产矩阵 `passed` + agent 三轨），门恢复 START 10/10、LF0 10/10 | `g0:lf0` closeout |
| 2026-07-26 | 修复 p2/p3/p4 验收脚本的空转前端门：三者都用 `npm test --prefix frontend`（= `vitest run --changed`），叠加文件过滤后选中 0 个测试并退出 0，被记为 `passed:true`；是否真跑取决于 git 改动状态。仅 p2 因 `RS-P2-16` 读取 stdout 中的 renderer 性能标记而暴露。已统一改为 `npm run test:files` 并重生成三份证据（p2 17/17、p3 20/20、p4 18/18）；渲染器本身从未超预算 | `be0a6de` |
| 2026-07-26 | P4R-0 起步：env 门控性能探针（事件循环直方图 + 按脱敏路由模板的请求计时），默认 off、`/api/__perf/*` 不挂载；只跑了定向测试 `perf-probe 9/9`+`test-affected 4/4`，未跑全量 | `340c09a` |
| 2026-07-26 | P4 Core 统一手动/Agent 编辑形成 18/18 离线实现检查点，状态保持 `implemented_unverified` | `e0a4c7d` |
| 2026-07-26 | 四份已完成审计无损移入 `docs/archive/checkpoints/` | `e38d6b5` |
| 2026-07-26 | RH0 作为 P4R 前唯一串行阶段写入 canonical | `2840673` |
| 2026-07-26 | RH0 定向测试、脚本/tmp 生命周期和最终全量基线收口；下一阶段转为 P4R | RH0 closeout commit |
| 2026-07-26 | RS9 历史脚本仍被封存证据引用；移出日常 syntax，保留显式历史 syntax 入口 | repository governance follow-up |
| 2026-07-26 | P4 治理后源哈希刷新，专项门恢复 `18/18`；未改变 `qualificationEligible:false` | P4 current evidence |

## 广播规则

- 🔴：阻塞当前验收，主 Agent 必须优先处理。
- 🟢：已有独立提交且可安全合并，主 Agent 必须先核对。
- 🟡：建议或待评估，不阻塞当前工作。
- 🔵：当前唯一进行中阶段。
- ✅ 完成事项只在“最近处理记录”保留一个紧凑条目；详细证据进入 canonical 计划、Acceptance 或归档。
- 不在本文件保存凭据、用户数据、绝对结果路径或隐藏推理过程。
