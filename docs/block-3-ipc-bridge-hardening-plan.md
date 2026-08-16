# BLOCK-3 IPC 桥硬化：UI-157 IPC 桥 12 项 Major 安全 + 契约 + 测试收口

**最后更新**：2026-08-16
**状态**：`active`（2026-08-16 用户裁决启动）
**Plan ID**：`BLOCK-3-IPC-BRIDGE-HARDENING`

---

## 1. 决策与定位

BLOCK-2-UI-157-REVIEW 工作包 PHASE 6 只读代码质量审核（commit `eaa90da` AUDIT-LOG 登记 + 报告 `agent-transcripts/phase-6-code-audit.md` 1001 行）发现 PHASE 1 commit `2d81377` 落地 5 文件（preload.js +19 / main.js +195 / electron.d.ts +12 / useSkillStore.ts +69 / useSkillStore.test.ts 225）的 12 项 Major + 15 Minor + 4 Nit。**4 治理门 + 18 vitest + tsc 仍全 GREEN，无 P0 Blocker**。

本工作包收口 12 项 Major 中的 **P1 必修 + P2 强烈建议**（9-10 项），跳过 P3 性能 / E1（100 并行 execution 在 G0 边界内不会触发，记录为后续工作包候选）。

### 1.1 修复范围

| 优先级 | ID | 类别 | 摘要 | 必修度 |
|---|---|---|---|---|
| **P1 安全** | B1/F1 | 安全 | main.js 4 IPC handler 无 sender 守门 | **必修** |
| **P1 契约** | C1 | 契约违反 | main.js poller L2143 publish `execCtx.status` 是 SkillRuntime 9 状态，未映射 4 状态 | **必修** |
| P2 测试 | G1 | 测试覆盖 | test 7 仅验 `onProgress.toHaveBeenCalled()`，未验 wakeup 触发后 store 写入 | 应修 |
| P2 测试 | G2 | 测试覆盖 | execute() 失败时 polling 启动验证缺失 | 应修 |
| P2 测试 | G3 | 测试覆盖 | onProgress callback 抛错测试缺失 | 应修 |
| P2 测试 | G4 | 测试覆盖 | cancel() 失败路径测试缺失 | 应修 |
| P2 测试 | G6 | 测试覆盖 | main.js 9→4 状态映射单测缺失 | 应修 |
| P2 内存 | A1 | 边界 race | useSkillStore 终态未清 onProgress 订阅 | 应修 |
| P2 内存 | A2 | 内存 | main.js `_startSkillsProgressPoller` 启动后无停止机制 | 应修 |
| P2 内存 | A3 | 边界 race | execute 终态 publish 与 `_activeSkillRuntimes.delete` 不同步 | 应修 |
| P2 错误 | B2 | 错误处理 | `_publishSkillProgress` 无独立 try/catch | 应修 |

**跳过**（按 §"smallest sufficient validation scope" + G0 边界）：

| ID | 类别 | 摘要 | 暂不修理由 |
|---|---|---|---|
| E1 | 性能 | 100 并行 execution × 1s poller | G0 边界内不会触发 |
| Minor 15 + Nit 4 | 优化 | 一组低优先级优化 | 留后续工作包 |

---

## 2. 排除项

