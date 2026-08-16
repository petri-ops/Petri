# BLOCK-9.1-MAIN-JS-SPLIT 工作包（main.js 17 IPC setup 函数拆分）

**最后更新**：2026-08-16 23:50
**状态**：`active`（2026-08-16 23:45 用户裁决"继续"启动 BLOCK-9.1）
**Plan ID**：`BLOCK-9.1-MAIN-JS-SPLIT`
**评审依据**：`docs/senior-engineer-review-2026-08-16.md` §2.4 P1

---

## 1. 决策与定位

按用户裁决"继续"启动 BLOCK-9.1，按评审报告 §2.4 P1 优先级落地 **main.js 2450 行拆分重构**。

**目标**：把 18 个 setup* 函数 + setupDesktopEnv 716 行从 main.js 拆到 `src/ipc/<domain>.js` 模块，**main.js 收缩为 100-200 行装配器**。

**原则**（沿用 BLOCK-9 不外推 + 不破坏行为 + 不引入新依赖 + 保留向后兼容）：
- **不修改行为**（只搬代码 + 引入模块边界，0 业务逻辑差异）
- **不引入新依赖**（不引入 refactor 工具如 jscodeshift / codemod）
- **保留向后兼容**（setup* 函数名不变，main.js 内的 main() 调用顺序不变）
- **不破坏测试**（既有 vitest 0 改动）
- **不外推**（仅本工作包；剩余 5 项 BLOCK-9.2 ~ BLOCK-9.6 留后续）

**为什么 BLOCK-9.1 可主 agent + worker 协作**：
- 纯代码组织变更（不依赖 IPC 桥 / dev Electron 实机）
- 拆分前后行为完全一致
- 4 治理门 GREEN（tsc 0 / vitest 0 失败 / docs:check / ui:audit:check）
- chf0-critical impact 测试必须跑（g0-chf0-http / g0-chf0-science / g0-chf0-lifecycle）

**边界**：
- **不拆 setupSkillsIpc**（BLOCK-2/3/4/5 已多次改动；跨工作包边界）
- **不拆 setupAgentWorkbenchFlagsIpc**（历史特殊，特殊 argv parsing）
- **不拆 setupCsp**（与 createWindow 强耦合，留在 main.js 内）
- **不动 setupDesktopEnv 内的 spawn 子进程逻辑**（仅做提取，不改控制流）

---

## 2. PHASE 划分

### PHASE 0：架构调研（worker 委派）

- 委派 worker 完整摸底 main.js：
  - 模块级变量清单
  - 18 个 setup 函数依赖矩阵
  - 拆分方案 + 风险评估
  - PHASE 顺序建议（先低风险后高风险）

### PHASE 1：拆低风险 setup 函数（4-6 个）

按 worker 输出建议，先拆：
- `setupWindowIpc` (41 行 / 2 handler)
- `setupTelemetryIpc` (13 行 / 1 handler)
- `setupComputeSettingsIpc` (22 行 / 2 handler)
- `setupRuntimeIpc` (50 行 / 2 handler)
- `setupBackendLifecycleIpc` (35 行 / 4 handler)
- `setupHarnessCapabilitiesIpc` (124 行 / 1 handler)

每个搬到 `src/ipc/<domain>.js`，导出 `setup<Domain>Ipc` 函数。

### PHASE 2：拆中风险 setup 函数（5-6 个）

- `setupAiSettingsIpc` (60 行 / 5 handler)
- `setupPluginIpc` (103 行 / 8 handler)
- `setupFileDialogIpc` (89 行 / 4 handler)
- `setupDiagnosticIpc` (125 行 / 1 handler)
- `setupDataManagementIpc` (85 行 / 2 handler)
- `setupAutoUpdateIpc` (74 行 / 6 handler)

### PHASE 3：拆 setupTerminalIpc（高风险 287 行 / 7 handler）

- 终端会话管理 + 长任务 + spawn 子进程
- 需要详细测试覆盖 + audit

### PHASE 4：拆 setupDesktopEnv（中风险 716 行 / 0 handler）

- 大块（环境变量注入 + 后端启动协调）
- 不修改控制流，仅按子职责拆分（如 env-vars.js / backend-coordinator.js）

### PHASE 5：audit + closeout

- 4 治理门 GREEN
- chf0-critical 测试通过
- 4 canonical 文档同步
- DOC-REGISTRY `active → completed`
- closeout 报告
- AUDIT-LOG 登记

---

## 3. 验收门禁

| # | 命令 | 必跑 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PHASE 5 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ 各 PHASE commit 前 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ 各 PHASE |
| 4 | `npm run docs:reconcile` | ✅ PHASE 5 commit 前 |
| 5 | `cd frontend && npx vitest run` | ✅ 各 PHASE |
| 6 | `npm run test:changed` (chf0-critical 影响) | ✅ 各 PHASE（g0-chf0-*.test.mjs） |

---

## 4. 完成语义

- main.js 2450 → ~200 行（装配器）
- 17 个 setup* 函数拆到 `src/ipc/<domain>.js`（15+ 文件）
- setupDesktopEnv 716 行拆到 `src/main/env-coordinator.js`
- 4 治理门 GREEN
- chf0-critical 测试通过
- 既有 vitest 0 失败 / 0 改动
- 不动 preload.js / electron.d.ts / desktopBridge.ts / frontend/src/ / core/shared-backend/* / agent-tools/

---

## 5. 不外推

- 不外推 BLOCK-9.2 SimpleChat.tsx 2153 拆分
- 不外推 BLOCK-9.3 plugin-manager 1457 拆分
- 不外推 BLOCK-9.4 DesktopSettingsPanel 1515 拆分
- 不外推 BLOCK-9.5 useSkillStore 743 拆分
- 不外推 BLOCK-9.6 IPC channel 常量集中
- 不外推 packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n
- 不重新激活 BLOCK-2/3/4/5/6/7/8/9
- 不动 setupSkillsIpc（跨工作包边界）

---

## 6. 下一块候选（须经用户显式裁决启动新工作包）

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包。剩余候选：

| # | 候选 | 来源 | 备注 |
|---|---|---|---|
| 1 | BLOCK-9.2 SimpleChat 2153 拆分 | 评审报告 P1 | 86 hooks + 多角色 UI |
| 2 | BLOCK-9.3 plugin-manager 1457 拆分 | 评审报告 P2 | 27 函数散落 |
| 3 | BLOCK-9.4 DesktopSettingsPanel 1515 拆分 | 评审报告 P2 | 单组件多领域 |
| 4 | BLOCK-9.5 useSkillStore 743 拆分 | 评审报告 P2 | Singleton store 反模式 |
| 5 | BLOCK-9.6 IPC channel 常量集中 | 评审报告 P3 | 卫生改进 |
| 6 | UI-156/157/158/159/AGENTWB-001/002 实机 | 工具边界 | 暂时不提 |
| 7 | packaged / dist / Provider / P7 / GA | deliver window | 暂时不提 |

**当前 active 工作包**：BLOCK-9.1。
**qualificationEligible: false**（G0 长期开发期常态）。
