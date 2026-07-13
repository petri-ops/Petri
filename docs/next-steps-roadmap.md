# Project Workspace — Next Steps Roadmap

最后更新：2026-07-13

当前路线图已经从“拆组件/拆 hooks”阶段，切换到“桌面端工作台稳定化 + Harness Engine v1”阶段。当前又叠加了远程跨平台 runtime 分支的合并收口，因此继续开发时不要先急着加新功能；先确保桌面壳子、路由、构建、Harness 索引/修复与跨平台 runtime 逻辑都稳定，再进入下一轮扩展。

结果层 UI 已完成当前一轮收口，接下来进入：**结果产物可信化 + Harness Phase 2 后半段**。具体指校验 manifest 与真实磁盘产物、统一 artifact diagnostics / failureModes、打通 active artifact 二跳分析、参数修复和失败恢复。该阶段不应重写工作台，不应新增第二套结果系统，也不应绕过已有报告模板机制。

## 2026-07-13 今日执行顺序

1. **UI checkpoint**：验证、文档同步、commit 与 push 已完成；非阻断型视觉修改已冻结。
2. **Artifact truth**：核心闭环、验证、commit 与 push 已完成；status API、DB `result_json`、manifest 和磁盘真实文件已统一校验，缺失产物进入 diagnostics / failureModes。
3. **Harness continuation**：真实二跳核心链路、绝对路径修复、失败恢复回归、commit 与 push 已完成。
4. **Platform stability**：Electron ABI、runtime/canonical path、vendor lock、MCP 文件交付和三平台 CI 最小矩阵已完成并推送。
5. **Delivery**：完整验证与三份进度文档同步已完成，今日成果已形成可恢复检查点。

今日硬约束：

- 中间栏始终属于 Agent 工作区。
- 结果主预览与 Honeycomb 导航始终属于右侧结果工具工作区。
- UI 除阻断问题外不再继续精修。
- 前端对缺失 artifact 的回退只是兼容保护，不能代替后端产物一致性校验。

### Stage 2 当前成果

- artifact truth 已成为 HTTP、MCP 和状态读取的共享边界。
- `valid / degraded / blocked` 与五类 artifact diagnostics 已落地。
- required 产物异常阻断 completed；optional 异常保留结果并过滤失效导航。
- 历史结果支持从磁盘 manifest 自愈 DB，目录选择优先真实 populated output。
- Stage 3 已接续完成 active artifact 二跳输入、repair、readiness gate 与下游结果验证。

### Stage 3 当前成果

- active artifact 可优先进入下游工具 repair，但必须先通过类型与角色匹配。
- artifact scope blocked 时自动回退 project scope。
- API repair 返回隔离执行器可读取的绝对路径。
- 已跑通 `classified_table.csv → volcano-plot → 6 个 truth-valid artifacts` 的真实链路。
- Stage 4 已接续完成 Electron ABI、runtime/canonical path、vendor lock、MCP 文件交付与三平台 CI 最小矩阵。

### Stage 4 当前成果

- migration 已迁出 Electron 主进程原生模块边界，开发启动不再出现 ABI mismatch。
- vendor lock 与已推送 Core 一致。
- MCP 结果文件可通过受控路径正常预览。
- 三平台 CI 最小矩阵已配置。
- Core 文件交付检查点为 `5733244`，Desktop 锁已同步到该提交。
- 剩余 Router、循环依赖和 bundle 警告为非阻断后续项。

## 当前阶段目标

先把 `/project/:projectId` 和桌面 SPA 壳子收口成稳定的 Codex-like 项目工作台：

- 顶层 titlebar 分成左 / 中 / 右三段，并与下面主体三栏宽度对齐。
- 中间会话区是主舞台，输入框固定底部，输出区居中留白。
- 右侧工具区通过 tabs 和 `+` 管理，不再出现额外竖向图标栏。
- 结果工具采用主预览 + Honeycomb artifact navigator：二者都位于可扩宽的右侧工具工作区；工具内部主区域负责阅读/预览，内部右侧负责一级结果索引，内部顶部负责二级 artifact 切换。
- scheduled 模式中间 Agent 区不要再嵌入独立结果视图；中心只保留 Agent 会话/返回入口，所有结果内容统一收敛到右侧结果工具工作区。
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

### 4.1 Honeycomb 结果导航

- 结果页主预览和右侧导航已经从普通目录升级为 artifact navigator。
- `frontend/src/lib/result-manifest.ts` 新增统一导航模型：
  - 显式 manifest sections 优先保留。
  - 未被 sections 覆盖的 fallback artifacts 会自动按类型补入“其他图表 / 其他表格 / 其他文本 / 其他数据”等分组。
  - 提供 artifact kind 统计，供右侧导航展示紧凑 metadata。
- `ProjectWorkspace` 结果页右侧导航现在按 section 直接展开 artifacts：
  - 每个 section 只保留一级入口与紧凑描述。
  - 主预览上方显示二级 artifact 切换条。
  - 选中项会同步主预览和 active artifact 上下文。
  - 底部显示当前分组与原文件打开入口。
- 已补 `frontend/src/lib/result-manifest.test.ts` 回归，覆盖显式 section + fallback artifact 不丢失。

当前结果层 UI 继续优化时的硬约束：

- 优先兼容已有实现，而不是重写：
  - 先查 `frontend/src/lib/result-manifest.ts`。
  - 再查 `ProjectWorkspace` 中的 `ResultArtifactShell`。
  - 再查旧工具报告模板和历史 demo 产物。
- HTML 报告是结果页主预览的一等 artifact：
  - `report.html` 应被识别为 `report`。
  - 有 `report.html` 时应优先作为默认预览。
  - 没有 `report.html` 时才 fallback 到图表/表格。
