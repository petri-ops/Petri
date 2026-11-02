---
capability: block-336-worktree-infrastructure
status: planned
goal: worktree 通用基础设施 v1（用户裁决 2026-11-02「加 全方位的加」）：把 docs/worktree-governance.md 八节纪律从休眠文档变成机械可用的产品能力——agent 工具面（create/list/status/remove/merge-request 四档权限管）、项目层（worktreeOf 声明式副本，workspace_path 自动指向）、契约机械化（一树一分支一包 + 环境隔离端口约定）、治理留痕（生命周期全审计）。消费者：BLOCK-335 自优化闭环（第一个用户）、并行多任务、大胆实验副本、用户"试试看"。
acceptance:
  - P1 工具面四件：workspace_worktree_create（源仓+分支+路径约定，四档权限+审批+observe 档可用）/ list（含 ahead/behind/脏树状态）/ remove（干净树才可删，脏树 fail-closed 报明）/ merge_request（不自动 merge——生成改动摘要+diff 引用，合并动作留人工）。契约测红绿（含 .git 敏感段/越界/symlink 复用既有守卫）。
  - P2 项目层：createProject/updateProject 接受 worktreeOf:<projectId>（校验源仓是 git 仓、自动 git worktree add、workspace_path 指向副本、约定目录 <dataDir>/worktrees/<projectId>）；删除项目联动清理副本（脏树需显式确认）。REST + 契约测。
  - P3 契约机械化：governance §4 一一对应（一树一分支一 Agent 一包）+ §5 环境隔离（副本端口约定：PETRI_WORKTREE_PORT_BASE 偏移派生）做成 `helpers/worktree-contract.js` 纯函数 + 校验测试；生命周期事件（create/remove/merge-request）落 task_events + 审计 jsonl。
  - P4 实机腿：隔离后端全链——建副本→agent 在副本内改文件→list 显示脏树→merge_request 出摘要→清理；worktree-governance §3～§8 逐节对账表（每节=已实现/未实现如实）。证据 acceptance/block-336/。
  - P5 治理回写：worktree-governance.md 状态从休眠转"基础设施就绪（v1），按 §3～§8 正式流程使用"；335 plan 的撞裁决点①关闭（指向 336 交付物）。
reopen: 多副本并发写同一主仓的合并队列（v1 单副本串行）；worktree 内跑完整后端实例（v1 只约定端口，不做自动装配）；远端分支推送策略。
---

# BLOCK-336-WORKTREE-INFRASTRUCTURE — worktree 通用基础设施 v1 计划

- 立项裁决：用户 2026-11-02「加 全方位的加」（承接同日问答确认"有纪律无基础设施"——治理八节在、工具面为零）
- 登记状态：**planned**（与 335 同队列；建议顺序 336 → 334 收口 → 335 直接消费 336）
- 唯一真相域：本文件（block-336-worktree-infrastructure）
- 文件面隔离：agent-tools git 域、db.js 项目层、新 helpers/worktree-contract.js、routes 项目路由；与 334（前端结果面）/335（workflow+checkpoint）零交叠。

## 1. 定位（立项自检问句）

ZCode/Codex 的 agent 没有面向 agent 的 worktree 能力（人手工 git 操作）；Petri 把治理纪律（governance 八节）做成 agent 可用、机械校验、全程审计的产品能力——本地可审计的并行安全面。不做哲学：每一节纪律直接翻译成一个校验函数或一个工具参数。

## 2. 与 governance 八节的对账（每一节 → 本包动作）

| § | 纪律 | 本包动作 |
| --- | --- | --- |
| §3 适用标准 | 重开条件成立才用 | 用户 2026-11-02 裁决即重开点；基础设施就绪后 335 触发首次使用 |
| §4 一一对应契约 | 一 worktree 一分支一 Agent owner 一 bounded 包 | `worktree-contract.js` 纯函数 + 注册表（`<dataDir>/worktrees/registry.json`）机械校验 |
| §5 环境隔离 | 端口/userData/SQLite/产物/日志隔离 | 端口偏移约定（PETRI_WORKTREE_PORT_BASE 派生）进契约函数；其余随消费者（335）落地 |
| §6 同步与合并 | 经 git 提交或评审补丁流，绝不目录拷贝合并 | merge_request 工具只出摘要+diff，合并动作=人工 |
| §7 保留与移除 | commit/快照→合并或显式保留→干净状态→Artifact 检查后移除 | remove 工具四步前置校验，脏树 fail-closed |
| §8 集中管理 | 登记表 | registry.json 单源（谁创建/何时/分支/状态/包） |

## 3. 红线

- 不自动 merge、不自动删脏树、不绕四档权限；worktree 操作全部走审批通道（observe 档首批可用）。
- 不碰 `.git` 对象库内容（既有敏感段守卫不动）；registry.json 是唯一登记源（不建第二台账）。
- 消费顺序：336 交付前 335 不得开工（335 的隔离方案直接消费 336 的项目层声明）。
- G1+ 不外推。

## 4. 体量与顺序

2–3 天；P1→P2→P3→P4→P5 串行；与 334 零交叠可并行开（若接手 Agent 在制则排其后）；335 依赖 P2。
