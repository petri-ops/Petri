# 设计评审报告 — Petri Desktop（2026-09-03）

> 性质：只读设计层评审留痕（无代码改动），与 AUDIT-51 四域代码审计（2026-09-03）互补——彼为缺陷狩猎，此为架构评估。
> 状态：`reference`（评审结论 + 候选建议，待用户裁决转化为工作包）
> truthDomain: `design-review-2026-09`

## 0. 评审方法声明

- **看什么**：代码结构 × 架构演进史（Git/block 台账）× 跨案例模式识别；不跑运行时、不做负载测试。

- **证据纪律**：每条结论绑定本评审当期核实的文件:行号或台账条目；历史案例引证注明出处。无法核实的判断标注为「观察」而非「结论」。

- **边界**：G0 开发期常态 · 不外推 packaged/Provider/GA；不违反单工作包串行与既有治理裁决（zustand 禁令等）。

## 1. 类型契约：IPC 边界没有单一事实源 — 🔴 设计级硬伤

**同类缺陷复发 ≥3 次（跨约 2 年）**：

| 时间         | 案例                                                                                                                                                                                                 | 出处                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 2026-08    | main.js poller 9 状态 vs `electron.d.ts` 声明 4 状态（C1）                                                                                                                                                 | BLOCK-2 PHASE 6 审计（`agent-transcripts/phase-6-code-audit.md`） |
| 2026-08    | accessModeValidator tool-name 漂移（前端 `fs_write`/`Shell` vs 后端 registry `workspace_write`）                                                                                                           | BLOCK-20 wire-up（commit `0c13d72`）                            |
| 2026-09-03 | BLOCK-50 现场：`electron.d.ts` 补 `deleted/missing`，但 CodeMirrorDiffView 本地 `FileContentResult`（`frontend/src/components/desktop/WorkingTreeReview/CodeMirrorDiffView.tsx` L34-39）独立声明窄类型漏同步 → tsc 2 错 | BLOCK-50 WIP 实测                                               |

**问题本质**：IPC 边界存在双层手工类型声明（通道层 `electron.d.ts` + 消费层本地 interface），一致性靠人肉维护，无机制兜底。

**建议（候选工作包核心）**：契约单一事实源——共享 schema（zod 或 JSON Schema）同时生成 `.d.ts` 与后端运行时校验，门禁 drift fail-closed。一次建设，消灭一整类复发。

## 2. 前端状态：手搓 store 集群 — 🟠

**证据**：zustand 治理禁令之后，长出模块级单例 store 集群：`conversationRunStore.ts` / `conversationChangesStore.ts` / `conversationDraft.ts`（均在 `frontend/src/components/copilot/`），各自手写 subscribe/notify/snapshot，生命周期独立管理。

**问题本质**：禁令生效但没有提供替代范式 → N 套平行实现，每写一个新 store 重新发明轮子；订阅泄漏与内存增长风险分散在各处各查各的。

**建议**：不引 zustand（尊重治理裁决），把现有 store 收敛为一个共享内核（\~50 行，`useSyncExternalStore` + 统一 subscribe/notify/getSnapshot），一次规范全部存量。

## 3. 巨型组件：SimpleChat 拆分实质未完成 — 🟠

**证据**：BLOCK-9.2 拆分结果对比：

| 组件                   | 拆分前 → 后     | 幅度         |
| -------------------- | ----------- | ---------- |
| DesktopSettingsPanel | 1515 → 870  | **-42.6%** |
| SimpleChat           | 2115 → 1965 | **-7%**    |

差别：SettingsPanel 拆的是**组件**，SimpleChat 拆的是 **hooks 与类型**（`useChatStream` 等）；1970 行大头是 JSX 渲染树（消息列表/审批表单/斜杠命令/工具活动/模型菜单/附件同组件）。

**建议**：下次触碰 SimpleChat 时按功能切片拆组件（MessageList / Composer / ApprovalInline / ToolActivityPanel 平级化），hooks 路线已到收益递减区。

## 4. 渲染管线：交互「僵硬」的设计根因 — 🟠

（与 codex TUI 对比调研结论一致，属设计问题而非 bug）

- 每个 stream token → `setMessages([...])` → 整棵消息树重建；markdown 现算，无渲染缓存。

