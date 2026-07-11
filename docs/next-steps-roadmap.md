# Project Workspace — Next Steps Roadmap

最后更新：2026-07-12

当前路线图已经从“拆组件/拆 hooks”阶段，切换到“桌面端工作台稳定化 + Harness Engine v1”阶段。继续开发时不要先急着加新功能；这轮改动很大，必须先确保桌面壳子、路由和构建稳定，再进入 Harness Phase 1。

## 当前阶段目标

先把 `/project/:projectId` 和桌面 SPA 壳子收口成稳定的 Codex-like 项目工作台：

- 顶层 titlebar 分成左 / 中 / 右三段，并与下面主体三栏宽度对齐。
- 中间会话区是主舞台，输入框固定底部，输出区居中留白。
- 右侧工具区通过 tabs 和 `+` 管理，不再出现额外竖向图标栏。
- 摘要概览默认关闭，作为中间栏顶层右侧按钮下方的轻量悬浮卡。
- 云平台首页不要混入项目工作台顶栏和旧 quickstart。
- 桌面端导航不能指向已移除的 legacy route。
- 摘要卡、TitleBar、WorkspacePanelsContext 的状态契约要和真实 UI 一致。

## 已完成的关键方向

### 1. Codex-like 全局顶栏

- 新增桌面级 `TitleBar`。
- 顶栏高度压到 `28px`。
- 顶栏宽度分区跟下方左 / 中 / 右三栏同步。
- 清理了 `打开位置`、最小化、最大化、旧右侧竖栏等多余按钮。
- `+` 明确为“展开更多工具”。
- 摘要按钮明确在中间栏顶层右侧。
- 顶栏区域支持拖动窗口，交互按钮为 no-drag。

### 2. 中间会话区

- 去掉了大卡片边框和阴影。
- 输入框固定在底部。
- 删除横向 resize 控件。
- 消息区域用户右对齐、模型左对齐。
- 模型输出增加 Markdown 可读性。
- 输入框支持随内容自动增高，并在一定范围内增宽。
- 结果输出区已经开始做居中留白。

### 3. 左右分隔线与背景

- 左右栏分隔线从厚 rail 改为 1px 布局 + hairline 视觉。
- 主背景尽量统一为白色。
- 左侧栏大面积浅绿背景已清理。
- 主题色只保留在 active / hover / selected 状态。

### 4. 右侧工具区

- 右侧工具不再使用最右侧额外图标条。
- 文件树固定在右侧，文件内容在左侧自适应。
- 打开文件不应自动收起文件树。
- 底部终端方向已引入，但终端体验仍需继续精修。

### 5. 摘要概览

- 默认关闭。
- 删除 resize 手柄。
- 固定为窄而高的竖向卡片。
- 删除过松散的信息，只保留当前活动和状态。

### 6. 开发体验

- `npm run dev` 已改为 Vite dev server + Electron dev 启动。
- 开发时可以热更新，不需要每次重新打包 dist。
- dev CSP 已处理 React refresh preamble。

### 7. Phase 0 稳定化收口

- 清理了桌面 Dock / 导航面板里仍指向 `/single-cell`、`/spatial`、`/about` 的入口。
- 清理了摘要卡 resize 残留状态，摘要卡回到固定窄高卡片。
- 清理了 TitleBar state 中已不渲染的旧路径按钮 / 加标签字段。
- 已通过：

```bash
npm --prefix frontend run check
node --check src/main.js
node --check src/preload.js
node --check scripts/dev-electron.js
npm run build:spa
```

### 8. Harness Phase 1 基础落地

- 新增 `BioF3PluginManifest v1` normalized view。
- `plugin-loader.normalizePluginManifest()` 兼容读取旧的 `plugin.json + tool-definition.json`。
- MCP `tools/list` 现在会透传：
  - `outputSchema.artifacts`
  - `failureModes`
  - `_manifest`
- 内置可运行插件已补：
  - `pluginManifestVersion`
  - `supportedPlatforms`
  - `failureModes`
- 新增验证：

```bash
npm run harness:check
node --test test/harness-manifest.test.mjs test/mcp-tool-registry.test.mjs
```

### 9. Harness Phase 2 初始落地

- 新增 `scripts/harness-file-index.mjs`。
- 新增 `npm run harness:index`。
- 新增 `test/harness-file-index.test.mjs`。
- 文件探测器已支持：
  - CSV / TSV / JSON / text / binary 快速分类。
  - 表头、样例行、列类型、缺失值、数值列比例。
  - DEG 表、表达矩阵、样本分组、manifest、summary 等角色识别。
  - 表达矩阵方向：行是 feature 或行是 sample 的粗判。
  - 大文件采样读取和 hash。
- 目录索引器已支持：
  - 跳过 node_modules / dist / build / `.git` 等重目录。
  - 生成 `harnessIndexVersion: 1` 的轻量 index。
  - 写入 / 读取 `.biof3-harness-index.json` 缓存。
