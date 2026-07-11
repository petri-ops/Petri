# Project Workspace Handoff

最后更新：2026-07-11

这份文档用于在切换工作区后恢复当前开发状态。当前阶段不是功能主线开发，而是在把 BioF3 项目工作台的前端骨架尽量收口到 Codex 式体验：轻、窄、白、少阴影、三栏对齐、输入区稳定贴底、右侧工具可预测。

## 给下一位 Codex Agent 的交接提示

你是接手这个任务的下一位 Codex 时，请直接沿着下面的方向继续，不要重做已经完成的 UI 收口。

### 当前目标

先把最近这批桌面端大改动稳定住，再推进 BioF3 的 **Harness Engine v1** 落地。当前项目经历了大量 UI、路由、状态和 Electron dev-mode 改动，下一位 agent 不应直接跳到新功能，而应先确认当前壳子稳定。

### 当前已完成

- 项目工作台 UI 已基本收口到 Codex-like 三栏结构。
- 结果卡片、摘要卡、右侧工具区的视觉层级已经显著简化。
- 桌面端已大幅瘦身：移除 skills / algorithms / prompt playground 等旧入口，`/single-cell` 和 `/spatial` 不再挂到桌面 SPA 路由。
- 已清理桌面导航中仍指向已移除路由的入口。
- 已清理摘要卡 resize 残留状态；摘要卡按固定窄高卡片处理。
- 已新增 `docs/harness-engine-spec.md`，作为 Harness 规范主文档。
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
  - 支持 `--for-manifest <tool-definition.json>`，可根据插件输入定义推荐候选文件。
  - 支持 `--scope project|job|artifact|dataset`，可以解析真实 BioF3 工作范围。
  - 支持 `--prompt-summary`，输出给模型使用的轻量摘要。
  - 支持 `--repair-params`，输出参数修复建议。
  - `repairHarnessParams()` 已能做文件输入预填、DEG 列名别名映射、数值参数裁剪。
  - 后端已新增 Harness API：
    - `GET /api/harness/index`
    - `POST /api/harness/repair`
    - 默认返回 prompt summary，`full=1` 才返回完整索引。
    - project / job / artifact / dataset 均做权限检查；任意 path 只允许 internal/admin。
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
```

### 现在最该做的事

1. 先做 **Phase 0：稳定化确认**：
   - 确认桌面导航、路由、TitleBar、WorkspacePanelsContext 没有残留错链。
   - 确认 `npm run dev` 真实打开项目页可用。
   - 确认 vendor/biof3-core 的改动是否纳入本次快照。
   - 确认 `.cursor/` 是否需要忽略或提交。
2. 再读 `docs/harness-engine-spec.md`。
3. 再读 `docs/next-steps-roadmap.md`。
4. 然后继续 **Harness Phase 2**：
   - 前端项目页接入 `/api/harness/index`，让文件 / job / artifact 能显示 Harness 识别摘要。
   - 参数确认卡接入 `/api/harness/repair`，提交任务前先展示可审计修复建议。
   - 暂时不要静默改 run_tool 参数；legacy 工具和 manifest 插件工具约定不同，先通过确认卡稳定体验。
   - 建立平台抽象层。
   - 增加弱模型只拿 manifest + index summary 也能选工具和补参数的回归测试。

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