- 长会话 O(n) 重渲染，消息列表无虚拟化 → 会话越长越卡。

**建议**：消息组件按 id+content hash memo 化 + markdown 增量渲染（newline-gated，参考 codex `markdown_render_cache` 模式）+ 列表虚拟化。

## 5. 测试架构：层级错位 — 🟠（AUDIT-51 M1 的推广）

**证据**：M1（isPrimary 从未传入）——`test/agent-concurrency.test.mjs` L105-130 直接调 runtime 层且自传 `{isPrimary:true}`，路由层真实调用形状（`routes/ai-agent/chat.js` L229 / `resume.js` L218）从未被测。

**问题本质**：测试金字塔缺中间层——**路由/IPC 入口的契约测试**（真实参数形状打 handler）系统性缺失，类型漂移/调用形状漂移类 bug 免疫于现有 238 个测试文件。

**建议**：立工程规则——每个新 runtime 模块必须有穿透公共入口（route/IPC handler 签名）的测试；存量按风险补 TOP 10。

## 6. 产品重心漂移（战略观察，非缺陷）— 🟡

**观察**：BLOCK-20 → BLOCK-50 约 30 个工作包集中于 git 审阅 / agent 工作台；同期 Result Studio 维持 `implemented_unverified / experimental`、P7 deferred。基础设施成熟度已超过核心业务面。

**含义**：不违反 G0 纪律、不重启资格认证；仅提示——裁决 BLOCK-48（电脑控制）/BLOCK-49（多 agent）优先级时，值得把「这仍是组学学习平台」作为变量纳入权衡。

## 7. 设计上做对的（不动）— ✅

- **BLOCK-30 单后端收敛**（3 后端 → 1）：拓扑大幅简化，正确决策。

- **主进程禁直连 better-sqlite3**（BLOCK-32 ABI 教训被迫形成）：变相强制了干净的进程边界。

- **治理系统本身**（DOC-REGISTRY / 证据绑定 / AUDIT-LOG）是项目护城河。可提效项：小修（<20 行单文件）走轻量通道，目前小修治理成本 ≈ 代码成本。

## 8. 候选工作包建议（优先级排序，待用户裁决）

| # | 候选               | 性质 | 权杆          | 建议形态                                            |
| - | ---------------- | -- | ----------- | ----------------------------------------------- |
| 1 | IPC 契约单一事实源      | 基建 | 消灭一整类复发 bug | BLOCK-52 候选：schema → .d.ts 生成 + 后端校验 + drift 门禁 |
| 2 | 路由层契约测试规则        | 纪律 | 堵 M1 类盲区    | 并入 BLOCK-51（审计修复包）：M1 修复时立规则 + TOP 10 存量补测      |
| 3 | 渲染管线 memo + 虚拟化  | 体验 | 「僵硬」根治      | 独立工作包（与 BLOCK-48/49 竞争排期）                       |
| 4 | store 内核收敛       | 债务 | 中           | 小型工作包                                           |
| 5 | SimpleChat 组件化拆分 | 债务 | 中           | 绑定到下次触碰 SimpleChat 的工作包内做                       |

**当前候选队列全景**：BLOCK-51（审计修复，含 M1）/ 本报告 #1-#5 / BLOCK-48（电脑控制）/ BLOCK-49（多 agent）——全部等 BLOCK-50 收口后由用户按序裁决。

## 9. 证据清单（本评审直接核实）

- `frontend/src/components/desktop/WorkingTreeReview/CodeMirrorDiffView.tsx` L34-39（本地窄类型）、L104-109（消费 deleted/missing）

- `frontend/src/lib/electron.d.ts` L370-377（通道层类型）

- `src/ipc/working-tree-review.js` L357-371（BLOCK-50 后端兜底）

- `core/petri-server/helpers/runtime.js` L57-77（isPrimary 设计意图）

- `routes/ai-agent/chat.js` L229 / `routes/ai-agent/resume.js` L218（缺参调用点）

- `test/agent-concurrency.test.mjs` L105-130（测试层级错位）

- `frontend/src/components/copilot/SimpleChat.tsx`（1970 行）、`conversationRunStore.ts` L249-314、`conversationChangesStore.ts` L43-73

- BLOCK-9.2 台账（`docs/block-9-2-mega-file-refactor-plan.md`）拆分幅度对照

