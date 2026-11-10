---
capability: block-403-post-h9-k7-final-acceptance
status: active
goal: 按第四轮蓝图 §4 K7 完成真实任务终验与人眼验收的可核实部分，产出十一维六列终验复评、32 条缺口逐件终态、未跑/跳过/复用证据如实标注与总收口报告；凭据/人眼边界不代答不伪造。
acceptance:
  - 8 任务套件当次真实取数（含环境因时间线），不冒充 8/8
  - 人眼路线签字状态与 8 项 humanEyePending 逐件如实标注
  - 32 条缺口全部有终态（requireAllClosed 门绿），无静默消失
  - 十一维六列复评差值逐条归因到提交或读数，不回溯调参
  - 总收口报告含未跑/跳过/复用证据、WIP 保留状态与外部依赖
  - 干净树 closeout:full / docs:reconcile 候选逐件复核 / docs:check 全绿
reopen: 有效 provider 端点恢复 + 人眼签字后按 §6 补腿条件重开 K-30
---

# BLOCK-403 · post-H9 K7 真实任务终验与总收口

> 状态：active · P0-LAUNCH
> 发令：用户 2026-11-10 预授权连续工作「K0→K7 全部推完，直到总收口，全程零参与」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 立项自检（产品个性 · 强制问句）

**与 ZCode/Codex 的差别形态**：①**本地可审计**——终验复评逐维归因到本程序提交哈希与当次读数，不靠云端报表；②**治理透明**——凭据/人眼/裁决边界逐件写补腿条件与归属，绝不代答；③**证据自证**——五类证据严格分级、32 条缺口机械汇总、「未跑/跳过/复用」显式披露。形态上是「通用 agent 可靠性维度的诚实终验」，不是领域内容。

## §2 运行时事实校准（与蓝图写作时不同，必须以当次读数为准）

| 项 | 蓝图写作时 | 本次当次读数（2026-11-10T14:49Z 起） | 处置 |
| --- | --- | --- | --- |
| 模型凭据 | 「env 0 key / ai-settings presets=0 / 8 任务 0/8 全环境因」 | **凭据实际在位**：`.petri-dev-user-data/data/ai-settings.json` `credential_backend=keychain`、`deepseek_configured=true`、`chat_model_presets` 4 条、`credential_status.deepseek=true`；`evals:run --provider=real` 打印「凭据来自本机凭据库（model=deepseek-flash）」、`block348` runner 打印 `provider=local-store` | 纠正蓝图口径，不照抄「凭据缺失」 |
| 出网 | 「出网仅 HTTP 401」 | `api.deepseek.com/v1/models` HTTP **401**（服务可达、curl 未带鉴权属预期）；通用出网 `www.baidu.com` HTTP **200**；但模型实际端点 `199.59.148.247:443` TCP **`connect ETIMEDOUT`** → 特定 provider 端点不通，非全局断网 | 精确归因，不笼统记「失败」 |
| 真实任务 | 「0/8 全环境因」 | `evals:run --suite=real --provider=real`：3 任务，`real-coding-fix` 出站断言命中但 `task_completed` 红（`ECONNRESET`）、`file_contains` 红，84.8s FAIL；`block348` 8 任务：t1 `ETIMEDOUT` 判据 3 红（234s），t2 起跑后 240s 有界超时 **exit 124 = unknown**（非通过、非失败结论） | **不写 8/8、不写 0/8 环境因**；标 `external-blocked` + 时间线 |
| 人眼路线 | 「无签字记录」 | `docs/post-s7-h7-human-eye-route.md:70-79` 签名区仍全空；H7 gap-ledger `humanRequiredCounts {no:27,split:5,yes:2}`、`humanEyePending` 8 项 | `pending_human_eye`，Agent 不代答 |
| HEAD | `6dc6ae86` | 本程序 K0–K6 已收口，HEAD 逐笔前进 | 复评归因到本程序提交 |

## §3 交付

1. `scripts/lib/post-h9-k7-final.mjs`：32 条终态机械汇总、十一维六列复评表（含差值归因）、未跑/跳过/复用证据清单、WIP 保留状态、外部依赖清单（纯函数 + 只读）。
2. `test/post-h9-k7-final.test.mjs`：终态全覆盖负测、复评六列完整性、差值归因可追溯、边界项不冒 verified、外部项不写 8/8。
3. `acceptance/post-h9-2026-11-10/k7/task-suite-attempt.json`：当次真实取数（凭据/出网/两次套件尝试的时间线与 exit code），半成品 artifacts/traces 已清理。
4. `docs/post-h9-2026-11-10-final-report.md`：总收口报告（十一维六列终验复评、32 条缺口终态、证据分级披露、WIP 与外部依赖、单一 Jev 建议与全局计划进展）。
5. canonical 回写：plan / registry / README / roadmap / handoff / AUDIT-LOG / UI 台账同批。

## §4 范围 / 非范围 / 风险

- **范围**：见 §3 五项 + K-30 终态 + 总收口门禁。
- **非范围**：不伪造 8/8 / 不代签人眼 / 不重跑蓝图历史评分 / 不回溯调参 / 不新建第二评分卡或状态真相 / 不动 10 项用户资产与蓝图原件 / 不撤销既有用户裁决 / 零新增依赖 / 不放宽任何基线。
- **风险**：本程序新增大量 acceptance 证据会影响 `quality:ear` 分母 → 当次读数如实报（K5 已 44.1%）；`docs:reconcile` 归档候选须逐件复核不批量移动；有界超时结论标 unknown。

## §5 K-30 补腿条件

| 边界 | 补腿条件 | 归属 |
| --- | --- | --- |
| 8 任务连续 3 次 8/8 | provider 端点 `199.59.148.247:443` 可达 + 冻结判据表复跑 ×3 + 0 干预 + T6 波动归因到稳定根因 + 环境因逐条时间线 | V |
| 人眼签字 | 用户按 H7 路线六组实测并填签名区（确认人/日期/覆盖勾选/结论）+ 截图 | E |
| 8 项 humanEyePending | 真实产物到位后由人按冻结判据表补判据（toolSelectJudge / artifactJudge） | E |
| attempt 级证据 / T7 自然长任务 | 真实 provider 长任务的 token/cache/duration/模型归因/重试原因随 dev-verify flow 落盘；T7 去 `windowOverride` | V + L |

## §6 验收门禁

`npm run docs:check` / `npm run ui:audit:check` / `npm run test:changed` / `npm run closeout` / **干净树** `npm run closeout:full` / `npm run docs:reconcile` 候选逐件复核。

## §7 证据目录

`acceptance/post-h9-2026-11-10/k7/`，四字段齐备；真实任务证据 `evidenceClass: decision-material`（记录环境因，不冒充成功）。