- manifest 兼容范围必须覆盖：
  - `manifest.files`
  - `manifest.outputs`
  - `manifest.sections`
  - result-level `artifacts`
  - result-level `files`
  - result-level `outputs`
- 显式 sections 优先，但不能导致未覆盖 artifact 消失；未覆盖项必须自动补进“其他图表 / 其他表格 / 其他文本 / 其他数据”等 fallback 分组。
- 不要把分析记录卡、解释按钮、打开完整结果按钮重新塞回聊天流。

2026-07-12 结果报告兼容修复记录：

- `volcano-plot` 轻量内置插件补齐了已有报告机制：
  - 新增 `resources/built-in-plugins/volcano-plot/volcano-plot-report-template.html`。
  - `resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R` 读取执行器复制的 `report-template.html` 生成 `report.html`。
  - 保留 `%||%` 定义提前的真实 bug 修复。
- 当前 demo job `tj_mrhgg5cf_ib7o` 已重新生成并同步：
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
- 结果页已进一步收口为“主预览 + 右侧目录导航”：
  - 聊天区里的分析记录卡、`打开完整结果` / `解释结果` 按钮已经移除。
  - 结果页的标题块（分析结果 / 摘要已生成）已经移除。
  - 右侧目录已压缩为更紧凑的侧边导航，主预览保留图表、表格、文本与 HTML 结果。
  - 图表类分组在 mixed section 下优先使用 `svg` 图标，避免“图表结果”看起来像缺少图标。
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
- `codex/cross-platform-runtime` 已完成审计并吸收到主线：
  - vendor 子仓已 cherry-pick Python runtime 跨平台路径解析。
  - 主仓已吸收 `src/platform-compat.js`、R/Python runtime 二进制选择、终端 shell plan、插件 zip 纯 Node 解压和 runtime 平台匹配。
  - 已补 `scripts/fix-r-paths.mjs`、`extract-zip` 直接依赖、`test/platform-compat.test.mjs`。
  - 旧分支不应再作为待合入分支重复处理；后续跨平台工作优先补 CI 和真实 Windows/Linux 验证。

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
node --test test/platform-compat.test.mjs
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
- 结果页是否仍保持“主预览 + 右侧目录导航”的紧凑形态，而不是把分析记录或标题块加回去。
- 桌面 Dock 和导航面板是否只出现有效路由入口。
- vendor/biof3-core 的改动是否确认为本次快照的一部分。
- `.cursor/` 是否需要提交或加入忽略。

### P1：Harness Phase 5（当前下一阶段）

Phase 1–4 已正式完成。Phase 4 已建立 12 类薄任务包、确定性工具选择、无猜测保护、HTTP workflow 自动选型和独立评测门禁。下一步进入多步骤工作流编排：

1. 定义多步骤 workflow template schema，引用 task pack/tool id，不复制 manifest。
2. 把模板阶段映射到现有 `run_tool → tool_job → artifact truth`，不创建第二套执行器。
3. 建立 artifact lineage：上一步 verified artifact 成为下一步显式输入。
4. 支持步骤级暂停、确认、失败恢复和继续执行。
5. 用真实二跳/三跳分析加入回归，再接 Agent/计划状态展示。

2026-07-13 接续进展：第 1、3、4 项进一步收口。repair audit、稳定 readiness、不可修复输入阻塞、桌面 runtime 探测和八阶段 workflow plan API 已落地并通过真实历史 artifact 验证；Core 检查点为 `f491b61`。下一步不再扩写 plan 表面结构，而是把现有 `run_tool` 的 job 状态和 artifact truth 映射到 `run / verify / report`，形成可恢复的真实状态机。

状态机接续已经完成（Core `4af1be2`）：workflow status 现在复用现有 tool job 与 artifact truth，并输出 `resumeFrom / nextActions`；真实 valid、degraded、blocked、execution failed、queued、running、cancelled 均有确定性投影。下一步优先把该只读状态接入现有摘要动态跟踪/结果工具，不新增独立工作流主页；所有 retry 或 artifact repair 必须继续走明确确认和审计边界。

只读状态 UI 已接入：摘要卡八段轨道和结果工具 truth/recovery 单行状态已完成；查询只在对应界面可见时进行，终态停止。恢复按钮当前只创建需要用户确认的 Agent 请求。下一步应补 recoverable/blocked UI fixture，并实现确认后的 retry/repair → 原 workflow 状态回写闭环。

Recoverable workflow 阶段已经完整收口（Core `8cb2620`）：`reconcile_artifacts / retry_run` 具备短期单次确认、动作白名单、审计、原 job 状态回写和真实运行验证；需要理解数据语义的 `repair_artifacts` 仍由 Agent 处理。下一步进入多步骤 workflow template 与 Agent/计划状态联动，不再继续增加恢复按钮。

Phase 3 已于 2026-07-13 完成（Core `c9208d5`）：共享 `execution-context.js` 消除了 HTTP/MCP 的重复实现，并把同一契约扩到 Harness plan、R/Python 步骤任务与 platform/worker adapter；task result 文件具有 host/canonical 双路径。下一位 agent 不应再创建新的 execution context 实现，应直接扩展 version 1 工厂。

Phase 4 已于 2026-07-13 完成（Core `3fbfe3b`）：`harness-task-packs.mjs` 覆盖 12 类常见分析意图，workflow plan 可在没有 LLM/显式 manifest 时从实际可用插件确定性选择，并对未知请求和缺失工具安全失败。`npm run harness:evaluate` 是后续必须保留的质量门禁；真实历史 DEG artifact 已完成自动选型、参数修复和确认边界验证。

详细规范见：[Harness Engine Spec v1](./harness-engine-spec.md)。  
详细路线图见：[Harness Roadmap v1](./harness-roadmap.md)。

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
