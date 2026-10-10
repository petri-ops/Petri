# BLOCK-2 UI-157：Skills UI 工作流页面复核

最后更新：2026-08-16

状态：`planning`（2026-08-16 用户裁决启动）

Plan ID：`BLOCK-2-UI-157-REVIEW`

## 1. 决策与定位

`BLOCK-2-UI-157-REVIEW` 是经用户裁决（2026-08-16）启动的 UI 复核工作包，专为收口 `docs/ui-productization-audit.md` 中 `UI-157`（P1/W-04/Skills UI 页面 + IPC 桥）的 `in_progress` 状态而设。本工作包不新增 Skills 业务能力、不外推 Provider / packaged / GA / 屏幕阅读器 P2，仅完成 4 件事：

1. **接通 `useSkillStore` ↔ `core/shared-backend/workflow-engine.js` 之间的 IPC 桥**（UI-161 显式留白的跨包接桥工作）
2. **核对 UI-161 既有清理（commit `01c5e0b`）未回退**：Skills 入口已迁到 `LeftPanel.QuickActions`；死 `SkillsSidebar.tsx` / `.module.css` 已删；`pages/skills/index.tsx` error 状态有 retry 按钮；`styles/custom.css` 补全 4 个 token
3. **真实 dev Electron 实机启动 + 走查 Skills 路由**：触发 `useSkillStore` 真实 IPC 调用、观察 DAG 引擎是否真的在 renderer 中能跑
4. **UI-157 行 `in_progress` → `verified`**（仅在实机证据充分时）

### 1.1 触发与所有权

- **触发**：用户 2026-08-16 显式裁决启动
- **所有者**：主 agent（本工作包不委派 `luna_worker`，因为它涉及 IPC 桥契约决策 + 实机启动，是跨模块边界判断）
- **纪律**：single work package serial；不并行启动其他 WP；不开 worktree（沿用 `main`）

### 1.2 范围输入

本工作包基于以下已落地的不可变提交（不重做实现）：

| 不可变提交 | 内容 | 角色 |
| --- | --- | --- |
| `e6bf72f`（feat(skills)） | 9 个 UI 文件 + `core/shared-backend/workflow-engine.js` + `frontend/src/hooks/useSkillStore.ts` | UI-157 历史实现 |
| `01c5e0b`（UI-161 closeout） | Skills 入口归位 + 删除死 SkillsSidebar + retry 按钮 + 4 token 补全 | UI-161 跨包铺垫 |

UI-161 entry §最后段明确写道："不接 IPC / 不动 preload / main / workflow-engine——那是 UI-157 工作包范围，跨包接桥违反「单工作包串行」纪律"。本工作包正是接走 UI-161 留白的 IPC 桥工作。

## 2. 唯一真理链

| 字段 | 值 |
| --- | --- |
| Plan ID | `BLOCK-2-UI-157-REVIEW` |
| Plan 路径 | `docs/block-2-ui-157-review-plan.md` |
| DOC-REGISTRY entry plan | `kind=planning` / `truthDomain=block-2-ui-157-review` / `status=active` / `linkedCommits=[e6bf72f, 01c5e0b, ...]` |
| 历史锚点提交 | `e6bf72f`（UI-157 实现）/ `01c5e0b`（UI-161 closeout） |
| 当前无 active 工作包 | 已被 `DOC-GOVERNANCE-GATES`（commit `8619cfb`）释放空闲 |

## 3. 范围

### 3.1 In-scope

**A. IPC 桥接通（核心 gap）**

【PHASE 0 摸底后修订 / PHASE 1 实际落地（commit `2d81377` P1-1.3）】**`frontend/src/lib/electron.d.ts` L114-218（含 L207-218 onProgress 完整字段）已通过 ADDITIVE +2 字段扩展为 source-of-truth**（PHASE 1 落地新增 `cancel(executionId)` + `onProgress(callback)` 字段声明 +12 行 + JSDoc 注释），无需后续重写；`desktopBridge.ts` 已通过 `getBridge('skills')` 自动派生类型，无需修改。真实缺口仅在 main 进程 + preload 暴露：

