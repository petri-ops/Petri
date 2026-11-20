# A0 门禁账（2026-11-20）

## A0 自身门禁（全绿）

| 门 | 结果 | 证据 |
|---|---|---|
| HK-01 红→绿 | 红 MODULE_NOT_FOUND → 绿 12/12（7 类篡改负测 fail-closed） | `hk01-red.txt` / `hk01-green.txt` |
| 消费测试现读一致 | 六组读数 collectIdentityTranslation 重算与落盘深等 | `test/a0-identity-translation.test.mjs` |
| impact-map 分类 | A0 规则 classifiesScripts=true 命中；JSON 合法 | `test/impact-map.json`（新增 a0 规则） |
| docs:check | PASS (662) | closeout [3/x] |
| ui:audit:check | PASS | closeout [4/x] |
| hygiene:check | PASS | closeout [2/x] |
| quality:secret | PASS | 逐门 |
| quality:arch | PASS | 逐门 |
| quality:types | PASS | 逐门 |
| quality:arch-cycles | PASS | 逐门 |
| gate:css-modules | PASS | 逐门 |
| gate:version-parity | PASS | 逐门 |
| lints（A0 新文件） | 0 error | read_lints |

## HEAD 存量红（与本包文件面零交集，如实归属零触碰）

closeout 全量链在以下门 fail-fast；均核对为 HEAD/既有在制，A0 新文件（scripts/lib/a0-identity-translation.mjs、test/a0-identity-translation.test.mjs、acceptance/a0-identity-translation/**）不触发：

1. `test:changed`：分类冲突 `ui-error-classification-stall references missing test errorMessages.test.ts`——impact-map 唯一裸文件名引用（`git show HEAD:test/impact-map.json` 2 处含 errorMessages.test.ts），validator 用 `resolve(ROOT, 'errorMessages.test.ts')` 找不到（真文件在 `frontend/src/components/copilot/errorMessages.test.ts`）。HEAD 存量工具错误。
2. `gate:user-assets`：`scripts/backfill-artifact-chain.mjs` tracked at HEAD 但命中保护清单。HEAD 存量。
3. `gate:silent-catch`：`core/petri-server/helpers/lesson-store.js` 2 处 > 基线 0（EVO-2 今日提交）。HEAD 存量。
4. `quality:lint`：workspace 既有 security/detect-object-injection warning 基线（非 A0 文件）。HEAD 存量。
5. `quality:knip:check`：acceptance 下 yi-rest/stall 探针文件为并发在制 WIP（untracked）。零触碰。
6. `gate:code-size`：workspace-tools.js / loop-orchestrator.js / agent-runner.js / electron.d.ts / LeftPanel.tsx / main.js 指纹漂移（EVO/UI-715 等今日提交）。HEAD 存量。

**诚实声明**：closeout 全量链未 PASS（fail-fast 于上述 HEAD 门）；A0 自身门全绿，不把跳过表述为通过，不把 HEAD 存量红算作 A0 失败，也不代修他包在制面。
