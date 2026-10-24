---
capability: q4a-agent-team
goal: 把子智能体从「一个面板」升级为「一个团队」——团队 roster（leader/member/成员会话）/整体停止（部分确认如实）/暂停恢复/子代理工具约束/结构化输出/journal/专用调查员，且全部可在本地审计。
acceptance:
  - 团队一等：`GET /api/ai/agent/team?taskId=` 返回 leader + 成员（角色/状态/会话/任务头/最近事件/结构化与 journal 可用性）；`POST /api/ai/agent/team/:taskId/stop` 级联停止并逐成员回执（`cancel_requested|already_finished|not_found`），不把部分成功说成全部成功。
  - 暂停/恢复：迭代边界生效（当前工具跑完再停），`agent_status=paused`；暂停中取消可继续收口；恢复继续同一 task；前端按钮与状态如实（"将在当前步骤结束后暂停"）。
  - 工具约束只收紧：profile `tools:{allow?,deny?}`（deny 优先），子代理工具集 = 父可用集 ∩ allow（deny 再剔除）；禁 `spawn_agent` 即禁再派生；未知工具名如实诊断；`omitAgentsMd` 在 Petri **无对应注入面**（N/A，不造空键）。
  - 结构化输出：`spawn_agent({schema})` 校验 schema 形状并注入终态 JSON 要求；子代理终态由服务端按最小 JSON-Schema 子集校验；失败自动 followup 纠正 ≤2 次，仍失败回 `structured_output_invalid` + 错误清单（不伪造）。`list_agents`/`wait_agent` 回 `structured` 机器可读。
  - journal：每次多代理运行一个目录 `<dataDir>/agent-journal/<leaderTaskId>/journal.jsonl`，成员终态一行（血缘/角色/状态/耗时/结果头/结构化有效性）；新只读工具 `read_agent_journal`（有界）→ "诊断前先读 journal" 写在工具描述里。
  - F9：新增 `investigator`（CodebaseInvestigator）角色——只读调查、codegraph_*/文件读取、结论带证据路径；前端角色标签同源。
  - 前端：AgentRunPanel 顶部团队 roster（leader/member、状态、角色、会话、点击切成员、整体停止两步武装 + 逐成员回执、暂停/恢复）。
  - 实机：mock provider 派 3 个子代理 → roster 可见 → 打开成员 → 暂停/恢复 → 停止团队（部分确认回执）→ journal 可读 → 结构化子代理有效；亮/暗各一轮，离屏无窗。
  - 门禁：Node/前端定向 + `npm run closeout` 十三门 + canonical 回写 + 本地提交（不推送）。
status: completed
---

# BLOCK-249 · Q4a：多智能体团队

> **一句话**：把「派出去的子 agent」从聊天流里的几行，升级为可清点、可停下、可暂停、可约束、可机器验结果、可事后诊断的一个**团队**——leader + members + 成员会话 + 运行级 journal，全部本地落盘。

## 0. 交接摘要（换 agent 先读这一节）

- **母纲**：`docs/qoder-essence-absorption-plan.md` §Q4a（C7/C10/F1/F3/F4/F5 + F9）与 §6.5 第 5 行。
- **当前状态**：`completed`。**`npm run closeout` 十三门 PASS**（test:changed 463s + ui:audit 126s + lint 34.9s + types 6.5s + knip 281 键冻结）；Node `block249-team` 7/7；实机亮/暗各 19/20；**UI-559 后由 BLOCK-250 修复重渲染环并回填为亮/暗各 20/20（verified）**。
- **红线**：零新依赖；不建第二套任务/事件真源（团队数据全部从 `tasks`/`task_events` 投影）；工具约束**只收紧**；暂停只在迭代边界生效（不假装能冻结正在跑的工具）；结构化输出校验失败**如实回传**，不伪造；不碰 hook 系统 / Q4b 工作流脚本 / G1+。
- **与母纲的诚实差异**（实现口径，不夸大）：① Petri 没有 `structured_output` 隐藏工具 → 用 spawn 参数 + 终态校验 + followup 重试；② Petri 不做 AGENTS.md 注入 → `omitAgentsMd` 为 N/A（不加空键）；③ 暂停粒度=迭代边界（母纲"若后端支持"）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与判据

