---
capability: block-381-post-nso-s6-governance
status: completed
goal: S6 治理台账与证据运营——coverage 单写入器/账本自稳/active 槽位/证据元数据；让换模型换会话的 Agent 可机械恢复同一份真相。
acceptance:
  - coverage 单写入器：顶层 documentCount 退役，roll-index 与 governance 写同一 coverage.* 字段
  - 账本自稳：audit:compact 幂等（closeout 首步）；超长行已迁档
  - active 槽位：S0 对账钉死（G0-LF=常驻 living-plan 不占串行槽位）
  - 证据元数据：post-nso 证据目录带 sourceCommit/capturedBy/generatedAt（stage-0 三 JSON 在案）
  - 四账本同源生成器：capability-map 由 generator 重建（block357 门在案）；surface-matrix pair 同步
  - 各阶段收口同批回写：plan/registry/README/roadmap/handoff/AUDIT-LOG 全程执行（S0-S5 六包在案）
reopen: 治理漂移再现场象时按对应门归因
---

# BLOCK-381 · S6 治理台账与证据运营（post-NSO 蓝图 §12）

> 承载蓝图 §12。发令：用户预授权连续工作模式。G0 开发期常态。

## 1. 交付对账

| 蓝图项 | 结果 | 证据 |
| --- | --- | --- |
| §12.1 coverage 单写入器 | ✅ | roll-index 改写 coverage.*（动态 import governance.collectManagedMarkdown；顶层 documentCount 退役）；契约测试追新（① 断言 coverage.documentCount 增长+顶层不得再写）；docs:check PASS；两写入器（governance --write-coverage / roll-index）同字段 |
| §12.2 --check 接入 | ✅（部分）| roll-index --check 在 closeout 链的 docs:check 内覆盖计数漂移面；README 滚动门=既有 COVERAGE 门 |
| §12.3 active 槽位唯一 | ✅ | S0 对账（BLOCK-375）：G0-LF 常驻语义钉死 roadmap/handoff/registry 三处 |
| §12.4 账本自稳 | ✅ | S0 audit:compact+超长行迁档（3732B→500B 指针）；76KB 建议级持续在案 |
| §12.5 四账本同源 | ✅（在案面） | capability-map generator 门（block357 8/8）；surface-matrix pair 同步（S0 重刷）；UI 台账 triage generator 门（block332 4/4） |
| §12.6 证据生命周期 | ✅（增量面） | post-nso 证据统一带 sourceCommit/capturedBy（stage-0 shard-attribution/wip-inventory 头字段）；历史 PASS 复用纪律=计划文档条款 |
| §12.7 skills:check artifacts | ⏸ | 独立小批（蓝图 P2；本包未触及面） |
| §12.8 同批回写 | ✅ | S0-S5 六包逐包执行（AUDIT-LOG 处理记录在案） |

## 2. 未清偿
skills manifest sha256 补齐小批；§12.2 的 README 滚动门完全脚本化（当前=计数漂移覆盖）。
