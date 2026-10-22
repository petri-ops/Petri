---
capability: q1-approval-contract
goal: 把审批从「拦截键 + 一次性确认」升级为可理解、可编辑、可审计的控制面：审批请求支持 once/task/always 三种范围、批准时编辑参数并重新跑 schema/preflight/policy、审计 permission.resolved（原始/生效参数、范围、耗时）；同时让 MCP 服务级 trust='ask' 对 destructive 工具真正生效（trust='allow' = 自动批准），解掉 Q8 的 trust 降档欠账。
acceptance:
  - 审批契约：decision 形状扩展 scope=once|task|always；updatedInput 在决策路由重新校验 schema + workspace preflight + policy（仅放行本次审批的 guardKey，新风险维度一律拒绝）；once 只批准生效参数指纹，task 写维度级 ack，always 仅对 MCP 请求可用并把该服务 trust 置为 allow。
  - 审批资源：request 记录 original/effective 参数预览（脱敏 + 有界）、原始/生效指纹、scope、decisionReason、durationMs；重复调用幂等复用 pending 并透出 duplicatePending/pendingCount；任务结束清理。
  - 审计：task_events 新增 permission.resolved（decision/behavior/scope/reason/toolName/guardKey/updatedInput/originalInputHash/effectiveInputHash/durationMs + 脱敏有界参数）；guard-events 端点合并 permission.resolved 与 legacy guard_ack 并按 requestId 去重。
  - MCP 信任：trust='ask' 时仅 destructiveHint 工具需要审批（guardKey=mcp:<serverId>，dimension=mcp-trust）；trust='allow' 自动放行；策略在调用时重读，投影快照不作放行依据；目录模式 call 代理只要目录含 destructive 工具即保守要求审批。
  - 审批卡 v2：danger/warning/info 三变体（dynamic_guard/user_rule/mcp_trust）+ 确定性意图解释（不伪造模型解释）+ 长命令折叠 + 参数 JSON 编辑（有界未截断才可编辑）+ 范围选择（仅本次/本任务/始终信任 MCP 服务，后两者两步武装）+ 待审批计数与重复调用提示。
  - 测试：Node 契约测试（updatedInput 重校验/新 guard 拒绝/scope 失效/重复检测/审计字段/MCP trust ask-allow/目录代理保守审批）+ 前端 GuardAckCard 变体/折叠/编辑/范围/计数 + 既有审批族回归 + 隔离 9223 live（mock provider：guard → 解释 → 编辑参数 → 批准 → 重试放行 → 审计可查）+ 亮/暗截图；closeout 十三门 PASS。
reopen: 非 MCP 维度的持久化「始终」（需用户规则合成 UI）、模型/本地模型意图解释、编辑重发 + workspace-checkpoint 回退、访问权限三档选择器与完全访问确认层、sideTask 变体、多请求批量决策面板、stdio/SSE OAuth、真实 provider 矩阵（G1+）。
status: completed
---

# BLOCK-243 · Q1 信任与审批：审批契约 v2 + MCP trust 生效

> 用户裁决：2026-10-22「按照建议推进 Q1 信任与审批 或 Q9 长尾可以排队」。
> 母纲：`docs/qoder-essence-absorption-plan.md` Q1（A1/A2/A3/A4/A5/A6/A8 + C5 + D3）。
> 前置：BLOCK-180 审批一等资源（requestId/指纹/TTL/两步武装）、BLOCK-160 动态防护与用户规则、BLOCK-171 确认卡与审批记录、BLOCK-221/239/241 MCP 服务治理与 trust 落库（本轮让其生效）。

## 1. P0 实码勘察（2026-10-22，只读实测）

