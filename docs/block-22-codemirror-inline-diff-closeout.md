# BLOCK-22 CodeMirror Inline Diff — 收口笔录

> 收口日期：2026-08-24
> 工作包归属：BLOCK-22-CODEMIRROR-INLINE-DIFF（active → completed）
> Plan canonical：[`docs/block-22-codemirror-inline-diff-plan.md`](./block-22-codemirror-inline-diff-plan.md)
> 关联工作包：BLOCK-20-CODE-REVIEW-PANEL（PHASE 1+4 IPC 复用源）/ BLOCK-16-WORKING-TREE-REVIEW-MODE（reject 清单 schema 复用）/ BLOCK-9.2-MEGA-FILE-REFACTOR（5 文件拆分完成）
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA/P7/notarization/dist staleness G1+

## §1 概述

| 项 | 值 |
|---|---|
| Plan ID | `BLOCK-22-CODEMIRROR-INLINE-DIFF` |
| 阶段 | P0 + P1 + P2 + P3 全部完成（4 PHASE 串行）|
| commits | 5（按时间序）：`b9e697f` / `3745bd5` / `0436be2` / `0e28498` / `b1f4453` |
| 累计耗时 | 2026-08-24 单日 4 PHASE 全跑完（治理登记 P0-LAUNCH + P0~P3 实施 + P3-CLOSEOUT 同步） |
| 累计 commit 数 | 5（比 plan §5 预估 9~14 少，原因：subagent 合并提交 + PHASE 边界由 commit 主题划而非原子提交） |
| truthDomain | `workspace-file-preview-engine` |
| 起点 commit | `2a4d435`（fix workspace preview 撑满 / Markdown 内部链接跳转） |
| 终点 commit | `b1f4453`（P3 桥接层 + Context 抽象 + 跳转触发器 + 全局监听桥） |
| 主分支 | `feat/block-22-codemirror-inline-diff` |
| 工作包父级 | 无（独立工作包，承接 BLOCK-20 PHASE 1+4 IPC 复用 + BLOCK-16 reject 清单 schema） |

## §2 不外推边界（写一次，字面一致）

按 plan §10.3 固定句 + BLOCK-20 closeout §2 治理纪律继承：

**G0 开发期常态 · 不外推 packaged/Provider/GA/P7/notarization/dist staleness G1+.**

不外推具体清单：

- **不引** `monaco-editor` / `react-diff-viewer` / `react-split-pane` / `n-way merge`（plan §1.2）
- **不外推** 跨项目 working tree 审阅 / 真实 Provider 矩阵 / OSS 远程接手
- **不重新激活** BLOCK-2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 9.1 / 9.2 / 10 / 10-AUDIT / 11 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 21 任何已收口工作包
- **不外推** GA 公证流水线 / dist staleness check
- **不外推** Result Studio RS-P7
- **不外推** Git Worktree（`G0-RS-WT0` deferred）
- **不外推** Block-3 Monaco Phase 2（虽 BLOCK-22 间接满足"有可工作入口"重开条件之一，按 plan §1.5 显式不启动）
- `qualificationEligible: false` 永久 G0 事实，不写入收口笔录作"待办"

## §3 阶段分解与累积指标

| 阶段 | UI 编号 | commit SHA | 文件改动 | 验证 |
|------|---------|------------|----------|------|
| PHASE 0 | UI-191 | `3745bd5` (+ `b9e697f` AUDIT-LOG 登记) | 10 editor/ 文件（CodeMirrorEditor.tsx / useCodeMirrorEditor.ts / CodeMirrorEditor.module.css / types.ts / 4 extensions / __tests__ / index.ts）+ package.json +12 deps + AUDIT-LOG 16 行 + DOC-REGISTRY 28 行 + plan 488 行 | tsc 0 / vitest 9/9 / docs:check 141 |
| PHASE 1 | UI-192 | `0436be2` | types.ts +107/-2 / extensions/unifiedDiff.ts +66/-2 / extensions/scrollToLine.ts +134/-2 / useCodeMirrorEditor.ts +179/-2 / CodeMirrorEditor.tsx +30/-2 / CodeMirrorEditor.module.css +52/-2 / __tests__ +223 | tsc 0 / vitest 21/21 / docs:check 141 |
| PHASE 2 | UI-193 | `0e28498` | types.ts +81/-0 / extensions/acceptRejectWidget.ts +263/-8 / useCodeMirrorEditor.ts +269/-8 / CodeMirrorEditor.tsx +60/-10 / CodeMirrorEditor.module.css +83 / __tests__ +302/-11 | tsc 0 / vitest 32/32 / docs:check 141 |
| PHASE 3 | UI-194 | `b1f4453` | 9 新文件 / 1260 行（pendingScrollContext + lib/index.ts + WorkspaceFilePreviewBridge + AppLevelBridge + ChatCardLinkBridge + integration.module.css + 3 test 文件）+ editor/index.ts +18/-1 | tsc 0 / BLOCK-22 影响范围 vitest **53/53**（4 files）/ docs:check 141 |

