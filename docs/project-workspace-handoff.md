# BioF3 Desktop Current Handoff

最后更新：2026-07-15

## 1. 恢复顺序

新的 Agent 不应通读历史计划猜测主线。按以下顺序恢复：

1. `git status --short` 与 `git log -5 --oneline --decorate`
2. [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)
3. [`next-steps-roadmap.md`](./next-steps-roadmap.md)
4. [`ui-productization-audit.md`](./ui-productization-audit.md)
5. [`development-module-map.md`](./development-module-map.md)
6. 当前任务涉及的专项规范

历史审计与阶段验收位于 [`archive/`](./archive/README.md)，只用于追溯，不决定当前顺序。

## 2. 当前产品阶段

`v0.0.1-rc.4` 是可安装、可启动、可从 OSS 检查更新的技术基线，不是首个稳定产品版本。

当前固定顺序：

> **Stage 1 UI 产品化 → Stage 2 模型层 → Stage 3 Harness 与标准流程 → Stage 4 首个稳定产品版本**

当前唯一实现工作是 Stage 1 `UI-1 实机审计与问题台账`。Stage 1 验收前不实现新模型 Provider；Stage 2 验收前不扩充 Harness 内容。阻断性回归不受该限制。

## 3. 当前立即任务

按 [`ui-productization-audit.md`](./ui-productization-audit.md) 执行：

1. 正式 `/Applications/BioF3.app` 与 `npm run dev` 开发版逐屏截图。
2. 覆盖首页、项目工作台、Agent、结果、浏览器、文件、终端、设置、插件和专业页面壳层。
3. 每个问题标注截图、复现步骤、主 W/P 模块、C 关注点、P0/P1/P2 和预期结果。
4. 先向用户同步问题台账和建议批次，再开始修改。
5. 第一批优先全局 token、桌面壳、顶栏、三栏容器、折叠和拖拽手感。

UI 形态遵守 [`codex-style-workbench-direction.md`](./codex-style-workbench-direction.md)：左侧项目与资源、中间 Agent 主舞台、右侧结果与工具；学习 Codex 的交互原则，不做像素级复制。

## 4. 发布与安装状态

主模块：`P-06 桌面集成与交付`。

- 当前版本：`0.0.1-rc.4`，标签 `v0.0.1-rc.4`，发布提交 `08a0bbb`。
- 默认平台：macOS-only；构建 arm64/x64。
- GitHub：只保存源码和不可变标签，不上传 DMG。
- OSS：保存双架构 DMG、SHA-256 清单和 `latest-mac.yml`。
- 更新方式：检查 OSS → 下载匹配架构 DMG → 大小/SHA-512 校验 → 打开 DMG → 成员手动拖入 Applications。
- 当前没有 Apple Developer ID 签名和公证，不承诺静默覆盖安装。
- `rc.3 → rc.4` 已完成真实旧版检查、下载、校验、DMG 打开和包内版本确认。
- 正式 `rc.4` 已恢复运行，R `:3001/api/health`、Python `:3004/api/health`、SPA `:3002` 验证通过。
- 发布端凭据只存在本地 `.biof3-secrets`，权限 `600`，禁止输出或提交。
- Clash Verge 使用规则模式：OpenAI/Codex/GitHub 代理，`aliyuncs.com`/`aliyun.com`/`alicdn.com` 直连。

详细操作见 [`macos-oss-auto-update.md`](./macos-oss-auto-update.md)。

## 5. 已建立的平台能力

### P-02 执行真相

唯一正式执行事实链：

> `run_tool → tool_job → artifact truth`

已有 job 状态、参数、日志、manifest、磁盘校验、valid/degraded/blocked、diagnostics、failureModes 和 lineage。不得建立第二套执行器、job 表或结果真相系统。

### P-03 Harness 与 Agent Workflow

Harness Phase 1–6 已建立：

- `inspect → infer → select → repair → confirm → run → verify → report`
- 参数 repair/readiness、工具选择、确认、恢复和二跳 artifact 绑定
- workflow 状态投影自现有 tool job/artifact truth
- Plugin SDK、built-in/installed/development 三来源与 fixture 门禁
- local/container/remote 共用 canonical execution context，差异留在 adapter

Stage 1–2 只保持回归；GO/KEGG、GSEA、WGCNA 延后到 Stage 3。技术参考见 [`harness-engine-spec.md`](./harness-engine-spec.md) 和 [`harness-roadmap.md`](./harness-roadmap.md)。

### P-07 模型层现状

- 当前聊天主链主要使用 DeepSeek。
- DashScope 已用于 embedding/vision。
- Core 已有 Provider 接口，但统一 Gateway 尚未完成。
- OpenAI/Ollama 当前设置入口仍是未来支持。
- 聊天摘要、记忆、报告和部分 Agent 路径仍存在 DeepSeek Endpoint、模型名或 Key 读取硬编码。
- API Key 当前仍存于本地 AI 设置文件；Stage 2 需要改成 credential reference，macOS 优先 Keychain。

Stage 2 目标以 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md) 为准，不应在 UI Stage 1 提前实现。

## 6. UI 已建立结构与边界

- 项目制 Dashboard 与 `/project/:projectId` 工作台。
- 左/中/右三栏、折叠与拖拽。
- 项目级 conversation、Agent 输入和流式消息。
- 参数确认、工具调用、运行/失败/恢复状态。
- 聊天结果卡片与右侧 Artifact 联动。
- 图片、CSV/TSV、HTML、日志、JSON 和下载入口。
- 浏览器、文件、终端与设置/插件容器。

Stage 1 是逐屏产品化，不是推翻上述结构。结果预览继续采用现有受控 iframe/WebView 分工；不要因为拖拽跳版重新发明结果系统。

## 7. 验证门禁

按风险选择并记录：

```bash
npm --prefix frontend run check
npm test --prefix frontend
npm --prefix frontend run build
npm run check
npm test
npm run harness:phase6
npm run harness:agent-evaluate
```

UI 任务必须补实机截图/交互证据；Electron 壳、IPC、runtime、更新和打包资源改动必须补打包态验证。涉及 Core 时同时提交 Core、同步 submodule 指针与 `.vendor-lock`。

## 8. 禁止误读

- 不把 `docs/archive/` 中的历史 P0、旧分支、旧 CI 或旧阶段编号当成当前任务。
- 不把旧 Windows/Linux 发布计划恢复为当前门禁；除非用户重新明确要求。
- 不在 Stage 1 扩充模型 Provider 或 Harness 内容。
- 不在 Stage 2 批量增加分析流程。
- 不用前端回退代替后端 artifact truth。
- 不覆盖用户未提交改动，不随手 reset 子模块或工作树。

## 9. 当前关键文件

UI Stage 1：

- `frontend/src/App.tsx`
- `frontend/src/components/desktop/`
- `frontend/src/components/workspace-panels/`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/_desktop-dashboard.tsx`
- `frontend/src/themes/`
- `frontend/src/styles/global.css`

阶段与规范：

- `docs/v1-productization-roadmap.md`
- `docs/ui-productization-audit.md`
- `docs/development-module-map.md`
- `docs/codex-style-workbench-direction.md`
- `.claude/ui-refactor-plan.md`
