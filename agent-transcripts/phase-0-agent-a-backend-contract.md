# BLOCK-2-UI-157-REVIEW · Phase 0 Agent A — Backend DAG Engine Contract

**Date:** 2026-08-16
**Scope:** Read-only analysis of `core/shared-backend/workflow-engine.js` to inform PHASE 1 IPC bridge design.
**Worker:** subagent A (Agent A)

---

## §1 File Inventory

### Primary subject
- `core/shared-backend/workflow-engine.js` — **688 lines** (re-confirmed via `wc -l`).
  - Defines two classes: `Workflow` (single execution instance) and `WorkflowEngine` (loader / orchestrator).
  - Exports a factory `createWorkflowEngine(options)` and five frozen enums.
  - Module top-level structure: `require` -> constants block -> helpers (`readJson`, `generateId`, `deepGet`) -> `Workflow` class -> `WorkflowEngine` class -> factory -> `module.exports`.

### Sibling files in `core/shared-backend/` (one-line role each)

Skill-facing neighbours that the engine depends on or is depended on by:

| File | Role |
|------|------|
| `skills-sdk.js` | Higher-level wrapper exposing `SkillsSDK` (`listSkills`, `getSkill`, `executeSkill`, `executeWorkflow`, `toMcpToolList`, `handleMcpCall`). Constructor accepts `workflowEngine` and `pluginManager` and threads them into `SkillRuntime`. |
| `skill-registry.js` | In-memory skill discovery (built-in / installed / marketplace). Exports `SkillRegistry`, `createRegistry`, `discoverSkills`, `loadBuiltInSkills`, `loadInstalledSkills`, `validateSkillManifest`, `parseSkillManifest`, `loadSkillFromDir`. |
| `skill-runtime.js` | Single-skill executor. 1128 lines. Owns per-execution state (`Map<executionId, ExecutionContext>`), exposes `execute / resume / cancel / getExecutionStatus / listExecutions`. Calls `workflowEngine.execute(...)` via `SkillRuntime.execute` path **not** directly — instead it calls `this.workflowEngine.currentWorkflowJobId` and `workflowRuntime?.cancel` (referenced in `cancel()`); reads `workflowRuntime` as injected `workflowEngine` ref. |
| `skill-schema.js` | Skill Manifest validator (re-exported under `SkillSchema` / `validateSkillManifest` / `applySkillDefaults`). |
| `tool-registry.js` | Tool registry (Layer 4 → Layer 3 → Layer 2 plumbing). |
| `agent-workflow.js` | Earlier workflow pattern referenced in the engine's docblock — superseded by `workflow-engine.js`. |
| `git-repository-binding.js`, `git-repository-consent-schema.js`, `git-adapter.js` | Git-side helpers (not used by engine). |
| `execution-provenance.js`, `execution-context.js` | Execution context / provenance helpers. |
| `result-*` (many) | Result Studio modules (out of scope for this review). |
| `loop-*` (controller, checkpoint, validators, etc.) | Loop layer (calls into Skills + execution). |
| `capability-provisioning.js`, `capability-bundles.js` | Capability provisioning layer invoked by `SkillRuntime._checkDependencies`. |
| `plugin-sdk.js` | Plugin SDK surface. |
| `logger.js`, `error-log.js`, `ai-usage-helper.js`, `config-helper.js`, `runtime-paths.js`, `path-safe.js`, `redaction.js` | Cross-cutting helpers. |
| `index.js`, `init.js`, `package.json` | Package surface. |

### Cross-layer consumer
- `core/r-server/mcp/registry.js` — MCP tool definitions + handlers for `skill_discover`, `skill_get`, `skill_execute`. Uses `SkillRegistry` and `createSkillRuntime` directly (not `WorkflowEngine`). Mirrors the contract that PHASE 1 must expose to `main.js`.

