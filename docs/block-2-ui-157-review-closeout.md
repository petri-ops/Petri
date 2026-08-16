# BLOCK-2 UI-157：Skills UI 工作流页面复核 — Closeout Report

**最后更新**：2026-08-16
**Plan ID**：`BLOCK-2-UI-157-REVIEW`
**状态**：`completed`（PHASE 0 摸底 → PHASE 1 IPC 桥接通 → PHASE 2 UI-161 5 项核对 → PHASE 3 搁置 → PHASE 4 audit 收口 → PHASE 5 closeout）

---

## 1. 决策与定位回顾

本工作包经用户裁决 2026-08-16 启动，专为收口 `docs/ui-productization-audit.md` 中 UI-157 (Skills UI 页面 P1/W-04) `in_progress` 状态而设。

完成 4 件事：

1. **接通 `useSkillStore` ↔ `core/shared-backend/workflow-engine.js` 之间的 IPC 桥**（UI-161 显式留白）
2. **核对 UI-161 既有清理**（commit `01c5e0b`）未回退（5/5 PASS）
3. ~~真实 dev Electron 实机启动 + 走查 Skills 路由~~ —— **PHASE 3 按用户 P1-T-A 裁决跳过**
4. UI-157 状态**保持 `in_progress`**（按本台账行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"，PHASE 3 跳过导致 `verified` 不成立）

---

## 2. 收口结果表

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| PHASE 0 | 摸底 + 综合 + 用户裁决 | ✅ | `agent-transcripts/phase-0-{synthesis,agent-a,b,c,d,inbox}.md`（4 子代理 + 主 agent 综合 + 修正 B 报告 2 处错误断言） |
| PHASE 1 | IPC 桥接通 | ✅ | commit `2d81377` feat(skills-bridge) + `0be5483` docs(ui-157) + `7e010a4` docs(audit)；9 vitest PASS；4 治理门 GREEN |
| PHASE 2 | UI-161 5 项清理核对 | ✅ | commit `5c98ca8` docs(ui-157)；5/5 PASS |
| PHASE 3 | 实机 dev Electron 4 截图 | ⏸️ **搁置** | 按用户裁决 P1-T-A 跳过（Vite-only mock 测试，不启用 `BIOF3_DEV_ELECTRON_ARGS`） |
| PHASE 4 | audit ledger 推进 | ✅ | `docs/ui-productization-audit.md` 末尾「最近变更日志」追加 BLOCK-2-UI-157-REVIEW 工作包收口笔录；UI-157 + UI-161 **保持 `in_progress` 字样不变**（PHASE 3 跳过不构成 verified 升级条件）|
| PHASE 5 | closeout | ✅ | 本文档 + 4 canonical 文档同步 + DOC-REGISTRY 同步 |

---

## 3. 改动汇总（4 commit）

| Commit | 类型 | Files | +/− | 范围 |
|---|---|---|---|---|
| `2d81377` | feat(skills-bridge) | 5 | +518 / −2 | preload.js +19 / main.js +195 / electron.d.ts +12 / useSkillStore.ts +69 / useSkillStore.test.ts +225（新） |
| `0be5483` | docs(ui-157) | 2 | +20 / −12 | AUDIT-LOG.md 顶部最后更新 + plan §3.1.A / §4 PHASE 1 修订对齐摸底真相 |
| `7e010a4` | docs(audit) | 1 | +3 / −1 | AUDIT-LOG.md 新增 PHASE-1-COMPLETE 条目 |
| `5c98ca8` | docs(ui-157) | 1 | +2 / −1 | AUDIT-LOG.md 新增 PHASE-2-VERIFY 条目 |

---

## 4. 不变量（守住 7 项）

