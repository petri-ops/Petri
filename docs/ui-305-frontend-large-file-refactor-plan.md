# UI-305 — 前端巨型组件拆分清债：SimpleChat / project-workspace 等大文件阶段化拆分

- Plan ID：`UI-305-FRONTEND-LARGE-FILE-REFACTOR`
- 状态：planned/queued（2026-09-07 用户裁决立项启动 → 同日让位 BLOCK-62-TITLEBAR-COLUMNIZATION，单工作包串行；仅立项文档 `ab65f4e6` 无实现提交，恢复需 BLOCK-62 收口后用户裁决）
- 前置：无 active 工作包（TEST-INFRA-DEBT 已于 2026-09-06 收口）
- 纪律：G0 开发期常态 · 不外推 packaged/Provider/GA

## 1. 问题定位

前端非测试源码中存在多个 600 行以上的巨型文件（2026-09-07 `wc -l` 基线）：

| 行数 | 文件 | 性质 |
| --- | --- | --- |
| 3540 | `frontend/src/pages/project-workspace.tsx` | 主组件（204–2030 约 1800 行）+ 内联 11 个组件（FileTreeList/FileTreeItem/RightFileTree/WorkspaceFilePreview/BinaryPreviewCard/OfficePreviewPane/PreviewAssets/TextBlock/TerminalPanel/BrowserPanel/EmptyResult） |
| 2343 | `frontend/src/components/copilot/SimpleChat.tsx` | 主组件 39 useState / 24 useEffect / 27 useCallback，渲染体 1427 起约 900 行 + 尾部 6 个内联渲染组件；文件头注释已注明 hook order 敏感 |
| 1781 | `frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx` | 主组件 407 起 + 3 个内联子组件 |
| 1609 | `frontend/src/components/workspace-panels/ResultView.tsx` | 结果面板主组件 |
| 1255 | `frontend/src/components/copilot/conversationRunStore.ts` | 逻辑层 store |
| 1144 | `frontend/src/components/copilot/copilotClient.ts` | 逻辑层客户端 |
| 934 | `frontend/src/components/desktop/DesktopSettingsPanel.tsx` | 设置面板 |
| 774 | `frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts` | 逻辑 hook |
| 743 / 743 | `hooks/useSkillStore.ts` / `workspace-panels/LeftPanel.tsx` | — |
| 717 | `result-studio/ResultStudioChangeSetPanel.tsx` | — |
| 699 / 669 | `copilot/renderers/ChartRenderer.tsx` / `pages/home.tsx` | — |
| 643 / 603 | `lib/data-profile.ts` / `desktop/TitleBar.tsx` | — |

危害：新功能持续向单文件堆 state，hook 顺序脆弱性上升（SimpleChat 文件头注释即证据）；任何小改动需理解整文件，review 与 AI 协作成本高。

## 2. 设计裁决

1. **纯重构零行为变化**：不改 UI 外观、交互、数据流语义、IPC 契约；只做组件外迁与 hook 抽取（逐 hook 平移，保持 hook 顺序）。
2. **豁免清单（大而无害，不拆）**：`tools/inventory.ts`（工具清单 schema 数据）、`lib/electron.d.ts`（类型声明）、`components/icons/Icon.tsx`（图标集合）。
3. **逻辑层缓拆**：`conversationRunStore.ts` / `copilotClient.ts` / `useWorkingTreeReview.ts` / `useSkillStore.ts` / `data-profile.ts` 不默认拆，P2/P3 视组件拆分经验按收益单独裁决。
4. **Electron 主进程不在范围**：实测最大 `src/ipc/working-tree-review.js` 941 行，已模块化（src/ipc、src/main、src/database），健康。
5. **延续既有拆分惯例**：沿用 `SimpleChat/` 子目录（hooks/、子组件、纯函数模块）既有结构，project-workspace 已有 `pages/project-workspace/types` 先例。
6. **0 新 npm 依赖**。

## 3. 阶段划分（单工作包内串行）

### P0 — SimpleChat.tsx（2343 → 目标 ≤1000 行）

按风险从低到高：

1. 尾部 6 个内联渲染组件（2071–2343）外迁 `SimpleChat/` 子目录文件；
2. summary retry 状态簇（5 个 useState）抽 `useSummaryRetry`；
3. 模型菜单 + 访问档位菜单状态簇抽 `useModelAccessMenus`（UI-303 第四档刚落地，此簇活跃）;
4. 会话恢复 / resumable 检查大 effect（608–752 附近）抽 `useConversationResume`；
5. 900 行主渲染 JSX 拆 Composer/MessageList 等子组件——**收益最大工作量也最大，视 P0.1–P4 完成后状态单独裁决，可 defer 至本工作包外**。

### P1 — project-workspace.tsx（3540 行，最大头）

