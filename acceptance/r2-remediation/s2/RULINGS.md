# S2 存量红清偿 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S2（P1-6 / P1-7 / P1-8 / P1-9）· 预置裁决 R10（user-assets 优先修清单/判定，不动他包索引）。

## P1-6 test:changed 裸文件名 → exit 0

现读发现三层债务，逐层清偿（fail-fast 一层层暴露，每层现读）：

1. `test/impact-map.json` ui-error-classification-stall 规则 `tests:["errorMessages.test.ts"]` 裸文件名 →
   改完整相对路径 `frontend/src/components/copilot/errorMessages.test.ts`（真实文件在盘，Nov 19）。
2. 修后暴露第二层：`scripts/e03-score.mjs` 不命中任何规则（"script classification must match exactly one rule"）——
   BLOCK-503 甲3 E-03 批漏登记 impact-map。补规则 `e03-score-calculator`（classifiesScripts=true，
   patterns=scripts/e03-score.mjs + e03-kit/**，tests=test/e03-score.test.mjs 5/5 绿现读）。
3. 再暴露第三层：27 个未跟踪证据文件无规则覆盖（FAIL_CLOSED by design）——乙组 yi-rest 探针、
   stall 实机验证证据、R2 评估产物均属**各批登记债**。补登记三条：
   `block503-human-eye-review`（docs/block503* + acceptance/block503-outputs/**）、
   `r2-remediation-batch`（R2 评估 + 本批 acceptance 面 + 提示词文档）、
   block508 规则追加 `acceptance/stall-live-2026-11-19/**` + `acceptance/stall-verify-2026-11-19/**`（原批漏登记，纯 patterns 追加）。

**裁决理由**：test:changed 的 FAIL_CLOSED 语义保持不动（不为过门禁放宽）；缺口按工具提示「覆盖缺口须补 rule」以登记债清偿。

## P1-7 user-assets tracked 误判 → exit 0

- 现读：`scripts/backfill-artifact-chain.mjs` 由 `58053d77`（2026-11-19「登记滞后清偿批补遗2」）**有意入库**
  （UI-710/713 取证 harness + artifact 链回填脚本，已完成批次归档欠账）——保护清单未同步 = 清单陈旧，非误登记入库。
- 裁决（按 R10「修保护清单」路径）：从 `test/user-asset-guard-baseline.json` 移除该条目（10→9 项），
  incidents 追加 58053d77 案 + reconcileNote 留痕；**索引与磁盘零改动**（未 git rm --cached）。
- 回归加固（R10「加回归测试」）：guard CLI 失败输出新增处置分支提示（有意入库→同批更新清单并留痕，
  不得为过门禁改判定逻辑）；`test/user-asset-guard.test.mjs` 清单自洽断言从「事故=2」演进为
  「原始两事故（34076352/932b9136）永远在册 + 台账无重复 commit」——契约追上演进（测试追契约，非契约退回测试）。

## P1-8 silent-catch lesson-store 2 处 → exit 0

- 现读：两处裸 `catch {}` 均为 `if (process.env.EVO_DEBUG)` 内**调试日志行自身的 fail-soft 内卫**
  （`try { console.error(...) } catch {}`）；外层 catch 已计 `_writeFailures` 失败计数——失败可见性由外层承担，
  内卫防的是「记日志失败再抛错吞掉原返回值」。
- 三分法裁决：**误报豁免留 reason**（非真缺陷：外层计数可见；非化石：路径在跑）。两处补注释
  `/* 调试日志自身失败不追加抛错：外层 catch 已计 _writeFailures，失败可见 */`——注释即离开债务口径
  （棘轮规则：带注释 catch 视为已豁免），与文件内既有 `/* 二次抛错豁免 */` 惯例同形。
- 邻域验证：lesson-store 相关测试 49/49 绿（evo2/evo3/orchestrator-subdomains/loop-orchestrator）。

## P1-9 失败任务账 7 条 → 逐条归属 + prune

现读 7 条 open/failed，逐条归属（log 尾现读）：

| 任务 | 日期/退出 | 归属与关闭理由 |
|---|---|---|
| block404-lint-ledger | 11-10 exit 143 (SIGTERM) | BLOCK-404 lint 台账跑批被中断；批次已收口，账目失效 |
| block404-lint-ledger2 | 11-10 exit 1 | 同上（二次跑批），BLOCK-404 已收口 |
| block405-l1-regression | 11-10 exit 1 | BLOCK-405 L1 回归跑批失败后批次另行收口，账目失效 |
| v0.0.1-ecs-feed-rebuild | 11-16 exit 1 | electron-builder 打包失败；**G1+ 面**，后继 rebuild2 exit 0 已取代 |
| build-v004 | 11-16 exit 1 | electron-builder 打包失败；后继 build-v004-retry exit 0 已取代 |
| wait-507-commit | 11-19 exit 2 | `TIMEOUT_NO_507_COMMIT`——等 507 提交的看门超时；507/508 此后均已收口 |
| a4r3-backend | 11-20 exit 1 SIGTERM | A4-R3 专用 backend 验证后被有意 kill（离屏纪律），日志显示服务正常直至终止 |

处置：`task:status --prune-days 7` 清出 11-10 三条 → 复跑 `--prune-days 1` 清出其余 4 条（全部为已收口批次的
被杀/被后继取代/超时残留，归属如上留痕后清账；任务账只呈现不裁决，归属以本文件为准）。

## 出口核验（现读 2026-11-21 07:4x）

- `npm run test:changed:list` exit **0**（基线 2）
- `npm run gate:user-assets` exit **0**（基线 1）+ guard 测试 4/4
- `npm run gate:silent-catch` exit **0**（基线 1，101 文件/402 处=基线 402）
- task:status open/failed **0**（基线 7）
- lesson-store 邻域 49/49；e03-score 5/5

## HK-01 红绿先行

**豁免**（纯治理/工具面登记批）：impact-map/baseline/注释补全均为登记与豁免留痕，无新行为契约；
guard 提示行与测试断言演进属契约追上面（测试先改，红绿证据=4/4 前后对照：改前 fail 1 → 改后 pass 4）。
