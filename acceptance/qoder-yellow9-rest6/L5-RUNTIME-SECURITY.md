# L5 utility-process host 运行态安全边界（2026-11-23）

## 裁决与范围

用户发令「没问题 冲」= 放行上一票的 L5-RUNTIME-RULING 裁决点（是否做运行态 utility-process host）。本文件是安全评审留痕，按"默认不装载 + 严格白名单 + 不碰现有 sandbox/CSP"最保守边界实现。

## 边界设计（实现已落地）

| 约束 | 实现 | 文件 |
|---|---|---|
| 默认不装载 | `main()` 启动序列不 fork；只在显式 `utility-host:start` IPC 时按准入 fork | `src/main.js`（仅装配 handler，无自动 fork） |
| 启用包门 | `enabledPack(packId)` 读 pack-registry，禁用/未装一律拒 | `src/ipc/utility-host.js` |
| 白名单入口 | `evaluateForkAdmission` 校验：`SAFE_ENTRY_RE`、路径穿越/远程 URL/未知权限/消息名一律拒 | `core/shared-backend/utility-host-decision.js` |
| 固定 argv | `argv=[entry]`，无 shell、无远程 URL、无额外参数注入 | 同上 |
| 不传 MessagePort | `messagePort:false`（新机制保守起步，全仓 MessagePort 仅文档命中） | 同上 |
| sender 鉴权 | 全局 `_ipc-trust` 门自动生效（main.js:38 早于所有 handler），本模块不手写鉴权 | `src/main.js` + `_ipc-trust.js` |
| 不碰现有 sandbox/CSP | 零修改 `pack-ui/{scheme,csp}.js`、`security-hardening.js`、`_window-create.js`、`csp-config.js` | — |
| 生命周期 | start→starting→spawned→running→exit/stop 状态机；启动 30s 超时未 spawned 即 kill；before-quit 清理全部 host | `utility-host.js` + `main.js before-quit` |
| 审计 | JSONL 只记 packId/action/entry/status，不记 packRoot 真值/凭据/token | `utility-host.js appendAudit` |

## 诚实边界

- utilityProcess 是 Node 进程，天然有 `require`——**不能套 renderer 的 `nodeIntegration:false` 语义**。真正的隔离靠：①全局 sender 门（utility 进程不可能命中受信 renderer origin）；②不传 MessagePort；③固定 argv + 白名单入口。这是已知约束，不冒充"与 pack iframe 同等 sandbox"。
- 本实现是"受控 fork + 门控"，不是"完全沙箱化执行"；若后续需要更强隔离（独立 userData/网络命名空间），属新裁决点。
- IPC 三通道（start/stop/status）已登记 `channels.js` + `preload.js` 字面量包装，双向守护测试 9/9 绿。

## 验证

- `test/utility-host-decision.test.mjs` 6/6（默认不装载/路径穿越/固定 argv/状态机/审计脱敏）；
- `test/ipc-channels-registry.test.mjs` 9/9（通道注册表双向一致）；
- `node --check` 三文件通过。

G0 开发期常态 · 不外推 packaged/Provider/GA。
