# Project Workspace Handoff

最后更新：2026-07-12

这份文档用于在切换工作区后恢复当前开发状态。当前阶段不是功能主线开发，而是在把 BioF3 项目工作台的前端骨架和结果层体验尽量收口到 Codex 式体验：轻、窄、白、少阴影、三栏对齐、输入区稳定贴底、右侧工具可预测，并重点优化“主预览 + Honeycomb 结果导航”的结果查看体验。

## 最新同步状态

- **当前正在进行的主线是结果层 UI 改变与稳定化优化**：
  - 重点区域是 `/project/:projectId?mode=scheduled&job=...` 的结果查看器。
  - 目标是保持“主预览 + Honeycomb artifact navigator”，让 HTML 报告、图表、表格、文本、PDF 等 artifact 都不丢失。
  - 这不是要重做工作台，也不是要新增一套结果系统；应优先保护已有报告模板、manifest、artifact schema 和历史结果兼容。
  - 后续继续动结果页时，必须先查现有实现、旧模板、历史 demo 产物和 git diff，再做最小修复。不要上来重写报告或导航结构。
- 当前主分支已经吸收远程跨平台 runtime 分支的核心改动，不再是“待合并”状态。
- 这次同步的重点不是 UI，而是桌面运行时、插件安装、路径映射、Harness 索引与修复链路。
- 现在的工作重点变成“合并后稳定化”：
  - 确认跨平台 runtime 选择逻辑稳定。
  - 确认 Harness 的文件索引、参数修复、诊断链路稳定。
  - 确认桌面壳、路由、构建和 vendor 同步都没有漂移。
- Harness 的定位要继续往通用交互式执行底座上抬，不要被局限成单纯的生信流程器。

## 当前结果页状态

- 当前结果层 UI 工作正在围绕 Honeycomb 结果导航继续精修：
  - 主预览区负责展示当前 active artifact。
  - 右侧 Honeycomb 导航负责展示 manifest sections、fallback artifacts、类型统计和当前分组摘要。
  - 主预览上方会出现二级切换条，用来在当前分组内切换具体 artifact。
  - 结果页要兼容旧 `manifest.files`、新 `artifacts`、`outputs`、`sections` 和 `report.html`。
  - HTML 报告预览是已有能力，不应被弱化成普通文件或从结果页移除。
- scheduled 模式的中间区域现在不再嵌入 `ResultView`，只保留返回对话入口；结果内容只允许出现在右侧结果栏。
- 中间会话区里不再展示分析记录卡片，聊天只保留对话本身。
- 结果页顶部的“分析结果 / 摘要已生成”标题块已经去掉，避免重复信息。
- 结果查看器已经收敛成“主预览 + Honeycomb 结果导航”的结构：
  - 图表 / 表格 / 文本 / HTML 预览放在主区域。
  - 右侧保持一级分组导航，主区域顶部承担二级 artifact 切换。
  - manifest 显式 sections 之外的 fallback artifacts 会自动补进“其他图表 / 其他表格 / 其他文本”等分组，避免插件产物被弱化或漏显。
- 右侧 Honeycomb 导航当前状态：
  - 顶部显示组数、产物数和图表 / 表格 / 文本 / 数据等紧凑统计。
  - 每个分组只保留一级入口与描述，不再展开所有文件。
  - 底部显示当前分组的轻量详情和“打开原文件”入口。
  - 宽度已从旧的 196px 提到 224px，仍保持窄导航，但信息密度更稳定。
- 图表类分组现在优先显示专用 `svg` 图标，避免“图表结果”这类分组在 mixed section 下看起来像缺少图标。
  - 这次目标不是继续加新入口，而是把结果区维持在“简洁但内容不缺”的状态。
- 摘要卡展开时的让位逻辑已经从 `workspaceSessionContent` 挪到 `workspaceSessionFrame`：
  - 之前只是给内容层加右侧 padding，卡片又是 absolute 覆盖，所以看起来只挤出了一小块空白。
  - 现在通过 `workspaceSessionInset` 这种内层容器吃掉右侧预留，绘画区会整体向左缩进，而不是只在内容里留空。

