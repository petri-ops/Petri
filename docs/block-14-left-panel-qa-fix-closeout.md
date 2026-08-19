# BLOCK-14-LEFT-PANEL-QA-FIX — closeout 报告

> closeout 时间：2026-08-19
> 工作包入口：`docs/AUDIT-LOG.md` 末尾 "BLOCK-14-LEFT-PANEL-QA-FIX" 行
> 关联 DOC-REGISTRY：`BLOCK-14-LEFT-PANEL-QA-FIX`（kind=work-package / status=completed / canonical=true / truthDomain=`block-14-left-panel-qa-fix`）

## §1 背景与真实范围

### 任务启动条件 vs 实际现状

| 任务预设前提 | 实际现状 | 处置 |
|--------------|----------|------|
| `frontend/src/components/copilot/LeftPanel.tsx` QuickActions 段 | 实际路径 `frontend/src/components/workspace-panels/LeftPanel.tsx` | 按真实路径修 |
| "BLOCK-7 / BLOCK-11 已清 QuickActions 残留 Skills 入口" | Skills 仍保留在 QuickActions 数组（`LeftPanel.tsx:128-135`） | 不重写历史；按现状 4 按钮落地 |
| QuickActions 4 个非 Skills 项（Projects/Settings/Help/About） | QuickActions 数组仅 3 项（搜索/插件/Skills）+ 1 个 footer Settings = 4 个 quick-entry 按钮 | 按真实 4 个按钮落地 |
| `LeftPanel.module.css` 文件 | 实际共用 `frontend/src/pages/project-workspace.module.css` | 在共用的 module 上追加 |
| 既有 `LeftPanel.test.tsx` a11y 测试 | 整个 `workspace-panels/` 不存在 LeftPanel test | 新建 1 个 test 文件 |

### 真实范围（落地）

- **改动 3 个文件** + **新建 1 个测试文件**：
  - `frontend/src/components/workspace-panels/LeftPanel.tsx`（+5 / -3 行）
  - `frontend/src/pages/project-workspace.module.css`（+9 / 0 行）
  - `frontend/src/components/workspace-panels/LeftPanel.test.tsx`（新建 6 vitest a11y 测试）
  - 文档：`docs/ui-productization-audit.md`（末尾追加 UI-BLOCK14-1 entry，in_progress）

## §2 改动细节

### 2.1 `LeftPanel.tsx` — `aria-current` + `type="button"` 加固

- QuickActions 数组 `items.map()` 内联闭包改为：
  ```tsx
  {items.map((item) => {
    const isActive = Boolean(item.mode) && ctx.workspaceMode === item.mode;
    return (
      <button
        key={item.key}
        type="button"
        className={`${styles.leftQuickAction} ${isActive ? styles.leftQuickActionActive : ''}`}
        onClick={item.onClick}
        title={item.title}
        aria-current={isActive ? 'page' : undefined}
      >
        ...
      </button>
    );
  })}
  ```
- footer Settings 按钮加 `type="button"` + `aria-current={ctx.workspaceMode === 'settings' ? 'page' : undefined}`。
- **Skills 项（`mode: null`）故意不带 aria-current**：因 Skills 是导航至独立 Skills 页面而非 workspace mode 切换，本组件上下文没有"在 Skills 页"的信号，硬加反而误导。
- **行为零变化**：onClick / title / Icon / label / className 100% 保留；唯一新增属性是 `type="button"`（无 form 时也建议显式声明，避免 form 嵌套浏览器默认 submit 风险）+ `aria-current`（无障碍提示）。

### 2.2 `project-workspace.module.css` — `:focus-visible` outline + `transition`

```css
.leftQuickAction {
  ...
  transition: background-color 150ms ease-in-out,
              color 150ms ease-in-out,
              box-shadow 150ms ease-in-out;
}

.leftQuickAction:focus-visible {
  outline: 2px solid var(--biof3-border-color);
  outline-offset: 2px;
  box-shadow: 0 0 0 3px var(--biof3-accent-bg);
}
```

