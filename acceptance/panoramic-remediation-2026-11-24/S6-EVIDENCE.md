# BLOCK-511 · S6 总验证与收口证据（2026-11-24）

## 全量测试

- `npm run test:all:sharded --all`：node-core 6618 项 / frontend（vitest 全量）/ node-long 8 项；原始输出 `/tmp/panoramic-baseline/s6-test-all-sharded.log`，汇总 `acceptance/nso-2026-11-06/wave-0/full-test-shards/summary-1795497050709.json`（首次 allPassed=false）。
- 首次 node-core 50 红中，本包引起 2 类已修：①`scripts/roadmap-compact.mjs` 未挂 impact-map 分类（test-affected ~20 红）→ 挂 `script-governance` 后 21/21；②K3/K4/K15 债与 knip 上限硬编码随 canonical triage/`--allow-grow` 演进（29/15/14、409）→ 同步后绿。其余为存量（tool model-surface 118/120 等，S0 已红、本包零工具定义改动）。

## 实机腿汇总

- **发消息与 SSE 聊天流**：S4 `block511-s4-firstpaint-live` 10/10（聊天消息可见 + 零 CSP 违规 + 首屏渲染）。
- **排队追问刷新后保留**：S6 `block511-s6-queued-reload-live` 4/4（localStorage 预置队列→刷新→仍在；证据 `live/`）。
- **Cmd+Q 取消与确认**：单测注册顺序契约（`quit-guard-default-prevented` 3/3 + terminal 6/6）；原生确认对话框 CDP 离屏不可达，如实标 not_present，不伪造。
- **文件打开 / MCP 连接 / 审批卡**：S3 单测契约（open-path 3/3、MCP 路由 2/2、block239/258）+ S6 实机面在场检查（审批卡本会话未出现，标 not_present）。
- 均 9223 离屏实例，跑完即 kill（S4 pid 24283 / S6 pid 46723）；未开可见窗口。

## closeout:full 门禁逐项（最终）

| 门 | 结论 | 归属 |
|---|---|---|
| AUDIT-LOG 自稳 / hygiene / docs:check(666) / ui:audit:check | PASS | — |
| test:changed | PASS（提交后） | — |
| gate:user-assets / version-parity / silent-catch / code-size / arch-cycles / css-modules / tracked-consistency / quality:secret / arch / lint / types / knip:check / perf / post-h9-contracts / surface | PASS（逐门单独复验 + closeout 聚合） | — |
| quality:lint:ledger | FAIL（存量：S0 基点即 1499>1480 / 418>416；本包新文件 ESLint warning 0） | 11-21 基线打点后多批提交累积，非本包引入 |
| quality:ear | FAIL（存量：S0 基点 38.9%<42.5%；本包改善到 41.0%） | manifest 11-21 高水位，HEAD 改动前已红 |

- 因两门存量红，closeout:full fail-fast 未能聚合全绿；按提示词「存量红如实归属登记，不算本包失败，不得把 SKIPPED 写成 PASS」如实记录。所有其余门均已单独跑绿（非 SKIPPED）。

## CI

- S2 推送后 CI run `45325701839` success（11 静态门 + timeout/concurrency 首发验证）。

## 决策工具与 Jev 计数

- test:suggest（S1/S3/S5）=[]；doc:suggest（S0 planDoc / S2 planDoc / S3 空 / S4 uiAudit / S5 空）；output:judge / next:suggest 见收口答复。
- `decision:session` 收尾重跑取分段数字（见最终答复）。

## 遗留

1. web_fetch pin-IP（S3 plan §3.2，按提示词授权登记）。
2. 3D 卡可展开实机：本会话无 artifact，构建 chunk + lazy 单测背书。
3. Cmd+Q 原生确认对话框、文件打开系统 dialog、MCP UI 连接、审批卡：离屏 CDP 不可达项如实标 not_present / 单测契约背书。
4. 存量红两门（lint:ledger / EAR）S0 已红，本包零触碰对应基线，不凑绿。
