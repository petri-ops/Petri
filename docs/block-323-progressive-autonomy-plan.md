---
capability: block-323-progressive-autonomy
status: active
goal: 放权坡道（observe→allow 渐进放权，借鉴 dsh-superagent 原型）：规则/工具层加 observe 中间档——命中只记录"本可自动执行"不真执行，本地复盘后人工一键升级 allow；观察证据落 policy_observations UPSERT 合并表；升级永远人工；判定序六层安全地板不变。
acceptance:
  - M1 观察档：schema observe/allow 档登记 + policy 纯函数 observe/allow 分支（不拦截、透出 observed/autoAllowed）+ 工具层 observe 档（仅 mutating）+ policy-observation-store UPSERT 合并（kind,rule_id,tool_name,fingerprint 唯一）+ 拦截器 fail-soft 落账 + auto-allow 行审计与 task_event 尽力追加。
  - M2 复盘视图：GET /api/ai/policy-observations（未复盘分组+近期自动放行）+ POST review 标复盘 + AgentRulesPanel 规则 action 下拉扩展 + 放权坡道复盘区（次数/最近/脱敏样本/一键升级）+ PolicyReviewBridge 通知（≥3 未复盘推 review_available，按最新 id 去重）。
  - M3 放行档：规则 allow 跳层 4/5 但动态防护/循环防护仍拦（安全地板）+ rule-auto-allow 审计 + saveUserRules 记 policy-change 行（动作变化摘要）。
  - M4 实机腿：dev-verify flow（隔离后端 observe→复盘→allow 全链 + 动态防护地板）证据落 acceptance/block-323/。
  - 契约测试红绿（test/block323-progressive-autonomy.test.mjs）+ 审批/规则族回归（block180/243/244）全绿 + quality:types 零红 + closeout 十一门。
  - UI-655 登记；handoff/backlog/AUDIT-LOG 回写。
reopen: 观察数据导出/跨设备；MCP 工具观察面（trust 天花板下）；模型判定升档；G1+。
---

# BLOCK-323-PROGRESSIVE-AUTONOMY — 放权坡道（observe→allow 渐进放权）计划

- 状态：active（M1–M4 已全段交付；closeout 收口中。证据：契约 8/8 + 前端 6/6 + 邻域回归全绿 + 实机 `acceptance/block-323/block323-observe-live.json` 13/13；UI-655 in_progress）
- 立项裁决：用户 2026-11-01「行 规划好 开整吧」（承接同日设计提案交付：dsh-superagent 渐进放权模式融入）
- 前置研究：`reference/dsh-superagent-prototype/`（DeepSeek 开源原型，observe/accept 模式 + Mandate revalidate + 注意力经济学）
- 唯一真相域：本文件（block-323-progressive-autonomy）

## 1. 定位（立项自检问句）

在既有治理栈上补一个「观察档」：规则/工具命中时**只记录"本可自动执行"而不真执行**，用户在本地复盘后一键升级为自动放行。与 ZCode/Codex 的 ask/deny 二态的差别=可审计的放权坡道；与 dsh 的差别=复盘在本地设置面、每条记录可回放（治理透明 + 证据自证）。

## 2. 核心设计决策（四条红线）

1. **坡道终点复用既有 allow 语义，不发明 auto 档**：工具层 allow 已存在（BLOCK-244）；本包只补 observe 中间档 + 规则层 allow 档 + 复盘升级流。不建第二执行器。
2. **观察记录落独立存储 `policy_observations`（UPSERT 合并）**：task_events 有 30 天保留清扫（agent-task-store.js:330），不能承载复盘证据；decision_log 是 AI 决策原语台账，不挪用。观察表按 `(kind, rule_id, tool_name, fingerprint)` 唯一键 UPSERT——hits 计数 + 首见样本 + last_seen，同 dsh Effects 的 kind/key 合并思想。
3. **升级永远人工（人推车，车不自己爬坡）**：无时间自动升档、无模型判定升档。复盘=改 rule.action / 工具 mode，走既有 PUT API。
4. **判定序不变（安全地板）**：`agent-tool-policy.js` 六层判定序的顺序与位置全部不动；cost-cap、四档 accessMode、loop guard 不动。规则 allow 与规则 deny 同层同优先级（更具体的用户裁决优先于泛化工具档）：豁免逐调用确认类闸（MCP trust ask / 工具策略 ask/deny），**不豁免**动态防护（破坏命令/敏感路径，层 3）与循环防护（层 6）。规则永远不匹配 MCP 工具调用（extractTargets 只产内建工具目标），MCP trust 天花板不受影响。

## 3. 范围