1. 11 个内联组件外迁 `pages/project-workspace/` 子目录（保持既有 `project-workspace/types` 导出兼容，全仓 import 零破坏）；
2. 主组件 state 簇按域抽 hook（具体切口在 P0 经验上于 P1 开工时细化）。

### P2 — ReviewMode.tsx + ResultView.tsx

内联子组件外迁 + hook 抽取，套路同 P0/P1。

### P3 — 剩余 600–950 行组件逐个裁决 + 收口盘点

DesktopSettingsPanel / LeftPanel / TitleBar / home / ResultStudioChangeSetPanel / ChartRenderer 逐个按收益裁决（可判定不动并登记理由）；收口时复查 `wc -l` 基线表并登记。

## 4. 验收

- 每阶段：受影响定向 vitest 全绿（P0 以 `SimpleChat.test.tsx` 等既有测试为回归网）+ `tsc 0` + `npm run ui:audit:check` + `npm run docs:check`。
- 行为零变化：既有测试不改断言（仅允许因 import 路径调整同步改 import）。
- 每阶段 focused commit，同提交更新 `docs/ui-productization-audit.md` UI-305 条目。
- 收口：前端全量 vitest 一次 + 基线表复查 + 豁免/后续候选登记。

## 5. 风险

- **hook 顺序脆弱**：SimpleChat 主组件 hook 顺序敏感，拆分一律整簇平移、不重排；每步跑测试。
- **隐藏耦合**：内联组件可能闭包引用主组件 state，外迁时改 props 传参，需逐个核对。
- **测试盲区**：`RightFileTree` / `TerminalPanel` / `BrowserPanel` 等带 `export` 的内联组件被外部引用，外迁必须保持 re-export 兼容。

## 6. 治理边界

- 单工作包串行，不并行开新工作包；不动 `src/ipc/file-dialog.js` 未提交遗留（UI-304 后续，另行动处置）。
- 本 plan 为 UI-305 唯一 canonical 文档；进度回写本文件 §7 与 roadmap。
- 门禁以 `test/impact-map.json` 定向优先，不默认全量。

## 7. 进度记录

- 2026-09-07：用户裁决立项启动。普查基线登记（§1），阶段划分定案（§3）。当前 active 阶段：P0（SimpleChat）。立项登记完成：DOC-REGISTRY 注册 + README 入口 #81 + roadmap 立即任务置顶；`BLOCK-48` 标注排队让位（检查点 `c29d9f04` 保持）。门禁：`docs:check` PASS（205 docs）；`ui:audit:check` 报工作区 `src/ipc/file-dialog.js` 未提交遗留（UI-304 后续 macOS 引导文案）未配台账——属 UI-304 范畴遗留 WIP，不在本工作包处置范围，UI-305 首个实现提交前需该遗留先行处置（提交或撤销，由用户裁决）。
- 2026-09-08：用户裁决按序推进（ResultStudio 崩溃修复 UI-311 同日收口后启动本包）。P0 全部落地：P0.1 尾部 6 内联组件外迁 `SimpleChat/`（ApprovalRepairHint 随 ApprovalCard 同文件、ApprovalRepairState 移入 types.ts、ResultEditProgressList 保持再导出）+ P0.2 `useSummaryRetry` + P0.3 `useModelAccessMenus`（均在依赖声明之后调用，簇内 hook 相对顺序保持原样）+ P0.4 `useConversationResume`（reconciledRunRef 供既有 useChatStream 复用归本簇所有）；P0.5 主渲染 JSX 拆分按 plan 单独裁决 defer。2343 → 1915 行。门禁：copilot 全面向 + 消费面板 vitest 32 文件 266/266 / tsc 非 TS2550 0（顺手修复 UI-311 遗留 TS2353）/ ui:audit:check / docs:check；实机 dev Electron 重载后 SimpleChat 壳/composer/消息列表在位、零异常（`acceptance/ui-305/p0-simplechat-live.json`）。当前 active 阶段：P1（project-workspace.tsx）。
- 2026-09-08：P1 落地（P1.1 11 内联组件外迁 `pages/project-workspace/`，3464→1876；P1.2 useProjectTreeState 抽取，→1855；创建/刷新编排回调留主组件）。P2 落地（ReviewMode 4 组件外迁 + formatCommitDate/共享类型并入 reviewModeHelpers，1781→1429；ResultArtifactShell 外迁，1609→241，EmptyAnalysisResult 随壳）。P3 逐个裁决：DesktopSettingsPanel/ResultStudioChangeSetPanel/ChartRenderer/home 不动（理由登记台账），逻辑层缓拆不动，LeftPanel/TitleBar 基线自然降至 600 以下。收口盘点：基线复查表登记台账；前端全量 vitest 一次 911/914（3 失败 stash 基线复核为 HEAD 存量并登记 AUDIT-LOG 🟢）；ReviewMode 手风琴用例并发时序 flake（单独 4/4 过）。工作包整包收口 completed/verified。