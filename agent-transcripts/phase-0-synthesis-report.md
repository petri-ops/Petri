# BLOCK-2-UI-157-REVIEW · PHASE 0 综合报告

**日期**：2026-08-16
**状态**：✅ PHASE 0 摸底完成；等待用户决策是否进入 PHASE 1
**作者**：主 agent（gpt-5.6-sol）；4 agent 并行摸底，主 agent 综合 + 修正

---

## 0. 摸底覆盖

4 个并行 agent 完成只读摸底（无 commit、无文件修改）：

| Agent | 报告 | 行数 | 任务 |
|---|---|---|---|
| A | `phase-0-agent-a-backend-contract.md` | 343 | backend DAG 引擎契约 |
| B | `phase-0-agent-b-ipc-store-audit.md` | 449 | IPC 桥 + store 审计 |
| C | `phase-0-agent-c-build-env.md` | 428 | 构建 + 测试环境基线 |
| D | `phase-0-agent-d-ui161-verification.md` | 278 | UI-161 清理验证 |

主 agent 对全部 4 份报告的核心断言做了交叉代码验证（grep / wc / git log），并**修正 Agent B 的 2 处错误断言**（见 §4）。

---

## 1. PHASE 0 综合判断（3-bullet）

### 1.1 UI-161 收口干净，PHASE 1 不动 UI 层

- UI-161 五项清理（SkillsSidebar 删除 / App.tsx 引用 / LeftPanel Skills 入口 / skills/index 返回首页按钮 / 4 个 CSS tokens）**全部 intact**，自 commit `01c5e0b` 起零 drift（B + D 双独立确认）
- `git log 01c5e0b..HEAD -- <4 UI-161 files>` **空**（零 diff）
- `pages/skills/{index,SkillCard,SkillDetail,SkillSearch}.tsx` 4 个 page **只 consume `useSkillStore`**，从不直接 IPC；PHASE 1 数据层接通后 UI 层自然复活
- 一处可清扫的 cosmetic：`frontend/src/components/desktop/desktop.css:1889-1897` 残留 2 块 dead comment（非阻塞，PHASE 1 后另起清扫）

### 1.2 IPC 桥缺口比想象的**小** — 仅缺 `skills` 子块 + `main.js` IPC handlers

- **`electron.d.ts` 已完整声明** `window.petriDesktop.skills.{discover, execute, getExecution}`（行 114-150）
- **`useSkillStore` 已调用** `getBridge('skills')`（行 173）；缺的是底层 `window.petriDesktop.skills` 实际对象
- **`preload.js` 有双重 expose**：行 21 `'petri'`（仅 agentWorkbenchFlags）+ 行 61 `'petriDesktop'`（全部 9 个桌面桥：isDesktop / window / app / aiSettings / computeSettings / harnessCapabilities / plugins / contentPlugins / terminal / updater）
- **`petriDesktop.skills` 在 preload.js 里**确实**缺失**（grep "skill" 0 命中）；main.js 也无 `skills` 相关 require / handler
- **其他桥全部健康**（aiSettings / plugins / computeSettings / harnessCapabilities / contentPlugins / terminal / updater / window / app 都在 preload.js 第二份 `petriDesktop` 对象里 + main.js 有对应 `ipcMain.handle`）
- ✅ **无命名不一致问题**（Agent B 报告的"preload 用 `'petri'` 而 electron.d.ts 用 `'petriDesktop'`"是误读；preload 已经双重 expose 到 `petriDesktop`）

### 1.3 backend DAG 引擎已就绪，只缺 SkillsSDK 单例装配

- `core/shared-backend/workflow-engine.js`（688 行）：`Workflow` + `WorkflowEngine` + 5 个 enum + `cancel(executionId)` 行 566（**只翻 flag**，不真正 abort）
- `core/shared-backend/skills-sdk.js`：行 77 `class SkillsSDK` + 行 232 `async executeSkill(skillId, params, context)` + 行 311 `executeSkillTool`
- `core/shared-backend/skill-runtime.js`：行 188 `cancel(executionId)`（**比 engine 层更靠谱**，转发到 `workflowRuntime?.cancel` + 持久化）
- `core/shared-backend/skill-registry.js` / `skill-schema.js`：`resources/skills/{deg-analysis-standard, go-enrichment-analysis}/skill.json` 已就位
- **零 progress 事件**：`workflow-engine.js` / `skill-runtime.js` / `skills-sdk.js` 全无 `EventEmitter` / `emit` / `on`；PHASE 1 必须**包装 SkillRuntime**，diff `execCtx.checkpoints[]` 推合成 progress 给 renderer
- **零 main.js require**：`src/main.js` 没有任何 `require(...workflow-engine.js)` 或 `require(...skills-sdk.js)`；只有 1 处 `require("shared-backend/capability-provisioning.js")` 行 2101

