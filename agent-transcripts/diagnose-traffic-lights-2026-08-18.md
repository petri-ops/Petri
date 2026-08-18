# BioF3 Desktop 红绿灯消失 — 根因诊断报告

- **日期**：2026-08-18 (Tue)
- **诊断范围**：dev Electron 主窗口（vite dev server :3000, project=p_msok75w9_gh35）
- **结论**：preload.js 加载失败 → `window.biof3Desktop` 不存在 → `getIsMac()` 与 `getIsDesktop()` 都为 false → 自定义 trafficZone 整个 JSX 块不渲染 → 三个交通灯按钮（关闭 / 最小化 / 全屏）整体消失。

---

## 1. dev Electron 状态

```
PID 56333  Electron /Users/zhangdiandian/.../desktop --dev --remote-debugging-port=9222
PID 56383  Electron Helper (GPU)
PID 56384  Electron Helper --type=utility
PID 56443  Electron Helper (Renderer)
PID 56270  vite (frontend/node_modules/.bin/vite)
```

CDP `http://127.0.0.1:9222/json/version` 返回：

```
Chrome/124.0.6367.243
biof3-local/0.0.1-rc.7
Electron/30.5.1
```

CDP 唯一 page target：

```
url=http://localhost:3000/project/p_msok75w9_gh35
title=BioF3
```

dev Electron 主进程正在跑、CDP 9222 可用、vite SPA 已加载。

---

## 2. DOM 证据

Playwright MCP `browser_snapshot`（dev Electron 主窗口的 webContents）：

```yaml
- banner [ref=e3]:
  - button "收起左侧栏" [ref=e6] [cursor=pointer]
  - generic [ref=e9]:
    - generic [ref=e10]: 梳理开发进展
    - button "切换会话" [ref=e15] [cursor=pointer]
    - button "展开摘要概览" [ref=e21] [cursor=pointer]
  - generic [ref=e26]:
    - button "展开更多工具" [ref=e29] [cursor=pointer]
    - generic [ref=e31]:
      - button "展开底部终端" [ref=e32] [cursor=pointer]
      - button "收起右侧栏" [ref=e35] [cursor=pointer]
```

header `banner` 里只有 6 个按钮 —— **完全没有**「关闭窗口 / 最小化窗口 / 全屏」这三个交通灯。

CDP `Runtime.evaluate` 数值证据：

| 指标 | 值 |
|---|---|
| `document.querySelectorAll('[class*="macTraffic"]').length` | **0** |
| `document.querySelectorAll('[class*="trafficZone"]').length` | **0** |
| `document.querySelectorAll('[class*="winBtn"]').length` | **0** |
| `document.querySelectorAll('[class*="windowControls"]').length` | **0** |
| `document.querySelectorAll('header button').length` | 6 |
| `typeof window.biof3Desktop` | **undefined** |
| `window.biof3Desktop?.isDesktop` | undefined |
| `window.biof3Desktop?.platform` | undefined |
| `window.process?.env?.BIOF3_DESKTOP` | undefined |

---

## 3. 真正的根因 —— preload 加载失败

CDP `Runtime.consoleAPICalled` 在主窗口 webContents 抓到两条错误（execution context #14 = "Electron Isolated Context"）：

```
[error] Unable to load preload script:
  /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/src/preload.js

[error] Error: module not found: ./main/env-coordinator
    at preloadRequire (node:electron/js2c/sandbox_bundle:2:82852)
    at <anonymous>:20:28
    at runPreloadScript (node:electron/js2c/sandbox_bundle:2:83516)
    at node:electron/js2c/sandbox_bundle:2:83813
```

`src/preload.js:11` 用 `const { contextBridge, ipcRenderer } = require('electron');`（OK，sandbox 白名单），但 `src/preload.js:19`：

```js
const { getBackendPort } = require('./main/env-coordinator');
```

—— **Electron sandbox 模式下，preload 只能 require 内置模块**（`electron` / `events` / `timers` / `url`），不能 `require` 同目录其它文件。`sandbox_bundle` 的 `preloadRequire` 找不到 `./main/env-coordinator`，**整个 preload 抛错中止**。`contextBridge.exposeInMainWorld('biof3Desktop', {...})` 那一句没跑到，`window.biof3Desktop` 就根本不存在。

