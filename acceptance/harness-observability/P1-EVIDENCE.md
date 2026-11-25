# BLOCK-520 P1 证据 · 链路可追、状态可量（2026-11-25）

> 发令：Orca 7d41c850→bb8dddaf dispatch msg_028c645b6bd0（owner 三裁决全批，P1 发令）。
> 本波仅 P1（OB-002/003/005），P2（OB-008/009）未开工；第 9 项外部监督器 U 材料保持 pending_user_ruling。
> 协调渠道：本轮起直接回报兴奋（orca_session_id:bb8dddaf…），原主聊天退出中转。
> G0 开发期常态 · 不外推 packaged/Provider/GA。owner dev 实例（3000/3001）零触碰。

## §1 核码纠偏（C-32/C-43 先核真源）

| 方案稿口径 | 实时核码真值 | 处置 |
|---|---|---|
| metrics/health.js 缺位 | `core/shared-backend/{metrics,health,ipc-trace}.js` 确实不存在 | 三模块新建，纯内存/零依赖 |
| health 四端点同 shape | `/api/health`（server-main + routes/index 同名双注册）+ `/m/api/health` + `/federation/api/health`，形状各异 | additive spread 统一 shape，保留 instanceId/pid/dataDir 等 attach 判据字段 |
| IPC trace 贯穿 | preload 无 rid、main handler 无 trace、spawn env 无 rid；`_ipc-trust.js` 有全局 handle 包装先例 | 复用同范式装 `_ipc-trace.js` 全局补丁 |
| breaker 状态源 | 无集中状态对象（context-budget-step 仅 console） | metrics 提供 `setBreakerState` add 接口，观测面预留，不改被观测路径 |

## §2 HK-01 红绿先行（test/block520-p1-observability.test.mjs）

红基线 4/4（补行为探针后 5 项）：三模块缺位、metrics 路由未注册、health 无统一 shape、IPC 无 trace。绿 5/5。
- OB-003：IPC 计数按 channel + failed、DB 写延迟均值/ring、后端重启数、breaker 状态快照、uptime/capturedAt。
- OB-005：`buildHealthShape` 统一 status/service/timestamp/readiness/liveness/details；readiness=false → status=degraded、liveness 恒 true；三端源码引用统一构造器，原字段保留。
- OB-002：rid 生成器/时间轴、全局 handle 包装（Symbol 幂等，同 `_ipc-trust`）、preload 自包含 rid 透传、spawn env 注入 `PETRI_TRACE_RID`；行为探针实测 handler 参数零漂移（rid 尾参被摘走）、时间轴 handler→done、IPC 计数 +1。

## §3 实现摘要

- OB-002：新建 `core/shared-backend/ipc-trace.js`（rid + 有界时间轴）；`src/ipc/_ipc-trace.js` 全局包装 `ipcMain.handle`（前置安装在信任门之后、任何 handler 注册之前），rid 可选尾参 `__petriRid` 向后兼容；preload 内联 rid 生成器 + 一次性包装 `ipcRenderer.invoke` 附加尾参；`backend-proc-manager.js` spawn env 注入 `PETRI_TRACE_RID`。
- OB-003：新建 `core/shared-backend/metrics.js`（纯内存、ring 有界）；`/api/_internal/metrics` 只读端点；`db/connection.js` 单点包装写语句 `run` 计时（read 路径零改动、fail-open），live 实测写计数生效。
- OB-005：新建 `core/shared-backend/health.js`；四端点 additive spread 统一 shape（server-main `/api/health`、routes/index `/api/health`、mobile `/m/api/health`、federation `/federation/api/health`），保留全部历史字段。

## §4 验证结果

- HK-01 契约 5/5 pass；IPC 通道/DB require-order/bind-first/early-loop-guard/P0 契约回归 25/0 pass。
- live 探针：DB 写延迟记账生效（3 写）；IPC 包装 handler 收到原参数（`[{x:1},'tail']`）、时间轴与计数正确；health shape `readiness:false → status:degraded`。
- 静态门：quality:types/secret/arch、gate:silent-catch、docs:check（673 文档）、ui:audit:check、quality:lint（0 error）全 PASS。
- `test:changed` 首轮 1336/10：定位出 3 处本包红并已修——①block353 静态 core 相对 require（3 处改走 resolveCore 动态 require）；②preload window controls 精确 args 契约（rid 尾参改为仅对象入参附加，无参调用原样）；③knip 新增 `installGlobalIpcTrace`（改具名 require 调用后 knip 识别）。修后重跑 1344/9，本包红清零；余存量/他方红如实归属（工具 defs 三红、config 族冻结、P6 证据源、B-16 SimpleChat 锚、knip 水印两键他方 WIP、BLOCK-85 SSH 投影终端 75s 超时——隔离重跑 federation-terminal 1/0 绿，属环境抖动）。
- 遵守他方 WIP 零触碰：knip 基线未重打（避免替水印 WIP 合法化）。
- 零新依赖；owner 实例零触碰；观感零代签（本波无 UI 呈现改动）；P2 未开工；提交留本地、push 等口令。