---

## 2. PHASE 1 真实改动面（远小于 Agent B 暗示）

| # | 文件 | 改动 | 行数估算 |
|---|---|---|---|
| 1 | `src/preload.js` | 在 `petriDesktop` 第二份 expose 对象里加 `skills` 子块（discover/execute/getExecution/onProgress） | +15 |
| 2 | `src/main.js` | 顶部 `require` `skills-sdk` + 单例装配 + 3 个 `ipcMain.handle` + 1 个 progress 推送包装 | +80 |
| 3 | `frontend/src/hooks/useSkillStore.ts` | 改 1 行：`_startPolling` (2s) → 订阅 `window.petriDesktop.skills.onProgress` | ±10 |
| 4 | `frontend/src/hooks/useSkillStore.test.ts` | **新文件**，镜像 `usePluginStore.test.ts`（195 行模板） | +200 |

**总计**：~305 行新增 + 改 1 处 polling。

**完全不需要改**：
- ❌ `electron.d.ts`（已是 source of truth）
- ❌ `frontend/src/lib/desktopBridge.ts`（已通过 `getBridge('skills')` 通）
- ❌ 4 个 page（只 consume store）
- ❌ `LeftPanel.tsx` / `custom.css` / `App.tsx`（UI-161 intact）
- ❌ 任何 backend `core/shared-backend/*` 文件（已是绿色，只缺 main.js 装配）

---

## 3. 测试策略（Agent C 已给出，可执行）

### 默认：Vite-only + Playwright MCP + mock bridge

```bash
cd frontend && npm run dev  # 启动 Vite :3000
# 用 Playwright MCP 访问 http://localhost:3000/skills
# 在 page console 用 vi.stubGlobal('petriDesktop', { skills: {...mock...} })
```

适合：PHASE 1 早期接通 UI 数据层（用 fixture 数据验证 4 个 page 渲染）

### 定向单元测试

```bash
npm run test:files --prefix frontend -- useSkillStore.test.ts
npm run test:files -- test/skills-sdk.test.mjs   # backend SDK
```

### 真实 Electron IPC（BLOCK-2 显式 widen 时启用）

```bash
PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev
```

### 4 个治理门禁（每次 commit 前必跑）

```bash
npm run docs:check             # sub-5s
npm run ui:audit:check         # sub-5s
cd frontend && npx tsc --noEmit  # sub-10s
npm run docs:reconcile         # sub-5s
```

✅ 4 门禁 PHASE 0 终态全 GREEN（Agent C 已验证）。`npm run check` / `npm run test:all:workspace` 默认不跑（PHASE 0 摸底时确认耗时数分钟，留发布前/CI）。

---

## 4. 对 Agent B 报告的修正

### 修正 1：preload.js 不是单一 `petri` world，而是**双重 expose**

| 行号 | world 名 | 暴露内容 |
|---|---|---|
| 21 | `'petri'` | 仅 `agentWorkbenchFlags` |
| 61 | `'petriDesktop'` | 9 个桌面桥（isDesktop / window / app / aiSettings / computeSettings / harnessCapabilities / plugins / contentPlugins / terminal / updater） |

Agent B 仅看了行 21，没看行 61，错误地推断出"preload 用 `'petri'`，与 electron.d.ts 的 `'petriDesktop'` 不匹配"。

### 修正 2：项目里所有 `petriDesktop.*` 桥**都已接通**，**只有 skills 断**

| 桥 | electron.d.ts | preload.js | main.js | renderer |
|---|---|---|---|---|
| aiSettings / plugins / computeSettings / harnessCapabilities / contentPlugins / terminal / updater / window / app | ✅ | ✅（在 `petriDesktop` 第二份对象里） | ✅ | ✅ |
| **skills** | ✅ **L114-150** | ❌ **缺失** | ❌ **缺失** | ⚠️ 调 `getBridge('skills')` 拿 null |

