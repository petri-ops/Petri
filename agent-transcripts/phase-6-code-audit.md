# BLOCK-2-UI-157-REVIEW · PHASE 6 只读代码审核报告

**日期**：2026-08-16
**作者**：PHASE 6 只读代码审核 worker
**范围**：PHASE 1 commit `2d81377` 落地的 5 个 IPC 桥文件 + 1 test 文件
**任务**：识别真实问题（边界 race / 内存泄漏 / 错误处理缺口 / API 契约违反 / tsc 兼容性 / 性能隐患 / 安全 / 测试覆盖 / 文档同步），按严重度排序，给主 agent 一份"是否需要在下一工作包修复"的裁决清单
**工作纪律**：绝对不动代码；仅运行交叉验证门禁；不写 AUDIT-LOG（除非发现 🔴 Blocker）

---

## 1. 执行摘要

### 1.1 治理门禁交叉验证（commit `2d81377` 之后，工作树含本审核报告本身）

| # | 命令 | 状态 |
| --- | --- | --- |
| 1 | `npm run docs:check` | ✅ PASS（66 registered documents） |
| 2 | `npm run ui:audit:check` | ✅ PASS（131 UI 编号同步） |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PASS（0 错误） |
| 4 | `npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts` | ✅ PASS（18/18） |

**未跑**：`npm run check` / `npm run test:all:workspace`（按 G0 纪律默认不跑，留发布前/CI）。

### 1.2 8 类问题计数（按严重度）

| 类别 | 🔴 Blocker | 🟠 Major | 🟡 Minor | 🟢 Nit | 合计 |
| --- | --- | --- | --- | --- | --- |
| A. 边界 race / 内存泄漏 | 0 | 3 | 2 | 1 | 6 |
| B. 错误处理缺口 | 0 | 2 | 3 | 0 | 5 |
| C. API 契约违反 | 0 | 1 | 2 | 1 | 4 |
| D. tsc / 类型兼容性 | 0 | 0 | 1 | 0 | 1 |
| E. 性能隐患 | 0 | 1 | 2 | 0 | 3 |
| F. 安全 / a11y | 0 | 1 | 1 | 1 | 3 |
| G. 测试覆盖 | 0 | 4 | 2 | 0 | 6 |
| H. 文档同步 | 0 | 0 | 2 | 1 | 3 |
| **合计** | **0** | **12** | **15** | **4** | **31** |

### 1.3 关键风险摘要

- **无 🔴 Blocker**：4 治理门 + 18 vitest + tsc 全部 GREEN；不存在 tsc 报错 / 硬契约冲突 / 确认内存泄漏
- **🟠 Major 12 项**集中在 3 个面：
  - **A 内存/race**：`useSkillStore` 终态未主动清理 `onProgress` 订阅（仅 useEffect unmount 兜底）；`main.js` poller 启动后无停止机制（仅 terminal 状态自清 Map）；IPC handler 无 sender 守门
  - **B 错误处理**：`main.js` 终态 `subscribe` 与 SDK 抛同步异常的捕获边界；`useSkillStore` `_subscribeProgressWakeup` payload 不匹配时静默 return（合理但路径风险）
  - **G 测试覆盖**：test 7 仅验证 `onProgress` 被调用、**未验证 wakeup 触发后 store 写入**；缺失 execute() 失败路径 polling 启动 / onProgress callback 抛错 / sender 守门 / 9 状态映射 / 终态 cleanup 验证
- **🟡 Minor 15 项** 主要是**性能 / 文档 / tsc 严格度**层面
- **🟢 Nit 4 项**：风格性提示

### 1.4 裁决总览

- **必须下一工作包修复**：🟠 Major 12 项（其中 5 项安全 / 内存泄漏性质）
- **可选下一工作包优化**：🟡 Minor 15 项
- **可留后续或忽略**：🟢 Nit 4 项
- **无紧急 blocker**：当前 4 治理门 + 18 vitest GREEN，PHASE 1 IPC 桥接通的 P1-T-A 决策（Vite-only mock）已守住安全基线

---

## 2. 类别 A：边界 race / 内存泄漏

### A1（🟠 Major）`useSkillStore` 终态未主动清理 onProgress 订阅

**文件**：`frontend/src/hooks/useSkillStore.ts` 行 552-572
**代码片段**：
```typescript
// useSkillStore.ts 行 555-572
const result = await bridge.execute(skillId, params ?? {});
if (result.ok && result.executionId) {
  // ...省略中间 setExecutions...
  _startPolling(realId, (updated) => { ... });
  _subscribeProgressWakeup(realId, (updated) => { ... });
  return { ok: true, executionId: realId };
}
```

```typescript
// useSkillStore.ts 行 233-241（_startPolling 内部）
if (exec.status === 'completed' || exec.status === 'failed') {
  clearInterval(interval);
  _pollIntervals.delete(executionId);
}
```

**问题描述**：
- `_startPolling` 在终态时**主动** `clearInterval` + `_pollIntervals.delete`
- `_subscribeProgressWakeup` **从未** 在终态时调 `_unsubscribeProgressWakeup`，只在组件 unmount 时由 `_stopAllProgressWakeups` 兜底
- 单次执行场景：用户进入 `/skills` 详情页 → execute → 触发 1 个 polling + 1 个 wakeup → 完成后 polling 清理但 wakeup 留在 `_progressUnsubs` Map → 详情页 unmount 触发 `_stopAllProgressWakeups` 兜底
- **多执行 / 多组件场景**（如同时打开 2 个 Skill 详情页）：A 页面 execute skill-A，B 页面 execute skill-B，两份 wakeup 同时订阅 `bridge.onProgress` 全局回调（设计如此），poller 一旦推送 skill-A 终态给 A，但 A 不 unsubscribe — A 卸载前存在"该 skill 终态后仍残留 wakeup 入口"。**实际可接受**（payload.executionId 过滤），但**代码形态不严谨**
- **更严重**：poller 2s 兜底到达终态时，`_startPolling` 清理 interval，但 `_subscribeProgressWakeup` 仍订阅。后续 main.js 推送的 progress 事件（如果还有 9 状态→4 状态映射的中间态）仍会被这个 callback 接收，触发 `bridge.getExecution` IPC。**重复 IPC 浪费**（虽然 payload 过滤）

**建议修复方向**：在 `_startPolling` 终态分支同步调 `_unsubscribeProgressWakeup(executionId)`，或新建 `_stopPollingAndWakeup(executionId)` 统一封装

**影响范围**：当前 `Vite-only mock` 测试覆盖不到（test 7 仅验 `onProgress.toHaveBeenCalled()`）；PHASE 3 实机跑通后可能观察到"stop 后偶发 UI 闪一下"——**升级 verified 路径前应修**

---

### A2（🟠 Major）`main.js` `_startSkillsProgressPoller` 启动后无停止机制

