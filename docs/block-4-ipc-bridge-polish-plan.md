# BLOCK-4 IPC 桥打磨：UI-157 IPC 桥 PHASE 6 剩余 Minor + Nit 收口

**最后更新**：2026-08-16
**状态**：`active`（2026-08-16 用户裁决"按你的节奏来"启动）
**Plan ID**：`BLOCK-4-IPC-BRIDGE-POLISH`

---

## 1. 决策与定位

BLOCK-3-IPC-BRIDGE-HARDENING 已收口 11 项 Major + 交付 22 vitest + 14 node --test + 4 治理门 GREEN。本工作包收口 PHASE 6 只读代码质量审核（`agent-transcripts/phase-6-code-audit.md`）剩余 **10 项 Minor + 1 项 Nit + 1 项收尾文档修复**——共 12 项，跨 3 文件 + 文档同步。

### 1.1 修复范围（按 8 类）

| ID | 类别 | 摘要 | 文件 | 必修度 |
|---|---|---|---|---|
| **A5** | 边界 | preload.js 5 方法加参数守卫（`String(executionId ?? '')`）| `src/preload.js` L212-226 | 应修 |
| **B3** | 错误处理 | 9→4 状态映射 default `"running"` → `"failed"` + 加显式 null 守卫 | `src/_mapSkillRuntimeStatus.js` | 应修 |
| **B4** | 错误处理 | wakeup payload 缺 executionId 时 `console.warn` 调试日志 | `frontend/src/hooks/useSkillStore.ts` L290-308 | 应修 |
| **B5** | 错误处理 | preload.js onProgress callback 包 try/catch | `src/preload.js` L226-230 | 应修 |
| **C2** | 契约文档 | main.js `_getSkillsSDK` createDefaultSDK vs createSkillsSDK 加注释 | `src/main.js` L2103-2117 | 应修 |
| **C3** | 文档 | preload.js 注释 `L114-169` → `L114-218` | `src/preload.js` L216 | 应修 |
| **D1** | tsc | useSkillStore payload 类型自动派生 `Parameters<typeof bridge.onProgress>` | `frontend/src/hooks/useSkillStore.ts` L290 | 可选 |
| **E2** | 性能 | setExecutions 内部 deep-equal 避免无变化 re-render | `frontend/src/hooks/useSkillStore.ts` | 应修 |
| **G5** | 测试 | test 7 验证 unmount 后 `_progressUnsubs.size === 0` | `frontend/src/hooks/useSkillStore.test.ts` | 应修 |
| **H3** | 代码注释 | main.js 顶部注释显示 9→4 状态映射表行号 | `src/main.js` L2091-2095 | 应修 |

### 1.2 跳过

| ID | 类别 | 跳过理由 |
|---|---|---|
| E3 | checkpoints.slice 体积 | 极端场景，G0 边界不触发 |
| F2 | preload.js 暴露 partial 防御 | current security OK |
| F3 | a11y progress 推送无 aria-live | UI 工作包范围 |
| H1 / H2 | BLOCK-2 plan/closeout 修订 | 错过收口窗口（BLOCK-2 已 completed），本工作包不动旧文件；可启动新 BLOCK-5 收口 |

---

## 2. PHASE 划分

### PHASE 1：主 agent 直做（10 项代码改动）

目标：跨 3 文件（main.js + preload.js + useSkillStore.ts + _mapSkillRuntimeStatus.js）小处修复 + E2 deep-equal 性能 + 注释同步。

#### 1.1 A5 + B5 + C3（src/preload.js）

- A5：5 方法加 `String(executionId ?? '')` 防御（`execute(skillId, params)` 维持 `params ?? {}` OK）
- B5：`onProgress` callback 包 try/catch
- C3：注释 `L114-169` → `L114-218`（104 行偏差）

#### 1.2 B3（src/_mapSkillRuntimeStatus.js）

