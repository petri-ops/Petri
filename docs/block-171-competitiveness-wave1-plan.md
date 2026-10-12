---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W1 波「交互主权与信任可见化」——CP-1 停止与取消全线贯通 / CP-2 确认弹卡与审批中心 / CP-3 CommandPalette 真命令源 / CP-4 队列与 steer 可视化；四包全交付后主聊天恢复 run 控制权、治理从暗债变招牌、命令中枢真实可用
acceptance:
  - CP-1：流式中 Stop 可停且会话状态一致（契约+组件测）；≥3 个长任务工具族取消实机留痕（spawn_wait/run_tool job/文件搜索，取消事件入 task_events）
  - CP-2：require-ack 触发→聊天流确认卡→ack 放行全链实机；审批历史可复审（面板）
  - CP-3：Cmd+K 可执行命令 ≥15 条（5 类源）+ recentConversations 接线实机
  - CP-4：排队条目可见可撤销+steer 状态持续可见实机
  - closeout 十二门绿 + 总纲 §4 W1 行回写
reopen: 任一 CP 出口断言未达即该 CP 返工；产品语义争议回用户（波内零停顿条款覆盖非破坏性形态决策）
status: active
---

# BLOCK-171 — 竞争力总纲 W1 波（交互主权与信任可见化）

## 0. 来源与授权

- 总纲：[`agent-competitiveness-program.md`](./agent-competitiveness-program.md) §4-W1（CP-1/2/3/4）。
- 用户发令（2026-10-12，/goal 原话）：「按照波次 逐个推进 能自己判断就自己判断 不需要问我 相信你的能力和水准」= **整波授权 + 波内零停顿条款行使**（blueprint §3.4 先例）：立项检查单照走、CP 间不逐个等发令、非破坏性形态决策由主代理按「最小改动 + 与既有形态一致 + 可逆」缺省先行，波报集中复认；硬依赖顺序、实机验证窗口、波末出口判据不属停顿。
- 专项推翻登记：CP-1 Stop 按钮复出**推翻 BLOCK-28.8「移除排队/停止生成按钮」**——依据=用户本次整波授权采纳总纲 CP-1（当时移除语境已变：steering/队列/取消机制 169 批后已齐，恢复控制权是本轮主题）。
- 并行隔离：并行会话若在制，文件面=backend agent 域（core/petri-server agent-tools/routes）+frontend copilot 域，承诺零触碰其他包面；台账共享面追加式。

## 1. 范围（四 CP 串行，红绿先行）

### CP-1 停止与取消全线贯通

- **A 主聊天 Stop 复出**：SimpleChat 流式期间常驻 Stop 键（接 `useChatStream` 既有 `stop()` 能力，BLOCK-28.8 只删了 UI）；停止后 run 终态=既有取消语义，会话状态一致（无半截流悬挂）。
- **B 工具级取消三族**（起步族，总纲 §2-D6）：
  1. spawn/wait 族：复用既有 `interrupt_agent` 级联取消语义；
  2. run_tool job 族：复用既有 owner REST 取消（BLOCK-128 SIGTERM 链）；
  3. 文件搜索族：新增 AbortSignal 贯通（contract `cancellable: true` + cancellation registry + handler 信号检查）。
- **C 取消留痕**：取消动作写 `tool_cancel` 类事件入 task_events（可审计取消=自有形态）。
- 出口：A 契约+组件测；B ≥3 族取消实机留痕（acceptance/block-171/）。

### CP-2 确认弹卡与审批中心

- 聊天流确认卡：dynamicGuard require-ack 触发 → 卡片（放行一次/拒绝/本会话总是放行）→ 既有 `ctx.dynamicGuardAcks` 通道生效 → 模型重试工具；卡样式走设计宪章+controls 单源。
- 审批复审面板：审批历史（task_events 聚合：谁/何时/什么 guard/用户裁定）挂设置面决策域（DecisionConfigPanel 旁）。
- 出口：全链实机（真渠道触发 guard→卡→ack→工具放行）；历史面板实机。

### CP-3 CommandPalette 真命令源

- 命令源五类 ≥15 条：导航（projects/knowledge/extensions/settings/review/指挥中心）、项目（打开工作区/新建）、会话（最近 N 条接线 recentConversations）、技能（skill discover 命令）、设置深链（模型接口/Agent 规则/用量/决策原语/记忆）。
- 出口：Cmd+K 执行 5 类命令实机（组件测试+CDP）。

### CP-4 队列与 steer 可视化

- 排队条目 chips（发送但未 drain 的 queued 消息）：可见+可撤销（本地移除）+位次；steer 已转向状态从一次性行内提示升级为持续可见状态行。
- 出口：实机走查（排 2 条撤 1 条、steer 状态持续显示）。

## 2. 非范围（exclusions）

- 全量 77 工具 cancellable 化（只做起步三族，其余随触域）；递归子代理/并发上限调整（W3 CP-8）；审批策略判定逻辑改动（ORC-2 已收口面不动）；Gen UI/数据面（W4）；G1+ 事项不外推。

## 3. 门禁

每 CP：定向红绿（新契约+既有回归）+ tsc 0 + lint 触碰面 0 error + build（涉 UI）。波末：closeout 十二门 + test:changed + docs/ui + 实机断言（dev 栈拉起，acceptance/block-171/）+ ui:audit 台账（新增可见面登记 UI-###）。

## 4. 完成语义与回写

- 四 CP 出口断言全过 + closeout 绿 = 本包 completed；总纲 §4 W1 行回写状态；UI-### in_progress 待用户过目翻 verified。
- 波报集中复认：本波缺省裁决清单随收口笔录列出（含 BLOCK-28.8 推翻），用户复认推翻 = 按当时进度重做该半边。