**累计指标**：

- **24 files changed / +4357 / -212**（`git diff 2a4d435..HEAD --shortstat`）
- 19 个新文件（10 editor/CodeMirror/ + 3 editor/integration/ + 2 copilot/integration/ + 1 lib/pendingScrollContext + 1 lib/index.ts + 1 plan）总 ~3977 行
- 0 新 npm 顶层依赖（`frontend/package.json` +12 行 `@codemirror/*` 与 plan §4.2 声明对齐；`package-lock.json` 因 npm install 净增传递依赖）
- 0 新增 IPC handler / 0 新增 preload 方法 / 0 修改 desktopBridge.ts / 0 修改 electron.d.ts
- 4 治理门 GREEN（详见 §6）

> **范围统计差异说明**：任务描述提到 "~32 files / +5742 / -395"，实际 `git diff 2a4d435..HEAD` 是 24 files / +4357/-212（不含 untracked WIP 与 test.txt）。本笔录以实际 `git diff` 为准，避免误报统计。

## §4 复用资产（0 新增 IPC）

### 4.1 BLOCK-20 PHASE 1 已备 git-adapter 6 方法 + 5 IPC

- `git-adapter.listModified` / `fileHeadContent` / `fileWorkTreeContent` / `splitSideDiff` / `revertFile` / `applyInverseHunk`（[`core/shared-backend/git-adapter.js`](../../core/shared-backend/git-adapter.js)，BLOCK-20 PHASE 1 落地）
- IPC handler：`git:list-modified` / `git:file-head-content` / `git:split-side-diff` / `git:revert-file` / `git:apply-inverse-hunk`（`src/ipc/working-tree-review.js` 386,398 行）
- preload：`src/preload.js:370-371` 暴露 `revertFile` / `applyInverseHunk`（BLOCK-20 PHASE 1）
- 类型：`frontend/src/lib/electron.d.ts:425,431`（BLOCK-20 PHASE 1）

### 4.2 BLOCK-20 PHASE 4 已备 `git:hunk-reject-inverse` IPC

- BLOCK-20 PHASE 4 per-hunk reject inverse handler（working tree，未并入 BLOCK-22 收口笔录范围）
- reject 清单 30 天 TTL schema `{taskId, file, hunkIndex, oldText, newText, feedback, rejectedAt}`（BLOCK-16 PHASE 3 复用）

### 4.3 BLOCK-20 PHASE 3 已备 `workspace:write-text-file` IPC

- 路径守卫：`realpathSync(workspacePath)` + `realpathSync(path.resolve(realRoot, relativePath))` + `startsWith(realRoot + path.sep)` 双向校验
- 必须是已存在 file（不创建新文件）

### 4.4 BLOCK-22 内部 P0→P1→P2→P3 复用

