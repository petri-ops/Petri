# A5 外部监督器 C 先行 — 证据（只观测不动作）

> 裁决来源：`docs/harness-invisible-issues-optimization-2026-11-25.md`（main 工作树 owner 裁决材料，**零触碰**）§4「A5 外部监督器 → C 先行（只告警不动作，接 OB-003/004/007）」；口令「外部监督器 C 先行」。
> 原始材料：`acceptance/harness-observability/U-EXTERNAL-SUPERVISOR.md`（**零触碰**，status 仍 `pending_user_ruling`，见 §7）。
> 分支：`petri-ops/codex-harness-invisible-a5`（独立 worktree `manatee`，基于 main `7d24bffea`）；提交留本地，push 等主人逐批口令。
> 定性：**只观测不动作**——把「会话心跳超时 / 进程异常退出」从不可见变可见，拿真实事故频次再决 A/B；不恢复、不接管、不扩张控制面。

## 1. 改动清单

| 文件 | 性质 | 内容 |
|---|---|---|
| `core/petri-server/helpers/external-supervisor.js` | 新增 | 纯观测汇（sink）。两条观测入口 + 四出口 + 进程异常钩子 + 快照/健康面 |
| `core/shared-backend/metrics.js` | additive | `recordSupervisorObservation()` + snapshot/reset 增 `supervisor` 桶，既有 ipc/db/backend/breakers 字段零漂移 |
| `core/petri-server/helpers/stale-running-reconciler.js` | additive | `onHeartbeatTimeout` 可选只读回调（默认 no-op、抛错必吞），SQL/返回/判定零改动 |
| `core/petri-server/server-main.js` | additive | 进程异常钩子先于 error-log 的 exit(1) 安装；对账器接观测回调；legacy health 兜底面带 supervisor 细节 |
| `core/petri-server/routes/index.js` | additive | 实际命中的 modular `/api/health` 带 `supervisorSnapshot`（只读） |
| `test/harness-a5-external-supervisor.test.mjs` | 新增 | HK-01 红绿先行 10 条（观测三出口/脱敏/ fail-soft/零控制面/接线/对账回归） |
| `eslint-suppressions.json` | 收缩 | 删 1 条经 `eslint --prune-suppressions` 确认已不再命中的陈旧抑制（`LeftPanel.test.tsx` unbound-method×4）；只缩不放，与本任务无关 |

零新依赖：`package.json` / lock 零改动；仅用 Node 内建 `node:crypto` 与仓内现成模块。

## 2. 接的真源 API（先核真再接，零臆造）

| 真源模块 | 实际 API（核读确认） | 用途 |
|---|---|---|
| `core/shared-backend/incident-fingerprint.js` | `normalizeIncidentFingerprint({source,errorCode,tool,message}) → {fingerprint, normalized}`（sha256，纯函数；内置 redact：密钥/邮箱/conv_/task_/路径/数字/hex） | 脱敏 + 聚类指纹；raw 不落盘 |
| `core/petri-server/helpers/incident-log.js` | `recordIncident({source,errorCode,tool,phase,message,context})`（白名单 `fatal/tool_failure/sse_reason/stall/reject`，best-effort 全吞） | 复用 `stall`（心跳超时）/ `fatal`（异常退出）两类 source 写 `incidents` 表 |
| `src/migrations/023_incidents.sql` | `incidents(fingerprint, source, error_code, tool, phase, normalized, conversation_id, created_at)` + `idx_incidents_fingerprint` | 落库契约（隔离栈已应用到 v023/v024，实机读到真行） |
| `core/shared-backend/metrics.js` | `setBreakerState` / `getMetricsSnapshot` 原样；新增 `recordSupervisorObservation({reasonCode})`（additive 计数桶） | 事故频次计数，`/api/_internal/metrics` 可读 |
| `core/shared-backend/error-log.js` | `logError(source, err, meta)`（JSONL append + 同源 dedupe） | 告警留痕：`source='external_supervisor'`，meta 带脱敏 reasonCode/fingerprint；传字符串不传 Error ⇒ 无 stack 路径泄漏 |
| `core/shared-backend/health.js` | `buildHealthShape({service,readiness,details})` | supervisor 快照挂 `/api/health`（只读可见面） |

