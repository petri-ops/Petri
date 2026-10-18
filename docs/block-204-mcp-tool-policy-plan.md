---
capability: mcp-tool-policy
goal: BLOCK-204 = runlist W5（阶段 3 B2 之一）＝ **MCP 逐工具策略面**：给已投影的 `mcp_*` 工具配「启用 / 超时 / 合同模式（只读·改写·自动）」三件，并把投影上限从硬编码常量升为可配。现状（P0 实码）：`agent-tools/mcp-projection.js` 的 `MAX_PROJECTED_TOOLS = 40` 是**硬编码上限**；`client-manager.callServerTool` 的超时是模块常量 `CALL_TOOL_TIMEOUT_MS = 60_000`，**逐工具不可调**；合同（category/sideEffect/riskTier）只由 `annotations.readOnlyHint` 推导，**用户不可改**；「某个 MCP 工具我不想让它出现在模型工具面里」目前只能断开整个 server。
acceptance:
  - P0 基线：`test/block204-mcp-tool-policy-baseline.test.mjs` 冻结三件事——①投影上限现值为 40；②`CALL_TOOL_TIMEOUT_MS` 现值 60s；③readOnlyHint=true/false 两种合同派生形状（R1/retrieval/none 与 R2/action/execution）。此后改实现不得改基线（改了=行为变更，须说明）。
  - P1 schema：新族 `mcp-tool-policy`——标量 `mcpPolicy.projectionLimit`（1–200，默认 40）+ 集合条目字段 `<item>.tool` / `<item>.enabled` / `<item>.timeoutMs`（1000–600000）/ `<item>.contractMode`（`auto`|`read-only`|`mutating`）。集合形状复用 P4 的 `sanitizeItem/diagnoseItem`，不另起遍历器。
  - P2 落点：`helpers/mcp-tool-policy.js`（`mcp-tool-policy.json`，`{version, projectionLimit, tools:[…]}`）：读宽容（非法条目只丢该条）、写消毒、`policyFor(toolName)` 查询、`projectionLimit()` 读取、`resetToolPolicies()`。
  - P3 执行语义接线：①`_buildProjection` 过滤 `enabled:false`；②上限取 `projectionLimit()`；③合同按 `contractMode` 覆盖（`read-only`→retrieval/none/R1，`mutating`→action/execution/R2，`auto`=沿用 readOnlyHint）；④`callServerTool(id, tool, args, {timeoutMs})` 让逐工具超时真的生效。
  - P4 写面：`GET/PUT /api/mcp/tool-policy`（400 + 结构化 diagnostics）。**unknown-tool 键拒绝**：新的工具名必须存在于「当前已连接 server 的工具投影」或「策略里已有条目」之一，否则 400 `unknown_tool`（离线时仍可编辑/删除既有条目——否则断连后就改不了策略）。
  - P5 收尾：`config-transfer` 扩族（导出/导入/按区重置）；`config:doctor` 纳入（`items: 'tools'`）；漂移门登记该族**没有设置面**（v1 只做策略面与执行接线）——用显式的 `NO_UI_FAMILIES` 表而不是"不登记让它空转"。
  - 完成语义：本包交付「策略能配 + 执行真的照做」；不交付逐工具设置页（W5b/设置面批次）、不做 server 级熔断、不改四档判定的既有实现。
reopen: 逐工具策略设置页（tabular UI + 9223 实机腿）；按 server 的默认策略继承；超时/重试的策略化（现在只有 timeout）；`mcp_*` 投影名的稳定性（server 改名会导致策略失配——需要 id 映射表时另开）。
status: active
---

# BLOCK-204 · 阶段 3 B2 之一：MCP 逐工具策略面

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W5**（W0–W4 已 completed）。用户发令：2026-10-18「行！搞完W5」。

## 0. P0 勘察（实码）

| 事实 | 位置 | 现状 |
| --- | --- | --- |
| 投影上限 | `agent-tools/mcp-projection.js:35` | `MAX_PROJECTED_TOOLS = 40` 硬编码 |
| 调用超时 | `mcp/client-manager.js:22` | `CALL_TOOL_TIMEOUT_MS = 60_000` 常量，逐工具不可调 |
| 合同派生 | `mcp-projection.js:44-70` | 只看 `annotations.readOnlyHint`；用户不可改 |
| 启用/停用粒度 | `mcp-projection.js:82-100` | 只有 server 级（断开连接=全部消失），无逐工具开关 |
| 写面 | `routes/mcp-client.js` | 已有 400 出口，可挂新端点 |

