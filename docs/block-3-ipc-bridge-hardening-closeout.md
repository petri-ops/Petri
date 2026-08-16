# BLOCK-3-IPC-BRIDGE-HARDENING 工作包收口报告

**最后更新**：2026-08-16 19:55
**状态**：`completed`（2026-08-16 用户裁决启动当日收口）
**Plan ID**：`BLOCK-3-IPC-BRIDGE-HARDENING`

---

## 1. 决策与定位

本工作包专收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核（`agent-transcripts/phase-6-code-audit.md` 1001 行 / 12 节）发现的 12 项 Major 中的 11 项 P1 必修 + P2 强烈建议。跳过 E1（100 并行 execution 性能，G0 边界不触发）+ Minor 15 + Nit 4 留后续工作包候选。

**11 项修复总览**：P1 安全 B1/F1（sender 守门）/ P1 契约 C1（poller 9→4 映射）/ P2 内存 A1+A2+A3（终态清理 / poller 停止 / execute 同步）/ P2 错误 B2（`_publishSkillProgress` try/catch）/ P2 测试 G1+G2+G3+G4+G6（wakeup 链路 + execute 失败 + callback 抛错 + cancel 失败 + main.js 9→4 单测）。

---

## 2. PHASE 收口表

| PHASE | 描述 | commit | 状态 |
|---|---|---|---|
| **PHASE 0** | 复用 PHASE 6 报告（不重新摸底）| n/a | ✅ |
| **PHASE 1** | P1 必修 + P2 边界修复主 agent 直做（main.js 5 项）| `a2c4232` | ✅ |
| **PHASE 2** | P2 修复 worker 委派落地（6 项）| `97f1b10` + `c9391ba` | ✅ |
| **PHASE 3** | audit 收口（`docs/ui-productization-audit.md` 末尾 BLOCK-3 笔录）| (本 commit 关联) | ✅ |
| **PHASE 4** | closeout（4 canonical 同步 + DOC-REGISTRY + 本报告）| (本 commit 关联) | ✅ |

---

## 3. Commit 落地（5 笔）

| # | hash | subject | 文件 / +− |
|---|---|---|---|
| 1 | `786a8d6` | docs(ui-157): start BLOCK-3-IPC-BRIDGE-HARDENING work package | plan + DOC-REGISTRY + README |
| 2 | `7ec27cc` | docs(sync): BLOCK-3-IPC-BRIDGE-HARDENING 启动同步 2 canonical 文档 | roadmap + handoff |
| 3 | `a2c4232` | feat(skills-bridge): BLOCK-3 PHASE 1 P1 必修 + P2 边界修复（main.js）| main.js +42 / −6 |
| 4 | `97f1b10` | fix(skills-bridge): BLOCK-3 PHASE 2 A1 useSkillStore 终态清 onProgress + G1-G4 测试补 | useSkillStore.ts +5 / useSkillStore.test.ts +199 |
| 5 | `c9391ba` | test(skills-bridge): BLOCK-3 PHASE 2 G6 main.js 9→4 状态映射单测 | main.js +32 / −21 + _mapSkillRuntimeStatus.js +39 + _mapSkillRuntimeStatus.test.mjs +123 |

---

## 4. 11 项修复明细

### P1 必修

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 1 | **B1/F1** | 4 IPC handler `_resolveSkillsIpcWindow(event)` 守门，对齐 `setupAgentWorkbenchFlagsIpc()` L1162 模式（`event.sender !== mainWindow.webContents → { ok: false, error: "unauthorized" }`）| `src/main.js` L2188 + L2202 + L2265 + L2291 |
| 2 | **C1** | poller L2159 publish `_mapSkillRuntimeStatus(execCtx.status)` 9→4 状态映射，修复 `electron.d.ts` L172-184 契约硬冲突 | `src/main.js` L2163 |

### P2 边界 / 内存 / 错误

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 3 | **A2** | 新增 `_stopSkillsProgressPollerIfIdle()` 在 `_activeSkillRuntimes.size === 0` 时 clearInterval + `_skillsProgressTimer = null` | `src/main.js` L2133 + L2171（poller tick 末尾）+ L2228 + L2238（execute 终态两处调用）|
| 4 | **A3** | `runtime.execute().then/.catch` 终态 publish 后立即 `_activeSkillRuntimes.delete` + `_lastCheckpointCount.delete` + `_stopSkillsProgressPollerIfIdle()`，节省 1s | `src/main.js` L2226-2229 + L2236-2239 |
| 5 | **B2** | `_publishSkillProgress` 包独立 try/catch（webContents.send 抛错时 console.warn 不抛出）| `src/main.js` L2127-2132 |
| 6 | **A1** | `_startPolling` 终态（complete/failed 写入 store 后）同步 `_unsubscribeProgressWakeup(executionId)` + 异常路径同样清 | `frontend/src/hooks/useSkillStore.ts` L257-259 + L265-266 |

### P2 测试补

| # | ID | 测试 | 文件 / 行号 |
|---|---|---|---|
| 7 | **G1** | wakeup callback writes store snapshot（验 callback 触发后 store 写入对应 executionId + status）| `useSkillStore.test.ts` test 10 |
| 8 | **G2** | execute() 失败时 polling 不启动验证（mock bridge.execute 返回 `{ok:false}` 验 `_subscribeProgressWakeup` 不被调）| `useSkillStore.test.ts` test 11 |
| 9 | **G3** | onProgress callback 抛错（验 store 不崩 + bridge.getExecution 仍可用）| `useSkillStore.test.ts` test 12 |
| 10 | **G4** | cancel() 失败路径（mock bridge.cancel('nonexistent_id') 返回 `{ok:false}` 验 store 不变）| `useSkillStore.test.ts` test 13 |
| 11 | **G6** | main.js 9→4 状态映射单测（**采用提取独立模块策略**：`src/_mapSkillRuntimeStatus.js` 39 行 + `test/_mapSkillRuntimeStatus.test.mjs` 14 tests；main.js L49 顶部 `require('./_mapSkillRuntimeStatus')` + 删 21 行原内嵌函数）| `src/_mapSkillRuntimeStatus.js` + `test/_mapSkillRuntimeStatus.test.mjs` + `src/main.js` L49-50 + L2306 |

