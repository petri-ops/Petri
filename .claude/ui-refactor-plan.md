# BioF3 桌面端 UI 重构计划 — 项目制 + Agent 主导

> 方向标准：后续工作台、Agent、插件、结果查看、可复现链路相关改造，均以 `docs/codex-style-workbench-direction.md` 为产品和工程准则。

## 工作方式

- 先读代码现状，再写小步 plan，再实现。
- 小 bug 可以直接修；涉及工作台交互、Agent 行为、conversation、job/artifact、插件调用、结果查看器的改动必须先有计划和验收标准。
- 不推翻原云平台页面；`/project/:projectId` 是新的 Codex 式主工作台，旧页面继续作为专业功能区存在。
- Agent 只做意图理解、插件选择、参数填写、流程编排、结果解释；正式分析必须落到固定插件、标准 workflow 或受控执行器。
- 每次分析必须可追溯：projectId、toolId、插件版本、参数、输入、输出、日志、artifact。

## 目标

将桌面端从"工具制"改造为"项目制 + Agent 主导"的分析平台。

升级后的产品形态：

> Codex 式工作台交互 + BioF3 固定插件/标准 workflow + 项目级可复现记录。

## 三栏布局

```
左栏：资源管理（项目切换 / 文件树 / 数据集 / 存储）
中栏：主视图（结果展示）+ 底部 Agent 对话框
右栏：分析历史 + 内置工具 + 插件
```

## 实施步骤

### Phase 1：全局 Project 模型 ✅
- [x] 1.1 复用 single-cell 的 Project 结构，提升为全局模型 → `lib/project-types.ts` + `lib/project-store.ts`
- [x] 1.2 Tools 的 Job 加 projectId 关联 → `db.js` ALTER TABLE + prepared statements + `tools-executor.js`
- [x] 1.3 后端 API 支持跨模块的项目查询 → `api-data.js` GET `/projects/:id/jobs` + `tools-metadata.js` `/api/tools/history?project_id=`

### Phase 2：首页 Dashboard 改造 ✅
- [x] 2.1 首页改为项目列表（卡片视图）→ `_desktop-dashboard.tsx` 新增"我的项目" section
- [x] 2.2 项目卡片：名称 / 描述 / modality → 复用 toolCard 样式
- [ ] 2.3 最近活动时间线（待 Phase 5 结果查看器就绪后补充）
- [x] 2.4 新建项目入口 → 弹窗 + `createProject()` → 跳转 `/project/:id`

### Phase 3：Workspace 三栏骨架 ✅
- [x] 3.1 项目内路由 /project/:projectId → `App.tsx` 新增 Route + `project-workspace.tsx`
- [x] 3.2 三栏布局组件（可折叠左右栏）→ header + leftCol + centerCol + rightCol
- [x] 3.3 中栏上下分区（结果区 flex:1 + Agent 固定底部）→ agentBar 280px + 可折叠

### Phase 4：左栏资源管理 ✅
- [x] 4.1 Tab 切换（数据集 / 文件 / 信息）→ ResourcePanel 内置 tabBar
- [x] 4.2 文件树组件（递归展开/折叠，点击文件新窗口预览）→ `FileTreeList` + 后端 `/api/files-tree`
- [x] 4.3 数据集列表 → 复用 `listDatasetsByProject`
- [x] 4.4 存储用量指示器 → 后端 `/api/storage-usage` + `local-storage.js` `dirSize()`
- [ ] 4.5 项目切换下拉（待多项目快速切换需求确认后补充）

### Phase 5：中栏结果展示 ✅
- [x] 5.1 统一结果查看组件 `ResultView` → 图表/数据文件双 Tab
- [x] 5.2 图片预览 + Lightbox 大图 → 复用 `Lightbox` 组件
- [x] 5.3 CSV 文件预览（前 20 行表格）→ `previewCsv()`
- [x] 5.4 运行中/失败/完成三态展示 → spinner + error + result
- [x] 5.5 下载按钮 → 直接链接 `/api/tools/result/:jobId/:file`

### Phase 6：Agent 对话框移入中栏底部 ✅
- [x] 6.1 CopilotChat 从浮窗改为中栏底部固定 → 添加 `embedded` 属性，跳过 FAB/浮窗包装，渲染精简容器
- [x] 6.2 可折叠（agentBar 折叠/展开）+ 嵌入式样式（`cp-embedded` CSS 系列）
- [ ] 6.3 注入项目上下文（数据集/分析历史/当前状态）
- [ ] 6.4 参数确认卡片内嵌对话流

### Phase 7：右栏分析历史 + 工具箱 ✅
- [x] 7.1 分析历史时间线（状态图标 + 依赖关系）→ HistoryPanel 已在 Phase 3 完成
- [x] 7.2 内置工具列表（点击发到 Agent）→ ToolboxPanel：搜索 + 分类筛选 + 点击触发 `biof3:copilot-ask` 事件
- [ ] 7.3 插件列表（待插件系统设计后补充）

### Phase 8：Agent 工作流编排 ✅
- [x] 8.1 分析链路推荐（标准分析 → DEG → 富集）→ `lib/workflow-chains.ts` 定义 CHAINS 数组 + `ChainRecommendations` 组件在 ResultView 底部展示
- [x] 8.2 自动参数填充 → `resolveParamMap()` 从上一步结果文件 URL 自动映射到下一步参数
- [x] 8.3 运行进度实时展示 → Phase 5 已完成（running spinner + done/error 三态）
- [x] 8.4 结果出来后主动提示下一步 → `job.status === 'done'` 时渲染推荐卡片，点击发送给 Agent

