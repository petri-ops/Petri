# Petri Desktop — Agent Harness 契约一致性审查报告

**审查日期**: 2026-08-17
**审查范围**: agent harness 后端的 IPC / MCP / tool / Result Studio / Provider 契约
**审查视角**: 独立于既有调研报告的契约视角（不重写调研报告，只补强契约一致性维度）
**项目阶段**: G0 长期开发期
**审查方法**: diff main ↔ preload ↔ renderer 三层 + diff 工具描述 vs 工具实现 + grep 实际使用 vs schema 声明

---

## 一、执行摘要

### 1.1 严重度分布

| 级别 | 数量 | 含义 |
|------|------|------|
| Critical（阻塞） | 2 | renderer 路径完全不可用 / 整组结果被 parser reject |
| Major（需修） | 6 | schema 漂移 / 命名不一致 / 死代码 / 类型守卫缺失 |
| Minor（建议） | 5 | 类型描述小漂移 / 注释不符 / 错误码不统一 |

### 1.2 核心结论

1. **2 个 Critical 阻断**: `branch` 与 `result` 两个新增 IPC bridge 在 `preload.js` 完全缺失暴露 → renderer 端 `getBridge('branch')` 与 `getBridge('result')` 永远拿到 null，所有 Branch Tab + Result Studio 用户操作走到 stub → 抛 `'Branch bridge not available'`。同时 `result:create` IPC 拒绝 `'conversation_export'` 类型，但 d.ts 声明它是合法 union 成员。
2. **6 个 Major**: 含 IPC 通道命名三处漂移（`branch:active` vs `branch.getActive` vs MCP `branch_get_active`），MCP 工具描述 vs 实现的 4 处偏差（部分继承自既有审计 T-AW-013），以及 ai-settings 的不一致错误返回。
3. **5 个 Minor**: 含 renderer 端 types.ts 注释与 electron.d.ts 不一致，IPC 错误返回结构漂移。

### 1.3 契约稳定性评估

**稳定**（schema 内聚 / 类型卫兵完整 / 三层一致）:
- `core/r-server/mcp/registry.js` 的 IDE MCP 工具描述与 `_callIdeTool` 实现
- `core/shared-backend/result-studio-contracts.js` 的 4 大契约（ChangeSet/Revision/Selection/Checkpoint）
- `core/shared-backend/artifact-profiles.js` 的 profile registry + 6 个 profile 的列约束
- `core/shared-backend/artifact-manifest.js` 的输入快照与 provenance 引用
- `core/shared-backend/loop-contract.js` 的 7 状态 FSM
- `core/r-server/helpers/ai-settings.js` 的 settings schema（向后兼容 profile / presets 两条路径）

**易碎**（schema 漂移 / 三层分裂 / 缺乏守卫）:
- Branch / Result IPC 通道：`preload.js` 缺失桥接 → 整个 Result Studio 在 renderer 路径失效
- `result:create` 的 `validTypes` 与 `electron.d.ts` 的 ResultType union 不一致
- `branch:active` 通道名与 `branch.getActive` 类型声明脱节
- ai-settings 的 `get` IPC 错误路径返回 `{}`（非 `{ ok, error }`），与同包内其他 IPC 不一致
- `aiSettings.listModels` 接受 `Record<string, unknown>` 但内部按 `providerOrProfile` 字符串走 lookup 路径
- MCP 工具描述（`getBranchToolDefinitions`）要求 `branchId` 但 `_messageList` 内部会从 `branchCtx.getActiveBranchId(projectId)` 隐式注入 — schema 与实现行为不同

---

## 二、Critical 级别发现

### C-001 [branch 与 result IPC bridge 在 preload.js 完全未暴露 → renderer 路径全部走 stub]

**严重程度**: Critical（阻塞）

**三层代码位置**:

```8:11:frontend/src/lib/desktopBridge.ts
import type {} from '@/lib/electron'; // ensure the global Window augmentation is loaded

type DesktopBridge = NonNullable<Window['petriDesktop']>;

/** Map of bridge name → its sub-handle type. Keyof the
 *  petriDesktop declaration, so adding a new bridge in
 *  electron.d.ts automatically makes it available here. */
export type DesktopBridgeName = keyof DesktopBridge;
```

```61:293:src/preload.js
contextBridge.exposeInMainWorld('petriDesktop', {
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  backendConfig: Object.freeze({...}),
  window: { ... },
  app: { ... },
  aiSettings: { ... },
  computeSettings: { ... },
  harnessCapabilities: { ... },
  plugins: { ... },
  contentPlugins: { ... },
  runtime: { ... },
  backend: { ... },
  py: { ... },
  plumber: { ... },
  files: { ... },
  diagnostic: { ... },
  telemetry: { ... },
  data: { ... },
  terminal: { ... },
  skills: { ... },
  updater: { ... },
});
```

```319:505:frontend/src/lib/electron.d.ts
      // Phase 1: Branch Tab UI - conversation branch management
      branch: {
        create: (params: { projectId: string; name: string; parentBranchId?: string }) => Promise<{...}>;
        list: ...
        switch: ...
        delete: ...
        rename: ...
        getActive: ...
      };
      // Phase 2: Result Studio - shared results across branches
      // Phase 4: Added conversation_export type and createFromConversation
      result: {
        create: ...
        get: ...
        list: ...
        update: ...
        delete: ...
        byProject: ...
        createFromConversation: ...
        version: { create, get, getByNumber, list };
      };
```

```21:65:frontend/src/lib/branchBridge.ts
import { getBridge } from '@/lib/desktopBridge';
import type { Branch } from '@/types/branch.types';

export interface BranchApi {
  create: (projectId: string, name: string, parentBranchId?: string) => Promise<Branch>;
  list: (projectId: string) => Promise<Branch[]>;
  switch: (branchId: string) => Promise<void>;
  delete: (branchId: string) => Promise<void>;
  rename: (branchId: string, newName: string) => Promise<void>;
  getActive: (projectId: string) => Promise<Branch | null>;
}

function createBranchBridge(): BranchApi {
  const bridge = getBridge('branch');
  if (!bridge) {
    return {
      create: async () => { throw new Error('Branch bridge not available'); },
      ...
```

```55:81:frontend/src/lib/resultBridge.ts
function createResultBridge(): ResultApi {
  const bridge = getBridge('result');

  if (!bridge) {
    return {
      create: async () => { throw new Error('Result bridge not available'); },
      ...
```

