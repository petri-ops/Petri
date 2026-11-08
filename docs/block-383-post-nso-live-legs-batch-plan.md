---
capability: block-383-post-nso-live-legs-batch
status: active
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
