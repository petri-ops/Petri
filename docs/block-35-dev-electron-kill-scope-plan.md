# BLOCK-35 — dev-electron 停止链误杀并存 Electron 实例修复

> status: completed · truthDomain: `block-35-dev-electron-kill-scope` · registered: 2026-09-01 · closed: 2026-09-02（P1 `e14569e` + P2 `5b135c5`，双判据 PASS）
> owner: main agent · branch: main（单工作包串行，前置 BLOCK-34 已 completed）

## 1. 背景与根因（P4 实机观测）

BLOCK-34 P4 实机收口期间，dev Electron 两次静默退出（CDP 9222 失联），发生在与
BLOCK-34 代码无关的时刻（agent 任务收尾后 / 人工 kill 8765 孤儿后）。根因链：

1. `scripts/dev-electron.js` 的 `spawnChild` 对 vite/backend npm 子进程默认
   `shutdownOnExit: 'error'` —— 任一子进程异常退出 → `shutdown()` 全组收尾。
2. `shutdown()`（darwin + `launchedElectronViaOpen`）调用 `stopWorkspaceElectron()`，
   后者用 `pgrep -f <electronBinary>` 匹配 **本工作区全部 Electron 主进程** 并
   SIGTERM→SIGKILL —— 包括**不是本 wrapper 启动**的并存实例（人工
   `electron . --dev` / 另一 wrapper 实例）。
3. Electron main 收到 SIGTERM → app 退出链 → 后端子进程被杀
   （`[petri-server] [lifecycle] db closed on SIGTERM`）。

即：wrapper 收尾时「按二进制路径全杀」扩大了打击面，杀掉了自己没启动的实例。

## 2. 修复方案（launch-token 定向）

- wrapper 启动 Electron 时生成一次性随机 token
  `--petri-dev-launch-token=<pid>-<random>`，经 `open -a ... --args` 传入。
  main.js argv 解析为 `process.argv.includes('--dev')`（加法式），未知参数安全；
  单例锁按 userData 隔离，token 不受影响。
- 新增 `getLaunchedElectronPids()`：`pgrep -f <token>` 精确匹配**本 wrapper 启动的
  Electron 主进程**（Helper 子进程 argv 不含 token，天然只中主进程；排除 wrapper
  自身子进程如 `open`）。
- `shutdown()` 改调 `stopLaunchedElectron()`：只 signal token 命中的 pid（复用
  SIGTERM→等待→SIGKILL 阶梯）；token 无命中（实例已自行退出）则零操作。
- `waitForWorkspaceElectron` 改用 token 匹配就绪判定（不再被陈旧实例假阳性）。
- **boot 清理保持全杀不变**：`stopWorkspaceDevProcesses()` 清理「上次会话遗留」的
  语义不变（此时无法知道遗留实例的 token），这是设计意图非误杀。
- **P2 实机修正（2026-09-02）**：boot 全杀的匹配模式存在盲区 —— 工作区 Electron
  主进程有两种 argv 变体：`open -a` 启动为 `.../dist/Electron.app/Contents/MacOS/Electron`，
  `npx electron .`（cli.js）启动为 `.../dist/electron`（小写直连）。旧 `pgrep -f
  <electronBinary>` 只中前者，boot 清理会漏杀变体 2。已改为 ERE
  `<root>/node_modules/electron/dist/(Electron[.]app/Contents/MacOS/Electron|electron)( |$)`
  （Helper 位于 `.../Frameworks/Electron Helper ...` 不匹配，仍只中主进程）。
  shutdown 定向路径（token）不受影响。

## 3. 非范围

- vite/backend 子进程异常退出触发整组重启的语义**保持**（dev loop 设计，不属于误杀）。
- Windows 分支（非 darwin 路径）不动。
- wrapper 多实例并存的 boot 清理互杀问题不处理（罕见场景，维持「清理上次会话」语义）。
- 0 新依赖、0 产品代码改动（仅 `scripts/dev-electron.js`）。

## 4. 验收门禁

- P1：`node --check scripts/dev-electron.js`；启动链冒烟（wrapper 正常拉起 Electron + CDP）。
- P2（实机核心判据）：wrapper A 启动实例 A（CDP 9222）→ 人工以独立
  `PETRI_ELECTRON_USER_DATA_DIR` 启动并存实例 B（单例锁按 userData 隔离，可共存），
  B 采用 `./node_modules/.bin/electron`（cli.js 变体）启动以覆盖 boot 清理盲区
  回归 → SIGTERM wrapper A → **A 实例退出、B 实例存活**（修复前 B 会被全杀）；
  再验证 boot 清理：重启 wrapper 时 B 被按设计清杀。判定采用事件轮询
  （A 亡 / B 存活 = 主进程存活 + B 自身后端 /api/health 响应），不依赖固定 sleep。
- 证据：`acceptance/` 不新增 UI 台账（无 UI 变更），判据记录于本文件 §5 与 commit message。

## 5. 收口语义

P1+P2 通过、门禁绿 → 本文件 status 改 `completed`、DOC-REGISTRY 同步、AUDIT-LOG
登记收口行（并补记 BLOCK-34 completed 行）。G0 开发期常态 · 不外推 packaged/Provider/GA.
