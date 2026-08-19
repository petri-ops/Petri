# BLOCK-12-MINOR-NIT-CLEANUP 工作包收口

**日期**：2026-08-18
**作者**：BLOCK-12-MINOR-NIT-CLEANUP worker
**范围**：BLOCK-2 PHASE 6 只读代码审核 (`agent-transcripts/phase-6-code-audit.md`) §10.2 Minor + §10.3 Nit 范围内涉及的 8 项预先已修复的 minor/nit 问题的**核实性收口**
**任务定位**：本工作包为 **verification-only** —— 在执行前对源文件逐项 grep 验证，发现 8 项均已在前序 BLOCK-3/4/5 修复落地；本工作包无需新增代码修复，专注于验证 + 文档登记 + 治理门复跑

---

## 1. 执行摘要

### 1.1 核心结论

| 维度 | 结论 |
| --- | --- |
| 8 项 minor/nit 落实状态 | **全部已在前序 BLOCK-3/4/5 修复**（commit history `git log --oneline` 可见 BLOCK-3/BLOCK-4/BLOCK-5 commits） |
| 待修代码 | **0 行**（本工作包无代码改动） |
| 新增 commit | **0 个**（verification-only，无 commit 产出） |
| 治理门禁 | `docs:check` ✅ PASS（122 registered documents） / `tsc --noEmit` ✅ 0 错 / `useSkillStore` vitest ✅ 14/14 / `_mapSkillRuntimeStatus` node --test ✅ 14/14 |
| 预存 UI 漂移 | `ui:audit:check` 报告 4 项 pre-existing drift（d9906fd/d08d8b1/c271010/e40313e，属 BLOCK-11 mac-fullscreen + branch-result-studio + copilot-chat 提交），与本工作包无关；本工作包 0 新增 drift |

### 1.2 8 项落实矩阵

| # | ID | 文件 | 阶段 | 修复 commit 锚 | 核实结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | **B2** | `src/preload.js` `onProgress` callback try/catch | BLOCK-4 | （BLOCK-4 B5 提交，commit history 可见） | ✅ 已在 lines 268-281 包裹 try/catch（BLOCK-4 B5 注释） |
| 2 | **C2** | `src/preload.js` 注释 L114-218 | BLOCK-4 | （BLOCK-4 C3 提交） | ✅ 已在 line 256 标注 `L114-218`（BLOCK-4 C3 注释） |
| 3 | **E2** | `useSkillStore._executionsChanged()` deep-equal | BLOCK-4 | （BLOCK-4 E2 提交） | ✅ 已在 lines 331-340 实现 status / completedAt / error / result / startedAt 字段比较 |
| 4 | **E3** | `main.js` `execute()` 失败路径 `_lastCheckpointCount.delete` | BLOCK-3 | （BLOCK-3 P2 A3 提交） | ✅ 已在 lines 884-886 失败 try/catch 块同步清 `_activeSkillRuntimes` + `_lastCheckpointCount` |
| 5 | **F2** | `main.js` `_resolveSkillsIpcWindow` null 守门 | BLOCK-3 | （BLOCK-3 P1 B1/F1 提交） | ✅ 已在 lines 821-825 实现；后续 4 个 IPC handler 全部使用 helper 守门 |
| 6 | **H1** | `docs/block-2-ui-157-review-plan.md` §3.1.A `L114-150` → `L114-218` | BLOCK-5 | （BLOCK-5 PHASE 1 修订） | ✅ 已在 plan L51/L123/L274-276 修复 |
| 7 | **H2** | `src/main.js` setupSkillsIpc 顶部注释加 9→4 映射行号 | BLOCK-4 | （BLOCK-4 H3 提交） | ✅ 已在 lines 737-740 标注 `9 状态 → UI 4 状态 + 映射表见 src/_mapSkillRuntimeStatus.js` |
| 8 | **F3** | `main.js` 4 IPC handler sender 守门 | BLOCK-3 | （BLOCK-3 P1 B1/F1 提交） | ✅ 4 个 handler（discover/execute/getExecution/cancel）全部以 `_resolveSkillsIpcWindow(event)` 守门 |

### 1.3 G0 阶段纪律遵守

- ✅ 不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+（本工作包 0 G1+ 提及）
- ✅ 不修改 `electron.d.ts` / `desktopBridge.ts` / `preload.js` 顶层 5 方法签名（按不变量）
- ✅ 不修改 4 page 组件（按不变量）
- ✅ 不引入 ajv / zod / lru-cache 等新依赖（verification-only 无新增）
- ✅ 不预先启动 BLOCK-13 / observability / rserver-http / SSE 等后续候选
- ✅ 收口笔录使用"dev Electron 边界内 verified" / G0 阶段纪律用语（按 audit 行 402 治理纪律）

