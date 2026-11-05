# BLOCK-358 收口报告 — 文件树分页归因（C-47）

- 日期：2026-11-05
- 依据：`docs/block-358-filetree-pagination-plan.md` / `docs/next-tasks-2026-11-05.md` A-4
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## 1. 结论（三态判定）

**`observed_but_not_reproduced`** —— 观察证据在场，headless 未独立复现，**根因未归因**。

- 349 的 B3 是 GUI 会话中的单次观察：`clicked=true / 200→200 / grew=false`（"第二页后再点惰性 / 回弹"）
- B2 是另一次独立观察：`200→400`（游标加载生效）
- 两者**不是同一次会话的连续点击序列**，脚本按两段独立观察回放，不拼成连续会话（避免过度解读）
- headless 无法重放真实 GUI 点击与面板轮询收敛，故**不声称复现**

按计划 §2 的三态约定，落在「未复现 / 未归因」：**不做猜测性修复、不销票**。

## 2. 交付

| 产物 | 内容 |
| --- | --- |
| `scripts/block358-filetree-repro.mjs` | 证据回放 + 静态候选归因；`replayPagingClicks` 检查游标单调性与回弹，`observationsFromEvidence` 抽取 B2/B3，`candidateRacePoints` 只列真实存在的文件 |
| `acceptance/block-358/repro-result.json` | 结论落盘：`triState / rootCauseAttributed=false / fixApplied=false / ticketStatus=kept-open / nextStep` |
| `test/block358-filetree-repro.test.mjs` | **5/5 绿**，含负测（惰性点击与回弹都能被检出）与「勿手改」一致性校验 |

## 3. 可核查的候选竞态点（静态，非根因结论）

- `frontend/src/components/workspace-panels` — 加载更多 / cursor / hasMore 的 UI 同步点
- `frontend/src/components/copilot/SimpleChat/hooks/useScrollGuard.ts` — 滚动与轮询收敛可能触发列表重建
- `frontend/src/components/copilot/SimpleChat/hooks/useConversationResume.ts` — 会话恢复与面板状态重置的交叉面

**明确**：这三项只是「后续人工复现时该看哪里」，不是已证实的根因。计划 §3 禁止猜测性修复，本包一行产品代码未改。

## 4. C-47 票状态

`kept-open`——backlog 中 C-47 保持「观察，未归因」，启动条件仍为**人工复现归因后立票**。下一步：在 520 文件项目上连续点击「加载更多」并观察面板轮询收敛，记录每次游标与根列表状态；归因后再立修复票。

## 5. 门禁

`node --check` OK · 契约 5/5 · `docs:check` · `docs:reconcile` · `quality:surface` · `quality:ear` · `quality:perf` · `knip` · `types` · `lint` · `closeout` 16 门。

**impact-map 未改**：358 规则在 357 时已预登记（含 `classifiesScripts` 标记），本包脚本与测试均落在既有 patterns 内，故不触发 P6 源绑定重打。

## 6. DoD

回放脚本 + 结论 + 报告落盘；台账回写；registry → completed；总纲 §5 填行；显式路径提交。

**第二批四包全部收口**：355（C-45 修复）/ 356（套件 v2）/ 357（detour 裁决 + 能力地图）/ 358（C-47 未归因登记）。三项排除项（C-46 pack 仓 / G1 启动 / O-1 人工观感）保持原状，未伪造完成。
