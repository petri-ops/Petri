# BLOCK-21 Harness Index 500 — 收口笔录

> 收口日期：2026-08-24
> 工作包归属：BLOCK-21-HARNESS-INDEX-500（completed）

## 1. 摘要

`GET /api/harness/index?scope=project&projectId=...&maxFiles=80` 返回 500 的根因是 `core/r-server/routes/_helpers/harness-shared.js` 中 `desktopRootFromHere()` 的路径深度算错：3 层应改为 4 层，导致 `loadHarnessModule()` 拼出 `desktop/core/scripts/harness-file-index.mjs`（不存在）→ ERR_MODULE_NOT_FOUND 转 500。

该 bug 由 PHASE 2.2a 拆分引入，未同步更新路径深度。

## 2. 修复

修改 `core/r-server/routes/_helpers/harness-shared.js:55-58`：`'../../..'` → `'../../../..'`，注释解释 4 层路径。

## 3. 验收

- `node --test test/routes-harness-index-500.test.mjs` 2/2 PASS
- `docs:check` PASS（140 docs）
- `ui:audit:check` PASS（157 UI IDs）
- tsc 0

## 4. 不外推

G0 开发期常态 · 不外推 packaged/Provider/GA/P7/dist staleness G1+
