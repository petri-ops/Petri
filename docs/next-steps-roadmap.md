# BioF3 Desktop — Current Next Steps

最后更新：2026-07-17

## 当前结论

`v0.0.1-rc.5` 已固定为 Stage 1 UI 产品化代码检查点，但还不是首个稳定产品版本；最新 OSS 安装发布仍为 `rc.4`。当前开发严格遵循：

> **Stage 1 UI 产品化 → Stage 2 模型层 → Stage 3 Harness 与标准流程 → Stage 4 首个稳定产品版本**

详细阶段范围和验收出口见 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)。若其他文档与该顺序冲突，以 v1 路线图为准。

## 当前唯一实现阶段

Stage 2：模型层与多 Provider。

当前只执行 `MODEL-1 Provider 调用收口`：

1. 盘点聊天、Agent、摘要、记忆、报告、解释、embedding/vision 的真实调用入口。
2. 定义 `ModelProfile` 与统一 Gateway contract。
3. 先迁移现有 DeepSeek/DashScope 路径，不批量增加 Provider。
4. 保持 conversation、确认、`tool_job` 与 artifact truth 契约不变，并补 contract 测试。

Stage 2 验收前不扩充 Harness 内容。阻断性回归仍可随时修复。

## 已完成基线

- 当前代码检查点：`v0.0.1-rc.5`；最新 OSS 发布仍为 `v0.0.1-rc.4`（发布提交 `08a0bbb`）。
- macOS arm64/x64 DMG、SHA-256 和 `latest-mac.yml` 已发布到阿里云 OSS。
- GitHub 只保存源码与不可变标签，不保存桌面软件资产。
- `rc.3 → rc.4` 已完成真实检查、下载、大小/SHA-512 校验和 DMG 打开验收。
- 正式 `/Applications/BioF3.app` 为 `0.0.1-rc.4`，R/Python/SPA 健康检查通过。
- Clash Verge 使用规则模式：OpenAI/Codex/GitHub 代理，阿里云 OSS 直连。
- Harness Phase 1–6、Plugin SDK、Agent workflow runtime、恢复与 fixture 门禁已建立，Stage 1–2 期间保持可回归。
- Stage 1 UI 台账 30/30 verified；前端 146 tests 全通过，桌面明暗主题、设置分类、回收站、结果区和动态端口回退完成实机验收。
- **架构去耦已完成（2026-07）**：核心后端从 `vendor/biof3-core` submodule 内联为仓库内 `core/`（完全独立）；移除 OSS 存储、PostgreSQL、docker 执行三条 web/ECS 双模式分支，现为「本地文件存储 + SQLite + 内嵌运行时本地执行」单一路径。详见 [`dependency-decoupling-checkpoint.md`](./dependency-decoupling-checkpoint.md)（含下阶段清理建议）。

## 后续阶段摘要

### Stage 2：模型层

- 建立 `P-07 Model Gateway`。
- 清理 DeepSeek 硬编码。
- 支持 DeepSeek、OpenAI-compatible、本地 Ollama/LM Studio/vLLM，随后接 Anthropic 原生协议。
- 分离凭据、能力声明、角色路由、健康检查与用量记录。

### Stage 3：Harness 与标准流程

- 先 GO/KEGG，再 GSEA、WGCNA。
- 使用不同 Provider 做意图、选型、修参、tool calling、恢复和结果解释评测。
- 不创建第二套执行器、job 数据库、workflow 状态库或结果系统。

### Stage 4：稳定产品版本

- 功能冻结、全新用户目录验收、真实流程、模型切换、数据迁移和旧版更新验证。
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
