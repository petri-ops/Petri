# BioF3 Desktop 文档入口

最后更新：2026-08-03

## 项目治理入口

1. [`document-governance.md`](./document-governance.md) — 计划、Goal、Handoff、证据、状态与归档的生命周期规范。
2. [`worktree-governance.md`](./worktree-governance.md) — Worktree 启动门、所有权、环境隔离、合并与清理纪律。
3. [`DOC-REGISTRY.json`](./DOC-REGISTRY.json) — 非归档 Markdown 的机器可读目录与 canonical truth 注册表。
4. [`AUDIT-LOG.md`](./AUDIT-LOG.md) — 每次 Agent 会话优先处理的审计广播台。

## 长期核心指引

1. [`scientific-intelligence-os-vision.md`](./scientific-intelligence-os-vision.md) — BioF3 长期产品愿景、当前定位、阶段跃迁条件与禁止跨阶段建设规则。它约束方向，但不替代当前工作包。
2. [`g0-living-foundation-plan.md`](./g0-living-foundation-plan.md) — 当前永久 G0 可信基础层主线；LF12 原始核心资格保持 maintained，Result Studio 产品支持声明暂停，P7 deferred。
3. [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md) — 已完成的 G0 Baseline v1 资格认证、证据边界与永久维护契约。
4. [`g0-scientific-data-contract-plan.md`](./g0-scientific-data-contract-plan.md) — SDC-0 已完成；SDC-1 Data Profiler 是下一候选但尚未建立 Goal，SDC-2～SDC-7 deferred。
5. [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) — UX1A～UX1D 结果体验短闭环已完成；P4R-0～P6 已按非资格边界收口，发布级 P7 deferred。
6. [`g0-critical-crosscut-hardening-plan.md`](./g0-critical-crosscut-hardening-plan.md) — 已重新真实收口的横切修复工作包；保留科学、进程、HTTP 与逐契约 Acceptance 证据。
7. [`g0-rs0-result-studio-audit.md`](./g0-rs0-result-studio-audit.md) — G0-RS0 现状审计与架构 ADR；Result Studio 的复用/新增边界、契约缺陷与 Git 风险矩阵的唯一裁决记录。

## 当前开发必读

默认只按顺序读取四项：

1. [`AUDIT-LOG.md`](./AUDIT-LOG.md) — 活跃阻塞、待合并和当前进行中阶段。
2. [`next-steps-roadmap.md`](./next-steps-roadmap.md) — 当前立即任务。
3. [`project-workspace-handoff.md`](./project-workspace-handoff.md) — 当前可恢复 Git/工程检查点。
4. 当前没有 active 实现工作包；下一项按用户即时反馈建立可快速收口的小目标。

只有任务实际涉及阶段顺序、UI 或模块边界时，才读取 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)、[`ui-productization-audit.md`](./ui-productization-audit.md) 或 [`development-module-map.md`](./development-module-map.md)。其他 G0 资格、插件、发布和历史材料从上方核心指引、下方专项规范或 `DOC-REGISTRY.json` 按需定位；已完成工作包和 Acceptance 不属于默认启动上下文。

## 当前有效专项规范

- [`codex-style-workbench-direction.md`](./codex-style-workbench-direction.md) — UI 产品方向。
- [`macos-oss-auto-update.md`](./macos-oss-auto-update.md) — macOS 构建、OSS 发布与更新。
- [`plugin-artifact-schema.md`](./plugin-artifact-schema.md) — Plugin/Artifact 兼容契约。
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
