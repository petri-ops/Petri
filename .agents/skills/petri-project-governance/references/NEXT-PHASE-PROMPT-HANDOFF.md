# 下一阶段提示词自动落档作业规范（Next-Phase Prompt Handoff）

> 触发：每个阶段性工作包收口后（commit + push 落定），与 `NEXT-STEP-BRIEF.md` 同层、在其之后执行。
> canonical 依据：`$petri-project-governance` SKILL.md §"Close a Goal or stage" + `STAGE-CLOSEOUT-CHECKLIST.md` §6。
> 目的：把「阶段完成 → 按蓝图现读派生并落档下一阶段无人值守提示词」这件反复动作固化为 agent 自动推动的纪律。

## 0. 一句话边界（先读这条）

**自动"落档草案"，不自动"发令开工"。**
生成的下一阶段提示词是 `advice`；其中预置裁决（R 项）只能**继承上一批已授权范围**或**引用用户明确发令**，
agent 不得自行新造下一阶段范围、不得自动启动 work-package。新裁决点（超上一批预置）一律红线 2 停，列入用户动作清单。

## 1. 何时触发

- **必触发**：任一阶段性 work-package 收口（`completed/CLOSED` + push 成功）后，作为收尾的一部分。
- **同层顺序**：AUDIT-LOG 收口行 → `NEXT-STEP-BRIEF` 固定提示 → **本规范落档下一阶段提示词** → commit。
- **不触发**：纯问答、只读核查、单文件小修（除非用户明确要求「落档下一阶段提示词」）。
- **终点**：母纲 §6.5 队列清空且无下一阶段可派生时，如实写「无下一阶段候选，队列未变」，不臆造提示词。

## 2. 输入（全部现读，不复用旧结论）

1. `npm run state` + `docs/AUDIT-LOG.md` 头部（当前 phase、active 槽位、用户动作清单、未决 🔴）。
2. 蓝图 canonical：`docs/petri-master-charter.md`、`docs/next-work-blueprint-2026-11-16.md`、
   `docs/next-steps-roadmap.md`、`docs/AUDIT-LOG.md` 的候选/规划条目；数字符号一律现读，不抄聊天记录。
3. `npm run next:suggest -- --supply=cloud` —— 取**单一**建议 + confidence 作为下一阶段主线的 advice 锚
   （Jev 不可用或零建议时按候选队列首个兜底并标注，仍只给一个）。
4. **上一批提示词正文**：最近一份 `docs/next-phase-e2e-prompt-<date>.md`（或 `-bN`）的 §2 自包含代码块——
   继承其未消耗完的预置裁决 R 项，是本规范"自动但不发令"的关键输入。

## 3. 输出物（落档位置与命名）

- 路径：`docs/next-phase-e2e-prompt-<YYYY-MM-DD>.md`；同日再生成加 `-b2`、`-b3`……后缀。
- 结构（沿用既有先例，自包含可复制）：frontmatter + §1 剩余盘点（现读）+ §2 提示词正文（代码块整块）+ §3 配套说明。
- §2 正文必须覆盖七要素：①核心目标与交付物 ②任务清单与执行顺序 ③自动推进触发与依赖
  ④每任务完成标准与验收条件 ⑤异常阻塞自动处理与降级 ⑥输出格式与进度汇报 ⑦边界与约束。
- 正文内固定含：两条绝对红线（观感不代签 / C 类保护停止）、HK-01 红绿、六件套回写、closeout 定向门、
  G0 阶段纪律用语一次（「G0 开发期常态 · 不外推 packaged/Provider/GA」）。

## 4. 三件套登记（同提交，缺一不可）

- `docs/DOC-REGISTRY.json`：新增 roadmap 条目（status=active，truthDomain 唯一，entrypoint=docs/README.md），
  `documentCount` / `managedMarkdown` 同步 +1（或按实际条目数）。
- `docs/README.md`：当月编号条目追加（最新在前），标题含日期与批次。
- `docs/AUDIT-LOG.md`：头部前插落档广播行，注明范围依据（Jev 单一建议 + 蓝图现读）、七要素覆盖、用户动作清单。
- 改完跑 `npm run docs:check`（必绿）+ `npm run hygiene:check`（换行/桥形态）；然后 commit + push。

## 5. 继承规则（防 agent 自行扩权——本规范的核心约束）

| 上一批 R 项状态 | 本批处理 |
|---|---|
| 已授权且**未消耗完**（如 P2–P7 只做完 P2） | **原样继承**剩余阶段，只更新现读数字与已完成项，不重造 R 编号语义 |
| 已**全部消耗**（范围内 work-package 全 completed） | 不再继承；新阶段若需推进 → 标 `advice_only / pending_user_ruling`，列用户动作清单，不写进 R 项 |
| 下一阶段**超出**上一批预置范围（新依赖 / design-charter 冻结项 / 授权结论 / G1+） | **红线 2 停**：只出材料，不落 R 项，最终报告列「待用户发令」 |
| 观感项（pending_human_eye：UI-###、E 类人眼、人眼收口） | 有用户偏好裁决的走「偏好预审闭环」（预审→优化建议→自动优化→复验通过即翻 verified，见 AGENTS.md UI 纪律）；无偏好裁决的永远 `in_progress` 留槽 |
| 既有红（perf 抖动 / evidence gap 等） | 如实登记归属，归属既有基线，不重打掩盖 |

## 6. 降级策略（失败诚实）

- Jev cloud 不可达（exit 3 / 451 / timeout）：按 `JEV-CLOUD-PROVISIONING.md` §2 诊断；仍不可用则按候选队列首个兜底并标注，不阻断确定性落档。
- 蓝图 canonical 缺失/冲突：以 Git / registry / acceptance 证据为准，先降级冲突声明，不臆造计数或阶段。
- docs:check 红：禁止宣称落档完成，修复 entrypoint/登记后再提交。
- push 失败：本地 commit 保留，标 external-blocked，不重写历史、不强推。

## 7. 自检（落档前逐条过）

- [ ] 输入来自现读 canonical（state / AUDIT-LOG / 上一批提示词 / next:suggest），非聊天回忆
- [ ] §2 正文七要素齐 + 两条红线 + G0 用语一次
- [ ] 预置裁决只继承或引用用户发令，无 agent 自造新阶段范围
- [ ] 观感项：有偏好裁决的走预审闭环并留逐条判据、无偏好裁决的不代签；既有红归属如实
- [ ] 三件套登记齐 + docs:check 绿 + hygiene:check 绿
- [ ] commit + push 成功（失败标 external-blocked 如实报告）

G0 开发期常态 · 不外推 packaged/Provider/GA。