## 当前结果层修复记录（2026-07-12）

- 已发现并纠正一个重要开发方式问题：结果报告不能临时手写一套新 HTML，应优先复用项目已有的报告模板机制。
- 旧体系中已有报告生成约定：
  - `vendor/biof3-core/r-server/tool-scripts/*-report-template.html`
  - 执行器会把插件目录下的 `<toolId>-report-template.html` 复制到 job 根目录为 `report-template.html`
  - 工具脚本读取模板并生成 `report.html`
  - `manifest.files` / `outputs` / `sections` 负责结果页导航和预览
- `resources/built-in-plugins/volcano-plot` 是新的轻量内置插件；原始版本只有 `volcano.png`、`volcano.pdf`、`classified_table.csv`、`manifest.json`，没有 `report.html`。
- 已做的正确收口：
  - 保留真实 bug 修复：`volcano-plot.R` 中 `%||%` 必须在首次使用前定义。
  - 新增 `resources/built-in-plugins/volcano-plot/volcano-plot-report-template.html`。
  - `volcano-plot.R` 改为读取 `report-template.html` 后生成 `report.html`，不再内嵌临时大段 HTML。
  - 当前 demo job `tj_mrhgg5cf_ib7o` 已按同一模板机制重新生成 `report.html` 和 `manifest.json`，并同步更新本地 DB 的 `result_json`。
- 当前 demo job 产物：
  - `report.html`
  - `volcano.png`
  - `classified_table.csv`
  - `deg_table.csv`
  - `manifest.json`
  - `volcano.pdf`
- 已验证：
  - `npm --prefix frontend run check`
  - `npm --prefix frontend test -- result-manifest.test.ts`
- `GET /api/tools/file/tj_mrhgg5cf_ib7o/report.html` 返回 200
- `GET /api/tools/status/tj_mrhgg5cf_ib7o` 返回 completed 且包含 6 个 artifacts
- `ScheduledWorkspacePanel` 已去掉中心结果预览，只剩返回对话；结果只保留在右侧 Honeycomb 导航中，避免重启后中心区再次出现分析记录/结果卡。

后续继续做结果层 UI 时，先遵守这条顺序：

1. 读 `docs/project-workspace-handoff.md` 与 `docs/next-steps-roadmap.md`。
2. 查 `frontend/src/lib/result-manifest.ts`、`frontend/src/pages/project-workspace.tsx`、`frontend/src/lib/result-manifest.test.ts`。
3. 查旧报告模板和 demo 产物：`vendor/biof3-core/r-server/tool-scripts/*-report-template.html`、`vendor/biof3-core/r-server/tool-demo-results/`。
4. 只做兼容和最小修复；不要先重写报告模板、导航结构或结果渲染器。

## 给下一位 Codex Agent 的交接提示

你是接手这个任务的下一位 Codex 时，请直接沿着下面的方向继续，不要重做已经完成的 UI 收口。

### 当前目标

先把最近这批桌面端大改动稳定住，再推进 BioF3 的 **Harness Engine v1** 落地。当前项目经历了大量 UI、路由、状态和 Electron dev-mode 改动，下一位 agent 不应直接跳到新功能，而应先确认当前壳子稳定。

补充一句：当前 UI 的结果工作台已经从“聊天里挂结果卡”切到“右侧结果目录 + 主预览”的模式，后续不要再把分析记录、标题摘要、解释按钮加回聊天流里。

### 当前已完成