- `src/main.js`：新增 `ipcMain.handle('skills:discover')` / `'skills:execute'` / `'skills:getExecution'` 三个 handler；内部委托 `core/shared-backend/skills-sdk.js` 单例（行 77 `class SkillsSDK` + 行 232 `executeSkill` + 行 311 `executeSkillTool`）+ 装配 `core/shared-backend/workflow-engine.js`（行 566 `cancel` + `getExecution`）；**进度推送**用 `webContents.send('skills:progress', ...)`（订阅 SDK 内部或包装 SkillRuntime diff `execCtx.checkpoints[]`）
- `src/preload.js`：在第二份 `contextBridge.exposeInMainWorld('petriDesktop', {...})` 对象（行 61 起）补 `skills` 子块，对齐 `electron.d.ts` 声明：`discover()` / `execute(skillId, params)` / `getExecution(executionId)` / `onProgress(callback)` / `cancel(executionId)`；**注意**：world 名是 `petriDesktop`（与 electron.d.ts 一致），不是 `desktopBridge`（plan 初稿命名错误）
- `frontend/src/hooks/useSkillStore.ts`：改 1 行：`_startPolling` (2s polling) → 订阅 `window.petriDesktop.skills.onProgress(...)` 替代；其余 store 实现保持不变（已自动通过 `getBridge('skills')` 走真实 IPC）
- **不动**：`electron.d.ts`、`desktopBridge.ts`、4 个 page（SkillDetail/SkillCard/SkillSearch/skills/index）、UI-161 任何 token

**B. UI-161 清理核对（不重复实现）**

- 验证 `frontend/src/components/desktop/SkillsSidebar.tsx` 与 `SkillsSidebar.module.css` 已不存在（确认 commit `01c5e0b` 落地）
- 验证 `frontend/src/components/workspace-panels/LeftPanel.tsx` `QuickActions` 数组包含 Skills 项（sparkles icon）
- 验证 `frontend/src/pages/skills/index.tsx` error 状态有「返回首页」按钮
- 验证 `styles/custom.css` 含 `--petri-accent-soft` / `--petri-border-color` / `--petri-font-mono` / `--petri-font-sans` 4 token
- 若任一项回退，恢复之（不重新设计，仅恢复 commit `01c5e0b` 的清理结果）

**C. 实机验证**

- `npm run dev:electron` 启动成功
- 走 `/skills` 路由 → Skills list 渲染（数据来源真实 IPC 而非 fixture）
- 点击某 Skill 卡片触发 `skills:invoke` → DAG 引擎真实执行
- 故意制造 error（断网 / 传错参数）→ retry 按钮真实工作

**D. Audit ledger 推进**

- `docs/ui-productization-audit.md` 第 113 行 `UI-157` 由 `in_progress` → `verified`
- 落地实现证据指针 + 实机启动 commit
- 末尾「最近变更日志」追加本次工作包笔录

### 3.2 Out-of-scope（本工作包不做）

- 新增 Skills 业务能力（filter / search-by-tag / 多 DAG 并行调度 / skill 编辑器）
- 修改 `core/shared-backend/workflow-engine.js` 引擎内部（仅消费既有契约）
- Provider / packaged / GA / 屏幕阅读器 P2 / Chart a11y / dist-staleness
- `acceptance/` 新增证据文件（除非实机验证要求新 evidence 类型）
- 任何 worktree 相关操作

### 3.3 排除项（明确不做）

- 不重启 UI-161 WP（其已是 in_progress；本 WP 仅核对未回退，不动其 entry）
- 不触碰 `core/r-server/`、`core/py-server/`、`core/shared-backend/` 中非 `workflow-engine.js` 的其他文件
- 不修改 `package.json` 脚本（除非新增 `npm run skills:smoke` 类一次性验证）
- 不开 worktree（沿用 `main`）