- ✅ UI-161 5/5 清理 intact（git log `01c5e0b..HEAD -- <4 UI-161 文件>` 空）
- ✅ `frontend/src/lib/desktopBridge.ts` 0 diff（已通过 `getBridge('skills')` 自动派生）
- ✅ 4 page（skills/index + SkillCard + SkillDetail + SkillSearch）0 diff（仅 consume store）
- ✅ `core/shared-backend/*` 引擎内部 0 diff（仅消费既有 exports，不改内部）
- ✅ `core/r-server/mcp/registry.js` / `frontend/src/styles/custom.css` / `src/main.js` 等前一会话未 commit M 状态 0 触动
- ✅ `agent-tools/` 前一会话遗留 0 diff（绝对不动）
- ✅ 9 vitest PASS + 4 治理门 GREEN + 5 项 UI-161 核对 PASS

---

## 5. 治理门禁终态（commit 后基线复跑）

| # | 命令 | 终态 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PASS (66 registered documents，PHASE 5 后 +1 closeout reference) |
| 2 | `npm run ui:audit:check` | ✅ PASS (131 个 UI 编号) |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PASS (0 错误) |
| 4 | `npm run docs:reconcile` | ✅ PASS (0 issues) |

定向 vitest：`npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts` 18/18 PASS。

**不跑** `npm run check` / `npm run test:all:workspace`（默认不跑，留发布前/CI）。

---

## 6. UI-157 / UI-161 状态语义说明

按 `docs/ui-productization-audit.md` 行 402 治理纪律："**状态语义：UI-157/UI-158/UI-159 均按治理纪律标 `in_progress`（无开发态 Electron 实机核对、不外推 packaged/P7/GA）；仅当真实 dev Electron 实机过目后才可考虑 `verified`**"。

本工作包 PHASE 3 按用户 P1-T-A 决策跳过实机验证，因此：

- **UI-157 保持 `in_progress`**（IPC 桥接通但缺真实 dev Electron 实机证据，不构成 `verified`）
- **UI-161 保持 `in_progress`**（5 项清理核对通过但缺真实 dev Electron 实机证据）

如未来需升级 `verified`，应走：

- 选项 A：用户显式 widen 范围启用 `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"` 跑真实 dev Electron + CDP attach + 4 截图存 `acceptance/SKILLS-IPC/`
- 选项 B：用户显式声明按 P-07 模型接口类 `key-unavailable 例外` 模式扩展到 IPC 类（需要在 audit 文档中新增类似"dev-electron-unavailable 例外"）

---

## 7. 遗留风险

| # | 风险 | 严重度 | 状态 |
|---|---|---|---|
| R1 | `WorkflowEngine.cancel` 只翻 flag（不真正 abort 异步 `await`）| 中 | PHASE 1 内有意留白 — 通过包装 SkillRuntime.cancel 由 main.js 转给 renderer |
| R2 | 零 progress 事件源（workflow-engine / skill-runtime / skills-sdk）| 中 | PHASE 1 内已处理 — main.js `setInterval(1000)` diff `execCtx.checkpoints[]` 合成 progress |
| R3 | `executionId` 生命周期绑定 `main.js` uptime（无 SQLite 持久化）| 低 | PHASE 1 内有意留白 — in-memory only；resume 留后续工作包 |
| R4 | `desktop.css:1889-1897` 残留 dead comment | 低 | PHASE 1 内有意留白 — UI-161 清理 cosmetic |
| R5 | progress payload 不含 `result/startedAt/completedAt` | 低 | PHASE 1 内有意留白 — wakeup 路径自动调 `getExecution` 拉完整 snapshot 补齐 |
| R6 | SkillRuntime 9 态→4 态映射丢 `paused/recovering` | 低 | PHASE 1 内已记录 — `_mapSkillRuntimeStatus` 内部映射 |
| R7 | UI-157 / UI-161 真实升级 `verified` 待 PHASE 3 实机证据 | 中 | PHASE 3 按 P1-T-A 决策搁置；待用户裁决 widen 或走例外模式 |

---

## 8. 与 PHASE 0 / 上游对比

### 8.1 PHASE 0 摸底盲点复盘

