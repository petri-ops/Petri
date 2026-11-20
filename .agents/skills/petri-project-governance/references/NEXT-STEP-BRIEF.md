# NEXT-STEP-BRIEF — 任务完成后的下一步提示（canonical）

> 用户裁决 2026-10-25：**每次任务完成后都要给出这种提示**；Jev 只给**一个**建议；存在蓝图/全局计划时必须列出进展，让人一眼看到位置。
> 本文件是输出形态的单一真相源；`petri-project-governance`、`petri-dev-infra` 与 `AGENTS.md` 都引用它，不另写第二份模板。

## 触发时机

- **每次任务交付/任务完成**：代码、文档、治理、审计、小修、验证批，都要附。
- **阶段收口、工作包收口、commit 后、handoff 时**：必须附，且数字从 canonical 现读。
- **纯问答**：若未触及项目状态，至少给一行「下一步：队列未变 / 无新增工作」；不得完全省略。
- 放在交付说明的最后，作为独立块；可与技能透明标签同屏。

## 固定模板（短精准 · 用户裁决 2026-11-18「缩减信息 + 可直接复制的启动提示词」）

> 3 行定位 + **1 个可整块复制的启动代码块**；用户复制代码块整段给新 Agent 即可启动，无需阅读辨别。红线语义一个不丢（见「字段规则」）。

````text
下一步：<候选>（Jev <confidence>）——<一句话范围/体量>；未开工，等你发令。
位置：Q-MATRIX <✅x/🟡y/🔴z/⛔w=N> · 波次 <A→B→C>（P4-REM 最后、Q4b 单列）· active <无/BLOCK-xxx> · UI 观感 <有偏好裁决走预审闭环 / 无则 in_progress 不代签>。

可直接复制的启动提示词（整块发给新 Agent）：
```
你是 Petri Desktop 全自动执行 Agent。用户发令「开始 <候选>」。先读 docs/AUDIT-LOG.md 头部与 docs/next-phase-e2e-prompt-<date>.md §2 自包含正文，按其执行序列推进 <候选>。纪律：单工作包串行、HK-01 红绿先行、每步定向测试+closeout 门禁+证据落 acceptance/+六件套回写+commit/push。红线：观感项有用户偏好裁决的走预审闭环（预审→优化建议→自动优化→复验通过即翻 verified）、无偏好裁决的保持 in_progress 不代签；新裁决点/产品级新依赖/G1+ 停下报用户；未获用户发令不启动后续阶段。
```
````

字段压缩规则：竞争力纲 / 成熟度蓝图 / Result Studio 本轮有变才补一行「补充：<...>」，未触及不写。启动代码块内 `<候选>` / `<date>` 必须现读替换，**不留占位符**。

### 示例（短版）

````text
下一步：C-53-P2（Jev 0.95）——IA 与高频路径首片，1 个小包；未开工，等你发令。
位置：Q-MATRIX 74/21/0/7=102 · 波次 C-53（P2-P7 待发令）→候选池（P4-REM 最后、Q4b 单列）· active 无 · UI 观感 有偏好裁决走预审闭环/无则 in_progress。

可直接复制的启动提示词（整块发给新 Agent）：
```
你是 Petri Desktop 全自动执行 Agent。用户发令「开始 C-53 P2」。先读 docs/AUDIT-LOG.md 头部与 docs/next-phase-e2e-prompt-2026-11-18-b2.md §2 自包含正文，按其执行序列推进 C-53 P2。纪律：单工作包串行、HK-01 红绿先行、每步定向测试+closeout 门禁+证据落 acceptance/+六件套回写+commit/push。红线：观感项有用户偏好裁决的走预审闭环（预审→优化建议→自动优化→复验通过即翻 verified）、无偏好裁决的保持 in_progress 不代签；新裁决点/产品级新依赖/G1+ 停下报用户；未获用户发令不启动后续阶段。
```
````

### 纯问答/小修（不触发完整块）

```text
下一步：队列未变（<一句原因>）。
```

## 字段规则

1. **Jev 建议唯一**：先跑
   `npm run next:suggest -- --supply=cloud --context "<本包收口摘要 + 当前队列/未收口缺口>" --candidates "<真实可开工项，用 | 分隔>"`
   只取一个 `suggestion`。禁止「或」「二选一」「以下候选供你选」这类多选。
2. **confidence 必须来自脚本**。Jev 不可用（`reason=jev_unavailable:*`）或零建议（`below_threshold`）时，按候选队列的**首个**兜底，并如实标注「Jev 不可用/零建议，按队列序默认=<候选>」；仍然只给一个。
3. **具体范围**：写清 1–3 个可验收项（做什么、验收什么），不要只写代号或「继续推进」。
4. **体量/类型**：小体量收尾包 / 1–2 周波次 / 2–3 周大包 / 纯验证债 / 契约包 / 治理对账。
5. **「未启动任何新工作包，等你发令」**：除非用户在本轮已预授权连续工作，否则这句必须保留；建议是 advice，不是开工。
6. **母纲波次顺序**：从 `docs/qoder-essence-absorption-plan.md` §6.5 现读，已完成项不列；P4-REM 必须最后，Q4b 单列；压进「位置」行，不另占一行。
7. **蓝图/全局计划进展**：母纲 Q-MATRIX + active + UI 观感进「位置」行（紧凑）；竞争力纲/成熟度蓝图/Result Studio 仅本轮有变才补「补充」行，未触及不写。数字/状态一律从 canonical 现读，禁止凭记忆或沿用上一轮。
7b. **可复制启动提示词**（必带、独立代码块）：`<候选>` / `<date>` 现读替换、**不留占位符**；口令含四要素——①发令「开始 <候选>」②先读 AUDIT-LOG + 提示词 §2 ③纪律（串行/HK-01/测试+closeout+证据+六件套+commit）④红线（观感项有偏好裁决走预审闭环、无则零代签/新裁决与依赖与 G1+ 停/未发令不续）。目的=用户整块复制即可启动，无需阅读辨别；但口令本身是 advice 的载体，是否发出由用户决定。
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

规则：**至少列母纲 Q-MATRIX 与 §6.5**（压进「位置」行）；其余文档若本轮未触及则不写。整块保持 3 行正文 + 1 行无人值守启动，短精准为要。

## 红线

- 不得用「或」式多选、不得给候选菜单、不得把选择权重新丢回用户。
- 不得编造 Q-MATRIX 计数、confidence、active 包或队列状态；不确定就写「待核对」并说明缺口。
- 不得因零建议/模型不可用跳过提示；必须按队列序兜底并标注。
- 不得建议 G1+ 工作，也不得把 `qualificationEligible: false` 写成待办。
- 不得把「未开工」写成「阻塞」或「已完成」；状态词只服从 canonical 证据。
- 不得把本提示写成开工动作：建议后仍等用户发令（预授权连续工作除外）。