## 4. 阶段（Phase）

### PHASE 0 / Evidence-Gathering（只读摸底）

**目标**：确认 IPC 桥 gap 范围，确认 UI-161 清理完整。

执行项：
1. `git show e6bf72f --stat` 复核 9 UI 文件清单
2. `git show 01c5e0b --stat` 复核 UI-161 清理文件清单
3. 全量 grep `preload.js` / `desktopBridge.ts` / `useSkillStore.ts` 中 skills 相关 token
4. 全量 grep `App.tsx` / `LeftPanel.tsx` 中 Skills 相关渲染（确认死 Sidebar 已删、新 QuickActions 项就位）
5. 阅读 `core/shared-backend/workflow-engine.js` 已有 exports（不修改）
6. `cd frontend && npx tsc --noEmit` — 必须 0 错误
7. `npm run ui:audit:check` — 必须 PASS
8. `npm run docs:check` — 必须 PASS
9. 定向前端测试：`npx vitest run frontend/src/pages/skills frontend/src/hooks/useSkillStore* frontend/src/components/desktop/Skills* 2>/dev/null || true`（如存在）

输出：
- PHASE-0-REPORT（写入 `agent-transcripts/phase-0-evidence.md`）
- IPC gap 详细清单（preload / main / bridge / store 四层缺失接口）
- UI-161 清理完整 / 回退项清单

不写代码，不 commit。

### PHASE 1 / IPC 桥接通

**目标**：把 `useSkillStore` 真实接到 `workflow-engine.js`。

执行项（顺序；**经 PHASE 0 摸底对齐**）：
1. **`src/preload.js`**（最小改动 ~15 行）：在第二份 `contextBridge.exposeInMainWorld('petriDesktop', {...})` 对象（行 61 起）补 `skills` 子块，对齐 `frontend/src/lib/electron.d.ts` L114-218（含 L207-218 onProgress 完整字段）已声明契约：`discover()` / `execute(skillId, params)` / `getExecution(executionId)` / `onProgress(callback)` / `cancel(executionId)`。底层对应 `ipcRenderer.invoke('skills:discover')` 等
2. **`src/main.js`**（~80 行）：顶部 `require('skills-sdk')` 单例装配 + `WorkflowEngine` 注入；注册 3 个 `ipcMain.handle('skills:discover'/'execute'/'getExecution')` + 1 个 `ipcMain.handle('skills:cancel')`；进度推送用 `webContents.send('skills:progress', { executionId, progress, checkpoints })` —— 通过包装 `SkillRuntime`（`core/shared-backend/skill-runtime.js` 行 188 已具备 `cancel(executionId)`）后 `setInterval(1000)` diff `execCtx.checkpoints[]` 合成（`workflow-engine.js` 零 EventEmitter）
3. **`frontend/src/hooks/useSkillStore.ts`**（改 1 处 ~10 行）：把 `_startPolling`（行 581 附近，2 秒 polling）替换为订阅 `window.petriDesktop.skills.onProgress(callback)`；回调内调 `_notify()` + 写 store。store 其余实现不变（已自动通过 `getBridge('skills')` 走真实 IPC）
4. **`frontend/src/hooks/useSkillStore.test.ts`**（**新文件** ~200 行）：镜像 `frontend/src/hooks/usePluginStore.test.ts`（195 行模板，9 tests）；用 `vi.stubGlobal('petriDesktop', { skills: { discover: vi.fn(), execute: vi.fn(), getExecution: vi.fn(), onProgress: vi.fn(), cancel: vi.fn() } })`；每测试调用 `__resetSkillStoreCacheForTests()`（`useSkillStore.ts` L580 已导出）重置缓存
5. **完全不动**：`electron.d.ts`（已 source-of-truth）/ `desktopBridge.ts`（已通过 `getBridge('skills')` 自动派生）/ 4 个 page（仅 consume store）/ UI-161 任何 token / `core/shared-backend/*`（仅消费其既有 exports，不改）

