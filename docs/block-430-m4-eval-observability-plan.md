# BLOCK-430 · M4 评测与可观测

> 前置：M3=BLOCK-429 completed（带 done-partial）。唯一审计输入：
> `acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md` §4-M4。
> 用户 2026-11-11 预授权连续工作裁决（见 `docs/m-blueprint-2026-11-11-program.md`）。

## 范围（M4-1…M4-6）

| 改进点 | 映射 | 本包交付 |
| --- | --- | --- |
| M4-1 本地长任务 fixture（≥1000 轮合成，生成/校验/删除三命令 + manifest，零出网零真实 Provider） | G-11/M-57 | `scripts/m-blueprint-m4-fixture.mjs` + `generateFixture/verifyFixture` 纯函数 |
| M4-2 长任务成功率/完成度/跨恢复一致性基线 | G-11/M-57/M-58 | `adjudicateLongTaskBaseline()` 纯函数 + 门 |
| M4-3 traceId 贯穿主 loop/subagent/后台/重试/工具 + 可持久化投影 | G-10 | `createTraceProjection()`（跨重启可查、不改 SSE 事件形状） |
| M4-4 usage 三层事实表 + 价格表落配置 + 失败请求也记账 | G-10 | `createUsageLedger()`（model/turn/tool + `model_request_failed`） |
| M4-5 用户可感性能常驻门（DOM 节点 / 滚动 P50·P95 / 首屏 paint / 导出耗时）+ 长列表窗口化 | M-09/M-10 | `adjudicateUserPerceivedPerf()`（植入 400+ 节点必红）+ 窗口化纯函数 |
| M4-6 SSE 真实端点行为测试 + 约 90 个未引用测试分批挂载 | M-55/M-56 | 本包挂第一批 10 个；其余登记 done-partial 带补腿条件 |

全部能力收敛到单一纯模块 `core/petri-server/agent-tools/long-task-observability.js`（零新增依赖）。

## 关键工程裁决（逐项留痕）

- **evals mock/replay 档接入 closeout** 需改 `package.json`（会话起始即在制 WIP，`M` 状态）⇒
  本包零触碰，登记 W 类 `done-partial` + 补腿条件（owner 收口后由用户裁决接线）。
  本包照常前台跑 `evals:run --suite smoke --provider=mock` 与 `evals:gate`，读数如实落证据。
- **`quality:perf` 场景 4→≥7** 需重采基线（红线禁止直接重采/抬阈值）⇒ 登记 V 类
  `external-blocked`；本包只交付用户可感性能的纯判据门与植入必红负测，基线保持不动。
- **真实 Provider / real 档** 一律 `external-blocked`，G0 不外推。
- 不改主循环 / SSE 事件形状 / `MAX_AGENT_ITERS=Infinity` / `workspace_exec` 默认放行；
  零触碰在制 WIP；零 stage / 零提交；零放宽基线。

## 验收门

- `node scripts/m-blueprint-m4-observability-gate.mjs --check`（fixture/基线/trace/usage/性能五类判据）。
- `node --test test/m4-long-task-observability.test.mjs`（HK-01 红→绿）。
- `npm run evals:run -- --suite smoke --provider=mock` / `npm run evals:gate`（当次读数如实）。
- `npm run docs:check` / `npm run test:changed:list` / `npm run closeout`（读数如实）。

## 完成语义

六项各有当次证据且零放宽/零撤销裁决/零新增依赖才标 completed；
未达证据上限项标 `done-partial` / `external-blocked` / W 类 + 补腿条件，
不用文档措辞升级运行时结果；不宣称「稳定完成长任务」除非有当次真实任务证据。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 收口笔录（2026-11-11 · BLOCK-430 / COMPLETED，带 external-blocked / W / done-partial）

**交付**：M4-1…M4-5 五项能力收敛为单一纯模块 `long-task-observability.js`：1000 轮本地 fixture（生成/校验/删除三命令 + manifest，零出网零真实 Provider）/ 成功率·完成度·跨恢复一致性基线（`claimStableLongTask` 恒 false）/ traceId 五类节点持久化投影 / usage 三层事实表 + `model_request_failed` 失败记账 / 用户可感性能常驻门（400+ 节点必红）+ 零依赖窗口化。HK-01 14/14；门自身 7 项篡改必红全绿；`gate:long-task-observability` PASS 0 issues；lint 0；docs:check 575 / ui:audit / W5a 全绿。

**evals 当次读数（不冒充通过）**：`evals:run --suite smoke --provider=mock` **1/9 PASS**（ECONNRESET ×8，本机 :3001 无窗栈未起）⇒ `external-blocked`；`evals:gate` 首轮 exit 1（回归 31）；恢复既有证据后第二轮 exit 0（回归 0）**明确标注 `REUSED_EXISTING_EVIDENCE`**（对比 HEAD 版 2026-10-17 既有证据，非当次成功，不计入完成数）。

**自纠（POSTMORTEM 落地）**：`evals-run.mjs:240` 按既有实现覆写 tracked 证据 `acceptance/evals/smoke-latest.json`；会话早期快照确认该文件起始非在制 WIP（HEAD 干净）⇒ 当次红读数另存本包目录、该文件恢复 HEAD 版（`git show` 重定向），M 计数 91→90，零 stage 零提交。教训已落本笔录：任何会写盘的复跑命令跑前须核既有写盘路径是否属起始 WIP，读数另存本包证据目录。

**门禁实况（不写全绿）**：`test:changed` 1473 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；`closeout` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：零新增依赖 / 零放宽基线（`quality:perf` 基线与 coreSha 绑定未动）/ 零触碰他方在制 WIP / 零 stage 零提交 / 零撤销既有裁决 / 零 G1+ 外推。

**external-blocked / W / done-partial + 补腿**：① SSE 真实端点行为测试（M7 实机腿，需 :3001 无窗栈）；② `quality:perf` 场景 4→≥7（干净树 + owner 全量证据重锚）；③ real 档 / 真实 Provider（G1+ 用户显式裁决）；④ evals 接 closeout（`package.json` 为在制 WIP，owner 收口后裁决）；⑤ 约 90 个未引用测试分批挂载（归 M6-C 覆盖率只减棘轮）。M6 逐件终态化。

**证据**：`acceptance/m-blueprint-2026-11-11/m4/`（m4-evidence.json / evals-readout.json / gate-report.json / fixture/）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
