# BLOCK-5-IPC-BRIDGE-FINALIZE 工作包收口报告

**最后更新**：2026-08-16 20:55
**状态**：`completed`（2026-08-16 用户裁决"1-4 搞完"当日收口）
**Plan ID**：`BLOCK-5-IPC-BRIDGE-FINALIZE`

---

## 1. 决策与定位

按用户裁决"1-4 搞完"，合并 4 候选中的 **1（E1 poller 性能）+ 4（H1/H2 BLOCK-2 文档修订）**——共 4 项微调。**候选 2/3（UI-158/UI-159/UI-161 dev Electron 实机）** 由 BLOCK-6+ 单独工作包承接（需 dev Electron 启动 + CDP attach）。

---

## 2. PHASE 收口表

| PHASE | 描述 | commit | 状态 |
|---|---|---|---|
| **PHASE 0** | 复用 PHASE 6 报告（不重新摸底）| n/a | ✅ |
| **PHASE 1** | 主 agent 直做 4 项微调（src/main.js E1-b + plan §3.1.A H1 + closeout H2 3 文件 / +39 / −4）| `2f7136f` | ✅ |
| **PHASE 2** | 候选 B 跳过测试补（PHASE 6 报告 E1 G0 边界内 OK）| n/a | ✅ |
| **PHASE 3** | audit 收口（`docs/ui-productization-audit.md` 末尾 BLOCK-5 笔录）| (本 commit 关联) | ✅ |
| **PHASE 4** | closeout（4 canonical 同步 + DOC-REGISTRY + 本报告）| (本 commit 关联) | ✅ |

---

## 3. Commit 落地（4 笔）

| # | hash | subject | 内容 |
|---|---|---|---|
| 1 | `6a42592` | docs(ui-157): start BLOCK-5-IPC-BRIDGE-FINALIZE work package | plan + DOC-REGISTRY + README |
| 2 | `861cf1f` | docs(sync): BLOCK-5-IPC-BRIDGE-FINALIZE 启动同步 2 canonical | roadmap + handoff |
| 3 | `2f7136f` | feat+docs(skills-bridge): BLOCK-5 PHASE 1 E1-b + H1/H2 收口 | main.js + plan + closeout |
| 4 | (本 commit) | docs(ui-157): BLOCK-5-IPC-BRIDGE-FINALIZE PHASE 4 closeout 落地 | closeout 报告 + DOC-REGISTRY |
| 5 | (本 commit) | docs(sync): BLOCK-5-IPC-BRIDGE-FINALIZE 收口同步 2 canonical | AUDIT-LOG + ui-audit |

---

## 4. 4 项修复明细

| # | ID | 修复 | 文件 / 行号 |
|---|---|---|---|
| 1 | **E1-b** | `execute()` 路径在 `_activeSkillRuntimes.set` + `_startSkillsProgressPoller` 之后立即 publish `status: 'pending'`（避免 poller 首次 tick 1s 延迟）| `src/main.js` L2265-2270 |
| 2 | **H1 §3.1.A L51** | plan `electron.d.ts L114-150 → L114-218` + 新增 "PHASE 1 实际落地（commit 2d81377 P1-1.3）" + "ADDITIVE +2 字段扩展" + "+12 行 + JSDoc 注释" | `docs/block-2-ui-157-review-plan.md` L51 |
| 3 | **H1 §3.1.A L123** | plan `L114-150 → L114-218` 同步 + 末尾 "PHASE 6 H1 修复" 节追加 | `docs/block-2-ui-157-review-plan.md` L123 + 末尾 |
| 4 | **H2** | closeout 末尾追加 3 项遗漏遗留风险 R8（sender 守门缺失）/ R9（终态清理缺失）/ R10（poller 停止机制缺失）+ 关联到 BLOCK-3 修复 commit | `docs/block-2-ui-157-review-closeout.md` 末尾 |

> **注**：E1-c（终态立即 stop poller）已在 BLOCK-3 PHASE 1 commit `a2c4232` 落地（`_stopSkillsProgressPollerIfIdle` 调用），本工作包不重复。

---

## 5. 不变量守住（7 项）

| 不变量 | 状态 |
|---|---|
| UI-161 5 项清理 | ✅ 5/5 intact |
| `desktopBridge.ts` | ✅ 0 diff |
| `electron.d.ts` | ✅ 0 diff（仍是 PHASE 1 +12 ADDITIVE）|
| `preload.js` 5 方法签名 | ✅ 不变 |
| 4 page | ✅ 0 diff |
| `core/shared-backend/*` | ✅ 0 diff |
| `agent-tools/` | ✅ 0 diff |

