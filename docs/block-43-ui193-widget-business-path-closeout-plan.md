# BLOCK-43 — UI-193 widget 业务路径收口（退休死代码 + 实机复核）计划

## 1. 背景

UI-193（BLOCK-22 通用 accept/reject widget）自 2026-08-28 起 in_progress：extension 已实现 + 单元验证，但业务路径从未点亮（`CodeMirrorDiffView` 构造的 `DiffRevision` 不含 `hunks`，widget `getHunks()` 恒空 → `Decoration.none`）。台账登记「填充 hunks 或把 accept/reject 路由到 widget」属产品决策。

**BLOCK-43 摸底新事实（2026-09-02）**：BLOCK-28 已另建 `hunkControls.ts`（`wt-hunk-controls` 悬浮控件，git hunk 语义 + `path#hunkIndex` 决策键，与键盘 A/R 流一致），在 ReviewMode 业务路径承担按 hunk 接受/拒绝，**UI-206 已 verified**（实机证据 `acceptance/ui-204/`：Accept 点击 → accepted 状态 + 行置灰 + 进度计数）。两套实现功能重叠，BLOCK-22 通用 widget 是死代码。

**用户裁决（2026-09-02）**：退休死代码 + 实机复核——删除从未点亮且被取代的通用 widget 链路，UI-193 按 superseded 收口；实机复核 BLOCK-41 两栏重构后 `hunkControls` 业务路径仍正常。

## 2. 目标

1. 移除 BLOCK-22 通用 accept/reject widget 全链死代码（0 业务行为变化）。
2. dev Electron 实机复核 post-BLOCK-41 审阅 UI 的 per-hunk accept/reject（wt-hunk-controls）仍正常。
3. UI-193 台账 superseded 收口，证据更新 `acceptance/ui-193/`。

## 3. 非范围

- `hunkControls.ts` 及其业务链（CodeMirrorDiffView props / decideHunk / applyInverseHunk / rejectHunkByInverseHunk bridge 方法与 IPC 通道）**全部保留**——它们是活的业务路径。
- BLOCK-41 两栏审阅功能、BLOCK-42 pending-scroll 链路不动。
- 不新增 IPC、不新增依赖、不改变 accept/reject 决策模型。

## 4. 移除面（P1 执行清单）

| 类别 | 文件 | 动作 |
|---|---|---|
| extension | `frontend/src/components/editor/CodeMirror/extensions/acceptRejectWidget.ts` | 整文件删除 |
| API 实现 | `frontend/src/components/editor/CodeMirror/useCodeMirrorEditor.ts` | 删 extension 无条件挂载（inline-diff 模式）、`acceptHunk/rejectHunk/acceptAll/rejectAll` 实现、`runAcceptHunkIPC`、`dismissHunk` 及相关 ref |
| 类型 | `frontend/src/components/editor/CodeMirror/types.ts` | 删 `EditorApi.acceptHunk/rejectHunk/acceptAll/rejectAll`、`CodeMirrorEditorProps.onAcceptHunk(hunkId)/onRejectHunk(hunkId)/showDiffActionBar` |
| 组件 | `frontend/src/components/editor/CodeMirror/CodeMirrorEditor.tsx` | 删 `DiffActionBar` import/mount 与 `showDiffActionBar` 透传 |
| 组件 | `frontend/src/components/editor/CodeMirror/DiffActionBar.tsx` | 整文件删除 |
| 事件 | `frontend/src/lib/events.ts` | 删 `hunkAccepted/hunkRejected` 事件与 `HunkAcceptedDetail/HunkRejectedDetail` 类型（已核实无业务监听方，仅测试消费） |
| CSS | `frontend/src/components/editor/CodeMirror/CodeMirrorEditor.module.css` | 删 widget 形态 CSS 与 dismissHunk fade 段（~L110、~L190 起） |
| 测试 | `__tests__/DiffActionBar.test.tsx` | 整文件删除 |
| 测试 | `__tests__/events-bus.test.tsx` | 删 P4.10 hunkAccepted/hunkRejected 套件（文件内其余用例按内容去留） |
| 测试 | `__tests__/CodeMirrorEditor.test.tsx` | 删 acceptHunk/rejectHunk/acceptAll/rejectAll 用例块；mock 桥中 `applyInverseHunk/rejectHunkByInverseHunk/revertFile` 若仅被删用例消费则一并清理 |

