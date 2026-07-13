# Project Workspace Continuation Prompt

这是 BioF3 `project-workspace` 的历史 UI 检查点，不再作为当前开发提示词。工作台 UI 与 Harness Phase 1–6 已收口；当前任务、远端检查点和执行顺序以 [`project-workspace-handoff.md`](./project-workspace-handoff.md) 为准。

## 已完成

- 已移除跨左中右三栏的顶层导航条，三个区域可以各自置顶。
- 已将工作区入口改成项目维度：
  - 新建项目时可选择工作目录。
  - 修改工作目录仍保留在当前项目上下文里。
- 已收敛会话区域的多余卡片层级，整体更接近 Codex 的扁平布局。
- 已将聊天输入区固定在会话底部结构中，开始向 Codex 底部 composer 靠拢。
- 已加入右侧栏的终端 / 浏览器 / 侧边聊天入口，并能切换工作面板。
- 已进一步收紧会话摘要卡与右侧抽屉的视觉密度，减少厚边框和重阴影。
- 已把右侧空态做成更轻的 Codex-like 启动区，四个入口更突出。
- 已把右侧标签改成更接近 Codex 的轻量分段按钮，并带文字标签。
- 已把摘要卡收起态改成顶部信息条，避免再出现孤立的浮动图标。
- 已把摘要开关按钮嵌回会话区域顶层条，不再单独漂浮在内容区。
- 已把摘要卡缩放手柄挪到左下角，并修正为对应方向的拖拽逻辑。
- 已把会话顶栏压薄，减少顶部占位，向 Codex 的轻量 header 靠拢。

## 当前状态

- 这里记录的 UI 工作已经完成或冻结，不再作为主动开发清单。
- 只有阻断 Agent 工作区、结果数据错误或明确回归时才修改前端。
- 当前主线是标准流程覆盖 Phase 1：以 GO/KEGG 富集作为首个真实 Plugin SDK 接入试点。

## 下一步

1. 确认 Core `dcd2043`、Desktop `2d000d5` 和 `.vendor-lock` 一致。
2. 盘点现有 `go-kegg.R`、enrichment task pack、manifest 和 DEG artifact。
3. 补齐插件契约与 fixture，跑通 Agent 单步执行、artifact truth 和 lineage。
4. 完整执行 Harness/Agent/adapter 门禁；不得为单个流程增加平台特例。

## 约束

- 不要恢复顶层横跨三栏的导航条。
- 工作区入口只应保留在项目维度，不要再放回全局栏。
- 不要增加多余卡片层级，整体要更接近 Codex 的扁平布局。
- 每次改动尽量只碰当前布局相关文件。
