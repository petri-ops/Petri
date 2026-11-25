---
capability: BLOCK-520
status: active
kind: work-package
canonical: true
truthDomain: block520-harness-observability
entrypoint: docs/README.md
registeredAt: 2026-11-25
owner: main-agent
phase: G0
---

# BLOCK-520 Harness 稳定性/可观测性整改（P0 已落地 · P1/P2 待发令）

> 授权：主人 2026-11-25 经 Orca「按建议推进」；请求=按治理流程立 backlog / remaining-work-plan 项、给波次排期、第 9 项单列 U 类材料 pending_user_ruling。**本文件只立项排期，不含实现；每项开工仍需发令。**
> 源材料：兴奋 2026-11-25 评估 + `docs/agent-harness-observability-audit-2026-08-17.md`；方案 9 项按 ROI 分 P0/P1/P2。

## §1 开工前核码纠偏（C-32/C-43 教训：先核真源）

| 方案稿说法 | 2026-11-25 现读真值 | 处置 |
|---|---|---|
| metrics.js/health.js/errors.js 均不存在 | `core/shared-backend/{metrics,health,errors}.js` 确实不存在 | OB-003/005 按新建处理 |
| `installProcessErrorHandlers` 零命中 | 符号零命中，但 `core/petri-server/server-main.js:143-150` **已注册** unhandledRejection/uncaughtException + logError + exit(1) | OB-007 改为「已有注册的覆盖与去重加固」，不重复造 |
| error-log.js 默认 `/var/log/petri-errors.log` | `core/shared-backend/error-log.js:13-15` 已改 `${PETRI_LOCAL_DATA_DIR}/petri-errors.log`（BLOCK-102 P1），`petri-server/helpers/error-log.js` 仅 shim；但 `appendFile(...).catch(()=>{})` 仍静默吞 | OB-004 只修「静默吞 + console.error 54 处桥接 + dedupe」，不重做默认路径 |
| `core/r-server/mcp/registry.js` 28 处 console | 该路径不存在；现读 `core/petri-server/helpers/tools-executor.js` 45 / `routes/ai-chat.js` 10 / `server.js` 2 / `src/` 整层 | OB-001 目标文件按当前真源重选，验收=选定 4 文件 `console.` 合计 <10（现读总数动态取） |
| console:logger ≈ 5.1:1（319:59） | 全 `core/`+`src/` 现读 console 1104 : logger 51 ≈21.6:1；方案口径应是局部子集 | 报告按现读全口径 + 局部口径双记，不沿用旧比 |
| goal-verifier 全库无调用点 | `verifyGoalCompletion` 仅定义在 `agent-tools/goal-verifier.js:28`，**无外部调用**（结论成立）；`agent-runner.js:308` `decisionVerifier = null` 成立 | OB-008 接线保留 P2，默认值需裁决 |
| 编排器进程内、DB recovery_required + 60s 对账 | `loop-orchestrator.js` 1658 行进程内状态机成立；`stale-running-reconciler.js` 在场 | 第 9 项外部监督器作为结构性缺位单列 U 类 |

## §2 排期建议（单工作包串行，逐波发令）

### 波次 P0 — 让失败可见（✅ 已落地 2026-11-25，待 wave 回执；证据 `acceptance/harness-observability/P0-EVIDENCE.md`）
- **OB-001** ✅ 四文件 console→logger（tools-executor/server-main/ai-chat/server.js），`console.` 合计 88→4（仅注释/默认值残留），HK-01 静态校验含路径可解析。
- **OB-004** ✅ error-log 静默 catch 修复（`getLastWriteError`+stderr 留痕）+ 全局 `console.error`→`logError` 桥接 + dedupe（不重做默认路径）；server.js 端口守卫路径刻意不装桥接以守 block457 零副作用契约。
- **OB-007** ✅ 抽 `installProcessErrorHandlers` 统一注册（复用 server-main.js 原注册点），unhandledRejection/uncaughtException 必触 error-log（E-019），保留 exit(1) 受控重启语义。

### 波次 P1 — 链路可追、状态可量（中风险，P0 收口后另点）
- **OB-002** IPC trace 贯穿（preload/main handler/backend spawn env，rid 可选参数向后兼容）：验单条 IPC 全链 rid 时间轴可重建。
- **OB-003** `core/shared-backend/metrics.js` + `/api/_internal/metrics`（零新依赖、不引 prom-client）：IPC 计数 / SQLite 写延迟 / 后端重启次数 / breaker 状态。
- **OB-005** `core/shared-backend/health.js` 四端点同 shape，区分 readiness/liveness。

### 波次 P2 — 控制闭环（需评估/可能裁决）
- **OB-008** goal-verifier 接线进主循环终止判定（闭合「目标输入、证据交付」）；`decisionVerifier` 默认值明确化——默认改非 null 属行为裁决，单列与主人确认。
- **OB-009** ready 显式事件 + 启动等待替 `isReady` 轮询。
- **第 9 项** 会话级外部监督器（心跳/超时重启/异常升级）：**单列 U 类材料 `acceptance/harness-observability/U-EXTERNAL-SUPERVISOR.md`，status=pending_user_ruling，不自行开工**。

## §3 纪律与验收口径
- HK-01 红绿先行：每项新契约先红后绿；P0/P1/P2 各波独立工作包、串行发令，不提前实现后续波次。
- 零新依赖（metrics 纯内存计数）；不改 G1+ 打包/Provider/GA；观感零代签；owner dev 实例零触碰，验证走 9223 隔离栈。
- 提交留本地，push 逐批等口令；提交必精确路径（水印等他方 WIP 零触碰）。
- 证据落 `acceptance/harness-observability/`，每波回写 AUDIT-LOG / UI 台账（如涉呈现）/ DOC-REGISTRY（如新建 canonical 文档）。
- 已知存量红（工具基线 118/120、P6 证据源绑定等）如实归属，不并入本包绿。

## §4 裁决清单（需主人拍板）
1. 第 9 项会话级外部监督器是否立项（U 类材料待裁，推荐先只出细化方案）。
2. `decisionVerifier` 默认值是否从 `null` 改为显式实现（行为面裁决，P2 触发）。
3. 波次发令顺序：建议 P0 → P1 → P2 逐波，下一波=P0（仍待发令，不自动开工）。