| 面 | 当前证据 | 结论 |
| --- | --- | --- |
| 审批资源 | `helpers/approval-request-store.js`：requestId/TTL/原始指纹/`status=pending|approved|denied|expired`/`decidedMode=once|always`；幂等复用 pending | 扩展 scope/original+effective/参数预览/计数/审计字段，不重建 |
| 策略决策 | `agent-tool-policy.js`：用户规则 → 动态防护 → 档位 → preflight；指纹放行层已存在（once），guardKey ack 层已存在（task 语义） | 新增 MCP trust 层（destructive + trust ask）；updatedInput 走决策路由重校验，不塞进纯函数做 I/O |
| 拦截器 | `agent-tool-interceptor.js`：schema 校验 → 两次 policy（preflight 前/后）→ 执行前消耗指纹；deny 信封附 guardKey/dimension/ruleId/requestId/spans | 注入调用时 trust 快照；信封附 argsPreview/mcpServerId/计数/重复标记 |
| 决策路由 | `routes/ai-agent/task-actions.js` POST `/guard-ack`：requestId 级 approve/deny、once=指纹、always=维度 ack；guard_ack 入 task_events | 扩展 scope/updatedInput/reason/permission.resolved；always 仅 MCP 写 trust |
| 前端卡片 | `SimpleChat/GuardAckCard.tsx`：requestId、command span 高亮、两步武装；`SimpleChat.tsx` 从 toolActivities 派生 pendingGuardAck 并 POST guard-ack | 扩展变体/解释/折叠/参数编辑/范围/计数；仍从同一拒绝信封派生，不建第二通道 |
| MCP 合同 | `mcp-projection.js`：D4 execution/R2；BLOCK-240 hints（readOnly/destructive/openWorld/idempotent）；BLOCK-241 catalog/call 代理 | destructive + trust ask 进 policy 门；call 代理按目录是否含 destructive 保守判定 |
| MCP 信任 | `mcp-server-policy.js`：`{trust:'ask'|'allow', allow[], block[]}`，读侧 fail-closed；当前 trust 只展示不生效 | 本轮生效：ask + destructive → 审批；allow → 自动放行 |
| 工作区回退 | `core/shared-backend/workspace-checkpoint.js`：create/rollback/list 已存在 | 本轮不接编辑重发回退，如实留 reopen（避免半成品） |
| 审计台账 | `task_events` 已有 guard_ack；`/guard-events` 只读 guard_ack；历史面板按 guard_ack 投影 | 新增 permission.resolved，端点合并去重，事件形状向后兼容 |

**P0 结论**：审批能力已有资源/指纹/确认卡三层，但缺「范围选择、参数编辑、审计闭环、MCP trust 生效」。本轮是**扩展既有单链**，不新建第二审批系统、不引入依赖。

## 2. 范围与阶段

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P1 审批契约** | `approval-request-store`：scope once/task/always、original/effective 指纹、脱敏有界参数预览、duplicatePending/pendingCount、decisionReason/durationMs；`task-actions` 校验 updatedInput 并追加 `permission.resolved`；`/guard-events` 合并去重 | Node 契约测试先红后绿；既有 guard_ack 兼容 |
| **P2 MCP trust 生效** | `mcp-projection` 合同附 `mcpApproval{serverId,destructive}`；拦截器调用时读 `mcp-server-policy` 注入 trust；policy 新增 `mcp_trust_required` 门（ask + destructive，未 ack/未指纹放行）；always 走审批路由写 trust allow | policy/projection 定向测试；ask/allow/目录代理三态 |
| **P3 审批卡 v2** | GuardAckCard 三变体/确定性解释/长命令折叠/参数编辑（未截断才可编辑）/范围选择（本任务与始终两步武装）/计数与重复提示；SimpleChat 透传新字段并在编辑批准后引导模型按生效参数重试 | 前端组件测试 + types 0 + theme 门禁 |
| **P4 实机与收口** | 隔离 9223 live：mock provider 触发 destructive MCP 工具 → 审批卡解释 → 编辑参数 → 批准 → 模型按编辑参数重试放行 → `/guard-events` 可查 permission.resolved；亮/暗截图；UI-551 台账；impact-map/knip；closeout | live 全过 + 十三门 PASS |