## 1. 判定：patch + 新建薄层

逐工具策略是**新概念**，但落点/校验/集合形状全部复用既有件（`shared-config` 族 + `sanitizeItem` + `config-transfer` + `config:doctor`），不新建第二套。执行侧只改四处：投影过滤、上限来源、合同覆盖、超时透传。

## 2. 切面

- `core/packages/shared-config/config-schema.js`：+`mcp-tool-policy` 族（1 标量 + 4 条目字段）。
- `core/petri-server/helpers/mcp-tool-policy.js`（新）：store 读写 + 策略查询 + 上限。
- `core/petri-server/agent-tools/mcp-projection.js`：策略过滤 / 上限 / 合同覆盖 / 超时。
- `core/petri-server/mcp/client-manager.js`：`callServerTool` 增 `options.timeoutMs`（缺省仍是 60s）。
- `core/petri-server/routes/mcp-client.js`：GET/PUT `/api/mcp/tool-policy`（400 + diagnostics；unknown-tool 拒绝）。
- `core/petri-server/helpers/config-transfer.js` + `scripts/block199-config-doctor.mjs` + `test/block199-config-drift.test.mjs`：族接入三件套。
- `test/block204-*`：基线冻结 + 策略契约 + 执行接线（含"禁用后真不投影""超时真的传下去"）。

## 3. 红线

- **不改四档判定实现**（`agent-execution-policy` / 审批链一字不动）；合同覆盖只是"喂给既有判定的输入变了"。
- **不改** `readOnlyHint` 的默认推导方向（`auto` 分支逐字等于现状）。
- **unknown-tool 拒绝不许变成"整份拒绝"**：未知条目只拒该条，其余合法条目照常落盘（否则用户离线时改不了任何策略）。
- 凭据不合并、不新增依赖、不碰 G1+。

## 4. 落地记录（2026-10-18）

- **P0 基线**：`test/block204-mcp-tool-policy-baseline.test.mjs` 4/4 冻结三件事实（DEFAULTS=启用/60s/auto、上限默认 40、`auto` 合同派生逐字等于 CAP-1）+ 一条 HTTP 契约（unknown-tool→400+diagnostics、合法写入 200）。
- **P1+P2**：schema 加 `mcp-tool-policy` 族（`projectionLimit` 1–200 + `<item>.{tool,enabled,timeoutMs,contractMode}`）⇒ 注册表 **13 族 / 65 键**；`helpers/mcp-tool-policy.js` 落点（`{version, projectionLimit, tools[]}`，目录走 W4b 的 `data-paths`；读宽容只丢该条；`policyFor`/`projectionLimit`/`validatePatch`/`resetToolPolicies`）。
- **P3 执行接线四处**：①`_buildProjection` 过滤 `enabled:false`；②上限取 `projectionLimit()`（`MAX_PROJECTED_TOOLS` 只剩"注册表缺失兜底"且与基线同值）；③`contractMode` 覆盖合同输入（`read-only`→retrieval/none/R1、`mutating`→action/execution/R2、`auto` 原推导）；④`callServerTool` 增 `options.timeoutMs`，逐工具超时真的传下去。
- **P4 写面**：`GET/PUT /api/mcp/tool-policy`；unknown-tool 判定 = 当前投影 ∪ 已有策略条目（**离线仍可改/删既有条目**），新名字 400 `unknown_tool`，只报那一条。
- **P5 收尾**：`config-transfer` 扩族（导入只校验形状、**不做 unknown-tool 判定**——备份可能来自另一台机器）；`config:doctor` 纳入（`items:'tools'` + `projectionLimit` 标量）；漂移门新增 `NO_UI_FAMILIES` 并改造 UI 断言为 `UI_CARRIERS ∪ NO_UI_FAMILIES == 注册表族集合`（该族键全为 `ui:'none'` + 写明"v1 无设置页"理由）。
- **抓真一处**：`writeStore` 首版把"未传 projectionLimit"判成非法（`Number(undefined)=NaN`）⇒ partial 写入整批被拒，契约测当场抓到；改为"不传=沿用当前值"。
- 证据：`block204-mcp-tool-policy` 6/6 + `block204-…-baseline` 4/4 + 邻域（mcp-* / block160/163/199/201/202/203）全绿 + knip PASS + arch/循环 0 新增 + lint 0 error。