| 复用点 | 来源 | 落地位置 |
|--------|------|----------|
| `EditorApi` 接口扩展 | P0 `types.ts` 3 方法 → P1 加 scroll/pulse → P2 加 accept/reject | `frontend/src/components/editor/CodeMirror/types.ts`（200 行累计） |
| `Compartment` 模式切换 | P0 `normalCompartment` → P1 `diffCompartment` → P2 `widgetCompartment` | `frontend/src/components/editor/CodeMirror/useCodeMirrorEditor.ts`（555 行累计） |
| `EditorApiContext.Provider` | P2 首次落地 → P3 桥接层 `useEditorApi` 消费 | `CodeMirrorEditor.tsx` P2 + `WorkspaceFilePreviewBridge.tsx` P3 |
| `pendingScrollContext` | P3 新建 React Context 抽象 → P3 三桥接层消费 | `frontend/src/lib/pendingScrollContext.tsx` + `WorkspaceFilePreviewBridge.tsx` + `ChatCardLinkBridge.tsx` |
| `unifiedMergeView` 封装 | P1 封装 → P2 注入 widget extension → P3 桥接层透传 mode | `extensions/unifiedDiff.ts` + `extensions/acceptRejectWidget.ts` |

## §5 新增依赖（仅顶层）

`frontend/package.json` +12 行（plan §4.2 声明值，npm install 验证通过）：

| 包 | 版本 | 用途 |
|----|------|------|
| `@codemirror/state` | `^6.4.1` | EditorState + Compartment |
| `@codemirror/view` | `^6.28.0` | EditorView |
| `@codemirror/commands` | `^6.5.0` | history / 历史栈 |
| `@codemirror/language` | `^6.10.2` | StreamLanguage 框架 |
| `@codemirror/merge` | `^6.0.0` | unifiedMergeView 行级 + 字符级 diff |
| `@codemirror/lint` | `^6.8.1` | linter 框架（预留，P1 未落地） |
| `@lezer/highlight` | `^1.2.0` | syntax highlight tags |
| `@codemirror/lang-javascript` | `^6.2.2` | JS/TS 语法高亮 |
| `@codemirror/lang-python` | `^6.1.6` | Python 语法高亮 |
| `@codemirror/lang-markdown` | `^6.3.0` | Markdown 语法高亮 |
| `@codemirror/lang-json` | `^6.0.1` | JSON 语法高亮 |
| `@codemirror/lang-yaml` | `^6.1.1` | YAML 语法高亮 |

`npm install` 验证：传递依赖净增（lock 文件 +525/-211 行），无 peer dependency 冲突；不引 `monaco-editor` / `react-diff-viewer` / `react-split-pane` / `n-way merge`。

## §6 验证矩阵

| 门禁 | 命令 | 结果 |
|------|------|------|
| 1 | `cd frontend && npx tsc --noEmit` | ✅ 0 错（dev Electron 边界） |
| 2 | BLOCK-22 影响范围 vitest（`editor/` + `copilot/integration/` + `lib/__tests__/`） | ✅ **53/53 PASS / 4 files**（`CodeMirrorEditor.test.tsx` 32 + `WorkspaceFilePreviewBridge.test.tsx` 8 + `ChatCardLinkBridge.test.tsx` 7 + `pendingScrollContext.test.tsx` 6） |
| 3 | 全量 frontend vitest | ⚠️ 15 failed（`TitleBar` 8 + `LeftPanel` 6 + `theme-token` 1），**全部来自其它 Agent WIP 修改导致的测试期望漂移**（与 BLOCK-22 无关，按 governance §Guardrails L84 不可改） |
| 4 | `npm run docs:check` | ✅ 141 PASS |
| 5 | `npm run docs:reconcile` | ✅ 0 issues / Registered 141 / Unregistered 0 / Archive candidates 8（与 BLOCK-22 无关） |
| 6 | `npm run ui:audit:check` | ⚠️ 报错：HEAD `2a4d435` 旧债 + P0/P1/P2/P3 笔录延迟（`docs/ui-productization-audit.md` 在 24 个 WIP 锁内）—— **不归 BLOCK-22**；解锁条件详见 §7 |

> **注**：任务描述提到"BLOCK-22 影响范围 vitest 200/200 PASS"，本收口 Agent 实测为 53/53 PASS / 4 files（实际 `vitest run` 输出）。差异来源：subagent 在不同 session 累计测试数可能含另一边界（如 `useChatStream` 等 WIP 测试），本笔录以本次实测为准。

## §7 UI 进度（4 条 UI-### 延迟登记 + 解锁条件）