**文件**：`src/main.js` 行 2130-2158
**代码片段**：
```javascript
// main.js 行 2131-2158
function _startSkillsProgressPoller() {
  if (_skillsProgressTimer) return;
  _skillsProgressTimer = setInterval(() => {
    for (const [executionId, runtime] of _activeSkillRuntimes.entries()) {
      try {
        const execCtx = typeof runtime.getExecutionStatus === "function"
          ? runtime.getExecutionStatus(executionId)
          : null;
        if (!execCtx) continue;
        const checkpoints = Array.isArray(execCtx.checkpoints) ? execCtx.checkpoints : [];
        const lastCount = _lastCheckpointCount.get(executionId) || 0;
        if (checkpoints.length !== lastCount) {
          _lastCheckpointCount.set(executionId, checkpoints.length);
          _publishSkillProgress(executionId, {
            status: execCtx.status,
            checkpoints: checkpoints.slice(),
          });
        }
        // 终态自清
        if (["complete", "failed", "cancelled"].includes(execCtx.status)) {
          _activeSkillRuntimes.delete(executionId);
          _lastCheckpointCount.delete(executionId);
        }
      } catch {}
    }
  }, 1000);
}
```

**问题描述**：
- `_startSkillsProgressPoller` **仅当 `_skillsProgressTimer` 为 null 时启动**（行 2131 守卫），后续永不停止
- 即使 `_activeSkillRuntimes` Map 清空（终态全删），timer 仍每 1s 触发空 for 循环
- `_skillsProgressTimer = null` **没有清理路径**——一旦执行过 1 次 execute，timer 永久存活
- **Electron main.js 是常驻进程**，poller 1s/次即使空转也要 86,400 次/天 timer 触发（+ GC 压力 + Node EventLoop 周期性占用）
- 如果用户长时间不退出 app，timer 持续；只是当前 1s 一次空转性能可忽略
- **但**：setInterval 引用 `runtime` 闭包，runtime 内部可能持有大量 `_executions` / 状态对象；只要 `_activeSkillRuntimes` Map 不被外部清空（即"R5 状态映射漏 `cancelled`"），timer 跑多久就持有多久

**建议修复方向**：在 `_activeSkillRuntimes.size === 0` 时 `clearInterval(_skillsProgressTimer); _skillsProgressTimer = null;`

**影响范围**：当前 18 vitest 不跑 main.js，不直接触发此问题；PHASE 3 实机连续跑 N 次 execute 之后，**内存不释放**——是个潜在累积问题

---

### A3（🟠 Major）`main.js` 终态 publish 与 `_activeSkillRuntimes.delete` 不同步

**文件**：`src/main.js` 行 2191-2206
**代码片段**：
```javascript
// main.js 行 2191-2206（execute() 终态 publish）
const promise = runtime.execute(paramsObj, { executionId })
  .then((result) => {
    const status = result && result.success ? "complete" : "failed";
    _publishSkillProgress(executionId, {
      status, checkpoints: [],
      result: result ? result.result : null,
      error: result && !result.success ? (result.error?.message || String(result.error)) : null,
    });
    return result;
  })
  .catch((err) => {
    _publishSkillProgress(executionId, {
      status: "failed", checkpoints: [],
      error: err && err.message ? err.message : String(err),
    });
    throw err;
  });
promise.catch(() => {});
_activeSkillRuntimes.set(executionId, runtime);
_lastCheckpointCount.set(executionId, 0);
_startSkillsProgressPoller();
return { ok: true, executionId };
```

**问题描述**：
- `execute()` 成功 `return { ok: true, executionId }` 后立即把 runtime 注册到 `_activeSkillRuntimes`
- 同步触发 `_publishSkillProgress(executionId, { status: 'pending' }?)` **不存在**——execute 走 `runtime.execute(paramsObj, { executionId })` 后立即返回，后台异步推进
- **poller 第一次 tick（1s 后）才拉到 status**: 此时 publish 首个 progress；**poller 不会 replay 0s 初始态**
- 如果 renderer 在 `execute()` 返回后 1s 内 UI 已经渲染（polling 又是 2s 节奏），可能在 2-3s 内还没收到任何 progress 推送
- **影响**：renderer 早期 UI 空白 / loading spinner 显示 2s+，UX 偏慢
- **更深问题**：终态 publish（行 2193-2197）**不更新 `_lastCheckpointCount`**——如果用户重新调用 `execute()` 用相同 executionId（极小概率，但理论上 `sre_${Date.now()}_${random}` 重复），count 会 stale

**建议修复方向**：
- 立即 publish 1 个初始 progress `status: 'pending'`，让 renderer 立刻 setExecutions 标记为 running
- 终态 publish 后 `_activeSkillRuntimes.delete` 应同步生效（避免 poller 下个 tick 重复 publish）

**影响范围**：UX 细节层面；PHASE 3 实机可观察到

---

### A4（🟡 Minor）`main.js` 终态发布后未清 `_activeSkillRuntimes`

**文件**：`src/main.js` 行 2191-2206
**代码片段**：见 A3

**问题描述**：
- `.then(result => { _publishSkillProgress(executionId, { status: 'complete'/'failed', ... }); })` —— **未同步 `_activeSkillRuntimes.delete(executionId)`**
- 只能等 poller 下一个 tick（1s 后）发现 status 在 `["complete", "failed", "cancelled"]` 时清掉
- **窗口期**：publisher 推送终态 → renderer 收到 → 1s 内 poller 还会调一次 `getExecutionStatus`（不必要的 IPC + 重复 publish 如果 checkpoints 变化）

**建议修复方向**：终态 publish 后立即 `_activeSkillRuntimes.delete(executionId); _lastCheckpointCount.delete(executionId);`

**影响范围**：性能 + IPC 冗余；可忽略

---

### A5（🟡 Minor）`preload.js` 5 方法无参数边界守卫

**文件**：`src/preload.js` 行 219-230
**代码片段**：
```javascript
// preload.js 行 219-230
skills: {
  discover: () => ipcRenderer.invoke('skills:discover'),
  execute: (skillId, params) =>
    ipcRenderer.invoke('skills:execute', skillId, params ?? {}),
  getExecution: (executionId) =>
    ipcRenderer.invoke('skills:getExecution', executionId),
  cancel: (executionId) =>
    ipcRenderer.invoke('skills:cancel', executionId),
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('skills:progress', handler);
    return () => ipcRenderer.removeListener('skills:progress', handler);
  },
},
```

**问题描述**：
- `execute(skillId, params)`：`params ?? {}` 防御 OK
- `getExecution(executionId)` / `cancel(executionId)`：**无 null 守卫**——传 `undefined` / `null` 透传到 main.js
  - main.js `skills:cancel` 行 2251 有 `if (!executionId) return { ok: false, cancelled: false, error: "executionId required" };` 守门，OK
  - main.js `skills:getExecution` 行 2221 同样有守卫，OK
