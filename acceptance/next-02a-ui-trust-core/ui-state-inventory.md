# NEXT-02A UI state inventory（P0-1 / P2-2 基线）

日期：2026-10-29  
范围：执行 / 证据 / 能力三轴的现有落点、长内容边界与残留；不是资格声明。

## 高频面盘点

| 工作面 | 现有状态来源 | 本包处置 | 证据 |
| --- | --- | --- | --- |
| 聊天工具行 / 子智能体行 | `activity.status`、`subSnap.status`（running/awaiting/success/error/denied/stopped） | 统一经 execution 投影；保留“等待确认/已拒绝/已停止”原始词 | ToolActivityList 30/30 |
| 执行轨迹 | task.status（running/done/failed/cancelled/retry_pending） | execution 徽标；未知状态不伪装；读取 15s 超时 | TraceSurface 6/6 + timeout 2/2 |
| 证据面 | truthStatus + jobStatus | execution/evidence 分轴；核验范围 detail 保留 | EvidenceSurface 4/4 |
| 结果库 | ToolJob.status | execution 投影，树形 `data-status` 保留兼容 | ResultsLibrary 邻域 |
| 项目运行摘要 | workflow.jobStatus / activeJob.status | 统一标签；workflow cancelled 不再误映射为 failed | WorkspaceSummaryCard 19/19 |
| 指挥中心瓦片 | ToolJob.status | execution 投影；真实 16 作业墙显示 12 条上限 | live 8/8 |
| 空/载/错 | 既有 EmptyState/ErrorNotice/LoadingBlock | 未重写；本包只补三轴状态，避免第二套状态组件 | 既有 controls 测试 |

## 长内容基线

- 会话首次加载按 200 条分页，older 仅手动加载；消息行 memo 化，未在本包引入通用虚拟化。
- 轨迹单页 200、内存上限 2000 事件；读取有 15s 超时。
- 工具输出默认折叠；展开态有既有高度/输出边界。
- 指挥中心最多渲染 12 瓦片（活跃优先），实机以 16 个作业验证有界 + 2 活跃 / 10 历史。

## 残留与归口

- 计划、目标、变更集等领域生命周期词表仍各自拥有业务含义，不并入执行轴；若需统一，在 NEXT-02B 逐面映射。
- 8 条既有 UI `in_progress` 需要按证据/环境/用户过目分类，不能因本包通过批量翻绿。
- 隐藏 Electron 窗口截图仍不可得；本包以几何、属性与真实 DOM 文本为证据，截图标 unavailable。
- 实机首跑曾命中 Vite Windows watcher 未失效旧 transform（浏览器仍执行已删除 `STATUS_LABEL`）；`touch` + 重新加载后源码/变换一致，实机 8/8。该现象是环境取证纪律，不是产品通过。
