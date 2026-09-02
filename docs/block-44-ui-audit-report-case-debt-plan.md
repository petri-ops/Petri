# BLOCK-44 — ui:audit `--report` schema 大小写债务修复计划

## 1. 背景

AUDIT-LOG 2026-08-30 🟢 契约偏差条目：`check-ui-productization-audit.mjs` 的 `UI_ID_PATTERN`（`/\bUI-(?:\d{3}|AGENTWB-\d{3})\b/gi`）大小写不敏感提取，而 `docs/schemas/ui-audit-report.schema.json` 的 `knownUiIds` / `unmappedIds` item pattern 为大小写敏感 `^UI(?:-AGENTWB)?-\d{3}$`。台账行文 37 处小写 `ui-###` 引用被原样提取进报告 → schema 校验必失败 → `--report` 模式自上线起 exit 2、报告永不落盘，GATES-3 的逐编号注册检查（UI_AUDIT_UNMAPPED）实际从未生效。

连带语义缺陷：`loadRegisteredUiIdsSync` 同样走大小写不敏感提取且不归一，台账小写引用以独立 id 混入 registeredIds 集合（`ui-193` ≠ `UI-193`），造成已注册集合污染与大小写敏感 `includes` 比对的不对称。

**用户裁决（2026-09-03）**：先处理 ui:audit 的 schema 大小写债务。

## 2. 方案（摸底后定型）

**在提取边界归一为大写**（`uiIds()` 返回 `.map(id => id.toUpperCase())`），而非仅给 schema 加 `i` 标志：

- schema 保持严格 canonical 大写契约（契约文件不放松）；
- 同时修掉 registeredIds 集合污染（台账小写引用归一到与条目标题一致的 canonical id）；
- commit subject 的 `ui-###` 引用与台账条目比对变为大小写无关；
- 报告 `knownUiIds` / `unmappedIds` 全大写 → schema 自然通过。

单点收口：`detectUnmappedSurface` 内部与 `loadRegisteredUiIdsSync` 均经 `uiIds()`，一处修改全覆盖。

## 3. 非范围

- 其余两个 gate（docs-governance / test-affected）的 `--report` schema 不动（无已知同类偏差，如实测发现另行登记）。
- 台账 37 处小写行文不改写（归一在提取边界完成，行文保持原样）。
- 默认 `ui:audit:check` 行为除「大小写归一」外不变；不加新检查项、不放宽既有判定。

## 4. 阶段

- **P0 立项**：本计划落盘 + DOC-REGISTRY + docs/README 入口 + roadmap active + AUDIT-LOG 立项登记。
- **P1 修复**：`uiIds()` 归一大写；核对 `test/scripts/check-ui-productization-audit-exit-2.test.mjs` 既有断言（该测试自建 registeredIds 用裸正则，需同步改为共享提取语义）；新增小写归一单测（小写 commit id × 大写注册 id → 不误报 UNMAPPED）。
- **P2 门禁**：exit-2 测试文件全绿 + `--report` 实测（报告落盘 + schema valid + exit 0）+ `npm run ui:audit:check` + `npm run docs:check`。
- **P3 收口**：AUDIT-LOG 🟢 条目改 ✅ 并登记处理记录 + 收口条目；DOC-REGISTRY completed；roadmap active 清空；提交。

## 5. 验收门

- `node scripts/check-ui-productization-audit.mjs --report <tmp>` exit 0（或 1=真实 FAIL）且报告落盘、schema 校验通过——不再恒 exit 2。
- exit-2 测试文件全绿；新增归一用例覆盖。
- `npm run ui:audit:check` + `npm run docs:check` PASS。
- G0 开发期常态 · 不外推 packaged/Provider/GA（收口笔录用语）。

## 6. 进度记录

- 2026-09-03 P0 完成：摸底确认根因（提取不归一 → 报告小写 id 撞严格 schema + registeredIds 污染）；方案定型为提取边界归一，schema 保持严格。本计划落盘并注册 DOC-REGISTRY。
- 2026-09-03 P1 完成：`uiIds()` 单点归一 `.toUpperCase()`；既有 exit-2 测试 10 项兼容通过，新增 2 项归一单测（小写 `ui-001`/`ui-agentwb-001` 映射大写注册 id 不误报；小写未知 id 输出 canonical 大写 unmappedIds），12/12 全绿。
- 2026-09-03 P2 完成：`--report` 实测 exit 0、报告落盘、235 个 knownUiIds 全部 canonical（修复前该模式恒 exit 2 无报告）；`npm run ui:audit:check` PASS；`npm run docs:reconcile` 0 issues；`npm run docs:check` PASS（184 documents）。
- 2026-09-03 P3 完成：AUDIT-LOG 2026-08-30 🟢 条目改 ✅ 并登记处理记录 + BLOCK-44 收口条目；DOC-REGISTRY status completed；roadmap active 清空。G0 开发期常态 · 不外推 packaged/Provider/GA。