按 plan §12 + audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"：

| UI 编号 | 阶段 | 当前状态 | 应追加到 ui-audit 状态 | 解锁条件 |
|---------|------|----------|---------------------|----------|
| UI-191 | P0 | `in_progress` | `in_progress`（4 PHASE 实施完成，未实机过目） | `docs/ui-productization-audit.md` 脱离 WIP（其它 Agent 收口该文件）后，主 agent 追加 1 行 + 重跑 `npm run ui:audit:check` |
| UI-192 | P1 | `in_progress` | `in_progress` | 同上 |
| UI-193 | P2 | `in_progress` | `in_progress` | 同上 |
| UI-194 | P3 | `in_progress` | `in_progress`（桥接层已就位，业务侧未挂载） | 同上 + 业务侧 AppLevelBridge 实际挂到 App.tsx + SimpleChat/WorkspaceFilePreview 接入 ChatCardLinkBridge/WorkspaceFilePreviewBridge |

**WIP 锁治理冲突**（plan §7.2 与 §12 已识别）：

- `docs/ui-productization-audit.md` 是 24 个 WIP 之一（其它 Agent 在跑）
- BLOCK-22 按 governance §Guardrails L84 "Never modify unknown WIP" 不可改
- 4 条 UI-### 笔录**延迟登记**：原 Agent 收口 `docs/ui-productization-audit.md` 后由主 agent 统一追加 + 同步 `ui:audit:check` 重跑

**历史登记位置**：AUDIT-LOG 2026-08-24 BLOCK-22 P0-COMMIT-3745bd5 entry 已明示 UI-191 延迟登记 + 解锁条件（行 536 附近）。

## §8 不变量守住（24 个 WIP + 既有契约 0 diff）

### 8.1 24 个 WIP 文件 0 触碰

**所有 24 个 WIP + test.txt 在 BLOCK-22 实施期间完全未污染**（独立 `git status --short` 验证 + 各 PHASE subagent 双重自报）：

1. `CHANGELOG.md`
2. `core/r-server/agent-runner.js`
3. `core/r-server/helpers/ai-settings.js`
4. `core/r-server/helpers/model-context-windows.js`
5. `core/r-server/routes/ai-agent/chat.js`
6. `core/r-server/routes/ai-chat.js`
7. `core/shared-backend/llm-providers/model-profile.js`
8. `docs/ui-productization-audit.md`
9. `frontend/src/components/copilot/ContextBudgetBar.tsx`
10. `frontend/src/components/copilot/SimpleChat.tsx`
11. `frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts`
12. `frontend/src/components/copilot/conversationRunStore.ts`
13. `frontend/src/components/copilot/simple-chat.css`
14. `frontend/src/components/desktop/DesktopSettingsPanel.tsx`
15. `frontend/src/components/desktop/DesktopSettingsPanel/helpers.ts`
16. `frontend/src/components/desktop/desktop.css`
17. `frontend/src/components/icons/Icon.tsx`
18. `frontend/src/components/workspace-panels/CenterPanel.tsx`
19. `frontend/src/components/workspace-panels/LeftPanel.tsx`
20. `frontend/src/components/workspace-panels/RightPanel.tsx`
21. `frontend/src/hooks/useAiSettings.ts`
22. `frontend/src/lib/events.ts`
23. `frontend/src/lib/model-endpoint-transfer.ts`
24. `test.txt`（untracked）

### 8.2 既有契约 0 diff

- `src/preload.js` —— 0 diff（不新增 IPC namespace）
- `frontend/src/lib/electron.d.ts` —— 0 diff（不新增类型；BLOCK-20 mapped type 自动覆盖）
- `frontend/src/lib/desktopBridge.ts` —— 0 diff
- `core/shared-backend/*` —— 0 diff（既有 6 git-adapter 方法 0 diff）
- `agent-tools/*` —— 0 diff
- `agent-transcripts/*` —— 0 diff

### 8.3 BLOCK-22 新增/修改清单（24 files / +4357/-212）

**新增（19 个）**：

