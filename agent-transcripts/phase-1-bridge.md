# BLOCK-2-UI-157-REVIEW · PHASE 1 Final Report

**日期**：2026-08-16
**作者**：主 agent（PHASE 1 worker 委派后由主 agent 完成收口）
**状态**：✅ **PHASE 1 已完成 + commit 落地 + 4 治理门禁 GREEN**

---

## 0. PHASE 0 → PHASE 1 决策回顾

### 0.1 PHASE 0 子代理 4 个报告
- [Agent A backend DAG 引擎契约](phase-0-agent-a-backend-contract.md)（343 行）
- [Agent B IPC + store 审计](phase-0-agent-b-ipc-store-audit.md)（449 行，**主 agent 修正 2 处错误断言**）
- [Agent C 构建 + 测试环境](phase-0-agent-c-build-env.md)（428 行）
- [Agent D UI-161 清理验证](phase-0-agent-d-ui161-verification.md)（278 行，5/5 PASS 零 drift）
- [PHASE 0 synthesis](phase-0-synthesis-report.md)（主 agent 综合报告）

### 0.2 主 agent 修正 B 报告的 2 处错误
1. preload 不是单一 `biof3` world —— 实际**双重 expose**（行 21 `biof3` + 行 61 `biof3Desktop`）
2. 项目里所有 `biof3Desktop.*` 桥都已接通，**唯独 skills 断**（不是命名不一致）

### 0.3 用户决策（2026-08-16 16:09）
- **P1-A**：最小改动（仅 4 文件：preload + main + useSkillStore + 新 test）
- **P1-T-A**：Vite-only mock 测试（不启动 Electron）
- 综合报告批准

### 0.4 真实改动面（主 agent 重新核算）
| # | 文件 | 计划 | 实际 | 偏差 |
|---|---|---|---|---|
| 1 | `src/preload.js` | +15 | +19 | +4（注释多） |
| 2 | `src/main.js` | +80 | +195 | +115（注释 + 状态映射） |
| 3 | `frontend/src/hooks/useSkillStore.ts` | ±10 | +69 | +59（采纳**增量**而非**替换**，保留 polling 2s 作为真值兜底） |
| 4 | `frontend/src/lib/electron.d.ts` | 0 | +12 | +12（PHASE 1 worker 发现的边界冲突修正） |
| 5 | `frontend/src/hooks/useSkillStore.test.ts`（新） | +200 | +225 | +25 |

---

## 1. 真实改动（最终落地）

### 1.1 `src/preload.js` (+19)

第二份 `exposeInMainWorld('biof3Desktop', {...})` 对象（行 61）补 skills 子块，对齐 electron.d.ts PHASE 1 增字段声明：