- 输入候选匹配已支持：
  - 根据插件 `inputs` 的 `id` / `label` / `accept` 自动给文件参数推荐候选文件。
  - 示例：火山图插件可以从 demo-data 里自动选中 `demo_deg.csv`。
- Scope resolver 已支持：
  - `path`
  - `project`
  - `job`
  - `artifact`
  - `dataset`
- Prompt summary 已支持：
  - `--prompt-summary` 输出更适合模型使用的瘦身索引，不包含大块样例行。
- 参数修复第一版已支持：
  - 文件输入自动预填。
  - DEG 常见列名别名映射：`symbol/gene_name → gene`、`logFC/avg_log2FC → log2FC`、`p_val/padj → pvalue`。
  - `top_n`、`n_components` 等数值参数根据索引探测结果裁剪。
- 后端 Harness API 已接入：
  - `GET /api/harness/index`
  - `POST /api/harness/repair`
  - 默认返回 prompt summary，`full=1` 才返回完整索引。
  - project / job / artifact / dataset 均做权限检查；任意 path 只允许 internal/admin。
- 前端项目工作台已接入 Harness index：
  - 新增 `frontend/src/lib/harness-client.ts`。
  - 右侧文件面板读取 `scope=project`，展示项目工作区识别摘要。
  - 右侧结果面板读取 `scope=artifact`，展示当前 job 产物识别摘要。
- 参数确认卡已接入 Harness repair：
  - `SimpleChat` 在收到 `run_tool needApproval` 时，会按 `toolId` 获取工具 manifest。
  - 调用 `POST /api/harness/repair` 使用当前 project scope 生成修复建议。
  - 建议在卡片内可见；确认后采用卡片中最终参数。
  - 异步建议不会覆盖用户已经手动修改过的参数。
- Agent prompt 已接入项目 Harness summary：
  - `ProjectWorkspace` 会把 project scope 的 Harness prompt summary 注入 `CopilotContext.projectHarnessSummary`。
  - `system-prompt.js` 渲染 `【Harness 项目文件摘要】`，帮助 agent 结合 manifest 判断文件参数。
- Agent prompt 已接入 active job / artifact Harness summary：
  - 当前 active done job 会额外加载 artifact scope 的 Harness prompt summary。
  - `system-prompt.js` 渲染 `【Harness 当前结果产物摘要】`，并优先标出当前选中的 artifact 匹配文件。
- 弱模型回归第一版已接入：
  - `rankHarnessToolsForRequest()` 根据用户请求、工具 manifest 和 Harness index summary 做确定性工具排序。
  - 测试覆盖“差异结果画火山图”和“表达矩阵做 PCA”，验证无需真实 LLM 也能选中工具、绑定文件并修复参数。
- 平台抽象第一版已接入：
  - `createLocalHarnessPlatform()` 封装本地 dataDir / jobsDir / dbPath / scope 解析。
  - `resolveHarnessScope()` 兼容旧调用，但内部走 `platform.resolveScope()`。
  - `indexHarnessScope()` 已支持注入 custom platform adapter，为后续远程 worker / 云端挂载路径预留边界。
- 平台抽象第二步已接入：
  - Local platform 支持 localRoot → canonicalRoot 路径映射。
  - scope、index entry、prompt summary 会带 canonical target/path。
  - `createHarnessExecutionContext()` 已返回 workDir、canonicalWorkDir 和 runtimeReady。
  - runtime ready 支持注入式检测，避免启动时阻塞外部命令。
  - 摘要卡只展示轻量信息：文件数、类型分布、角色分布、前几个关键文件。
- 真实执行链路已接入 canonical execution context：
  - MCP/Agent `run_tool` 入口会在工具运行结果里写入 `execution`、`canonicalJobDir`、`canonicalOutputDir`、`canonicalResultDir`。
  - MCP 结果的 `artifacts` / `outputs` / `files` 已补 `canonicalPath`。
  - 前端/HTTP 工具执行器也会把 execution/canonical 元信息写入 `tool_jobs.result_json`。
  - 缺失本地 R/Python 运行时会更早进入 failed，并留下 `runtimeReady` 上下文，便于 UI/Agent 做诊断。
- Harness 诊断层第一版已接入：
  - `diagnoseHarnessRunReadiness()` 会把参数修复、缺必需文件、矩阵方向不匹配、runtime 不可用等整合为 `ready / needs_review / blocked`。
  - `/api/harness/repair` 会额外返回 `diagnostics`，保持 `repair` 兼容不变。
  - 参数确认卡会展示 diagnostics；blocked 时禁用确认执行。
  - 弱模型回归已覆盖第三个内置插件 `gene-correlation`，包括“相关/共表达/热图”意图识别和 `top_n` 裁剪。

已通过：