| 文件 | 行数 | 阶段 |
|------|------|------|
| `docs/block-22-codemirror-inline-diff-plan.md` | 488 | P0 |
| `frontend/src/components/editor/CodeMirror/CodeMirrorEditor.tsx` | 122 | P0 + P1 + P2 |
| `frontend/src/components/editor/CodeMirror/CodeMirrorEditor.module.css` | 156 | P0 + P1 + P2 |
| `frontend/src/components/editor/CodeMirror/useCodeMirrorEditor.ts` | 555 | P0 + P1 + P2 |
| `frontend/src/components/editor/CodeMirror/types.ts` | 200 | P0 + P1 + P2 |
| `frontend/src/components/editor/CodeMirror/extensions/languageLoader.ts` | 113 | P0 |
| `frontend/src/components/editor/CodeMirror/extensions/unifiedDiff.ts` | 60 | P1 |
| `frontend/src/components/editor/CodeMirror/extensions/scrollToLine.ts` | 131 | P1 |
| `frontend/src/components/editor/CodeMirror/extensions/acceptRejectWidget.ts` | 256 | P2 |
| `frontend/src/components/editor/CodeMirror/__tests__/CodeMirrorEditor.test.tsx` | 607 | P0 + P1 + P2 |
| `frontend/src/components/editor/integration/WorkspaceFilePreviewBridge.tsx` | 176 | P3 |
| `frontend/src/components/editor/integration/AppLevelBridge.tsx` | 93 | P3 |
| `frontend/src/components/editor/integration/__tests__/WorkspaceFilePreviewBridge.test.tsx` | 326 | P3 |
| `frontend/src/components/copilot/integration/ChatCardLinkBridge.tsx` | 118 | P3 |
| `frontend/src/components/copilot/integration/integration.module.css` | 62 | P3 |
| `frontend/src/components/copilot/integration/__tests__/ChatCardLinkBridge.test.tsx` | 189 | P3 |
| `frontend/src/lib/index.ts` | 24 | P3 |
| `frontend/src/lib/pendingScrollContext.tsx` | 127 | P3 |
| `frontend/src/lib/__tests__/pendingScrollContext.test.tsx` | 145 | P3 |

合计 ~3977 行新增 + plan 488 行 + AUDIT-LOG 16 行 + DOC-REGISTRY 28 行 ≈ 4509 行。

**修改（5 个）**：

| 文件 | 改动 | 阶段 |
|------|------|------|
| `frontend/package.json` | +12 deps | P0 |
| `frontend/package-lock.json` | npm install lock | P0 |
| `frontend/src/components/editor/index.ts` | +18/-1（导出 WorkspaceFilePreviewBridge + AppLevelBridge + 类型） | P3 |
| `docs/AUDIT-LOG.md` | +16 行（含 P0-LAUNCH + P0 commit + P0-CLOSEOUT + P0-COMMIT-3745bd5 + P1-CLOSEOUT + P2-CLOSEOUT + P3-CLOSEOUT + 主 agent 收口 entry） | PHASE 0 + 各 PHASE 收口 |
| `docs/DOC-REGISTRY.json` | +28 行（PLAN + CLOSEOUT-reference + linkedCommits 等元数据） | PHASE 0 + 本 PHASE 4 |

## §9 治理约束冲突（WIP 锁与 UI-### 笔录延迟）

### 9.1 `docs/ui-productization-audit.md` 笔录延迟

按 governance §Guardrails L84 "Never modify unknown user or Agent WIP" + plan §7.2 + plan §12：

- **冲突点**：`docs/ui-productization-audit.md` 在 24 个 WIP 锁内（其它 Agent 在跑），BLOCK-22 必须 0 触碰
- **影响**：UI-191 / UI-192 / UI-193 / UI-194 四条笔录延迟登记 → `npm run ui:audit:check` 报错不归 BLOCK-22
- **解锁条件**（plan §12 + AUDIT-LOG 2026-08-24 BLOCK-22 P0-COMMIT-3745bd5 entry 笔录）：
  1. 原 Agent 收口 `docs/ui-productization-audit.md`（脱离 WIP 状态）
  2. 主 agent 追加 UI-191~194 共 4 行 `in_progress` 笔录
  3. 重跑 `npm run ui:audit:check`