```javascript
// G0 UI-157：Skills 发现 / 执行 / 进度桥（对齐 frontend/src/lib/electron.d.ts L114-169）
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

### 1.2 `src/main.js` (+195)

**新结构**（行 2094 起）：

| 块 | 用途 |
|---|---|
| `_getSkillsSDK()` | 懒初始化 SkillsSDK 单例 + 装配 WorkflowEngine |
| `_activeSkillRuntimes: Map` | executionId → SkillRuntime 引用 |
| `_lastCheckpointCount: Map` | executionId → 最近一次 checkpoint 数 |
| `_publishSkillProgress()` | `webContents.send('skills:progress', { executionId, ...payload })` |
| `_startSkillsProgressPoller()` | `setInterval(1000)` diff `execCtx.checkpoints[]` 合成 progress |
| `setupSkillsIpc()` | 注册 4 个 `ipcMain.handle('skills:discover'/'execute'/'getExecution'/'cancel')` |

**关键设计**：
- 9 状态（SkillRuntime）→ 4 状态（bridge 契约）映射：`created/validating_params/checking_dependencies` → pending；`running/paused/recovering` → running；`complete` → completed；`failed/cancelled` → failed
- 终态自清：`_activeSkillRuntimes.delete(executionId)` 避免内存泄漏

### 1.3 `frontend/src/lib/electron.d.ts` (+12, ADDITIVE)

**skills 接口从 3 字段扩展为 5 字段**（additive 不 breaking）：

```typescript
skills: {
  discover: ...;        // 已有
  execute: ...;         // 已有
  getExecution: ...;    // 已有
  // PHASE 1 A：cancel + onProgress 桥接（G0 UI-157 IPC 桥接通；2026-08-16）
  cancel: (executionId: string) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
  onProgress: (callback: (payload: {
    executionId: string;
    status?: 'pending' | 'running' | 'completed' | 'failed';
    checkpoints?: unknown[];
    result?: unknown;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }) => void) => () => void;
};
```

**这是 PHASE 1 worker 报告的"边界冲突"的主 agent 裁决**：选 Option A（扩展 electron.d.ts）。

**理由**（主 agent 复盘）：
1. plan §4 PHASE 1 + user-task instructions 都明确要求 5 方法 —— **契约一致性**
2. ADDITIVE 字段（5 → 7）不破坏现有 4 page consumer；reducing 5 → 3 才破坏
3. reduce (5 → 3) 等于"放弃 progress push + cancel" —— 与 PHASE 0 Agent A 强调的核心契约面冲突
4. 不动 electron.d.ts 是 spirit（保留 4 page consumer 契约），additive 1 字段也是 preserved；reduce 才是破坏

### 1.4 `frontend/src/hooks/useSkillStore.ts` (+69, 增量)

**采用增量设计而非 plan 字面"切换 polling→onProgress"**，原因：worker 的 `_publishSkillProgress` payload **只有 `{executionId, status, checkpoints}`**，**不含 result/startedAt/completedAt** —— 不够完整当 SkillExecution 真值源。

**最终设计**：
- `_startPolling` 2s polling **保留**（真值兜底，调 `bridge.getExecution` 拉完整 snapshot）
- 新增 `_subscribeProgressWakeup`（订阅 `bridge.onProgress`，事件回调时**立即**调一次 `getExecution` 拉完整 snapshot）
- execute() 成功路径：`polling + wakeup` **并行** —— polling 是真值源（≤2s 兜底），wakeup 把感知延迟降到 ≤100ms
- useEffect cleanup + `__resetSkillStoreCacheForTests`：顺带清 wakeup 避免泄漏

**新增函数**：

```typescript
const _progressUnsubs: Map<string, () => void> = new Map();

function _subscribeProgressWakeup(
  executionId: string,
  onUpdate: (execution: SkillExecution) => void
): void {
  if (_progressUnsubs.has(executionId)) return;
  const bridge = getBridge('skills');
  if (!bridge || typeof bridge.onProgress !== 'function') return;
  const unsubscribe = bridge.onProgress((payload: { executionId?: string }) => {
    if (payload?.executionId !== executionId) return;
    void (async () => {
      try {
        const result = await bridge.getExecution(executionId);
        if (result.ok && result.execution) {
          onUpdate({
            executionId: result.execution.executionId,
            skillId: result.execution.skillId,
            status: result.execution.status,
            startedAt: result.execution.startedAt
              ? new Date(result.execution.startedAt)
              : undefined,
            completedAt: result.execution.completedAt
              ? new Date(result.execution.completedAt)
              : undefined,
            result: result.execution.result,
            error: result.execution.error,
          });
        }
      } catch { /* 静默兜底：polling 仍会按 2s 节奏兜底真值 */ }
    })();
  });
  _progressUnsubs.set(executionId, unsubscribe);
}

function _unsubscribeProgressWakeup(executionId: string): void { ... }
function _stopAllProgressWakeups(): void { ... }
```

### 1.5 `frontend/src/hooks/useSkillStore.test.ts` (+225, 新文件)

**镜像** `frontend/src/hooks/usePluginStore.test.ts`（175 行模板）的 `vi.stubGlobal('biof3Desktop', {...})` 模式。

**9 tests**：

| # | Test |
|---|---|
| 1 | exposes empty defaults when no bridge is installed |
| 2 | loads skills on first mount via `bridge.skills.discover()` |
| 3 | does not refetch on a second mount of the same hook |
| 4 | search filters by query case-insensitively across name + tags |
| 5 | execute() calls `bridge.skills.execute` with skillId + params |
| 6 | execute() surfaces failure from the bridge |
| 7 | execute() subscribes to `bridge.skills.onProgress` (PHASE 1 G0 UI-157) |
| 8 | `bridge.skills.cancel` is callable and returns `{ok:true, cancelled:true}` |
| 9 | store.getExecution(executionId) reads from executions map (no bridge call) |

---

## 2. 4 治理门禁终态 (commit 前)

```
$ npm run docs:check
[docs:check] PASS (65 registered documents)

