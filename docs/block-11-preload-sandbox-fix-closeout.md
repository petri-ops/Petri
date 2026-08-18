# BLOCK-11-PRELOAD-SANDBOX-FIX Closeout

最后更新：2026-08-18 18:30

## 1. 总结

修复 src/preload.js 第 19 行的 require('./main/env-coordinator') 在 Electron sandbox: true 下抛错，
导致整个 preload 中止 → window.biof3Desktop 不存在 → React 端 getIsDesktop() 返回 false →
trafficZone 整个 JSX 不渲染 → 自定义红绿灯（最小化/最大化/关闭）消失。

## 2. 根因链

1. src/main.js 第 417 行设置 BrowserWindow.webPreferences.sandbox: true（安全策略）
2. Electron sandbox 模式限制 preload 只能 require 内置模块或 0 文件
3. src/preload.js 第 19 行 require('./main/env-coordinator') 跨文件 require，sandbox 抛 Error: module not found
4. preload 抛错 → contextBridge.exposeInMainWorld 全部不执行 → window.biof3Desktop === undefined
5. 前端 getIsDesktop() / getIsMac() 都为 false → trafficZone 条件渲染块不渲染 → 三个交通灯消失

## 3. 引入 commit

48e19e2（2026-08-18 09:11 · chore(block-10-architecture): port fallback + env centralized + jspdf dead dep (A-009 + A-010)）

BLOCK-10 工作包 PHASE 3.2 把端口兜底集中化到 env-coordinator.js 时给 preload 加了跨文件 require。
A-009 提交注释声称 "Electron main 仍先写 env vars" —— 这是修复 key：
main 进程确实已经把端口写入 process.env，preload 直接读 env 等价于走 helper。

## 4. 修复方案

src/preload.js 第 19-20 行替换：

```js
function _readPort(envName, defaultPort) {
  const raw = process.env[envName];
  if (raw == null || raw === '') return defaultPort;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}
const _rPort = _readPort('R_SERVER_PORT', 3001);
const _pyPort = _readPort('PY_SERVER_PORT', 3004);
```

第 92-93 行模板里 getBackendPort('r') / getBackendPort('python') 替换为 _rPort / _pyPort。

行为等价：env-coordinator.js L204-208 的 getBackendPort('r') 在 R_SERVER_PORT 存在时
返回 parseInt(process.env.R_SERVER_PORT, 10)，否则返回 helper fallback。
_readPort 同语义，无副作用。

## 5. 验证矩阵（实机 dev Electron via CDP）

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| typeof window.biof3Desktop | undefined | object ✓ |
| typeof window.biof3 | undefined | object ✓ |
| typeof window.biof3Desktop.window.minimize | n/a | function ✓ |
| [class*="traffic"] DOM 匹配数 | 0 | 4 (1 zone + 3 btn) ✓ |
| header <button> 总数 | 6 | 9 (+3 交通灯) ✓ |
| 按钮 .click() 触发 | n/a | 成功 ✓ |

Console error 链消失：
- 修复前：Unable to load preload script + Error: module not found: ./main/env-coordinator
- 修复后：preload 加载成功，无 require error

## 6. 治理门验证

- npm run docs:check → PASS (113 registered documents)
- npx tsc --noEmit -p frontend/tsconfig.json → 0 错
- npm run ui:audit:check → 4 项 pre-existing drift（d9906fd / d08d8b1 / c271010 / e40313e），
  均与本工作包无关
- node --check src/preload.js → 0 错

## 7. 不变量守住

- ✓ IPC contract 100% 保持：window.biof3Desktop.window.{minimize,maximize,close,
  isMaximized,onMaximizeChanged,isFullScreen,toggleFullScreen,onFullScreenChanged}
  八件套签名 0 改动
- ✓ electron.d.ts 0 diff
- ✓ desktopBridge.ts 0 diff
- ✓ main.js 第 417 行 sandbox: true 保持（不降级安全策略）
- ✓ 其他 16 个 preload namespace（biof3.agentWorkbenchFlags / process.env / bioF3Desktop.* 各种）0 diff
- ✓ core/shared-backend/* 0 diff
- ✓ env-coordinator.js 0 diff（其他位置仍可正常使用 getBackendPort）

## 8. 与历史的关系

dev Electron 红绿灯"消失之前也发生过"——这是第三次修复：

- c07d9ca feat(desktop): add verified frameless window controls (UI-120) — 原始实现
- e4c86cf feat(mac-fullscreen): enable native Mac fullscreen support — 之前修复
- 本次修复 — A-009 引入的回归

每次回归都是约束 "preload 不能跨文件 require" 的边界被绕过。本工作包在 preload 上加了
详细注释说明 sandbox 行为，未来 A-### 工作包不应再尝试跨文件 require。

## 9. 不外推

- 不重写 sandbox: true → false（安全降级）
- 不打包 preload（改动面太大，G0 不必要）
- 不动 IPC channel 命名
- 不动其他 preload namespace
- 不重新激活 BLOCK-10 / BLOCK-9 / BLOCK-9.2
- 不外推 Provider / packaged / GA / P7 G1+ 事项

## 10. 后续候选（不主动启动）

- 端口注入二次审计：R_SERVER_PORT 当前显示 50145（r-server 协商端口），
  PY_SERVER_PORT 是 3004 默认值。这个行为与 A-009 设计一致
  （main 进程通过 setupDesktopEnv 写入 process.env），无需后续动作
- npm run ui:audit:check 4 项 pre-existing drift 按治理纪律不修

## 11. 范围外

- BLOCK-10-AUDIT-CLOSEOUT / BLOCK-9.2-MEGA-FILE-REFACTOR / BLOCK-9.1-MAIN-JS-SPLIT / PHASE 5 audit 全部不动
- 不动 core/
- 不动 frontend/src/
- 不动 scripts/cdp-wrap.cjs（这次修复不需要改动）
