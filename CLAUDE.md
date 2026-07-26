# BioF3 Desktop — Claude Code 兼容入口

本文件只负责把 Claude Code 路由到与其他 Agent 相同的项目事实，不能另立阶段、测试或架构规则。

## 唯一工程指令

1. 完整遵守 [`AGENTS.md`](./AGENTS.md)。
2. 会话开始先读 [`docs/AUDIT-LOG.md`](./docs/AUDIT-LOG.md)，只处理其中活跃广播。
3. 恢复当前状态只读：
   - [`docs/next-steps-roadmap.md`](./docs/next-steps-roadmap.md)
   - [`docs/project-workspace-handoff.md`](./docs/project-workspace-handoff.md)
   - 当前工作包 [`docs/g0-result-studio-plan.md`](./docs/g0-result-studio-plan.md)
4. `docs/archive/` 与 Acceptance 只用于追溯或所属验收，不用于判断当前阶段。

## 当前事实

- 当前唯一 active 工作包：`G0-RS`。
- 当前阶段：`G0-RS-RH0 Repository Hygiene Gate`；完成后才允许 P4R。
- 开发分支：`codex/g0-result-studio-product`，主工作区串行开发，不使用 Worktree。
- 唯一执行事实链：`run_tool → tool_job → artifact truth`。
- 架构：Electron + React/Vite + 本地 Node/R/Python + SQLite；`core/` 已内联。

## 验证纪律

- 日常只运行与改动相关的定向测试和当前阶段专项门禁。
- 文档/UI 增量运行 `npm run docs:check` 与 `npm run ui:audit:check`。
- 不默认运行 `npm test` 或 `npm run check`；全量只用于资格、发布或阶段最终稳定源树。
- 未运行的范围必须如实报告，不能把定向通过描述成全量通过。

旧 Stage 2 指令与历史测试基线已归档到 [`docs/archive/checkpoints/claude-instructions-through-stage2.md`](./docs/archive/checkpoints/claude-instructions-through-stage2.md)，不得继续执行。
