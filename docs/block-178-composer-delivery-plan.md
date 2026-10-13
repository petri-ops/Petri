---
capability: conversation-ux
goal: 对话输入与忙碌态投递一等化（对照 ZCode v4 ConversationComposer/QueuePanel + Codex core input_queue）——发送/Stop 并存且运行中可点、投递模式显式化（转向/排队+Alt 单次反向）、用户消息编辑重发、队列一等化（稳定 ID/上限 20 诚实溢出/撤回编辑/立即发送/排序/暂停排水）、队列随会话持久化、完成桌面通知、跨会话 prompt 历史。
acceptance:
  - P0：运行中发送按钮在场可点（按投递模式路由）；「转向/排队」切换显式可见；steer 走既有 task/:id/steer（入队不可撤诚实边界保留）；用户消息可编辑重发（回退到该消息前+回填输入框）
  - P1：队列条目稳定 ID+上限 20 超限诚实提示；撤回编辑/立即发送（停当前+优先消费）/上移下移/暂停恢复自动排水（暂停后跑完不自动发且可见）
  - P2：队列随会话持久化（刷新不丢）；失焦完成桌面通知（设置面开关）；prompt 历史跨会话持久化
  - 红线：BLOCK-102 跨会话归属与排水前对账语义不动；queue chips 既有视觉延续
  - closeout 门禁绿 + live 探针（steer 真实任务链）
reopen: 任一出口断言未达即返工；用户 2026-10-13 会话裁决「按照你的建议 冲完 BLOCK-178」
status: completed
---

# BLOCK-178 — 消息队列与忙碌态投递一等化

## 0. 来源与授权

- 用户 2026-10-13：「不够 不够 参考源码 无论是 zcode 还是 codex 都可以消息排队的 聊天输入框可以点击发送 很多都可以 你仔细排查和核对一下」→ 主代理解剖 ZCode v4（ConversationComposer/ConversationQueuePanel：inputRouting.mode 三态、队列撤回编辑/立即发送/拖拽排序/暂停排水）与 Codex（core/session/input_queue.rs Steer 语义 + queue 命令），列差距清单 → 用户 /goal「按照你的建议 冲完 BLOCK-178」。

## 1. 范围（三批十一项）

- **P0 手感底线**：①Send/Stop 并存（busy 态发送钮可点）②投递模式「转向/排队」显式切换+Alt 单次反向 ③用户消息「编辑」重发（回退+回填）。
- **P1 队列一等化**：④稳定 ID+上限 20+诚实溢出 ⑤撤回编辑 ⑥立即发送（停当前+优先消费）⑦上移/下移排序 ⑧暂停/恢复自动排水（暂停可见）。
- **P2 周边补齐**：⑨队列随会话持久化 ⑩失焦完成桌面通知（实验特性开关）⑪prompt 历史跨会话持久化。

## 2. 非范围（红线）

- BLOCK-102 跨会话队列归属、排水前 SQLite 对账语义；steer 入队即不可撤；queue chips 既有视觉语言；拖拽排序（本轮上/下移按钮先行）。

## 3. 门禁

vitest（useChatStream 队列/路由+SimpleChat 编辑重发）+ tsc + live 探针 scripts/block178-live.mjs（真实任务 steer 链）+ closeout 十三门。

## 4. 波报（2026-10-13 收口）

- **P0 手感底线**：①Send/Stop 并存——运行中发送钮保持可点（title 按模式提示「Alt+点击 改为…」），不再互斥替换；②投递模式显式化——工具行「转向/排队」切换（localStorage 记忆），Alt+Enter/Alt+点击单次反向（effectiveDelivery）；转向=send() 流式期既有 task/:id/steer 通道（CK-01 复用，零新后端面），被拒回退排队+诚实提示「转向未受理已转入排队」；③用户消息「编辑」——历史件 hover 编辑钮，回退到该消息前+清 run 快照+回填输入框聚焦（run 投影件 indexOf 不到不出钮=诚实边界）。
- **P1 队列一等化**：稳定 ID（q_ 时间戳+序号）+上限 20 超限诚实提示（queue-overflow 状态行，输入保留）；撤回编辑（回填+光标尾置）；立即发送（目标条挪会话子序列首位+停当前轮，排水对账后优先消费）；上移/下移（同名会话子序列内换位，BLOCK-102 归属不动）；暂停/恢复排水（暂停行可见待发数+工具行恢复钮；autoDrain===false 显式门，undefined=开启旧调用方零回归）。
- **P2 周边**：队列随会话持久化（petri:chat-queue:v1，刷新不丢）；失焦完成桌面通知（streaming true→false 边沿+document.hidden+实验特性节开关 petri:notify-on-done 默认开，通知点击回窗）；prompt 历史跨会话持久化（按项目 50 条，会话内消息优先去重补位）。
- **契约抓真**：既有 queue 契约测试抓出 **React updater 回读失效缺陷**——queue() 在 setState updater 内回读结果判溢出，React 不保证 updater 同步执行→溢出判定静默失效；修正为从 props 权威态计算（enqueueQueuedPrompt 纯函数），溢出语义真实生效。
- **红绿**：vitest 27/27（block178 新 9 项+既有 hook 15+row 3）；live **14/14**（acceptance/block-178/block178-live.json——真实任务 steer 受理 ok=true depth=1、真实 vitest 执行、接线面十项）；tsc 0；knip 绿。
- **随批缺省裁决**：投递模式持久化用 localStorage（会话偏好非治理面）；通知默认开（失焦才触发不打扰）；拖拽排序本轮上/下移按钮替代（plan §2 红线兑现）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