---

## 2. 8 项详细核实记录

### 2.1 B2 — preload.js `onProgress` callback try/catch

**目标**：audit §3.5 B5（用户在任务中标记为 B2）—— `preload.js` onProgress callback 抛错无 try/catch 防御。

**核实证据**（`src/preload.js` lines 268-281）：

```javascript
onProgress: (callback) => {
  if (typeof callback !== 'function') return () => {};
  // BLOCK-4 B5: callback 抛错 try/catch 隔离，避免污染后续 progress 事件链
  const handler = (_event, payload) => {
    try {
      callback(payload);
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[preload] skills:progress callback error:', e && e.message);
      }
    }
  };
  ipcRenderer.on('skills:progress', handler);
  return () => ipcRenderer.removeListener('skills:progress', handler);
},
```

**结论**：✅ 已在 BLOCK-4 修复。

---

### 2.2 C2 — preload.js 注释 L114-218

**目标**：audit §4.3 C3（用户在任务中标记为 C2）—— `preload.js` 注释引用 `L114-169` 偏差。

**核实证据**（`src/preload.js` lines 256-257）：

```javascript
// BLOCK-4: 对齐 frontend/src/lib/electron.d.ts L114-218（PHASE 1 落地后 d.ts
// 扩展为 ADDITIVE +2 字段 cancel + onProgress，C3 修正原注释 L114-169 偏差）
```

**配套核实**（`frontend/src/lib/electron.d.ts` lines 173-184）：
- `cancel(executionId)` 字段 in line 174
- `onProgress(callback)` 字段 in lines 176-184
- `skills` 块起点与 plan 文档一致（L114）

**结论**：✅ 已在 BLOCK-4 修复。

---

### 2.3 E2 — useSkillStore `_executionsChanged()` deep-equal

**目标**：audit §6.2 E2（用户在任务中标记为 E2）—— polling 与 wakeup 并行真值冗余，setExecutions 总新建 Map 触发 re-render。

**核实证据**（`frontend/src/hooks/useSkillStore.ts` lines 331-340）：

```typescript
// BLOCK-4 E2: deep-equal 比较，避免无变化 re-render；返回 true 表示有变化
function _executionsChanged(prev: SkillExecution, next: SkillExecution): boolean {
  if (prev === next) return false;
  if (prev.status !== next.status) return true;
  if (prev.completedAt?.getTime() !== next.completedAt?.getTime()) return true;
  if (prev.error !== next.error) return true;
  if (prev.result !== next.result) return true;
  if (prev.startedAt?.getTime() !== next.startedAt?.getTime()) return true;
  return false;
}
```

**核实落地**（`setExecutions` 在 5 处内置比较：lines 565-573 / 586-595 / 599-607 / 611-619 / 631-639 / 650-658）：
- 每次 `setExecutions((prev) => { const existing = prev.get(executionId); if (existing && !_executionsChanged(existing, ...)) return prev; ... })` 先比较再 new Map
- 无变化场景返回 `prev` 引用，React 跳过 re-render

**结论**：✅ 已在 BLOCK-4 修复。

---

### 2.4 E3 — main.js `execute()` 失败路径 `_lastCheckpointCount.delete`

**目标**：audit §2.3 A3 / §10.3 #1 A4（用户在任务中标记为 E3）—— `execute()` 失败路径 end-of-runtime 清理 `_lastCheckpointCount.delete` 缺失。

**核实证据**（`src/main.js` lines 878-889）：

```javascript
.catch((err) => {
  _publishSkillProgress(executionId, {
    status: "failed",
    checkpoints: [],
    error: err && err.message ? err.message : String(err),
  });
  // BLOCK-3 P2 A3: 失败终态同样立即清理
  _activeSkillRuntimes.delete(executionId);
  _lastCheckpointCount.delete(executionId);
  _stopSkillsProgressPollerIfIdle();
  throw err;
});
```

**配套核实**（成功路径 lines 873-875 同样清理）：
```javascript
_activeSkillRuntimes.delete(executionId);
_lastCheckpointCount.delete(executionId);
_stopSkillsProgressPollerIfIdle();
```

**结论**：✅ 已在 BLOCK-3 P2 A3 修复。

---

### 2.5 F2 — main.js `_resolveSkillsIpcWindow` null 守门

**目标**：audit §3.1 B1 / §7 F1（用户在任务中标记为 F2）—— `_handleSkillsExecute` (用户任务中标记为 F2) 调用 `_resolveSkillsIpcWindow` 但未处理返回值 null。

**核实证据**（`src/main.js` lines 821-825）：