## 3. 观测事件 → 三出口（无第四种动作）

- **心跳超时**：既有 60s stale-running 对账器在真收口（SQL changes ≥ 1）后只读回调 `onHeartbeatTimeout({sessionKey, at})` → `observeHeartbeatTimeout()` → `source='stall'`、`errorCode='session_heartbeat_timeout'`。
- **异常退出**：`installSupervisorProcessHooks()` 注册 `uncaughtException` / `unhandledRejection` 只读监听（先于 error-log 钩子安装，保证留痕先于其 exit(1)）→ `observeAbnormalExit()` → `source='fatal'`、`errorCode='session_abnormal_exit'`。**不读 Error 原文**，不改退出语义。
- 每条观测同步写：`recordIncident` + `recordSupervisorObservation` + `logError` 告警留痕 + `buildHealthShape` 细节；四出口各自 try/catch，任一失败不阻断其余、不阻断被观测主链。
- **脱敏**：reasonCode/signal 均来自冻结窄词表；会话键经 sha256 截 12 hex（不可回溯）；送出 message 仅 `reasonCode:signal`；无用户消息/文件正文/绝对路径/凭据/endpoint；零外发、本地主权。

## 4. HK-01 红绿先行

```
# 红（实现前）：10 tests / 0 pass / 10 fail（require 缺位 + 源级接线缺席）
# 绿（实现后）：
node --test test/harness-a5-external-supervisor.test.mjs      → 10/10 PASS
+ 回归：pl6a / block520-p1 / evo1 / evo0                      → 32/32 PASS
合并命令：42 tests / 42 pass / 0 fail
```

契约覆盖：① 心跳超时三出口+health ② 异常退出三出口 ③ 脱敏零残留 ④ 进程钩子只观测且可 dispose ⑤ fail-soft ⑥ 快照累计 ⑦ 零控制面红线（无 kill/spawn/timer/exit/UPDATE/DELETE/INSERT） ⑧ metrics additive 零漂移 ⑨ 对账器默认 no-op/抛错不阻断/DB 语义不变 ⑩ 两处 health 接线 + U 材料 status 不擅翻。

## 5. 隔离栈实机验证（不碰 owner dev 实例）

- 隔离后端：临时数据根 `mktemp -d /tmp/petri-a5-verify-XXXXXX`，预跑 migration 001→024（含 023_incidents），端口 **3911**；跑完已清理（3911 free）。
- `GET /api/health` HTTP 200 → `supervisorSnapshot: {observations:0, byReason:{}, lastReasonCode:null, lastFingerprint:null}`（additive 字段在场）。
- `GET /api/_internal/metrics` HTTP 200 → `supervisor: {observations:0, byReason:{}}`（既有字段零漂移）。
- **心跳超时实机**：向隔离库注入 11min 未心跳的 `running` 行 → 等 60s 对账 tick → `supervisor: {observations:1, byReason:{session_heartbeat_timeout:1}}`；`incidents` 真行 `{source:'stall', error_code:'session_heartbeat_timeout', tool:'external-supervisor', phase:'observation', normalized:'session_heartbeat_timeout:stale_running_reconciler'}`；该 job 仍按**原语义** `failed / terminal_persistence_lost`。
- **异常退出实机**：隔离进程 emit `uncaughtException(Error('user sk-livekey999999 conv_secret42 /Users/zhang/private/report.txt'))` → `incidents` 新增 `{source:'fatal', error_code:'session_abnormal_exit', normalized:'session_abnormal_exit:uncaughtException'}`；`petri-errors.log` 告警行 `{source:'external_supervisor', reasonCode:'session_abnormal_exit', fingerprint:'0982…', session:'anonymous'}`；密钥/会话 id/绝对路径**零命中**。
- **9223 说明**：本次为纯后端改动、无 UI 面；标准 9223 CDP 测试实例（`scripts/start-test-instance.sh`）按设计直连主 dev 栈 `:3001`，既无法加载本 worktree 的后端改动，又会连到 owner 实例——因此改用更严格的「独立后端进程 + 独立数据根 + 独立端口」隔离验证。9223 全程空闲、未启动；owner `:3001` PID 37670 / `:3000` PID 37503 前后**未变**。