- 项目工作台 UI 已基本收口到 Codex-like 三栏结构。
- 结果卡片、摘要卡、右侧工具区的视觉层级已经显著简化。
- 聊天区里的分析记录卡、结果解释按钮、打开完整结果按钮已移除。
- 结果查看器已改为右侧 Honeycomb artifact navigator + 主预览的紧凑布局。
- 桌面端已大幅瘦身：移除 skills / algorithms / prompt playground 等旧入口，`/single-cell` 和 `/spatial` 不再挂到桌面 SPA 路由。
- 已清理桌面导航中仍指向已移除路由的入口。
- 已清理摘要卡 resize 残留状态；摘要卡按固定窄高卡片处理。
- 已新增 `docs/harness-engine-spec.md`，作为 Harness 规范主文档。
- 已新增 `docs/harness-roadmap.md`，作为 Harness 的阶段路线图。
- 已在 `docs/next-steps-roadmap.md` 里挂上 Harness 落地入口。
- Harness Phase 1 基础已落地：
  - `plugin-loader.normalizePluginManifest()` 统一读取 `plugin.json + tool-definition.json`。
  - MCP `tools/list` 透传 `_manifest`、`outputSchema.artifacts` 和 `failureModes`。
  - 内置可运行插件已补 `pluginManifestVersion`、`supportedPlatforms`、`failureModes`。
  - 新增 `npm run harness:check` 和 `test/harness-manifest.test.mjs`。
