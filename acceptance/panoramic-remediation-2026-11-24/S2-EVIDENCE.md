# BLOCK-511 · S2 门禁自洽证据（2026-11-24）

## 2.1 W5a 清红

- 修复前 `nso-w5-impact-coverage` 1/3 红：3 个报告指定测试 + S1 新增 2 测试成孤儿。
- 挂规则：`p6-driver-iframe-probe`→`p6-electron-pressure-prototype`；`p6-pack-scheme-privileges`→`block216-q5-work-surface-host`；`utility-host-decision`→`qoder-yellow9-a2-explanation`；S1 两测试（`cache-manager-cleanup`/`quit-guard-default-prevented`）与 S2 两测试（`code-size-allow-grow`/`gate-tracked-consistency`）→`closed-batch-evidence-dirs`。删除 `test/pipeline.test.js` 后同步从 `impact-map-coverage-baseline.json` 移出。
- 修复后 3/3 绿。

## 2.2 测试入口补全

- `package.json#test:all` 由顶层 glob 改为 `node scripts/test-all.mjs`（递归枚举 `test/` 下 `*.test.{mjs,cjs,js}`，逐文件进程隔离）。
- `scripts/test-all-shards.mjs#listNodeTests` 改递归；`--plan` 计数 node-core 844 / node-long 8（此前仅顶层 mjs/cjs）。
- 4 个新纳入测试逐个处理：
  - `test/pipeline.test.js`：**删除**（`core/gateway/pipeline` 生产代码已不存在，OSS 解耦后移除；plan §3.1 留因，不用 skip 掩盖）。
  - `test/block67-node-agent-fs.test.js`、`test/scripts/check-ui-productization-audit-exit-2.test.mjs`、`test/scripts/dev-launch-state.test.mjs`：验证有效（37 pass + 1 darwin 既有平台 skip），挂 `closed-batch-evidence-dirs` 规则。

## 2.3 去个人绝对路径

- 新增 `test/helpers/petri-pack-bio.mjs`：`PETRI_PACK_BIO_ROOT`（缺省仓库同级 `petri-pack-bio`），不存在时 `readPackBioJson()` 返回 null。
- 4 个测试（p6-pack-table-surface-disable / p6-artifact-switch-pack / p6-result-surfaces-retire / p6-inspect-decider）写死 `/Users/zhangdiandian/...` 全部移除；依赖 pack.json 的断言拆为独立 test，路径缺失时 `t.skip(PACK_BIO_SKIP_REASON)` 显式跳过。
- 验证：默认路径 17/17；`PETRI_PACK_BIO_ROOT=/nonexistent` 时 2 skipped / 0 fail（显式 skip 生效）。

## 2.4 gate:tracked-consistency

- 新脚本 `scripts/gate-tracked-consistency.mjs`：检查 impact-map `tests` 与具体路径 `patterns`（非 glob/目录）+ package.json 脚本文件路径目标必须存在且已跟踪；兼容 `frontend/` 与 `.agents/skills/*/scripts/` 工作目录前缀；在制未入库项走带 owner/date/reason 的豁免基线。
- HK-01 `test/gate-tracked-consistency.test.mjs` 5/5（夹具引用未跟踪文件即红、豁免项绿、glob 不参与）。
- 挂进 `package.json#closeout`（`--gate gate:tracked-consistency`）与 CI。
- 豁免基线：`test/c56-user-manuscript-fidelity.test.mjs`（owner=C-56，date=2026-11-24，reason=他包未跟踪 WIP，S0 已登记）。
- 清理 impact-map 29 条指向不存在文件的具体路径 pattern（报告 §3 口径 33 条含 glob/目录形态差异），逐条清单见 `/tmp/panoramic-baseline/s2-dead-patterns.txt`（提交后归档入本目录 `dead-patterns.txt`）。这些 pattern 永不被改动触发（路径不存在），删除不影响任何 test 执行。

## 2.5 棘轮上调留因

- `scripts/code-size-ledger.mjs`：`--write` 默认拒绝未留因上调；`--allow-grow <path>=<reason>` 可重复，理由+from/to+date 写入 `size-baseline.json#growAllowances`；`evaluateGate` 对有留因的 path 放行行数/字节增长（sha 漂移仍须重打）。
- HK-01 `test/code-size-allow-grow.test.mjs` 3/3（无留因上调红、有留因绿、下调始终绿）。
- `scripts/knip-ratchet.mjs`：`--update` 默认只允许下调，新增键须 `--allow-grow <key>=<reason>`；留因写入 `knip-baseline.json#growAllowances`。
- 清 gate:code-size 红：`simple-chat.css` +25 行/683 字节来源 commit `16c48c6d`（QODER-A2 P3 骨架样式，UI-721），`--allow-grow` 留因重打；SimpleChat.tsx/src/main.js/loop-orchestrator 行数下调 + sha 同批 `--write`。gate:code-size PASS（74 文件/总 86724 行/16 生效例外）。
- knip：删除 `ACTIVE` 死导出（下调）；`shutdownUtilityHosts` 为 `src/main.js:897` 动态 require 入口（knip 静态盲区），`--allow-grow` 留因纳入。quality:knip:check PASS（407 键）。

## 2.6 CI

- `.github/workflows/ci.yml`：`concurrency`（同 ref 取消旧运行）+ `timeout-minutes: 45`；push 触发加 11 项静态门禁（docs:check / ui:audit:check / quality:secret / quality:arch / quality:lint / quality:types / gate:code-size / gate:css-modules / gate:arch-cycles / quality:knip:check / gate:tracked-consistency）。release.yml 未动。
- CI 全绿结果：提交推送后用 `gh run list` / `gh run view` 确认（见 S6 汇总）。

## 出口门禁（S2）

- W5a 3/3；gate:code-size PASS；quality:knip:check PASS；gate:tracked-consistency 提交后 PASS（HK-01 纯函数 5/5 已绿）。
- docs:check / ui:audit:check / quality:secret / quality:arch / quality:lint / quality:types / gate:css-modules / gate:arch-cycles 全绿。

## 决策工具

- `doc:suggest -- --supply=cloud`：suggestions=["planDoc"]（S2 plan §3.1 留因已写，增量满足）。
- `decision:session`（S2 时点）：jev×8 本轮增量 / 累计 655。
