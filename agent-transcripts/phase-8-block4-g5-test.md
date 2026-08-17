# BLOCK-4-IPC-BRIDGE-POLISH · PHASE 2 G5 unmount 验 _progressUnsubs 清空

**日期**：2026-08-16
**作者**：PHASE 2 worker
**任务**：落地 BLOCK-4-IPC-BRIDGE-POLISH plan §2 PHASE 2.1 唯一项 G5：useSkillStore.test.ts 补 unmount 后 `_progressUnsubs.size === 0` 断言
**范围**：2 文件 + 41 行（+41 / −0）
**不变量守住**：UI-161 5/5 / desktopBridge.ts 0 diff / electron.d.ts 0 diff / preload.js 0 diff / 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff

---

## 1. 实施摘要

### 1.1 路径选择

**选用候选 A**：导出 `__getProgressUnsubsSize(): number` module-level selector，测试直接读取 `_progressUnsubs.size` 推断 unmount 后是否清空。

### 1.2 文件改动

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `frontend/src/hooks/useSkillStore.ts` | 行 729-735（新增）+ 行 737-743（既有 `__resetSkillStoreCacheForTests` 保持原位） | 新增 `__getProgressUnsubsSize()` test-only export，复用既有 `_progressUnsubs` module-level Map |
| `frontend/src/hooks/useSkillStore.test.ts` | 行 3-8 import（+1 行）+ 行 426-456（新增 it 块） | import 新 export；新增 `it('G5: unmount clears _progressUnsubs via useEffect cleanup')` |

### 1.3 验证结果

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `npm run docs:check` | ✅ PASS（69 registered documents） |
| 2 | `npm run ui:audit:check` | ✅ PASS（131 UI 编号同步） |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PASS（0 错误） |
| 4 | `npm run docs:reconcile` | ✅ PASS（Registered 69 / Unregistered 0 / Archive 0 / Manual review 0 / Validation 0） |
| 5 | `cd frontend && npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts` | ✅ PASS（**23** / 23 = 14 useSkillStore + 9 usePluginStore） |
| 6 | `node --test test/_mapSkillRuntimeStatus.test.mjs` | ✅ PASS（14 / 14） |

**未跑**：`npm run check` / `npm run test:all:workspace` / packaged / Provider / P7 / GA（按 governance §"smallest sufficient scope" 默认不跑）。

---

## 2. 候选 A/B/C 选择理由

### 2.1 候选 A（采用）：export `__getProgressUnsubsSize()` selector

**理由**：

1. **一致性**：`useSkillStore.ts` 已存在 `__resetSkillStoreCacheForTests()`（行 737-743）—— test-only export 模式已建立；新增 selector 是顺延而非新模式
2. **显式优先**：断言 unmount 后 `__getProgressUnsubsSize() === 0` 直接对照内部 Map size，**无路径推断歧义**
3. **逻辑零修改**：`_progressUnsubs` Map 本身不动（PHASE 1 commit `8c627ab` 已实现 useEffect cleanup 行 467-473 → `_stopAllProgressWakeups()`），本 worker 仅添加 module-level getter
4. **避免 mock 推断**：候选 B 通过 `offProgress` mock 调用次数推断，对 mock 实现细节敏感（如 `progressCallbacks` Set 维护方式改变会破坏）；候选 A 只读 size，**与 mock 内部表示完全解耦**

### 2.2 候选 B（拒绝）：通过 bridge mock 推断

`installBridge` 中 `onProgress` mock 返回 `() => set!.delete(cb)`（行 89）。可以 mock 一个 `offProgress` 计数 — 但需要修改 `installBridge` 增加 `offProgress` 计数器，污染既有 13 个测试的 mock 形态。**对 mock 细节更敏感**。

### 2.3 候选 C（拒绝）：trust 已有 cleanup

直接 unmount 不验 — **违反 PHASE 6 G5 报告 §8 修复方向**（"unmount 后断言 `_progressUnsubs.size === 0`（需导出内部状态）"）。**未交付验收证据**。

---

## 3. 改动行号 + commit hash

### 3.1 commit hash

`5d4009ab8824462e7c7f298bcad352c793e8c4b0`

```
5d4009a test(skills-bridge): BLOCK-4 PHASE 2 G5 unmount 验 _progressUnsubs 清空
8c627ab feat(skills-bridge): BLOCK-4 PHASE 1 PHASE 6 剩余 11 项收口
1130b7a docs(sync): BLOCK-4-IPC-BRIDGE-POLISH 启动同步 2 canonical 文档
```