- Harness Phase 2 初始能力已落地：
  - `scripts/harness-file-index.mjs` 提供可复用文件探测、目录索引和缓存读写。
  - `npm run harness:index -- <path>` 可输出 `harnessIndexVersion: 1` 结构化索引。
  - 支持 CSV / TSV 表头、列类型、缺失值、矩阵方向、DEG 表、样本分组表、表达矩阵等识别。
  - 支持基于缓存的增量索引重建，未变化文件会复用旧索引。
  - 支持 `--for-manifest <tool-definition.json>`，可根据插件输入定义推荐候选文件。
  - 支持 `--scope project|job|artifact|dataset`，可以解析真实 BioF3 工作范围。
  - 支持 `--prompt-summary`，输出给模型使用的轻量摘要。
  - 支持 `--repair-params`，输出参数修复建议。
  - `repairHarnessParams()` 已能做文件输入预填、DEG 列名别名映射、数值参数裁剪。
  - `diagnoseHarnessRunReadiness()` 已能识别 `code` / `detect` 双通道失败模式，并补充 PCA 的 sample-group mismatch 诊断。
  - 后端已新增 Harness API：
    - `GET /api/harness/index`
    - `POST /api/harness/repair`
    - 默认返回 prompt summary，`full=1` 才返回完整索引。
    - project / job / artifact / dataset 均做权限检查；任意 path 只允许 internal/admin。
  - 前端项目工作台已接入 `/api/harness/index`：
    - 右侧文件面板展示 project 工作区识别摘要。
    - 右侧结果面板展示 active job 的 artifact 识别摘要。
    - 新增 `frontend/src/lib/harness-client.ts`。
  - 前端参数确认卡已接入 `/api/harness/repair`：
    - 确认卡会根据 `toolId` 拉取 `/api/tools/manifest`，找不到时 fallback 到静态工具定义。
    - 使用 project scope 扫描当前项目文件，展示 Harness 参数建议。
    - repair 返回后只会填充/修正仍保持原值的参数；如果用户已经手动改了某个参数，不覆盖用户输入。
    - 用户点击“确认开始”后，会把可见且可编辑的修复后参数传回 `run_tool`。
  - Agent prompt 已能读取当前项目的 Harness prompt summary：
    - `ProjectWorkspace` 会获取 project scope 的 `/api/harness/index` prompt summary。
    - `CopilotContext.projectHarnessSummary` 只保留文件数、kind/role 统计和前若干候选文件，避免把完整索引塞进 prompt。
    - `vendor/biof3-core/r-server/helpers/system-prompt.js` 会渲染 `【Harness 项目文件摘要】`，task/legacy agent 路径都会生效。
  - Agent prompt 已进一步接入 active job/artifact 的 Harness summary：
    - `ProjectWorkspace` 会对当前 active done job 获取 artifact scope 的 `/api/harness/index` prompt summary。
    - `CopilotContext.activeJobHarnessSummary` 会进入 prompt 的 `【Harness 当前结果产物摘要】`。
    - 若当前选中了 active artifact，prompt 会优先标出匹配文件，方便 Agent 解释当前结果和选择后续输入。
  - 弱模型回归测试第一版已落地：
    - `scripts/harness-file-index.mjs` 新增 `rankHarnessToolsForRequest()`。
    - 不调用 LLM，仅根据用户意图、工具 manifest 和 Harness index summary 做确定性工具排序。
    - `test/harness-file-index.test.mjs` 已覆盖“差异结果画火山图”和“表达矩阵做 PCA”两条场景，验证选工具、绑定文件和参数修复。
  - 平台抽象层第一版已落地：
    - `scripts/harness-file-index.mjs` 新增 `createLocalHarnessPlatform()`。
    - `resolveHarnessScope()` 对外兼容不变，但底层通过 `platform.resolveScope()` 解析 project / job / artifact / dataset。
    - `indexHarnessScope()` 已支持注入 custom platform adapter，后续可接远程 worker / 云端挂载路径。
  - 平台抽象层第二步已落地：
    - Local platform 支持 `pathMappings: [{ localRoot, canonicalRoot }]`。
    - scope 和 index entries 会带 `canonicalTarget` / `canonicalPath`，prompt summary 也保留 canonical path。
    - 新增 `createHarnessExecutionContext()`，返回 workDir、canonicalWorkDir 和 runtimeReady。
    - runtime ready 支持注入式 `runtimeChecks`，默认 shell ready，R/Python 只做非阻塞环境/路径探测。
  - `run_tool` 执行链路已接入 canonical execution context：
    - MCP/Agent 工具执行入口 `vendor/biof3-core/r-server/mcp/registry.js` 会在结果 summary 中写入 `execution`、`canonicalJobDir`、`canonicalOutputDir`、`canonicalResultDir`。
    - MCP 产物 `artifacts` / `outputs` / `files` 会带 `canonicalPath`，便于后续 Agent、云端 worker、结果解释和参数修复稳定引用。
    - HTTP/前端工具执行入口 `vendor/biof3-core/r-server/helpers/tools-executor.js` 也会把同样的 execution/canonical 元信息写入 `tool_jobs.result_json`。
    - 本地运行时缺失时会更早失败，并把 `runtimeReady` 写入可审计结果上下文。
  - Harness 诊断层第一版已落地：
    - `scripts/harness-file-index.mjs` 新增 `diagnoseHarnessRunReadiness()`。
    - 弱模型工具排序已覆盖 `gene-correlation`，可以识别“相关/共表达/热图”意图。
    - 诊断层会把缺必需文件、矩阵方向不匹配、样本/特征不足、runtime 不可用等转换成统一 `issues`。
    - `/api/harness/repair` 保持原 `repair` 返回值不变，并额外返回 `diagnostics`。
    - 参数确认卡会展示 `ready / needs_review / blocked` 诊断状态；blocked 时禁用“确认开始”，避免明显不可执行任务继续下发。
  - `codex/cross-platform-runtime` 分支已完成专业审计并吸收到当前主线：
    - 没有直接 merge 旧分支；采用 cherry-pick / 选择性吸收，避免回退 Harness 主线。
    - vendor 子仓吸收了 Python runtime 跨平台路径解析：`shared-backend/runtime-paths.js`、Python executor、py-server warm pool / cold path。
    - 主仓吸收了 `src/platform-compat.js`、R/Python runtime 二进制选择、终端 shell plan、插件 zip 纯 Node 解压、runtime 平台匹配。
    - 修正了旧分支遗留风险：补 `scripts/fix-r-paths.mjs`，把 `extract-zip` 提升为直接依赖，并统一三处插件解压调用为 `extractZipFile()`。
    - 新增 `test/platform-compat.test.mjs` 做跨平台命令选择回归。
  - 新增 `test/harness-file-index.test.mjs`。

### 最近一次稳定化验证

2026-07-11 已通过：

```bash
npm --prefix frontend run check
node --check src/main.js
node --check src/preload.js
node --check scripts/dev-electron.js
npm run build:spa
npm run harness:check
node --test test/harness-manifest.test.mjs test/mcp-tool-registry.test.mjs
node --check scripts/harness-file-index.mjs
node --test test/harness-file-index.test.mjs
npm run harness:index -- resources/built-in-plugins/volcano-plot/demo-data --for-manifest resources/built-in-plugins/volcano-plot/tool-definition.json --repair-params '{"top_n":999}' --prompt-summary --no-hash
node --check vendor/biof3-core/r-server/routes/harness.js
node --check vendor/biof3-core/r-server/routes/index.js
npm --prefix frontend run check
npm run build:spa
node --test test/platform-compat.test.mjs
```

