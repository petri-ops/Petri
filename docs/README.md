# BioF3 Desktop 文档入口

最后更新：2026-07-17

## 当前开发必读

按顺序读取：

1. [`v1-productization-roadmap.md`](./v1-productization-roadmap.md) — 唯一阶段路线图。
2. [`next-steps-roadmap.md`](./next-steps-roadmap.md) — 当前阶段与立即任务摘要。
3. [`project-workspace-handoff.md`](./project-workspace-handoff.md) — 当前可恢复工程检查点。
4. [`ui-productization-audit.md`](./ui-productization-audit.md) — 已完成的 Stage 1 验收台账。
5. [`development-module-map.md`](./development-module-map.md) — W/P/C 责任边界。

## 当前有效专项规范

- [`codex-style-workbench-direction.md`](./codex-style-workbench-direction.md) — UI 产品方向。
- [`macos-oss-auto-update.md`](./macos-oss-auto-update.md) — macOS 构建、OSS 发布与更新。
- [`plugin-artifact-schema.md`](./plugin-artifact-schema.md) — Plugin/Artifact 兼容契约。
- [`harness-engine-spec.md`](./harness-engine-spec.md) — 已完成 Harness 基础技术规范，Stage 3 继续复用。
- [`harness-roadmap.md`](./harness-roadmap.md) — Harness Phase 1–6 完成记录与 Stage 3 技术参考。
- [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md) — 当前稳定版本收口台账、出口矩阵与实机证据。
- [`releases/v0.0.1-rc.6.md`](./releases/v0.0.1-rc.6.md) — Stage 4 macOS 候选版发布说明与已知边界。
- [`harness-tool-template.md`](./harness-tool-template.md) — Harness 工具模板。
- [`first-success-path.md`](./first-success-path.md) — demo/golden-path 回归说明，不是当前产品路线图。

## 发布记录

- [`releases/v0.0.1-rc.2.md`](./releases/v0.0.1-rc.2.md) — OSS 迁移前历史发布记录。
- `rc.3`、`rc.4` 发布状态与 `rc.5`/`rc.6` 检查点集中记录在 handoff、next steps 与 OSS 更新说明中。

## 历史归档

[`archive/`](./archive/README.md) 只保存已完成或已失效的阶段审计、验证报告和旧发布计划。除非追溯问题来源，否则 Agent 不应读取归档来决定当前工作。

## 维护规则

- 当前状态只写 handoff/next steps，不继续向其中追加长篇历史。
- 阶段顺序只写 v1 roadmap。
- UI 问题只写 UI audit。
- 历史证据完成后移入 archive；纯重复临时提示直接删除。
- 新文档必须从本入口或专项规范中至少有一个明确入口，避免孤立文档。
