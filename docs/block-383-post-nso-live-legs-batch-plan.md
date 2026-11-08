---
capability: block-383-post-nso-live-legs-batch
status: completed
goal: 实机腿批（block-382 §3.6 待人工清单中「机器会话恢复即可自动跑」的子集）——P6 重算 / perf 连续 5 次全绿 / UI-697~701 实机腿 / 8 任务套件×3+T7（栈健康前提下）；全部证据由脚本产出，人只做人眼判据一条。
acceptance:
  - AX 会话健康前置实测（block48 10/11 已确认，唯一红=screenshot_unavailable 已知腿）
  - P6 源绑定重算（g0:result-studio:p6:update --write-evidence）成功或如实归因失败原因
  - quality:perf 连续 5 次采样全绿（一次会话内当次证据）
  - UI-697/698/699/700/701 实机腿 CDP 取证（9223 离屏；探针跑完即 kill）
  - 8 任务套件×3+T7：栈健康前提下尽力跑；未达如实挂起不硬闯
  - humanEyePending 判据不代答（硬线；留给用户集中过目）
reopen: 单腿失败逐件归因后按补腿路径重开
---

# BLOCK-383 · 实机腿批（post-nso 待人工清单第一波）

> 发令：用户 2026-11-08「可以的 按照你的建议来」＝授权按 block-382 §3.6 清单执行第一波（实机腿批；Q4b 大包与授权类三项仍待单独发令）。
> 前置实测：block48 10 pass/1 fail/0 skip（会话健康）；工作树仅 preserve WIP（1M+9??，清单在 stage-0/wip-inventory.json）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 执行顺序与判据

1. **P6 重算**：`npm run g0:result-studio:p6:update`（--write-evidence）。判据=exit 0 且测试 g0-rs-p6-product-acceptance 全绿。失败逐件归因（S0 曾红 p6_restart_baseline_cohort_incomplete）。
2. **perf 连续 5 次**：`npm run quality:perf`（默认 5 采样）。判据=一次会话内 5/5 全绿。
3. **UI 实机腿**：restart-dev-stack + 9223 离屏实例；UI-697（字号 token 收敛视觉）/UI-698（inert+树语义）/UI-699（content-visibility 行）/UI-700（task.failed 结构化终态）/UI-701（字号新收敛+重放横幅+空 flags+钉住禁用态）逐腿 CDP 取证，acceptance/post-nso-2026-11-08/ 落 JSON+PNG。探针跑完立即 kill 实例。
4. **8 任务套件×3+T7**：栈健康前提下跑（evals 真实 harness）；耗时有界（每轮 timeout），未达如实登记。

## 2. 非范围

- humanEyePending 判据（用户集中过目）；Q4b；C-46 兄弟仓；FK 全量切换；ADMISSION 拨硬；大拆片。
- preserve WIP 零触碰（1M+9??）。

## 3. touchSurface

acceptance/post-nso-2026-11-08/**、acceptance/g0-result-studio/**（P6 证据重算）、docs 台账回写（registry/README/roadmap/handoff/AUDIT-LOG/UI-700/701 状态翻转）。

---

## 4. 收口（2026-11-08）

| 腿 | 终态 | 证据 |
| --- | --- | --- |
| AX 会话健康前置 | ✅ | block48 10 pass/1 fail/0 skip（唯一红=已知 screenshot_unavailable）——会话恢复确认 |
| UI-697~701 实机腿 | ✅ **8/8 allPass** | acceptance/post-nso-2026-11-08/block383-live-legs-live-darwin.json：字号新收敛（孤儿 px 零命中）+空 flags 段三行 server-flag 渲染+重放横幅实机文案「HTTP 503（30 秒后自动重试，第 1/3 次）」+树语义+折叠 inert=true+inline 无裸字号；UI-700/701 台账翻 verified（632 编号） |
| perf 连续 5 次 | ✅ **5/5 全绿** | acceptance/post-nso-2026-11-08/perf-consecutive-5x.log（连续采样判据首次全绿证据） |
| P6 源绑定重算 | ❌→C-49 | 两轮试跑：①tree 不匹配=本包 impact-map 未提交（已修）②`p6_restart_baseline_cohort_incomplete` 根因**抓真**=兄弟仓 volcano-plot golden fixture sourceScriptSha256 漂移（4ff6327e 声明 vs 5cff555d 实际）→SDK fail-closed→cohort=1<3。**新登记 C-49**（补腿=pack 仓重生成 fixture） |
| 8 任务套件 round-1 | ❌→环境挂起 | 0/8 全为环境/凭据因：6×ECONNRESET（provider 连接）、t7「api key ****ck93 invalid」、t5 ETIMEDOUT（出网）、t8 HTTP 550。**非产品回归**；补腿=有效凭据+出网可达后重跑 ×3（凭据属用户资产，Agent 不动） |

**关账状态**：UI 台账 632 编号（UI-700/701 verified）；perf 连续全绿证据在册；P6 与任务套件继续挂起且根因已钉死。closeout 门禁=九门绿（本批无生产代码改动，仅台账/证据/flow）。