## 6. 边界声明（绝对红线）

- **只观测不动作**：无守护进程、无自动重启、无杀进程、无 timeout-kill、无定时巡检；新增的是事件驱动的只读 sink，不是监督执行体。
- **不改 loop 三档契约**；**不改 DB `recovery_required`**；**不改 stale-running-reconciler 语义**（相同 SELECT/UPDATE、相同返回、相同判定；观测回调默认 no-op 且抛错必吞）；**不扩张控制面**（两处 health/metrics 字段均为只读观测面）。
- **脱敏零外发**：见 §3；全链落本机 incidents 表 / 本地 JSONL，无网络出口。
- **本地主权 · 全链可审计**：每条观测可由 fingerprint + reasonCode 在本地回查；证据即本报告与测试。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. U 材料 status 治理处理（不擅翻他人 canonical）

**结论：不翻。`U-EXTERNAL-SUPERVISOR.md` 保持 `status: pending_user_ruling`，文件零改动。**

- BLOCK-520 P0 收口（AUDIT-LOG 第 16 行）记录主人裁决原文：「外部监督器按推荐 C 只告警 / **U 材料保持 pending_user_ruling**」；P2 收口（第 12 行）复述「U 材料 pending_user_ruling」。
- 本次 §4「C 先行」口令授权的是**实现观测**，不是改写 U 材料 canonical 的 status；按治理纪律「不擅自翻他人 canonical」，status 变更须主人显式口令，与 BLOCK-520 治理一致。
- HK-01 第 ⑩ 条机械守护该事实（`assert.match(u, /status: pending_user_ruling/)`）；本裁决与理由在本证据中留痕。

## 8. 门禁结果

| 门禁 | 结果 | 说明 |
|---|---|---|
| HK-01 + 邻域回归 | ✅ 42/42 | 见 §4 |
| `npm run docs:check` | ✅ PASS | 673 registered documents；新增 evidence 未触发漂移 |
| `npm run ui:audit:check` | ✅ PASS | 同步检查通过 |
| `npm run quality:secret` | ✅ PASS | 生产面零命中 |
| `npm run quality:arch` | ✅ PASS | R1-R5 无违规 |
| `npm run quality:types` | ✅ PASS | 隔离 worktree 原缺 frontend deps；临时链接主树 `frontend/node_modules` 后 tsc 0 error（链已撤销） |
| `npm run quality:lint` | ✅ PASS | 0 error；修掉 1 条陈旧抑制（§1），2475 条既有 warning 为基线 |
| `npm run test:changed:list` | ⚠ BLOCKED (exit 2) | `impact-map.json` 引用 main 树**未跟踪 WIP** `test/c56-user-manuscript-fidelity.test.mjs`——按「WIP 零触碰」纪律不复制；改以定向测试覆盖（42/42） |
| Jev `test:suggest` | 零建议 | `--supply=cloud` 供给不可用（缺 jev.env 备份）；file 供给返回 `suggested:false, reason:no_key`，如实附记；`output:judge`/`decision:session` 在隔离 worktree 无可读台账，未运行 |

> 未跑全量 `npm run check` / `test:all:workspace`（按纪律留给发布前/CI）；上述未覆盖范围如实声明，不把定向通过表述为全量通过。

## 9. 隔离与提交

- 主线工作树未跟踪 WIP（含 § 裁决材料文档）**零触碰**；A1 `petri-ops/codex-a1-silent-error`、B4B5 `petri-ops/b4-focus`、B1 `petri-ops/b1-zindex` 三分支**零交叉**。
- 改动仅落本独立分支 worktree；提交留本地，**未 push**，等主人逐批口令。
