# PHASE 0 子代理综合 inbox

最后更新：2026-08-16（4 agent 并行摸底中）

主 agent 收到单 agent 完成时登记在此；PHASE 0 全部完成后做综合判断。

## ✓ Agent B 完成（IPC + store 审计）

**报告**: `agent-transcripts/phase-0-agent-b-ipc-store-audit.md`（449 行 / 35345 bytes）

### 核心断言（已 100% 验证）

1. **renderer 端有声明但 IPC 桥完全未接通**
   - `frontend/src/lib/electron.d.ts` 行 114-115 声明 `window.biof3Desktop.skills.{discover, execute, getExecution}`
   - `frontend/src/hooks/useSkillStore.ts` 行 19 `import { getBridge } from '@/lib/desktopBridge'`；行 173 `const bridge = getBridge('skills')`；行 175 返回 `'skills bridge unavailable'`
   - `src/preload.js` grep "skill" 0 命中；`src/main.js` grep "skill" 0 命中

2. **renderer-side contract 完全稳定** — PHASE 1 rewire 不动 UI
   - 4 个 page（S kills/index + SkillCard + SkillDetail + SkillSearch）只 consume `useSkillStore` 从不直接 IPC
   - 4 个 IPC channel 应**对齐** `discover` / `execute` / `getExecution` 三个现有 hook
   - `useSkillStore` 内部 `_startPolling` 2 秒 polling 应被新 push channel (`skills:progress`) 替代

3. **UI-161 5/5 PASS**（B 已核对）
   - SkillsSidebar.tsx + .module.css 已删
   - LeftPanel.tsx 行 125-133 QuickActions 含 Skills（sparkles icon）
   - pages/skills/index.tsx 行 107-115 返回首页按钮
   - styles/custom.css 行 74/83/85/86 4 tokens 全部在；dark-mode 行 192/194 override

4. **零 Skills 测试** — `find frontend/src -name "*.test.*" | xargs grep -l skill` 0 命中
   - 但 `usePluginStore.test.ts` 175 行存在，可作模板

5. **desktop.css 行 1889-1897 残留 2 块 dead comment**（UI-161 清理遗留），无害；但 PHASE 1 之后可顺手清扫

### B 关键发现对 plan §4 PHASE 1 的修正

| 我原 plan | B 摸底后正确版本 |
|---|---|
| "新建 4 个 IPC channel：`skills:list` / `skills:invoke` / `skills:status` / `skills:progress`" | **对齐现有 3 个 hook 契约**：`discover` / `execute` / `getExecution`；新增 1 个 push channel 替代 polling |
| "useSkillStore 调用 mock/fixture" | useSkillStore 已调用 `getBridge('skills')` 返回 `'skills bridge unavailable'`；rewire 即接 preload + main 即可 |
| "desktopBridge.ts 暴露新方法" | electron.d.ts 已有完整声明，desktopBridge.ts 通过 `getBridge('skills')` 已自动可调；**只缺 preload + main** |
| "preload 暴露 4 个新方法" | preload 用 `'biof3'` 作为 world 名；electron.d.ts 用 `'biof3Desktop'` 做全局名 — **存在命名不一致**，PHASE 1 必须决定：统一到 `biof3Desktop`，或维持 `biof3` 局部 |

### 关键命名不一致（待 PHASE 0 整合 + 用户裁决）

- `src/preload.js` 行 21 `contextBridge.exposeInMainWorld('biof3', { ... })` — world 对象名 `biof3`
- `frontend/src/lib/electron.d.ts` 声明的全局接口名 `biof3Desktop` — 不一样的字！
- `frontend/src/lib/desktopBridge.ts` 引用 `Window['biof3Desktop']` — 用的是 `biof3Desktop`

**这意味着即便我们接通 `biof3.skills.*` 在 preload，renderer 端也找不到 `window.biof3Desktop.skills`，因为 world 名不同。**

必须先解决此不一致：
- 方案 A：改 preload.js 行 21 `exposeInMainWorld('biof3Desktop', ...)` — 顺应 electron.d.ts 声明
- 方案 B：改 electron.d.ts 把 `biof3Desktop` 改名 `biof3` — 风险大（影响 6+ bridge 调用）
- 方案 C：preload 双重 expose 同一个对象到 `biof3` + `biof3Desktop` — 权宜

需要其他 agent 摸清 `biof3` 与 `biof3Desktop` 各自被哪些文件引用，才决策。

## ⏳ Agent A 进行中（backend DAG 引擎契约）

预计完成时间：几分钟后

等待输出：`agent-transcripts/phase-0-agent-a-backend-contract.md`

## ⏳ Agent C 进行中（构建 + 测试环境）

预计完成时间：几分钟后

等待输出：`agent-transcripts/phase-0-agent-c-build-env.md`（含 ts / ui:audit / docs:check / docs:reconcile 终态）

## ⏳ Agent D 进行中（UI-161 清理验证）

预计完成时间：几分钟后

等待输出：`agent-transcripts/phase-0-agent-d-ui161-verification.md`

---

## 🛠 主 agent 修正 Agent B 的 2 处错误断言（2026-08-16 16:12）