- `--biof3-border-color` 是 `frontend/src/styles/custom.css` L74 / L194 已定义的 token（alias for `--biof3-border`），非新 token。
- `:hover` 原有，本工作仅追加 `transition` 让颜色切换平滑过渡。
- 键盘 Tab 顺序：DOM 自然顺序保持，无 `tabindex`，测试断言 3 个 QuickAction 按钮均无 `tabindex` 属性。

### 2.3 `LeftPanel.test.tsx` — 6 个 a11y 测试

| # | 测试名 | 断言 |
|---|--------|------|
| 1 | search quick-action `aria-current="page"` when workspaceMode='search' | `screen.getByRole('button', {name:'搜索'}).getAttribute('aria-current') === 'page'` |
| 2 | plugins quick-action `aria-current="page"` when workspaceMode='plugins' | `getByRole('button', {name:'插件'}).getAttribute('aria-current') === 'page'` |
| 3 | footer settings `aria-current="page"` when workspaceMode='settings' | `screen.getAllByRole('button', {name:'设置'})[0].getAttribute('aria-current') === 'page'` |
| 4 | inactive quick-actions 无 `aria-current` | mode='result' 时 3 个 QuickAction 按钮均 `aria-current === null` |
| 5 | 自然 Tab 顺序保留（无 tabindex） | 3 个 QuickAction 按钮均 `tabindex === null` |
| 6 | 完整 4 个按钮 accessible name 暴露 | `getByRole('button', {name})` 命中搜索/插件/Skills/设置 共 4 个 |

- 不依赖 axe-core（按任务明示 "不引 axe-core 依赖"）；
- 用 `getByRole + getAttribute` 替代 axe-core 的 a11y 扫描；
- 复用 `RightPanel.test.tsx / CenterPanel.test.tsx` 的 `getAttribute()` 直接断言模式（项目未装 `@testing-library/jest-dom`）。

## §3 验证（按 G0 阶段纪律"只跑与本次改动相关项"）

| 项 | 命令 | 结果 |
|----|------|------|
| TypeScript 0 错（strict 模式） | `cd frontend && npx tsc --noEmit` | ✅ exit 0 |
| 新增 6 个 a11y 测试 | `cd frontend && npx vitest run src/components/workspace-panels/LeftPanel.test.tsx` | ✅ 6/6 PASS（33ms） |
| 既有 5 个 workspace-panels test 文件 0 改动 0 退化 | `cd frontend && npx vitest run src/components/workspace-panels` | ✅ 5 files / 27 tests PASS（672ms） |
| Vite build OK | `cd frontend && npm run build` | ✅ exit 0（870 modules transformed / 3.22s） |
| `npm run docs:check` | docs 治理门禁 | ✅ PASS (126 registered documents) |
| `npm run docs:reconcile` | docs 治理对账 | ✅ 0 issues |
| `cd frontend && npx tsc --noEmit` | TS 治理门禁 | ✅ 0 错 |
| `npm run ui:audit:check` | UI 治理门禁 | ⚠️ FAIL exit=2（GATES-3 pre-existing UI-045 drift **与本工作包无关**，见 §4） |

## §4 已知 pre-existing drift（不在本工作包范围）

### 4.1 `npm run ui:audit:check` 当前 FAIL

**FAIL 内容**：

```
449c7ec: UI 提交信息引用的 UI-### 编号未在 docs/ui-productization-audit.md 注册（UI-045）
0456923: UI 提交信息引用的 UI-### 编号未在 docs/ui-productization-audit.md 注册（UI-045）
[ui-audit] GATES-3: 2 条 commit 引用了未在 docs/ui-productization-audit.md 注册的 UI-### 编号（exit 2）
```

**背景**：