- `onProgress(callback)`：guard `typeof callback !== 'function'` OK
- **深层问题**：renderer 调用 `bridge.getExecution(null)` 时，`preload.js` 把 `null` 作为 `executionId` 透传——ipcRenderer.invoke 序列化参数后 main.js 收到 `null`，守卫接住（OK）；**但 `typeof null === 'object'` 在 d.ts 强类型下不会编译报错**（string 类型注解下 null 是 valid assignment，需 `--strictNullChecks` 才能 catch）

**建议修复方向**：在 `preload.js` 5 入口加 `String(executionId ?? '')` 防御（不必要但更稳）；或保持现状依靠 main.js 守门

**影响范围**：tsc 现状 PASS（`getExecution: (executionId: string) =>`）；不存在静态错误

---

### A6（🟢 Nit）`useSkillStore` `_progressUnsubs` 重复 subscribe 守卫已 OK

**文件**：`frontend/src/hooks/useSkillStore.ts` 行 282-289
**代码片段**：
```typescript
function _subscribeProgressWakeup(executionId, onUpdate) {
  if (_progressUnsubs.has(executionId)) return;  // 行 286 守卫
  const bridge = getBridge('skills');
  if (!bridge || typeof bridge.onProgress !== 'function') return;
  const unsubscribe = bridge.onProgress((payload) => { ... });
  _progressUnsubs.set(executionId, unsubscribe);
}
```

**说明**：双重调 `_subscribeProgressWakeup(realId, ...)` 是安全的（行 286 守卫存在）。`_startPolling` 行 220 同样守卫。**无需修复**。

---

## 3. 类别 B：错误处理缺口

### B1（🟠 Major）`main.js` setupSkillsIpc 4 handler 未守 sender

**文件**：`src/main.js` 行 2160-2280
**代码片段**：
```javascript
// main.js 行 2160-2280
ipcMain.handle("skills:discover", async () => { ... });
ipcMain.handle("skills:execute", async (_event, skillId, params) => { ... });
ipcMain.handle("skills:getExecution", async (_event, executionId) => { ... });
ipcMain.handle("skills:cancel", async (_event, executionId) => { ... });
```

**问题描述**：
- 4 个 handler **完全不守 `event.sender === mainWindow.webContents`**
- 对比行 1162 `AGENT_WORKBENCH_FLAG_CHANNEL` 有 sender 守门：
  ```javascript
  if (event?.sender !== mainWindow?.webContents) return { ok: false, extraRenderers: agentWorkbenchFlags.extraRenderers, error: 'unauthorized' };
  ```
- **风险**：如果 renderer 端有 XSS / 第三方 `<webview>` / 受控 plugin 注入恶意脚本，可能通过 `ipcRenderer.invoke('skills:execute', 'malicious-skill', { ... })` 触发技能执行
- **严重度判断**：当前 renderer 无 `<webview>`（`frame:false` + 单 window），但 `core/result-studio` 后续可能引入 plugin 沙箱；**先建立防御姿态**
- **R6 提示**：PHASE 5 closeout 已记 R7（UI-157 实机 verified 待 PHASE 3），但 **未记 sender 守门缺失**

**建议修复方向**：参考 AGENT_WORKBENCH_FLAG_CHANNEL 模式加 `if (event?.sender !== mainWindow?.webContents) return { ok: false, error: 'unauthorized' };`

**影响范围**：安全基线；不影响 4 治理门 GREEN；不影响 PHASE 1 → verified 升级路径（dev Electron 边界内信任 renderer）

---

### B2（🟠 Major）`main.js` `_publishSkillProgress` 终态推送与 `webContents.send` 抛错未捕获

**文件**：`src/main.js` 行 2125-2128
**代码片段**：
```javascript
function _publishSkillProgress(executionId, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("skills:progress", { executionId, ...payload });
}
```

**问题描述**：
- `webContents.send` 在 `webContents` 销毁 race 条件下可能同步抛错（未在 try/catch 内）
- 守卫已检验 `isDestroyed` 但**销毁是异步事件**——准备 send 时 webContents 还在，send 同时 window 关闭 → throw
- **catch 链在 poller 内层 try/catch 行 2152（`} catch {}`）** 已匿吞，但函数 `_publishSkillProgress` 本身无独立 try/catch；如果 sender 抛错，会冒泡到 main.js Event Loop 顶层
- **main.js 顶层 Event Loop 错误 → 未捕获 → 进程崩溃**（虽然 Electron 会重启，但用户体验是 app 闪退）

**建议修复方向**：`_publishSkillProgress` 加独立 try/catch

**影响范围**：极端 race；理论崩溃；(G0) 难以触发

---

### B3（🟡 Minor）`main.js` 9→4 状态映射失败 fallback 是 "running"

**文件**：`src/main.js` 行 2268-2280
**代码片段**：
```javascript
function _mapSkillRuntimeStatus(s) {
  switch (s) {
    case "created":
    case "validating_params":
    case "checking_dependencies":
      return "pending";
    case "running":
    case "paused":
    case "recovering":
      return "running";
    case "complete":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "failed";
    default:
      return "running";  // ← fallback 选了 "running"
  }
}
```

**问题描述**：
- 默认 `return "running"` 对**未知状态**（未来 `EXECUTION_STATES` 新增值）合理
- 但**对 `null` / `undefined` 也走 default**（main.js `getExecutionStatus(executionId)` 执行空可能返回 null/无 status）—— 此时 UI 错认为 running
- **前端契约 `getExecution` 返回 status 总非空**（render 端用 `result.execution.status` 不带可选），**若发生 null 状态穿透，UI rendering 异常**

**建议修复方向**：`default` 改为 `return "failed"`（更保守），或加 `if (!s) return "failed";` 显式 null 守卫

**影响范围**：未知 status 出现概率低（R6 已记录 9 状态）

---

### B4（🟡 Minor）`useSkillStore` `_subscribeProgressWakeup` payload 不匹配时静默 return

**文件**：`frontend/src/hooks/useSkillStore.ts` 行 290-308
**代码片段**：
```typescript
const unsubscribe = bridge.onProgress((payload: { executionId?: string }) => {
  if (payload?.executionId !== executionId) return;  // ← 静默 return
  void (async () => {
    try {
      const result = await bridge.getExecution(executionId);
      if (result.ok && result.execution) {
        onUpdate({ ... });
      }
    } catch { /* 静默兜底 */ }
  })();
});
```