| 项 | 判据 |
| --- | --- |
| F1/C10 roster | team API 投影 leader+members；状态/角色/会话/任务头/最近事件；前端点击切成员 |
| C7 停止 | 级联 cancel；逐成员回执（请求/已结束/不存在），部分成功如实 |
| C7 暂停/恢复 | 迭代边界门（不打断进行中工具）；`paused` 状态；取消优先；恢复同一 task |
| F4 工具约束 | profile `tools.allow/deny`（只收紧）；deny 优先；禁 spawn_agent 即禁派生 |
| F3 结构化输出 | schema 形状校验 → 终态校验（子集）→ followup ≤2 → 错误回传；机器可读 |
| F5 journal | 运行级目录 + 每成员一行；只读工具/API 有界读取 |
| F9 调查员 | `investigator` 角色（只读 + codegraph + 证据路径） |
| 非范围 | Q4b 工作流脚本、跨机团队、hook 事件、暂停时冻结工具进程、AGENTS.md 注入 |

## 2. 架构（谁负责什么）

```
core/petri-server/helpers/agent-team.js        ← roster 投影 / 停止回执 / 结构化摘要（只读编排）
core/petri-server/helpers/agent-journal.js     ← journal 落盘与有界读取（每成员一行）
core/petri-server/helpers/json-schema-subset.js← 最小 JSON-Schema 子集校验（零依赖）
core/petri-server/helpers/agent-pause.js       ← 暂停/恢复登记（内存，进程内）
core/petri-server/agent-tools/spawn-agent-tools.js ← schema/tools 参数、终态结构化校验、journal 钩子
core/petri-server/agent-runner.js              ← 迭代边界暂停门 + 子代理工具集过滤
core/petri-server/agent-tools/agent-roles.js   ← investigator 角色
core/petri-server/agent-tools/tool-defs/*.js   ← spawn_agent schema/tools；read_agent_journal
core/petri-server/routes/ai-agent/team.js      ← GET team / POST stop / pause / resume
frontend/src/components/workspace-panels/AgentRunPanel.tsx ← roster + 暂停/恢复 + 停止团队回执
frontend/src/lib/agentTeamClient.ts            ← team API 客户端（类型化）
```

## 3. 阶段与状态

| 阶段 | 状态 | 产出 |
| --- | --- | --- |
| P0 对账 + 立项 | ✅ | 本文件 + 实码对账（spawn/list/wait/profile/panel 现状与缺口） |
| P1 团队 roster + 停止团队 | ✅ | team API（leader/members/counts/journal） + 逐成员回执 + AgentRunPanel roster（5/5） |
| P2 暂停/恢复 | ✅ | 暂停登记 + 迭代边界门 + 端点/事件 + UI（实机 API paused/running） |
| P3 工具约束 | ✅ | profile tools.allow/deny（schema 键）+ 子代理工具集过滤（只收紧）+ 契约测试 |
| P4 结构化输出 | ✅ | schema 子集校验 + 终态校验 + followup ≤2 + `structured` 机器可读（实机有效） |
| P5 journal + 调查员 | ✅ | journal 落盘/读取 + `read_agent_journal` + investigator 角色（实机 3 行） |
| P6 实机 + 收口 | ✅ | 两会话实机亮/暗各 19/20；closeout；回执 UI 缺口由 BLOCK-250 回填（20/20，verified） |

## 4. 实码锚点（接手者可直接查）

- 派生：`core/petri-server/agent-tools/spawn-agent-tools.js:launchSubAgent`（params 落 kind/parentTaskId/role/goals）。
- 子任务查询：`agent-task-store.js:listChildAgentTasks` / `listInFlightPrimaryTasks`；级联取消 `cancelAgentTaskCascade`。
- 循环：`agent-runner.js`（`shouldAbort` 每步检查；`resolveToolDefsForContext(context, getToolDefs())` 取工具集）。
- profile：`helpers/subagent-profile.js` + `shared-config/config-schema.js` 的 `subagent-profile` 族（未知键 fail-closed）。
- 角色：`agent-tools/agent-roles.js`（key/label/description/directive）。
- 面板：`AgentRunPanel.tsx`（SSE 时间线 + 中断/留言/续派）；`subAgentTasks.ts`（实时子任务快照）。
- 事件：`appendAgentTaskEvent`（task_events）已具备；journal 是**运行级文件**旁路，不是第二事件源。