2026-07-12 继续通过：

```bash
npm --prefix frontend run check
npm run build:spa
npm run check
node --check vendor/biof3-core/r-server/mcp/registry.js
node --check vendor/biof3-core/r-server/helpers/tools-executor.js
node --test test/agent-run-tool.test.mjs test/harness-file-index.test.mjs
npm --prefix frontend run check
npm run build:spa
```

### 现在最该做的事

1. 先读 `docs/harness-engine-spec.md`。
2. 再读 `docs/next-steps-roadmap.md`。
3. 继续 **Harness Phase 2 后半段**，但不要再回头改旧的结果卡片交互：
   - 继续扩充弱模型回归测试，覆盖更多二跳分析和失败恢复场景。
   - 做增量索引：基于 mtime / hash 只更新变化文件，避免每次全量扫描。
   - 把 canonical execution context 用到更多任务编排入口，例如步骤工具、二次分析、云端 worker adapter。
   - 继续收敛 failureModes：把产物缺失、输入文件格式异常、运行后失败等也转成统一可诊断结构。
   - 后续如果继续做跨平台，优先补三平台 CI，而不是再开长期未同步分支。

### 当前原则

- 不要把 Harness 做成更长的 prompt。
- 要把它做成可编排、可验证、可迁移的执行系统。
- Skills 负责策略，插件负责计算，Harness 负责编排。
- 跨平台和大文件索引是核心能力，不是附加项。

### 暂时不要做的事

- 不要再优先做 UI 大改。
- 不要回头重构已经稳定的三栏布局。
- 不要把真实执行逻辑继续散落在 prompt 文案里。
- 不要绕过 Phase 0 直接大规模改 Harness；先确保当前大量未提交改动可构建、可运行、可交接。

## 当前产品判断

BioF3 的 `/project/:projectId` 应继续走 Codex 式项目工作台方向：

- 左侧：项目/资源/搜索/项目切换。
- 中间：Agent 会话与结果输出主舞台。
- 右侧：结果、文件、浏览器、后端/终端、侧边聊天等工具面板。
- 顶层：不是普通网页导航，而是桌面应用级 titlebar，按下面三栏宽度同步分区。

当前视觉原则：

- 全局顶栏高度控制在 `28px`。
- 主背景尽量统一白色或接近白色，不再使用大面积浅绿/浅灰分块。
- 分隔线只保留极细 hairline，避免厚 rail 影响布局观感。
- 主题浅绿色只用于 active / hover / selected，不作为大面积区域背景。
- 内容不要铺满，中间输出区需要左右留白并集中在视觉中部。

## 顶层布局现状

顶层已经从旧的混合式 toolbar 重构为 Codex-like 三段式 titlebar。

目标结构：

```text
┌────────────── left span ──────────────┬──────────── center span ────────────┬──────────── right span ────────────┐
│ mac 窗口点 | 左侧栏 | ← →             │ 文件夹 | 当前项目标题       摘要按钮 │ Tabs | + | 底部终端 | 右侧栏按钮     │
└───────────────────────────────────────┴────────────────────────────────────┴───────────────────────────────────┘
```

已实现要点：

- `App.tsx` 中接入新的 `TitleBar`。
- `/` 封面页不显示这条 workspace titlebar，项目工作台显示。
- 全局内容区 `padding-top` 与 titlebar 高度对齐为 `28px`。
- 顶层左/中/右宽度跟下面主体布局同步：
  - 左段宽度跟左侧栏一致；左侧栏收起时进入 collapsed 宽度。
  - 中段使用 `minmax(0, 1fr)`。
  - 右段跟右侧栏宽度一致；右侧栏收起时进入 collapsed 宽度。
- titlebar 可拖动窗口；按钮区域使用 no-drag。
- 已清除不需要的 `打开位置`、最小化、最大化等按钮。
- 顶层 `+` 是“展开更多工具”，不是摘要按钮。
- 摘要按钮放在中间栏顶层最右侧。