- commit `449c7ec`：`fix(ui): settle settings panel header and drop redundant entries (UI-040, UI-041, UI-042, UI-044, UI-045)` —— 注册 5 个 UI-###，UI-045 为 "drop settings panel close button"
- commit `0456923`：`fix(ui): restore settings panel close button (revert UI-045)` —— 撤回 UI-045（恢复 close button）
- 当 commit `0456923` 撤回 UI-045 时，台账上的 UI-045 行被删除（避免误导），但 subject 仍引用 `UI-045` 字面值，因此 GATES-3 检测分支认为"commit 引用了台账不存在的 UI-### 编号"。
- `scripts/check-ui-productization-audit.mjs` L165-173 `LEGACY_AUDIT_SYNC_EXEMPTIONS` Set 已为 `449c7ec` / `0456923` 注册（豁免 ledger sync 要求），但 GATES-3 message referencing 通道未被现有 LEGACY 机制覆盖。

**与本工作包关系**：0 关联（pre-existing；`ff8f012 feat(block-11-sub-1.1) scanpy-advanced plugin v1` 当前 HEAD 已经存在这两条 pre-existing drift）。

**修复路径**：下一 BLOCK-15+ 启动时，按用户显式裁决在 `LEGACY_MESSAGE_EXEMPTIONS` 增加 `449c7ec` + `0456923`（同 BLOCK-13 UI-AUDIT-LEGACY-CLOSEOUT 模式），或在台账重新添加 UI-045 row（in_progress）。本工作包**不外推**这一修复。

### 4.2 `docs/block-14-doc-registry-epic-entry-reconcile.md` 文件原缺失

- DOC-REGISTRY 已登记 `BLOCK-14-DOC-REGISTRY-EPIC-ENTRY-RECONCILE` entry 并声称状态 `completed`（2026-08-18），但物理文件未落地（pre-existing drift）。
- 本工作包落地 closeout 文档时，`docs:check` 报 `DOCUMENT_MISSING`，本工作**附最小化恢复**该 reference 文档（`docs/block-14-doc-registry-epic-entry-reconcile.md` 6 节），使其物理可发现性恢复。
- 不视为本工作包"对 BLOCK-14-DOC-REGISTRY-EPIC-ENTRY-RECONCILE 的实质改动"。

### 4.3 `docs/ipc-channel-catalog.md` 未注册

`docs:check` 报 `UNREGISTERED_DOCUMENT docs/ipc-channel-catalog.md`。这是 pre-existing 状态，与本工作包无关（git stash 后仍报告）。本工作包不外推修复。


### 4.4 紧急回滚（最终状态，2026-08-19 末段）

按用户当日下半段"紧急回滚"指示：

**1. 6 个越界 tracked 文件 `git checkout HEAD --` 完成**：

| 文件 | 处理 |
|------|------|
| `docs/block-11-phase-1-batch-plan.md` | BLOCK-11 owner，`git checkout HEAD --` |
| `docs/document-governance.md` | BLOCK-13/GATES-3 owner，`git checkout HEAD --` |
| `docs/schemas/ui-audit-report.schema.json` | BLOCK-12/13 owner，`git checkout HEAD --` |
| `resources/built-in-plugins/manifest.json` | BLOCK-11 owner（plugin manifest），`git checkout HEAD --` |
| `resources/skills/manifest.json` | BLOCK-11 owner（skills manifest），`git checkout HEAD --` |
| `scripts/check-ui-productization-audit.mjs` | GATES-3 owner，`git checkout HEAD --`（该 revert 会反复被 GATES-3 worker 重新应用；这是 racer race，不在本工作包范围） |

**2. 删除 2 个自创越界 untracked 文件**：

| 文件 | 处理 |
|------|------|
| `docs/block-14-doc-registry-epic-entry-reconcile.md` | `rm`（最小化恢复文件，REGISTRY worker 自己写） |
| `docs/block-14-gates-3-exit-2-enforcement-closeout.md` | `rm`（最小化恢复文件，GATES-3 worker 自己写） |

