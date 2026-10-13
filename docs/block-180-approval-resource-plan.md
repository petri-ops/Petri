---
capability: execution-governance
goal: 执行审批二阶段一等资源化（研究池②转正；授权门增强）——审批从「拦截键+一次性确认」升级为可复审资源：审批请求带 requestId/调用上下文/风险片段/过期时间/决策记录；commandSpan 风险片段服务端分析+前端高亮（用户看得到批的是什么）；「本任务总是放行」两步武装显式化。增强既有链（BLOCK-48 授权门/BLOCK-160 动态防护/BLOCK-171 guard-ack/BLOCK-177 审计形态），不重建。
acceptance:
  - P0 审批资源：helpers/approval-request-store.js——动态防护/用户规则命中时注册 ApprovalRequest（requestId/taskId/toolName/args 摘要/command/风险 span/guardKey/createdAt/expiresAt/status: pending|approved|denied|expired/decidedAt/decidedMode）；pending TTL 过期后模型重试获明确 expired；任务结束资源随任务清理（内存态，任务内生命周期对齐 guard-ack 诚实边界）
  - P1 指纹放行：「放行一次」=请求级（调用指纹 toolName+args 稳定哈希）批准，模型重试同一调用经 policy 指纹层放行；「总是放行」保持 guardKey 维度语义（既有 isGuardAcked 零改写）；决策落 guard_ack 事件升级（附 requestId/decision/commandSpan，事件语义向后兼容）
  - P2 commandSpan：helpers/command-risk-spans.js 纯函数——workspace_exec 命令风险片段偏移区间分析（首 token/敏感路径/管道执行等维度，复用既有 DANGEROUS_FIRST_TOKENS/敏感路径判定单源），span 随 deny 信封与审批资源下发；GuardAckCard 按 span 高亮命令片段（无 span 退化为现样式，前端不重复实现风险规则）
  - P3 先武装后使用：「本任务总是放行」两步武装（点击→确认条→二次点击生效）；GuardAckCard 显示已武装维度；guard-ack 路由 `always` 形参真实消费（现状算了没用，诚实边界升级为显式语义：仍任务内，不越权跨会话——跨会话归 ORC-1 用户规则面不变）
  - 红线：既有 guardKey Set 语义（isGuardAcked）零改写（指纹层为新增层）；guard_ack 事件向后兼容（旧消费者不破）；无日期/无过期审批不新增跨会话持久化（诚实边界维持）；不做原生审批窗/跨机 socket 鉴权（Petri 形态=Electron 内确认卡，非范围）
  - closeout 门禁绿 + 实机探针（动态防护命中→审批卡→决策→重试放行全链断言）
reopen: 任一出口断言未达即返工；用户 2026-10-13 裁决「② 审批二阶段（推荐）」（AskUserQuestion 菜单选定，研究池②转正）
status: completed
---

# BLOCK-180 — 执行审批二阶段一等资源化（commandSpan 高亮 + 武装护栏）

## 0. 来源与授权

- roadmap 研究候选池②（2026-09-06 登记，源自 openclaw 对标解剖）：「执行审批二阶段一等资源化——两阶段审批请求（注册带 ID/过期/超时 → 等待决策）+ commandSpan 风险片段高亮 + 先武装后使用操作者护栏 + 原生审批窗 + socket 鉴权」。
- 主代理推荐「魂对齐（治理透明/本地可审计）+ 增强不重建（BLOCK-48/160/171/177 既有链）」→ 用户 2026-10-13 AskUserQuestion 裁决「② 审批二阶段（推荐）」→ 立项发令。
- **参照形态取舍**：openclaw 的原生 Swift 审批窗 + socket 鉴权不移植（Petri=Electron，确认卡即审批面；通道治理走既有 IPC/REST 注册表）——借「资源模型/风险可见/武装护栏」三魂，长 Electron 自有形态。

## 1. P0 勘察结论（2026-10-13，代码实证）

- **既有审批两条链**：①guard-ack 链（policy 动态防护/用户规则 deny+guardKey → 信封透出〔BLOCK-171 缺陷修复后〕→ GuardAckCard 三键 → POST /task/:id/guard-ack → guard-ack-store 任务内 Set → guard_ack 事件 → /guard-events 复审面板）；②ackToken 两段式（run_tool/computer-use 专用 pending tool_job，非通用）。
- **差距**：guardKey=拦截维度键（`cmd:rm`/`path:...`）非请求资源——无 requestId/无 pending 实体/无过期（模型不重试即悬置）/决策记录无调用关联；风险提示仅一句话（detail），无片段定位；「本任务总是放行」一键即维度级永久（任务内），路由 `always` 形参算了没用（guard-ack-store 头注诚实边界：跨会话归 ORC-1，不越权）。
- **可复用单源**：DANGEROUS_FIRST_TOKENS + matchesSensitivePath（agent-tool-policy.js 动态防护判定）= span 分析的规则单源；guard-ack 事件/guard-events 复审面板=决策留痕骨架；isGuardAcked(ctx, guardKey) 读侧语义（Set 或 {key:true}）零改写。

## 2. 范围（四批）