## 5. P0 对账（已有 vs 缺口）

| 母纲项 | 实码现状 | 处置 |
| --- | --- | --- |
| F1 roster | 有 `list_agents`/DAG/AgentRunPanel 单成员；无团队视图/整体停止 | **新建 team API + roster UI** |
| C10 团队活动 | 无 | roster 带最后事件时间/会话；成员可切换 |
| C7 停止 | `cancelAgentTaskCascade` 存在，前端单成员中断 | **整体停止 + 逐成员回执** |
| C7 暂停 | 无（只有取消） | **新建迭代边界暂停门** |
| F3 结构化输出 | 无 | **新建** |
| F4 工具约束 | profile 只有 role/model/concurrency/reportGuard | **扩 tools.allow/deny + 过滤** |
| F5 journal | 有 task_events；无运行级 journal | **新建文件 + 工具** |
| F9 调查员 | 无同名角色；有 codegraph_* | **新增角色预设** |

## 6. 验收（结果）

- Node：`test/block249-team.test.mjs` **7/7**（schema 子集/工具过滤/暂停登记/journal/团队投影与停止回执/存储暂停与合成事件/结构化评估）+ 工具计数回归（84 工具）全绿。
- 前端定向 **18/18**：AgentTeamRoster 5（roster/两步停止/回执/暂停恢复/空态）、AgentRunPanel 5、agentCategories 8。
- 实机（隔离 9223，mock provider，**离屏**，**两会话**）：首轮 **亮 19/20 · 暗 19/20**（`acceptance/ui-559/`、`acceptance/block-249/`）。会话 1 验证：3 子代理（roles search/investigator/search）→ 结构化有效 → 暂停/恢复（API `paused`/`running`，`effective=iteration_boundary`）→ 停止团队部分回执（`requested=1 / alreadyFinished=2`）→ journal 3 行；会话 2（重启 Electron，同数据根）验证：roster 可见/3 成员/调查员标签/结构化徽标/journal 徽标。**BLOCK-250 修复重渲染环后复跑：亮/暗各 20/20，含停止回执 DOM。**
- **原唯一未取证格（已补齐）**：UI「停止团队」两步点击后的**回执 DOM** 曾被既有 ProjectWorkspace 重渲染环拖到 CDP 20s 超时。BLOCK-250 定位并修复该环（探针 0 警告）后复跑，回执 DOM 实机可见（`停止回执：已请求 0 · 本就已结束 3 · 未取消 0` + 三行成员 outcome），UI-559 `verified`。
- 截图：离屏窗口 `Page.captureScreenshot` 等不到合成帧 → 如实记 `unavailable`（`ui559-screenshots-{light,dark}.json`），不开窗换证据。
- 门禁：`npm run closeout` 十三门 **PASS**（test:changed 463s + ui:audit 126s + lint 0 error + types 0 + knip 281 键冻结 + `skills:check` 报告级 OK）+ canonical 回写 + 本地提交（不推送）。

## 7. 非范围与诚实边界

- **暂停不冻结进行中的工具**：只在迭代边界生效；按钮文案如实写"将在当前步骤结束后暂停"。
- **结构化输出不是模型侧强制**：靠终态校验 + 纠正重试；重试耗尽如实失败，不拿最后一次原文冒充结构化。
- **`omitAgentsMd` N/A**：Petri 的系统提示不注入 AGENTS.md；不新增无行为键。
- **团队不跨机/不跨会话聚合**：roster 只覆盖当前 leader 的 children。
- **journal 不替代 task_events**：它是"每个成员最终返回值 + 血缘"的诊断摘要，事件真相仍在 `task_events`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
