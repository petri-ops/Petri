# Petri 能做什么（能力地图）

> **自动生成，勿手改**。生成器 `scripts/block357-capability-map.mjs`；
> 数据源 `acceptance/functional-audit-2026-11-04/surface-matrix.json`（`scripts/functional-surface-audit.mjs` 产出）。
> 矩阵生成时间：2026-11-09T11:35:16.793Z；覆盖 115 个工具、168 个 IPC 通道、285 个路由端点。

## 边界（先读这一段）

- 本图只描述 **G0 开发期 dev Electron 边界内** 已实现且可达的能力。
- **不外推** packaged 发布态、真实 Provider 矩阵、对外服务能力；这些内容不在本图范围内。
- 「可达」= 有定义、有契约、有 handler、有调度元数据，且在访问档矩阵中至少一档放行。
- 工具是否真的适合某个具体任务，取决于模型判断；本图不承诺任务成功率。

## 能力域

| 域 | 能做什么 | 工具数 | 可达 |
| --- | --- | ---: | ---: |
| `agent-orchestration` | 任务编排与子智能体 | 10 | 10/10 |
| `browser` | 浏览器操作 | 10 | 10/10 |
| `computer` | 电脑使用（桌面控制） | 9 | 9/9 |
| `godot` | 游戏引擎桥 | 2 | 2/2 |
| `knowledge` | 知识空间与检索 | 15 | 15/15 |
| `model3d` | 3D 模型与编辑 | 12 | 12/12 |
| `remote` | 远程执行目标 | 2 | 2/2 |
| `resident` | 常驻任务 | 3 | 3/3 |
| `result-studio` | 结果面与批注 | 18 | 18/18 |
| `session` | 会话与上下文 | 14 | 14/14 |
| `skill` | 技能 | 3 | 3/3 |
| `svg` | SVG 编辑器 | 2 | 2/2 |
| `web` | 联网检索与抓取 | 2 | 2/2 |
| `workflow` | 工作流 | 1 | 1/1 |
| `workspace` | 工作区文件与终端 | 8 | 8/8 |
| `worktree` | 工作树（Git worktree） | 4 | 4/4 |

## 使用条件

| 条件 | 说明 |
| --- | --- |
| 访问档 | `read` / `workspace-write` / `full`；写与执行类工具按契约的 sideEffect 受档位约束 |
| 用户审批 | 控制类与破坏性操作走两段式确认（needApproval + ackToken），前端确认卡批准后执行 |
| 平台 | 电脑使用分 macOS / Windows 两套实现；Linux 不在本阶段范围 |
| 外部资源 | 部分分析插件需要运行时 capability bundle；缺失时如实降级并给出指引 |

## 当前已知限制（来自矩阵）

- 功能面矩阵判定：**P1=0 / P2=0 / P3=2**（P1/P2 为阻断级，归零后才可宣称能力面自洽）。
- P3 `storage_read_never_written` · petri_token：3 处：getItem@frontend/src/components/copilot/copilotClient/apiBase.ts , getItem@frontend/src/components/copilot/copilotCo
- P3 `storage_read_never_written` · petri.simplechat.extraRenderers：1 处：getItem@frontend/src/components/copilot/extraRenderers.tsx

## 怎么查更细

- 逐工具契约与可达性：`docs/functional-surface-matrix-2026-11-04.md`（脚本生成）
- 项目整体评估：`docs/Petri-Desktop-Evaluation-Report-2026-11-05.md`
- 下一阶段任务：`docs/next-tasks-2026-11-05.md`

*由 `npm run quality:surface` 的矩阵刷新后，重跑本生成器即可更新；产物确定性，可比对。*
