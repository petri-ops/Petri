# BLOCK-4-IPC-BRIDGE-POLISH 工作包收口报告

**最后更新**：2026-08-16 20:40
**状态**：`completed`（2026-08-16 用户裁决"按你的节奏来"当日收口）
**Plan ID**：`BLOCK-4-IPC-BRIDGE-POLISH`

---

## 1. 决策与定位

本工作包专收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核（`agent-transcripts/phase-6-code-audit.md` 1001 行 / 12 节）剩余 Minor 15 + Nit 4 中的 12 项跨 3 文件可修项。**跳过** E1（100 并行 execution 性能，G0 边界不触发，留 BLOCK-5+）/ E3 / F2 / F3 / H1 / H2（H1/H2 BLOCK-2 plan/closeout 修订错过窗口）。

**12 项修复总览**：A5 preload 参数守卫 + B3 9→4 default "failed" + B4 wakeup console.warn + B5 preload onProgress try/catch + C2 _getSkillsSDK 注释 + C3 preload 注释行号 + D1 类型自动派生 + E2 setExecutions deep-equal + G4 cancel action + G5 unmount 验 _progressUnsubs + H3 main.js 顶部注释 + G6 test default 同步。

---

## 2. PHASE 收口表

| PHASE | 描述 | commit | 状态 |
|---|---|---|---|
| **PHASE 0** | 复用 PHASE 6 报告（不重新摸底）| n/a | ✅ |
| **PHASE 1** | 主 agent 直做 11 项代码 + G6 test 同步（5 文件 / +153 / −49）| `8c627ab` | ✅ |
| **PHASE 2** | worker 委派 1 项 G5 test（2 文件 / +41 / −0）| `5d4009a` | ✅ |
| **PHASE 3** | audit 收口（`docs/ui-productization-audit.md` 末尾 BLOCK-4 笔录）| (本 commit 关联) | ✅ |
| **PHASE 4** | closeout（4 canonical 同步 + DOC-REGISTRY + 本报告）| (本 commit 关联) | ✅ |

---

## 3. Commit 落地（5 笔）

| # | hash | subject | 内容 |
|---|---|---|---|
| 1 | `91ea1be` | docs(ui-157): start BLOCK-4-IPC-BRIDGE-POLISH work package | plan + DOC-REGISTRY + README |
| 2 | `1130b7a` | docs(sync): BLOCK-4-IPC-BRIDGE-POLISH 启动同步 2 canonical | roadmap + handoff |
| 3 | `8c627ab` | feat(skills-bridge): BLOCK-4 PHASE 1 PHASE 6 剩余 11 项收口 | 4 代码文件 + 1 test 同步 |
| 4 | `5d4009a` | test(skills-bridge): BLOCK-4 PHASE 2 G5 unmount 验 _progressUnsubs 清空 | useSkillStore.ts +8 / useSkillStore.test.ts +33 |
| 5 | (本 commit) | docs(ui-157): BLOCK-4-IPC-BRIDGE-POLISH PHASE 4 closeout 落地 | closeout 报告 + DOC-REGISTRY |
| 6 | (本 commit) | docs(sync): BLOCK-4-IPC-BRIDGE-POLISH 收口同步 2 canonical | AUDIT-LOG + ui-audit |

---

## 4. 12 项修复明细

### 边界守卫（A5 + B5 + C3）

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 1 | **A5** | preload.js 4 方法 `String(executionId ?? '')` 防御（execute 维持 `params ?? {}` 加 `typeof params === 'object'` 守卫）| `src/preload.js` L213-218 |
| 2 | **B5** | preload.js onProgress callback 包 try/catch，console.error 隔离抛错 | `src/preload.js` L222-229 |
| 3 | **C3** | preload.js 注释 `L114-169 → L114-218`（104 行偏差，PHASE 1 d.ts ADDITIVE +2 字段后实际范围）| `src/preload.js` L211-212 |

### 状态映射（B3）

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 4 | **B3** | `_mapSkillRuntimeStatus` 显式 null 守卫 `if (!s || typeof s !== 'string') return 'failed'` + default `running → failed`（PHASE 6 B3 修复，更保守）| `src/_mapSkillRuntimeStatus.js` L20-23 + L41 |

