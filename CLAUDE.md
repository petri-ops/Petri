@AGENTS.md

# BioF3 Desktop — Claude Code 兼容入口

本文件不是第二份项目规范，只负责把 Claude Code 路由到与 Codex 和其他 Agent 相同的项目事实。不得在这里复制当前阶段、分支、门禁数量或工作包进度。

## 启动顺序

1. 上方 `@AGENTS.md` 会在 Claude Code 启动时自动导入唯一工程指令；完整遵守其内容。`AGENTS.md` 当前阶段纪律段（"G0 长期开发期"）是最高优先级约束，所有 Agent 必须遵守。
2. 会话开始先读 [`docs/AUDIT-LOG.md`](./docs/AUDIT-LOG.md)，优先处理活跃的红色阻塞与绿色待合并项。
3. 核对 Git 状态、最近提交和实际证据，再从以下 canonical 入口恢复当前状态：
 - [`docs/README.md`](./docs/README.md)
 - [`docs/next-steps-roadmap.md`](./docs/next-steps-roadmap.md)
 - [`docs/project-workspace-handoff.md`](./docs/project-workspace-handoff.md)
 - [`docs/DOC-REGISTRY.json`](./docs/DOC-REGISTRY.json) 登记的当前唯一 active 工作包
4. 创建或修改计划、选择验收范围、阶段收口、归档或处理 Worktree 时，使用 `$biof3-project-governance`。Claude Code 通过 [`.claude/skills/biof3-project-governance`](./.claude/skills/biof3-project-governance) 发现它；canonical 实体仍是 [`.agents/skills/biof3-project-governance/SKILL.md`](./.agents/skills/biof3-project-governance/SKILL.md)。

## 一致性边界

- 当前阶段、下一步、资格状态与验收结论只写入各自 canonical 文档；`CLAUDE.md` 不保存这些易漂移事实。
- `.claude/settings.local.json` 的 SessionStart 快照只是恢复辅助，不能替代 Git、运行时、数据库、Artifact Truth、Acceptance Evidence 或 canonical 文档。
- `docs/archive/` 只用于追溯，不决定当前工作顺序；Acceptance 只能证明其契约声明的范围。
- 若本文件与 `AGENTS.md` 或 canonical 文档冲突，以实际证据和 canonical 事实为准，并修复本入口，不得建立 Claude Code 专属规则。

旧 Stage 2 指令与历史测试基线已归档到 [`docs/archive/checkpoints/claude-instructions-through-stage2.md`](./docs/archive/checkpoints/claude-instructions-through-stage2.md)，不得继续执行。