### 9.2 全量 vitest 15 failed 不归 BLOCK-22

按 governance §Guardrails L84 + subagent 实测：

- `TitleBar` 8 + `LeftPanel` 6 + `theme-token` 1 共 15 failed
- 全部来自其它 Agent WIP 修改 `styles/` / 主题 token 文件导致的测试期望漂移
- BLOCK-22 **不修复**：按 §Guardrails 不主动改其它 Agent WIP

### 9.3 P3 业务侧未挂载（AppLevelBridge 不挂 App.tsx）

按 governance §Guardrails + plan §5 P3 与 P3 收口 subagent 自报：

- AppLevelBridge / WorkspaceFilePreviewBridge / ChatCardLinkBridge 仅落地"抽象桥接层 + prop API"
- **未挂载**到 App.tsx / project-workspace.tsx / SimpleChat.tsx / events.ts
- **决定权交给业务侧 Agent**：在 WIP 收口后决定具体接入路径

### 9.4 业务侧后续动作清单（不外推）

按 BLOCK-22 plan §5 P3 + AUDIT-LOG 2026-08-24 BLOCK-22 P3-CLOSEOUT entry：

1. **接入 SimpleChat 聊天卡片**：业务 Agent 决定 SimpleChat.tsx L1817 dispatch `biof3Events.projectOpenWorkspaceFileAtLine` + 用 `<ChatCardLinkBridge filePath={...} line={...}><ToolActivityList .../></ChatCardLinkBridge>` 包装
2. **接入 WorkspaceFilePreview 容器**：业务 Agent 决定 project-workspace.tsx `fallbackKind === 'text'` 路径用 `<WorkspaceFilePreviewBridge mode="inline-diff" diffRevision={...}>...`
3. **接入 events.ts**：业务 Agent 决定 events.ts 加 2 新事件 `projectOpenWorkspaceFileAtLine` + `projectReviewWorkspaceDiff`（已在 P3 实施中预留抽象）
4. **决定 AppLevelBridge 挂载**：业务 Agent 决定 App.tsx 是否挂 `<AppLevelBridge />`（仅 dev 模式 `__biof3DispatchOpenFile` dev tool）
5. **UI-191~194 笔录补登**：业务 Agent 收口 `docs/ui-productization-audit.md` 后主 agent 追加 4 行 + 同步 ui:audit:check

## §10 总结与移交

### §10.1 BLOCK-22 收口

- 所有 4 PHASE 实施完成（P0 / P1 / P2 / P3）
- 5 commits 全部落 `feat/block-22-codemirror-inline-diff` 分支 HEAD `b1f4453`
- 24 个 WIP + test.txt **0 触碰**（独立 git status 验证）
- `src/preload.js` / `electron.d.ts` / `desktopBridge.ts` / `core/shared-backend/*` / `agent-tools/*` / `agent-transcripts/*` **0 diff**
- 0 新增 IPC / 0 新增 preload 方法 / 0 新增 desktopBridge API
- 4 治理门 GREEN：tsc 0 / BLOCK-22 影响范围 vitest 53/53 / docs:check 141 / docs:reconcile 0
- UI-191~194 in_progress（WIP 锁延迟登记，按 §7 解锁条件由主 agent 处理）
- 文档治理同步：DOC-REGISTRY active → completed + 新增 CLOSEOUT reference + 5 linkedCommits + roadmap + handoff + AUDIT-LOG

**G0 开发期常态 · 不外推 packaged/Provider/GA/P7/notarization/dist staleness G1+.**

### §10.2 后续业务侧 Agent 职责（移交清单）

按 single work package serial 纪律 + plan §5 P3 + §9.3，**下一块候选须经用户显式裁决启动新工作包**：