**批内纪律**：①updatedInput 必须重新过 schema/preflight/policy，只放行本次审批的 guardKey，新风险一律拒绝；②once 只批准**生效参数**指纹，原参数重试不自动放行；③task 才写维度 ack（任务结束失效）；④always 仅 MCP 且两步武装，写 trust 前明确展示服务名与后果；⑤审计参数脱敏 + 有界，截断时标记；⑥意图解释只用确定性规则，失败不伪造；⑦调用时重读 trust，投影快照不作放行依据；⑧零新依赖。

## 3. 非范围（reopen）

- 非 MCP 维度的持久化「始终」（需要把 guard 维度合成为用户规则的 UI 与规则模型扩展）。
- 模型/本地模型意图解释（本轮确定性解释；失败可继续语义由确定性解释天然满足）。
- 编辑重发 + `workspace-checkpoint` 回退（本轮只做参数批准与模型重试引导，不做文件回退）。
- 访问权限三档选择器 + 完全访问确认弹层（Q1 D3，另包）。
- 审批卡 danger/info/warning/sideTask 的 sideTask 变体与批量决策面板。
- MCP stdio/SSE OAuth、真实 provider 矩阵（G1+）。

## 4. 验收门禁

1. 红绿先行：`test/block243-approval-contract.test.mjs`（scope/updatedInput 重校验/新 guard 拒绝/重复/审计）+ policy trust 三态 + 既有 `approval-request-store`/`block180`/`block171`/`mcp-projection` 回归。
2. 前端：`GuardAckCard.test.tsx` 扩展（变体/折叠/编辑/范围/计数/重复）+ `quality:types` 0 + theme 契约。
3. 定向：`npm run test:changed`（impact-map 同批登记新测试/acceptance/flow）。
4. 实机：隔离 9223 live（mock provider + 真实 backend 审批路由）≥10 断言 allPass；证据 `acceptance/block-243/`（断言 JSON + 亮/暗截图）。
5. `output:judge` 收口声明前跑；`npm run closeout` 十三门 PASS。
6. 台账：UI-551 状态从 `in_progress` 升 `verified`（dev Electron 边界内）；DOC-REGISTRY/README/AUDIT-LOG/roadmap/handoff 同批回写。

## 5. 完成语义

completed = 契约 + MCP trust 生效 + 卡片 v2 + 定向/前端/live 证据 + UI-551 台账 + closeout 十三门 + canonical 回写。任何一项缺失或仅在计划内，不得标 completed/verified。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口（2026-10-22）

**结论：BLOCK-243 completed；UI-551 verified（dev Electron 边界内；隔离 9223 亮 21/21 + 暗 21/21）。**

### 6.1 交付

