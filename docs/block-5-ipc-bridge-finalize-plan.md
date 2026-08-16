# BLOCK-5 IPC 桥收尾：E1 poller 性能 + H1/H2 BLOCK-2 文档修订

**最后更新**：2026-08-16
**状态**：`active`（2026-08-16 用户裁决"1-4 搞完"启动）
**Plan ID**：`BLOCK-5-IPC-BRIDGE-FINALIZE`

---

## 1. 决策与定位

按用户裁决"1-4 搞完"——4 个候选中的 **1（E1 性能）+ 4（H1/H2 文档修订）** 合并到本工作包，候选 **2/3（UI-158/UI-159/UI-161 dev Electron 实机）** 由 BLOCK-6+ 单独工作包承接（需 dev Electron 启动 + CDP attach，**BLOCK-5 不依赖外部环境**）。

BLOCK-3 + BLOCK-4 已收口 11 项 Major + 12 项 Minor + Nit。本工作包收口 PHASE 6 剩余 **E1（100 并行 execution × 1s poller 性能，G1+ 范畴）+ H1（plan §3.1.A 修订）+ H2（closeout R8/R9/R10 补充）**——共 3 项微调，跨 1 文件 + 2 文档同步。

### 1.1 修复范围

| ID | 类别 | 摘要 | 文件 | 必修度 |
|---|---|---|---|---|
| **E1-b** | 性能 | execute 后立即 publish 初始 `status: 'pending'`，避免 poller 1s 延迟 | `src/main.js` | 应修 |
| **E1-c** | 性能 | 终态 publish 后立即调 `_stopSkillsProgressPollerIfIdle()`，避免 poller tick 1s 后才停 | `src/main.js` | 应修 |
| **H1** | 文档 | plan §3.1.A 内 `electron.d.ts L114-150 已是 source-of-truth` 改为 `PHASE 1 修订：electron.d.ts 行 207-218 ADDITIVE +2 字段 cancel + onProgress（commit 2d81377 P1-1.3）` | `docs/block-2-ui-157-review-plan.md` | 应修 |
| **H2** | 文档 | closeout 末尾追加 R8（sender 守门）/ R9（终态清理缺失）/ R10（poller 停止机制缺失） | `docs/block-2-ui-157-review-closeout.md` | 应修 |

> **E1-d（每个 execution 独立 setTimeout 链）/ E1-e（runtime.batchGetExecutionStatus）** 留 G1+ 工作包（架构层改动，本工作包不做）。

### 1.2 不外推

- 不重新激活 BLOCK-2 / BLOCK-3 / BLOCK-4
- 不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/
- 不做 dev Electron 实机复核（候选 2/3 留 BLOCK-6+）

---

## 2. PHASE 划分

### PHASE 1：主 agent 直做 3 项微调

#### 1.1 E1-b + E1-c（src/main.js）

- E1-b：`execute()` 路径 立即 publish `status: 'pending'`（避免 poller 首次 tick 1s 延迟）
- E1-c：execute 终态 publish 后立即调 `_stopSkillsProgressPollerIfIdle()`（poller 不再每 1s tick 一次空转）

#### 1.2 H1 + H2（docs 修订）

- H1：plan §3.1.A 内措辞修订
- H2：closeout 末尾 R8/R9/R10 三条遗留风险追加

### PHASE 2：worker 测试补（1 项）

- E1-b/E1-c 没有直接单测（main.js 内部函数）；PHASE 2 候选 A：导出 `_initialSkillProgressPublished` set 或通过 mock runtime 测"execute 立即 publish pending"；候选 B：直接跳过测试补（PHASE 6 报告已确认 G0 边界内不触发）
- **采用候选 B**（PHASE 6 报告 E1 "G0 边界内 OK；PHASE 3 实机不会触发"；不强行加测试补，避免破坏现有 main.js 边界）

### PHASE 3：审计收口

- `docs/ui-productization-audit.md` 末尾追加 BLOCK-5 笔录
- `docs/AUDIT-LOG.md` 顶部最后更新 + 收口条目

### PHASE 4：closeout

- 4 canonical 文档同步
- DOC-REGISTRY `BLOCK-5-IPC-BRIDGE-FINALIZE` `active → completed`
- 新增 `BLOCK-5-IPC-BRIDGE-FINALIZE-CLOSEOUT` reference entry
- closeout 报告 `docs/block-5-ipc-bridge-finalize-closeout.md`

---

## 3. 验收门禁

| # | 命令 | 必跑 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PHASE 3 / 4 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ PHASE 3 / 4 commit 前 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PHASE 1 commit 前 |
| 4 | `npm run docs:reconcile` | ✅ PHASE 4 commit 前 |
| 5 | `cd frontend && npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts` | ✅ PHASE 1 commit 前 |
| 6 | `node --test test/_mapSkillRuntimeStatus.test.mjs` | ✅ PHASE 1 commit 前 |

**不跑** `npm run check` / `npm run test:all:workspace` / packaged / Provider / P7 / GA（按 governance §"smallest sufficient scope"）。

---

## 4. 完成语义

- **PHASE 1-4 全部落地**：4 治理门 GREEN + 23 vitest PASS + 14 node --test PASS + tsc 0
- **3 项收口**（E1-b + E1-c + H1/H2）
- **UI-157 / UI-161 保持 `in_progress`**
- **不变量守住**：UI-161 5/5 / desktopBridge.ts 0 diff / electron.d.ts 0 diff / preload.js 5 方法签名不变 / 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff

---

## 5. 不外推

- 不外推 packaged / Provider / P7 / GA / UI-157 verified
- 不外推 E1-d / E1-e（G1+ 范畴架构改动，留后续工作包）
- 不重新激活 BLOCK-2 / BLOCK-3 / BLOCK-4
- 不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/
- 不做 dev Electron 实机复核（候选 2/3 留 BLOCK-6+）

---

## 6. 下一块候选

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包。剩余 4 候选：
- BLOCK-6：UI-158 + UI-159 dev Electron 实机复核
- BLOCK-7：UI-161 既有 in_progress 实机复核
- BLOCK-8：release-pipeline dist staleness check（🟢DIST-STALENESS）
- BLOCK-9：Windows 代码签名 / i18n 资源抽离