相关文件：

- `frontend/src/components/desktop/TitleBar.tsx`
- `frontend/src/components/desktop/TitleBar.module.css`
- `frontend/src/components/desktop/WorkspacePanelsContext.tsx`
- `frontend/src/hooks/useWorkspaceLayout.ts`
- `frontend/src/hooks/useWorkspacePanels.ts`
- `frontend/src/hooks/useRightPanelTabs.ts`
- `frontend/src/App.tsx`

## 中间会话区现状

中间区域已经从“大卡片包裹聊天”的形态改成更接近 Codex 的开放式会话区。

已完成：

- 移除了中间大卡片边框和阴影。
- 输入框固定在整个中间消息区底部，不再跟着消息输出区漂浮。
- 删除了用于调整聊天框宽度的横向拖拽控件。
- 中间背景、结果区背景、左右区域背景已尽量统一为白色。
- 消息展示做了左右分流：
  - 用户消息在右侧。
  - 模型消息在左侧。
  - 模型消息有轻量卡片感，便于 Markdown 阅读。
- Markdown 基础样式已优化：标题、列表、代码、表格等比之前更清晰。
- 输入框支持随文字长度自适应：
  - 高度自动增长，最大高度受控。
  - 宽度会在一定范围内增长，但不会破坏页面布局。
- 结果输出区已加左右留白，并用 `max-width` 居中，避免内容铺满。

相关文件：

- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/components/copilot/simple-chat.css`
- `frontend/src/components/workspace-panels/CenterPanel.tsx`
- `frontend/src/pages/project-workspace.module.css`

## 左侧栏现状

左侧栏的方向是：背景统一、线条轻、控制按钮靠近 mac 窗口点。

已完成：

- 左侧大面积浅绿背景已移除。
- 左侧栏顶部和下面控制区背景改为与整体一致。
- active / hover 状态保留主题浅绿色。
- 搜索框离全局顶栏更近，顶部空隙已压缩。
- 左侧栏收起/展开按钮位置已向 mac 窗口点靠近。
- 左侧栏收起时按钮应靠到最左侧，仍需继续实机观察细节是否完全和谐。

相关文件：

- `frontend/src/components/workspace-panels/LeftPanel.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/components/desktop/TitleBar.module.css`

## 右侧工具区现状

右侧工具区现在以 tab + more tools 的模式运作。

已完成：

- 删除了最右侧额外图标竖栏。
- 顶层 `+` 用于添加/切换更多工具。
- 右侧空态不再作为“结果主页”的长期设计方向，只作为没有具体工具内容时的轻量入口。
- 文件树保持在右侧，文件内容在左侧展示，打开文件不应自动收起文件树。
- 右侧文件树宽度已加宽过，体验比最初稳定。
- 浏览器已作为右侧工具之一接入；默认站点方向是 `https://biof3.com/`。
- 后端/终端方向拆分过：顶部工具中的“后端”用于服务状态与日志，真正终端走底部面板。

仍需继续确认：

- `+` 菜单在所有状态下是否都稳定打开工具，而不是回到工作台主页。
- 浏览器区域在不同网页下是否仍有高度/滚动/遮挡问题。
- 终端体验还没有完全达到 Codex 手感，后面要继续精修。

相关文件：