**问题描述**：
- payload.executionId 不匹配时静默 return 是**正确设计**（避免其他 execution 的 progress 事件误触发当前 execution 的 update）
- **但是**：`onProgress` 注册时如果 renderer 端**多个 `_subscribeProgressWakeup(skillA, ...)` / `_subscribeProgressWakeup(skillB, ...)` 并存**，每个 callback 都会接收**所有 execution 的 progress**事件，靠 payload.executionId 过滤
- 当前实现**未优化**（每次 N 个 execution 的 progress 都触发 N 个 callback → N 个 `bridge.getExecution` IPC；其实只有 1 个匹配）
- **更深 bug**：如果 `payload.executionId` 是 `undefined`（理论上 main.js 不会发，但边界），`!==` 比较是 `undefined !== executionId` → return；OK
- **真问题**：payload 处理逻辑完全靠 main.js 守门——若 main.js 推错 payload（缺 `executionId`），前端静默丢弃，UI 不更新

**建议修复方向**：加 `console.warn('[useSkillStore] progress payload missing executionId:', payload)` 调试日志便于诊断

**影响范围**：调试性；正常情况下不触发

---

### B5（🟡 Minor）`preload.js` onProgress callback 抛错未捕获

**文件**：`src/preload.js` 行 226-230
**代码片段**：
```javascript
onProgress: (callback) => {
  if (typeof callback !== 'function') return () => {};
  const handler = (_event, payload) => callback(payload);  // ← callback 抛错无 try/catch
  ipcRenderer.on('skills:progress', handler);
  return () => ipcRenderer.removeListener('skills:progress', handler);
},
```

**问题描述**：
- callback 抛同步异常 → `ipcRenderer.on` handler 抛 → Electron 主进程 client-inner 报错 → **后续所有 progress 事件受影响**（取决于 handler 注册方式）
- preload 进程与 renderer 进程隔离（contextBridge），但 **ipcRenderer.on 注册在 preload 进程内执行**——preload 进程异常 → preload 重建 → 全局 callback 状态丢失
- **实际不常见**（callback 包了 try/catch），但**无防御**

**建议修复方向**：`const handler = (_event, payload) => { try { callback(payload); } catch (e) { console.error('[preload] skills:progress callback error:', e); } };`

**影响范围**：callback 抛错概率低（useSkillStore 内部 try/catch 已 OK）

---

## 4. 类别 C：API 契约违反

### C1（🟠 Major）`main.js` `_publishSkillProgress` 实际字段 vs `d.ts` 声明字段不一致

**文件**：`src/main.js` vs `frontend/src/lib/electron.d.ts` 行 207-218
**代码片段**：
```typescript
// electron.d.ts 行 207-218 声明
onProgress: (callback: (payload: {
  executionId: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  checkpoints?: unknown[];
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}) => void) => () => void;
```

```javascript
// main.js 行 2125-2127 实际 publish
mainWindow.webContents.send("skills:progress", { executionId, ...payload });
```

```javascript
// main.js 行 2141-2147（poller 内的 publish）
_publishSkillProgress(executionId, {
  status: execCtx.status,  // 9 状态（未映射 4 状态）
  checkpoints: checkpoints.slice(),  // OK
});
```

```javascript
// main.js 行 2191-2197（终态 publish）
_publishSkillProgress(executionId, {
  status,  // 'complete' / 'failed'（已是 4 状态映射过）
  checkpoints: [],
  result: result ? result.result : null,
  error: result && !result.success ? (result.error?.message || String(result.error)) : null,
});
```

**问题描述**：
- **poller 内 publish 的 `status` 是 SkillRuntime 9 状态**（行 2143 `execCtx.status` 未映射）—— **违反 d.ts 契约**（d.ts 声明状态 4 枚举：`'pending' | 'running' | 'completed' | 'failed'`）
- 终态 publish 的 `status` 已**先经过 `_mapSkillRuntimeStatus` 间接**（实际看行 2192 `result.success ? "complete" : "failed"` 是 4 状态直写）—— OK
- renderer 端 `_subscribeProgressWakeup` 收到 `status: 'pending' | 'running' | 'completed' | 'failed'` 后不会触发写入（除非 `result.ok && result.execution`），但**TypeScript 守门不通过**：d.ts 收紧为 4 状态，main.js 实际推 9 状态
- **虽然 tsc 0 错误**（这是 main.js 端 vs 渲染端 类型系统的 intersection 不严格），但**契约层不一致**
- **结果**：renderer 拿到 `status: 'validating_params'`（一种 9 状态）—— 但 d.ts 收紧了；**实际 TypeScript 编译时**因为 `payload: { executionId?: string }`（行 290 用的是弱类型），不会编译失败；但**契约文档化**（d.ts）+ 实际行为错位

**建议修复方向**：
- main.js 行 2143 `_publishSkillProgress(executionId, { status: _mapSkillRuntimeStatus(execCtx.status), checkpoints: checkpoints.slice() })` —— 与 d.ts 4 状态对齐
- 或 d.ts 放宽到 9 状态枚举（更精准反映 backend）

**影响范围**：契约层；不影响 4 治理门 GREEN；PHASE 3 实机若 UI 显示 `status: 'validating_params'` 是异常

---

### C2（🟡 Minor）`main.js` createDefaultSDK/useSdk 装配部分行为未文档化

**文件**：`src/main.js` 行 2103-2117
**代码片段**：
```javascript
function _getSkillsSDK() {
  if (skillsSDK) return skillsSDK;
  try {
    const sdkMod = require(resolveCore("shared-backend", "skills-sdk.js"));
    const engineMod = require(resolveCore("shared-backend", "workflow-engine.js"));
    const { createSkillsSDK, createDefaultSDK } = sdkMod;
    const { createWorkflowEngine } = engineMod;
    const base = createDefaultSDK ? createDefaultSDK() : createSkillsSDK();
    const sdk = base;
    sdk.workflowEngine = createWorkflowEngine({ sdk: base });
    skillsSDK = sdk;
    return skillsSDK;
  } catch (e) {
    console.warn("[desktop] skills SDK init failed:", e.message);
    return null;
  }
}
```

**问题描述**：
- `createDefaultSDK ? createDefaultSDK() : createSkillsSDK()` 看似优雅兜底，**实际两个函数签名可能不同**（createDefaultSDK 可能不返回 SDK 而是返回 array / factory）
- 无注释说明两个函数区别
- `sdk.workflowEngine = createWorkflowEngine({ sdk: base })` —— 把 workflowEngine 注入到 SDK 实例上，**API 行为未定义**（workflow-engine.js 究竟怎么消费 sdk 是否对字段名 `workflowEngine` 敏感？）

**建议修复方向**：加注释说明 `createDefaultSDK` vs `createSkillsSDK` 区别；读取 `core/shared-backend/skills-sdk.js` exports 的两个函数签名

**影响范围**：行为层（潜在 bug）；PHASE 3 实机可能观察到 skill 执行不工作

---

### C3（🟡 Minor）`preload.js` 注释引用 `L114-169` 偏差

**文件**：`src/preload.js` 行 216
**代码片段**：
```javascript
// preload.js 行 216
// G0 UI-157：Skills 发现 / 执行 / 进度桥（对齐 frontend/src/lib/electron.d.ts L114-169）
```