---

## 4. 链式反应

```text
preload.js 加载失败
  └─ window.biof3Desktop 未注入
       └─ getIsMac() → false    // 依赖 biof3Desktop?.platform === 'darwin'
       └─ getIsDesktop() → false // 依赖 biof3Desktop?.isDesktop === true
            └─ TitleBar.tsx:290 `isMac && (...)` 为 false
                 └─ trafficZone 整个 JSX 块（TitleBar.tsx:290-332）不渲染
                      └─ 三个 macTrafficBtn (close/minimize/fullscreen) 全消失
```

TitleBar.tsx 关键代码：

```267:268:frontend/src/components/desktop/TitleBar.tsx
const isMac = getIsMac();
const isDesktop = getIsDesktop();
```

```290:332:frontend/src/components/desktop/TitleBar.tsx
{isMac && (
  <div className={styles.trafficZone}>
    {isDesktop ? (
      <>
        <button ... className={`${styles.macTrafficBtn} ${styles.macTrafficBtnClose}`} ...> ... close
        <button ... className={styles.macTrafficBtn} ...> ... minimize
        <button ... className={styles.macTrafficBtn} ...> ... fullscreen
      </>
    ) : (
      <div className={styles.trafficPlaceholder} aria-hidden="true" />
    )}
  </div>
)}
```

如果 `isMac === false`，整块 `{isMac && (...)}` 都不渲染，连 placeholder 都没有 —— 这正是当前状态。

---

## 5. 引入 commit

```bash
$ git log --oneline -10 -- src/preload.js
e832e2d refactor(block-10-architecture): routes/result-studio facade + _helpers prep (PHASE 2.1a)
48e19e2 chore(block-10-architecture): port fallback + env centralized + jspdf dead dep (A-009 + A-010)
1c0ebf0 fix(block-10-audit-closeout): PHASE 1 IPC bridge + result type
e4c86cf feat(mac-fullscreen): enable native Mac fullscreen support
...
```

引入点：**commit `48e19e2`（2026-08-18 09:11:43）A-009 port fallback unification**。

git show 引用：

> src/preload.js:67-68 now reads getBackendPort('r' / 'python').

即在 `src/preload.js` 第 19 行加了 `const { getBackendPort } = require('./main/env-coordinator');`。这条 require 在 sandbox 模式下不合法，整个 preload 抛错中止 —— 导致后续所有 `contextBridge.exposeInMainWorld(...)`（含 `biof3` / `process` / `biof3Desktop`）全部没注册。

### 历史上红绿灯相关 commit

```
e4c86cf feat(mac-fullscreen): enable native Mac fullscreen support
d9906fd fix(mac): add fullscreen button to custom traffic lights
d08d8b1 refactor(mac): replace maximize with fullscreen in traffic lights
c07d9ca feat(desktop): add verified frameless window controls (UI-120)
9a6c6d4 Merge codex/g0-result-studio-product into main — Result Studio product + window controls
```

—— 此前 mac 红绿灯工作正常，是 commit `48e19e2` 当天才引入的回归。

---

## 6. 最小修复方案（仅诊断、未实施）

preload.js sandbox 不允许跨文件 `require`，有三种修复方向：

### 方案 A：内联常量（最安全、最小改动）
在 `src/preload.js` 第 19-20 行删掉 `require('./main/env-coordinator')`，直接 inline：

