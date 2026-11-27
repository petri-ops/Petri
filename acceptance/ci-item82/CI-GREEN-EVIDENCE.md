# item 82 · desktop-ci 22 连红修复证据

## §1 归因（逐笔）

- 最后一次绿 `422766fc1`（11-26 02:21）；最早红笔 `9842cad6` / run `45784017981`：静态门 `gate:code-size` 挂 `LeftPanel.tsx` 内容指纹漂移未随提交重打基线。后续批次已有 `--write` 随提交，当前 tip 该门绿。
- 当前 tip `06f58af42` / run `45857882103`：挂在 `Run platform regressions`，`test/mcp-tool-registry.test.mjs` 子进程 `SqliteError: no such table: projects`（35 测 28 绿 1 红，CI job `stability` failure）。
- harness 步骤因前一软件步骤失败而未执行；本地补跑后发现 3 条 approval 红（见 §2）。

## §2 两处真修（无 skip）

1. **MCP registry 测试 DB 自举**：`test/mcp-tool-registry.test.mjs` 在动态 import `core/petri-server/mcp/registry.js` 前，比照 `test/agent-vision.test.mjs` 自举临时 `petri.db` 并跑 `src/migrations/*.sql` 全量迁移，设 `PETRI_DB_PATH`，退出清理。模块加载期 `prepare projects` 不再失败。平台步本地 35 测：33 绿、2 live-skip（需 R 环境）。
2. **ack CAS 初始态不一致**：`core/petri-server/db.js::ackToolJob` 的 CAS 只认 `ack_status IS NULL`，但 `createToolJob` 初始写 `'pending'`（`7e65312824` harness M1 引入），导致 approve/reject/continuation 三条测试全挂、产品上确认链失效。谓词改为 `(ack_status IS NULL OR ack_status='pending')`，保留对已 approved/rejected 的重入拒绝；同步 `test/ack-token-guard.test.mjs` 的 HK-01 源断言并留因。

## §3 本地完整 CI 步骤（全绿后推）

| 步骤 | 结果 |
|---|---|
| 11 静态门（docs/ui-audit/secret/arch/lint/types/code-size/css-modules/arch-cycles/knip/tracked-consistency） | 11/11 PASS |
| platform regressions（5 文件） | 33 PASS / 2 live-skip / 0 fail |
| harness:check / harness:phase6 | PASS / PASS |
| harness bundle（8 文件） | 105 PASS / 1 skip / 0 fail |
| frontend check / 2 定点测试 / build:spa | PASS / PASS / PASS |

未跑：R 环境相关的 live-skip（CI 也 skip）。owner 未提交 WIP（`docs/DOC-REGISTRY.json` + 20+ 未跟踪项）零触碰；未开新功能线。

## §4 交付后

push 后回执 SHA；待 GitHub CI 出结论再报一次绿/红。若仍有红笔，按 `--log-failed` 逐笔真修。
