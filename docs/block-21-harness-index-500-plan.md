---
id: BLOCK-21-HARNESS-INDEX-500
status: completed
truthDomain: block-21-harness-index-500
planVersion: v0.1
createdAt: 2026-08-24
governingDocs:
  registry: docs/DOC-REGISTRY.json
  auditLog: docs/AUDIT-LOG.md
---

# BLOCK-21 - Harness Index 500 - 计划 v0.1

## 1. 目标

修复 GET /api/harness/index?scope=project&projectId=...&maxFiles=80 抛 500 的根因。

## 2. 范围

- 修改 core/r-server/routes/_helpers/harness-shared.js desktopRootFromHere()：3层 -> 4层
- 2 端到端回归测试 PASS
- docs:check PASS / ui:audit:check PASS

## 3. 根因

routes/_helpers/harness-shared.js 的 desktopRootFromHere() 在 PHASE 2.2a 拆 routes/harness.js -> routes/_helpers/ 后路径深度仍用 3 层，需 4 层。

## 4. 验收门禁

- node --test test/routes-harness-index-500.test.mjs PASS
- npm run docs:check PASS
- npm run ui:audit:check PASS