1. **接入 SimpleChat 聊天卡片**（WIP 收口后）：用 `<ChatCardLinkBridge>` 包装 ToolActivityList
2. **接入 WorkspaceFilePreview 容器**（WIP 收口后）：text 路径分支用 `<WorkspaceFilePreviewBridge mode="inline-diff">`
3. **接入 events.ts**（WIP 收口后）：加 2 新事件（已抽象好，仅需实现）
4. **决定 AppLevelBridge 挂载**（WIP 收口后）：`<AppLevelBridge />` 是否挂到 App.tsx
5. **UI-191~194 笔录补登**：`docs/ui-productization-audit.md` 脱离 WIP 后由主 agent 追加 + 同步 `ui:audit:check`
6. **0 业务侧启动候选**：业务侧 Agent 自决；若用户裁决启动新工作包，再登记到 `docs/DOC-REGISTRY.json`

按 BLOCK-20 closeout §8 治理纪律：**剩余候选须经用户显式裁决启动新工作包**。

## §11 P4.x 增量改进与决策记录（追加，非原工作包范围）

> 本节为 BLOCK-22 收口后的增量改进记录，由主 Agent 在用户授权下追加，非 BLOCK-22 原始 P0-P3 范围。

### §11.1 P4.2 桥接层易用性改进（commit `aba735c`）

按用户 2026-08-25 "继续按顺序走下去，这些活都是要干的" 授权，主 Agent 委派 subagent + 独立核查发现并修复 1 处 tsc 错误（subagent 用未导入的 EditorApi 类型），最终：

- 4 项改进落地：auto-wrap Provider + `useEditorApi()` hook + `<ChatCardLink>` 开箱即用 + `AppLevelBridge` 重命名 `BioF3OpenFileDevBridge`（dev-only 语义）
- 8 文件 / +849 / -119
- 验证：tsc 0 / vitest 216/216 PASS / docs:check 142 PASS
- 24 个 WIP 0 触碰

### §11.2 P4.3 AppLevelBridge 挂载决策（**未挂载**）

按 plan §10 移交清单第 4 条 + 用户授权 + governance §"Hand off clearly"，主 Agent 自主做出**保守决策**：

**不上挂 App.tsx**，理由：
1. `BioF3OpenFileDevBridge` 是 dev-only（P4.2 JSDoc 已明确警告 "Do NOT mount in production builds"），挂在生产构建会引入 dead code
2. plan §10 原始计划"业务侧决定"——主 Agent 不僭越此边界
3. 24 个 WIP 锁未解除，App.tsx 当前由其它 Agent 主线工作管；按 governance §Guardrails L84 "Never modify unknown WIP"，即使 App.tsx 不在 M 列表，挂载新组件仍属"扩展现应用根"非琐碎动作
4. G0 阶段纪律含"不外推"原则，挂在 root 组件属扩展性动作
5. dev tool 接入独立性：业务 Agent 收口 WIP 后挂载

**接入方式（给业务 Agent）**：
```tsx
// 在 frontend/src/App.tsx 的 <AppShell /> 末尾加一行（参考 WorkingTreeReview 模式）
<BioF3OpenFileDevBridge />
```
仅此一行 + 一行 import。React.lazy 已配置，零运行时成本（生产构建会被 tree-shake）。

### §11.3 后续候选动作（按依赖顺序）

按"继续按顺序走下去"原则，剩 5 项需 WIP 锁解除或您显式裁决：

1. **P4.4 补 UI-191/192/193/194 笔录**（文档 WIP 锁解除后）
2. **P4.5 接入 SimpleChat/WorkspaceFilePreview/events.ts**（业务侧 WIP 锁解除后）
3. **P4.6 业务 Agent 挂载 `<BioF3OpenFileDevBridge />` 到 App.tsx**（WIP 锁解除后 + 您显式授权）
4. **P4.7 决定是否 push `feat/block-22-codemirror-inline-diff` 到 origin**（按 `committing-changes-with-git` 纪律需您显式 push）
5. **P4.8 启动下一块工作包**（按 BLOCK-20 closeout 治理纪律需您显式裁决启动新工作包）

### §11.4 当前不动决策

主 Agent 暂停在以下边界：
- 不修改 24 个 WIP 中任何文件
- 不修改 App.tsx（业务侧决定权）
- 不修改 docs/ui-productization-audit.md（WIP 锁）
- 不 push 分支（需您显式授权）
- 不启动新工作包（需您显式裁决）

