---
capability: data-dir-retention
goal: BLOCK-210 = runlist W7e（阶段 4 C-5）＝ **数据目录可配 + 历史留存/自动归档策略**。按 W4b 的结论分两半：①**留存与归档**（可配：保留天数/单目录上限/归档目录；默认=现状不删）本包接线并生效；②**数据目录迁移**只交付**迁移计划器 + 预览**（备份路径、步骤、回退命令），**不执行搬迁**——真实搬迁涉及运行中 DB/结果目录，需要一次性窗口与人工确认，属 reopen（W4b 的先例：搬迁必须带备份与回退）。
acceptance:
  - P0 基线：`test/block210-data-retention.test.mjs` 冻结"默认零行为变化"——未配置时**不删除、不移动**任何文件；当前数据根的解析仍只来自 `shared-backend/data-paths`（不许第二套回落链）。
  - P1 schema：族 `data-retention`——`retention.historyDays`（0=永不删，默认 0）、`retention.archiveDir`（空=不归档）、`retention.maxBytesPerDir`（0=不限）。
  - P2 落点：`helpers/data-retention.js`：`readStore/writeStore/resetRetention`、`planRetention({now, entries})` **纯函数**（给候选清单 → 返回 keep/archive/delete 三类决定，**不执行**）、`applyRetention({dryRun})`（默认 dryRun=true；真删必须显式 `dryRun:false` 且打印摘要）。
  - P3 迁移计划器：`helpers/data-dir-migration.js`：`planMigration({from,to})` 返回 `{steps, backupPath, rollback, blockers}`；**只读**，不创建/移动任何文件；被运行中 DB 占用等若无法判定则如实列 `blockers`（不假装可行）。
  - P4 写面：`GET/PUT /api/data/retention`（400 + diagnostics）；`POST /api/data/migration/plan`（只返回计划，永不执行）。
  - P5 收尾：`config-transfer`/`config:doctor`/漂移门 `NO_UI_FAMILIES`；closeout 十三门。
  - 完成语义：**默认不动任何用户数据**；归档/删除只在显式开启且 dryRun=false 时发生；迁移**只出计划**，执行属 reopen。
reopen: 真实数据目录迁移（一次性窗口 + 备份 + 回滚演练 + 迁移后自检）；定时任务接线（当前只提供手动 apply 入口）；按类型的留存策略（transcripts vs results vs uploads 分别配置）。
status: active
---

# BLOCK-210 · 阶段 4 C-5：数据目录可配 + 历史留存/归档

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W7e**（W0–W7d 已 completed）。发令：2026-10-18「继续」。

## 0. 为什么把"迁移"降级为计划器

W4b 已经把**目录解析**收成 `shared-backend/data-paths.js` 单源（两个有名字的根 + 历史只读兼容）。在这个基础上"改数据目录"的真实难点不是解析，而是：运行中的 SQLite、结果目录、正在写的上传流——**任何一次搬迁都需要停写、备份、校验、回滚演练**。把它塞进本包等于在没有一次性窗口的前提下动用户数据，违反 "数据主权 > 进度"。

因此本包：
- **做**：留存/归档策略（默认零删除）+ 迁移**计划器与预览**（备份路径/步骤/回退命令/阻塞项）；
- **不做**：执行搬迁（reopen，须一次性窗口与备份演练）。

## 1. 红线

- 默认**不删、不移**任何文件；`applyRetention` 默认 `dryRun:true`。
- 目录解析只许走 `data-paths`（W4b 单源），**不得**在留存/迁移模块里再写 env 回落链。
- 迁移计划器**只读**：不 mkdir、不 rename、不复制；无法判定的阻塞项如实列出。

## 3. 落地记录（2026-10-18）

- **P1**：`data-retention` 族（`historyDays` 0–3650 / `archiveDir` / `maxBytesPerDir` 0–1e12）⇒ 注册表 **17 族 / 89 键**；三项全 `ui:'none'`。
- **P2**：`helpers/data-retention.js`——`planRetention` **纯函数**（过期→archive 或 expired；容量按最新优先保留）；`applyRetention` 默认 `dryRun:true`，且**删除必须 `allowDelete:true`**；配置变更与执行均追加 `retention-audit.jsonl`。
- **P3**：`helpers/data-dir-migration.js`——`planMigration` **只读**（不 mkdir/不复制）：给出 6 步流程、备份路径 `.bak-<时间戳>`、回退命令，并如实列阻塞项（源缺失 / 目标非空 / 同目录 / 相对路径 / 检测到 `petri.db-wal` ⇒ 数据库疑似仍在跑 / 跨卷需分阶段）。
- **P4**：`GET/PUT /api/data/retention`（400 + diagnostics）+ `POST /api/data/migration/plan`（缺参 400；正常返回 `executed:false`）。
- **P5**：`config-transfer`/`config:doctor`/漂移门 `NO_UI_FAMILIES` 接入；closeout 十三门 PASS。
- 证据：`test/block210-data-retention.test.mjs` **8/8** + 漂移/基线/transfer 21/21。
- **诚实边界**：真实搬迁与真实清理**未实现执行**——`planMigration` 只出计划，`applyRetention` 只产出动作清单（v1 落点在"可配置 + 可预演"，执行属 reopen，须一次性窗口 + 备份演练）。
