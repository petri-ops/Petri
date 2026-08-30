# BioF3 Desktop 文档入口

最后更新：2026-08-18（BLOCK-10-AUDIT-CLOSEOUT COMPLETED · BLOCK-10-ARCHITECTURE COMPLETED · **BLOCK-11-BIOSKILLS-INTEGRATION 启动**：用户裁决 "block-11-bioSkills" 启动 v1.0 plan（active）；Top 5 priority categories：single-cell (P0) / variant-calling (P0) / pathway-analysis (P1) / methylation-analysis (P1) / read-qc (P2)；GPTomics/bioSkills.git → BioF3 plugin/skill 映射；6 PHASE：PHASE 0 调研 + PHASE 1 single-cell + PHASE 2 variant-calling + PHASE 3 pathway+methylation + PHASE 4 read-qc + PHASE 5 收口；不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+）

## 项目治理入口

1. [`document-governance.md`](./document-governance.md) — 计划、Goal、Handoff、证据、状态与归档的生命周期规范。
2. [`worktree-governance.md`](./worktree-governance.md) — Worktree 启动门、所有权、环境隔离、合并与清理纪律。
3. [`COLLABORATION.md`](./COLLABORATION.md) — 团队协作约定：分支策略、合并前门禁、禁止对 main 强制推送、双机并行协调。
4. [`DOC-REGISTRY.json`](./DOC-REGISTRY.json) — 非归档 Markdown 的机器可读目录与 canonical truth 注册表。
5. [`AUDIT-LOG.md`](./AUDIT-LOG.md) — 每次 Agent 会话优先处理的审计广播台。
6. [`parallel-development-guide.md`](./parallel-development-guide.md) — 多模块并行开发的冲突风险管控策略；独立模块大胆并行，跨层接口变更必须串行。
7. [`architecture/gateway-design.md`](./architecture/gateway-design.md) — Backend Gateway 架构设计；统一入口、路由分发与断路器。
8. [`BioF3-Desktop-Evaluation-Report-2026-08-14.md`](./BioF3-Desktop-Evaluation-Report-2026-08-14.md) — Desktop 评测报告；2026-08-14 评估记录与改进建议。

## 长期核心指引