### `src/main.js` IPC surface area
- **`ipcMain.handle` / `ipcMain.on` count:** ~50+ handlers (lines 1161–2099). Captured via `Grep "ipcMain\.(handle|on)"`.
- **`skill` / `workflow` token occurrences in `main.js`:** **zero** (confirmed by two `Grep` calls with `-i` flag and variants). No existing IPC handler is bound to skill or workflow today. **`main.js` does not currently import `skills-sdk.js` or `workflow-engine.js`.** That is a green field for PHASE 1.

### Tests
- `test/result-workflow-graph.test.mjs`, `test/harness-workflow-{fixtures,state,recovery}.test.mjs`, `test/agent-workflow-{phase6,}.test.mjs` — but **none** import `workflow-engine.js` directly (verified by `Grep "createWorkflowEngine|WorkflowEngine|workflow-engine"` within `test/` returning no matches). Harness / agent-workflow tests cover a different pattern.
- `frontend/src/**/*.test.*` — no `*skill*` or `*engine*` test files. Frontend currently has no skills/engine test surface.

---

## §2 Exported Surface (be exhaustive)

`module.exports` from `core/shared-backend/workflow-engine.js` (lines 674–688):

### 2.1 `WorkflowEngine` (class)

| Method | Signature | Returns | Purpose | Side effects | Sync / async | Error pattern |
|--------|-----------|---------|---------|--------------|--------------|---------------|
| `constructor(options)` | `({ sdk: SkillsSDK, workflowsDir?: string })` | `WorkflowEngine` | Stores `sdk` + `workflowsDir`. **Throws** if `options.sdk` is missing. | Initializes `Map manifest` and `Map execution`. | sync | `throw new Error('WorkflowEngine requires SkillsSDK instance')` |
| `loadWorkflow(manifest)` | `(manifest) => object\|null` | Normalized manifest or `null` | Validates `workflowManifestVersion === 1` and `id/steps` shape; persists to internal map. | Mutates `this._workflows`. | sync | Returns `null` on invalid input (no throw). |
| `loadWorkflowFromFile(filePath)` | `(string) => object\|null` | Manifest or `null` | Reads JSON file, then calls `loadWorkflow`. | FS read. | sync | Returns `null` on read error / parse failure / invalid. |
| `loadWorkflowsFromDir(dir)` | `(string) => object[]` | Array of loaded manifests | Iterates subdirs of `dir`, reads `<entry>/workflow.json`, registers each. | FS readdir + readFile. | sync | Silently skips missing dirs / invalid manifests. |
| `registerWorkflow(id, manifest)` | `(string, object) => boolean` | `true` if registered | Sugar for `loadWorkflow({...manifest, id})`. | Mutates `this._workflows`. | sync | Returns `false` if validation fails. |
| `listWorkflows()` | `() => object[]` | Array of normalized manifests | Returns values of `this._workflows`. | none | sync | n/a |
| `getWorkflow(id)` | `(string) => object\|null` | Manifest or `null` | `{id}` lookup. | none | sync | Returns `null` if absent. |
| `execute(workflowId, params, context)` | `(string, object, object) => Promise<object>` | Result object (see §3) | Resolves manifest (supports `skill:workflow` syntax via `_buildSkillInlineWorkflow`), constructs a `Workflow`, registers it in `this._executions`, runs `workflow.execute(params, context.userContext)`. | Mutates `this._executions`. | **async** | Returns `{ success:false, error:{code:'WORKFLOW_NOT_FOUND',...}, workflowId }` (not a throw). |
| `step(skillId, context)` | `(string, object) => Promise<object>` | Skill execution result | Backwards-compat single-step: `this.sdk.executeSkill(skillId, context.params || {}, context)`. | none | **async** | Propagates whatever `sdk.executeSkill` returns. |
| `cancel(executionId)` | `(string) => boolean` | `true` if cancelled | Sets `wf.status = CANCELLED` and `completedAt = now`. **Does NOT actually abort the running `await` inside `_executeStep`** — only marks the book-keeping state. | Mutates the `Workflow` instance. | sync | Returns `false` if no execution found. |
| `getExecution(executionId)` | `(string) => object\|null` | `{id, status, startedAt, completedAt, steps[]}` or `null` | Snapshot of execution state. | none | sync | Returns `null` if absent. |
| `_normalizeManifest(manifest)` | private | object | Defensive copy + defaults (`name`, `version`, `category`, `source`, `condition`, `inputs`, `outputs`, `error_handling`). | none | sync | n/a |
| `_buildSkillInlineWorkflow(skillId, workflowName)` | private | object\|null | Constructs a single-step manifest from a `Skill` so `skill:workflow` syntax works. | none | sync | Returns `null` if skill not found. |