```bash
npm --prefix frontend run check
npm run build:spa
node --check scripts/harness-file-index.mjs
node --test test/harness-file-index.test.mjs
npm run harness:index -- resources/built-in-plugins/volcano-plot/demo-data --for-manifest resources/built-in-plugins/volcano-plot/tool-definition.json --no-hash
npm run harness:index -- resources/built-in-plugins/volcano-plot/demo-data --for-manifest resources/built-in-plugins/volcano-plot/tool-definition.json --repair-params '{"top_n":999}' --prompt-summary --no-hash
node --check vendor/biof3-core/r-server/routes/harness.js
node --check vendor/biof3-core/r-server/routes/index.js
npm run harness:check
node --check vendor/biof3-core/r-server/mcp/registry.js
node --check vendor/biof3-core/r-server/helpers/tools-executor.js
node --test test/agent-run-tool.test.mjs test/harness-file-index.test.mjs
npm --prefix frontend run check
npm run build:spa
```

## 接下来优先级

### P0：稳定化确认

先跑并实机确认：

```bash
npm run dev
```

检查：

- 打开项目页后顶栏是否只有 28px 左右。
- 顶栏三段是否跟下面三栏严格对齐。
- 左侧栏收起/展开按钮是否能反复操作。
- 右侧栏收起/展开按钮是否稳定。
- `+` 是否始终打开工具菜单，而不是跳回主页。
- 摘要按钮是否能打开窄高摘要卡，默认是否关闭。
- 中间结果输出区是否居中、有左右留白。
- 桌面 Dock 和导航面板是否只出现有效路由入口。
- vendor/biof3-core 的改动是否确认为本次快照的一部分。
- `.cursor/` 是否需要提交或加入忽略。

### P1：Harness Phase 2

Phase 1 的 manifest / artifact / failureModes 基础已经落地，Phase 2 已经从“文件探测/索引”推进到“参数修复 + prompt 注入 + canonical execution context”。下一步继续推进：

1. 扩充弱模型回归测试：覆盖更多失败恢复、二跳分析链路和真实历史结果输入。
2. 增量索引：基于 mtime / hash 做局部更新，避免每次全量扫描。
3. 继续统一 failureModes 诊断：把产物缺失、输入文件格式异常、运行后错误转为稳定结构。
4. 把 canonical execution context 扩到步骤工具和云端 worker adapter。
5. 梳理 `repairHarnessParams()` 与真实 `run_tool` 的边界：继续保持“可审计建议优先”，避免静默覆盖用户参数。

详细规范见：[Harness Engine Spec v1](./harness-engine-spec.md)。

### P2：继续必要的视觉精修

只做不影响架构的小修：

1. 顶栏按钮距离：左侧栏按钮需要在展开/收起状态下都自然靠近 mac 窗口点。
2. 中间输出留白：结果输出、Markdown、聊天卡片需要集中在中部，不要铺满。
3. 摘要卡锚点：若视觉仍有割裂，下一步应根据 titlebar 摘要按钮真实位置计算 anchor。
4. 分隔线：保持极轻，只提供空间分区暗示。
5. 终端体验：继续做轻色主题、底部横跨中右栏、输入/输出手感。

### P3：回到原产品主线

视觉骨架稳定后，回到 BioF3 真正的工作流闭环：

1. 项目级对话隔离。
2. 参数确认卡片。
3. Job 提交、运行、失败、完成状态。
4. Artifact 生成与右侧查看。
5. 聊天结果卡片点击后打开右侧结果。
6. 当前右侧结果反向进入 Agent 上下文。
7. 插件 / workflow 体系作为正式分析来源。

## 当前风险与注意事项

- 当前工作树有大量 UI 改动和新增文件，不要随手 reset。
- `npm run check` 会校验 `.vendor-lock` 与 `vendor/biof3-core` HEAD；如果继续改子模块，记得用 `scripts/sync-vendor.sh update` 接受新 HEAD。
- 推荐验证命令：

```bash
npm --prefix frontend run check
npm run build:spa
```

- 如果需要做 git 快照，建议先确认是否包含 `.cursor/`，它可能不是必须提交内容。

## 继续开发时优先打开的文件

- `docs/project-workspace-handoff.md`
- `frontend/src/App.tsx`
- `frontend/src/components/desktop/TitleBar.tsx`
- `frontend/src/components/desktop/TitleBar.module.css`
- `frontend/src/components/desktop/WorkspacePanelsContext.tsx`
- `frontend/src/hooks/useWorkspaceLayout.ts`
- `frontend/src/hooks/useWorkspacePanels.ts`
- `frontend/src/hooks/useRightPanelTabs.ts`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/components/copilot/simple-chat.css`
- `frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx`
- `frontend/src/components/workspace-panels/RightPanel.tsx`
- `frontend/src/components/workspace-panels/LeftPanel.tsx`