PHASE 0 摸底时主 agent 说 "`electron.d.ts` 已是 source-of-truth"——**实际它是 source-of-truth 但不完整**（3 字段，缺 cancel / onProgress）。worker 在 PHASE 1 实际验证发现 3 → 5 字段缺口 → 边界冲突 → 主 agent 立即采纳 Option A（additive 5 → 7 字段）。

### 8.2 Agent B 报告 2 处错误断言

1. preload 不是单一 `biof3` world —— 实际**双重 expose**（行 21 `biof3` + 行 61 `biof3Desktop`）
2. 项目里所有 `biof3Desktop.*` 桥都已接通，**唯独 skills 断**（不是命名不一致）

主 agent PHASE 0 综合时已修正并写进 `phase-0-synthesis-report.md` §4。

### 8.3 plan §4 PHASE 1 修订

- plan v1 写 4 channel (`skills:list` / `skills:invoke` / `skills:status` / `skills:progress`)
- plan v2（PHASE 0 后修订）写 5 hook 对齐 electron.d.ts
- 真实落地：5 hook 对齐 electron.d.ts，**electron.d.ts 自身 ADDITIVE +2 字段**

---

## 9. 4 canonical 文档同步（PHASE 5）

| 文档 | 改动 |
|---|---|
| `docs/block-2-ui-157-review-plan.md` | 通过 commit `0be5483` 已对齐摸底真相修订 §3.1.A + §4 PHASE 1 |
| `docs/ui-productization-audit.md` | 末尾「最近变更日志」追加 BLOCK-2-UI-157-REVIEW 工作包收口笔录（保持 UI-157/UI-161 `in_progress`）|
| `docs/next-steps-roadmap.md` | 头部最后更新 + 现有 4 BLOCK 描述追加 PHASE 收口结果 |
| `docs/project-workspace-handoff.md` | 头部最后更新 + §3.0.6 BLOCK-2-UI-157-REVIEW 段落补充 PHASE 1/2/3/4/5 收口结果 |
| `docs/AUDIT-LOG.md` | 顶部最后更新 + 最近处理记录 PHASE-2-VERIFY + CLOSEOUT 条目 |
| `docs/DOC-REGISTRY.json` | BLOCK-2-UI-157-REVIEW `status: active → completed`，`linkedCommits` +4 commits；新增 BLOCK-2-UI-157-REVIEW-CLOSEOUT reference entry |

---

## 10. 不外推声明

按治理 skill §"Choose the smallest sufficient validation scope" + `qualificationEligible: false` 永久 G0 事实：

- ❌ 不外推 packaged / Provider / P7 / GA
- ❌ 不外推 real-key / live 模型接口
- ✅ 仅在 dev Electron 边界内（**实际 PHASE 3 跳过**，故维持 Vite mock + 9 vitest 等级）
- ✅ 维持 `qualificationEligible: false` 字样（不写"maintain false / keep false / pending Provider"措辞）

---

## 11. 下一块候选（不主动启动，等用户裁决）

按"单工作包串行"纪律，BLOCK-2-UI-157-REVIEW 收口后**不主动启动新工作包**。下一块候选（按既有 in_progress 复核项 + 后续可能新工作包）：

| 候选 | 触发条件 |
|---|---|
| PHASE 3 补跑实机 + UI-157 `in_progress → verified` | 用户裁决 widen 范围启用真 Electron |
| Block-2 UI-158 / UI-159 实机复核 | 用户裁决启动新工作包 |
| Block-6 UI-161 既有 in_progress 复核 | 用户裁决启动新工作包 |
| release-pipeline dist staleness check | AUDIT-LOG 🟢DIST-STALENESS 条目登记，不阻塞开发 |
| Windows 代码签名补齐 | 阻塞于 EV/标准代码签名证书（任务 #55，deferred） |
| i18n 资源抽离 | 阻塞于产品/架构决策（任务 #91，deferred） |