**实际 electron.d.ts 当前 skills 块起始位置**（基于 audit 读取的源文件）：
- 实际 `skills` 块在 `electron.d.ts` 行 114-218（不是 114-169）
- **104 行偏差**（d.ts 相比 PHASE 1 起始时又新增了 ~12 行 ADDITIVE 字段 + 注释）

**建议修复方向**：更新注释为 `L114-218` 或 `L207-218`（仅指 onProgress 字段）

**影响范围**：文档维护；可忽略

---

### C4（🟢 Nit）`useSkillStore.ts` `_progressUnsubs` 内部类型未显式

**文件**：`frontend/src/hooks/useSkillStore.ts` 行 275
**代码片段**：
```typescript
const _progressUnsubs: Map<string, () => void> = new Map();
```

**说明**：类型已明确。**但 `bridge.onProgress` 返回值 `() => void` 在 preload.js 行 229 显式 `return () => ipcRenderer.removeListener(...)`**——TS 推断为 `() => void` OK。**无问题**。

---

## 5. 类别 D：tsc / 类型兼容性

### D1（🟡 Minor）`useSkillStore.ts` `_subscribeProgressWakeup` payload 类型弱

**文件**：`frontend/src/hooks/useSkillStore.ts` 行 290-291
**代码片段**：
```typescript
const unsubscribe = bridge.onProgress((payload: { executionId?: string }) => {
  if (payload?.executionId !== executionId) return;
```

**问题描述**：
- `bridge.onProgress` 的 d.ts 声明（`electron.d.ts` 行 207-218）payload 类型更精确：`{ executionId: string; status?: ...; checkpoints?: ...; result?: ...; error?: ...; startedAt?: ...; completedAt?: ... }`
- 这里用 `{ executionId?: string }` **窄化** ——技术上 OK（窄化是允许的）
- 但**未消费其他字段**（status / checkpoints 没读）—— 一致 OK
- **问题**：如果 main.js 推的 payload 缺 `executionId`，`payload?.executionId !== executionId` 静默 return（已在 B4 描述）；**弱类型让调试变难**

**建议修复方向**：用 d.ts 完整类型 `Parameters<typeof bridge.onProgress>[0] extends (p: infer P) => any ? P : never` 自动派生

**影响范围**：可忽略；tsc 0 错误

---

## 6. 类别 E：性能隐患

### E1（🟠 Major）`main.js` 100 个并行 execution × 1s poller 性能

**文件**：`src/main.js` 行 2130-2158
**代码片段**：见 A2

**问题描述**：
- `setInterval(1000)` 每个 tick 遍历 `_activeSkillRuntimes` Map
- 每个 entry 调用 `runtime.getExecutionStatus(executionId)`（无 IO，**纯内存**）
- 100 个并行 execution：100 次 `getExecutionStatus` + 100 次 `Array.isArray` 校验 + 100 次 `checkpoints.length` 比较
- 单次 `getExecutionStatus` 大约 O(1)（看 skill-runtime.js 行 220 内部 `this._executions.get(executionId)?.status`）
- **真实成本**：1000 个 execution 时 1000 ops/s — Node EventLoop 没啥问题
- **但**：1000 个 runtime 同时存活在 `_activeSkillRuntimes` Map 是**异常使用场景**（用户手动疯狂点击 execute 1000 次）；治理无法处理
- **实际 G0 边界**：用户正常交互不可能 100 个并行 execution，最大 5-10 个

**建议修复方向**：
- 短期：保持 1s tick
- 长期：按需启动 poller（每个 execution 独立 setTimeout 链）；或切到 EventEmitter（但 R2 写明 workflow-engine 零 EVENT）

**影响范围**：G0 边界内 OK；PHASE 3 实机不会触发

---

### E2（🟡 Minor）`useSkillStore` polling 2s 与 wakeup 并行真值冗余

**文件**：`frontend/src/hooks/useSkillStore.ts` 行 555-572
**代码片段**：
```typescript
_startPolling(realId, (updated) => { ... });
_subscribeProgressWakeup(realId, (updated) => { ... });
```

**问题描述**：
- 既有 2s polling **又**有 wakeup；同时跑
- **场景**：wakeup 触发 → `bridge.getExecution` IPC → 更新 store；100ms 后 2s polling 也触发 → 再 `bridge.getExecution` IPC → store 内容未变（已是最 new）但 `setExecutions` 触发的 React 渲染可能执行
- **React 优化**：`setExecutions((prev) => { const next = new Map(prev); next.set(realId, updated); return next; })` —— **总是新建 Map**，触发 re-render
- **重复渲染**：polling 触发 setExecutions 永远新建 Map，useMemo / shouldComponentUpdate 等价行为也 re-render
- **实际成本**：每次 IPC decode + setExecutions 触发的 React reconciliation——10 个 execution 时 5 次/秒 IPC + 10 次 re-render

**建议修复方向**：
- setExecutions 内做 deep-equal 比较（避免无变化 re-render）
- 或仅当 `prev.status !== updated.status || prev.result !== updated.result` 时 setExecutions

**影响范围**：UX 性能；仅在 N 个并行 execution 时明显

---

### E3（🟡 Minor）`preload.js` onProgress callback 闭包 payload 体积

**文件**：`src/preload.js` 行 226-230
**代码片段**：
```javascript
const handler = (_event, payload) => callback(payload);
ipcRenderer.on('skills:progress', handler);
```

**问题描述**：
- `checkpoints: checkpoints.slice()` 每次 publish 整个 checkpoints 数组
- 若某个 execution 1000 个 checkpoints，**每次 progress publish 同步发 1000 项**
- 主进程 → 渲染进程 IPC payload 序列化开销
- **当前 main.js 行 2146 `checkpoints.slice()` 是浅拷贝**（同结构引用），不算大事；但 1000 项 IPC 传输确实重

**建议修复方向**：增量推送（只 push 新增 checkpoint）；或限制 max payload size

**影响范围**：极端场景；G0 边界内 OK

---

## 7. 类别 F：安全 / a11y

### F1（🟠 Major）`main.js` 4 IPC handler 无 sender 守门（重复 B1）

**说明**：同 B1，归类到 F（安全）。**优先级最高**的 Non-derivable 安全问题。

**风险评估**：
- 当前 renderer 端无第三方脚本注入点（contextIsolation + nodeIntegration false）
- **但**：`core/result-studio` 后续可能引入 plugin 沙箱（plugin:install 已暴露 IPC）+ market plugin 加载脚本风险
- **正确姿态**：先建立防御边界，4 个 skills:* handler 加上 `event.sender === mainWindow.webContents` 守门
- **当前对比**：AGENT_WORKBENCH_FLAG_CHANNEL 行 1162 已守门 — **模式已存在**

**建议修复方向**：4 handler 入口加守门

**影响范围**：安全基线；建议下一工作包修复

---

