---
capability: block497-migration-idempotent
status: active
phase: P0-LAUNCH
goal: MIGRATION-IDEMPOTENT 修复票（用户 2026-11-19 A 组 #1 发令）——自愈补列收窄版记账：ensureProjectWorktreeColumn 补列成功后仅当 MAX(schema_migrations.version)===20 补记 v21，消除「无头栈补列→桌面壳 boot 重放 021 撞 duplicate column 拒启」缺口（AUDIT-LOG 🟡 2026-11-17 实机案底）；小体量单票。
acceptance:
  - HK-01 红绿：红=补列后台账仍 v20→runMigrations 重放 021 复现拒启；绿=补列+记账 v21→重放跳过（真实 021 SQL 副本走真实 runMigrations）
  - 跳版守卫：MAX(version)!==20 不记账（v15 库防误记 16~20）；schema_migrations 缺席不记；补列+记账同事务（不留半态）
  - 邻域零回归（block336 worktree 三测试）+ docs 门禁 + closeout 定向 + 六件套 + commit/push
  - 零新依赖 / 迁移数据零删除（只 INSERT ledger 行，不触碰用户数据行）/ 观感零代签 / 不碰 G1+
reopen: 桌面迁移面再出幂等缺口（如 022+ 同类）或用户裁决改守卫口径时修订
supersedes: 无（处置 AUDIT-LOG 🟡 MIGRATION-IDEMPOTENT 行 + BLOCK-495 评审材料 §2 推荐形态落地）
---

# BLOCK-497 · MIGRATION-IDEMPOTENT（自愈补列收窄版记账）

日期：2026-11-19 · 关联：[BLOCK-495 评审材料](./block495-candidate-pool-review-2026-11-19.md) §2（推荐形态）· AUDIT-LOG 🟡 2026-11-17 案底 · [BLOCK-457 单一 spawner](./block-457-dev-single-backend-ownership-plan.md)（暴露面收窄的背景）

## 0. 一句话

无头栈先开旧库时自愈补列不记账 → 桌面壳重放 021 拒启。修法=自愈补列成功后，恰差一版（v20）才补记 v21；同事务原子；其余版本态不记（防跳版误记）。

## 1. 改动面

- `core/petri-server/helpers/project-worktree.js` `ensureProjectWorktreeColumn`：补列 ALTER 与条件记账（INSERT schema_migrations v21）包进同一事务；守卫=MAX(version)===20；schema_migrations 缺席/查询失败不记；projects 表缺席沿用既有静默路径。
- `test/block497-migration-idempotent-selfheal.test.mjs`（新）：三测——主测（v20→自愈→记账 v21→真实 runMigrations 重放 021-only 目录跳过）、跳版守卫（v15 不记账）、全新库静默。

## 2. 非范围

- 不改 `src/migration-runner.js`（迁移内核零触碰——评审材料已否决 runner 层通用幂等化，回归面大）。
- 不改 021 SQL 原文；不回填 2026-11-17 已手工解锁的旧态（单机已处置；新形态由本修复覆盖）。
- 后续 022+ 迁移若有同类裸 ALTER 另案（reopen 条款）。
- 零新依赖 / 观感零代签 / 不碰 G1+ / 他方 WIP 零触碰。

## 3. 验收判据

- `node --test test/block497-migration-idempotent-selfheal.test.mjs` 3/3（红证据 hk01-red.txt：主测红复现缺口、守卫测前-后均绿）；
- 邻域 `block336-worktree-*` 22/22 零回归；
- `npm run closeout` 定向绿；证据落 `acceptance/block497-migration-idempotent/`；
- G0 开发期常态 · 不外推 packaged/Provider/GA。