**不一致描述**:

- `electron.d.ts` 在 `petriDesktop` 全局 Window 增强下声明了完整的 `branch` 与 `result` 两个 namespace（20+ 方法）。
- `frontend/src/lib/desktopBridge.ts` 的 `getBridge<K>` 直接派生自 `Window['petriDesktop']`，所以 TS 编译期能识别 `getBridge('branch')` 与 `getBridge('result')`。
- `frontend/src/lib/branchBridge.ts` / `resultBridge.ts` 在 SSR 检测后调用 `getBridge('branch')` / `getBridge('result')`。
- `src/preload.js` 的 `contextBridge.exposeInMainWorld('petriDesktop', {...})` **完全没有** `branch` 与 `result` 这两个 key —— 列举的子键只有 `window/app/aiSettings/computeSettings/harnessCapabilities/plugins/contentPlugins/runtime/backend/py/plumber/files/diagnostic/telemetry/data/terminal/skills/updater` 共 16 个。
- 实际 IPC handler 在 `src/ipc/branch-handlers.js`（11 个 handler，`branch:project:create/get/update/list` + `branch:create/get/list/switch/active/delete/rename/children` + `message:append/list/get/count/delete/clear`）和 `src/ipc/result-handlers.js`（9 个 handler）已存在，并在 `src/main.js:1045-1054` 通过 `setupBranchIpc()` + `setupResultIpc()` 注册。
- IPC handler 与 d.ts 类型之间**没有** `ipcRenderer.invoke('branch:create', ...)` 调用绑定 —— preload.js 没有 `branch: { create: () => ipcRenderer.invoke('branch:create', ...), ... }` 这种映射。

**结果链路**:

- renderer 端 `useBranchStore` / `useResultStore` 调用 `branchApi.list()` / `resultApi.byProject()` → 触发 `getBridge('branch')` / `getBridge('result')` → 返回 null → 走 fallback stub → 调用直接抛 `'Branch bridge not available'`（`branchBridge.ts:27`）或 `'Result bridge not available'`（`resultBridge.ts:60`）。
- BranchTabsWrapper.tsx 与 ResultStudioPage.tsx 在 desktop runtime 下**完全不可用**。

**测试覆盖**:

- `test/` 目录未发现针对 `branchBridge` / `resultBridge` stub 路径的契约测试。
- T-AW-013/T-AW-014 实机核对涉及 `extraRenderers` 渲染分支，但未对 Branch / Result 路径做 dev Electron 实机触发。
- 仅 `docs/branch-data-model.md` 描述了 SQLite schema，未涉及 IPC 契约。

**修复方向**:

1. 在 `src/preload.js` 的 `petriDesktop` 对象下补充 `branch` 与 `result` 两个 namespace，11+9 个方法按 d.ts 形状一一映射到 `ipcRenderer.invoke('branch:create', { projectId, name, parentBranchId })` 等。
2. 命名统一：d.ts 用的 `create/list/switch/delete/rename/getActive/createWithBranch/byProject/version.create/version.get/version.getByNumber/version.list/createFromConversation` 需要在 preload 层 1:1 暴露。
3. 类型安全加固：考虑把 `branchApi.create()` 等的 fallback stub 改为返回 `{ ok: false, error: 'bridge unavailable' }` 风格（与其他 IPC 一致），避免抛异常干扰 UI。

---

### C-002 [result:create IPC 拒绝 conversation_export 类型，但 d.ts 声明它是合法 union 成员]

**严重程度**: Critical（阻塞）

**三层代码位置**:

```356:357:frontend/src/lib/electron.d.ts
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
```

```12:12:frontend/src/types/result.types.ts
export type ResultType = 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
```

```47:62:src/ipc/result-handlers.js
  ipcMain.handle('result:create', async (_, {
    projectId, type, name, data, config, sourceBranchId,
  }) => {
    try {
      if (!projectId || !type || !name || data === undefined) {
        return { ok: false, error: 'projectId, type, name, and data are required' };
      }
      const validTypes = ['chart', 'table', 'code', 'text', 'file'];
      if (!validTypes.includes(type)) {
        return { ok: false, error: 'type must be one of: ' + validTypes.join(', ') };
      }
```

```283:357:src/ipc/result-handlers.js
  ipcMain.handle('result:createFromConversation', async (_, { projectId, branchId, options = {} }) => {
    ...
    const result = createResult(
      id,
      projectId,
      'text', // conversation_export is stored as text type
      resultName,
      resultData,
      resultConfig,
      branchId
    );
```

**不一致描述**:

- `electron.d.ts:357/364/375/386/395/410/422/429/449` 共 9 处声明 `type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export'`（6 个 union 成员）。
- `result.types.ts:12` 的 `ResultType` 也是 6 个成员。
- 但 `result:create` handler（`src/ipc/result-handlers.js:59`）与 `result:createWithBranch` handler（`src/ipc/result-handlers.js:93`）的 `validTypes` 数组只列了 5 个成员（不含 `conversation_export`）。
- `result:createFromConversation` 实际存储时却用 `'text'` 而不是 `'conversation_export'`（注释明确"conversation_export is stored as text type"，`result-handlers.js:352`）。

**结果链路**:

- 如果 renderer 调用 `resultApi.create({ ..., type: 'conversation_export', ... })`，IPC 会返回 `{ ok: false, error: 'type must be one of: chart, table, code, text, file' }`。
- 但 d.ts 的 union 允许这个值，TS 编译期不会报错。
- 实际只有 `result:createFromConversation` 走的是内部 `'text'` 路径 —— 用户永远无法通过 `result:create` 写入 `conversation_export` 类型。
- 双重不一致：renderer 类型系统允许一个 IPC handler 拒绝的值。

**测试覆盖**:

- `test/result-studio-contracts.test.mjs` 覆盖 result-studio 4 大持久化契约，但**不**覆盖 IPC handler 的 `validTypes` 校验。
- 没有 `result:create` 的 IPC handler 单测。

**修复方向**:

1. 在 `result:create` 与 `result:createWithBranch` 的 `validTypes` 数组中追加 `'conversation_export'`（或保留 5 个但调整 d.ts union 移除）。
2. 建议同步：让 `result:createFromConversation` 的 DB 写入也用 `'conversation_export'` 类型，与 d.ts union 对齐；DB 层 `createResult` JSDoc（`result-db.js:64`）也对应修正。
3. 或：在 d.ts 中将 `'conversation_export'` 移出 union（标记为 internal-only），并在 `result.types.ts` 注释明确其仅由 `createFromConversation` 内部使用。