### F2（🟡 Minor）`preload.js` `petriDesktop` 暴露 partial 防御

**文件**：`src/preload.js` 行 61-260
**代码片段**：
```javascript
contextBridge.exposeInMainWorld('petriDesktop', {
  isDesktop: true,
  // ... 100+ methods
});
```

**问题描述**：
- 整个 `petriDesktop` 通过 `contextBridge.exposeInMainWorld` 暴露（**OK**，contextBridge 是隔离沙箱）
- 但 `onProgress` 等回调引用 closure 中的 `AGENT_WORKBENCH_FLAGS` 等全局可变状态——**testability OK, security OK**
- **真正风险**：若 renderer 端有恶意脚本尝试 `delete window.petriDesktop.skills = null`，**contextBridge.frozen object** handle 抛错——OK
- **但**：`onProgress` 返回的 unsubscribe 没绑定 `try/finally`——调用方忘了调用 unsubscribe 就泄漏（已在 A1 描述）

**建议修复方向**：保持现状

**影响范围**：当前 security OK

---

### F3（🟢 Nit）a11y：progress 推送无 accessible hook

**说明**：
- `onProgress` payload 不带 `aria-live` / `aria-busy` 受控字段
- UI 端 progress 显示依赖业务组件（`pages/skills/index.tsx` 0 diff）—— 不在本次审核范围
- **a11y 完整度**取决于下游组件；IPC 桥本身无 a11y 责任

**影响范围**：UI 工作包范围

---

## 8. 类别 G：测试覆盖

### G1（🟠 Major）test 7 仅验证 `onProgress` 被调用、未验证 wakeup 触发后 store 写入

**文件**：`frontend/src/hooks/useSkillStore.test.ts` 行 182-192
**代码片段**：
```typescript
it('execute() subscribes to bridge.skills.onProgress (PHASE 1 G0 UI-157)', async () => {
  const { onProgress } = installBridge();
  const { result } = renderHook(() => useSkillStore());
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    await result.current.execute('deg-analysis', {});
  });
  // PHASE 1 wakeup path: bridge.onProgress must have been called
  expect(onProgress).toHaveBeenCalled();
});
```

**问题描述**：
- `expect(onProgress).toHaveBeenCalled()` 仅验证 mock 函数被调用
- **缺失**：
  - mock 的 `onProgress` 注册的 callback 没被显式触发（test 7 没调用 `progressCallbacks.get('__default__').forEach(cb => cb({ executionId: 'sre_test123', status: 'completed' }))`）
  - 即使触发 callback，**store 是否真的写入**也未断言
- **真实 bug 风险**：PHASE 1 wakeup 路径如果 callback 注册后 callback 闭包错误（payload 类型不匹配），不会被 test 7 捕获
- **test 7 实际只覆盖"onProgress hook 被调用"**——**0 覆盖 wakeup 完整链路**

**建议修复方向**：
```typescript
it('wakeup payload triggers store update via getExecution', async () => {
  const handles = installBridge();
  const { result } = renderHook(() => useSkillStore());
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    await result.current.execute('deg-analysis', {});
  });

  // 触发 wakeup callback
  await act(async () => {
    const callbacks = /* get from progressCallbacks */;
    callbacks.forEach(cb => cb({ executionId: 'sre_test123', status: 'completed' }));
  });

  // 验证 store 写入
  expect(result.current.getExecution('sre_test123')?.status).toBe('completed');
});
```

**影响范围**：测试覆盖矩阵；建议下一工作包补

---

### G2（🟠 Major）`execute() 失败时 polling 启动？` 缺失测试

**文件**：`frontend/src/hooks/useSkillStore.test.ts`
**问题描述**：
- test 6 验 `execute() surfaces failure from the bridge`（行 162-176）—— `result.ok=false` 时 `return { ok: false, error: result.error }`
- **但**：失败路径不进 `_startPolling` / `_subscribeProgressWakeup`（行 554-572 只在 `result.ok && result.executionId` 内调）
- **缺失断言**：失败路径下 `_pollIntervals` / `_progressUnsubs` **不应**新增 entry
- **真实 bug 风险**：如果将来 refactor 把 `_startPolling` 移到 `finally` 块，会引入 polling 泄漏

**建议修复方向**：test 6 加 `expect(/* _pollIntervals.has not present */)` 或通过桥 mock 验证无 `getExecution` 调用

**影响范围**：测试覆盖

---

### G3（🟠 Major）`onProgress callback 抛错` 缺失测试

**文件**：`frontend/src/hooks/useSkillStore.test.ts`
**问题描述**：
- 缺失 `onProgress` 模拟 callback 抛错路径的测试
- **B5 描述**：preload.js `handler = (_event, payload) => callback(payload)` 无 try/catch
- **真实 bug 风险**：renderer 端 polling 单元测试中如果 callback 抛错，store 会 crash
- **实际**：useSkillStore `_subscribeProgressWakeup` 内 callback 内部已 try/catch（行 304-307 `try { ... } catch { /* 静默 */ }`），不会 crash
- 但**测试覆盖缺失**导致 refactor 时可能引入回归

**建议修复方向**：mock onProgress 让 callback 抛错，验证 store 不崩溃

**影响范围**：测试覆盖

---

### G4（🟠 Major）`cancel() 失败路径` 缺失测试

**文件**：`frontend/src/hooks/useSkillStore.test.ts` 行 194-205
**代码片段**：
```typescript
it('bridge.skills.cancel is callable and returns { ok: true, cancelled: true }', async () => {
  // ... 直接调 bridge.skills.cancel，绕过 store.execute()
  cancelResult = await bridge.skills.cancel('sre_test123');
  expect(handles.cancel).toHaveBeenCalledWith('sre_test123');
  expect(cancelResult.ok).toBe(true);
  expect(cancelResult.cancelled).toBe(true);
});
```

**问题描述**：
- test 8 **只测试成功路径**（默认 mock `cancel: vi.fn().mockResolvedValue({ ok: true, cancelled: true })`）
- 缺失：
  - `cancel()` 失败时 `{ ok: false, error: 'X' }` 的行为
  - `cancel()` 抛出异常的兜底（虽然不预期）
  - `cancel()` + 后续 `_getExecution` 看到 `status: 'failed'` 的端到端
- **store 内部没有 `cancel()` action**——test 8 直接调 bridge，**未通过 store 路径**
- **真实 bug 风险**：如果后续 PR 加 `useSkillStore.cancel(action)`，**没有任何测试兜底**

**建议修复方向**：
- 补 test：`cancel()` 失败时桥返回 `{ ok: false, error: 'X' }`
- 补 test：通过 `result.current.execute(...)` 模拟后调 `bridge.skills.cancel(...)`，验证 store polished

**影响范围**：测试覆盖

---

### G5（🟡 Minor）`test 7` 没有验证 `_progressUnsubs` 被清理

