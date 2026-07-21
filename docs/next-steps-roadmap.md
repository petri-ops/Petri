# BioF3 Desktop — Current Next Steps

最后更新：2026-07-21

## 当前结论

`v0.0.1-rc.7` 是当前 OSS 线上版本，已完成代码、自动化、双架构构建、安装候选启动验收和公开更新链核验。Stage 1 UI 产品化、Stage 2 模型层、Stage 3 Harness 与标准流程、Stage 4 首个稳定产品版本及 Harness Phase 7 均已关闭。

当前没有默认进入实施的新工作包。下一步只观察 rc.7 的真实使用反馈和缺陷，不默认扩展功能。UI-032 已完成；签名/公证不属于本项目必需条件；OSS 上有包只代表技术分发链已打通，不代表产品已经正式上线。rc.7 仍是工程候选版，不得描述为 GA。

详细阶段范围见 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)，Phase 7 完成证据见 [`harness-phase7-completion-plan.md`](./harness-phase7-completion-plan.md)。

## Harness Phase 7 完成状态

Phase 7 已补齐 7 个项目级文件/短命令工具、统一工具注册表与 policy/interceptor、结构化 ToolResult 与脱敏 Trace、受控编辑、模型上下文压缩和 Provider 调用边界。

出口证据：

- P7-A live Provider：DeepSeek `deepseek-chat` 与自定义 OpenAI-compatible `gpt-5.6-sol` 使用同一 8 场景矩阵，均 8/8 PASS；证据位于 `acceptance/harness-phase7/provider-baseline.{json,md}`，仅用于人工验收，不进入 CI。
- P7-H 离线聚合门禁：`CI=1 TERM=dumb npm run harness:phase7` 实测 manifests 7/7、Phase 6 tests 64/64、Phase 7 核心 tests 68/68、产品检查 13/13，全部 0 fail。
- 产品检查使用临时真实 workspace，经生产 interceptor / policy / preflight / handler 全链，不访问 Provider、凭据、用户数据库或科学分析 Job；脱敏证据位于 `acceptance/harness-phase7/product-acceptance.{json,md}`。
- P7-F 后台任务控制面继续 `deferred`：符合门槛的真实 `>30s` 非科学任务为 0/3，未新增 process start/check/stop。
- UI-034 已完成独立实机视觉矩阵并标记 `verified`；UI-033 同轮完成供应商/模型选择器与真实身份抽查。

固定不变量保持不变：

> `run_tool → tool_job → artifact truth`

Phase 7 未建立第二套 analysis executor、job、artifact 或 workflow truth。

## 已完成基线

- 当前代码、标签与 OSS 线上版本：`v0.0.1-rc.7`（发布提交 `ab519fa`）。
- macOS arm64/x64 DMG、SHA-256 和 `latest-mac.yml` 已发布到阿里云 OSS；GitHub 只保存源码与不可变标签。
- Stage 1 UI 台账 30/30 verified；Stage 2 的 UI-031 已完成打包态验收并标记 `verified`。
- Stage 3 的 GO/KEGG、GSEA、WGCNA、双 Provider 评测、插件指南与 capability bundle 真链已完成。
- Stage 4 已完成 migration/SQLite ABI、真实 Runtime 首装、DESeq2 与 GO/KEGG 首次成功、数据升级、诊断隐私和 arm64 RC 发布反向验证。x64 因没有分析 Runtime 仍只声明壳层预览。
- 核心后端已内联为仓库内 `core/`；当前为本地文件存储 + SQLite + 内嵌运行时本地执行，不再使用 vendor submodule、PostgreSQL 或 docker 双模式。
- API Key 不进入普通设置或读取 IPC；macOS 使用 Keychain，其他平台使用独立 0600 凭据文件。

## 后续决策入口

以下是需要真实反馈或单独授权后才能开启的候选方向，不是当前实施任务：

1. rc.7 使用反馈与缺陷修复。
2. x64 分析 Runtime。
3. 新产品阶段；若重开 P7-F，必须先有至少 3 个合格真实任务的可复现证据。

禁止借后续收尾扩大命令权限、增加任意网络工具、批量增加分析流程，或绕过现有确认、安全、审计与 artifact truth 边界。

## 当前入口

1. [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)：产品阶段路线图。
2. [`harness-phase7-completion-plan.md`](./harness-phase7-completion-plan.md)：Phase 7 完成证据与边界。
3. [`project-workspace-handoff.md`](./project-workspace-handoff.md)：当前恢复检查点。
4. [`ui-productization-audit.md`](./ui-productization-audit.md)：UI 执行台账。
5. [`development-module-map.md`](./development-module-map.md)：模块责任边界。
6. [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md)：稳定版本出口矩阵。
7. [`macos-oss-auto-update.md`](./macos-oss-auto-update.md)：发布与更新规范。
8. [`dependency-decoupling-checkpoint.md`](./dependency-decoupling-checkpoint.md)：架构去耦检查点。
