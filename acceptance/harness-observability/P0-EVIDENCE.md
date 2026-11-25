# BLOCK-520 P0 证据 · 让失败可见（2026-11-25）

> 发令：Orca 7d41c850 dispatch msg_4437f57a7d31（主人已拍板三项裁决，P0 先发）。
> 本波仅 P0（OB-001/004/007），P1/P2 未开工；U 材料第 9 项保持 pending_user_ruling。
> G0 开发期常态 · 不外推 packaged/Provider/GA。owner dev 实例（3000/3001）零触碰。

## §1 核码纠偏（C-32/C-43 先核真源）

| 方案/审计稿口径 | 实时核码真值 | 处置 |
|---|---|---|
| error-log 默认 /var/log | 已在数据目录（BLOCK-102 P1）；`appendFile().catch(()=>{})` 静默吞仍在 | 只修静默吞+dedupe+桥接，不重做路径 |
| console.error 桥接 54 处 | 全 core+src 实读（排除 node_modules）console 411 / logger 51；console.error 169 处 | 用全局 bridge 覆盖全部 console.error，而非逐点改 |
| installProcessErrorHandlers 零命中 | server-main.js 已注册 unhandledRejection/uncaughtException + logError + exit(1) | 抽公共实现并复用，保留 exit(1) 语义，不重复造 |
| OB-001 目标 4 文件（r-server registry 等） | 路径不存在；重选 tools-executor(45)/server-main(31)/ai-chat(10)/server.js(2) | 4 文件 console. 合计 88 → 收敛为 4（仅注释/默认值残留） |

## §2 HK-01 红绿先行（test/block520-p0-observability.test.mjs）

红基线 4/4：OB-001 未引入 logger；OB-004 无 dedupe/无写盘失败留痕；OB-007 无统一处理器（unhandledRejection 不保证落盘）。
绿：4/4 pass。子进程隔离取证（PETRI_ERROR_LOG_FILE/PETRI_ERROR_DEDUPE_MS 在 require 前固化）。
- OB-004 写盘：同源同消息 3 次 → 落 2 条，`getDedupeStats().suppressed >= 1`，首次必落盘。
- OB-004 静默吞：指向目录触发 EISDIR → `getLastWriteError()` 可查 + stderr 有 `[error-log] write failed`。
- OB-004/007 桥接：console.error 与 `process.emit('unhandledRejection')` 均落 error-log，原 stderr 行为保留（E-019）。

## §3 实现摘要

- OB-001：`tools-executor.js` / `server-main.js` / `ai-chat.js` / `server.js` 的 console.log/warn/error → logger.info/warn/error；4 文件均引入可解析的 `shared-backend/logger`。HK-01 静态校验含路径可解析（曾抓出 server.js 越级路径导致启动即崩，已修）。
- OB-004：`core/shared-backend/error-log.js` 加 dedupe（同源同消息窗口内收敛，默认 5s，有界清理）、写盘失败留痕（`getLastWriteError` + stderr 不再静默）、`installConsoleErrorBridge()`（幂等、可 restore、保留原 stderr）。加载期捕获 rawConsoleError 避免桥接递归/双记。
- OB-007：`installProcessErrorHandlers({ exitOnFatal })` 统一注册，server-main.js 在最前调用（覆盖模块加载期），保留 L3-5 exit(1) 受控重启语义；测试可关 exit。
- 桥接安装点纪律：`server.js` 端口守卫路径**不装**桥接，维持 block457 C2「被占端口 exit 77 + dataDir 零文件」契约（已实测）。

## §4 验证结果

- HK-01 契约：4/4 pass。
- 回归定向：block457-bind-first / block520-p0 / block328-early-loop-guard 12/12 pass（修复中曾因 server.js logger 路径越级导致 3 红，已修并复验绿）。
- 静态门：quality:types / quality:secret / quality:arch / quality:lint（0 error）/ gate:silent-catch / docs:check / ui:audit:check 全 PASS。
- `test:changed` **1179/8**：8 红经核均非本包——SimpleChat 行数锚（他方 WIP）、工具 defs 三红（恒等红线/BK-04/BLOCK-157，他方 WIP）、config 注册表族/键冻结（UI-725 三键后续）、UI 台账 L6-3（他方 WIP）、P6 证据源绑定（已知存量红）。本包触达文件与这 8 红零交集，不并入本包绿。
- W5a/impact 覆盖 24/24；docs:check PASS（673 文档）；零新依赖；未改 G1+ 打包/Provider/GA；观感零代签（本波无 UI 呈现改动）。
- 提交留本地、`origin/main` 不动，push 等主人口令。