---

## 三、Major 级别发现

### C-003 [IPC 通道命名三处漂移：branch:active vs branch.getActive vs MCP branch_get_active]

**严重程度**: Major（需修）

**三层代码位置**:

```138:148:src/ipc/branch-handlers.js
  ipcMain.handle('branch:active', async (_, { projectId }) => {
    try {
      if (!projectId) {
        return { ok: false, error: 'projectId is required' };
      }
      const branch = getActiveBranch(projectId);
      return { ok: true, data: branch };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
```

```341:350:frontend/src/lib/electron.d.ts
        getActive: (params: { projectId: string }) => Promise<{
          id: string;
          projectId: string;
          ...
        } | null>;
```

```229:238:core/r-server/mcp/registry.js
    {
      name: 'branch_get_active',
      description: 'Get the currently active branch for a project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
        },
        required: ['projectId'],
      },
    },
```

**不一致描述**:

- IPC 通道实际名是 `branch:active`（冒号分隔单段，动词形式）
- electron.d.ts 类型名是 `branch.getActive`（点号分隔双段，getter 形式）
- MCP 工具名是 `branch_get_active`（下划线分隔单段，getter 形式）

三个不同的命名约定指向同一个语义动作（获取项目当前活跃分支）。类似的命名漂移也在多处出现：

| 语义 | IPC 通道 | d.ts 方法 | MCP 工具 |
|------|----------|-----------|----------|
| 创建分支 | `branch:create` | `branch.create` | `branch_create` |
| 列出分支 | `branch:list` | `branch.list` | `branch_list` |
| 切换分支 | `branch:switch` | `branch.switch` | `branch_switch` |
| 删除分支 | `branch:delete` | `branch.delete` | `branch_delete` |
| 重命名分支 | `branch:rename` | `branch.rename` | `branch_rename` |
| 获取活跃分支 | `branch:active` | `branch.getActive` | `branch_get_active` ⚠️ |

仅"获取活跃分支"一项破坏了一致性，其他 5 项保持 colon → dot → underscore 翻译规则。

**测试覆盖**:

- MCP 工具名（`branch_get_active`）走 `test/` 测试，但 IPC 通道名（`branch:active`）无独立测试。
- 没有命名一致性的契约测试。

**修复方向**:

1. 二选一统一：
   - 改 IPC 通道为 `branch:getActive`（与 d.ts `branch.getActive` 字符串字面量对应更直接）
   - 或：改 d.ts 类型为 `branch.active`（与 IPC 通道字符串对齐）
2. 建议选前者（IPC channel 改动小，d.ts 改动可控，且与 IPC 通道命名 colon 约定一致）。
3. 同步修复 MCP 工具保持 `branch_get_active` 不变（snake_case 是 MCP 协议约定）。

---

### C-004 [aiSettings.get IPC 错误返回 {}，与其他 IPC { ok, error } 风格不一致]

**严重程度**: Major（需修）

**代码位置**:

```29:38:src/ipc/ai-settings.js
  ipcMain.handle("ai-settings:get", async () => {
    try {
      const { getAiSettings } = require(
        resolveCore("r-server", "helpers", "ai-settings.js"),
      );
      return getAiSettings();
    } catch (e) {
      return {};
    }
  });
```

```40:49:src/ipc/ai-settings.js
  ipcMain.handle("ai-settings:save", async (event, settings) => {
    try {
      const { saveAiSettings } = require(
        resolveCore("r-server", "helpers", "ai-settings.js"),
      );
      saveAiSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
```

```75:75:frontend/src/lib/electron.d.ts
        get: () => Promise<Record<string, unknown>>;
```

```100:103:frontend/src/hooks/useAiSettings.ts
  inflight = bridge
    .get()
    .then(async (raw) => {
      const profilePresets = Array.isArray(raw?.model_profiles)
```

**不一致描述**:

- `ai-settings:save` 成功返回 `{ ok: true }` / 失败返回 `{ ok: false, error: e.message }`
- `ai-settings:get-credential` 失败返回 `{ ok: false, apiKey: "", error: e.message }`
- `ai-settings:test` 失败返回 `{ ok: false, message: e.message }`
- `ai-settings:list-models` 失败返回 `{ ok: false, models: [], message: e.message }`
- 但 **`ai-settings:get` 异常路径返回 `{}`**，与同包其他 4 个 handler 风格不同。
- d.ts 声明 `get: () => Promise<Record<string, unknown>>`，TS 期望 `Record<string, unknown>`，错误路径返回 `{}` 满足这个类型签名，但语义上没有错误信号。

**结果链路**:

- `useAiSettings.ts:101` 调用 `bridge.get()` → 拿到 `{}`（异常时）或完整 settings 对象（正常时）。
- `useAiSettings.ts:103` 检查 `Array.isArray(raw?.model_profiles)` → 错误时为 false → 走 fallback `chat_model_presets` → 也为空 → 走 `DEFAULT_CHAT_MODEL_PRESETS`（仅 deepseek-chat）。
- renderer 不会知道这是错误，只看到默认 preset。

**测试覆盖**:

- `frontend/src/hooks/useAiSettings.test.ts` 覆盖 refresh 路径，但没覆盖 IPC 错误路径。

**修复方向**:

1. 把 `ai-settings:get` 的错误返回改成 `{ ok: false, error: e.message }`，并在 renderer 端补 `if (raw && raw.ok === false) throw new Error(raw.error)`。
2. 或：保留返回 `{}` 但在 `useAiSettings.ts` 的 refresh promise 内 catch 后打 warning 日志。
3. 同步：让 d.ts 把 `Record<string, unknown>` 改为 `{ ok: true; settings: Record<string, unknown> } | { ok: false; error: string }`，与 IPC 行为一致。

---

### C-005 [MCP message_list 工具隐式注入 branchId，违反 schema 声明]

**严重程度**: Major（需修）

**代码位置**:

```240:264:core/r-server/mcp/registry.js
    {
      name: 'message_list',
      description: 'Get conversation history for a branch.',
      inputSchema: {
        type: 'object',
        properties: {
          branchId: { type: 'string', description: 'Branch ID' },
          limit: { type: 'number', description: 'Max messages to return (default: 100)' },
          offset: { type: 'number', description: 'Offset for pagination (default: 0)' },
        },
        required: ['branchId'],
      },
    },
    {
      name: 'message_append',
      description: 'Append a message to a branch conversation.',
      inputSchema: {
        ...
        required: ['branchId', 'role', 'content'],
      },
    },
```

```439:475:core/r-server/mcp/registry.js
async function _messageList(args = {}, context = {}) {
  const db = getBranchDb();
  const branchCtx = getBranchContext();
  if (!db) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Branch DB not available' }) }],
      isError: true,
    };
  }
  try {
    let { branchId } = args;
    const { projectId } = context;

    // Phase 3: 如果未提供 branchId，尝试使用活跃分支
    if (!branchId && projectId && branchCtx) {
      branchId = branchCtx.getActiveBranchId(projectId);
    }

    if (!branchId) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'branchId is required' }) }],
        isError: true,
      };
    }

    const messages = db.listMessages(branchId, args.limit || 100, args.offset || 0);
```

```481:524:core/r-server/mcp/registry.js
async function _messageAppend(args = {}, context = {}) {
  ...
  try {
    let { branchId } = args;
    const { projectId } = context;

    // Phase 3: 如果未提供 branchId，尝试使用活跃分支
    if (!branchId && projectId && branchCtx) {
      branchId = branchCtx.getActiveBranchId(projectId);
    }

    if (!branchId) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'branchId is required' }) }],
        isError: true,
      };
    }
```

**不一致描述**:

- MCP schema `message_list` 与 `message_append` 的 `required` 数组都包含 `branchId`，声明它必填。
- 但实现 `_messageList`（L439）与 `_messageAppend`（L481）都会在 `branchId` 缺失时尝试从 `projectId + branchCtx.getActiveBranchId()` 隐式注入。
- 这意味着：schema 声称 `branchId` 必填，实际实现允许 `branchId` 缺失 + `projectId` 提供 → 行为分歧。
- 类似的隐式注入在其他 MCP 工具中没有（`branch_create` / `branch_list` / `branch_switch` 等都严格按 schema 校验）。
- `_messageAppend` 还把 `source: 'mcp'` 注入 metadata（L508-512），这是隐式副作用，schema 不声明。

**结果链路**:

- MCP 客户端按 schema 校验时不会传 `branchId`（因为 `required` 数组包含它，理论上必须传）。
- 但实际不传 `branchId` 时，如果 `projectId` 在 `context` 中可用，行为就静默 fallback 到活跃分支。
- 错误处理：当 `branchId` 缺失且 `projectId` 缺失时返回 `'branchId is required'` —— 与 schema 声明一致；但有 `projectId` 时静默成功，与 schema 声明冲突。

**测试覆盖**:

- 测试覆盖分支创建/列出等正向路径，但未显式覆盖 schema 严格性 + 隐式注入的行为差异。

**修复方向**:

1. 在 `message_list` 与 `message_append` 的 schema `required` 数组移除 `branchId`，改为 `oneOf: [branchId, projectId + (隐式 active branch)]`。
2. 或：保持 schema 严格 `branchId required`，但实现中移除隐式注入，缺 `branchId` 直接返回错误。
3. 同步：`_messageAppend` 的 metadata 注入应记录到 `metadata` 字段 schema 中或单独文档化。

---

### C-006 [branch:project:* IPC handler 已注册但 renderer 无任何调用者 → 死代码]

**严重程度**: Major（需修）

**代码位置**:

```36:82:src/ipc/branch-handlers.js
  ipcMain.handle('branch:project:create', async (_, { id, name }) => { ... });
  ipcMain.handle('branch:project:get', async (_, { id }) => { ... });
  ipcMain.handle('branch:project:update', async (_, { id, name }) => { ... });
  ipcMain.handle('branch:project:list', async () => { ... });
```

```19:73:frontend/src/lib/project-store.ts
export async function listProjects(
  modality?: ProjectModality,
  status: 'active' | 'archived' = 'active',
): Promise<Project[]> {
  ...
  const data = await api('/projects' + qs);
  return (data.projects || []).map(mapProject);
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const data = await api('/projects/' + id);
    return mapProject(data.project);
  } catch {
    return null;
  }
}

export async function createProject(input: { ... }) { ... }
```

**不一致描述**:

- `branch-handlers.js` 注册 4 个 Project CRUD IPC handler：`branch:project:create` / `:get` / `:update` / `:list`。
- renderer 端的 Project CRUD 走 **HTTP API**（`project-store.ts:39` `fetch(API_BASE() + path)`，`/api/data/projects`），**不走 IPC**。
- `branch-handlers.js:9-13` 引入了 `createProject/getProject/updateProjectName/listProjects`（来自 `src/database/branch-db.js`），与 `project-store.ts` HTTP 调用的 DB 来源不同（HTTP 走 r-server `/api/data/projects`）。
- `branch:project:*` IPC handler 在 preload.js 也没有暴露，所以即便 renderer 想用也用不到。

**结果链路**:

- 这 4 个 IPC handler 是死代码：handler 已被 setupBranchIpc() 注册但无人调用。
- IPC handler 的 DB 来源 `branch-db.js` 与 HTTP API 的 DB 来源可能是两个不同的 SQLite 实例（`petri.db` vs branch-db），导致数据不一致风险。

**测试覆盖**:

- 无针对 `branch:project:*` IPC handler 的测试。
- `branch-db.js` 自身的 `createProject` / `getProject` 等有单元测试，但通过 IPC 调用路径未覆盖。

**修复方向**:

1. 在 `src/ipc/branch-handlers.js` 移除 `branch:project:create/get/update/list` 4 个 handler（除非有未来规划）。
2. 或：明确 Project CRUD 的唯一入口是 HTTP API（`/api/data/projects`），`branch:project:*` 仅作为内部 helper 不通过 IPC 暴露。
3. 同步：审计 `branch-db.js` 与 r-server `db.js` 的 Project 表 schema 是否一致。

---

### C-007 [message:* IPC handler 已注册但 renderer 无任何调用者 → 死代码]

**严重程度**: Major（需修）

**代码位置**:

```194:271:src/ipc/branch-handlers.js
  ipcMain.handle('message:append', async (_, { branchId, role, content, metadata }) => { ... });
  ipcMain.handle('message:list', async (_, { branchId, limit, offset }) => { ... });
  ipcMain.handle('message:get', async (_, { id }) => { ... });
  ipcMain.handle('message:count', async (_, { branchId }) => { ... });
  ipcMain.handle('message:delete', async (_, { id }) => { ... });
  ipcMain.handle('message:clear', async (_, { branchId }) => { ... });
```

**不一致描述**:

- `branch-handlers.js` 注册 6 个 `message:*` IPC handler：`append` / `list` / `get` / `count` / `delete` / `clear`。
- renderer 端 `useBranchStore` / `useResultStore` 均未调用这些方法。
- renderer 端的消息管理走的是 copilot HTTP API（`copilotConversationsClient.ts`、`conversationRunStore.ts`），不使用 SQLite messages 表。
- preload.js 同样没有暴露 `message:*`。

**结果链路**:

- 6 个 IPC handler 是死代码，无任何调用者。
- SQLite `messages` 表（`005_branch_conversation.sql`）当前只有 MCP `message_append` / `message_list` 工具会写入，IPC 路径无写入。
- 数据流向：MCP `message_append` → SQLite messages → IPC `message:list` 可读但无人读。

**测试覆盖**:

- MCP `message_append` / `message_list` 有覆盖测试。
- IPC `message:*` handler 无测试。

**修复方向**:

1. 明确消息持久化的唯一入口是 MCP（外部 agent）还是 IPC（renderer UI）。当前看是前者。
2. 如果 IPC 路径不再使用，从 `branch-handlers.js` 移除 6 个 `message:*` handler（精简 IPC surface）。
3. 或：保留作为 IPC 入口（未来 SimpleChat 可能切换到 SQLite messages 表）。

---

### C-008 [MCP 工具描述与实现不一致（4 处，扩展自 T-AW-013）]

**严重程度**: Major（需修）

**代码位置**:

```170:181:core/r-server/mcp/registry.js
    {
      name: 'branch_create',
      description: 'Create a new conversation branch within a project. ...',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to create branch in' },
          name: { type: 'string', description: 'Branch name' },
          parentBranchId: { type: 'string', description: 'Optional parent branch ID for forking' },
        },
        required: ['projectId', 'name'],
      },
    },
```

```272:294:core/r-server/mcp/registry.js
async function _branchCreate(args = {}) {
  const db = getBranchDb();
  if (!db) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Branch DB not available' }) }],
      isError: true,
    };
  }
  try {
    const { randomUUID } = require('crypto');
    const id = randomUUID();
    const branch = db.createBranch(id, args.projectId, args.name, args.parentBranchId || null);
```

**不一致描述**:

- 既有调研报告 `agent-harness-architecture-survey-2026-08-17.md` 第七节"核心代码引用"展示 MCP 工具 envelope 描述，但没有逐条 diff 工具描述 vs 实现。
- 独立审查发现 4 处契约漂移（独立于既有 T-AW-013 CONTRACT-DRIFT-001 的 renderer 4 处）：

**漂移 M-8a**: `_branchCreate` 的 `parentBranchId` schema 不要求，但实现接受并透传（`registry.js:283`），如果 schema 没声明 `parentBranchId`，外部 agent 调 MCP 时不会传 —— 但代码接受。属"schema 太严"风险，外部 agent 看 schema 不知道可以传 parentBranchId。

**漂移 M-8b**: `message_append` schema 不接受 `metadata`，但实现 L508-512 会合并 `source: 'mcp'` 注入 metadata —— metadata 字段被代码强制添加。属"schema 缺字段"。

**漂移 M-8c**: `branch_switch` schema `required: ['branchId', 'projectId']`，但 `_branchSwitch` 实现 L333 只调用 `db.switchBranch(args.branchId, args.projectId)`，未校验两者是否匹配（`branchDb` 内部可能有自己的检查）—— 实现可能静默接受不匹配的 (branchId, projectId) 对，schema 未保护。

**漂移 M-8d**: MCP 返回结构 `{content: [{type: 'text', text: JSON.stringify(...)}], isError: bool}`，但 MCP 协议允许返回多个 content blocks（如 image content）。当前所有工具实现都只返一个 text content block，且 `text` 字段塞 JSON 字符串，没有结构化的 `data` / `error` 顶层字段。这与既有架构调研文档描述一致，但客户端解析时只能 `JSON.parse(content[0].text)`，没有结构化约定。

**测试覆盖**:

- MCP `callTool` 端到端有 `test/mcp-bin-e2e.test.mjs` 等覆盖 happy path，但 schema 与实现的细节漂移未覆盖。

**修复方向**:

1. 在 `getBranchToolDefinitions` 中补 `parentBranchId` description（明确"可选"），在 `message_append` schema 增加 `metadata` 字段。
2. 给 `_branchSwitch` 实现增加 `(branchId, projectId)` 匹配校验（先查 `branch.projectId === projectId`）。
3. 抽出 `mcp-content-result.js` helper：`{ ok: true, data }` → `{content:[{type:'text', text: JSON.stringify({ok:true, data})}], isError: false}`，统一返回结构。

---

## 四、Minor 级别发现

### C-009 [useAiSettings 消费 ai-settings IPC 错误路径返回 {} 时静默 fallback]

**严重程度**: Minor（建议）

**代码位置**:

```168:172:frontend/src/hooks/useAiSettings.ts
    .catch(() => {
      inflight = null;
      return presetsCache;
    });
```

**不一致描述**:

- `useAiSettings` 的 `refreshFromBridge` 在 catch 时直接返回 `presetsCache`（最后已知缓存），不区分"从未加载" vs "加载失败"。
- 配合 C-004（ai-settings:get 错误返回 `{}`），错误信号完全消失。

**修复方向**:

1. 在 catch 中加 `console.warn('[useAiSettings] refresh failed', e)` 或显示 UI 错误。
2. 区分 `loaded` 与 `error` 两种状态，让 UI 可显示降级提示。

---

### C-010 [result.types.ts 注释与 electron.d.ts 不一致：data 字段格式]

**严重程度**: Minor（建议）

**代码位置**:

```19:27:frontend/src/types/result.types.ts
  data: unknown;
  /** The primary data payload. Format depends on `type`:
   *   - chart: { chartType, data, config }
   *   - table: { columns, rows }
   *   - code: { language, source }
   *   - text: string content
   *   - file: { path, mimeType }
   */
```