**PHASE 0 已验证约束**：
- preload.js 行 21-50 第一份 expose `'petri'` 仅 `agentWorkbenchFlags`；行 61-246 第二份 expose `'petriDesktop'` 含 9 个桌面桥（isDesktop / window / app / aiSettings / computeSettings / harnessCapabilities / plugins / contentPlugins / terminal / updater），**唯独缺 skills**
- main.js 行 1161-1842 含 ~40 个 `ipcMain.handle`，但 0 个 `skills:*`；`require(...workflow-engine.js/skills-sdk.js)` 也是 0 命中
- `useSkillStore.ts` 行 173 已 `const bridge = getBridge('skills')`，行 175 返回 `'skills bridge unavailable'`（这就是 UI-161 retry 按钮"skills bridge unavailable" 文案来源）

输出：
- `git add` + commit `feat(skills-bridge): UI-157 IPC bridge connecting useSkillStore to workflow-engine`
- `npm run ui:audit:check` 仍 PASS
- `cd frontend && npx tsc --noEmit` 仍 0
- 定向 vitest 全绿

约束：
- 不修改 `core/shared-backend/workflow-engine.js` 内部（仅消费其 export）
- 不修改 `useSkillStore.ts` 的公开 hooks 签名（仅改实现）
- 不重写 `useSkillStore.ts` 整文件，只换数据来源

### PHASE 2 / UI-161 清理核对

**目标**：确认 commit `01c5e0b` 的清理未回退。

执行项：
1. `git log --diff-filter=D --pretty=format:"%h %s" -- frontend/src/components/desktop/SkillsSidebar*` → 必须出现 `01c5e0b`
2. `grep -r "SkillsSidebar" frontend/src/` → 必须 0 命中
3. `grep -n "Skills" frontend/src/components/workspace-panels/LeftPanel.tsx` → 必须见 QuickActions 中存在 Skills 项
4. `grep -n "返回首页\|retryBtn\|handleRetry" frontend/src/pages/skills/index.tsx` → 必须命中
5. `grep -n "petri-accent-soft\|petri-border-color\|petri-font-mono\|petri-font-sans" frontend/src/styles/custom.css` → 必须 4/4 命中

回退处理：
- 任一项不命中 → 立刻报告主 agent；不擅自修补（除非是简单 typo 或 import 错位）
- 若发现 `01c5e0b` 之后有 commit 回退了清理 → 用 `git revert` 链中具体 commit 单独修复（不重做设计）

输出：
- PHASE-2-REPORT（写入 `agent-transcripts/phase-2-ui161-verification.md`）
- 5 项核对结果（OK / REGRESSION + 修复 commit）

不 commit（除非发现回退需补 commit）。

### PHASE 3 / 实机 dev Electron 验证

**目标**：真实启动 Electron 验证 `/skills` 路由 + IPC 桥 + DAG 执行。

执行项：
1. `npm run dev:electron` 后台启动（设置 `notify_on_output` 监听启动成功日志）
2. 等待 renderer 加载完成（监听 `did-finish-load` 或窗口 ready）
3. 用 Playwright MCP（`browser_navigate` 到 `http://localhost:3000/skills`，或通过 Electron DevTools）打开 Skills 路由
4. 截图：
   - Skills list 渲染（截图 1：`skills-list.png`）
   - 点击某 Skill 卡片进入 detail（截图 2：`skill-detail.png`）
   - 触发 invoke（截图 3：`skill-invoking.png`）
   - 故意断开 IPC（mock failure）→ retry 按钮（截图 4：`skill-retry.png`）
5. 把 4 张截图与启动日志保存到 `acceptance/SKILLS-IPC/`（新建一次性 evidence 目录）
6. 关闭 dev Electron

输出：
- `acceptance/SKILLS-IPC/evidence-manifest.md`（4 截图 + dev:electron 启动 tail + DAG 执行日志截取）
- `agent-transcripts/phase-3-realmachine.md`（主 agent 走查笔录）
- 仅当 4 截图齐全且 IPC 真实触发才视为 PHASE 3 PASS

