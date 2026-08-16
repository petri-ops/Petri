# BioF3 Desktop 文档入口

最后更新：2026-08-16（DOC-GOVERNANCE-GATES 工作包收口同步）

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
3. [`g0-living-foundation-plan.md`](./g0-living-foundation-plan.md) — 当前永久 G0 可信基础层主线；LF12 原始核心资格保持 maintained，Result Studio 产品支持声明暂停，P7 deferred。
4. [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md) — 已完成的 G0 Baseline v1 资格认证、证据边界与永久维护契约。
5. [`g0-scientific-data-contract-plan.md`](./g0-scientific-data-contract-plan.md) — SDC-0 / SDC-1-A / SDC-1 / SDC-2 已完成；SDC-3～SDC-7 deferred。
6. [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) — UX1A～UX1G-2 结果体验短闭环已完成；P4R-0～P6 已按非资格边界收口，发布级 P7 deferred。
7. [`g0-critical-crosscut-hardening-plan.md`](./g0-critical-crosscut-hardening-plan.md) — 已重新真实收口的横切修复工作包；保留科学、进程、HTTP 与逐契约 Acceptance 证据。
8. [`g0-rs0-result-studio-audit.md`](./g0-rs0-result-studio-audit.md) — G0-RS0 现状审计与架构 ADR；Result Studio 的复用/新增边界、契约缺陷与 Git 风险矩阵的唯一裁决记录。
9. [`g0-rs-ux1h-async-tool-surface.md`](./g0-rs-ux1h-async-tool-surface.md) — 2026-08-09 已按非资格边界收口的 Async Tool Surface 工作包；UI-126 已于 2026-08-12 经 Windows 开发态 Electron 实机复核升为 `verified`，仍不外推 Provider/packaged 资格。
10. [`agent-concurrency-design.md`](./agent-concurrency-design.md) — 2026-08-11 已完成的 Agent Concurrency 工作包；A-1～A-6 开发态 Electron evidence 精确绑定实现提交 `6adeaa9`。
11. [`g0-ide-mcp-tools-plan.md`](./g0-ide-mcp-tools-plan.md) — 2026-08-14 启动的 IDE MCP 工具集工作包；为 Agent 暴露 `ide_file_*` / `ide_terminal_*` 等 18 个 `ide_*` MCP 工具（分 Phase 1/2/3 推进），仅面向 Agent 通道，不重复既有面向 UI 的 `file:*` IPC。
12. [`agent-workbench-enhancement-plan.md`](./agent-workbench-enhancement-plan.md) — Agent Workbench 增强计划（参考文档，已登记）。
13. [`agent-workbench-p1-a5-verification-2026-08-15.md`](./agent-workbench-p1-a5-verification-2026-08-15.md) — 2026-08-15 已按开发态 Electron 边界完成的 A5 验证与收口报告；UI-AGENTWB-003 / UI-AGENTWB-004 转 `verified`，双 flag（on/off）链 + §X.2 兼容性测试矩阵 5 项 PASS；不外推 packaged / Provider / P7 / GA。
14. [`t-aw-013-packaged-verification-2026-08-15.md`](./t-aw-013-packaged-verification-2026-08-15.md) — 2026-08-15 已按 packaged Electron 边界完成的 T-AW-013 实机核对；6/6 步骤（CDP attach + bridge 同步方法 + 4 renderer + CSV BOM `EF BB BF` 字节级 + Markdown `| --- |` 分隔 + fallback 0 下载按钮）通过；A4 / P2 / P1.5 / UI-AGENTWB-007 证据等级升级为「前端 + dev Electron + packaged Electron 三轴」；4 处契约偏差已在 `ui-productization-audit.md` 行 244 CONTRACT-DRIFT-001 脚注登记；`qualificationEligible` 维持 false（Provider / GA 链路未覆盖）。
15. [`agent-workbench-dev-electron-verification-2026-08-15.md`](./agent-workbench-dev-electron-verification-2026-08-15.md) — 2026-08-15 T-AW-014 dev Electron 边界内 4 工作包二次实机核对收口；UI-AGENTWB-005/006/007 由 `in_progress` 升 `dev Electron 边界内 verified`，UI-AGENTWB-004 由 A5 verified 扩展 dev 实机覆盖；三路径核对 6/6 步骤（CLI flag + Settings toggle + bridge.set off → reload DOM=0）通过；A4 5 路径 + P1.5 CSV/MD BOM 字节级 + P2 chart 8 rect a11y 全 PASS；target-file 7 文件 95/95 测试通过；`qualificationEligible` 维持 false（dev Electron 不外推 Provider / GA）。
## 当前开发必读

默认只按顺序读取三项；若其中声明 active 工作包，再读取对应 canonical 计划：

1. [`AUDIT-LOG.md`](./AUDIT-LOG.md) — 活跃阻塞、待合并和当前进行中阶段。
2. [`next-steps-roadmap.md`](./next-steps-roadmap.md) — 当前立即任务。
3. [`project-workspace-handoff.md`](./project-workspace-handoff.md) — 当前可恢复 Git/工程检查点。
只有任务实际涉及阶段顺序、UI 或模块边界时，才读取 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)、[`ui-productization-audit.md`](./ui-productization-audit.md) 或 [`development-module-map.md`](./development-module-map.md)。其他 G0 资格、插件、发布和历史材料从上方核心指引、下方专项规范或 `DOC-REGISTRY.json` 按需定位；已完成工作包和 Acceptance 不属于默认启动上下文。

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