## 下一阶段：Codex 式闭环增强

### Phase 9：项目级 Copilot 对话隔离
- [x] 9.1 conversation schema 增加 `project_id`（SQLite + PostgreSQL 路径）→ SQLite 幂等迁移 + PG `014_copilot_conversations_project.sql`
- [x] 9.2 `/api/ai/conversations` list/create 支持 `project_id`
- [x] 9.3 `getOrCreateActiveConversation()` 支持项目维度，避免跨项目复用最近对话
- [x] 9.4 `CopilotChat` / `SimpleChat` 在 `/project/:projectId` 内按当前项目加载/创建 conversation
- [x] 9.5 切换项目时切换 active conversation，并避免使用其他项目的 stale conversation id
- [x] 9.6 保留非项目页面的全局 Copilot 行为

验收：进入不同项目时，聊天历史互不混淆；回到同一项目能继续该项目对话。

### Phase 10：聊天区结果卡片
- [x] 10.1 定义 chat result card / artifact link 的消息 meta 结构（当前为 `SimpleMessage.resultCards`）
- [x] 10.2 工具 job 完成后，透传 jobId、projectId、toolId，并在当前 assistant 消息生成 result card
- [x] 10.3 Copilot 消息渲染结果卡片：查看结果 / 继续下一步
- [x] 10.4 对话历史恢复后，结果卡片仍可点击（`meta.resultCards` 持久化 + SimpleChat 恢复）
- [x] 10.5 失败 job 渲染失败卡片，展示错误和可恢复动作

验收：Agent 完成分析后，聊天中出现可点击结果卡片，而不是让用户自己去文件树找结果。

### Phase 11：右侧 Artifact 查看器联动
- [x] 11.1 在 `ProjectWorkspace` 建立统一 artifact/result selection state（`activeJobId` + `activeArtifact`）
- [x] 11.2 聊天结果卡片点击后，右侧自动切到结果 tab 并打开对应 job/artifact
- [x] 11.3 右侧选择结果后更新 Copilot context：activeJobId、activeArtifact、当前文件/图表
- [x] 11.4 结果查看器支持图片、CSV/TSV、日志、参数 JSON、下载
- [x] 11.5 支持“解释当前结果”这类 prompt 自动带上当前结果上下文

验收：聊天区和右侧结果区像 Codex 一样同步；用户点击结果链接即可查看产物，并能继续追问。

### Phase 12：可复现执行与参数确认完善
- [x] 12.1 参数确认卡片展示工具名、输入、输出、参数表单、风险/耗时提示
- [x] 12.2 用户确认后的最终参数写入 job（确认后的 pending job 复用为实际执行 job）
- [x] 12.3 job 详情展示 toolId、params、outputs、logs（插件版本待 Phase 13 schema 标准化）
- [x] 12.4 重操作必须经过确认；取消后不提交执行，并将确认 job 标记失败/取消原因
- [x] 12.5 失败状态给出原因和可恢复建议

验收：Agent 可以流畅执行分析，但所有正式分析都有明确参数、版本、输入输出和日志记录。

### Phase 13：插件 / Artifact Schema 标准化
- [x] 13.1 统一插件注册信息：id、版本、modality、输入 schema、参数 schema、输出 schema
- [x] 13.2 统一 artifact schema：type、title、path/url、preview、metadata（`artifactSchemaVersion: 1`）
- [x] 13.3 Agent 只能通过注册插件 / workflow 调用正式分析能力（`run_tool` 暴露注册工具与 outputSchema）
- [x] 13.4 新插件接入后无需重做页面，即可被 Agent、job、artifact viewer 识别（结果面板优先消费 `artifacts`，兼容旧 `files`）
- [x] 13.5 标准 workflow 支持下一步推荐和自动参数映射（ChainRecommendations 读取标准 artifacts）

验收：后期主要功能迭代可以落在插件生态，而不是反复重做 UI 页面。

### Phase 14：项目工作路径与工作台状态
- [x] 14.1 `projects` 增加 `workspace_path`（SQLite 幂等迁移 + PG `015_projects_workspace_path.sql`）
- [x] 14.2 新项目默认创建 `~/Documents/BioF3-Local/projects/<project>-<shortId>`，旧项目读取时自动补齐
- [x] 14.3 `/api/data/projects` create/update 返回并允许更新工作路径
- [x] 14.4 Electron preload 暴露受限目录能力：选择目录、打开目录
- [x] 14.5 项目工作台顶部显示 Workspace path，可一键打开或更改
- [x] 14.6 右侧文件树切换为读取项目 workspace root
- [ ] 14.7 工具运行目录收敛到托管运行区：优先 `<workspace>/.biof3/runs/<jobId>`，工作目录只作为用户文件根；如目录只读则 fallback 到 `BioF3-Local/project-runs/<projectId>/runs/<jobId>`

验收：进入项目后，用户能明确看到 BioF3 正在使用哪个本地工作目录；后续文件树、运行记录、结果追溯都围绕该目录展开。

## 原则
- 所有改动在 desktop 仓内，不碰 core/tutorials
- 现有 single-cell 模块代码复用而非重写
- 每个步骤完成后 build + 启动验证
- 保留旧页面路由兼容（渐进式迁移）
- 工作台改造以 `docs/codex-style-workbench-direction.md` 为准，优先完成一个可验证闭环，再扩展更多插件能力
- 桌面端不允许普通 `Cmd/Ctrl+R` 触发 Electron 硬刷新；刷新必须优先走应用内 soft refresh，避免 renderer 重载导致 SSE、任务状态、后端连接体感断开
