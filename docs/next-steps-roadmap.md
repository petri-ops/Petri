# BioF3 Desktop — Current Next Steps

最后更新：2026-07-19

## 当前结论

`v0.0.1-rc.5` 仍是当前代码版本，尚不是首个稳定产品版本；最新 OSS 安装发布仍为 `rc.4`。Stage 1、Stage 2、Stage 3 已依序完成出口验收，当前阶段边界为：

> **Stage 1 UI 产品化 → Stage 2 模型层 → Stage 3 Harness 与标准流程 → Stage 4 首个稳定产品版本**

详细阶段范围和验收出口见 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)。若其他文档与该顺序冲突，以 v1 路线图为准。

## 当前唯一后续阶段

Stage 4：首个稳定产品版本收口（已于 2026-07-19 启动）。

Stage 3 已于 2026-07-19 关闭：GO/KEGG、GSEA、WGCNA 三条标准流程、DeepSeek + Anthropic 评测、第三方插件指南，以及 `r-enrichment` / `r-wgcna` 发布后的自动下载、校验、解压、挂载真链均通过。下一步不再扩充分析内容，而是按 Stage 4 做功能冻结、全新用户目录、打包安装、升级与发布验收。

Stage 4 第一批已完成 migration / `better-sqlite3` 双 ABI 阻断修复：根项目全量测试已实现 0 fail，全新临时数据目录的开发态和 arm64 打包态启动均通过。完整矩阵见 [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md)。

## 已完成基线

- 当前代码检查点：`v0.0.1-rc.5`；最新 OSS 发布仍为 `v0.0.1-rc.4`（发布提交 `08a0bbb`）。
- macOS arm64/x64 DMG、SHA-256 和 `latest-mac.yml` 已发布到阿里云 OSS。
- GitHub 只保存源码与不可变标签，不保存桌面软件资产。
- `rc.3 → rc.4` 已完成真实检查、下载、大小/SHA-512 校验和 DMG 打开验收。
- 正式 `/Applications/BioF3.app` 为 `0.0.1-rc.4`，R/Python/SPA 健康检查通过。
- Clash Verge 使用规则模式：OpenAI/Codex/GitHub 代理，阿里云 OSS 直连。
- Harness Phase 1–6、Plugin SDK、Agent workflow runtime、恢复与 fixture 门禁已建立，Stage 1–2 期间保持可回归。
- Stage 1 UI 台账 30/30 verified；前端 146 tests 全通过，桌面明暗主题、设置分类、回收站、结果区和动态端口回退完成实机验收。
- Stage 2 模型主干已完成：版本化 ModelProfile、统一 Gateway、全业务入口迁移、OpenAI-compatible/Ollama/LM Studio/vLLM、Anthropic 原生协议、DashScope vision/embedding、角色能力路由和默认关闭的显式 fallback。
- `api-failover-proxy` 只作为 MIT 协议转换与流聚合来源融合；未引入其 Express、SQLite pool、Admin、Docker 或默认自动切换架构。
- API Key 已退出 `ai-settings.json` 与设置读取 IPC；macOS 使用 Keychain，其他平台使用独立 0600 凭据文件。模型管理中心已完成开发壳实机渲染，UI-031 在打包态验收前保持 `in_progress`。
- 当前门禁：前端 19 files / 147 tests；SPA 568 modules；Node 302 tests / 285 pass / 6 个已知基线失败（5 个 qa-smoke + 当前 Node/Electron ABI 迁移项，迁移项在 Electron ABI 下通过）。
- 本地 arm64 打包已通过并生成约 183 MB 的 rc.5 DMG；包内 R/Python/SPA、模型页、凭据页和无明文 Key 的设置 API 已验证。未执行 OSS 上传、签名或公证。
- **架构去耦已完成（2026-07）**：核心后端从 `vendor/biof3-core` submodule 内联为仓库内 `core/`（完全独立）；移除 OSS 存储、PostgreSQL、docker 执行三条 web/ECS 双模式分支，现为「本地文件存储 + SQLite + 内嵌运行时本地执行」单一路径。详见 [`dependency-decoupling-checkpoint.md`](./dependency-decoupling-checkpoint.md)（含下阶段清理建议）。

## 后续阶段摘要

### Stage 2：模型层

- MODEL-1 至 MODEL-5 代码主干已完成。
- 当前只补真实 Provider 矩阵、打包态模型管理 UI 和版本候选验收证据。

### Stage 3：Harness 与标准流程

- ✅ 2026-07-19 已完成并关闭；完整证据见 [`stage3-standard-workflows-design.md`](./stage3-standard-workflows-design.md)。

### Stage 4：稳定产品版本

- 🟡 进行中：功能冻结；下一批是真实 runtime 首用、`rc.4` 数据迁移、x64 和 OSS 更新/覆盖安装验证。
- 用户确认达到“第一个相对稳定产品版本”标准后，再决定最终版本号。

## 固定工程不变量

> `run_tool → tool_job → artifact truth`

- UI 只消费现有状态真相。
- 模型层不得绕过确认、安全和审计边界。
- 新分析能力通过 Plugin SDK、fixture 与现有 Harness 接入。
- macOS 发布使用本机构建 + OSS；无 Developer ID 签名/公证时由应用打开 DMG、成员手动覆盖安装。

## 当前入口

1. [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)：唯一阶段路线图。
2. [`ui-productization-audit.md`](./ui-productization-audit.md)：当前执行台账。
3. [`project-workspace-handoff.md`](./project-workspace-handoff.md)：当前恢复检查点。
4. [`development-module-map.md`](./development-module-map.md)：模块责任边界。
5. [`codex-style-workbench-direction.md`](./codex-style-workbench-direction.md)：UI 产品方向。
6. [`macos-oss-auto-update.md`](./macos-oss-auto-update.md)：当前发布/更新操作规范。
7. [`dependency-decoupling-checkpoint.md`](./dependency-decoupling-checkpoint.md)：去 vendor 化 + web 冗余清理检查点与下阶段清理建议。
8. [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md)：当前稳定版本出口矩阵与实机证据。