---

## 6. 4 治理门 GREEN

| 命令 | 结果 |
|---|---|
| `npm run docs:check` | ✅ 71 registered PASS（+1 BLOCK-5 plan +1 BLOCK-5-CLOSEOUT）|
| `npm run ui:audit:check` | ✅ 131 PASS |
| `cd frontend && npx tsc --noEmit` | ✅ 0 错误 |
| `npm run docs:reconcile` | ✅ Registered 71 / Validation 0 |

---

## 7. 测试矩阵（37 项全 PASS）

| 测试套件 | 测试数 | 状态 |
|---|---|---|
| `useSkillStore.test.ts` | 14 | ✅ |
| `usePluginStore.test.ts` | 9 | ✅ |
| `test/_mapSkillRuntimeStatus.test.mjs`（node --test）| 14 | ✅ |
| **合计** | **37** | **✅** |

---

## 8. UI-157 / UI-161 状态语义（保持）

按 `docs/ui-productization-audit.md` 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"：

- **UI-157**：保持 `in_progress`
- **UI-161**：保持 `in_progress`

**证据等级升级链**：BLOCK-2 PHASE 1 5 文件接通 + 18 vitest → BLOCK-3 11 项 Major + 22 vitest + 14 node --test → BLOCK-4 12 项 Minor/Nit + 23 vitest + 14 node --test → **BLOCK-5 E1-b + H1/H2 + 23 vitest + 14 node --test + 4 治理门** = **27 项 PHASE 6 + E1-b 全收口**。

---

## 9. 文档同步

| 文档 | 同步内容 |
|---|---|
| `docs/README.md` | 长期核心指引新增条目 7 BLOCK-5 link |
| `docs/next-steps-roadmap.md` | 头部最后更新 + BLOCK-5 启动段落 |
| `docs/project-workspace-handoff.md` | 头部最后更新（修正 BLOCK-3 启动时刻未正确更新）+ §3.0.9 BLOCK-5 启动段落 |
| `docs/DOC-REGISTRY.json` | `BLOCK-5-IPC-BRIDGE-FINALIZE` `active → completed` + `linkedCommits` +3 commits；新增 `BLOCK-5-IPC-BRIDGE-FINALIZE-CLOSEOUT` reference entry |
| `docs/AUDIT-LOG.md` | 顶部 `最后更新` 同步 + 最近处理记录 `BLOCK-5-IPC-BRIDGE-FINALIZE / CLOSEOUT` 条目 |
| `docs/ui-productization-audit.md` | 末尾「最近变更日志」追加 BLOCK-5 工作包收口笔录 |
| `docs/block-2-ui-157-review-plan.md` | H1 §3.1.A L51/L123 措辞修订 + 末尾 "PHASE 6 H1 修复" 节 |
| `docs/block-2-ui-157-review-closeout.md` | H2 末尾 R8/R9/R10 三遗留风险追加 |
| `docs/block-5-ipc-bridge-finalize-closeout.md` | 本报告 11 节 |

---

## 10. 不外推声明

- **不外推** packaged / Provider / P7 / GA
- **不外推** E1-d（每个 execution 独立 setTimeout 链）/ E1-e（runtime.batchGetExecutionStatus）（G1+ 架构改动，留 BLOCK-10）
- **不重写** BLOCK-2/BLOCK-3/BLOCK-4（均已 `completed`）
- **不动** preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/
- **不做** dev Electron 实机复核（候选 2/3 留 BLOCK-6+）

---

## 11. 下一块候选（须经用户显式裁决启动新工作包）

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包：

| 候选 | 来源 | 紧迫度 |
|---|---|---|
| **BLOCK-6** UI-158 + UI-159 dev Electron 实机 | 用户裁决"1-4 搞完"候选 2 | 🟠 推翻 P1-T-A 跳过 |
| **BLOCK-7** UI-161 既有 in_progress 实机 | 用户裁决"1-4 搞完"候选 3 | 🟠 推翻 P1-T-A 跳过 |
| BLOCK-8 release-pipeline dist staleness check | AUDIT-LOG 🟢DIST-STALENESS | 🟡 release |
| BLOCK-9 Windows 代码签名 / i18n 资源抽离 | 历史 deferred | 🟡 平台 / 治理 |
| BLOCK-10 E1-d/E1-e G1+ 架构改动 | PHASE 6 E1 衍生 | 🟡 G1+ 范畴 |

**当前无 active 工作包**（BLOCK-5 已 `completed`）。