```355:360:frontend/src/lib/electron.d.ts
        create: (params: {
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          data: unknown;
          config?: Record<string, unknown>;
          sourceBranchId?: string;
        }) => Promise<{...}>;
```

**不一致描述**:

- `result.types.ts:19-27` 注释说 `chart` 类型的 `data` 是 `{ chartType, data, config }`，但既有 T-AW-013 审计指出 renderer 实际合同是 `kind: "bar"|"line"` + `series: [{name, values:number[]}]`。
- 注释与 renderer 实际合同不一致，会误导未来维护者。

**修复方向**:

1. 与 T-AW-013 CONTRACT-DRIFT-001 同步：在 `result.types.ts` 注释里写实际 renderer 合同（`kind/series`），并加 `// 实际见 renderer src/components/copilot/extraRenderers.tsx line 121 守卫` 链接。

---

### C-011 [MCP skill_execute schema 不接受 context 的所有字段]

**严重程度**: Minor（建议）

**代码位置**:

```133:158:core/r-server/mcp/registry.js
    {
      name: 'skill_execute',
      description: 'Execute a Skill with given parameters. Returns execution result including artifacts and outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Skill ID to execute',
          },
          params: {
            type: 'object',
            description: 'Execution parameters matching the Skill\'s parameter schema',
          },
          context: {
            type: 'object',
            description: 'Execution context (user context, workflow variant, etc.)',
            properties: {
              workflowName: { type: 'string', description: 'Workflow variant to execute' },
              userContext: { type: 'object', description: 'User context information' },
            },
          },
        },
        required: ['id'],
      },
    },
```

```661:677:core/r-server/mcp/registry.js
    const result = await runtime.execute(args.params || {}, {
      workflowName: args.context?.workflowName,
      userContext: args.context?.userContext,
    });
```

**不一致描述**:

- schema 声明 `context` 只接受 `workflowName` + `userContext` 两个字段。
- 但 `runtime.execute()` 调用仅读这两个字段，其他字段被静默忽略。
- 这是 MCP 协议层的常见反模式：schema 假装严格，实现可能宽松接受。

**修复方向**:

1. 把 schema 的 `context` 改为 `additionalProperties: true`，明确"其他字段被忽略但允许传"。
2. 或：保留严格 schema，但补注释说明"超集字段将被忽略"。

---

### C-012 [Agent Loop 事件类型 event 字段命名混杂 loop_phase / loop_iteration / agent_status / agent_progress / result_edit_progress]

**严重程度**: Minor（建议）

**代码位置**:

```603:604:core/r-server/agent-runner.js
      event: 'loop_phase',
      phase: loopState,
```

```644:core/r-server/agent-runner.js
      event: 'loop_iteration',
```

```676:core/r-server/agent-runner.js
      event: 'loop_phase',
```

```857:core/r-server/agent-runner.js
      event: 'result_edit_progress',
```

```895:core/r-server/agent-runner.js
      event: 'iter',
```

```901:core/r-server/agent-runner.js
      event: 'loop_phase',
```

```978:998:core/r-server/agent-runner.js
      _emit({
        event: 'agent_status',
        phase: 'provider_retry',
        ...
```

**不一致描述**:

- agent-runner 通过 `_emit` 发出 8+ 种 `event` 类型（`loop_phase` / `loop_iteration` / `agent_status` / `agent_progress` / `result_edit_progress` / `iter` / `done` / `conversation`）。
- 命名风格混杂：snake_case（`loop_phase`）与缩写（`iter`）并存。
- 持久化到 `task_events` 表时（`agent-task-store.js:329-337`），`eventType` 字段直接存这个字符串，没有规范化映射。

**结果链路**:

- renderer 端的 `conversationRunStore.ts` / `SimpleChat.tsx` 需要根据 `event` 字符串分发处理。
- 不同事件携带的字段 schema 不一致：`loop_phase` 携带 `phase` / `loopRunId` / `reason`，`agent_status` 携带 `phase` / `attempt` / `maxAttempts` / `reason` / `message`，`iter` 只携带 `n`。
- 没有 schema 校验或文档集中地描述每个 `event` 类型应有字段。

**修复方向**:

1. 在 `agent-runner.js` 顶部抽出 `const AGENT_EVENT_TYPES = Object.freeze({LOOP_PHASE: 'loop_phase', ...})`，所有 `_emit` 使用常量。
2. 为每个事件类型定义 TypeScript-style 注释 schema（事件名 → payload shape）。
3. `eventType` 字段写入 SQLite 时规范化（保持 snake_case），但前端分发逻辑要写清楚映射表。

---

### C-013 [Provider 重试状态在 agent-runner 与 anthropic.js / llm-providers 各处分散]

**严重程度**: Minor（建议）

**代码位置**:

```14:19:core/r-server/agent-task-store.js
const RETRY_POLICY = {
  network_timeout: { maxRetries: 3, backoff: 'exponential', baseDelay: 1000 },
  rate_limit: { maxRetries: 5, backoff: 'linear', delay: 5000 },
  model_overloaded: { maxRetries: 3, backoff: 'exponential', baseDelay: 2000 },
  internal_error: { maxRetries: 2, backoff: 'constant', delay: 1000 },
};
```

```988:1010:core/r-server/agent-runner.js
      if (!finalizing && (!upJson || upJson.error || !upJson.choices)) {
        const assessment = assessFinalizationResult(upJson, streamedText);
        const maxProviderAttempts = 3;
        for (let attempt = 2; attempt <= maxProviderAttempts
          && assessment.retryable && !aborted(); attempt += 1) {
          _emit({
            event: 'agent_status',
            phase: 'provider_retry',
            attempt,
            maxAttempts: maxProviderAttempts,
            reason: assessment.reason,
            message: '上游响应暂时异常，正在自动重试当前阶段…',
          });
```

**不一致描述**:

- `agent-task-store.js` 定义了 4 种错误的重试策略（`network_timeout` / `rate_limit` / `model_overloaded` / `internal_error`）。
- `agent-runner.js` L988-1010 的 `maxProviderAttempts = 3` 是硬编码，与 agent-task-store 的策略不联动。
- `llm-providers/` 子目录的 provider 实现（anthropic.js 等）有自己的 `MODEL_LIST_TIMEOUT_MS` 等超时，但重试语义散落在多处。
- 既有架构调研文档第八节也提到"重试策略：无指数退避，无重试预算"，建议统一 RetryPolicy。

