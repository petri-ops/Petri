# BLOCK-436 · 真实栈实测驱动的两处修复

> 本包原为 BLOCK-437 的前置补丁（`aeda9abc`），当时只提交了代码与测试、未建发令文档与台账条目；
> BLOCK-439 端到端核对发现该治理缺口，按「机械遗漏补齐」补建本册并注册，代码零改写。

## 背景

此前所有验证都停留在单测与静态门，未起真实后端。用临时库（`src/migrations` 全量）+ `PETRI_DB_PATH` /
`PETRI_LOCAL_DATA_DIR` / `R_SERVER_PORT` 起 `core/petri-server/server.js` 后，暴露两个单测抓不到的问题。

## 交付（两处 done）

| ID | 实测发现 | 修复 | 复测 |
| --- | --- | --- | --- |
| F1 | 全新库上 `GET /api/ai/facts`、`GET /api/ai/memory-stats` 返回 `500 no such table: user_facts`——`user_facts` 建表只在写路径的惰性 `_ensureTable()` 发生，读路径先查即炸 | `helpers/user-facts.js` 暴露幂等 `ensureUserFactsTable`；`routes/ai-memory.js` 三个读路径查询前 `await ensureMemorySchema()`（同时触发 `memory-vectors` 模块加载建表），失败不阻塞读路径 | 两接口 → `{"status":"ok"}` / 200 |
| F2 | 启动期 3 条 `[ddl-migrate] FAILED … no such table` 假 error——表由 owner 模块惰性创建且**建表语句已含** `project_id`，`ai-memory` 在加载期先跑 ALTER 必然「表不存在」 | `helpers/ddl-migrate.js` 把 `no such table` 归类为预期（info），真实 IO / 语法故障仍为 error | 启动期 FAILED 计数 **0**；新增负测断言真实 IO 故障仍 error |

## 边界与不改写

- 修 F2 时**没有**改基线洗白、**没有**用字符串拼接规避判据；只调整「预期内」分类。
- `test/m5a-production-wiring.test.mjs` 增至 13/13（新增「表尚未创建属预期」负测）。
- 零新增依赖 / 零放宽阈值 / 零触碰在制 WIP。
- 与 BLOCK-437 的关系：F1/F2 是 437 真实栈冒烟脚本跑出来的前置修复，437 补记一/二已引用。

## 证据

`acceptance/m-blueprint-2026-11-11/m6a/real-stack-smoke.txt`（A/D 段）、
`acceptance/m-blueprint-2026-11-11/m6a/verification-matrix.json`、
`acceptance/m-blueprint-2026-11-11/m6a/full-test-sweep.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