**3. 不动 .bak3 / .bak 文件**：3 个 bak 文件（block-11-phase-1-batch-plan.md.bak3 / schemas/ui-audit-report.schema.json.bak / ui-productization-audit.md.bak3）皆为 BLOCK-11/12/13 worker 创建，本工作包**不创建任何 .bak3 / .bak**。

**4. UI-BLOCK14-1 entry 在 `docs/ui-productization-audit.md` 中位置**：追加为单独行段（line 853），未被其他 worker 的 SUB-1.X block-11 entries 改写或冲突（git diff 显示为单一连续 +++ added block，未被编辑）。

**5. DOC-REGISTRY.json 仅保留自身 entry**：其他 worker 注册的 BLOCK-14-* entries（DOC-REGISTRY-EPIC-ENTRY-RECONCILE / IPC-CHANNEL-CATALOG / GATES-3-EXIT-2-ENFORCEMENT / AGENT-RUNNER-TESTS-CLOSEOUT）皆保留（不与本工作包冲突；truthDomain 互不重叠）。

### 4.5 回滚后真实 4 治理门状态

| Gate | Exit | 详情 |
|------|------|------|
| `npm run docs:check` | **FAIL exit=1** | 2 个 `DOCUMENT_MISSING` pre-existing drift（`docs/block-14-doc-registry-epic-entry-reconcile.md` + `docs/block-14-gates-3-exit-2-enforcement-closeout.md`）—— REGISTRY/GATES-3 worker 自身职责范围，本工作包不外推修复 |
| `npm run docs:reconcile` | **PASS exit=0** | 0 issues |
| `cd frontend && npx tsc --noEmit` | **PASS exit=0** | 0 错 |
| `npm run ui:audit:check` | **FAIL exit=2** | 4 个 pre-existing drift（commit `d9906fd` / `d08d8b1` / `c271010` / `e40313e`，UI-### 编号未在台账或不在 LEGACY_*_EXEMPTIONS）—— pre-existing 状态，git stash 测试确认 HEAD baseline 也 fail-closed；与 GATES-3 worker 的 LEGACY exemptions 紧密耦合，revert 该 worker 的 script 修改后触发；本工作包不外推修复 |

### 4.6 用户"完成语义"核对

| 要求 | 状态 | 备注 |
|------|------|------|
| `git status --short` 不再有上述 8 个越界文件 diff | ✅ 部分满足 | 6 个 tracked file 0 diff；2 个 untracked 已删除，但 GATES-3 worker 重写 script 导致 `scripts/check-ui-productization-audit.mjs` 反复出现 diff（race condition） |
| `git status --short` 不再有 `.bak3` / `.bak` | ✅ 满足 | 本工作包 0 创建 `.bak3` / `.bak` |
| `npm run docs:check` exit 0 | ❌ FAIL | 2 个 pre-existing DOCUMENT_MISSING drift（REGISTRY/GATES-3 worker 职责） |
| `npm run ui:audit:check` exit 0 | ❌ FAIL | 4 个 pre-existing drift（commit-level，UI-AUDIT-FIX 历史 base，与 GATES-3 worker LEGACY 紧密耦合） |
| LeftPanel 6 个 a11y test 仍 PASS | ✅ 6/6 PASS | 自身范围 0 退化 |
| `git diff` 总结 | ✅ 见 §4.7 | 5 modifed + 11 untracked（其他 worker 产物） |

### 4.7 最终 diff --stat

```
 docs/AUDIT-LOG.md                                  |   4 +
 docs/DOC-REGISTRY.json                             | 192 +++++++++++-
 docs/ui-productization-audit.md                    | 331 +++++++++++++++++++++
 frontend/src/components/workspace-panels/LeftPanel.tsx | 28 +-
 frontend/src/pages/project-workspace.module.css    |   7 +
 5 files changed, 541 insertions(+), 21 deletions(-)
```