---

## 5. 不变量守住（7 项）

| 不变量 | 状态 |
|---|---|
| UI-161 5 项清理 | ✅ 5/5 intact（PHASE 2 5c98ca8 已 PASS）|
| `desktopBridge.ts` | ✅ 0 diff |
| `electron.d.ts` | ✅ 0 diff |
| `preload.js` | ✅ 0 diff |
| 4 page（SkillCard / SkillDetail / SkillSearch / index）| ✅ 0 diff |
| `core/shared-backend/*` | ✅ 0 diff |
| `agent-tools/` | ✅ 0 diff |

---

## 6. 4 治理门 GREEN

| 命令 | 结果 |
|---|---|
| `npm run docs:check` | ✅ 68 registered PASS（+1 BLOCK-3 plan +1 BLOCK-3-CLOSEOUT）|
| `npm run ui:audit:check` | ✅ 131 PASS（台账同步检查通过）|
| `cd frontend && npx tsc --noEmit` | ✅ 0 错误 |
| `npm run docs:reconcile` | ✅ Registered 68 / Unregistered 0 / Validation 0 |

---

## 7. 测试矩阵（36 项全 PASS）

| 测试套件 | 测试数 | 状态 |
|---|---|---|
| `useSkillStore.test.ts` | 13（9 已有 + G1-G4 新增 4）| ✅ |
| `usePluginStore.test.ts` | 9 | ✅ |
| `test/_mapSkillRuntimeStatus.test.mjs`（node --test）| 14（9 状态枚举 + 5 边界）| ✅ |
| **合计** | **36** | **✅** |

---

## 8. UI-157 / UI-161 状态语义（保持）

按 `docs/ui-productization-audit.md` 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"：

- **UI-157**：保持 `in_progress`（PHASE 3 dev Electron 实机按用户 P1-T-A 裁决跳过；本工作包不升级 verified）
- **UI-161**：保持 `in_progress`

**证据等级升级**：BLOCK-2 UI-157 IPC 桥 evidence 从「PHASE 1 5 文件接通 + 18 vitest PASS」升为「PHASE 1 + BLOCK-3 PHASE 2 = 11 项 Major 修复 + sender 守门对齐既有安全基线 + 9→4 状态契约一致 + 22 vitest PASS + 14 node --test PASS + 4 治理门 GREEN」。

---

## 9. 文档同步（已完成 4 canonical）

| 文档 | 同步内容 |
|---|---|
| `docs/README.md` | 长期核心指引新增条目 5 BLOCK-3 link |
| `docs/next-steps-roadmap.md` | 头部最后更新到 2026-08-16 19:15 + BLOCK-3 启动段落（11 项修复 / 4 PHASE）|
| `docs/project-workspace-handoff.md` | 头部最后更新 + §3.0.7 BLOCK-3 启动段落 |
| `docs/DOC-REGISTRY.json` | `BLOCK-3-IPC-BRIDGE-HARDENING` `active → completed` + `linkedCommits` +5 commits；新增 `BLOCK-3-IPC-BRIDGE-HARDENING-CLOSEOUT` reference entry |
| `docs/AUDIT-LOG.md` | 顶部 `最后更新` 同步 + 最近处理记录 `BLOCK-3-IPC-BRIDGE-HARDENING / CLOSEOUT` 条目 |
| `docs/ui-productization-audit.md` | 末尾「最近变更日志」追加 BLOCK-3 工作包收口笔录 |
| `docs/block-3-ipc-bridge-hardening-closeout.md` | 本报告 11 节 |

---

## 10. 不外推声明

按 `qualificationEligible: false` 永久 G0 事实：

- **不外推** packaged / Provider / P7 / GA 实测
- **不外推** UI-157 → verified 升级路径（按 audit 行 402 治理纪律仍需真实 dev Electron 实机证据；本工作包只补 PHASE 6 发现的硬冲突）
- **不外推** G1+ 阶段 Provider 矩阵 / 公证 / 远程发布
- **不重写** BLOCK-2-UI-157-REVIEW 状态（保持 `completed`，不重新 `active`）
- **不改动** preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/

---

## 11. 下一块候选（须经用户显式裁决启动新工作包）

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包：

| 候选 | 来源 | 紧迫度 |
|---|---|---|
| **Minor 15 + Nit 4 收口** | BLOCK-2 PHASE 6 报告 §10.3 + §10.4 | 🟡 优化项 |
| **E1 100 并行 execution × 1s poller 性能优化** | BLOCK-2 PHASE 6 报告 §10.2 G0 边界外 | 🟡 G1+ 范畴 |
| **Block-2 UI-158/UI-159 实机复核** | 上一轮 BLOCK-2 收口 8 候选 | 🟡 dev Electron 实机 |
| **Block-6 UI-161 既有 in_progress 复核** | 上一轮 BLOCK-2 收口 8 候选 | 🟡 实机 |
| **Windows 代码签名 (任务 #55)** | 历史 deferred | 🟡 平台 |
| **i18n 资源抽离 (任务 #91)** | 历史 deferred | 🟡 治理 |
| **release-pipeline dist staleness check** | AUDIT-LOG 🟢DIST-STALENESS | 🟡 release |

**当前无 active 工作包**（BLOCK-3 已 `completed`）。