### 3.2 改动行号

`git show --stat 5d4009a`:

```
frontend/src/hooks/useSkillStore.test.ts | 33 ++++++++++++++++++++++++++++++++
frontend/src/hooks/useSkillStore.ts      |  8 ++++++++
2 files changed, 41 insertions(+)
```

**关键改动点**：

- `useSkillStore.ts` 行 729-735：新增 `export function __getProgressUnsubsSize(): number { return _progressUnsubs.size; }`
- `useSkillStore.ts` 行 737-743：既有 `__resetSkillStoreCacheForTests` 维持不变
- `useSkillStore.test.ts` 行 3-8 import 列表：新增 `__getProgressUnsubsSize`
- `useSkillStore.test.ts` 行 426-456：新增 `it('G5: unmount clears _progressUnsubs via useEffect cleanup')`

### 3.3 G5 测试逻辑

```typescript
it('G5: unmount clears _progressUnsubs via useEffect cleanup', async () => {
  const handles = installBridge();
  const { result, unmount } = renderHook(() => useSkillStore());
  await waitFor(() => expect(result.current.loading).toBe(false));

  // Sanity: no wakeup subscriptions registered before execute
  expect(__getProgressUnsubsSize()).toBe(0);

  await act(async () => {
    await result.current.execute('deg-analysis', {});
  });

  // execute() with result.ok + result.executionId must have registered
  // exactly one wakeup subscription via _subscribeProgressWakeup.
  expect(handles.onProgress).toHaveBeenCalled();
  expect(__getProgressUnsubsSize()).toBeGreaterThanOrEqual(1);

  // Unmount triggers the useEffect cleanup at line 467-473:
  //   return () => {
  //     _stopAllPolling();
  //     _stopAllProgressWakeups();
  //   };
  unmount();

  await waitFor(() => {
    expect(__getProgressUnsubsSize()).toBe(0);
  });
});
```

### 3.4 cleanup 路径已存在（PHASE 1 落地）

`useSkillStore.ts` 行 467-473：

```typescript
// Cleanup polling + progress wakeup subscriptions on unmount
useEffect(() => {
  return () => {
    _stopAllPolling();
    _stopAllProgressWakeups();
  };
}, []);
```

`_stopAllProgressWakeups()`（行 350-353）：

```typescript
function _stopAllProgressWakeups(): void {
  _progressUnsubs.forEach((unsub) => unsub());
  _progressUnsubs.clear();
}
```

G5 测试验证的就是这条路径：`unmount() → useEffect cleanup → _stopAllProgressWakeups() → _progressUnsubs.clear() → size === 0`。

---

## 4. 验证结果汇总

### 4.1 治理门禁（4/4 PASS）

| # | 命令 | 输出关键 | 结果 |
| --- | --- | --- | --- |
| 1 | `npm run docs:check` | `[docs:check] PASS (69 registered documents)` | ✅ |
| 2 | `npm run ui:audit:check` | `[ui-audit] 同步检查通过；Git 历史已有 131 个带实现证据的 UI 问题编号` | ✅ |
| 3 | `cd frontend && npx tsc --noEmit` | 0 错误 | ✅ |
| 4 | `npm run docs:reconcile` | `Registered: 69 / Unregistered: 0 / Archive candidates: 0 / Manual review: 0 / Validation issues: 0` | ✅ |

### 4.2 测试矩阵（37 PASS / 0 FAIL）

| 套件 | 工具 | 数量 | 结果 |
| --- | --- | --- | --- |
| useSkillStore.test.ts | vitest | **14**（+1 G5） | ✅ PASS |
| usePluginStore.test.ts | vitest | 9 | ✅ PASS |
| _mapSkillRuntimeStatus.test.mjs | node --test | 14 | ✅ PASS |
| **合计** | | **37**（23 vitest + 14 node --test） | ✅ |

> 22+1 vitest（22 既有 = 13 useSkillStore + 9 usePluginStore；+1 G5 新增）= 23 ✅

### 4.3 G5 新增测试执行轨迹

```
✓ src/hooks/useSkillStore.test.ts > useSkillStore > G5: unmount clears _progressUnsubs via useEffect cleanup
```

---

## 5. 边界纪律

