# BLOCK-45 — dev-electron boot 清理误杀并存 Electron 实例修复计划

## 1. 背景

实测踩中（BLOCK-43 P3 验收，2026-09-03 登记 memory lesson）：`scripts/dev-electron.js` 的 `stopWorkspaceElectron()`（L146）用 pgrep 匹配 `projectRoot/node_modules/electron/dist/(Electron.app/...|electron)` **全杀**本仓库 Electron 二进制启动的所有主进程；而 `main()`（L308）**每次新 boot** 都执行它作为「上一会话残留清理」。结果：并存 dev 栈（如实机验收用的长时 nohup 栈）的 Electron 被新 boot 无差别击杀。

对照组：wrapper **退出**路径 `shutdown()` 已在 BLOCK-35 改为一次性启动 token 定向（`stopLaunchedElectron()`，只杀本 wrapper 经 `open --args ... --biof3-dev-launch-token=<token>` 启动的实例，并存实例存活）；boot 清理路径漏改，行为不对称。

**用户裁决（2026-09-03）**：启动本工作包修复。

## 2. 根因与设计

### 根因

boot 清理语义为「接管 dev 端口」，但 Electron 主进程不占 :3000/:3001（wrapper 后端占 :3001、supervisor 托管后端占随机端口）——全杀 Electron 并非端口接管的必要条件，却 destroys 并存栈的 GUI 实例。历史动机是防「旧 Electron 的 supervisor 检测到后端被 :3001 sweep 击杀后自动重启、与新栈抢端口」，这个动机成立，但目标应是**上一会话的实例**而非全部。

### 设计（对齐 BLOCK-35 token 哲学）

1. **持久化启动 token**：boot 时把本次 launch token + wrapper pid 写入 `projectRoot/.biof3-dev-user-data/dev-launch-token.json`（gitignore 目录内，不入库）。
2. **boot 清理 Electron 段改为 token 定向**：读上一 token → `getLaunchedElectronPids()` 同款 pgrep（token 值定向）→ SIGTERM→SIGKILL。不再全杀。
3. **并存 wrapper fail-closed 守卫**：若上一 token 记录的 wrapper pid 仍存活且 token 定向 pgrep 命中其 Electron → 判定「dev 栈已在运行」，报错退出并提示先停止旧栈（Ctrl+C / kill wrapper）。把原「静默误杀」升级为显式冲突，消除误杀场景。
4. **陈旧残留正常清理**：wrapper pid 已死（崩溃残留）→ token 定向清理照常执行，保持「免手动 lsof 重启」便利。
5. **逃生口**：新增 `--force-clean-electron` flag 保留旧全杀语义（仅显式传入时生效），覆盖 pre-BLOCK-45 无 token 残留实例的极端场景。
6. vite :3000 / 后端 :3001 的端口 sweep **不变**（端口接管语义，属必要清理；Electron 段修复后 supervisor 重启抢端口由 token 定向击杀兜底）。

### 非范围

- 非 darwin 平台路径（Windows/Linux 无 `open -a` 变体，pgrep 分支 darwin-only，维持现状）。
- `getWorkspaceElectronPids()` 其余消费方（如有）不动，仅改 boot 清理调用点。
- vite/backend 端口 sweep 逻辑、supervisor 后端自动重启机制。

## 3. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + README 入口 + roadmap active + AUDIT-LOG 登记。
- **P1 实现**：token 持久化 + boot 清理 token 定向 + 并存 fail-closed 守卫 + `--force-clean-electron` 逃生口；逻辑提取为可单测的纯函数段。
- **P2 定向门禁**：新增/更新 node --test 单测（token 读写、守卫判定三分支：存活并存 fail-closed / 陈旧残留清理 / 无记录跳过）；`npm run docs:check` + `npm run ui:audit:check`。
- **P3 实机验证**：dev Electron 双栈场景——栈 A 存活时启动栈 B → B fail-closed 且 A 的 Electron 存活；Ctrl+C 停 A 后再启 B → 正常接管；崩溃残留（kill -9 wrapper）→ 新 boot token 定向清理成功。证据 `acceptance/block-45/`。
- **P4 收口**：台账/registry/roadmap/AUDIT-LOG 收口 + 提交。

## 4. 验收门

- P3 三场景实机证据落盘。
- node --test 新增用例全绿 + docs:check + ui:audit:check PASS。
- G0 开发期常态 · 不外推 packaged/Provider/GA（收口笔录用语）。

## 5. 进度记录

- 2026-09-03 P0 完成：摸底确认根因（boot 清理路径漏改，`shutdown()` 已 token 定向而 `main()` boot 仍全杀）；设计定型为「token 持久化 + 并存 fail-closed + 显式 force-clean 逃生口」。本计划落盘并注册 DOC-REGISTRY。
- 2026-09-03 P1 完成：新增 `scripts/lib/dev-launch-state.js`（记录读写清 + `resolveBootElectronAction` 纯决策函数）；`dev-electron.js` 改造——token pgrep 泛化 `getElectronPidsByToken`、`killPidsGracefully` 共用、boot 清理 Electron 段走 `stopPreviousLaunchElectron`（fail-closed 向上传播中止 boot，force-clean 走旧全杀）、boot 写记录 / shutdown 条件清记录（仅记录仍指向自己时删）。
- 2026-09-03 P2 完成：`test/scripts/dev-launch-state.test.mjs` 12/12（决策三分支 + wrapper 存活无 Electron skip + force 逃生口 4 态 + 记录读写清 roundtrip + 损坏记录 fail-open）；`docs:check` PASS（185 documents）+ `ui:audit:check` PASS。
- 2026-09-03 P3 完成：实机四场景全 PASS（证据 `acceptance/block-45/block45-live-check.json`）——E0 force-clean 清无 token 残留（941）/ S1 并存 fail-closed（B 被拒、A2 Electron 存活，旧实现此处误杀）/ S2 优雅停机→正常接管 / S3 崩溃残留→token 定向清理（D 日志实锤 `cleaning up previous launch Electron (token-scoped, pids: 73328)`）。实机发现：无 token 老实例持 singleton lock 令新 Electron 静默退出（force-clean 逃生口即为此设计）；kill -9 后 vite/backend 孤儿由既有端口 sweep 接管（语义不变）。收尾停栈干净（0 listeners）。
- 2026-09-03 P4 完成：AUDIT-LOG 收口登记、DOC-REGISTRY completed、roadmap active 清空、README 65 条转已收口。G0 开发期常态 · 不外推 packaged/Provider/GA。