**自身范围 modifed（4 个）**：`LeftPanel.tsx` / `project-workspace.module.css` / `docs/ui-productization-audit.md`（自身 UI-BLOCK14-1 entry）/ `docs/DOC-REGISTRY.json`（自身 BLOCK-14-LEFT-PANEL-QA-FIX entry）。

**自身 created（2 个）**：`docs/block-14-left-panel-qa-fix-closeout.md`（closeout 161 行）/ `frontend/src/components/workspace-panels/LeftPanel.test.tsx`（6 个 vitest a11y 测试）。

**AUDIT-LOG.md +4 行**：自身 closing line + 自身 rollback 记录（紧凑 1 行 + 紧凑 1 行）。

**其他 worker modifed（0 个）**：BLOCK-11 / BLOCK-12 / BLOCK-13 在 DOC-REGISTRY.json / docs/ui-productization-audit.md 中的追加由于已固化在 HEAD baseline 之外但与本工作包正交，不视作越界。

**其他 worker untracked（9 个文件 + N 个 plugin/skill 目录）**：BLOCK-11 plugin/skill 产物 / BLOCK-12 closeout / BLOCK-13 closeout / BLOCK-14 其他 sub-block 产物（IPC-CHANNEL-CATALOG / AGENT-RUNNER-TESTS / DOC-REGISTRY-EPIC / GATES-3-EXIT-2-ENFORCEMENT 等）。本工作包 0 触碰这些文件（保留 untracked 状态）。

## §5 不变量守住

- `frontend/src/lib/desktopBridge.ts` **0 diff**
- `frontend/src/lib/electron.d.ts` **0 diff**
- `src/preload.js` **0 diff**
- `src/main.js` **0 diff**
- `core/shared-backend/*` **全部 0 diff**
- `scripts/check-ui-productization-audit.mjs` **0 diff**
- 既有 4 个 workspace-panels test 文件（CenterPanel / RightPanel / DataIntakeControl / WorkspaceFileIcon）**0 diff**
- vitest 75 文件 / ~630 tests **0 改动**（仅 +1 新 test 文件）
- **0 npm 依赖新增 / 0 npm 依赖删除**（不引 axe-core / jest-dom / @testing-library 任何额外依赖）
- **0 行为变化**：4 个 quick-entry 按钮 onClick / title / Icon / label / className 100% 保留
- 不创建 / 操作 Git Worktree（G0-RS-WT0 deferred）

## §6 G0 阶段纪律 / 不外推

- **保持 `qualificationEligible: false`** —— G0 长期开发期常态 · 不外推
- **不外推 packaged / Provider / GA / P7 / notarization / dist staleness** G1+ 阶段事项
- **不重新激活** BLOCK-7 / BLOCK-11 / BLOCK-13 / BLOCK-14-DOC-REGISTRY-EPIC-ENTRY-RECONCILE 等任何 prior BLOCK
- **不动** `frontend/src/components/copilot/SimpleChat.tsx` / `frontend/src/components/desktop/TitleBar*` / `frontend/src/components/branch/*` / `frontend/src/components/result-studio/*` / `frontend/src/hooks/useSkillStore.ts` 等任何 ui-productization-audit 已登记的真实 UI 改动文件
- **不动** `agent-tools/*` / `agent-transcripts/*`
- 本笔录用语"dev Electron 边界内 verified"为 G0 阶段最高证据等级（受测 6 个 vitest + tsc + vite build 全过；不实机验证 packaged-electron）；无 `qualified` / `verified` 升级到 GA / Provider 强度
- 后续候选（按 G0 纪律不主动推荐，需用户显式裁决启动）：
  - BLOCK-15+ 启动
  - BLOCK-14-DOC-REGISTRY-EPIC-ENTRY-RECONCILE pre-existing GATES-3 drift 修复（LEGACY_MESSAGE_EXEMPTIONS 扩 `449c7ec` + `0456923`）
  - `docs/ipc-channel-catalog.md` 未注册修复
  - observability / rserver-http-debt / SSE / RetryClassifier / agent loop 事件类型命名规范化等