```js
// 之前（preload.js:67-68 引用）：
//   rApiBase: `http://localhost:${getBackendPort('r')}/api`,
//   pythonApiBase: `http://localhost:${getBackendPort('python')}/api`,
// 改为：
//   rApiBase: `http://localhost:${process.env.R_SERVER_PORT || '3001'}/api`,
//   pythonApiBase: `http://localhost:${process.env.PY_SERVER_PORT || '3004'}/api`,
```

R_SERVER_PORT / PY_SERVER_PORT 由 Electron main 进程在 preload 之前写到 `process.env`（env-coordinator 的事实行为），inline 与集中化版本**对外行为等价**，但**移除跨文件 require**，preload 即可正常加载。

需同步：在 `src/main.js` 确认 main 进程在 preload 之前 `process.env.R_SERVER_PORT = ...` 已生效（`A-009` 提交说明已声明这一点）。

### 方案 B：sandbox: false
`src/main.js:417` 把 `sandbox: true` 改为 `sandbox: false`。允许 preload 跨文件 `require`，但**放宽了渲染进程沙盒**——属于安全降级，需要用户裁决。

### 方案 C：preload 改用 bundler 注入
用 esbuild/vite 把 preload 打成单文件 bundle。改动面更大（G0 阶段不要扩散）。

**推荐方案 A** —— 单文件、单行改动、与 A-009 提交里承诺的行为兼容（依赖 `process.env.R_SERVER_PORT` 由 main 进程预填）。

---

## 7. 是否引入 regression

- **不动 `preload.js` 的 IPC 契约**：方案 A 不动 `window.biof3Desktop.window.{minimize,maximize,close,isMaximized,onMaximizeChanged,isFullScreen,toggleFullScreen,onFullScreenChanged}` —— 八个 API 原样保留。
- **不动 `main.js` IPC handler**：方案 A 不动 `setupWindowIpc()` 里的 `window:minimize / window:maximize / window:close / window:isMaximized / window:isFullScreen / window:toggleFullScreen / window:maximize-changed / window:fullscreen-changed` 八个 handler（src/main.js:619-636 + 558-573）。
- **不破坏 A-009 集中化语义**：端口兜底逻辑事实上由 Electron main 进程的 env-coordinator 写 `process.env`，A-009 提交说明明确说"Electron's main still writes the env vars first"，preload 直接读 `process.env.R_SERVER_PORT` 是**一致语义**，且没有第二个事实源。
- **不影响非 macOS 路径**：方案 A 不会改变 `getIsMac() === false` 时 `WindowControls` (TitleBar.tsx:32-86) 走 `getBridge('window')` 的逻辑。

唯一要小心的边界：

1. **独立子进程 (standalone) 启动场景**：如果没有 Electron main 进程预填 `process.env.R_SERVER_PORT`，会回落到硬编码 `3001` / `3004`。这是与 A-009 现状一致（也是当前 backend-health 的事实行为）。
2. **单元测试**：TitleBar.test.tsx 之前用 `vi.stubGlobal('biof3Desktop', {...})` 注入；preload 修复不影响这条路径，因为单测不经过 Electron 沙盒。
3. **不能顺手改 main.js 的 `sandbox: true`**：那是单独的安全不变量，留给 G1+ / 维护者裁决。

---

## 8. 屏幕截图（说明）

Playwright `browser_take_screenshot` 在 vite dev 的重渲染里 5 秒超时（截图工具等待字体稳定），但 DOM 证据（0 个交通灯按钮、6 个工具按钮）已经足够确凿。证据链：

- CDP `Runtime.evaluate`（数值）：0 macTraffic、0 trafficZone、0 winBtn、undefined biof3Desktop
- Playwright `browser_snapshot`（结构）：banner 内只有 6 个按钮，无「关闭 / 最小化 / 全屏」按钮
- CDP `Runtime.consoleAPICalled`（根因）：preload 加载失败、`module not found: ./main/env-coordinator`

三路独立证据指向同一根因。

---

## 9. 一句话总结

> commit `48e19e2`（A-009）把 `getBackendPort` 集中化到 `env-coordinator`，preload.js 因此新增跨文件 `require('./main/env-coordinator')`；在 Electron `sandbox: true` 下 preload 不能 require 同目录其它文件，preload 整体加载失败 → `window.biof3Desktop` 没注入 → `isMac` 与 `isDesktop` 都为 false → trafficZone 整个 JSX 块不渲染 → 三个交通灯消失。最小修复：在 preload 内联 `process.env.R_SERVER_PORT || '3001'` / `process.env.PY_SERVER_PORT || '3004'`，删掉那条 `require`。