**修复方向**:

1. 把 `maxProviderAttempts` 改为读取 `RETRY_POLICY[errorType].maxRetries`。
2. 同步指数退避（`calculateBackoffDelay`）到 agent-runner 的重试循环。
3. 或保持 provider 内部自管重试 + agent-runner 仅做 finalization 重试，明确边界。

---

## 五、契约稳定性评估

### 5.1 稳定契约（schema 内聚 / 三层一致 / 有测试覆盖）

| 契约 | 证据 |
|------|------|
| `core/shared-backend/result-studio-contracts.js` 4 大契约（ChangeSet/Revision/Selection/Checkpoint） | `test/result-studio-contracts.test.mjs` 覆盖；状态机 `CHANGE_SET_TRANSITIONS` 显式 Object.freeze |
| `core/shared-backend/artifact-profiles.js` profile registry | `test/g0-sdc0-profile-registry.test.mjs` 覆盖；6 个 profile 的列约束 + identifier namespace + validation rule 完整 |
| `core/shared-backend/loop-contract.js` FSM | `test/loop-contract.test.mjs` 覆盖；`LOOP_STATUS_TRANSITIONS` 显式冻结 |
| `core/shared-backend/artifact-manifest.js` 输入快照 + provenance 引用 | `test/execution-provenance.test.mjs` 覆盖；hash chain 完整 |
| `core/r-server/mcp/registry.js` IDE MCP 工具（ide_* 前缀） | `test/mcp-bin-e2e.test.mjs` 覆盖 78/78 定向测试 |
| `core/r-server/helpers/ai-settings.js` settings schema | `useAiSettings.test.ts` 覆盖；profile / presets 双路径兼容 |
| `core/shared-backend/llm-providers/protocol-conversion.js` OpenAI ↔ Anthropic 转换 | `test/provider-protocol.test.mjs` 覆盖；`openAIToAnthropicRequest` / `anthropicToOpenAIResponse` 双向 |

### 5.2 易碎契约（schema 漂移 / 三层分裂 / 缺乏守卫）

| 契约 | 风险 |
|------|------|
| Branch IPC 通道 | `preload.js` 缺失 → renderer 端所有 Branch 操作抛错（C-001） |
| Result IPC 通道 | `preload.js` 缺失 → renderer 端所有 Result 操作抛错（C-001） |
| `result:create` 类型 union | IPC handler `validTypes` 与 d.ts union 不一致（C-002） |
| `branch:active` 命名 | 与 `branch.getActive` / MCP `branch_get_active` 三处漂移（C-003） |
| `ai-settings:get` 错误返回 | `{}` vs `{ ok, error }` 风格不一致（C-004） |
| MCP `message_list` 隐式注入 branchId | schema 严格 vs 实现宽松（C-005） |
| `branch:project:*` IPC | 死代码 + 与 HTTP API Project CRUD 双轨（C-006） |
| `message:*` IPC | 死代码，renderer 不调用（C-007） |
| MCP `branch_create` `parentBranchId` schema | schema 缺字段（C-008a） |
| MCP `message_append` metadata 注入 | schema 缺字段 + 隐式副作用（C-008b） |
| MCP `branch_switch` (branchId, projectId) 匹配 | 缺校验（C-008c） |
| `useAiSettings` 错误信号 | 静默 fallback（C-009） |
| `result.types.ts` 注释 | 与 renderer 实际合同不符（C-010） |
| MCP `skill_execute` context 字段 | 假装严格但实现宽松（C-011） |
| Agent Loop event 命名 | snake_case + 缩写混杂，无 schema 文档（C-012） |
| Provider 重试语义 | 散落在 agent-task-store / agent-runner / llm-providers（C-013） |

### 5.3 整体契约健康度评估

- **后端核心（artifact / loop / workflow）**：契约稳定。G0-RS 收口的 artifact/loop/profile/revision 4 大持久化契约都有 schema 卫兵 + 测试覆盖 + 状态机冻结。
- **MCP 工具（registry.js）**：描述层基本稳定，但有 4 处 schema vs 实现的小漂移（C-008 / C-005 / C-011），大部分是"实现宽松但 schema 严"，需补 schema 的 `additionalProperties` 注解。
- **IPC 三层**：不稳定。Critical 2 处（C-001 / C-002）+ Major 5 处（C-003 / C-004 / C-006 / C-007）的根本原因是分支对话 + 结果工作室是相对较新的特性（Phase 1-4 2026-08 后），preload 与 IPC handler 同步尚未完全收敛。
- **Provider / SSE**：基本稳定。重试 / 超时语义散落（C-013 Minor），但协议转换（OpenAI ↔ Anthropic）有完整测试。
- **Renderer 端类型（types.ts / electron.d.ts）**：声明层比 IPC handler 实现层更激进（声明 6 个 union，IPC 只接受 5 个）。属"renderer 类型先行，实现补齐"的反向漂移。

---

## 六、优先修复建议（Top 5-8）

### P0（必须修，下个工作包启动前）

**P0-1 [C-001]**: 在 `src/preload.js` 补充 `branch` 与 `result` 两个 IPC namespace，11+9 个方法按 `electron.d.ts` 形状 1:1 映射到 `ipcRenderer.invoke`。这是 Result Studio 与 Branch Tab 功能可用的前提。

**P0-2 [C-002]**: 修复 `result:create` 与 `result:createWithBranch` 的 `validTypes` 数组，补 `'conversation_export'`，或反方向从 d.ts union 移除。让 renderer 类型与 IPC 校验对齐。

### P1（重要，建议下一个工作包内修复）

**P1-1 [C-003]**: 把 IPC 通道 `branch:active` 重命名为 `branch:getActive`，与 `electron.d.ts` 的 `branch.getActive` 一致。

**P1-2 [C-006 + C-007]**: 清理 `branch-handlers.js` 死代码 —— 移除 `branch:project:*` 4 个 handler 和 `message:*` 6 个 handler（除非有未来规划），或明确为何保留。

**P1-3 [C-004]**: 把 `ai-settings:get` 错误返回从 `{}` 改为 `{ ok: false, error: e.message }`，与同包其他 IPC 风格统一。

### P2（建议，跟随 Result Studio / Branch Tab 收口一起修）