### 2.2 `Workflow` (class) — also exported

This is the single execution unit. Normally constructed via `WorkflowEngine.execute`, but exported for testability.

| Method | Signature | Returns | Purpose | Side effects |
|--------|-----------|---------|---------|--------------|
| `constructor(manifest, options)` | `({ sdk, executor? }) => Workflow` | `Workflow` | Generates `id = 'wfe_<hex>'`, initial `status=CREATED`, empty `steps`/`context` maps. | none |
| `execute(params, userContext)` | `(object, object) => Promise<object>` | Result object (see §3) | Iterates `manifest.steps`, evaluates conditions, resolves inputs, executes each step, aggregates outputs, applies error policy. | Mutates `this.steps`, `this.context`, `this.status`, `this._lastError`. |

`_evaluateCondition`, `_evalExpr`, `_resolveInputs`, `_resolveValue`, `_collectOutputs`, `_getErrorPolicy`, `_executeStep`, `_buildResult` are private helpers.

### 2.3 `createWorkflowEngine(options)` factory

`(object) => WorkflowEngine`. Pure factory; returns `new WorkflowEngine(options)`. Options must include `sdk`.

### 2.4 Constant exports

| Constant | Values |
|----------|--------|
| `WORKFLOW_STATES` | `created`, `running`, `paused`, `complete`, `failed`, `cancelled` |
| `STEP_STATES` | `pending`, `skipped`, `running`, `complete`, `failed` |
| `ERROR_POLICIES` | `fail`, `warn_continue`, `skip_continue` |
| `CONDITION_TYPES` | `always`, `expr`, `step_success` |
| `WORKFLOW_MANIFEST_VERSION` | `1` |

All const maps are `Object.freeze`-d.

---

## §3 Skill DAG Execution Model

### 3.1 Entry / invocation flow

A single Skill is invoked via **`WorkflowEngine.step(skillId, context)`** (synchronous-to-promise wrapper that forwards to `sdk.executeSkill`). A full DAG is invoked via **`WorkflowEngine.execute(workflowId, params, context)`**:

1. `WorkflowEngine.execute(workflowId, params, context)` looks up `manifest` in `this._workflows`.
2. If absent and `workflowId.includes(':')`, it builds an inline single-step manifest via `_buildSkillInlineWorkflow(skillId, workflowName)` (effectively a sugar for executing one named workflow variant of a Skill).
3. Constructs `new Workflow(manifest, { sdk: this.sdk, executor: context.executor })`.
4. Registers the instance in `this._executions` (key = `workflow.id`, value = instance).
5. Awaits `workflow.execute(params, context.userContext || {})`.

Inside `Workflow.execute(params, userContext)`:
- Seeds `this.context.params` and `this.context.user_context`.
- Initializes a `StepExecution` per manifest step with `status=PENDING`.
- Sets `status=RUNNING`, `startedAt=now`.
- For each step:
  1. `evaluateCondition(step.condition)` — see §3.2.
  2. `resolveInputs(step.inputs, stepId)` — see §3.3.
  3. `_executeStep(step, resolvedInputs)` — either delegates to `this.executor` (test mock) or to `this.sdk.executeSkill(step.skill, inputs, { workflowName: step.workflow, userContext: this.context.user_context, stepId: step.id })`. If no `sdk` is supplied, returns `{success:false, error:{code:'SDK_NOT_AVAILABLE',...}}`.
  4. Collects step outputs into `context.step_outputs[stepId]` and alias mappings.