- `frontend/src/components/workspace-panels/RightPanel.tsx`
- `frontend/src/hooks/useRightPanelTabs.ts`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`

## 摘要信息卡现状

摘要信息现在定位为后续“分析任务动态跟踪”的基础，不再做宽大的横向信息面板。

已完成：

- 摘要默认关闭。
- 摘要开关按钮在中间栏顶层最右侧。
- 删除了摘要卡 resize 手柄。
- 摘要卡固定为较窄、较高的竖向卡片。
- 摘要卡阴影已尽量移除，避免顶部或边缘出现悬浮脏影。
- 摘要卡内容已压缩：
  - 保留当前活动/状态。
  - 删除早期过松散的上下文、正在查看等内容。
  - 不再展示不必要的长路径与宽卡片信息。

需要继续观察：

- 摘要卡与摘要按钮的视觉连接还可以更精准。当前是靠近按钮下方的固定悬浮卡，后续如果要完全 Codex-like，可以用按钮位置计算真实 anchor。

相关文件：

- `frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/hooks/useWorkspacePanels.ts`

## 云平台/封面页现状

已处理：

- 软件打开首页/封面页顶部不再展示项目工作台 titlebar。
- 云平台工作台里旧的“快速开始”区域已清理。

产品判断：

- “快速开始”是早期遗留分析入口，当前插件体系还没有稳定呈现时，保留它会误导用户。
- 后续更适合替换为：
  - 最近使用插件；
  - 当前项目推荐工具；
  - 插件市场/固定 workflow 入口；
  - 最近任务与可复现记录。

相关文件：

- `frontend/src/pages/_desktop-dashboard.tsx`

## 开发体验现状

已支持开发热更新：

- `npm run dev` 现在会启动 Vite dev server，再启动 Electron。
- Electron dev 模式优先加载 `http://localhost:3000`，而不是每次使用 `frontend/dist`。
- 修复过 `@vitejs/plugin-react can't detect preamble`，dev CSP 已允许 React refresh 所需脚本。

常用命令：

```bash
npm run dev
npm --prefix frontend run check
npm run build:spa
```

注意：

- `npm run check` 会先跑 `scripts/sync-vendor.sh check`，因此子模块变更必须同步更新 `.vendor-lock`。
- 当前 Harness Phase 1 已接受 `vendor/biof3-core` 的新 HEAD，并更新 `.vendor-lock`。

相关文件：

- `package.json`
- `scripts/dev-electron.js`
- `src/main.js`

## 当前最重要的下一步

换工作区后建议按这个顺序继续：

1. 先跑 `npm run dev`，进入项目页检查真实 UI。
2. 对照 Codex 继续检查三栏 titlebar：
   - 左段宽度是否跟左栏一致；
   - 中段标题和摘要按钮是否自然；
   - 右段 tabs / `+` / 终端 / 右侧栏按钮是否不拥挤；
   - 收起左栏、收起右栏后按钮位置是否稳定。
3. 继续精修中间结果输出区：
   - 左右留白是否足够；
   - 输出内容是否居中；
   - Markdown 卡片是否清晰；
   - 用户/模型消息左右分布是否自然。
4. 继续精修摘要卡：
   - 默认关闭；
   - 宽窄和高度是否像竖向动态追踪卡；
   - 是否紧贴摘要按钮下方；
   - 内容是否足够紧凑。
5. 再回到原开发计划：
   - 项目级对话隔离；
   - 插件/Workflow 参数确认；
   - Job/Artifact 结果卡片；
   - 右侧结果查看与聊天上下文联动。

## 当前重点文件索引

- `frontend/src/App.tsx`
- `frontend/src/components/desktop/TitleBar.tsx`
- `frontend/src/components/desktop/TitleBar.module.css`
- `frontend/src/components/desktop/WorkspacePanelsContext.tsx`
- `frontend/src/hooks/useWorkspacePanels.ts`
- `frontend/src/hooks/useWorkspaceLayout.ts`
- `frontend/src/hooks/useRightPanelTabs.ts`
- `frontend/src/components/workspace-panels/CenterPanel.tsx`
- `frontend/src/components/workspace-panels/LeftPanel.tsx`
- `frontend/src/components/workspace-panels/RightPanel.tsx`
- `frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/components/copilot/simple-chat.css`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/pages/_desktop-dashboard.tsx`
- `frontend/src/styles/global.css`
- `src/main.js`
- `package.json`
- `scripts/dev-electron.js`

## 当前工作树提示

当前工作树有大量 UI 改动和新增文件，这是预期状态。切换工作区前，如果需要真正做 git 层面的快照，建议单独提交一次，例如：

```bash
git add docs/project-workspace-handoff.md frontend src package.json scripts
git commit -m "Refine Codex-style project workspace layout"
```

不要随手 reset；这些改动大多是连续 UI 打磨的结果。
