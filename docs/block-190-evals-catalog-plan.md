---
capability: evaluation
goal: BLOCK-190 = 评测基线 v2 第三切片·catalog 五列化（§5.1 阶段2 四件套之「catalog 五列」；§4.1 ZCode 黄金任务 catalog 五列=ID/setup/action/assertion/evidence）。为每枚 evals 黄金任务派生标准五列目录视图 + 生成可重放的 `evals/CATALOG.md` 索引 + 契约棘轮（新任务未入目录即红）。additive 派生视图，不改任务 JSON 字段名、不动 runGoldenTask/gate 语义。用户「冲·搞完评测 v2 剩余·各独立立项」发令 2026-10-16，承接「我不希望人参与」→ 全自动化。
acceptance:
  - P1 `deriveCatalogRow(task)` 纯函数：映射 evals 任务 JSON → 五列 {id, setup, action, assertion, evidence}（setup←accessMode+fixtureFiles 键+modelPreset；action←prompt 摘要+回合数；assertion←criteria kind 集；evidence←被断言/捕获面：events/file/outbound/funnel/ttfs/snapshot）。缺列即空串供测试判红
  - P2 `scripts/evals-catalog.mjs` 生成 `evals/CATALOG.md`（按套件分组·五列表·确定性无 volatile）；`npm run evals:catalog` 便捷口
  - P3 契约测 `test/block190-evals-catalog.test.mjs`：每任务五列非空 + CATALOG.md 与「脚本重生成内容」逐字节一致（棘轮：新增/改任务未重生成目录→红）；无 volatile（不含 tmp/path/id/时间戳）
  - 门禁：docs:check/ui:audit:check（纯基建免 UI-###）/契约测/test:changed 全绿；evals:run golden+smoke 不回归
  - 完成语义：全部 evals 套件任务有标准五列目录；目录与任务源同步受棘轮守护；零字段重命名零 runner 改动
reopen: 无（本切片自洽）；catalog 若后续接 formal-admission 门控棘轮（BLOCK-191）以其为晋升清单基座
status: active
---

# BLOCK-190 — 评测基线 v2 第三切片·catalog 五列化

- 状态：`active`（2026-10-16 用户「冲·搞完评测 v2 剩余·各独立立项」发令）
- 前序：BLOCK-187（黄金路径门）/188（context_snapshot 棘轮）/189（outbound 防作弊）均 completed。

## 1. 立项自检
证据自证=把评测资产从「散落的 JSON」升为「可审阅的五列目录 + 同步棘轮」，本机可读、变更显形。非复刻厂商 evals 报表。

## 2. 范围
现有 `evals/suites/{smoke,golden,real}/*.json` 共 13 枚任务（含 BLOCK-187 golden first-success）。additive 五列派生：
- ID ← `id`；setup ← accessMode + fixtureFiles 键 + 预设；action ← prompt + mock 回合数；assertion ← criteria[].kind；evidence ← 各 kind 对应被核验面（事件流 / 文件 / 归一化出站 / funnel / ttfs / 快照）。
- 生成 `evals/CATALOG.md` 五列索引 + 契约棘轮。

## 3. 非范围（红线）
- **不改任务 JSON 字段名 / 不重构 schema**：五列是派生视图，runGoldenTask/gate 零改动（避免大 churn + 行为基线风险）。
- **不动门控语义**：PASS/FAIL 仍由 criteria 全过决定（BLOCK-191 formal-admission 才碰，且含架构裁决）。
- **不引第二 runner / 不改套件**：只在现有 `evals/**` 上加派生 + 生成物。
- **无 volatile 入目录**：CATALOG.md 不含临时路径/id/时间戳（否则不可重放）。

## 4. 执行
P1 deriveCatalogRow 纯函数（就近 `scripts/lib/evals-catalog.mjs` 或 harness）→ P2 `scripts/evals-catalog.mjs` 生成 CATALOG.md + `npm run evals:catalog` → P3 契约测（五列非空 + 逐字节同步棘轮 + 无 volatile）→ P4 closeout+五件套。

## 5. 并行隔离
触碰面=`scripts/lib/evals-catalog.mjs`(新)/`scripts/evals-catalog.mjs`(新)/`evals/CATALOG.md`(新)/`test/block190-*.test.mjs`(新)/`package.json`(evals:catalog script)/impact-map 登记。无 dev 栈、无人眼、无 provider。