约束：
- 不修改 `acceptance/` 既有文件（新建一次性目录）
- 实机失败 → 不进入 PHASE 4，先回 PHASE 1 修桥

### PHASE 4 / Audit Entry Update

**目标**：`UI-157` 由 `in_progress` → `verified`。

执行项：
1. `docs/ui-productization-audit.md` 第 113 行 `UI-157`：
   - `状态：in_progress` → `verified`
   - 「实机启动验证待用户过目」改为「实机启动验证 PASS（见 `acceptance/SKILLS-IPC/evidence-manifest.md`，PHASE-3-REPORT `agent-transcripts/phase-3-realmachine.md`）」
   - 末尾追加 PHASE 1 commit hash + PHASE 3 证据路径
2. 「最近变更日志」追加一行：`2026-08-16 BLOCK-2-UI-157-REVIEW 收口：UI-157 in_progress → verified（IPC 桥接通 + 实机 4 截图）`
3. `docs/AUDIT-LOG.md`：本工作包 active 行 → ✅ 已收口登记
4. `npm run ui:audit:check` 仍 PASS

输出：
- `git add docs/ui-productization-audit.md docs/AUDIT-LOG.md`
- commit `docs(audit): UI-157 in_progress → verified with real-machine evidence`

约束：
- 不外推 UI-157 以外的 UI entry 状态变更
- 不重写 audit 文件，仅改 1 行 + 追加 1 行日志

### PHASE 5 / Closeout

**目标**：WP 收口、canonical 同步。

执行项：
1. 写 `docs/block-2-ui-157-review-closeout.md`（仿照 `docs/doc-governance-gates-closeout.md` 结构）：
   - §1 决策结论
   - §2 唯一真理链
   - §3 证据链（PHASE 1 commit + PHASE 3 4 截图 + 5 项 UI-161 核对）
   - §4 收口判定（in-scope 全完 / out-of-scope 0 外推）
   - §5 关联（DOC-GOVERNANCE-GATES / UI-161）
   - §6 风险（如有）
   - §7 Next（恢复空闲，等待用户裁决下一 WP）
2. `docs/next-steps-roadmap.md`：头部日期 + §next 标记 `BLOCK-2-UI-157-REVIEW` → completed
3. `docs/project-workspace-handoff.md`：§3.0.x 收口条目
4. `docs/DOC-REGISTRY.json`：
   - `BLOCK-2-UI-157-REVIEW` status `active` → `completed`，补 `linkedCommits`
   - 新增 `BLOCK-2-UI-157-REVIEW-CLOSEOUT`（kind=reference / status=reference / canonical=true / truthDomain=block-2-ui-157-review-closeout / tags=[docs, ui, skills, verified, gates, closeout]）
5. `npm run docs:reconcile` + `npm run docs:check` 必须 0 issues / PASS
6. `git add` + commit `docs(closeout): BLOCK-2-UI-157-REVIEW work-package closeout + canonical sync`

输出：
- 一个收口 commit
- 当前恢复无 active WP 状态

约束：
- 不外推 Provider / packaged / GA / dist staleness
- 不开新 WP
- 不重写已有 plan / closeout 文档

## 5. 证据链

| 阶段 | 证据类型 | 路径 |
| --- | --- | --- |
| PHASE 0 | 摸底报告 | `agent-transcripts/phase-0-evidence.md` |
| PHASE 1 | commit + tsc + vitest 输出 | git log + `agent-transcripts/phase-1-bridge.md` |
| PHASE 2 | UI-161 5 项核对表 | `agent-transcripts/phase-2-ui161-verification.md` |
| PHASE 3 | 4 张实机截图 + dev:electron tail | `acceptance/SKILLS-IPC/` |
| PHASE 4 | commit + ui:audit:check PASS | git log + 终端输出 |
| PHASE 5 | docs:reconcile 0 + docs:check PASS + closeout commit | git log + 终端输出 |