### 错误处理（B4）

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 5 | **B4** | wakeup callback payload 缺 executionId 时 `console.warn` 调试日志（payload 不为对象也 warn）| `frontend/src/hooks/useSkillStore.ts` L301-307 |

### 类型 / 性能 / 测试（D1 + E2 + G5）

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 6 | **D1** | useSkillStore payload 类型自动派生 `SkillsBridge['onProgress']` 的 `Parameters[0]`（d.ts 完整类型无需手维护）| `frontend/src/hooks/useSkillStore.ts` L284-287 |
| 7 | **E2** | `_executionsChanged()` deep-equal helper（status / completedAt / error / result / startedAt 5 字段比较）+ 5 处 setExecutions 调用全部 guard（无变化返回 prev 跳过 re-render）| `frontend/src/hooks/useSkillStore.ts` L330-339 + L566-668 |
| 8 | **G5** | useSkillStore.test.ts 补 unmount 验 `_progressUnsubs.size === 0`（worker 候选 A 路径：useSkillStore.ts 加 `__getProgressUnsubsSize()` test-only export）| `frontend/src/hooks/useSkillStore.ts` L795 + useSkillStore.test.ts test 14 |

### Action 补（G4）

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 9 | **G4** | 新增 `cancel(action)` 到 UseSkillStoreResult + 同步调 `_unsubscribeProgressWakeup(executionId)` 清本地订阅（PHASE 6 G4 报告"无 store.cancel action"）| `frontend/src/hooks/useSkillStore.ts` L399-403 + L656-678 |

### 契约 / 注释文档（C2 + H3）

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 10 | **C2** | main.js `_getSkillsSDK` 函数注释说明 `createDefaultSDK`（高层封装：发现 + registry 默认植入）vs `createSkillsSDK`（低层工厂）的区别 | `src/main.js` L2116-2124 |
| 11 | **H3** | main.js setupSkillsIpc 顶部注释加 `9 状态 → UI 4 状态 映射表见 src/_mapSkillRuntimeStatus.js` 一行 + cancelled → failed 文案区分 | `src/main.js` L2102-2107 |

### G6 test 同步（11 收尾）

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 12 | **G6 sync** | `_mapSkillRuntimeStatus.test.mjs` 4 个 default test 改 'failed'（empty string / null / undefined / unknown_future_state）| `test/_mapSkillRuntimeStatus.test.mjs` L71-85 |

---

## 5. 不变量守住（7 项）

| 不变量 | 状态 |
|---|---|
| UI-161 5 项清理 | ✅ 5/5 intact（PHASE 2 5c98ca8 已 PASS）|
| `desktopBridge.ts` | ✅ 0 diff |
| `electron.d.ts` | ✅ 0 diff（仍 +12 ADDITIVE 字段；D1 自动派生不依赖 d.ts 修改）|
| `preload.js` 5 方法签名 | ✅ 不变（行为加强：A5 防御 / B5 try/catch）|
| 4 page（SkillCard / SkillDetail / SkillSearch / index）| ✅ 0 diff |
| `core/shared-backend/*` | ✅ 0 diff |
| `agent-tools/` | ✅ 0 diff |

---

## 6. 4 治理门 GREEN

| 命令 | 结果 |
|---|---|
| `npm run docs:check` | ✅ 69 registered PASS（+1 BLOCK-4 plan +1 BLOCK-4-CLOSEOUT）|
| `npm run ui:audit:check` | ✅ 131 PASS（台账同步检查通过）|
| `cd frontend && npx tsc --noEmit` | ✅ 0 错误 |
| `npm run docs:reconcile` | ✅ Registered 69 / Unregistered 0 / Validation 0 |

---

## 7. 测试矩阵（37 项全 PASS）

| 测试套件 | 测试数 | 状态 |
|---|---|---|
| `useSkillStore.test.ts` | 14（13 已有 + G5 新增 1）| ✅ |
| `usePluginStore.test.ts` | 9 | ✅ |
| `test/_mapSkillRuntimeStatus.test.mjs`（node --test）| 14（9 状态枚举 + 5 边界 / 4 个 default 改 'failed'）| ✅ |
| **合计** | **37** | **✅** |