**保留（易混淆项）**：
- `CodeMirrorDiffView` 的 `onAcceptHunk/onRejectHunk` props（hunkIndex 语义 → `decideHunk`）与 `hunkControls.ts`——活路径。
- bridge 方法 `applyInverseHunk/rejectHunkByInverseHunk/revertFile`（`useWorkingTreeReview.ts` 仍在用）与 `git:hunk-apply/git:hunk-reject-inverse` IPC 通道。
- `onError` prop：先 grep 核实消费方，仅当唯一消费方是被删链路时才移除，否则保留。
- BLOCK-22 通用链中若发现被其他活代码引用的符号（P1 逐项 grep 复核），该符号保留并在 plan 进度记录注明。

## 5. 阶段

- **P0 摸底 + 本计划**（已完成）：两轮 explore + 关键文件直读，确认双实现重叠与死代码边界；用户裁决退休 + 复核。
- **P1 死代码移除**：按 §4 清单执行，逐项 grep 核对消费方后再删；tsc --noEmit 0 为完成判据。
- **P2 定向门禁**：删相关用例后定向 vitest 全绿（CodeMirrorEditor + integration + WorkingTreeReview 既有套件 0 回归）+ tsc 0 + docs:check + ui:audit:check。
- **P3 实机复核**：dev Electron（CDP :9222）——项目审阅 tab（post-BLOCK-41 两栏 UI）：选中已修改文件 → `wt-hunk-controls` 渲染 → 点击「接受」→ 决策态 + 行置灰 + 计数；点击「拒绝」→ working tree 回退核对；键盘 A/R 抽查；staged 栏 diff 无 accept/reject 控件（符合设计）。截图 + 记录落 `acceptance/ui-193/`。scratch 变更验收后清理。
- **P4 文档收口**：UI-193 台账 superseded 收口（注明业务路径 = UI-206 hunkControls + 本次实机复核证据）；本 plan + DOC-REGISTRY（status completed）+ docs/README 入口 + roadmap（active 清空）+ AUDIT-LOG 立项/收口条目；提交。

## 6. 验收门

- 通用 widget 链路全仓 0 残留引用（grep 核对）+ tsc 0
- 定向 vitest 全绿（业务路径用例 0 回归）
- P3 实机：wt-hunk-controls 接受/拒绝/键盘流在 post-BLOCK-41 UI 全部可用（截图留证）
- docs:check + ui:audit:check PASS；UI-193 台账 superseded 收口
- G0 开发期常态 · 不外推 packaged/Provider/GA（收口笔录用语）

## 7. 进度记录

- 2026-09-02 P0 完成：摸底确认 BLOCK-22 通用 widget（DiffRevision.hunks 驱动）与 BLOCK-28 hunkControls（git hunk + decisions 驱动）功能重叠，前者业务路径恒不渲染且无其他消费方（DiffActionBar 无业务挂载、hunk 事件无业务监听）；用户裁决「退休死代码 + 实机复核」。本计划落盘并注册 DOC-REGISTRY。
- 2026-09-02 P1 完成：按 §4 清单移除全链死代码（acceptRejectWidget.ts / DiffActionBar.tsx 整删 + 6 文件清理），逐项 grep 核对 0 残留，tsc --noEmit 0。保留项核实：`onError` 有其他消费方（未删）；hunkControls 活路径全保留。
- 2026-09-02 P2 完成：定向 vitest 87/87（editor + WorkingTreeReview 套件，0 回归）+ tsc 0 + docs:check + ui:audit:check PASS。
- 2026-09-03 P3 完成：dev Electron（CDP :9222，tinkspace / ThinkSpace 工作区）实机复核——login.html 双 hunk scratch：wt-hunk-controls 渲染 ✅ / 鼠标「接受」→ 已接受 ✅ / 键盘 j+r → 已拒绝 + 磁盘回退核对 ✅ / 决策可覆盖更新 ✅。**就地修复活路径真实缺陷**：`buildReversePatchForReject`（src/ipc/working-tree-review.js）反向 patch 头部 start/count 按正向语义取值 + 变更块内 -/+ 交错违反 unified diff 规范 → git apply 必拒；修正为 pre-image 取 new 侧（newStart / ctx+add）并按块分组重排（先 - 后 +），离线临时仓与实机双验证通过。scratch 已清理（双 hunk 全 reject，git diff 归零）。证据 `acceptance/ui-193/block43-p3-live-check.json` + 截图 ×2。
- 2026-09-03 P4 完成：UI-193 台账 superseded 收口（注明业务路径 = UI-206 hunkControls + P3 复核证据）；DOC-REGISTRY status completed；roadmap active 清空；AUDIT-LOG 收口登记。G0 开发期常态 · 不外推 packaged/Provider/GA。