```javascript
function _resolveSkillsIpcWindow(event) {
  // BLOCK-3 P1 B1/F1: 守 sender，对齐 setupAgentWorkbenchFlagsIpc L1162 模式
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return event?.sender === mainWindow.webContents ? mainWindow : null;
}
```

**配套核实**（4 个 IPC handler 全部以 `if (!_resolveSkillsIpcWindow(event)) return { ok: false, error: "unauthorized" };` 守门）：
- `skills:discover` line 830
- `skills:execute` line 842
- `skills:getExecution` line 907
- `skills:cancel` line 938

**结论**：✅ 已在 BLOCK-3 P1 B1/F1 修复。

---

### 2.6 H1 — `block-2-ui-157-review-plan.md` §3.1.A `L114-150` → `L114-218`

**目标**：audit §9 H1（用户在任务中标记为 H1）—— plan §3.1.A 未体现 +12 ADDITIVE。

**核实证据**（`docs/block-2-ui-157-review-plan.md`）：

```markdown
51:【PHASE 0 摸底后修订 / PHASE 1 实际落地（commit `2d81377` P1-1.3）】**`frontend/src/lib/electron.d.ts` L114-218（含 L207-218 onProgress 完整字段）已通过 ADDITIVE +2 字段扩展为 source-of-truth**（PHASE 1 落地新增 `cancel(executionId)` + `onProgress(callback)` 字段声明 +12 行 + JSDoc 注释）...

123:1. **`src/preload.js`**（最小改动 ~15 行）：在第二份 `contextBridge.exposeInMainWorld('biof3Desktop', {...})` 对象（行 61 起）补 `skills` 子块，对齐 `frontend/src/lib/electron.d.ts` L114-218（含 L207-218 onProgress 完整字段）已声明契约：`discover()` / `execute(skillId, params)` / `getExecution(executionId)` / `onProgress(callback)` / `cancel(executionId)`。

274:按 PHASE 6 只读代码质量审核报告 §10.3 H1 项，本节 §3.1.A 内 `electron.d.ts L114-150` 措辞**已在 BLOCK-5 PHASE 1 修订**：
276:- L51 / L123 两处 `L114-150` → `L114-218`（含 L207-218 onProgress 完整字段）
```

**结论**：✅ 已在 BLOCK-5 PHASE 1 修订。

---

### 2.7 H2 — `main.js` setupSkillsIpc 顶部注释加 9→4 映射行号

**目标**：audit §9 H3 / §10.4 #4（用户在任务中标记为 H2）—— `main.js` setupSkillsIpc 注释未显示 9→4 状态映射表。

**核实证据**（`src/main.js` lines 737-740）：

```javascript
// BLOCK-4 H3：SkillRuntime 9 状态 → UI 4 状态（pending/running/completed/failed）
//   状态映射表见 src/_mapSkillRuntimeStatus.js（独立模块，便于 plain Node 单测）；
//   cancelled 简化为 failed（4 状态枚举硬约束）；UI 区分"取消"vs"失败"由
//   下游组件按 status + cancelledFlag 渲染。
```

**配套核实**（`src/_mapSkillRuntimeStatus.js` 已独立提取）：BLOCK-3 PHASE 2 G6 提取到独立模块 + 14 测试 case 覆盖。

**结论**：✅ 已在 BLOCK-4 H3 修复。

---

### 2.8 F3 — main.js 4 IPC handler sender 守门

**目标**：audit §3.1 B1 / §7 F1（用户在任务中标记为 F3）—— 4 个 IPC handler 无 sender 守门。

**核实证据**：见 §2.5 节（4 handler 全部以 `_resolveSkillsIpcWindow(event)` 守门，lines 830 / 842 / 907 / 938）。

**结论**：✅ 已在 BLOCK-3 P1 B1/F1 修复。

---

## 3. 验证矩阵

### 3.1 治理门禁复跑

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 文档治理 | `npm run docs:check` | ✅ PASS（122 registered documents） |
| UI 审计 | `npm run ui:audit:check` | ⚠️ 4 pre-existing drift（与本工作包无关） |
| TypeScript | `cd frontend && npx tsc --noEmit` | ✅ 0 错误 |
| 文档对账 | `npm run docs:reconcile` | （未跑；按 G0 纪律 verification-only 阶段不必跑全量） |

### 3.2 定向测试

| 测试 | 命令 | 结果 |
| --- | --- | --- |
| `_mapSkillRuntimeStatus` 14 状态枚举 | `node --test test/_mapSkillRuntimeStatus.test.mjs` | ✅ 14/14 PASS |
| `useSkillStore` 集成 (含 E2 deep-equal 路径) | `cd frontend && npx vitest run src/hooks/useSkillStore.test.ts` | ✅ 14/14 PASS |