- Returns `_buildResult(success)` (see §3.4).

### 3.2 Conditions
- `'always'` or `undefined` → `true`.
- Unknown condition reference → conservatively `true` (don't skip).
- `STEP_SUCCESS` → true only if referenced step is `COMPLETE`.
- `EXPR` → evaluated via `_evalExpr` using a `new Function('context', 'params', 'return (...)')` sandbox. Rejects any token matching `/[;{}()]|=|\beval\b|\bfunction\b/i`. The expression is **not a sandboxed** environment; it has access to the full Node global module surface via `Function` constructor. Treat any user-supplied `expr` as untrusted.

### 3.3 Input resolution
- Strings of form `params.X[.Y...]` → `deepGet(context.params, ...)`.
- Strings of form `user_context.X[.Y...]` (or `userContext.X`) → `deepGet(context.user_context, ...)`.
- Strings whose head matches an existing `stepId` → `deepGet(stepExec.output, ...)`. **If the upstream step has no `output` yet (or is undefined), returns `undefined`** (i.e. silent loss — no error).
- Anything else → returned as the literal string.

### 3.4 Returned result shape

```js
{
  success: boolean,
  workflowId: 'wfe_<hex>',
  workflowManifestId: <manifest.id>,
  status: <WORKFLOW_STATES>,
  startedAt: ISOString,
  completedAt: ISOString,
  duration: number | null,           // ms
  steps: Array<StepExecution>,       // full view of all steps
  outputs: { [stepId: object] },    // copy of context.step_outputs
  params: { ... },                   // copy of context.params
  warnings: Array<{step, error}>,
  error: { message, stack } | null
}
```

### 3.5 Progress reporting
**None.** The engine does **not** implement `EventEmitter`, callbacks, polling tokens, or progress events. Step state is only visible after `execute()` resolves (or via `getExecution(executionId)` while it is running). The `getExecution` snapshot returns `{id, status, startedAt, completedAt, steps: [...]}` — `steps` is the same `Map` view; if a step is currently `RUNNING` you will see it, but there is no incremental event stream.

### 3.6 State persistence
**In-memory only.** Working state lives in:
- `WorkflowEngine._workflows` (Map of registered manifests).
- `WorkflowEngine._executions` (Map of currently-executing / recently-finished `Workflow` instances).
- Each `Workflow.steps` (Map of step state).
- Each `Workflow.context` (`{ params, user_context, step_outputs, groups, warnings? }`).

**No SQLite tables, no file writes, no checkpoint persistence in `workflow-engine.js`.** (The doc-block mentions "checkpoint / resume" but the engine does not implement checkpoint persistence. Any durability story lives in `loop-checkpoint.js` / `SkillRuntime._persistExecutionState`, which is independent.) Executions are dropped from `_executions` only when the engine instance is GC'd — there is no TTL or eviction.

### 3.7 Cancellation
- `WorkflowEngine.cancel(executionId)` flips the `Workflow` book-keeping state to `CANCELLED` and stamps `completedAt`.
- It **does not abort** the in-flight `await this.sdk.executeSkill(...)` inside `_executeStep`. The current step will still run to completion; only its result will be observed by an engine that has already returned. Therefore `cancel` is best understood as a *pollution-flag* rather than a true stop signal.
- By contrast, `SkillRuntime.cancel(executionId)` (in `core/shared-backend/skill-runtime.js`) marks the execution context and **forwards** to `this.workflowRuntime?.cancel(...)` if `currentWorkflowJobId` is set. It also persists state via `_persistExecutionState`. **PHASE 1 should prefer `SkillRuntime.cancel` over `WorkflowEngine.cancel` if true abort semantics are needed.**

---

## §4 IPC Surface Recommendation (for PHASE 1 main.js)

The contract below assumes `main.js` constructs a single shared `SkillsSDK` instance (via `createSkillsSDK` … or `createDefaultSDK`) and uses it for both skill and workflow surfaces. The SDK already wires `workflowEngine` when constructed with `{ workflowEngine }`.

### Bootstrap required in `main.js`

```js
const { createSkillsSDK, createDefaultSDK } = require('../core/shared-backend/skills-sdk');
const { createWorkflowEngine }            = require('../core/shared-backend/workflow-engine');

const sdk = createDefaultSDK();                  // or createSkillsSDK({...})
sdk.workflowEngine = createWorkflowEngine({ sdk });

// Optional: preload built-in workflows
sdk.workflowEngine.loadWorkflowsFromDir(/* path */);
```

`createDefaultSDK` (in `skills-sdk.js`) is the minimum-friction option: it constructs a fresh `SkillRegistry`, calls `discoverSkills()` (lazy load), and returns a `SkillsSDK`. The `SkillRegistry` itself exposes `discover()` / `get()` synchronously after `discoverSkills()` is awaited once.

If true abort semantics are required, construct a `SkillRuntime` per call (mirroring `core/r-server/mcp/registry.js::_skillExecute`) and route through `sdk.executeSkill` instead of `workflowEngine.execute`.

### Proposed IPC handlers

#### `skills:list` — invoke / handle

- **Input:** `{ filter?: { source?: 'built-in'|'installed'|'marketplace', category?: string, tag?: string } }` (all fields optional)
- **Output:** `{ skills: Array<SkillManifest> }` where each manifest has the shape produced by `SkillRegistry.discover()` (id, name, description, version, category, source, tags, parameters, etc.).
- **Source engine function:** `sdk.listSkills(filter)` (delegates to `registry.discover()` with post-filter).
- **Error mapping:** `try/catch` in `main.js`. Internal engine never throws on `listSkills`; only an unexpected exception (e.g. registry access) would surface. Map to `{ ok:false, error:{code:'SKILLS_LIST_FAILED', message} }`.
- **Alternative:** if you want to reuse the MCP layer, `_skillDiscover` in `core/r-server/mcp/registry.js` already returns the same data; recommend going directly through `sdk.listSkills` to avoid the `content: [{type:'text', text: JSON.stringify(...)}]` envelope.

#### `skills:invoke` — invoke / handle

- **Input:** `{ id: string, params?: object, context?: { workflowName?: string, userContext?: object, userContextFields?: object } }`
- **Output:** result of `sdk.executeSkill(id, params, ctx)` (see below). Optionally also accept `{ workflowId, params, context }` and route to `sdk.executeWorkflow(...)` when `workflowId` is present.
- **Source engine function:** `sdk.executeSkill(skillId, params={}, context={})`. Throws only if `runtime.execute` throws (validation errors). The function itself returns `{ success:false, error:{code:'SKILL_NOT_FOUND',...}, skillId }` on missing skill.
- **Error mapping:**
  - `success:false` → `{ ok:false, error: <error>, skillId }` (do not throw).
  - Thrown validation errors → `{ ok:false, error:{code:'SKILL_VALIDATION_FAILED', details:[...]} }`.
  - Unknown id → code `SKILL_NOT_FOUND`.
- **Async semantics:** this is a long-running call. `ipcMain.handle` awaits the promise; the renderer call should likewise `await window.api.invoke('skills:invoke', ...)` or use a streaming variant. Because Skill execution can take many seconds (or minutes), the frontend should treat the IPC as a long-poll and pair it with `skills:status` for re-hydration if the renderer is reloaded.

#### `skills:status` — invoke / handle

- **Input:** `{ executionId: string }` (the workflow execution id returned by `engines.execute`).
- **Output:** `{ execution: { id, status, startedAt, completedAt, steps:[...] } | null }`.
- **Source engine function:** `sdk.workflowEngine.getExecution(executionId)` (returns the snapshot shape; null if missing).
- **Use case:** Frontend polls when re-hydrating after a reload, or for a "running" indicator that survives F5. Because the engine is in-memory, polling is meaningful only on the same `main.js` lifetime; on restart the execution id is gone. **Document this lifetime explicitly.**
- **Recommended cadence:** no faster than 1s; debounce on the renderer side.

#### `skills:cancel` — invoke / handle

- **Input:** `{ executionId: string }`.
- **Output:** `{ cancelled: boolean }` (`true` if the engine knew the id and flipped its state).
- **Source engine function:** `sdk.workflowEngine.cancel(executionId)`. **Caveat:** as documented in §3.7, `WorkflowEngine.cancel` is a *flag*, not an abort. The currently running step in `SkillRuntime` will continue until it resolves.
- **Better source if you need true abort:** construct a `SkillRuntime` (`createSkillRuntime(skill, { registry, pluginManager, workflowEngine })`), call `runtime.execute(...)`, store the runtime + `executionId` in a per-call Map, and on cancel call `runtime.cancel(executionId)`. This forwards to `workflowRuntime.cancel(currentWorkflowJobId)` AND persists checkpoint state. **Recommend this path for PHASE 1.**
- **Error mapping:** missing id → `{ cancelled:false, reason:'UNKNOWN_EXECUTION' }`.

#### `skills:progress` — event (subscribe / emit)

- **Status:** **NOT SUPPORTED by `workflow-engine.js`.** No `EventEmitter`, no `on('progress')`, no progress tokens.
- **If progress is required for PHASE 1**, the only honest options are:
  1. **Polling** — frontend polls `skills:status` while `status === 'running'`.
  2. **Wrap `SkillRuntime.execute`** and emit your own `mainWindow.webContents.send('skills:progress', { executionId, stage, percent?, message? })` from a wrapper around `runtime.execute`. The engine itself does not give you a hard hook, but `SkillRuntime` exposes `getExecutionStatus(executionId)` and stores checkpoints in `execCtx.checkpoints[]` — you can diff these between awaits to synthesise progress events.
  3. **Defer progress** to a later phase and document the omission.
- **For the BLOCK-2-UI-157-REVIEW PHASE 1 minimum**, recommend polling `skills:status` rather than inventing a new event channel.

#### Additional methods worth adding

| Channel | Why |
|---------|-----|
| `skills:get` | `sdk.getSkill(id)` — return the full manifest incl. prompts / parameters schema. Needed by the UI to render the invoke form. |
| `skills:search` | `sdk.searchSkills(query)` — frontend search box. |
| `skills:canExecute` | `sdk.canExecute(id, context)` — pre-flight dependency check before opening the invoke form. |
| `skills:categories` | `sdk.getCategories()` / `sdk.getTags()` — populate filters. |
| `skills:stats` | `sdk.getStats()` — useful for dashboards. |
| `workflows:list` | `sdk.workflowEngine.listWorkflows()` — if Workflows are surfaced to UI as a separate entity. |
| `workflows:execute` | `sdk.executeWorkflow(workflowId, params, context)` — explicit workflow entry. |
| `workflows:status` | `sdk.workflowEngine.getExecution(executionId)` — same as `skills:status` but discoverable as workflow. |
| `workflows:cancel` | as above. |

`handleMcpCall` in `skills-sdk.js` already implements `list_skills`, `get_skill`, `search_skills`, `execute_skill`, `can_execute_skill` plus `skill:*` routing — **reuse this method** in `main.js` rather than reimplementing the dispatch:

```js
ipcMain.handle('skills:invoke', async (_e, { tool, args }) => {
  return sdk.handleMcpCall(tool, args);
});
```

This collapses `skills:get`, `skills:search`, `skills:canExecute`, `skills:list` to a single channel and keeps the contract aligned with the MCP layer.

---

## §5 Risks / Open Questions

### 5.1 Constructor / init requirements
- `WorkflowEngine` **throws** if `options.sdk` is missing. `main.js` must construct a `SkillsSDK` first (or pass a stub SDK for tests). The `SkillsSDK` constructor is forgiving (`registry: createRegistry()` fallback) but `runtimeFactory`, `workflowEngine`, `pluginManager`, `capabilityProvisioning` are all optional. **For PHASE 1 UI invocation, the minimum is `createDefaultSDK()` followed by `sdk.workflowEngine = createWorkflowEngine({ sdk })`.**
- `SkillsSDK` does not call `discoverSkills()` lazily under all paths. `createDefaultSDK()` forces `discoverSkills()` once; thereafter `sdk.listSkills()` re-reads from `registry.discover()` which is in-memory.

### 5.2 External dependencies
- `core/shared-backend/workflow-engine.js` has **no DB, no FS dependency beyond `readJson` + `loadWorkflowsFromDir`, and no network I/O**. Pure CPU module.
- `core/shared-backend/skill-registry.js` reads `resources/skills/manifest.json` (from `BUILT_IN_SKILLS_DIR`). That path is `path.join(__dirname, '..', '..', 'resources', 'skills')` — relative to `core/shared-backend/skill-registry.js`, which resolves to `desktop/resources/skills/`. **Confirm `resources/skills/manifest.json` exists in the packaged build** (currently it does in dev).
- `SkillRuntime.execute` may walk through `pluginManager` and `capabilityProvisioning` — these are optional for the engine itself but required for any non-trivial skill. `main.js` already constructs `plugin-manager` (line 874 onwards). For PHASE 1 it is reasonable to wire `pluginManager` into the SDK so that Skill execution can find plugins; otherwise you will see `SKILL_NOT_FOUND` or `SDK_NOT_AVAILABLE` style errors.
- No environment variables are read at engine level. `process.env` is untouched.

### 5.3 Functions exported but unsafe to call from main process
- **`this.workflowEngine.cancel(executionId)`** is safe (sync, no throw), but the "cancellation" is a flag, not an abort. **Documented risk in §3.7.**
- **`this.workflowEngine.execute(workflowId, params, context)`** is the correct path. However, if `context.executor` is supplied, it bypasses `sdk.executeSkill` and runs arbitrary code. **Main process must NEVER pass `context.executor` from IPC inputs.** Treat `context` as a whitelist: only `userContext` (and possibly `workflowName`) should be forwarded.
- **`_evalExpr`** uses `new Function(...)`. Any `manifest.conditions[*].expr` reaches this. Workflows are loaded from local files in `resources/`, so this is acceptable for `built-in` workflows, but **must not be reachable from marketplace-sourced workflows** without re-validation. `SkillsSDK` does not re-validate manifest `expr` fields.
- **`loadWorkflowFromFile` / `loadWorkflowsFromDir`** can be called externally with arbitrary paths. **Do not expose them via IPC.** Manifests should only be loaded from vetted directories at boot.

### 5.4 State / lifecycle
- All execution state is in `WorkflowEngine._executions`. If `main.js` constructs a new `WorkflowEngine` (e.g. on window reload or "reset"), **all in-flight execution ids are invalidated**. PHASE 1 should hold a single `sdk` instance for the lifetime of `main.js`; document this to the renderer (the `executionId` is only valid for this session).
- No TTL on `this._executions`. Long-lived sessions will accumulate completed `Workflow` instances. Cheap GC candidate — not blocking for PHASE 1.

### 5.5 Open questions for the orchestrator
- Should `skills:invoke` go through `sdk.executeSkill` (single-skill path) or `sdk.executeWorkflow` (DAG path)? The plan title "BLOCK-2-UI-157-REVIEW" suggests UI-157 is a single Skill invocation surface — **recommend `sdk.executeSkill`**, but keep `workflows:execute` as a parallel channel for the future.
- Is there a need for `skills:resume`? `SkillRuntime.resume(executionId, options)` exists, but the engine itself does not. If PHASE 1 needs resume, it must wrap `SkillRuntime` (not `WorkflowEngine`).
- Does PHASE 1 need streaming progress? Default recommendation: **no**, document polling via `skills:status` instead. If yes, see §4.5 option (2) for the wrapper pattern.

---

## §6 Reference Commands

```bash
# File inventory
wc -l /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/core/shared-backend/workflow-engine.js
#  -> 688

# Source reads
Read /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/core/shared-backend/workflow-engine.js
Read /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/core/shared-backend/skills-sdk.js (full)
Read /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/core/shared-backend/skill-registry.js (first 100 + exits)
Read /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/core/shared-backend/skill-runtime.js (key sections: 80-220, 1100-1127)
Read /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/core/r-server/mcp/registry.js (first 80 + 200-280)

# Glob scans
Glob 'core/shared-backend/*'                       # 86 files
Glob 'core/r-server/mcp/registry.js'
Glob 'src/main.js'

# Test discovery
find /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/test -name "*workflow*" -o -name "*skill*" -o -name "*engine*"
find /Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/frontend/src -name "*.test.*"

# Grep checks
Grep -A0 'ipcMain\.(handle|on)' src/main.js          # 50+ handlers
Grep -i 'skill|workflow' src/main.js                 # 0 matches  (case-insensitive)
Grep -i 'skills|workflow|skill' src/main.js          # 0 matches
Grep 'skills-sdk|workflow-engine|SkillsSDK|WorkflowEngine' src/main.js   # 0 matches
Grep 'createWorkflowEngine|WorkflowEngine|workflow-engine' test/        # 0 matches
Grep 'EventEmitter|emit\(|on\(' core/shared-backend/workflow-engine.js  # 0 matches (no event hook)
Grep 'EventEmitter|emit\(|on\(' core/shared-backend/skill-runtime.js     # 0 matches
Grep 'EventEmitter|emit\(|on\(' core/shared-backend/skills-sdk.js        # 0 matches
Grep 'module.exports' core/shared-backend/skill-registry.js              # 1 export block
Grep 'module.exports|cancel\(' core/shared-backend/skill-runtime.js     # 1 export + 1 cancel method
Grep 'execute\( ' core/shared-backend/skill-runtime.js                   # entry points
Grep 'resume|onProgress|progress' core/shared-backend/skill-runtime.js    # resume present, no progress callback
Grep '_skillExecute|skillCancel|skillStatus|skillList' core/r-server/mcp/registry.js   # only _skillExecute defined
Grep 'async function _skill|case \'skill_' core/r-server/mcp/registry.js              # only _skillDiscover/_skillGet/_skillExecute defined
```

---

## Summary for PHASE 1 consumers

1. **Use `sdk.handleMcpCall(tool, args)`** to dispatch `skills:list`, `skills:get`, `skills:search`, `skills:canExecute`, `skills:invoke` from a single `ipcMain.handle('skills:invoke', ...)` channel — the SDK already implements the MCP-aligned dispatch surface and avoids contract drift.
2. **Cancellation is flag-only** at the `WorkflowEngine` layer. For real abort semantics, wrap `SkillRuntime` (not `WorkflowEngine`) and forward to `runtime.cancel(executionId)`, which itself calls `workflowRuntime?.cancel(...)` and persists checkpoint state.
3. **No progress events** exist. Either poll `sdk.workflowEngine.getExecution(executionId)` (recommended for PHASE 1), or build a thin wrapper around `SkillRuntime` that synthesises progress by diffing `execCtx.checkpoints[]` between awaits. Document the lifetime explicitly: `executionId` is invalid after `main.js` restarts.
