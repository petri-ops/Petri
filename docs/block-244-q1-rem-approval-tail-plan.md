---
capability: q1-rem-approval-tail
goal: 收口 Q1 信任与审批余项：通用工具审批策略（A1/A8）、同参循环防护（A5）、确定性意图解释与侧边任务变体（A2/A7）、结构化提问（C19）、完全访问确认层（D3）、编辑重发 + workspace-checkpoint 回退（C5），把「审批」从审批卡扩展到策略、循环、提问与可逆修正的完整控制面。
acceptance:
  - 工具审批策略：`tool-approval-policy.json` 逐工具 allow/ask/deny（默认 allow）；ask 走既有审批资源/守卫通道（guardKey=tool:<name>），deny 直接拦截；设置页可搜索、编辑、保存，后端 400 diagnostics；调用时读策略，投影快照不作放行依据。
  - 循环防护：mutating 工具同参连续 N 次（默认 3，env 可调）触发 `loop_guard` deny + 审批卡（warning）；once/task ack 与指纹放行语义复用；read-only 工具不触发；不同参数重置计数；审批资源在位时 `repeated_tool_call` 硬停交棒审批层，无审批通道保持硬停。
  - 意图解释/变体：审批信封增加确定性 intent（action/impact/reversible/reason），审批卡展示「意图/影响」；子代理任务触发的审批使用 sideTask 变体（侧边任务标识）；不伪造模型解释。
  - 结构化提问：新增 `ask_user_question` 工具（question/options/multiSelect/allowFreeText）；handler 暂停等待用户回答（超时如实降级），前端问题卡支持单选/多选/自由输入；回答经 task 路由回传并在同一轮返回模型；事件/审计可查。
  - 完全访问确认：切换到「完全访问」时弹层展示能力清单/风险/可随时切回；本会话确认一次；取消不改变档位；组件测试。
  - 编辑重发 + checkpoint：每轮发送时并行发起 git 工作区无副作用 checkpoint（不 await、不阻断发送；非 git/纯净树如实不创建）；编辑消息时若本轮有快照，提供「回退本轮文件修改并重发/仅重发/取消」；回退失败如实提示且不静默继续；部分未记录时警告。
  - 测试：Node（策略/循环/提问 store/路由/意图）+ 前端（策略面板/问题卡/完全访问弹层/审批变体）+ 定向回归 + 隔离 9223 live（策略 ask→卡→放行、循环 3 次→确认、提问→回答、访问档确认、checkpoint 回退）+ 亮/暗截图；closeout 十三门 PASS。
reopen: 模型/本地模型意图解释（本轮确定性规则）、非 MCP 持久 always 的规则合成 UI、批量决策面板、AskUserQuestion 的跨会话/多问题批次、checkpoint 的部分未记录文件精确恢复、`repeated_tool_call` 硬停阈值与 env 循环阈值的联动登记、G1+。
status: completed
---

# BLOCK-244 · Q1-REM：审批控制面收尾

> 用户裁决：2026-10-22「开始 Q1-REM 一次性搞定」。
> 前置：BLOCK-243 审批契约 v2（scope/updatedInput/permission.resolved/MCP trust/卡 v2）。
> 范围来源：Qoder 总纲 §6.5 `Q1-REM`。

## 1. 范围与阶段

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P1 工具审批策略（A1/A8）** | `helpers/tool-approval-policy.js`（逐工具 allow/ask/deny，默认 allow，读侧 fail-soft/写侧 fail-closed）+ policy 层 + GET/PUT 路由 + 设置页面板 | Node 策略/路由 + 前端面板测试 |
| **P2 循环防护（A5）** | approval store `callHistory` + interceptor 记录 + policy `loop_guard`（mutating/阈值/ack/指纹/read-only 豁免） | Node 循环三态测试 |
| **P3 意图解释/侧边任务（A2/A7）** | 审批信封 `intent`（action/impact/reversible/reason）+ 卡片「意图/影响」块；`source=side-task` + sideTask 变体/CSS | Node 信封 + 前端卡片变体 |
| **P4 结构化提问（C19）** | `ask_user_question` 工具 + `user-question-store` + loop 暂停/恢复 + task 回答路由 + `UserQuestionCard` | Node 契约 + 前端组件 + live |
| **P5 完全访问确认（D3）** | SimpleChat 完全访问弹层（能力/风险/可切回，本会话一次） | 组件测试 + live |
| **P6 编辑重发 checkpoint（C5）** | 每轮 checkpoint（IPC 已有）+ 编辑时回退选择 + 失败诚实提示 | 组件/集成测试 + live |
| **P7 收口** | 定向/回归/live/UI 台账/closeout/output:judge | 十三门 PASS |