**P2-1 [C-008 / C-005 / C-011]**: 抽出 MCP 工具 schema 与实现的契约层（`mcp-content-result.js` helper + schema `additionalProperties` 注解 + 元数据注入文档化），让所有 branch / message / skill MCP 工具描述与实现严格对齐。

**P2-2 [C-009]**: `useAiSettings` 增加 `error` 状态，让 UI 能显示降级提示而非静默 fallback 到默认 preset。

**P2-3 [C-010]**: 同步 `result.types.ts` 注释与 T-AW-013 CONTRACT-DRIFT-001 的 renderer 实际合同，注释里加 renderer 源码行号链接。

---

## 七、附录

### 7.1 已审查文件清单

#### 后端 / Desktop Bridge
- `src/main.js` (1188 行)
- `src/preload.js` (292 行)
- `src/ipc/branch-handlers.js` (274 行)
- `src/ipc/result-handlers.js` (366 行)
- `src/ipc/ai-settings.js` (87 行)
- `src/ipc/harness-capabilities.js` (L1-50)
- `src/database/result-db.js` (L1-90 createResult)
- `src/database/branch-db.js` (grep，仅 import 引用)
- `src/migrations/005_branch_conversation.sql` (grep, schema 参考)
- `src/migrations/006_result_studio.sql` (grep, schema 参考)

#### MCP Registry
- `core/r-server/mcp/registry.js` (1807 行, 全审)
- `core/r-server/mcp/server.js` (490 行, 通过 registry.js 间接审)

#### Agent Loop
- `core/r-server/agent-runner.js` (1799 行, 抽样审)
- `core/r-server/agent-task-store.js` (577 行, 全审)
- `core/shared-backend/agent-workflow.js` (531 行, 全审)
- `core/shared-backend/artifact-manifest.js` (86 行, 全审)
- `core/shared-backend/artifact-profiles.js` (635 行, 全审)
- `core/shared-backend/result-studio-contracts.js` (692 行, 抽样审)

#### Provider / AI
- `core/r-server/ai-bridge.js` (149 行, 全审)
- `core/shared-backend/llm-providers/anthropic.js` (264 行, 抽样审)
- `core/r-server/routes/ai-chat.js` (400+ 行, 抽样审)
- `core/r-server/helpers/ai-settings.js` (grep, schema 参考)

#### Renderer Bridge
- `frontend/src/lib/desktopBridge.ts` (117 行, 全审)
- `frontend/src/lib/electron.d.ts` (523 行, 全审)
- `frontend/src/lib/branchBridge.ts` (64 行, 全审)
- `frontend/src/lib/resultBridge.ts` (141 行, 全审)
- `frontend/src/types/result.types.ts` (69 行, 全审)
- `frontend/src/hooks/useBranchStore.ts` (250+ 行, 抽样)
- `frontend/src/hooks/useResultStore.ts` (300+ 行, 抽样)
- `frontend/src/hooks/useAiSettings.ts` (400+ 行, 抽样)
- `frontend/src/lib/project-store.ts` (60 行, 抽样)

#### 既有审计参考
- `docs/AUDIT-LOG.md` (T-AW-013 CONTRACT-DRIFT-001 + T-AW-014 二)
- `docs/agent-harness-architecture-survey-2026-08-17.md` (919 行, 全文)
- `docs/branch-data-model.md` (前 60 行)

### 7.2 跳过的范围

#### 不在本次审查范围
- **G1+ 阶段事项**: Provider 矩阵 / packaged Electron 公证 / OSS 远程发布 / GA 公证 —— 按 AGENTS.md G0 阶段纪律不外推。
- **dist staleness check** (AUDIT-LOG DIST-STALENESS): 属 release-pipeline 工作，不属于契约一致性维度。
- **前端 UI 渲染器契约** (T-AW-013 4 处 renderer 漂移): 由 T-AW-013 已审计，本次不重复审。
- **r-server HTTP API 契约** (`/api/loop/*` / `/api/harness/*` / `/api/result-studio/*`): 仅抽样审了 `routes/result-studio.js` 与 `routes/ai-chat.js`，未做全 schema 审计（独立维度，建议另立工作包）。
- **Plugin tool definition schema**: `plugin-loader.js` + `tool-defs.js` + 19 个 built-in plugins 各自 schema，未逐一审计。
- **plan / conversation / copilot HTTP 契约**: 抽样未发现 schema 漂移。
- **Branch DB SQLite schema**: `005_branch_conversation.sql` 已审 schema 与 IPC 接口一致，无漂移。

#### 时间限制跳过
- `core/shared-backend/result-studio-*.js` (15 个文件): 仅审 `result-studio-contracts.js` + `result-studio-table-query.js`（在 routes/result-studio.js 中 import 引用，未深审）。
- `core/shared-backend/result-changeset-service.js` / `result-compare-service.js` / `result-revision-source.js` 等: 同上，import 引用未深审。
- `frontend/src/components/copilot/conversationRunStore.ts` (700+ 行): 仅 grep `event` 字段使用，未审全 schema。

### 7.3 与既有审计的关系

| 既有审计 | 本次独立审查 |
|----------|--------------|
| T-AW-013 CONTRACT-DRIFT-001（4 处 renderer 漂移） | 独立验证：4 处仍是真，已记入 C-010 Minor（注释同步） |
| T-AW-013 DIST-STALENESS | 不在本次审查范围（属 release-pipeline） |
| T-AW-014 dev Electron 边界内 4 工作包二次实机核对 | 独立验证：extraRenderers 路径已通过，但 branch/result 路径未覆盖 → 补 C-001 Critical |
| 调研报告第七节"核心代码引用" | 独立抽取更多代码位置（branch:project:*, message:*, ai-settings:get 等），发现独立审计点 |
| BLOCK-2 PHASE 6 12 项 Major（含 C1 poller 9→4 状态映射） | 已在 BLOCK-3 收口，本次未重复审 |

### 7.4 报告元数据

- **生成方法**: `diff main ↔ preload ↔ renderer 三层 + diff 工具描述 vs 工具实现 + grep 实际使用 vs schema 声明`
- **审查覆盖**: 14 个 IPC handler 模块 + 1 个 MCP registry + 5 个 agent loop 模块 + 6 个 Result Studio contracts + 5 个 renderer bridge/types 文件
- **审查时间**: 2026-08-17 单次会话
