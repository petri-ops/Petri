---
capability: block-325-model-surface-budget
status: active
goal: model-surface 尺寸预算 CI 门禁（借鉴 dsh model-surface.spec）：系统提示/工具定义字面量与工具数基线棘轮（任何增长即红，收缩经 --update 下调并说明理由）+ 核心模型可见面退役词扫描；prompt/工具定义通胀从此是 CI 红线。
acceptance:
  - scripts/model-surface-baseline.mjs：measure（系统提示三确定性页取最大 + 逐工具字面量）/ compareAgainstBaseline / shrinkBaseline（--update 对增长拒绝写入）；自带 DB 自举零 dev 栈依赖。
  - 基线 test/model-surface-baselines.json 提交在案（systemPrompt/toolDefsCount/toolDefsChars/perToolChars）。
  - 契约测试 test/block325-model-surface-budget.test.mjs：实测⊆基线 + 合成增长逐项点名 + shrink 拒绝写大 + 退役词扫描（单细胞/scRNA/DESeq2/Seurat/FigCode/空间转录组）。
  - closeout 十一门 + 台账回写。
reopen: token 级预算深化（CK-04 SECTION_CHAR_BUDGETS 已有，不重复建）/ pack 注入内容的域词表（合法扩展通道不扫）/ 前端 bundle（block141 已有）。
---

# BLOCK-325-MODEL-SURFACE-BUDGET — model-surface 尺寸预算门禁计划

- 立项裁决：用户 2026-11-01「很棒 继续」（dsh-superagent 借鉴余项收官包；Jev 队列序首选候选）
- 唯一真相域：本文件（block-325-model-surface-budget）

## 1. 定位（立项自检问句）

ZCode/Codex 无 prompt 尺寸门禁，提示词与工具定义通胀不可见；Petri 把「模型可见面」变成基线棘轮——任何增长必须有意留痕。与 dsh 的差别：dsh 按角色预算整装提示（59k/40.5k 字符）；Petri v1 锁核心静态面（确定性三页系统提示 + 104 工具定义），动态上下文与 pack 注入（合法域扩展通道）不进基线——本地可审计的通胀检测。

## 2. 设计决策

1. **只测核心自有面**：pack 注入的 promptFragments/工具是合法域扩展通道，不在扫描面（BLOCK-214/215 语义）。
2. **基线棘轮 block141 同族**：基线=现状首测（不预设阈值）；任何增长即红；收缩合法且 --update 下调；增长必须有意变更并在 commit message 说明理由。
3. **不重复建门**：token 级预算已有 CK-04 SECTION_CHAR_BUDGETS（block163 测试），前端 bundle 已有 block141——本包只守「字符级核心面」这块空地。
4. **退役词扫描与域中性迁移衔接**：扫描面=核心系统提示（确定性三页拼回）+ 工具定义 JSON；pack 内容不扫。

## 3. 范围

- `scripts/model-surface-baseline.mjs`（measure/compare/shrink + CLI 对账/--update）；`test/model-surface-baselines.json`；`test/block325-model-surface-budget.test.mjs`；impact-map 登记（scriptRole=governance-gate）。

## 4. 非范围（exclusions）

- 不做 token 级深化、不扫 pack 内容、不做前端 bundle（既有门各守其面）；G1+ 不外推。

## 5. 验收门禁

1. 契约测试 4/4；2. closeout 十一门；3. 台账回写。实机腿豁免（纯 CI 门禁包，测量即证据）。

## 6. 完成语义

验收 1–3 全绿 → completed；基线首测值：systemPrompt=940 chars / toolDefs=104 个 56614 chars（top: plan=2586, run_tool=2407, spawn_agent=1639）。