1. [`scientific-intelligence-os-vision.md`](./scientific-intelligence-os-vision.md) — BioF3 长期产品愿景、当前定位、阶段跃迁条件与禁止跨阶段建设规则。它约束方向，但不替代当前工作包。
2. [`doc-governance-gates-plan.md`](./doc-governance-gates-plan.md) — 2026-08-16 用户裁决启动、同日 GATES-0~GATES-4 五阶段全部完成并收口的治理工程工作包；`scripts/docs-governance.mjs` / `scripts/check-ui-productization-audit.mjs` 门禁硬化、JSON `--report` 输出、DOC-REGISTRY 扩展字段规范化与剩余 12 项治理债修复；不修改 UI/主代码/Provider。收口记录见 [`doc-governance-gates-closeout.md`](./doc-governance-gates-closeout.md)。
3. [`block-2-ui-157-review-plan.md`](./block-2-ui-157-review-plan.md) — 2026-08-16 用户裁决启动的 UI 复核工作包；专收口 `ui-productization-audit.md` 中 `UI-157`（Skills UI 页面 P1/W-04）`in_progress` 状态：接通 `useSkillStore` ↔ `core/shared-backend/workflow-engine.js` 的 IPC 桥（UI-161 显式留白的跨包接桥）+ 核对 UI-161 既有清理未回退 + 真实 dev Electron 实机走查 `/skills` 路由 + UI-157 `in_progress → verified`；不外推 Provider/packaged/GA/Worktree；Single work package serial 当前 active 工作包。
4. [`block-2-ui-157-review-closeout.md`](./block-2-ui-157-review-closeout.md) — 2026-08-16 已收口的 UI 复核工作包；PHASE 0 摸底 + PHASE 1 IPC 桥接通（preload.js + main.js + electron.d.ts + useSkillStore.ts + useSkillStore.test.ts 共 5 文件 / +518 / −2）+ PHASE 2 UI-161 5 项清理核对 5/5 PASS + PHASE 4 audit 收口笔录；PHASE 3 实机按用户裁决 P1-T-A 跳过 Vite-only mock 路径；UI-157 + UI-161 保持 `in_progress` 待 PHASE 3 真实 dev Electron 实机证据升级 verified；4 commit 落地（`2d81377` / `0be5483` / `7e010a4` / `5c98ca8`）+ DOC-REGISTRY `active → completed`；4 治理门 GREEN + 18 vitest PASS；不外推 packaged/Provider/P7/GA。
5. [`block-3-ipc-bridge-hardening-plan.md`](./block-3-ipc-bridge-hardening-plan.md) — 2026-08-16 用户裁决启动的 IPC 桥硬化工作包；专收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核发现的 12 项 Major 中的 P1 必修 + P2 强烈建议（11 项）
6. [`block-4-ipc-bridge-polish-plan.md`](./block-4-ipc-bridge-polish-plan.md) — 2026-08-16 用户裁决"按你的节奏来"启动的 IPC 桥打磨工作包；收口 PHASE 6 剩余 Minor + Nit 收口
7. [`block-5-ipc-bridge-finalize-plan.md`](./block-5-ipc-bridge-finalize-plan.md) — 2026-08-16 用户裁决"1-4 搞完"
8. [`block-6-ui-158-ui-159-verification-plan.md`](./block-6-ui-158-ui-159-verification-plan.md)
9. [`block-7-ui-161-verification-plan.md`](./block-7-ui-161-verification-plan.md)
10. [`block-8-ui-132-verification-plan.md`](./block-8-ui-132-verification-plan.md)
11. [`block-9-mega-file-refactor-plan.md`](./block-9-mega-file-refactor-plan.md) — 2026-08-16
12. [`block-9-1-main-js-split-plan.md`](./block-9-1-main-js-split-plan.md) — 2026-08-16 用户裁决"继续"启动的 main.js 拆分重构工作包；基于 [`senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) 评审报告 §2.4 P1；拆 17 个 IPC setup 函数 + setupDesktopEnv 716 行；纯代码组织变更 0 业务逻辑差异；不外推剩余 5 项 BLOCK-9.2~9.6 用户裁决"按照你的建议来"启动的巨型文件拆分重构工作包；基于 [`senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) 评审报告；3 项重构：拆 `_data.ts` 2157 → 5 文件 / 抽 `buildPreviewTable` 到 `lib/file-preview/` 解决 ResultView+SimpleChat 重复 / 拆 `project-workspace.tsx` 3222 → 4 文件；纯代码组织变更 0 业务逻辑差异；不外推主 agent 重构剩余 6 项 — 2026-08-16 用户裁决"接下来要做什么呢" + 选项 "BLOCK-8 UI-132 dev CSP 静态化（推荐）" 启动的 UI-132 既有 in_progress 静态收口工作包；PHASE 0 摸底发现 entry 描述的两个改动的目标都已 100% 落地但 entry 没同步状态（同 BLOCK-7 PHASE 0 UI-161 同类盲点）；4 PHASE：PHASE 1 静态 grep 4 项 / PHASE 2 Vite build + 产物 grep / PHASE 3 theme-token-contract test / PHASE 4 audit + closeout；UI-132 (行 239 in_progress) 仅当 4 项 grep + Vite 产物 grep + theme-token test 全部 PASS 才 `in_progress → verified`；沿用 BLOCK-7 静态升级路径（UI-132 改动是纯代码静态层，不依赖 IPC 桥） — 2026-08-16 用户裁决"Block-7 是啥 开搞" + 选项 "Vite-only + 静态 grep 验证" 启动的 UI-161 既有 in_progress 实机复核工作包；4 PHASE：PHASE 1 静态 grep 6 项 / PHASE 2 Vite preview + DOM 检查 / PHASE 3 theme-token-contract test / PHASE 4 audit + closeout；UI-161 仅当 6 项 grep + Vite preview + theme-token test 全部 PASS 才 `in_progress → verified`；不外推 BLOCK-8/9/10 候选。 — 2026-08-16 用户裁决"可以继续"启动的 UI-158 + UI-159 实机复核工作包（推翻 P1-T-A 跳过决策，重新启用 dev Electron 实机）；4 PHASE：PHASE 1 dev Electron 启动 + playwright MCP CDP attach / PHASE 2 UI-158 CommandPalette 实机验证 / PHASE 3 UI-159 Workspace UI plumbing 实机验证 / PHASE 4 evidence 收集 + 收口；不外推 BLOCK-7/8/9/10 候选。启动的 IPC 桥收尾工作包；合并 E1 poller 性能（execute 立即 publish pending + 终态立即停 poller）+ H1 plan §3.1.A 修订 + H2 closeout R8/R9/R10 补充 = 3 项微调；PHASE 2 采用候选 B 跳过测试补（PHASE 6 报告 E1 G0 边界内 OK）；不外推 E1-d/E1-e 架构改动 + 不做 dev Electron 实机复核（候选 2/3 留 BLOCK-6+）。（10 项 + 1 项 + 1 项 = 12 项 / 跨 3 文件）；包括 A5 preload 参数守卫 / B3 9→4 default "failed" / B4 wakeup console.warn / B5 preload onProgress try/catch / C2 _getSkillsSDK 注释 / C3 preload L114-169 → L114-218 / D1 useSkillStore payload 自动派生 / E2 setExecutions deep-equal / G5 unmount 清 _progressUnsubs / H3 main.js 注释加 9→4 行号；跳过 E3 / F2 / F3 / H1 / H2（错过收口窗口）；不外推 packaged / Provider / P7 / GA / UI-157 verified / E1 100 并行 poller。；P1 安全 main.js 4 IPC handler 加 sender 守门（B1/F1，对齐 `setupAgentWorkbenchFlagsIpc` L1162 模式）+ P1 契约 main.js poller L2143 9→4 状态映射（C1）+ P2 内存清理（A1 终态清 onProgress / A2 poller 停止 / A3 execute 终态同步）+ P2 错误（B2 `_publishSkillProgress` try/catch）+ P2 测试补 G1 wakeup 链路 + G2 execute 失败 + G3 callback 抛错 + G4 cancel 失败 + G6 main.js 9→4 状态映射单测；不改 preload.js / electron.d.ts / 4 page / desktopBridge.ts / core/shared-backend/*；不外推 packaged/Provider/P7/GA/UI-157 verified 升级；Single work package serial 当前唯一 active 工作包。
13. [`block-16-working-tree-review-mode-plan.md`](./block-16-working-tree-review-mode-plan.md) — 2026-08-19 BLOCK-15 全部 SUB 收口后用户裁决"直接推"启动的 Working Tree Review Mode 工作包（v1 thin-slice 范围）；为 AI Agent 完成一次任务后弹出 PR-style diff 审阅浮层（hunk 级别批准/拒绝/回滚）；5 条 IPC + 1 条 main→renderer 通知 + 手写 React diff 渲染（零新依赖，对齐 ADR-RS-3）+ 拒绝清单 + system-prompt 注入；PHASE 0 调研 + PHASE 1 IPC + PHASE 2 浮层 + PHASE 3 agent-done + PHASE 4 收口；不外推 Provider / packaged / GA / P7 / notarization / Result Studio 既有 diff / core/shared-backend 既有方法。
14. [`block-16-working-tree-review-mode-closeout.md`](./block-16-working-tree-review-mode-closeout.md) — 2026-08-19 BLOCK-16 已收口（4 commit：`7f94854` PHASE 1 / `59aeb95` PHASE 2 / `da48006` PHASE 3 / PHASE 4 closeout 笔录）；PHASE 1 IPC channel + 共享解析器层（git-adapter 2 新方法 + 5 ipcMain.handle + 1 webContents.send + preload `workingTreeReview` 子树 + 拒绝清单 30 天 TTL）+ PHASE 2 浮层组件（5 组件 + 1 CSS module + App mount + electron.d.ts + UI-180 in_progress）+ PHASE 3 agent-done 事件接入 + 拒绝清单 + system-prompt 注入（typed event bus `agentTaskDone` + SSE 4 处 done 分支 dispatch + `<working-tree-rejects>` 注入段 + 11/11 vitest PASS）+ PHASE 4 专项门禁 `npm run block:working-tree-review` 5/5 PASS + 4 治理门 GREEN（docs:check 133 / ui:audit:check 131 / tsc 0 / docs:reconcile 0）；不变量守住（preload.js 既有 19 命名空间 / electron.d.ts 既有类型 / desktopBridge.ts 既有 API / Result Studio 既有 diff 组件 / core/shared-backend 既有方法 0 diff / 0 npm 依赖变动）；G0 开发期常态 · 不外推 packaged/Provider/GA/P7/Chart a11y P2/Worktree；UI-180 保持 `in_progress`（按 audit 行 402 治理纪律：仅当真实 dev Electron 实机过目后才可考虑 verified）。
15. [`block-17-agent-doc-review-panel-plan.md`](./block-17-agent-doc-review-panel-plan.md) — 2026-08-21 启动 / 2026-08-22 superseded。原始目标：Agent 文档审阅侧边栏面板。2026-08-22 用户裁决'多一个审阅界面没有意义'，UI 入口改为文件页面内 diff toggle，由 BLOCK-18 接管 active 槽位。已实现的 IPC / preload / bridge / 类型 / .wt-* 样式 / IPC 测试由 BLOCK-18 复用；独立面板 / 菜单项 / 状态槽由 BLOCK-18 删除。
16. [`block-18-workspace-md-diff-plan.md`](./block-18-workspace-md-diff-plan.md) — 2026-08-22 BLOCK-18 接管 BLOCK-17 active 槽位。把'前后差异'直接搬到 WorkspaceFilePreview 内：toolbar 加'预览 / 对比' toggle，diff 视图复用 BLOCK-17 computeSimpleDiff + .wt-* 样式 + agentDocReview IPC。PHASE 1 提取 markdownDiff.ts / PHASE 2 WorkspaceFilePreview 加 mode 状态机 / PHASE 3 删除 BLOCK-17 独立面板 / PHASE 4 验收门禁 + 收口；不外推 packaged / Provider / GA G1+。
17. [`block-20-code-review-panel-plan.md`](./block-20-code-review-panel-plan.md) — 2026-08-22 BLOCK-20 接管 BLOCK-18 active 槽位（BLOCK-18 转 superseded）。系统级代码审阅体验：常驻右侧审阅面板覆盖项目所有 git 跟踪的修改文本文件（不限 markdown），基准 vs git HEAD，unified / split 两种视图，hunk 级别 Accept / Reject，inline-edit 抽屉承载 BLOCK-19 `<textarea>` 资产。复用 BLOCK-16 DiffFileView / DiffHunkView / applyPatch / revertPaths / `<working-tree-rejects>` system-prompt 注入（0 改动）。5 新 IPC（git:list-modified / git:file-head-content / git:split-side-diff / git:revert-file / git:apply-inverse-hunk）+ 2 新前端组件（`<CodeReviewPanel />` + `<CodeReviewDrawer />`）。不外推 packaged / Provider / GA G1+ / monaco-editor / react-diff-viewer / n-way merge / 跨项目审阅。
18. [`block-20-code-review-panel-closeout.md`](./block-20-code-review-panel-closeout.md) — 2026-08-22 BLOCK-20 已收口（4 PHASE 全部落地：PHASE 0 治理登记 / PHASE 1 git-adapter 5 方法 + IPC 5 通道 + 38 测试 / PHASE 2 WorkingTreeReview 浮层→常驻右侧面板 / PHASE 3 workspace.writeTextFile IPC + 项目文件 inline-edit + BLOCK-17/19 资产收口 / PHASE 4 per-hunk reject inverse 接线 4 文件 + 12 测试）；7 commit + 1 待提交 closeout（`b855b54` / `18995bb` / `ea03eaf` / `2dee4d1` / `6482cd9` / `3d0c874` / `0d5b7e3` / `1292e24`）；DOC-REGISTRY `active → completed` + 新增 BLOCK-20-CODE-REVIEW-PANEL-CLOSEOUT reference entry；4 治理门 GREEN（docs:check / ui-audit:check / tsc --noEmit 0 / docs:reconcile 0）+ 专项门禁 `block:code-review` 8/8 PASS；不变量守住（preload.js 既有 19 命名空间 / electron.d.ts 既有类型 / BLOCK-16 既有组件 / Result Studio 既有 diff 组件 / core/shared-backend 既有方法 0 diff / 0 npm 依赖变动）；UI-185 保持 `in_progress` 待真实 dev Electron 实机过目升级 verified；G0 开发期常态 · 不外推 packaged/Provider/GA/P7/notarization/dist staleness G1+。
19. [`block-21-harness-index-500-plan.md`](./block-21-harness-index-500-plan.md) — 2026-08-24 启动并收口的 harness 索引 500 排查修复工作包；真因是 `core/r-server/routes/_helpers/harness-shared.js` 的 `desktopRootFromHere()` 在 PHASE 2.2a 拆 `routes/harness.js` → `routes/_helpers/` 后路径深度仍按旧位置用 3 层（需 4 层），导致 `loadHarnessModule()` 拼出 `desktop/core/scripts/harness-file-index.mjs`（不存在）→ import ERR_MODULE_NOT_FOUND 被 catch 转 500。单点修：3 → 4 层 + 2 回归测试 PASS。同 bug 影响所有调 `loadHarnessModule()` 的端点，自动连带修复；不外推 packaged/Provider/GA/P7/dist staleness G1+。
20. [`block-21-harness-index-500-closeout.md`](./block-21-harness-index-500-closeout.md) — 2026-08-24 已收口的 BLOCK-21 工作包；1 行路径修复 + 2 端到端测试 PASS；4 治理门 GREEN（docs:check 140 / ui:audit:check 157 / tsc 0 / harness test 2/2 PASS）。UI 不动，前端契约不改；不变量守住（router/authorize/db migration/0 新 npm 依赖）。
21. [`block-22-codemirror-inline-diff-plan.md`](./block-22-codemirror-inline-diff-plan.md) — 2026-08-24 启动并收口的 CodeMirror 6 集成 + 内联 Diff 工作包；4 PHASE 串行：P0 基础脚手架 + 12 个 @codemirror/* 依赖 + 只读渲染（UI-191）/ P1 unified diff 行级 + 字符级 + scroll/pulse（UI-192）/ P2 Accept/Reject widget + 复用 BLOCK-20 PHASE 1+4 5 IPC 0 新增（UI-193）/ P3 桥接层 + Context 抽象 + 跳转触发器 + 全局监听桥（UI-194）。5 commit（`b9e697f` P0-LAUNCH + `3745bd5` P0 + `0436be2` P1 + `0e28498` P2 + `b1f4453` P3）+ 24 files / +4357/-212；复用 BLOCK-20 PHASE 1+4 git-adapter 6 方法 + workspace.writeTextFile + reject 清单 30 天 TTL（0 新增 IPC）；不引 monaco-editor / react-diff-viewer / react-split-pane / n-way merge；不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+。
22. [`block-22-codemirror-inline-diff-closeout.md`](./block-22-codemirror-inline-diff-closeout.md) — 2026-08-24 BLOCK-22 已收口（4 PHASE 全部落地 + 5 commits / 24 files / +4357/-212 / 19 个新文件 ~3977 行）；DOC-REGISTRY `active → completed` + 新增 `BLOCK-22-CODEMIRROR-INLINE-DIFF-CLOSEOUT` reference entry + 5 linkedCommits；4 治理门 GREEN（tsc --noEmit 0 / BLOCK-22 影响范围 vitest 53/53 / docs:check 141 / docs:reconcile 0）；不变量守住（preload.js 19 命名空间 / electron.d.ts 既有类型 / desktopBridge.ts 既有 API / core/shared-backend 既有 6 git-adapter 方法 0 diff / 0 新 npm 顶层依赖 / agent-tools/* + agent-transcripts/* 0 diff / 24 个 WIP + test.txt 0 触碰）；UI-191/192/193/194 保持 `in_progress`（按 audit 行 402 治理纪律：仅当真实 dev Electron 实机过目后才可考虑 verified；`docs/ui-productization-audit.md` 在 24 个 WIP 锁内笔录延迟登记）；G0 开发期常态 · 不外推 packaged/Provider/GA/P7/notarization/dist staleness G1+.
23. [`block-23-review-codemirror-upgrade-plan.md`](./block-23-review-codemirror-upgrade-plan.md) — 2026-08-28 BLOCK-23 UI checkpoint：用 BLOCK-22 CodeMirrorEditor inline-diff（语法高亮 + 字符级 diff）替换旧 DiffFileView/DiffHunkView 纯文本渲染；保留 working-tree-review IPC 层 + useWorkingTreeReview hook + commit dialog + CodeReviewDrawer；删除 agent-doc-review.js BLOCK-17 死代码（含 preload / electron.d.ts / main.js / project-workspace.tsx 全链路清理）；0 新增 IPC / 0 新增依赖；UI-200 dev Electron verified，completed 待 UI-201 P6 evidence refresh。
24. [`ui-201-result-studio-p6-evidence-repair-plan.md`](./ui-201-result-studio-p6-evidence-repair-plan.md) — 2026-08-28 用户裁决启动的唯一 active 工作包：修复 Result Studio P6 evidence chain、登记 UI-200 evidence ownership，并以干净提交源树诚实刷新 205-file canonical P6 source-bound evidence；完成后回写 BLOCK-23 completed；不放宽 verifier，不外推 packaged / Provider / GA / P7。
25. [`block-24-ui-ledger-backfill-plan.md`](./block-24-ui-ledger-backfill-plan.md) — 2026-08-28 已收口：补登 BLOCK-22 遗留 UI-191~194 台账（UI-191/192 verified；UI-193/194 实机取证后保持 in_progress——widget 未上业务路径 / pending-scroll 消费侧未挂载，证据 + 根因已登记）；`test:changed:list` 确认已被 `852f4b4` 修复；两处集成缺口修复留用户裁决；不外推 packaged / Provider / GA / P7。
26. [`block-25-codex-parity-review-plan.md`](./block-25-codex-parity-review-plan.md) — 2026-08-29 已收口：Codex `/review` 同款 AI 代码审阅落地 WTR 抽屉（只读评审子代理 + 结构化 findings + 跳转 + 修复回传，UI-202 dev Electron verified）；顺带修复 WTR staged-only diff 空面板缺陷；不外推 packaged / Provider / GA / P7。
27. [`block-26-review-ux-parity-plan.md`](./block-26-review-ux-parity-plan.md) — 2026-08-29 已收口：审阅 UX 复刻翻新 verified（UI-203）——verdict 汇总头 / 按文件分组 / diff 行内 gutter+卡片标注 / 活动流 / 四目标（uncommitted/base-branch/commit/custom）/ 渠道持久化 / detached 结果；不外推写侧自动化 / packaged / Provider / GA / P7。
28. [`block-27-ai-review-removal-plan.md`](./block-27-ai-review-removal-plan.md) — 2026-08-29 已收口：AI 审阅按用户裁决整体移除（冗余）；WTR 确定性跟踪器（diff/hunk/commit）保留；UI-202/203 台账留痕；git 历史 0ca7e59..7fc08c5 可恢复；不外推 packaged / Provider / GA / P7。
29. [`block-28-review-mode-plan.md`](./block-28-review-mode-plan.md) — 2026-08-29 已收口：BLOCK-28 方案 B——代码审阅升级为主区一级审阅模式（对标 VS Code SCM）——`/review` 一级路由 + ReviewModePage（summary 条 / 文件树分组 / 大空间 diff / 内嵌提交框）+ TitleBar 导航 + 旧抽屉退役；UI-204~207 dev Electron verified（证据 `acceptance/ui-204/`）；复用 useWorkingTreeReview / git:working-tree-* 全家桶（0 新增 IPC / 0 新依赖）；不外推 packaged / Provider / GA / P7。
30. [`block-28-1-review-mode-polish-plan.md`](./block-28-1-review-mode-polish-plan.md) — 2026-08-29 已收口：主区审阅页浅色主题串色修复（旧抽屉 CSS 不存在变量名回退暗色 → 全量迁移真实 token 明暗自适配，UI-208 verified）+ Codex 级布局打磨（进度细条/图标文件树/diff 头统计/图形化空态/accent Commit 主按钮，UI-209 verified，证据 `acceptance/ui-208/`）；0 新增 IPC / 0 新依赖；不外推 packaged / Provider / GA / P7。
31. [`block-28-2-review-mode-dock-plan.md`](./block-28-2-review-mode-dock-plan.md) — 2026-08-29 已收口：CodeReview 改回右侧停靠面板（wt-dock 520px，TitleBar Toggle，项目页保持可见，UI-210 verified）+ 审阅页字号升档对齐全局基线 + hunk 控件卡片化（UI-211 verified，证据 `acceptance/ui-210/`）；/review mode 路由保留（共享组件）；0 新增 IPC / 0 新依赖；不外推 packaged / Provider / GA / P7。
32. [`block-28-3-review-mode-chrome-fix-plan.md`](./block-28-3-review-mode-chrome-fix-plan.md) — 2026-08-29 已收口：审阅面板全面中文化（「审阅」，UI-212 verified）+ 按钮卡片化对齐首页快捷入口风格 + chrome 字号回落 12px 对齐软件主流；证据 `acceptance/ui-212/`；0 新增 IPC / 0 新依赖；不外推 packaged / Provider / GA / P7。
33. [`block-28-4-review-exit-entry-plan.md`](./block-28-4-review-exit-entry-plan.md) — 2026-08-30 已收口：审阅面板显式「退出」按钮（dock→onClose / mode→exitReviewMode，UI-213 verified）+ 「+」下拉菜单新增「审阅」入口（toggleWorkingTree）；定向 vitest 19/19 + CDP 实机 8/8（证据 `acceptance/ui-213/`）；0 新增 IPC / 0 新依赖；不外推 packaged / Provider / GA / P7。
34. [`block-28-5-review-embed-right-panel-plan.md`](./block-28-5-review-embed-right-panel-plan.md) — 2026-08-30 已收口：审阅并入右侧边栏 tab 体系（RightPanelMode/RIGHT_PANEL_ITEMS 增加 review，「+」菜单原生包含；RightPanel 渲染 review tab 复用 dock 形态；workingTreeOpen ⇄ tab 双向同步；浮层仅工作区外兜底，UI-214 verified，证据 `acceptance/ui-214/`）；0 新增 IPC / 0 新依赖；不外推 packaged / Provider / GA / P7。
4. [`g0-living-foundation-plan.md`](./g0-living-foundation-plan.md) — 当前永久 G0 可信基础层主线；LF12 原始核心资格保持 maintained，Result Studio 产品支持声明暂停，P7 deferred。
5. [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md) — 已完成的 G0 Baseline v1 资格认证、证据边界与永久维护契约。
6. [`g0-scientific-data-contract-plan.md`](./g0-scientific-data-contract-plan.md) — SDC-0 / SDC-1-A / SDC-1 / SDC-2 已完成；SDC-3～SDC-7 deferred。
7. [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) — UX1A～UX1G-2 结果体验短闭环已完成；P4R-0～P6 已按非资格边界收口，发布级 P7 deferred。
8. [`g0-critical-crosscut-hardening-plan.md`](./g0-critical-crosscut-hardening-plan.md) — 已重新真实收口的横切修复工作包；保留科学、进程、HTTP 与逐契约 Acceptance 证据。
9. [`g0-rs0-result-studio-audit.md`](./g0-rs0-result-studio-audit.md) — G0-RS0 现状审计与架构 ADR；Result Studio 的复用/新增边界、契约缺陷与 Git 风险矩阵的唯一裁决记录。
10. [`g0-rs-ux1h-async-tool-surface.md`](./g0-rs-ux1h-async-tool-surface.md) — 2026-08-09 已按非资格边界收口的 Async Tool Surface 工作包；UI-126 已于 2026-08-12 经 Windows 开发态 Electron 实机复核升为 `verified`，仍不外推 Provider/packaged 资格。
11. [`agent-concurrency-design.md`](./agent-concurrency-design.md) — 2026-08-11 已完成的 Agent Concurrency 工作包；A-1～A-6 开发态 Electron evidence 精确绑定实现提交 `6adeaa9`。
12. [`g0-ide-mcp-tools-plan.md`](./g0-ide-mcp-tools-plan.md) — 2026-08-14 启动的 IDE MCP 工具集工作包；为 Agent 暴露 `ide_file_*` / `ide_terminal_*` 等 18 个 `ide_*` MCP 工具（分 Phase 1/2/3 推进），仅面向 Agent 通道，不重复既有面向 UI 的 `file:*` IPC。
    - [`block-9-1-main-js-split-closeout.md`](./block-9-1-main-js-split-closeout.md) — 2026-08-17 BLOCK-9.1 main.js 拆分 5 PHASE 全部落地（2450 → 1066 行 = -1384 行 / -56.5%）；12 个 src/ipc/ + 2 个 src/main/ 共享层；4 治理门 GREEN；不外推
13. [`agent-workbench-enhancement-plan.md`](./agent-workbench-enhancement-plan.md) — Agent Workbench 增强计划（参考文档，已登记）。
14. [`agent-workbench-p1-a5-verification-2026-08-15.md`](./agent-workbench-p1-a5-verification-2026-08-15.md) 
13. [`block-9-2-mega-file-refactor-plan.md`](./block-9-2-mega-file-refactor-plan.md) — 2026-08-17 BLOCK-9.1 收口后用户裁决"可以开搞了"启动的非文件级巨型文件拆分重构工作包；基于 [`senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §3 5 项；拆 5 个文件 plugin-manager 1457 + SimpleChat 2153 + ResultView 1662 + DesktopSettingsPanel 1515 + useSkillStore 743；纯代码组织变更 0 业务逻辑差异；PHASE 0 是架构调研 worker 委派；不外推 G1+— 2026-08-15 已按开发态 Electron 边界完成的 A5 验证与收口报告；UI-AGENTWB-003 / UI-AGENTWB-004 转 `verified`，双 flag（on/off）链 + §X.2 兼容性测试矩阵 5 项 PASS；不外推 packaged / Provider / P7 / GA。
14. [`code-audit-closeout-plan.md`](./code-audit-closeout-plan.md) — 2026-08-17 用户裁决「开搞」启动的 Agent Harness 8 份独立只读审计报告收口工作包；4 PHASE 25 修复单元（11C + 5H + 9 Major）；plan v1.0 / 511 行 / 9 §
    - [`block-10-audit-closeout.md`](./block-10-audit-closeout.md) — 2026-08-18 BLOCK-10-AUDIT-CLOSEOUT 收口报告 v1.0 / 11 节；8 主 commits + 3 PHASE 4 closeout commits；13 项已修复（C-001/C-002/S-001~S-007/PR-001/OB-004/OB-005 partial/PL-001）+ 12 项不外推；4 治理门 GREEN / 31 tests / 0 新依赖；DOC-REGISTRY `active → completed` + 8 linkedCommits
14. [`block-10-architecture-plan.md`](./block-10-architecture-plan.md) — 2026-08-18 BLOCK-10-AUDIT-CLOSEOUT 收口后用户裁决启动的架构层面重构工作包；收口 BLOCK-10 §10.3 候选清单 19 项（10 A-* + 5 lifecycle/DB + 4 rserver-http），其中 12 项主范围 + 7 项关联候选（observability-work-package / rserver-http-debt-pack / type-drift-pack / fixture-manifest-pack）；plan v0.2 / 12 § / 4 PHASE（PHASE 1 DB 体系化 + PHASE 2 r-server 大文件拆分 + PHASE 3 agent-runner 拆分 + PHASE 4 audit + closeout）；12 主范围全部落地（见下 closeout）；不外推 packaged / Provider / GA / P7 / notarization / dist staleness
    - [`block-10-architecture-closeout.md`](./block-10-architecture-closeout.md) — 2026-08-18 BLOCK-10-ARCHITECTURE PHASE 4 closeout 报告 v1.0 / 11 节；12 主范围全部落地（A-001/2/3/5/7/8/9/10 + PR-012 + E-019 full + A-006 部分）；7 关联候选不外推；chf0 5/5 + 106+ tests PASS + 0 regression + 4 治理门 GREEN
15. [`block-11-bioSkills-integration-plan-v1.0.md`](./block-11-bioSkills-integration-plan-v1.0.md) — 2026-08-18 用户裁决 "block-11-bioSkills" 启动的 bioSkills 生态集成工作包；GPTomics/bioSkills.git 32 categories × ~170 SKILL.md 映射到 BioF3 plugin/skill；Top 5 优先级：single-cell (P0 95分) / variant-calling (P0 92分) / pathway-analysis (P1 85分) / methylation-analysis (P1 82分) / read-qc (P2 78分)；plan v1.0 / 14 § / 6 PHASE（PHASE 0 调研 + PHASE 1 single-cell plugin/skill + PHASE 2 variant-calling + PHASE 3 pathway+methylation + PHASE 4 read-qc + PHASE 5 收口）；不外推 marketplace 真实后端 / packaged artifact / Provider 矩阵 / OSS 远程分发 / GA 公证流水线 / MCP 暴露 / 32 category 全实现 / packaged/Provider/GA G1+
15. [`t-aw-013-packaged-verification-2026-08-15.md`](./t-aw-013-packaged-verification-2026-08-15.md) — 2026-08-15 已按 packaged Electron 边界完成的 T-AW-013 实机核对；6/6 步骤（CDP attach + bridge 同步方法 + 4 renderer + CSV BOM `EF BB BF` 字节级 + Markdown `| --- |` 分隔 + fallback 0 下载按钮）通过；A4 / P2 / P1.5 / UI-AGENTWB-007 证据等级升级为「前端 + dev Electron + packaged Electron 三轴」；4 处契约偏差已在 `ui-productization-audit.md` 行 244 CONTRACT-DRIFT-001 脚注登记；`qualificationEligible` 维持 false（Provider / GA 链路未覆盖）。
16. [`agent-workbench-dev-electron-verification-2026-08-15.md`](./agent-workbench-dev-electron-verification-2026-08-15.md) — 2026-08-15 T-AW-014 dev Electron 边界内 4 工作包二次实机核对收口；UI-AGENTWB-005/006/007 由 `in_progress` 升 `dev Electron 边界内 verified`，UI-AGENTWB-004 由 A5 verified 扩展 dev 实机覆盖；三路径核对 6/6 步骤（CLI flag + Settings toggle + bridge.set off → reload DOM=0）通过；A4 5 路径 + P1.5 CSV/MD BOM 字节级 + P2 chart 8 rect a11y 全 PASS；target-file 7 文件 95/95 测试通过；`qualificationEligible` 维持 false（dev Electron 不外推 Provider / GA）。
## 当前开发必读

默认只按顺序读取三项；若其中声明 active 工作包，再读取对应 canonical 计划：

2. [`AUDIT-LOG.md`](./AUDIT-LOG.md) — 活跃阻塞、待合并和当前进行中阶段。
3. [`next-steps-roadmap.md`](./next-steps-roadmap.md) — 当前立即任务。
4. [`project-workspace-handoff.md`](./project-workspace-handoff.md) — 当前可恢复 Git/工程检查点。
只有任务实际涉及阶段顺序、UI 或模块边界时，才读取 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)、[`ui-productization-audit.md`](./ui-productization-audit.md) 或 [`development-module-map.md`](./development-module-map.md)。其他 G0 资格、插件、发布和历史材料从上方核心指引、下方专项规范或 `DOC-REGISTRY.json` 按需定位；已完成工作包和 Acceptance 不属于默认启动上下文。

## Branch Conversation 架构

- [](./branch-data-model.md) — 分支对话架构后端核心：SQLite 持久化 + IPC handlers + MCP 工具定义。

## 当前有效专项规范

- [`codex-style-workbench-direction.md`](./codex-style-workbench-direction.md) — UI 产品方向。
- **Skills 子文档入口图**（2026-08-16 GATES-4 batch 2 增补）：
  - **入口** [`skills-architecture.md`](./architecture/skills-architecture.md) — Skills 层四层架构设计（Skills → Workflows → Plugins → Capabilities），唯一 canonical=true。
  - 设计稿 [`skills-schema.md`](./skills-schema.md) — Skill Manifest Schema 标准定义（canonical=false，待 supersede）。
  - 设计稿 [`skills-registry.md`](./skills-registry.md) — Skills 注册与发现机制（canonical=false，待 supersede）。
  - 设计稿 [`skills-workflow-integration.md`](./skills-workflow-integration.md) — Skills 与现有 Plugin/Workflow 系统的集成（canonical=false，待 supersede）。
  - 三份设计稿由 `skills-architecture.md` §3 引用；阅读时以架构入口为锚点。
- [`macos-oss-auto-update.md`](./macos-oss-auto-update.md) — macOS 构建、OSS 发布与更新。
- [`plugin-artifact-schema.md`](./plugin-artifact-schema.md) — Plugin/Artifact 兼容契约。
- [`runtime-version-baseline.md`](./runtime-version-baseline.md) — R/Python 运行时精确版本契约（双端一致，约束所有插件 ABI 与 builtAgainst）。
- [`third-party-plugin-guide.md`](./third-party-plugin-guide.md) — 第三方插件结构、环境、验收与发布规范。
- [`harness-engine-spec.md`](./harness-engine-spec.md) — 已完成 Harness 基础技术规范，Stage 3 继续复用。
- [`harness-roadmap.md`](./harness-roadmap.md) — Harness Phase 1–6 完成记录与 Stage 3 技术参考。
- 已完成的 Harness Phase 7、Scientific Task Contract 与 Loop 工程计划保留在注册表中，只在回归对应契约或追溯验收时读取。
- [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md) — 当前稳定版本收口台账、出口矩阵与实机证据。
- [`releases/v0.0.1-rc.6.md`](./releases/v0.0.1-rc.6.md) — Stage 4 macOS 候选版发布说明与已知边界。
- [`releases/v0.0.1-rc.7.md`](./releases/v0.0.1-rc.7.md) — Phase 7、模型 UX 与 ToolResult 实机收口发布版。
- [`harness-tool-template.md`](./harness-tool-template.md) — Harness 工具模板。
- [`first-success-path.md`](./first-success-path.md) — demo/golden-path 回归说明，不是当前产品路线图。
- [`project-wide-audit-2026-07.md`](./project-wide-audit-2026-07.md) - 2026-07-27 六维度横切审计（科学正确性/安全/用户旅程/后端/前端/治理）的范围依据；`qualificationEligible:false`，不升级任何资格声明，优先级与是否启动独立工作包属用户决定。

## 发布记录

- [`releases/v0.0.1-rc.2.md`](./releases/v0.0.1-rc.2.md) — OSS 迁移前历史发布记录。
- `rc.3`、`rc.4` 发布状态与 `rc.5`/`rc.6` 检查点集中记录在 handoff、next steps 与 OSS 更新说明中。

## 历史归档

[`archive/`](./archive/README.md) 只保存已完成或已失效的阶段审计、验证报告和旧发布计划。除非追溯问题来源，否则 Agent 不应读取归档来决定当前工作。

## 维护规则

- 创建计划、阶段收口、Handoff、归档或 Worktree 操作时使用 `$biof3-project-governance`。
- 默认启动上下文只使用“当前开发必读”四项；不要扫描全部 `docs/` 或 `acceptance/` 猜测当前状态。
- 新建非归档 Markdown 必须同步登记 `DOC-REGISTRY.json` 并通过 `npm run docs:check`。
- 工作包完成前运行 `npm run docs:reconcile`，逐项判断保留、替代或归档，不自动批量搬迁。
- 当前状态只写 handoff/next steps，不继续向其中追加长篇历史。
- 阶段顺序只写 v1 roadmap。
- UI 问题只写 UI audit。
- 历史证据完成后移入 archive；纯重复临时提示直接删除。
- 新文档必须从本入口或专项规范中至少有一个明确入口，避免孤立文档。
