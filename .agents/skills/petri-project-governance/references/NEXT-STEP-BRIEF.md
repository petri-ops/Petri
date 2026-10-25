# NEXT-STEP-BRIEF — 任务完成后的下一步提示（canonical）

> 用户裁决 2026-10-25：**每次任务完成后都要给出这种提示**；Jev 只给**一个**建议；存在蓝图/全局计划时必须列出进展，让人一眼看到位置。
> 本文件是输出形态的单一真相源；`petri-project-governance`、`petri-dev-infra` 与 `AGENTS.md` 都引用它，不另写第二份模板。

## 触发时机

- **每次任务交付/任务完成**：代码、文档、治理、审计、小修、验证批，都要附。
- **阶段收口、工作包收口、commit 后、handoff 时**：必须附，且数字从 canonical 现读。
- **纯问答**：若未触及项目状态，至少给一行「下一步：队列未变 / 无新增工作」；不得完全省略。
- 放在交付说明的最后，作为独立块；可与技能透明标签同屏。

## 固定模板

```text
Jev 单一建议：<候选>（confidence=<数值>）——<一句话具体范围>，<体量/类型>。未启动任何新工作包，等你发令。
母纲波次顺序：<A → B → C …>（<硬约束，如 P4-REM 最后、Q4b 单列>）。
蓝图 / 全局计划进展：
- 母纲 Q-MATRIX：<✅x / 🟡y / 🔴z / ⛔w = N>；§6.5 剩余：<队列>
- 竞争力纲 / 成熟度蓝图：<当前波次 / CP 状态 / 缺口>
- Result Studio：<状态 / RS-P 阶段>
- UI 台账：<verified / in_progress 计数>
- 当前 active 工作包：<无 / BLOCK-xxx 阶段>
```

### 示例（2026-10-25 实际交付形态）

```text
Jev 单一建议：Q2-REM（confidence=0.59）——C4 逐消息统计 + C17 会话拖入 composer，是一个小体量收尾包。未启动任何新工作包，等你发令。
母纲波次顺序：Q7 → Q4b → Q8-REM → Q9-REM → P4-REM（P4-REM 最后；Q4b 单列）。
蓝图 / 全局计划进展：
- 母纲 Q-MATRIX：✅59 / 🟡32 / 🔴4 / ⛔7 = 102；§6.5 剩余：Q7、Q4b、Q8-REM、Q9-REM、P4-REM（+ Q2-REM / Q5-REM / Q6-REM reopen）
- 竞争力纲 / 成熟度蓝图：<按当前 canonical 状态行填写；本轮未触及则写「不适用」>
- Result Studio：implemented_unverified / experimental；RS-P7 deferred
- UI 台账：145 verified / 1 N/A / 4 cancelled；无 in_progress
- 当前 active 工作包：无
```

## 字段规则

1. **Jev 建议唯一**：先跑
   `npm run next:suggest -- --supply=cloud --context "<本包收口摘要 + 当前队列/未收口缺口>" --candidates "<真实可开工项，用 | 分隔>"`
   只取一个 `suggestion`。禁止「或」「二选一」「以下候选供你选」这类多选。
2. **confidence 必须来自脚本**。Jev 不可用（`reason=jev_unavailable:*`）或零建议（`below_threshold`）时，按候选队列的**首个**兜底，并如实标注「Jev 不可用/零建议，按队列序默认=<候选>」；仍然只给一个。
3. **具体范围**：写清 1–3 个可验收项（做什么、验收什么），不要只写代号或「继续推进」。
4. **体量/类型**：小体量收尾包 / 1–2 周波次 / 2–3 周大包 / 纯验证债 / 契约包 / 治理对账。
5. **「未启动任何新工作包，等你发令」**：除非用户在本轮已预授权连续工作，否则这句必须保留；建议是 advice，不是开工。
6. **母纲波次顺序**：从 `docs/qoder-essence-absorption-plan.md` §6.5 现读，已完成项不列；P4-REM 必须最后，Q4b 单列，Q5/Q6 余项与 Q9 可互换的说明保留。
7. **蓝图/全局计划进展**：只列实际存在且与本轮相关的文档；不存在的写「不适用」，不要删掉整个区块。数字/状态一律从 canonical 现读，禁止凭记忆或沿用上一轮。
8. **active 工作包**：以 `docs/project-workspace-handoff.md` 的「恢复要点」与 `docs/DOC-REGISTRY.json` 为准；没有就写「无」。
9. **不列 G1+**：Provider 矩阵、packaged 公证/签名、GA、远程发布、dist staleness 等不作为下一步建议；G0 阶段纪律不变。
10. **不把「未做」写成「阻塞」**：阻塞只用于真正的契约/安全/外部条件前置；可做但未排期的写「未开工/排队」。

## 蓝图 / 全局计划源（按需读取，至少列母纲）

| 文档 | 用途 | 读什么 |
| --- | --- | --- |
| `docs/qoder-essence-absorption-plan.md` | 母纲：Q-MATRIX + Q0–Q9 波次 + §6.5 剩余队列 | §5 统计行、§6.5 表、相关矩阵行 |
| `docs/agent-competitiveness-program.md` | 竞争力纲：六波 CP-1~CP-19 候选包 | 当前波次、在制/已收口 CP、缺口 |
| `docs/g0-agent-maturity-blueprint.md` | G0 成熟度蓝图（内部口径） | 五维自评、残余清单、G1+ 画线 |
| `docs/g0-result-studio-plan.md` | Result Studio 计划 | 状态（implemented_unverified/experimental）、RS-P7 deferred |
| `docs/next-steps-roadmap.md` | 当前 Next Steps | 最新「最后更新」、active、下一包 |
| `docs/pending-work-backlog.md` | 全量未完成项与推进序 | 队首/队尾状态、planned 行 |
| `docs/ui-productization-audit.md` | UI 台账 | 表内 verified / in_progress / cancelled 计数 |
| `docs/project-workspace-handoff.md` | 换会话恢复要点 | active 工作包、WIP、下一包建议 |

规则：**至少列母纲 Q-MATRIX 与 §6.5**；其余文档若本轮未触及或不存在，写「不适用」。不要把整张表搬进交付说明，保持 3–5 行。

## 红线

- 不得用「或」式多选、不得给候选菜单、不得把选择权重新丢回用户。
- 不得编造 Q-MATRIX 计数、confidence、active 包或队列状态；不确定就写「待核对」并说明缺口。
- 不得因零建议/模型不可用跳过提示；必须按队列序兜底并标注。
- 不得建议 G1+ 工作，也不得把 `qualificationEligible: false` 写成待办。
- 不得把「未开工」写成「阻塞」或「已完成」；状态词只服从 canonical 证据。
- 不得把本提示写成开工动作：建议后仍等用户发令（预授权连续工作除外）。
