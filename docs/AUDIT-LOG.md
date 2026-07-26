# 审计广播台 (AUDIT-LOG)

> 本文件只保存需要主 Agent 看见的活跃广播与最近处理记录。
> 每次会话先读本文件；只有追溯问题来源时才读取[完整历史归档](./archive/checkpoints/audit-log-through-2026-07-26.md)。
> 非主 Agent 发现阻塞、可安全合并或需评估事项时追加到“当前待处理项”，不要把长篇完成历史重新堆回本文件。

最后更新：2026-07-26（G0-RS-P4R-0 已收口；并行完整性审计发现 2 项 🔴 阻塞，见下）

## 当前待处理项

| 状态 | 日期 | 事项 | 处置边界 |
| --- | --- | --- | --- |
| 🔴阻塞 | 2026-07-26 | **G0 `macos-arm64: qualified` 的视觉证据不成立。** `acceptance/g0-qualification/packaged-ui/` 5 张 PNG 只有 4 个唯一 sha256：`chat-summary-light-wide.png` 与 `restart-restored-light-wide.png` 逐字节相同（均为 `bb54acff…`），即「重启后恢复」证据是重启前截图的副本。`scripts/g0-qualification-visual.mjs:59-62` 只校验哈希格式/宽高/字节数，无唯一性断言；配套 `inspection.json` 为 811 字节九个人工布尔值，仓库内无任何写入者。该形态与 `core/shared-backend/result-studio-qualification.js:113-121` 判 RS9 non-qualifying 的理由（`inspection_booleans_are_human_assertions`）完全一致，但该理由未推及 G0 自身 | 仅登记事实。**不得**由 Agent 擅自变更 `core/shared-backend/g0/support-matrix.json` 的 `qualified` 状态或 `evidence-ledger.json` 的 `visual_state_convergence`——资格状态变更属用户决定。修补检查脚本（加 `distinctStates` 唯一性断言）会使当前 G0 门变红，需先获批 |
| 🔴阻塞 | 2026-07-26 | **空转前端门共 8 处，`be0a6de` 只修了 p2/p3/p4 三处。** 残留：`g0-lf0-acceptance.mjs:203`、`g0-first-wave:66`、`g0-second-wave:73`、`g0-third-wave:50`、`g0-fourth-wave:45`、`g0-fifth-wave:46`、`g0-rs8-lifecycle:54`、`g0-rs9-product:34`。全部经 `npm run check` 链（59 门）可达，因此 underwrite G0 `maintained` 的 LF0/wave 验收门同样在零测试下报 `passed:true` | 按 `be0a6de` 同法改为 `npm run test:files` 并重生成各自证据。修复后可能暴露此前被掩盖的真实失败，属预期结果，不得为通过而回退 |
| 🔵进行中 | 2026-07-26 | `G0-RS-P4R-0 Truth Baseline` 已收口（`ad32e3e`）：真实语料、隔离捕获、请求瀑布与冻结预算均已落地，专项门 `npm run g0:result-studio:p4r` 10/10。实测事件循环峰值 541ms 超出冻结的 250ms，归因 `/api/result-studio/interaction`，该修复归 `P4R-1` | P4R 收口前不得启动 P5～P7；P4R 证据 non-qualifying。冻结预算不得为通过而调高 |
| 🟡建议 | 2026-07-17 | `capability-provisioning.js` 的下载实现与 plugin-manager 各自维护 | host 白名单已经修复；共享下载 helper 只在改动该能力时评估，不阻塞 RH0 |
| 🟡待评估 | 2026-07-17 | 本地分支 `codex/fix-collapsed-right-titlebar` 尚未采用，且与当前 UI 已有语义重叠 | 不直接 merge；进入相关 UI 工作时先比较当前实现，再决定删除或重做 |

当前有 1 项 🔴 阻塞（见上表），没有 🟢 待合并项。

## 最近处理记录

| 日期 | 结果 | 检查点 |
| --- | --- | --- |
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