### M1 观察档
- `core/packages/shared-config/config-schema.js`：`agentRules.<item>.action` oneOf 增 `observe`、`allow`（M3 一并登记）。
- `core/petri-server/helpers/tool-approval-policy.js`：MODE_VALUES 增 `observe`。
- `core/petri-server/agent-tools/agent-tool-policy.js`（纯函数）：
  - 规则层命中 `observe` → 不拦截，把 `{ruleId, guardKey, fingerprint}` 以 `observed` 字段随放行结果透出；
  - 规则层命中 `allow` → 设 `autoAllowed` 透出，跳过层 4/5；层 3/6 照走；
  - 工具层 `observe` → 同 allow 但透出 `observedTool`（仅 mutating 调用记录；读工具默认已放行，观察无意义）。
- `core/petri-server/agent-tools/agent-tool-interceptor.js`：最终 allow 决策上消费 `observed`/`observedTool` → 写 `policy_observations`（fail-soft）；消费 `autoAllowed` → 写 `kind='rule-auto-allow'` 审计行 + 尽力追加 task_event `permission.auto_allowed`（ctx.taskId 在场时，SSE 可见）。
- 新增 `core/petri-server/helpers/policy-observation-store.js`：SQLite `policy_observations` 表（`db.getDatabase()` 单连接）；UPSERT 合并；`boundedJsonPreview`（approval-request-store 加性导出）做脱敏样本。

### M2 复盘视图
- 聚合 API（`routes/ai-settings-api.js`）：`GET /api/ai/policy-observations`（未复盘分组 + 近期自动放行 20 条）、`POST /api/ai/policy-observations/review`（标复盘/全部标复盘）。
- 前端 `AgentRulesPanel.tsx`：规则 action 下拉加 observe/allow；新增「放权坡道」区=待复盘列表（命中次数/最近时间/脱敏样本/一键升级 allow 或收权 require-ack）+ 近期自动放行。
- 通知：新增 `PolicyReviewBridge`（App.tsx 挂载，ScheduleReminderBridge 同型）：60s 轮询未复盘数，≥3 时 notification-center 推一条 `review_available`（新 AppNoticeKind），按最新观察 id 去重（复盘后新观察再触发，quiet by default）。

### M3 放行档（与 M1 同批落地，验收独立）
- 规则层 allow 分支 + `rule-auto-allow` 审计行（含 ruleId/fingerprint/hits）= 授权行使的可回放记录。
- 规则变更留痕：`saveUserRules` 成功后经观察存储记 `kind='policy-change'` 一行（含变更摘要：动作变化条目的 id before→after），复盘面可见授权演变。

### M4 实机验证腿
- dev-verify flow `block323-observe-live.cjs`（隔离后端 + mock provider）：observe 规则命中→不拦截且观察行 UPSERT→复盘升级 allow→同类调用自动执行且 auto-allow 行计数增加→deny/动态防护回归不变。
- 证据落 `acceptance/block-323/`。

## 4. 非范围（exclusions）

- 不引入 ticket/mandate 概念；不做模型判定升档/时间自动升档。
- 不动 MCP trust 语义与 mcp-server-policy；不做 MCP 工具的观察（规则不匹配 MCP 调用，工具层 observe 理论可配 MCP 工具名——放行仍受 trust 层约束，v1 如实记录）。
- 不做观察数据导出/跨设备；不做复盘审批流（复盘就是改配置，直接落）。
- 不碰 dsh 其他借鉴点（原因码 taxonomy、model-surface 预算——另立包）。
- G1+ 不外推。

## 5. 依赖与影响面

- 依赖：无新 npm 依赖（better-sqlite3/既有 store 模式）。
- 触碰文件：config-schema.js、tool-approval-policy.js、agent-tool-policy.js、agent-tool-interceptor.js、approval-request-store.js（加性导出）、ai-settings-api.js、agent-user-rules.js（文档注释）、新增 policy-observation-store.js；前端 AgentRulesPanel.tsx、notification-center.ts（新 kind）、新 PolicyReviewBridge.tsx、App.tsx（挂载一行）。
- 回归保障：既有 agent 规则/审批族测试（block160/180/243/244 契约）只读复跑。

## 6. 验收门禁

1. 契约测试（红绿先行）：`test/block323-progressive-autonomy.test.mjs`——schema 校验 observe/allow 合法 + 非法拒；policy observe 不拦截且透出 observed；policy allow 跳层 4/5 但动态防护仍拦；工具层 observe 仅 mutating 记录；观察 store UPSERT 合并/复盘标记。
2. 定向回归：审批/规则族测试（block180/243/244）全绿。
3. 实机腿：M4 flow 全绿（observe→复盘→allow 全链 + 动态防护地板不破）。
4. 前端：AgentRulesPanel/bridge 组件测试 + `quality:types` 零红。
5. closeout 十一门。
6. UI-655 登记（本包新增设置面区块）。

## 7. 完成语义

M1–M4 全绿 + 门禁 1–6 对账 + 台账回写（handoff/backlog/AUDIT-LOG/ui-audit）→ completed。实机 UI 腿（9223 离屏点按复盘流）若本会话未跑，UI-655 如实记 in_progress，不冒 verified。
