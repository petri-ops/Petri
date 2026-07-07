# BioF3 桌面端 UI 重构计划 — 项目制 + Agent 主导

## 目标

将桌面端从"工具制"改造为"项目制 + Agent 主导"的分析平台。

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

## 原则
- 所有改动在 desktop 仓内，不碰 core/tutorials
- 现有 single-cell 模块代码复用而非重写
- 每个步骤完成后 build + 启动验证
- 保留旧页面路由兼容（渐进式迁移）