- **审批资源 v2**（`helpers/approval-request-store.js`）：scope once/task/always、原始/生效指纹、脱敏有界参数预览（截断/含 `[REDACTED]` 时不可编辑）、`pendingCount`/`duplicatePending`、`decisionReason`/`durationMs`、`permission.resolved` 事件构造器；legacy `mode=always` 兼容映射为 task。
- **编辑参数重校验**（`helpers/approval-input-revalidation.js`）：批准前重跑 schema → workspace preflight → policy；只把本次审批 guardKey 放进 ack 集，新风险维度拒绝；缺上下文快照/工具断开 fail-closed。
- **执行替换**（`agent-tool-interceptor.js`）：批准编辑参数后登记「原始指纹→生效参数」一次性替换；模型重试原调用时按生效参数重新过门并执行，原始/生效指纹随结果回传审计；消费前不执行原参数。
- **MCP trust 生效**（`mcp-projection.js` + `agent-tool-policy.js` + interceptor）：destructiveHint 工具合同附 `mcpApproval{serverId,destructive}`；调用时重读 `mcp-server-policy`，`trust=ask` 要求审批（guardKey=`mcp:<server>`，dimension=`mcp-trust`），`trust=allow` 自动放行；目录 `call` 代理在目录含 destructive 工具时保守审批。
- **审计**（`routes/ai-agent/task-actions.js`）：`/guard-ack` 支持 scope/updatedInput/reason，always 仅 MCP 且写 trust=allow；`permission.resolved` 记录原始/生效哈希、脱敏输入、范围、耗时；`/guard-events` 合并 permission.resolved 与 legacy guard_ack 并按 requestId 去重。
- **审批卡 v2**（`GuardAckCard.tsx` + `SimpleChat.tsx` + `toolActivity.ts`/types + CSS）：danger/warning/info 变体、确定性解释、长命令折叠、参数 JSON 编辑（仅一次性批准）、范围选择（本任务/始终信任 MCP 服务，两步武装）、计数/重复提示；`toolResult.approval` 独立于 data 截断。
- **信任位可回退**（`McpPolicyEditor.tsx` + `useMcpServers`）：`trust=allow` 时货架提供「改回 ask」；ask 的直接授权仍走审批卡两步武装。
- **实机基建抓真**：`src/main/_window-create.js` 的测试实例原先无条件 `show:false`，与 `--onscreen` 语义冲突；Windows 隐藏窗在复杂聊天页 `Page.captureScreenshot` 等不到合成帧（20s 超时）。修正为 `PETRI_TEST_ONSCREEN=1` 时真实显示窗口。

### 6.2 验证

- **Node**：新增契约 **15/15**（store scope/override/重校验/trust 三态/投影元数据/拦截器信封）+ 审批/MCP 邻域 **69 通过 / 0 失败**（70 项，1 skip）。
- **前端**：GuardAckCard **13/13**、toolActivity **16/16**、McpShelfPane **13/13**、theme **17/17**；`quality:types` 0。
- **隔离后端 API 实机腿 14/14**（`acceptance/block-243/block243-live.json`）：真实 stdio MCP destructive 工具 → trust deny 信封（变体/解释/参数/计数）→ 非法编辑 400 → 合法编辑批准 → 模型重试原调用按 `{"target":"archive"}` 执行 → `permission.resolved` 端点 + 原始 payload 审计可查。
- **隔离 9223 UI 实机腿**：亮 **21/21**（`acceptance/ui-551/ui551-approval-live.json`）+ 暗 **21/21**（`ui551-approval-live-dark.json`）——卡片 info 变体/解释/预览/范围按钮 → 编辑参数 → 批准提示 → 模型重试替换执行 → 终态答复 → 卡片消失 → 审计端点可见；亮/暗截图 `ui551-approval-card-{light,dark}.png`。
- **隔离性**：隔离 backend :3001 + Vite :3000 + Electron :9223（临时 `PETRI_LOCAL_DATA_DIR`/`PETRI_DB_PATH`/userData），零用户数据触碰；收尾回收进程与临时目录。

### 6.3 范围守住与遗留

- trust 生效只对声明 `destructiveHint` 的 MCP 工具；非 destructive/只读工具行为不变（D4 零漂移）。
- 编辑参数只允许 once（task/always 必须先按原参数建立范围），避免「编辑 + 维度放行」绕过精确批准。
- 未做（reopen，见 §3）：非 MCP 维度的持久化「始终」（需用户规则合成 UI）、模型/本地模型意图解释、编辑重发 + workspace-checkpoint 回退、访问权限三档选择器与完全访问确认层、sideTask 变体与批量决策面板。
- 实机观察：在卡片可见时切换主题会触发 `ProjectWorkspace` 既存的重渲染警告（非本包文件面）；暗色截图改为「卡片出现前切主题」的独立运行，最终两次运行控制台均无该警告；如后续需要主题热切，另行立项修复该既存环。

G0 开发期常态 · 不外推 packaged/Provider/GA。
