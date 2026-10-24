---
capability: projectworkspace-render-loop
goal: 修掉 ProjectWorkspace 挂载/更新时的 setState-in-effect 重渲染环——它把渲染线程拖慢到 CDP 求值 6–30s 超时，长期污染 UI 实机取证（UI-557/558/559 都被它挡过）；修好后回填 UI-559 的「停止团队」回执 DOM 证据。
acceptance:
  - 环有可复现根因证据：探针在警告发生瞬间捕获 JS 栈（Vite dev 源码行），不是只看组件名猜。
  - 修复后同一探针：工作区加载 **0 条** "Maximum update depth" 警告，且连续 3 次 CDP 求值全部 <1s 返回（渲染器可响应）。
  - 回归测试：`useWorkSurfaceTabs` 的 `surfaces` 派生数组跨渲染引用稳定；`useWorkspaceTitleBar` 的复位只在**卸载**发生（重跑 effect 不再把标题栏打回默认）；`ChatScrollbar` 测量值不变不 setState。
  - 不再靠"加超时/拆会话"绕过：UI 实机腿在长回合后同一渲染器仍可交互（UI-559 回执 DOM 可取）。
  - 门禁：`npm run closeout` 十三门 + canonical 回写 + 本地提交（不推送）。
status: completed
---

# BLOCK-250 · UI-FIX：ProjectWorkspace 重渲染环

> **一句话**：把「页面一挂上就无限 setState」的存量环拆掉——不是加超时绕过，而是让派生依赖稳定、让复位只在卸载发生、让测量幂等。

## 0. 交接摘要（换 agent 先读这一节）

- **背景**：AUDIT-LOG 2026-10-22 登记的存量缺陷（`Maximum update depth exceeded ... at ProjectWorkspace`）。它让 UI 实机腿反复出现 6–30s 的 CDP 超时，UI-559 的停止回执 DOM 就是被它挡掉的。
- **诊断方法（本轮新增）**：[`scripts/block250-loop-probe.mjs`](../scripts/block250-loop-probe.mjs) —— 隔离栈 + `Page.addScriptToEvaluateOnNewDocument` 注入 console 包装 + `navigator.sendBeacon` 把**警告发生时的 JS 栈**送出渲染器（渲染器随后会被拖死，读回不可靠）。
- **根因（栈证据）**：
  1. `useWorkSurfaceTabs` 每次渲染 `registry.surfaces.filter(...)` 返回**新数组** → `surfaces` 成为每轮新依赖 → 标题栏 effect 每轮重跑。
  2. `useWorkspaceTitleBar` 的 effect **cleanup** 每次重跑都把标题栏重置为默认值（'Petri'/空 tabs）→ 与①叠加：重跑 → 复位 → 重渲染 → 再重跑 → `Maximum update depth`。
  3. `ChatScrollbar` 的 MutationObserver/ResizeObserver 回调每次 `setMetrics` **新对象**（值不变也写）→ 测量本身变成重渲染源。
  4. `updateWorkspaceMode` 依赖 `useSearchParams()` 的对象（每次渲染新实例）→ 传导到 `handleOpenRightResults` → 标题栏 effect（放大①）。
- **修复**：① `surfaces`/`resultSurfaces` memo 化（根因）；② 标题栏复位移到**卸载专用** effect；③ `ChatScrollbar` 值相等保留旧 state；④ `updateWorkspaceMode` 读 `window.location.search`、去掉不稳定依赖。
- **验证**：修复前探针 8 条警告且读回超时；修复后 **0 条**警告、读回 `{count:0}` 即时返回、连续 3 次 CDP 求值 `[0,1,0]ms`。UI-559 回执复跑见§4。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与判据