**批内纪律**：①策略/循环/意图均复用既有审批资源与 guardKey/指纹通道，不建第二套审批；②提问暂停必须有超时与诚实降级；③checkpoint 不得触碰 HEAD/暂存区，回退失败不静默；④完全访问确认取消不改档位；⑤零新依赖。

## 2. 非范围（reopen）

- 模型/本地模型意图解释（本轮确定性规则；不伪造）。
- 非 MCP 维度持久化「始终」的规则合成 UI（仍归用户规则面）。
- AskUserQuestion 多问题批次/跨会话恢复。
- checkpoint 对部分未记录文件的精确恢复。
- G1+ Provider/packaged/GA。

## 3. 验收门禁

1. 红绿先行：`test/block244-tool-approval-policy.test.mjs`（策略 store/ask/deny + 循环三态 + env 阈值 + 意图/side-task + `tool_result.approval` 透出）、`test/block244-ask-question.test.mjs`（提问 store/校验/超时/路由/handler）。
2. 前端：工具策略面板、UserQuestionCard、完全访问弹层、GuardAckCard sideTask/intent；types 0；theme 17/17。
3. 定向：`test:changed`；隔离 9223 live（策略 ask/循环/提问/访问档/checkpoint）+ 亮/暗截图。
4. `output:judge` + closeout 十三门 PASS；UI-552 台账 verified。

## 4. 完成语义

completed = 六片全部交付 + 定向/前端/live 证据 + UI-552 verified + closeout 十三门 + canonical 回写。任何一片未落或仅有组件测试，不得标 completed。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口（2026-10-22）

六片（P1–P6）全部交付，`UI-552` 转 verified（dev Electron 边界内）。

- **Node**：`test/block244-tool-approval-policy.test.mjs` 7/7（策略 store/ask/deny、循环三态、env 阈值、归属交接、意图/side-task、`tool_result.approval` 透出）+ `test/block244-ask-question.test.mjs` 5/5（store 生命周期/非法回答/超时释放/handler/fail-closed）。
- **前端**：56/56（GuardAckCard 14 · UserQuestionCard 3 · FullAccessConfirmDialog 1 · EditCheckpointDialog 1 · turn-checkpoints 3 · ToolApprovalPanel 1 · toolActivity 16 · theme-token 17）；types 0 错；lint 0 新增违规。
- **实机腿**：隔离 9223（mock provider + 真实 stdio MCP 夹具 + 临时 git 工作区，零真实 key）**亮 28/28 + 暗 28/28**，`acceptance/ui-552/`（5 张卡面截图/主题 + `ui552-audit-*.json` 事件审计）+ 同份报告落 `acceptance/block-244/`；链路=完全访问确认（取消不改档 → 确认切档）→ AskUserQuestion 提问卡回答 → 策略 ask 卡（warning + 意图块）→ 批准 → 复位 allow → 同参 3 次 `loop_guard` 卡 → 批准 → 终态 → `permission.resolved`×2 + `user_question_answered` 审计 → checkpoint 快照 → 编辑 → 回退把 `note.txt` 从 v3 恢复为 v2 并回填输入。

**实机抓真（四条，均已修/登记）**：