完整证据链最终在 closeout commit message 与 `docs/block-2-ui-157-review-closeout.md` §3 汇总。

## 6. 不外推（Non-derivables）

- Provider (`P-07`)：本工作包不触碰
- packaged / dist / notarization
- GA 资格 / GA 公证流水
- dist staleness
- Worktree 创建（沿用 `main`）
- 新 Skills 业务能力
- 屏幕阅读器 / Chart a11y P2

## 7. 关联

| 文档 | 关系 |
| --- | 

---

## PHASE 6 H1 修复（2026-08-16 BLOCK-5-IPC-BRIDGE-FINALIZE）

按 PHASE 6 只读代码质量审核报告 §10.3 H1 项，本节 §3.1.A 内 `electron.d.ts L114-150` 措辞**已在 BLOCK-5 PHASE 1 修订**：

- L51 / L123 两处 `L114-150` → `L114-218`（含 L207-218 onProgress 完整字段）
- L51 措辞新增 "PHASE 1 实际落地（commit `2d81377` P1-1.3）" + "ADDITIVE +2 字段扩展为 source-of-truth" + "+12 行 + JSDoc 注释"

**为什么 PHASE 1 落地后没及时同步 plan**：PHASE 1 提交 `2d81377` + commit `0be5483 docs(ui-157)` 修订 §3.1.A 时已记录 "+12 ADDITIVE" 措辞（phase-1-bridge.md §1.3 + §5.1 主 agent 裁决 Option A 段），但 plan 主体保留旧措辞。BLOCK-5 PHASE 1 修复此遗漏。

**未触碰**：plan 总体结构、§3.1.A 后续段、§4 PHASE 划分、其他章节。
--- |
| `docs/doc-governance-gates-plan.md` | 前序 WP plan 模板来源（同 § 结构） |
| `docs/doc-governance-gates-closeout.md` | 前序 WP closeout 模板来源 |
| `docs/ui-productization-audit.md` 第 113 行 | UI-157 主条目（PHASE 4 修改） |
| `docs/ui-productization-audit.md` 第 116 行 | UI-161 条目（PHASE 2 核对） |
| `agent-transcripts/wp-closeout-report.md` | DOC-GOVERNANCE-GATES 主 agent 收口笔录参考 |

## 8. 风险

1. **IPC 桥表面未知**：PHASE 0 才完整列出 `workflow-engine.js` 已暴露的方法；PHASE 1 可能发现需新方法 → 走「PHASE 1a：扩 engine exports」分阶段补，不整体重写 engine
2. **Skills page 真实交互 vs fixture 测试覆盖不足**：现有 `useSkillStore.ts` 含大量 mock；PHASE 1 真实化可能暴露未测分支 → 用 `useSkillStore.test.ts` 最小 mock 补齐
3. **dev:electron 启动依赖 native 绑定**（better-sqlite3 / electron-rebuild）：本机环境若失败需提前验证，不在 PHASE 3 才暴露
4. **UI-161 清理与 UI-157 桥接顺序耦合**：若 UI-161 retry 按钮的 IPC target 也是 `skills:*`，PHASE 1 需一并接入；PHASE 0 必须显式列出
5. **Playwright MCP 与 Electron 窗口的协议**：Electron `file://` 渲染 + Vite dev server `:3000` 双协议；PHASE 3 需明确走哪条（建议 `:3000/skills`，更接近 dev 路径）

## 9. Next

待 PHASE 0 报告产出后，主 agent 据此决定：
- 全部 5 项核对 OK → 直接进入 PHASE 1
- 发现 UI-161 回退 → 在 PHASE 2 内补 commit 修复后再 PHASE 3
- 发现 engine exports 严重不足 → 决定是否扩大 PHASE 1 范围或开 PHASE 1a 分支
- 用户中途裁决新增范围或中止 → 走 `$petri-project-governance` skill 的 "Continue active work" 路径更新本 plan