| 项 | 判据 |
| --- | --- |
| 环 | 工作区加载 + 常规交互（切 tab/打开团队面板）0 条 update-depth 警告 |
| 响应性 | 长回合后同一渲染器连续 3 次 CDP 求值 <1s（不再需要拆会话/加长超时） |
| 回归 | 三处修复各有一条棘轮测试（派生引用稳定/卸载复位/测量幂等） |
| 回填 | UI-559 停止回执 DOM 可取 → `verified` |
| 非范围 | ProjectWorkspace 大规模重构、其他 UI 缺陷、打包/Provider/GA |

## 2. 修复清单

- `frontend/src/hooks/useWorkSurfaceTabs.ts` — `tabSurfaces`/`resultSurfaces` 用 `useMemo`（依赖 `registry`）。
- `frontend/src/pages/project-workspace/useWorkspaceTitleBar.ts` — 主 effect 不再带 setState cleanup；复位放到 `useEffect(() => () => reset(), [updateTitleBar])`。
- `frontend/src/components/copilot/ChatScrollbar.tsx` — `measure` 值比较后保留旧 state（导出 `metricsEqual` 供测试）。
- `frontend/src/pages/project-workspace.tsx` — `updateWorkspaceMode` 用 `window.location.search`，依赖收敛为 `[navigate, projectId, workspaceMode]`。

## 3. 阶段与状态

| 阶段 | 状态 | 产出 |
| --- | --- | --- |
| P0 探针定位 | ✅ | `scripts/block250-loop-probe.mjs` + 栈证据（修复前 8 警告/读回超时） |
| P1 四处修复 | ✅ | 探针修复后 0 警告、读回即时返回 |
| P2 回归测试 | ✅ | 10/10（surfaces 稳定 4 / 卸载复位 1 / 测量幂等 5） |
| P3 实机回填 | ✅ | 团队实机亮/暗各 **20/20**（含 `R10_stop_receipt_ui` 回执 DOM）；UI-559 verified |
| P4 收口 | ✅ | 台账/roadmap/handoff/AUDIT-LOG + closeout + 提交 |

## 4. 验证记录

- **修复前**（探针同一轮，入库证据 `acceptance/block-250-loop-probe.json` 的 `before.raw`；原始 stdout 亦留 `acceptance/block-250-loop-probe-before.log`）：8 条 beacon；栈分别指向
  `ChatScrollbar.tsx:32`（MutationObserver → setState）与 `useWorkspaceTitleBar.ts:73/95`
  （`commitHookEffectListMount`/`commitHookEffectListUnmount` → `useWorkspacePanels.ts:56`），
  随后读回 `probe_error:eval_timeout_30000ms`（渲染器已无法响应）。
- **修复后**（同一份 JSON 的 `after`；原始 stdout 亦留 `acceptance/block-250-loop-probe.log`）：同一探针
  `{"count":0,"samples":[]}`，读回即时；随后**连续 3 次 CDP 求值 `ms=[0,1,0]`**、
  `readyState=complete`（满足判据「3 次全部 <1s」）。
- **回归测试**：`useWorkSurfaceTabs` 4 + `useWorkspaceTitleBar` 1 + `ChatScrollbar` 5 = **10/10** 通过。
- **UI-559 回填**（`acceptance/ui-559/` + `acceptance/block-249/`，与 BLOCK-249 同份）：
  重启 Electron 同数据根后 roster 可见 → 3 成员（含 investigator）→ 结构化/journal 徽标 →
  **点「停止团队」→ 逐成员回执 DOM 可见**（`R10_stop_receipt_ui`：`停止回执：已请求 0 · 本就已结束 3 · 未取消 0` +
  逐成员 `本就已结束`）；亮 `/ui559-team-live.json` **20/20**、暗 `/ui559-team-live-dark.json` **20/20**。
  离屏窗口截图仍不可得 → 如实 `unavailable`（DOM 证据链已足，不为了截图破离屏纪律）。

## 5. 非范围

- 不做 ProjectWorkspace 结构重构（本轮只拆环，不改行为）。
- 不引入虚拟化/性能框架。
- 不碰 G1+ 事项。