1. `tool-events.js` 的 `APPROVAL_FIELDS` 白名单没带 BLOCK-244 新增的 `intent`/`source`，审批卡意图块在真链路恒空——单测只测拦截器信封，测不到事件投影层。已补白名单，并把断言下移到 `buildToolResultEvent(...).toolResult.approval`。
2. `repeated_tool_call` 硬停（连续 3 次静默拒绝、无确认通道）抢在 `loop_guard` 之前，交互运行里循环审批卡永远出不来，A5 形同死代码。改为：**审批资源在位时把同参重复交给 `loop_guard` 审批层，无审批通道保持硬停**（`agent-loop-control.js` + `loop-orchestrator.js` 的 `canAskApproval`），并新增归属交接测试钉住两侧语义。
3. `ProjectWorkspace` 既存重渲染环（BLOCK-243 已记录的探针边界）在长链路尾部把 CDP eval/截图饿死。处置=探针侧拆腿（checkpoint 先跑、回退后 reload、终态文本允许回落持久化消息并如实标 `source`）；环本身作为广播项登记 `docs/AUDIT-LOG.md`，不归本包修复。
4. **发送链路不得被安全网拖住**：`useChatStream` 里 `await createTurnCheckpoint(...)`（带 2.5s 超时）把快照塞进 send 的宏任务链，`useChatStream.test.ts` / `useChatStream.block178.test.tsx` 的排队 drain 守卫（fake timers + `act` 收敛）连续 4 项假红（`startConversationRun` 0 次调用 + 用例 5s 超时）。改为 `void createTurnCheckpoint(...)` **并行发起、不 await**——快照仍在发送那一刻起跑，ref 落 localStorage 供编辑重发查；改后 24/24 绿，实机腿重跑复核 checkpoint 记录与回退。

**代码体积**：审批面状态簇外迁 `SimpleChat/hooks/useApprovalSurfaces.ts` + 渲染簇外迁 `SimpleChat/ApprovalSurfaces.tsx`，`SimpleChat.tsx` 2211→**2210**（吸收本包全部 UI 后仍低于基线）；`DesktopSettingsPanel.tsx` +2（工具策略面板并入「Agent 用户规则」节）、`copilotClient.ts` +1（类型再导出），`code-size-ledger --write` 随本提交重打指纹基线。

**收口门禁抓真（三条注册/工具面）**：

1. 新工具未登记元数据即红：`tool-metadata.js` 缺 `ask_user_question` 六字段（P2 完备性门禁）→ 补 `readOnly:false / destructive:false / concurrentSafe:false / needsApproval:false / riskLevel:'low' / timeoutMs:300000`（暂停本轮=不可并发；提问本身就是用户交互，不再叠审批）。
2. `process.platform` 分支冻结门：新隔离栈探针脚本的 win32 `taskkill` 分支属 dev-only 一次性探针（与已登记的 `scripts/ui551-ui-live.mjs` 同型），按门禁指引登记进 `test/platform-branch-freeze.test.mjs` BASELINE（登记即留痕）。
3. knip 棘轮在本机直接崩：oxc-parser raw-transfer 一次性申请 **~6GB** ArrayBuffer（`BLOCK_SIZE 2147483632 + BLOCK_ALIGN 4294967296`）→ `RangeError: Array buffer allocation failed`。正解=knip 官方开关 `KNIP_DISABLE_RAW_TRANSFER=1`（只改解析速度、不改输出契约），已写进 `scripts/knip-ratchet.mjs` 的 spawn env；此前试过的 `NAPI_RS_FORCE_WASI` 是无效项（仓内只装了 win32-x64-msvc native，WASM flavor 不存在），注释已改如实。新流程文件 `ui552-approval-tail-live.cjs` 属动态入口（由 `require(FLOW_PATH)` 装载，knip 追不到；把它加进 `knip.json` entry 实测无效——dot 目录被忽略），按同型先例 `--update` 登记 1 键（274→275，仅此一条，无夹带漂移）。

**reopen 校正**：A2 仅剩模型/本地模型意图解释（本轮为确定性解释）；`repeated_tool_call` 与 `loop_guard` 的阈值联动（env 阈值 > 3 时的硬停/审批衔接）与非 MCP 维度的持久「始终」规则合成 UI 仍在 reopen。

G0 开发期常态 · 不外推 packaged/Provider/GA。