- `default` 分支返回 `"failed"`（更保守）替代 `"running"`
- 加 `if (!s) return "failed";` 显式 null 守卫
- 同步更新 `test/_mapSkillRuntimeStatus.test.mjs` 14 个 case 验 default → "failed"

#### 1.3 B4 + D1 + E2（frontend/src/hooks/useSkillStore.ts）

- B4：wakeup callback 内 `console.warn('[useSkillStore] progress payload missing executionId:', payload)`
- D1：payload 类型从 `{ executionId?: string }` → `NonNullable<Parameters<NonNullable<typeof getBridge>['skills']['onProgress']>[0] extends (p: infer P) => any ? P : never>` 自动派生 d.ts 完整类型
- E2：setExecutions 内部 deep-equal 比较（status / progress / completedAt / error / result）

#### 1.4 C2 + H3（src/main.js）

- C2：`_getSkillsSDK` 函数注释说明 `createDefaultSDK` vs `createSkillsSDK` 区别（前者可能含更高层封装）
- H3：行 2091-2095 顶部注释增加 `9 状态映射 4 状态：见 _mapSkillRuntimeStatus（src/_mapSkillRuntimeStatus.js）` 一行

### PHASE 2：worker 测试补（2-3 项测试增量）

#### 2.1 G5 useSkillStore.test.ts

- 加 `it('unmount clears _progressUnsubs', async () => { ... })` 验 `_progressUnsubs.size === 0`
- 需导出 `_progressUnsubs` 或通过 mock bridge 的 `onProgress` 注册计数验

#### 2.2 _mapSkillRuntimeStatus.test.mjs default 行为更新

- 同步 B3 把所有 `default → 'running'` case 改为 `expect(actual).toBe('failed')`
- 加 `null / undefined / ''` 三种 falsy 输入 → "failed" 守卫测试

### PHASE 3：审计收口

- `docs/ui-productization-audit.md` 末尾追加 BLOCK-4 笔录
- `docs/AUDIT-LOG.md` 顶部最后更新 + 收口条目

### PHASE 4：closeout

- 4 canonical 文档同步
- DOC-REGISTRY `BLOCK-4-IPC-BRIDGE-POLISH` `active → completed`
- 新增 `BLOCK-4-IPC-BRIDGE-POLISH-CLOSEOUT` reference entry
- closeout 报告 `docs/block-4-ipc-bridge-polish-closeout.md`

---

## 3. 验收门禁

| # | 命令 | 必跑 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PHASE 3 / 4 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ PHASE 3 / 4 commit 前 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PHASE 1 / 2 commit 前 |
| 4 | `npm run docs:reconcile` | ✅ PHASE 4 commit 前 |
| 5 | `cd frontend && npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts` | ✅ PHASE 1 / 2 commit 前 |
| 6 | `node --test test/_mapSkillRuntimeStatus.test.mjs` | ✅ PHASE 2 commit 前 |

**不跑** `npm run check` / `npm run test:all:workspace` / packaged / Provider / P7 / GA（按 governance §"smallest sufficient scope" 默认不跑）。

---

## 4. 完成语义

- **PHASE 1 / 2 / 3 / 4 全部落地**：4 治理门 GREEN + 22+ vitest PASS + 14+ node --test PASS + tsc 0
- **10 项 + 1 项 + 1 项 = 12 项收口**
- **UI-157 / UI-161 保持 `in_progress`**
- **不变量守住**：UI-161 5/5 / desktopBridge.ts 0 diff / electron.d.ts 0 diff / preload.js 5 方法签名不变 / 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff

---

## 5. 不外推

- 不外推 packaged / Provider / P7 / GA / UI-157 verified
- 不外推 E1 poller 性能（100 并行 execution G0 边界不触发；后续 BLOCK-5+ 处理）
- 不重新激活 BLOCK-2-UI-157-REVIEW / BLOCK-3-IPC-BRIDGE-HARDENING（均已 `completed`）
- 不动 H1 / H2（BLOCK-2 plan/closeout 修订，错过收口窗口；可启动 BLOCK-5 单独处理）