---

## 8. UI-157 / UI-161 状态语义（保持）

按 `docs/ui-productization-audit.md` 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"：

- **UI-157**：保持 `in_progress`（PHASE 3 dev Electron 实机按用户 P1-T-A 裁决跳过；本工作包不升级 verified）
- **UI-161**：保持 `in_progress`

**证据等级升级**：BLOCK-2 UI-157 IPC 桥 evidence 从「PHASE 1 5 文件接通 + 18 vitest PASS」经 BLOCK-3「11 项 Major + sender 守门 + 9→4 一致 + 22 vitest + 14 node --test + 4 治理门」再升级到「**11 项 Major + 12 项 Minor + Nit = 23 项 PHASE 6 全收口 + 23 vitest + 14 node --test + 4 治理门 + useSkillStore 5 setExecutions deep-equal guard + preload 5 方法参数守卫 + onProgress try/catch + cancel action + _getProgressUnsubsSize test-only export**」。

---

## 9. 文档同步（已完成 4 canonical）

| 文档 | 同步内容 |
|---|---|
| `docs/README.md` | 长期核心指引新增条目 6 BLOCK-4 link |
| `docs/next-steps-roadmap.md` | 头部最后更新到 2026-08-16 20:10 + BLOCK-4 启动段落（12 项 / 4 PHASE）|
| `docs/project-workspace-handoff.md` | 头部最后更新 + §3.0.8 BLOCK-4 启动段落 |
| `docs/DOC-REGISTRY.json` | `BLOCK-4-IPC-BRIDGE-POLISH` `active → completed` + `linkedCommits` +4 commits；新增 `BLOCK-4-IPC-BRIDGE-POLISH-CLOSEOUT` reference entry |
| `docs/AUDIT-LOG.md` | 顶部 `最后更新` 同步到 2026-08-16 20:40 + 最近处理记录 `BLOCK-4-IPC-BRIDGE-POLISH / CLOSEOUT` 条目 |
| `docs/ui-productization-audit.md` | 末尾「最近变更日志」追加 BLOCK-4 工作包收口笔录 |
| `docs/block-4-ipc-bridge-polish-closeout.md` | 本报告 11 节 |

---

## 10. 不外推声明

按 `qualificationEligible: false` 永久 G0 事实：

- **不外推** packaged / Provider / P7 / GA 实测
- **不外推** UI-157 → verified 升级路径（按 audit 行 402 治理纪律仍需真实 dev Electron 实机证据）
- **不外推** G1+ 阶段 Provider 矩阵 / 公证 / 远程发布
- **不重写** BLOCK-2-UI-157-REVIEW / BLOCK-3-IPC-BRIDGE-HARDENING 状态（保持 `completed`，不重新 `active`）
- **不改动** preload.js 5 方法签名 / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/ / docs/block-2-ui-157-review-plan.md / docs/block-2-ui-157-review-closeout.md（H1/H2 跳过）

---

## 11. 下一块候选（须经用户显式裁决启动新工作包）

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包：

| 候选 | 来源 | 紧迫度 |
|---|---|---|
| **E1 100 并行 execution × 1s poller 性能优化** | BLOCK-2 PHASE 6 报告 §10.2 G0 边界外 | 🟡 G1+ 范畴 |
| **Block-2 UI-158/UI-159 实机复核** | BLOCK-2 收口 8 候选 | 🟡 dev Electron 实机 |
| **Block-6 UI-161 既有 in_progress 复核** | BLOCK-2 收口 8 候选 | 🟡 实机 |
| **H1/H2 BLOCK-2 plan/closeout 修订** | PHASE 6 H1/H2 错过窗口 | 🟡 文档 |
| **Windows 代码签名 (任务 #55)** | 历史 deferred | 🟡 平台 |
| **i18n 资源抽离 (任务 #91)** | 历史 deferred | 🟡 治理 |
| **release-pipeline dist staleness check** | AUDIT-LOG 🟢DIST-STALENESS | 🟡 release |

**当前无 active 工作包**（BLOCK-4 已 `completed`）。
