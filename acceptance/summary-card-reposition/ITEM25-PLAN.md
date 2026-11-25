# item 25 摘要卡片定位改版方案（仅方案 + 视觉稿 · 不动实现）

> 来源：Orca bb8dddaf dispatch msg_028c645b6bd0 第四项（owner 拍板定位：运行监控为第一主角；资产总览类折叠为次级抽屉）。
> done-means：**只出逐节改版方案 + 视觉稿，owner 过目后才动实现**。观感零代签。
> 视觉稿：`./SUMMARY-CARD-REPOSITION.html`（单文件，浏览器打开，左=现状 / 右=改版）。

## §1 核码真源（C-32/C-43 先核真源）

- 卡片组件：`frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx`（1026 行），两种呈现形态（悬浮 `workspaceSummaryFloat` / 右轨钉住列 `workspaceSummaryColumn`），均由 `CenterPanel.tsx` 渲染同一 `WorkspaceSummaryCard`（去重已成立）。
- 现节序（aria-label）：需要关注 → 任务概览 → 任务循环 → 任务进度 → 智能体 → 最近分析 → 项目信息 → 运行环境；另有 `WorkspaceTodoSection`（任务进度内）、`WorkspaceCitationsSection`（知识溯源）、会话/数据集概览在 `expanded` 后呈现。
- 现有「运行监控」信号已分散在前四节（jobStats / currentJob / liveJobs / workflow），但被资产类节（最近分析/项目信息/数据集/溯源）穿插稀释。

## §2 逐节改版方案（两态分层）

### 主层（默认常显，第一主角 = 运行监控）
1. **运行态横幅**（原任务概览升级）：当前任务状态 + 运行/等待/失败计数 + 最近失败直达，置顶常显。
2. **需要关注**（保留，紧随横幅）：失败任务、待审批、持久通知——仍需即时可见。
3. **实时任务**（原「任务概览」的 live jobs + 「任务循环」合并）：运行中/等待中的后台任务条，状态点 + 名称 + 位置 + 时间。
4. **任务进度 / 智能体**（保留，按运行态相关优先）：工作流进度、智能体任务——属运行监控范畴。

### 次级抽屉（默认折叠，资产总览类）
5. **会话与数据**（抽屉「资产」）：会话列表、数据集/字节、项目信息（workspaceKind/sshHost/基线）。
6. **最近分析**（抽屉）：历史结果直达。
7. **知识溯源**（抽屉）：本轮 citations。
8. **运行环境**（抽屉）：后端状态 / R-Python 芯片 / 终端会话 / 资源快照。

### 交互与取值
- 抽屉为 `<details>`/分区折叠，默认收起；展开态记忆沿用现有偏好层（不新造）。
- 两形态（悬浮/右轨）同构：同一组件内部两态分层，不复制两套 JSX。
- 零新数据源：全部字段来自现有 props（jobStats/recentJobs/liveJobsPreview/workflow/loop/todoList/citations/datasets/project/backendStatus），只改分组与呈现顺序。
- 无障碍：抽屉 `<summary>` 可键盘展开，aria-label 沿用现节名；「无内容不渲染」纪律保留。

## §3 不做（本阶段边界）

- 不改任何产品代码 / 测试 / 台账状态；不翻 UI 台账 verified；观感零代签。
- 不改运行监控的取数语义、不改心跳节拍、不改卡片拖宽/定位偏好。
- 不动 G1+ 打包/Provider/GA；owner dev 实例零触碰。

## §4 owner 过目要点

1. 主层四节是否够「运行监控第一主角」，次级折叠边界（资产 vs 运行）是否认同。
2. 两形态同构是否可接受（悬浮/右轨共用一套分层）。
3. 视觉稿的层级密度与留白是否合口味（文字少、收敛不占空间）。

过目通过后再发实现令，届时另立 HK-01 红测与定向验收。

## §5 实现结果（2026-11-25 · owner 过目视觉稿后批「合适就冲」）

- 按视觉稿 + §2 实现：`WorkspaceSummaryCard.tsx` 把资产类节（项目信息含会话/数据、最近分析、知识溯源 citations、运行环境）归并进**单一** `<details aria-label="资产总览">`（默认收起，summary 键盘可展开）；主层保留运行监控四节（需要关注 / 任务概览 / 实时任务+任务循环 / 任务进度+智能体，todo 留主层）。
- 两形态（float/column）本就由同一组件渲染，分层在组件内完成，零 JSX 复制；宽度仍是可调 prop（`style width`），未写死 420px（视觉稿仅示意）；零新数据源、心跳节拍/取数语义未改；运行环境节补 `aria-label="运行环境"` 沿用标题名（无障碍，非观感）。
- HK-01（追加到 WorkspaceSummaryCard.test.tsx）：主层常显不在抽屉、资产抽屉默认收起+键盘展开、两形态同构、无内容不渲染——红 2→绿；卡片 23/23 + CenterPanel/nso-a11y 11/11 + ChannelPreference 6/6；types/lint 0 error；test-affected/W5a 24/24。
- HMR 只读核对：Vite 已服务含「资产总览」新源；owner 3000/3001/9222 进程未 kill/未重启（PID 37503/37533/37670 仍在）。观感零代签（主人自己看 HMR）。