### 5.1 不动文件清单

| 类别 | 文件 / 路径 | 状态 |
| --- | --- | --- |
| Electron 主进程 | `src/main.js` | ❌ 不动（PHASE 1 已 commit `8c627ab`） |
| Preload 脚本 | `src/preload.js` | ❌ 不动（PHASE 1 已 commit `8c627ab`） |
| IPC 桥类型 | `frontend/src/lib/electron.d.ts` | ❌ 不动 |
| IPC 桥封装 | `frontend/src/lib/desktopBridge.ts` | ❌ 不动 |
| 4 page 路由 | `frontend/src/pages/**/*.tsx` | ❌ 不动 |
| 后端 shared-backend | `core/shared-backend/*` | ❌ 不动 |
| agent-tools | `agent-tools/*` | ❌ 不动 |
| 已有测试 | `test/_mapSkillRuntimeStatus.test.mjs` / usePluginStore.test.ts | ❌ 不动 |

### 5.2 不修改 useSkillStore.ts 既有逻辑

| 段 | 行号 | 状态 |
| --- | --- | --- |
| `_progressUnsubs: Map<string, () => void> = new Map()` | 283 | ❌ 不改 |
| `_subscribeProgressWakeup` | 289-329 | ❌ 不改 |
| `_unsubscribeProgressWakeup` | 342-348 | ❌ 不改 |
| `_stopAllProgressWakeups` | 350-353 | ❌ 不改 |
| `useEffect(() => () => { _stopAllPolling(); _stopAllProgressWakeups(); }, [])` | 467-473 | ❌ 不改（PHASE 1 已落地） |
| `_executionsChanged` deep-equal | 332-340 | ❌ 不改（PHASE 1 E2 落地） |
| `__resetSkillStoreCacheForTests` | 737-743 | ❌ 不改 |

**仅新增**：`__getProgressUnsubsSize` export（行 729-735）。

### 5.3 不外推纪律

按 AGENTS.md "G0 长期开发期" 最高优先级约束：

- ❌ 不外推 packaged Electron 公证 / 签名
- ❌ 不外推真实 Provider 矩阵
- ❌ 不外推 P7（Result Studio 实机 verified）
- ❌ 不外推 GA / 远程发布 / dist staleness 校验
- ❌ 不重新激活 BLOCK-2-UI-157-REVIEW / BLOCK-3-IPC-BRIDGE-HARDENING（均已 `completed`）
- ❌ 不在 closeout 笔录写"`qualificationEligible` 维持 false" / "未做 Provider" / "未做 GA" —— 这些是 G1+ 阶段事项，按当前阶段纪律是**不外推**而非"待办"

**收口笔录用语**：本工作包 G5 单项收口；4 治理门 GREEN；23 vitest PASS（+1 G5）；14 node --test PASS；tsc 0；不外推 packaged/Provider/P7/GA。

### 5.4 UI 状态标头

`UI-157` / `UI-161` 保持 **`in_progress`**（PHASE 3 实机跑通才升 `verified`）。本工作包为 `G5 测试补` 不直接升级 UI 状态。

---

## 6. 后续交接

### 6.1 主 agent 下一步

按 BLOCK-4-IPC-BRIDGE-POLISH plan §2 PHASE 3 / 4：

1. PHASE 3 审计收口：
   - `docs/ui-productization-audit.md` 末尾追加 BLOCK-4 笔录
   - `docs/AUDIT-LOG.md` 顶部最后更新 + 收口条目
2. PHASE 4 closeout：
   - 4 canonical 文档同步
   - DOC-REGISTRY `BLOCK-4-IPC-BRIDGE-POLISH` `active → completed`
   - 新增 `BLOCK-4-IPC-BRIDGE-POLISH-CLOSEOUT` reference entry
   - closeout 报告 `docs/block-4-ipc-bridge-polish-closeout.md`

### 6.2 本 worker 范围声明

- 本 worker 仅负责 PHASE 2 G5 唯一项
- 不启动 PHASE 3 / 4 工作（属于主 agent / 后续 worker 范围）
- 不动 AUDIT-LOG / canonical 文档
- 不提议新工作包

### 6.3 未发现 Blocker

- 4 治理门 GREEN
- 23 vitest GREEN（含 +1 G5）
- 14 node --test GREEN
- tsc 0 错误
- 无 P0 Blocker 需升级

---

**报告完**。