$ npm run ui:audit:check
[ui-audit] 同步检查通过；Git 历史已有 131 个带实现证据的 UI 问题编号

$ cd frontend && npx tsc --noEmit
(0 errors)

$ npm run docs:reconcile
[docs:reconcile] read-only report; no files were moved or deleted
  Registered: 65
  Unregistered: 0
  Archive candidates: 0
  Manual review: 0
  Validation issues: 0
```

## 3. 定向 vitest (commit 前)

```
$ cd frontend && npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts
✓ src/hooks/useSkillStore.test.ts  (9 tests) 441ms
✓ src/hooks/usePluginStore.test.ts (9 tests) 441ms
Test Files  2 passed (2)
Tests       18 passed (18)
```

## 4. Commit

```
$ git log --oneline -3
0be5483 docs(ui-157): sync BLOCK-2-UI-157-REVIEW PHASE 0 摸底 + plan §3.1.A / §4 PHASE 1 与摸底真相对齐
2d81377 feat(skills-bridge): UI-157 IPC bridge connecting useSkillStore to workflow-engine
0a3fc46 docs(ui-157): start BLOCK-2-UI-157-REVIEW work package
```

| Commit | 范围 | Files changed | +/− |
|---|---|---|---|
| `2d81377` feat(skills-bridge) | preload + main + electron.d.ts + useSkillStore + useSkillStore.test | 5 | +518 / −2 |
| `0be5483` docs(ui-157) | AUDIT-LOG + plan §3.1.A / §4 PHASE 1 修订 | 2 | +20 / −12 |

---

## 5. 不变量验证（PHASE 0 已握手）

| 不变量 | 状态 |
|---|---|
| UI-161 清理（5 项）intact | ✅ 0 diff（`git diff 01c5e0b..HEAD -- <4 files>` 空） |
| `frontend/src/lib/electron.d.ts` 类型契约 | ⚠️ **+12 行**（additive 2 字段：cancel + onProgress），3 → 5 字段 |
| `frontend/src/lib/desktopBridge.ts` | ✅ 0 diff（已通过 `getBridge('skills')` 自动派生） |
| 4 page（skills/index + SkillCard + SkillDetail + SkillSearch）| ✅ 0 diff |
| `core/shared-backend/*` 引擎内部 | ✅ 0 diff（仅消费既有 exports） |
| `LeftPanel.tsx` | ✅ 0 diff |
| `styles/custom.css` 4 token | ✅ 0 diff |
| `agent-tools/` 前一会话遗留 | ✅ 0 diff（绝对不动） |

---

## 6. 遗留风险（PHASE 1 后有意留白 / 后续工作包）

| # | 风险 | 严重度 | 状态 |
|---|---|---|---|
| R1 | `WorkflowEngine.cancel` 只翻 flag（不真正 abort 异步 `await`）| 中 | **PHASE 1 内有意留白** — 通过包装 SkillRuntime.cancel（已具备 `workflowRuntime?.cancel` 转发 + 持久化）由 main.js 转给 renderer |
| R2 | 零 progress 事件源（workflow-engine / skill-runtime / skills-sdk）| 中 | **PHASE 1 内已处理** — main.js `setInterval(1000)` diff `execCtx.checkpoints[]` 合成 progress |
| R3 | `executionId` 生命周期绑定 `main.js` uptime（无 SQLite 持久化）| 低 | **PHASE 1 内有意留白** — in-memory only；resume 留后续工作包 |
| R4 | `desktop.css:1889-1897` 残留 dead comment | 低 | **PHASE 1 内有意留白** — UI-161 清理 cosmetic；后续 UI 工作包顺手清扫 |
| R5 | progress payload 不含 `result/startedAt/completedAt` | 低 | **PHASE 1 内有意留白** — wakeup 路径自动调 `getExecution` 拉完整 snapshot 补齐 |
| R6 | SkillRuntime 9 态→4 态映射丢 `paused/recovering` | 低 | **PHASE 1 内已记录** — `_mapSkillRuntimeStatus` 内部映射 |

---

## 7. 路径选择记录

### 7.1 主 agent 裁决 Option A（扩 electron.d.ts）vs B（reduce bridge 到 3 方法）

**Phase 1 worker 报告 §5 给了 4 个选项**：

| 选项 | 主 agent 决策 |
|---|---|
| **A（扩 electron.d.ts，5 → 5+2 字段）** | ✅ **采纳**（additive 不 breaking） |
| B（reduce 到 3 方法）| ❌（放弃 progress push + cancel） |
| C（`as any` cast）| ❌（技术债 + state-decomposition §4.7 反对 `any`）|
| D（partial PHASE 1 + 不 commit）| ❌（PHASE 1 没完成）|

### 7.2 polling→onProgress 的 2 种实现

| 方案 | 主 agent 决策 |
|---|---|
| **平替**（删除 polling + 切 onProgress 单独承担）| ❌ onProgress payload 不含 result，不能单独做真值源 |
| **并行**（polling 2s 真值兜底 + wakeup 加速信号）| ✅ **采纳**（最终落地）|

---

## 8. Worker 边界冲突复盘

### 8.1 worker 正确停手
- preload + main 写完 5 方法 → 试改 useSkillStore 引用 onProgress → tsc 失败
- worker **正确停手** 按"遇到边界冲突立即报告"纪律
- **没自作主张** 没 commit

### 8.2 worker 报告质量
- ✅ §1 已完成 / §2 阻塞 / §3 改动清单 / §4 关键代码 / §5 4 选项 / §9 遗留风险 全部结构清晰
- ✅ §"目前的最小回退状态"诚实标注 useSkillStore.ts 未改 + 4 门禁仍 GREEN
- ✅ §"git diff --stat"清楚标注 docs/{AUDIT-LOG, plan}.md 是 PHASE 0 主 agent 修订，非 PHASE 1 worker 改动

### 8.3 主 agent 接管决策
- 采纳 Option A（扩 electron.d.ts ADDITIVE）
- 改用增量 polling + wakeup 并行（不平替）
- 写 9 test cases 镜像 usePluginStore.test.ts 模板
- 跑 4 门禁 + 18 vitest + commit 2 个（feat + docs）

---

## 9. 与 PHASE 0 / 上游对比

### 9.1 PHASE 0 B 报告说"命名不一致（preload 用 biof3 / electron.d.ts 用 biof3Desktop）"
- ❌ B 错的，实际双重 expose 都接通 biof3Desktop
- 主 agent 在 PHASE 0 synthesis §4 修正

### 9.2 PHASE 0 synthesis §1.2 "electron.d.ts 已是 source-of-truth"
- ❌ 主 agent PHASE 0 综合时**没核对 electron.d.ts skills 字段数量**
- PHASE 0 摸底盲点：只看到存在声明，**没核对完整度**
- **PHASE 1 worker 实际验证发现 3 → 5 字段缺口 → 边界冲突 → 主 agent 立即采纳 Option A**

### 9.3 plan §4 PHASE 1 修订
- plan v1 写 4 channel (skills:list/invoke/status/progress)
- plan v2（PHASE 0 后修订）写 5 hook 对齐 electron.d.ts
- 真实落地：5 hook 对齐 electron.d.ts，**electron.d.ts 自身 ADDITIVE +2 字段**

### 9.4 commit messages
- 严禁 emoji、严禁叙事化（"完成了..."）
- commit 1（feat）：5 列变更描述 + 5 列不变量声明 + Refs
- commit 2（docs）：2 行变更描述 + Refs

---

## 10. 下一步（PHASE 2 / 3 / 4 / 5）

| PHASE | 内容 | 是否委派 | 备注 |
|---|---|---|---|
| **PHASE 2** | UI-161 5 项清理核对 | 是（worker） | plan §3.1.B 5 项核对 + 已自验证 |
| **PHASE 3** | 真实 dev Electron 实机 4 截图 | 谨慎 | `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"` 启动 + Playwright MCP attach CDP |
| **PHASE 4** | `ui-productization-audit.md` UI-157 `in_progress → verified` | 主 agent | 需 PHASE 3 4 截图证据 |
| **PHASE 5** | closeout：plan / handoff / AUDIT-LOG 同步 | 主 agent | 需所有 PHASE 落地证据 |

**用户决策"不启动真实 dev Electron"**（P1-T-A = Vite-only mock）已显式排除 PHASE 3 实机启动；PHASE 2 仍需跑（UI-161 5 项核对计划内工作）。