- **不改**：preload.js（5 方法签名已 OK，P1 必修 B1/F1 守门在 main.js 一侧）
- **不改**：electron.d.ts（additive +2 字段已对齐 PHASE 1 设计，PHASE 6 复核契约 OK）
- **不改**：4 page（SkillCard / SkillDetail / SkillSearch / index）consumer
- **不改**：desktopBridge.ts（自动派生 `getBridge('skills')` 已 OK）
- **不改**：core/shared-backend/*（仅消费既有 exports）
- **不外推**：packaged / Provider / P7 / GA
- **不外推**：UI-157 → verified 升级路径（按 audit 行 402 治理纪律仍需真实 dev Electron 实机证据）
- **不重新激活**：BLOCK-2-UI-157-REVIEW（已 `status: completed`）

---

## 3. PHASE 划分

### PHASE 0：摸底（已在 PHASE 6 报告中完成）

- ✅ `agent-transcripts/phase-6-code-audit.md` 1001 行 / 12 节
- ✅ 主 agent 复核 B1/F1 + C1 + A3 行号 100% 验证
- ✅ 4 治理门基线复跑 GREEN（docs:check 66 / ui:audit:check 131 / tsc 0 / docs:reconcile 0）
- ✅ 18 vitest 基线 PASS（useSkillStore 9 + usePluginStore 9）

PHASE 0 不重新启动摸底，复用 PHASE 6 报告。

### PHASE 1：P1 必修（2 项）

**目标**：修 B1/F1 + C1，跨 1 文件（main.js）。

#### 1.1 B1/F1 sender 守门

对照 `setupAgentWorkbenchFlagsIpc()` L1162 守门模式：

```js
function setupAgentWorkbenchFlagsIpc() {
  ipcMain.handle(AGENT_WORKBENCH_FLAG_CHANNEL, (event, value) => {
    if (event?.sender !== mainWindow?.webContents) return { ok: false, extraRenderers: agentWorkbenchFlags.extraRenderers, error: 'unauthorized' };
    // ...
  });
}
```

抽取 `resolveSkillsIpc(event)` 工具函数，对 4 handler 守门：

```js
function _resolveSkillsIpcWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return event?.sender === mainWindow.webContents ? mainWindow : null;
}

ipcMain.handle("skills:discover", async (event) => {
  if (!_resolveSkillsIpcWindow(event)) return { ok: false, error: "unauthorized" };
  // ...
});
```

4 handler 全部加守门。**`unauthorized` 错误文案对齐 `setupAgentWorkbenchFlagsIpc` 模式**。

#### 1.2 C1 poller 9→4 状态映射

`main.js` L2143 poller publish：

```js
// 当前（9 状态原始）
_publishSkillProgress(executionId, {
  status: execCtx.status,
  checkpoints: checkpoints.slice(),
});

// 改后（4 状态映射）
_publishSkillProgress(executionId, {
  status: _mapSkillRuntimeStatus(execCtx.status),
  checkpoints: checkpoints.slice(),
});
```

`skills:execute` L2194-2203 终态 publish（已经传 4 状态字符串 "complete"/"failed"，不需改）。

### PHASE 2：P2 修复（8-9 项）

#### 2.1 A3 execute 终态 publish 与 `_activeSkillRuntimes.delete` 同步

**当前**：execute 行 2206-2212 publish 完成后 `_activeSkillRuntimes.delete` 由 poller 下一 tick 自然发生（最坏 1s 延迟）。

**改后**：execute 终态分支立即 `delete` + `_lastCheckpointCount.delete`。

#### 2.2 A2 poller 停止机制

**当前**：`_startSkillsProgressPoller()` 单例 timer 启动后无停止。

**改后**：每个 poller tick 检查 `_activeSkillRuntimes.size === 0` → clearInterval + `_skillsProgressTimer = null`。

#### 2.3 A1 useSkillStore 终态未清 onProgress 订阅

**当前**：`_startPolling` 终态分支未调 `_unsubscribeProgressWakeup`，仅 useEffect unmount 兜底。

**改后**：终态（complete/failed）写入 store 后同步调 `_unsubscribeProgressWakeup(executionId)`。

#### 2.4 B2 `_publishSkillProgress` try/catch

**当前**：直接 `mainWindow.webContents.send` 无 try/catch，webContents.send 抛错会冒泡到 poller tick catch。

**改后**：包 try/catch，失败时 console.warn + 不抛出。

#### 2.5 G1 wakeup 链路测试

补 vitest 测试：

```js
it("wakeup 触发后 store 写入对应 executionId + status", async () => {
  // mock bridge.onProgress callback 调用 store.setExecutionSnapshot
  // 验证 store.executions.get(id)?.status === 'running'
});
```

#### 2.6 G2 execute() 失败时 polling 启动验证

补测试：`execute()` 返回 `{ ok: false, ... }` 时 polling 不启动。

#### 2.7 G3 onProgress callback 抛错

补测试：mock callback 抛错，store 不崩 + polling 继续。

#### 2.8 G4 cancel() 失败路径

补测试：`cancel("nonexistent_id")` 返回 `{ ok: false, ... }` 时 store 不变。

#### 2.9 G6 main.js 9→4 状态映射单测

导出 `_mapSkillRuntimeStatus`（如未导出）+ 9 状态枚举单测。

### PHASE 3：审计收口

- `docs/ui-productization-audit.md` 末尾追加 BLOCK-3 工作包收口笔录
- `docs/AUDIT-LOG.md` 顶部最后更新 + 收口条目
- **不升 UI-157 verified**（按 audit 行 402 治理纪律仍缺真实 dev Electron 实机证据；本工作包只补 PHASE 6 发现的硬冲突）

### PHASE 4：closeout

- 4 canonical 文档同步
- DOC-REGISTRY `BLOCK-3-IPC-BRIDGE-HARDENING` `active → completed`
- 新增 `BLOCK-3-IPC-BRIDGE-HARDENING-CLOSEOUT` reference entry
- closeout 报告 `docs/block-3-ipc-bridge-hardening-closeout.md`

---

## 4. 验收门禁

| # | 命令 | 必跑 | 频率 |
|---|---|---|---|
| 1 | `npm run docs:check` | ✅ | PHASE 3 / 4 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ | PHASE 3 / 4 commit 前 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ | PHASE 1 / 2 commit 前 |
| 4 | `npm run docs:reconcile` | ✅ | PHASE 4 commit 前 |
| 5 | `cd frontend && npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts src/hooks/usePluginStore.*` | ✅ | PHASE 1 / 2 commit 前 |

**不跑**：`npm run check` / `npm run test:all:workspace`（默认不跑，留 G1+ / 发布前 / CI）。

**不外推**：packaged / Provider / P7 / GA 实测（按 `qualificationEligible: false` 永久 G0 事实）。

---

## 5. 完成语义

- **PHASE 1 / 2 / 3 / 4 全部落地**：4 治理门 GREEN + 18+ vitest PASS（定向） + tsc 0 错误
- **9-10 项 Major 修复**：B1/F1 + C1 + A1 + A2 + A3 + B2 + G1 + G2 + G3 + G4 + G6（+G6 = 11 项，G6 +2 vitest）
- **UI-157 保持 `in_progress`**：本工作包不升级 verified
- **不变量守住**：UI-161 5/5 intact / `desktopBridge.ts` 0 diff / 4 page 0 diff / `core/shared-backend/*` 0 diff / `agent-tools/` 0 diff / `electron.d.ts` 0 diff

---

## 6. 与上游工作包关系

- **BLOCK-2-UI-157-REVIEW**（已完成）：PHASE 6 审核为本工作包源头
- **DOC-GOVERNANCE-GATES**（已完成）：本工作包计划复用其入口管理规范
- **G0 LF12 Baseline**（已完成）：本工作包不触动 LF12 边界

---

## 7. PHASE 1 / 2 工作模式

**PHASE 1**（P1 必修 2 项）：主 agent 直接做（边界清晰，1 文件 ~5 行改动 + 1 行）

**PHASE 2**（P2 修复 8-9 项）：worker 委派边界清晰测试任务（5 文件 / +150 行 / 11 项修复）