### 3.3 UI 审计 pre-existing drift 确认

`ui:audit:check` 报告 4 项 drift 已在 BLOCK-11 PHASE 1 SUB-1.2 / SUB-1.3 closeout entry（`docs/ui-productization-audit.md` 工作树新增）登记为 SUB-1.1 baseline 状态：

| commit | 标题 | 归属 |
| --- | --- | --- |
| `d9906fd` | fix(mac): add fullscreen button to custom traffic lights | BLOCK-11 mac-fullscreen |
| `d08d8b1` | refactor(mac): replace maximize with fullscreen in traffic lights | BLOCK-11 mac-fullscreen |
| `c271010` | feat(copilot-chat): SimpleChat UI + workspace panels + skills index | BLOCK-11 copilot-chat |
| `e40313e` | feat(branch-result-studio): branch context + result studio frontend + persistence layer | BLOCK-11 branch-result-studio |

**关联核实**：`git stash` 此类 BLOCK-11 UI 改动后基线仍同 4 项 drift（pre-existing，非 BLOCK-12 引入）。

**结论**：本工作包 0 新增 drift，4 项 pre-existing drift 已在 BLOCK-11 PHASE 1 记录。

---

## 4. 不外推

按 G0 阶段纪律（AGENTS.md 最高优先级）+ AGENTS.md "论据诚实"纪律：

- ✅ **不外推 G1+ 阶段事**：不提及 Provider / GA / 公证 / dist staleness / packaged / P7 / notarization 在本工作包留下任何"待做"语义。
- ✅ **不重新激活后续 BLOCK**：BLOCK-13+ / observability / rserver-http / SSE 三处协议统一 / RetryClassifier/RetryBudget/RetryExecutor 三套重试合并 / Agent Loop 事件规范化 / Result Studio 事件类型规范 等候选需用户显式裁决。
- ✅ **不修改 invariant 文件**：`electron.d.ts` / `desktopBridge.ts` / `preload.js` 顶层 5 方法签名 / 4 page 组件 0 diff（本工作包 0 改动）。
- ✅ **不引入新依赖**：0 npm 依赖新增 / 0 npm 依赖删除。
- ✅ **不预先启动 BLOCK-9.2-phase-7+ / BLOCK-10+ / BLOCK-11+ / BLOCK-12+ / BLOCK-13+** 等候选。

---

## 5. 累计指标

| 维度 | 数值 |
| --- | --- |
| 工作包 8 项 minor/nit 修复 | 8 / 8 已在前序 BLOCK-3/4/5 修复 ✅ |
| 本工作包代码改动 | 0 行 |
| 本工作包新增 commit | 0 个（verification-only） |
| 治理门禁 | 3 / 4 GREEN（docs:check / tsc / 定向测试；ui:audit:check 4 pre-existing drift 与本工作包无关） |
| `npm run check` | 未跑（按 G0 纪律默认不跑，verification-only 场景） |
| `npm run test:all:workspace` | 未跑（按 G0 纪律默认不跑） |
| invariant 文件 diff | 0 / 0（electron.d.ts / desktopBridge.ts / preload.js 顶层 5 方法 / 4 page 组件 全部 0 diff） |

---

## 6. 总结

### 6.1 核心结论

- **BLOCK-12-MINOR-NIT-CLEANUP 工作包为 verification-only 收口**：BLOCK-2 PHASE 6 只读代码审核报告 §10.2 Minor + §10.3 Nit 范围内涉及的 8 项 minor/nit 问题，**全部已在前序 BLOCK-3（B1/F1 + B2 + A3）/ BLOCK-4（B5 + C3 + E2 + H3）/ BLOCK-5（H1）修复落地**。
- 本工作包未发现新问题、未修复任何代码、未新增 commit、未引入新依赖。
- 治理门禁 3/4 GREEN（`docs:check` / `tsc` / 定向测试）；`ui:audit:check` 4 项 pre-existing drift 已在 BLOCK-11 PHASE 1 记录，与本工作包无关。
- 不外推 G1+ 阶段事项，不重新激活后续 BLOCK，不修改 invariant 文件。

### 6.2 后续交接

- 主 agent 接到本报告后：
  1. 复核 8 项落实矩阵（§1.2）与核实证据（§2）。
  2. 决定本工作包是否如约 verification-only 收口（无需新 commit）。
  3. 维持"单工作包串行"纪律，不在本工作包上添加新工作。
- 后续候选（按 G0 阶段纪律不主动推荐，需用户显式裁决）：BLOCK-13+ / observability / rserver-http-pack / SSE / Agent Loop 等。

---

**报告完**。