**文件**：`frontend/src/hooks/useSkillStore.test.ts`
**问题描述**：
- test 7 验 `onProgress.toHaveBeenCalled()`
- **未验证**：unmount 后 `_progressUnsubs` 通过 useEffect cleanup 被清空
- **A1 关联**：终态未主动清理 — test 7 也没验证终态清理

**建议修复方向**：unmount 后断言 `_progressUnsubs.size === 0`（需导出内部状态）

**影响范围**：测试覆盖

---

### G6（🟡 Minor）`main.js` 9→4 状态映射单测缺失

**文件**：src/main.js 行 2268-2280
**问题描述**：
- `_mapSkillRuntimeStatus` 是 main.js 内部函数，**无单测**
- 涉及 9 状态映射 4 状态 + cancelled → failed 简化
- **真实 bug 风险**：如果 `cancelled` 状态被前端误显示为 failed（应区分 UI 提示文案），会在 PHASE 3 实机暴露

**建议修复方向**：导出 `_mapSkillRuntimeStatus` + 写 9 状态单测

**影响范围**：测试覆盖

---

## 9. 类别 H：文档同步

### H1（🟡 Minor）`docs/block-2-ui-157-review-plan.md` §3.1.A 未体现"electron.d.ts ADDITIVE +2 字段"

**文件**：`docs/block-2-ui-157-review-plan.md` 行 29-46
**代码片段**：
```markdown
【PHASE 0 摸底后修订】**`frontend/src/lib/electron.d.ts` L114-150 已是 source-of-truth**（已声明 `skills.{discover, execute, getExecution}` + onProgress），无需修改；`desktopBridge.ts` 已通过 `getBridge('skills')` 自动派生类型，无需修改。
```

**问题描述**：
- plan v2 写"`electron.d.ts` L114-150 已是 source-of-truth，无需修改"
- **真实落地**：electron.d.ts 实际 +12 行（ADDITIVE +2 字段 cancel + onProgress）
- **commit `0be5483` `docs(ui-157)`** 提交 plan 修订，但 plan 主体仍保留"无需修改"措辞
- **phase-1-bridge.md §1.3 描述**："**`frontend/src/lib/electron.d.ts` (+12, ADDITIVE)**" + §"5.1 主 agent 裁决 Option A（扩 electron.d.ts）vs B（reduce bridge 到 3 方法）"——**报告有记，但 plan 没同步**
- **真实风险**：未来阅读 plan 的人误以为不用动 d.ts；按 v1 计划写新代码时遇到 tsc 报错

**建议修复方向**：plan §3.1.A 内"electron.d.ts L114-150 已是 source-of-truth"改为"PHASE 1 修订：electron.d.ts 行 207-218 ADDITIVE +2 字段 cancel + onProgress（commit 2d81377 P1-1.3）"

**影响范围**：plan 文档准确性

---

### H2（🟡 Minor）`docs/block-2-ui-157-review-closeout.md` 未记 sender 守门 / 终态清理缺失

**文件**：`docs/block-2-ui-157-review-closeout.md` 行 73-80（遗留风险 R1-R7）
**问题描述**：
- closeout 列 7 项遗留风险（R1-R7），但 **未记**：
  - main.js 4 IPC handler 无 sender 守门（建议加，对齐 AGENT_WORKBENCH_FLAG_CHANNEL 模式）
  - useSkillStore 终态未主动清理 onProgress 订阅
  - main.js poller 启动后无停止机制
  - 9→4 状态映射 R6 已在；cancelled → failed 简化已记录
- **AGENTS.md "论据诚实"纪律**：closeout 应把所有遗留风险齐全登记

**建议修复方向**：追加 R8（sender 守门）/ R9（终态清理缺失）/ R10（poller 停止机制缺失）

**影响范围**：closeout 完整性

---

### H3（🟢 Nit）`main.js` setupSkillsIpc 注释未显示 9→4 状态映射表

**文件**：`src/main.js` 行 2091-2095
**代码片段**：
```javascript
// main.js 行 2091-2095
// ── IPC：Skills 工作流页面（UI-157 PHASE 1 桥接）─────────────────
// 委托 core/shared-backend/skills-sdk.js 的 SkillsSDK 单例，
// 同时维护一份 executionId → SkillRuntime 引用 + 最近一次 checkpoint
// 快照，通过 setInterval(1000) diff 合成 skills:progress 推送。
```

**说明**：行 2268-2280 `_mapSkillRuntimeStatus` 有 case 表，但**文件顶部注释未点明 9→4 状态映射**——读者需跳转到行 2268 才知道

**建议修复方向**：行 2093 注释增加一行：`9 状态映射 4 状态：见 _mapSkillRuntimeStatus（行 2268）`

**影响范围**：代码可读性

---

## 10. 主 agent 裁决清单（按严重度汇总）

### 10.1 🔴 Blocker（必须本工作包修复）

**无** —— 当前 4 治理门 + 18 vitest + tsc 全 GREEN；未发现 P0 级别问题。

---

### 10.2 🟠 Major（建议下一工作包修复）

| # | ID | 类别 | 摘要 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | A1 | 边界 race | useSkillStore 终态未清 onProgress 订阅 | 下一工作包修：`_startPolling` 终态分支同步调 `_unsubscribeProgressWakeup` |
| 2 | A2 | 内存泄漏 | main.js poller 启动后无停止机制 | 下一工作包修：`_activeSkillRuntimes.size === 0` 时 clearInterval |
| 3 | A3 | 边界 race | execute 终态 publish 与 activeRuntimes.delete 不同步 | 下一工作包修：终态 publish 后立即 delete |
| 4 | B1 / F1 | 安全 | main.js 4 IPC handler 无 sender 守门 | **下一工作包必修**：对齐 AGENT_WORKBENCH_FLAG_CHANNEL 模式 |
| 5 | B2 | 错误处理 | _publishSkillProgress 无独立 try/catch | 下一工作包修：加 try/catch 防 main.js 崩溃 |
| 6 | C1 | 契约违反 | main.js poller publish 9 状态未映射 4 状态 | 下一工作包修：行 2143 改成 `_mapSkillRuntimeStatus(execCtx.status)` |
| 7 | E1 | 性能 | 100 并行 execution × 1s poller 性能隐患 | 暂不修：G0 边界内不会触发；记录为 R8 |
| 8 | G1 | 测试覆盖 | test 7 未验证 wakeup 触发后 store 写入 | 下一工作包补：补 wakeup 链路单测 |
| 9 | G2 | 测试覆盖 | execute() 失败时 polling 启动验证缺失 | 下一工作包补：补失败路径断言 |
| 10 | G3 | 测试覆盖 | onProgress callback 抛错测试缺失 | 下一工作包补：补 callback 抛错兜底 |
| 11 | G4 | 测试覆盖 | cancel() 失败路径测试缺失 | 下一工作包补：补 cancel 失败路径 |
| 12 | G6 | 测试覆盖 | main.js 9→4 状态映射单测缺失 | 下一工作包补：导出 + 9 状态单测 |