→ PHASE 1 改动面比 B 报告"PHASE 1 rewire"暗示的小**一个数量级**：不需要新 IPC 命名（`skills:list` / `skills:invoke` 等），直接对齐 electron.d.ts 声明的 `discover` / `execute` / `getExecution` 3 个 hook + 1 个新 onProgress 推送。

---

## 5. 风险与开放决策

### 5.1 已识别风险（PHASE 1 须处理）

| 风险 | 严重度 | PHASE 1 缓解 |
|---|---|---|
| `WorkflowEngine.cancel` 只翻 flag（不真正 abort in-flight `sdk.executeSkill`） | 中 | 包装 `SkillRuntime.cancel`（已具备 `workflowRuntime?.cancel` 转发 + 持久化）；PHASE 1 暴露给 renderer 的 `cancel` 只调 `SkillRuntime` 层 |
| 零 progress 事件（workflow-engine / skill-runtime / skills-sdk 都没 EventEmitter） | 中 | PHASE 1 在 `src/main.js` 包装 `SkillRuntime.execute` 后，启动一个 `setInterval` (e.g. 1s) diff `execCtx.checkpoints[]`，变化时 `webContents.send('skills:progress', ...)` |
| `executionId` 生命周期绑定 `main.js` uptime（无 SQLite 持久化、无 resume） | 低 | PHASE 1 仅做 in-memory 演示，resume 留后续工作包（Agent A 已建议落 SQLite，PHASE 1 不阻塞） |
| 4 agent 报告中的路径/契约错误 | 低 | 主 agent 已在 §4 修正；PHASE 1 主 agent 直接按修正后路径执行 |

### 5.2 用户决策请求（PHASE 1 启动前需确认）

#### 决策 1：PHASE 1 范围边界（推荐 P1-A）

- **P1-A（推荐）**：只做 §2 列的 4 项改动（preload + main + useSkillStore polling → push + 新 test 文件）；4 治理门禁 GREEN 后即完成 PHASE 1。
- **P1-B**：P1-A + 把 `desktop.css:1889-1897` 残留 dead comment 清扫 + 把 `useSkillStore` 拆分为 reducer / actions / selectors（架构清理）。
- **P1-C**：P1-A + 把 cancel flag-only 真正改为 abort 语义（侵入 `core/shared-backend/workflow-engine.js`，超出 BLOCK-2 范围）。

#### 决策 2：测试执行方式（推荐 P1-T-A）

- **P1-T-A（推荐）**：默认 Vite-only + Playwright MCP + mock bridge；真实 IPC 留到 BLOCK-2 widen 时
- **P1-T-B**：PHASE 1 就跑 `npm run dev:electron` + 真实 IPC（耗时 +10min/E2E）

---

## 6. 验证证据链

- **UI-161**：B 报告（449 行）+ D 报告（278 行）+ 主 agent grep 交叉验证 + `git log 01c5e0b..HEAD -- <4 files>` 空
- **IPC 桥缺口**：B 报告 + 主 agent grep `preload.js` 全文件 + `electron.d.ts` 行 114-150 全文 + `main.js` `ipcMain.handle` 全清单（行 1161-1842）
- **backend DAG**：A 报告 + 主 agent `core/shared-backend/{workflow-engine, skill-runtime, skills-sdk}.js` grep 验证 cancel / executeSkill / module.exports
- **构建环境**：C 报告 + 主 agent `tsconfig.json` 行 14 `strict: true` / 行 12 `noEmit: true` 验证
- **useSkillStore 状态**：B 报告 + 主 agent `useSkillStore.ts` 行 173 `getBridge('skills')` / 行 175 返回 `'skills bridge unavailable'` / 行 580 `__resetSkillStoreCacheForTests` 已导出

---

## 7. 结论

**PHASE 0 摸底已完成，4 治理门禁 GREEN，UI-161 intact，IPC 桥缺口精确（仅 `petriDesktop.skills`），backend SkillsSDK 已就绪仅缺 main.js 单例装配。**

**PHASE 1 改动面 ~305 行（preload +15 / main +80 / useSkillStore ±10 / 新 test +200），无需新 IPC channel 命名，对齐 electron.d.ts 现有 3 个 hook + 1 个新 push 事件。**

**等待用户对 §5.2 决策 1（范围 P1-A / P1-B / P1-C）+ 决策 2（测试方式 P1-T-A / P1-T-B）的选择，然后启动 PHASE 1。**