- **P0 审批资源**：新 `helpers/approval-request-store.js`——`registerApprovalRequest({taskId, toolName, args, guardKey, dimension, detail})` 生成 requestId（`apr_` 前缀）+ TTL（缺省 10min）+ 调用指纹；`decideApprovalRequest(taskId, requestId, mode)`；`getApprovalRequest`；过期惰性判定（重试/查询时判，不靠定时器）；任务结束 release（对齐 releaseGuardAcks 接线点）。
- **P1 指纹放行**：policy 动态防护/用户规则命中时注册请求并在 deny 信封附 `requestId`/`commandSpan`/`expiresAt`（guardKey 既有字段不动）；放行检查加指纹层——「放行一次」决策记录指纹，模型重试同调用经指纹放行一次后消耗；「总是放行」走既有 guardKey Set 语义不变。
- **P2 commandSpan**：新 `helpers/command-risk-spans.js` 纯函数 `analyzeCommandRiskSpans(command)` → `[{start, end, kind: destructive-token|sensitive-path|pipe-exec, detail}]`，规则单源复用动态防护判定；workspace_exec 的审批资源与 deny 信封携带 spans；GuardAckCard 高亮渲染（args.command 在场且有 span 时）。
- **P3 武装护栏**：GuardAckCard「本任务总是放行」→ 两步（点击→内联确认条「武装后本任务内该维度不再询问」→二次点击生效）；卡面显示已武装维度徽标；guard-ack 路由消费 `always` 形参（语义=任务内 always，跨会话仍归 ORC-1 不变）。

## 3. 非范围（红线）

- 跨会话持久化审批/武装状态（ORC-1 用户规则面职责，不越权）；原生审批窗、跨机 socket 鉴权（openclaw 形态不移植）；ackToken 两段式链改造（run_tool/computer-use 专用面保持）；既有 guardKey Set 语义与 guard_ack 事件消费方零破坏（向后兼容）。

## 4. 门禁

- 红绿先行：`test/approval-request-store.test.mjs`（资源生命周期/TTL 过期/指纹放行/决策记录）+ `test/command-risk-spans.test.mjs`（span 定位/多维度/无风险命令）。
- 集成：policy+拦截器信封断言（deny 附 requestId/span/expiresAt；指纹放行一次；always 武装语义）——扩展既有 policy/interceptor 测试或新文件。
- 前端：GuardAckCard 高亮+两步武装 vitest。
- 实机：`scripts/block180-live.mjs`（隔离后端+mock provider——动态防护命中→deny 信封携 requestId/spans→guard-ack 决策→模型重试指纹放行→收口；TTL 过期路径），证据 `acceptance/block-180/`。
- closeout 十三门绿。

## 6. 波报（2026-10-13 当日整包收口）

- **P0 审批资源**：helpers/approval-request-store.js——registerApprovalRequest 幂等（同指纹+guardKey 复用 pending，重试 requestId 不漂移）/TTL 惰性过期（重试获新请求）/decideApprovalRequest 终态机（pending→approved|denied|expired）；store 自持 approvedFingerprints 集，loop 双挂 toolCtx（路由写/policy 读引用共享）。
- **P1 指纹放行**：policy 用户规则+动态防护两分支加指纹层（isGuardAcked 既有语义零改写）；deny 信封附 requestId/spans/expiresAt（guardKey 字段不动）；**抓真一处语义缺陷**——路由初版在 once 决策时误写维度级确认集（once 实为 always），已改为 once 只登记指纹（拦截器执行前消耗）、always 才写维度级。
- **P2 commandSpan**：helpers/command-risk-rules.js 规则单源（policy 动态防护与 span 分析共用，判据不漂移）+command-risk-spans.js 纯函数（destructive-token/sensitive-path/pipe-exec 三维度，区间合并不重叠）；GuardAckCard 高亮渲染（无 command 退化存量形态）。
- **P3 武装护栏**：always 两步确认（首点出确认条二次点击生效）；已武装维度徽标；guard-ack 路由 requestId 请求级决策（未知 409/过期/重复决策显式错误）+always 形参真实消费+拒绝上送 deny 留痕。
- **验证**：红绿 21/21（store 8+spans 8+集成 5）+审批族回归 52 项 0 红（block171/160/policy 存量零破坏）+vitest 7/7（GuardAckCard 契约扩展，always 两步为有意变更已修订测试留痕）+tsc 0+实机探针 12/12（scripts/block180-live.mjs：隔离后端+mock provider——deny 信封 requestId/spans→存活期未知请求 409→请求级 approve→指纹放行重试真实执行→收口；存量键级 ack 兼容）。UI-509 登记 in_progress 待用户过目。
- **决策工具**：doc:suggest 命中 uiAudit+planDoc（均在收口动作内）；output:judge RETRY 一次后 PASS（fit=3.71）。
- closeout 十三门绿；G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 完成语义

- registry `active → completed`；plan 波报回填；roadmap 研究池②销号注记；AUDIT-LOG ✅ 行；handoff 顶部更新。UI 台账：GuardAckCard 变更登记 UI-###（审批卡风险高亮+武装两步）。