### 10.3 🟡 Minor（可选优化 / 留后续工作包）

| # | ID | 类别 | 摘要 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | A4 | 性能 | 终态 publish 后未清 _activeSkillRuntimes | 下一工作包修（与 A3 合并） |
| 2 | A5 | 边界 | preload.js 5 方法无参数守卫 | 暂不修：main.js 守门 |
| 3 | B3 | 错误处理 | 9→4 状态映射 default 是 "running" | 下一工作包修：改为 "failed" |
| 4 | B4 | 错误处理 | wakeup payload 不匹配静默 return | 暂不修：加 console.warn 调试日志 |
| 5 | B5 | 错误处理 | preload.js onProgress callback 抛错无 try | 下一工作包修：加 try/catch |
| 6 | C2 | 契约 | createDefaultSDK 装配未文档化 | 下一工作包修：加注释 |
| 7 | C3 | 文档 | preload.js 注释 L114-169 偏差 | 暂不修：trivia |
| 8 | D1 | tsc | useSkillStore payload 类型弱 | 暂不修：tsc 0 错误 |
| 9 | E2 | 性能 | polling 与 wakeup 重复 IPC | 下一工作包修：setExecutions 内部加 deep-equal |
| 10 | E3 | 性能 | checkpoints slice 体积 | 暂不修：极端场景 |
| 11 | F2 | 安全 | preload.js 暴露 partial 防御 | 暂不修：current security OK |
| 12 | G5 | 测试 | test 7 未验证 _progressUnsubs 清理 | 下一工作包补：补 unmount 断言 |
| 13 | H1 | 文档 | plan §3.1.A 未体现 +12 ADDITIVE | 下一工作包修：补 plan 修订 |
| 14 | H2 | 文档 | closeout 未记 sender 守门 / 终态清理 | 下一工作包修：补 R8/R9/R10 |
| 15 | B3 | 错误处理 | 9→4 default "running" | 下一工作包修 |

### 10.4 🟢 Nit（可忽略）

| # | ID | 类别 | 摘要 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | A6 | 边界 | _progressUnsubs 重复守卫 OK | 忽略 |
| 2 | C4 | 类型 | useskillStore 内部类型已 OK | 忽略 |
| 3 | F3 | a11y | progress 推送无 aria-live | 忽略：UI 工作包范围 |
| 4 | H3 | 文档 | main.js 顶部注释未显示 9→4 映射表 | 下一工作包补注释 |

---

## 11. PHASE 3 升级 verified 路径影响评估

> 按当前 P1-T-A 决策"不启动真实 dev Electron"，PHASE 3 实机暂缓。**但若未来用户裁决 widen 范围启用真 Electron + CDP attach 跑 4 截图**，本审核发现可能触发哪些实测问题？

### 11.1 真实可能触发的实测问题

| # | 触发场景 | 现象 | 严重度 |
| --- | --- | --- | --- |
| 1 | **A1 终态未清 onProgress** | 实机跑 N 次 execute 后，UI 偶发"UI 闪一下"（残留 callback 触发后续 getExecution） | 🟠 Major |
| 2 | **A3 终态 publish 1s 延迟** | 实机 execute 后 UI 1-2s 空白（poller 首次 tick 才有 progress） | 🟠 Major |
| 3 | **C1 9 状态未映射 4** | 实机 UI 显示 `status: 'validating_params'`（不在 d.ts 4 状态） | 🟠 Major |
| 4 | **B1 / F1 无 sender 守门** | 当前 renderer 端无恶意脚本注入点；**未来 plugin 沙箱加载**后可能被攻击 | 🟠 Major |
| 5 | **G1 wakeup 链路测试缺失** | 实机若 wakeup 失效（payload type mismatch），靠 polling 2s 兜底但**测试 PASS 不代表真实可用** | 🟠 Major |
| 6 | **E2 polling + wakeup 重复 IPC** | 多 execution 并行时 IPC 频次翻倍；UI 偶发卡顿 | 🟡 Minor |
| 7 | **G4 cancel 失败路径** | 实机 cancel 一个不存在的 executionId，UI 显示错误但 store 不变 | 🟡 Minor |

### 11.2 实机跑前必修（建议）

| 优先级 | 项 | 修复目的 |
| --- | --- | --- |
| **P1** | B1/F1 sender 守门 | 安全基线 |
| **P1** | C1 9→4 状态映射 | 契约一致性 |
| **P2** | G1 wakeup 链路测试 | 实机前 CI 守门 |
| **P2** | A3 execute 立即 publish 初始态 | UX 感知延迟 |
| **P3** | A1 终态清理 onProgress | 内存 / 重复 IPC |
| **P3** | G4 cancel 失败路径测试 | 兜底 |

### 11.3 实机跑后看实测再决定

| 项 | 决策依据 |
| --- | --- |
| A2 poller 停止机制 | 100 个并行 execution 在 G0 边界内不会触发 |
| E1 100 execution 性能 | 同上 |
| E2 polling + wakeup 重复 IPC | 5-10 个 execution 实测若无明显卡顿可忽略 |
| B3 9→4 default "running" | 9 状态枚举已稳定；当前不会触发 unknown status |

---

## 12. 总结

### 12.1 核心结论

- **PHASE 1 commit `2d81377` 整体质量合格**：4 治理门 + 18 vitest + tsc 全 GREEN；无 P0 Blocker
- **主要遗留风险**集中在 IPC handler 安全（B1/F1）+ 状态映射契约（C1）+ 内存清理（A1/A2/A3）+ 测试覆盖（G1/G4）
- **12 项 Major 建议进下一工作包**（按优先级 P1 安全/P1 契约 → P2 测试 → P3 性能）
- **15 项 Minor 留后续或当前可忽略**

### 12.2 不写 AUDIT-LOG 的理由

本审核未发现 🔴 Blocker，按工作纪律 `docs/AUDIT-LOG.md` 只追加"真 Blocker"或"待合并项"——**12 项 Major 建议交给主 agent 裁决是否在下一工作包修复**，不主动广播。

### 12.3 不动代码的承诺

- 全程**只读审计**，未修改任何源文件
- 4 治理门 + 18 vitest 仅用于交叉验证基线，**未 commit**
- 报告 §10 裁决清单**只给建议**，不执行修复

### 12.4 后续交接

- 主 agent 接到本报告后：
  1. 复核 12 项 Major 建议
  2. 决定是否 / 何时开新工作包修复（建议按 §11.2 P1→P2→P3 顺序）
  3. 维持"单工作包串行"纪律，不绕过主 agent 决策
- 下一工作包若启动，应把 12 项 Major 拆分为「安全必修 + 契约修正 + 测试补全」3 类串行处理

---

**报告完**。