B 报告 §"key finding"第 1 条原文写：
> `electron.d.ts` declares `window.biof3Desktop.skills.{discover, execute, getExecution}` and `useSkillStore` calls `getBridge('skills')`, but `src/preload.js` has zero `skills` references and `src/main.js` has zero `skill`/`skills` references

后半段正确，**前半段正确但不够完整**：B 没核对 preload 的 `exposeInMainWorld` 有几次、命名如何对应。

### 修正 1：preload 不是单一 `biof3` world —— 有双重 expose

`src/preload.js` 实际结构（已 100% 验证）：

| 行号 | world 名 | 暴露内容 |
|---|---|---|
| 21 | `'biof3'` | **仅** `agentWorkbenchFlags`（Agent 标志位特例） |
| 61 | `'biof3Desktop'` | 桌面版全部桥：`isDesktop / platform / window / app / aiSettings / computeSettings / harnessCapabilities / plugins / contentPlugins / terminal / updater` |

`useSkillStore.getBridge('skills')`（`desktopBridge.ts` 行 99）走 `window.biof3Desktop.skills`，对应 preload 第二份 expose。**`biof3Desktop.skills` 在 preload 里**确实**不存在**（grep 0 命中）—— 这是 B 报告唯一正确的部分。

### 修正 2：项目里所有 `biof3Desktop.*` 桥都已经接通，**只有 skills 断**

| 桥 | electron.d.ts | preload.js | main.js | renderer |
|---|---|---|---|---|
| aiSettings | ✅ | ✅ L99-106 | ✅ | ✅ |
| computeSettings | ✅ | ✅ L109-113 | ✅ | ✅ |
| harnessCapabilities | ✅ | ✅ L116-118 | ✅ | ✅ |
| plugins | ✅ | ✅ L121-138 | ✅ | ✅ |
| contentPlugins | ✅ | ✅ L142+ | ✅ | ✅ |
| terminal | ✅ | ✅ | ✅ | ✅ |
| updater | ✅ | ✅ | ✅ | ✅ |
| window | ✅ | ✅ L68-87 | ✅ | ✅ |
| **skills** | ✅ **L114-150** | ❌ **缺失** | ❌ **缺失** | ⚠️ 调用 `getBridge('skills')` 拿 null |

### 修正 3：PHASE 1 真实改动面（远小于 B 报告"PHASE 1 rewire"暗示）

PHASE 1 实际只需要：

1. **`src/preload.js`**（单文件，~10 行）：
   - 在 `biof3Desktop` 第二份 `exposeInMainWorld` 对象里加 `skills` 子块
   - 对齐 `electron.d.ts` L114-150 声明的 3 个 hook：`discover / execute / getExecution`
   - 1 个事件订阅：`onProgress`（替代 renderer 的 2 秒 polling）
2. **`src/main.js`**（单文件，~80 行）：
   - 顶部 `require` 引入 `skills-sdk.js`（`core/shared-backend/skills-sdk.js` L448）
   - 创建 `SkillsSDK` 单例 + 注入 `WorkflowEngine`
   - 注册 3 个 `ipcMain.handle`：`skills:discover / skills:execute / skills:getExecution`
   - 注册 1 个事件推送：`webContents.send('skills:progress', ...)`（订阅 SDK 内部 / 包装 SkillRuntime）
3. **`frontend/src/hooks/useSkillStore.ts`**（1 处）：
   - 改 1 行：`_startPolling` → 订阅 `window.biof3Desktop.skills.onProgress(...)`（消除 2 秒 polling）
4. **`frontend/src/hooks/useSkillStore.test.ts`**（新文件，~200 行）：
   - 镜像 `usePluginStore.test.ts`（195 行模板），用 `vi.stubGlobal('biof3Desktop', {...})`

**完全不需要：**
- ❌ 修 `electron.d.ts`（已是 source of truth）
- � 修 `desktopBridge.ts`（已用 `getBridge('skills')` 通了）
- ❌ 修 4 个 page（S kills/index + SkillCard + SkillDetail + SkillSearch）（只 consume store）
- ❌ 修 `LeftPanel.tsx` / `custom.css`（UI-161 5/5 已 intact）
- ❌ 命名统一（B 报告担心的"biof3 vs biof3Desktop"不存在；preload 已经双重 expose 到 `biof3Desktop`）

### PHASE 1 测试策略（C 已给出）

- 默认 **Vite-only + Playwright MCP** 跑 `http://localhost:3000/skills`，mock `window.biof3Desktop.skills` bridge（用 `vi.stubGlobal` 或 window-bridge fixture）
- 真实 IPC 走 `npm run test:changed` + `npm run test:files --prefix frontend -- useSkillStore.test.ts`
- 真实 backend SkillsSDK 单元测试：`test/agent-workflow.test.mjs` 已存在可扩展
- 真实 Electron 启动仅在 BLOCK-2 显式 widen 范围时启用 `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"`

### 治理门禁基线（C 已给出，全部 GREEN）

- `npm run docs:check` — sub-5 s
- `npm run ui:audit:check` — sub-5 s
- `cd frontend && npx tsc --noEmit` — sub-10 s
- `npm run docs:reconcile` — sub-5 s

PHASE 1 每次 commit 前必跑这 4 个。`npm run check` / `npm run test:all:workspace` 默认不跑，留发布前 / CI。
