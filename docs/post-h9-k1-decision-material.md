---
capability: post-h9-k1-decision-material
status: reference
goal: 为 K-08（MCP 桌面计量语义）与 K-09（tools_only / IDE accessMode 档位）提供 U 类决策输入，未裁决前不生效。
acceptance:
  - 含现状/候选/风险/推荐/证据/补腿条件六段
  - 不代答、不改默认语义、不冒充行为测试或实机证据
reopen: 用户裁决后按候选另立切片
---

# post-H9 K1 U 类决策材料：MCP 计量语义 / 权限档位

> 状态：pending_user_ruling（**Agent 不代答**）。本材料是决策输入，不是验收证据；`evidenceClass: decision-material`，`verdict` 禁用 PASS/verified/completed。
> 生成：BLOCK-397（2026-11-10）。依据：第四轮蓝图 §4 K1、§5.3 停线条件、用户红线「不撤销任何既有用户裁决 / 不新建第二计量账本」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 决策 A · MCP 桌面执行链是否改变「不写 ai_usage」语义（K-08）

### 现状（实证，非推测）

| 事实 | 证据 |
| --- | --- |
| `src/mcp-server.js:27-42` 是纯 stdio 协议壳：`callTool(name, args)` 只取 `params.name/arguments`，无 `userId`/`conversationId`/DB 用户态 | file:line |
| `core/petri-server/mcp/` 全目录 require 图内 `llm-providers`、`model-gateway`、`llm-client`、`callModelTask`、`ai-usage-helper` **0 命中**；`skill-runtime.js` 全文无 llm/model/inference/fetch | 静态扫描（K1 契约门复跑） |
| `mcp/registry.js:333` 注释「ai-usage 桌面版不写库（无用户上下文），不注入（helper no-op）」是**显式产品裁决**，不是漏接 | file:line |
| `helpers/ai-usage.js:56-84` 每次 `recordAiUsage` INSERT 一行到**唯一** `ai_usage` 表；字段为 token/延迟/成本遥测（`:16-37`） | file:line |
| 读面 `summarizeAiUsage` 按 `conversationId` 过滤（`:87-92`），项目口径明确排除 `conversation_id` 为空的行（`:157`）；成本熔断在 `loop-orchestrator.js:749-765` 每轮请求前消费该聚合 | file:line |
| MCP 子进程 DB 句柄来自 `registry.js:310-315`，与主链不是同一连接对象；`src/main/env-coordinator.js:271-280` 才注入 `PETRI_DB_PATH`，stdio 子进程 env 未继承时可能打开不同库 | file:line |

**结论**：链条是「文件/git/R/Python 工具执行」，不是模型推理链；零 token 可计。蓝图 §2.1 把「MCP 不写 ai_usage + 熔断只在主链」推成「计量盲区」是范畴错误。

### 候选

| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **A1（推荐）** | 保留现状：`registry.js:333` 不注入；把「为什么不接」钉成机械证据与决策材料 | 不污染账本、不推翻裁决、零产品风险；通用 agent 主线「模型计量」维度边界被钉准 |
| A2 | 把 `recordAiUsage` 注入 `registry.js:333`，每次 `callTool` 写一行 | **污染**：`tokens=0/model=null/kind='other'/cost_status=unknown` 抬高 `calls` 与 `unknownCostCalls`，扭曲会话/项目/供应商聚合与 UI 计量条；且 `conversationId=null` 根本进不了熔断查询 → 花代价买到假闭环 |
| A3 | 新建 MCP 专用计量表/通道 | 违反红线「不新建第二计量账本 / 事件通道 / 台账」；且无 token 可计，表必然空转 |
| A4 | 让 stdio 壳透传 `userId`/`conversationId` 并接主链熔断 | 需先有模型调用 + 同 DB 文件 + conversation 上下文 + 判定点，四项当前全不满足；属结构性独立切片，非 K1 范围 |

### 风险

- A2/A3 会把 `ai_usage` 从「模型调用遥测」变成「混合事件日志」，使 `quality:ear`、成本熔断、`summarizeProjectUsage` 三条既有读面同时失真——这是**可靠性维度倒退**，不是兑现。
- A4 若改默认语义，等于撤销 `registry.js:333` 的用户裁决；红线禁止 Agent 代做。

### 推荐

**A1**：本包不动默认语义，只做证据校准（K1 契约门：require 图零 LLM、`callTool` 行为断言、篡改负测）。若用户后续裁决要改变「桌面版不写库」，按 A4 单独立项，前置条件见下。

### 证据（当前）

`acceptance/post-h9-2026-11-10/k1/k1-mcp-metering-truth.json`（静态 + 行为双证），`test/post-h9-k1-mainline.test.mjs`（含篡改负测）。

### 补腿条件（若裁决走 A4）

1. 明确 MCP 链何时产生模型调用（当前零），以及 `userId`/`conversationId` 从哪个入口注入；
2. 明确 stdio 子进程与主链同一 `PETRI_DB_PATH` 的传递契约（含 env 未继承时 fail-closed）；
3. 明确成本熔断判定点是否下沉到 MCP 子进程，以及与 `loop-orchestrator.js:749-765` 如何同源（不得第二判定器）；
4. 前后同套定向测试绿 + 负测；上述四条未齐前不改 `registry.js:333`。

---

## 决策 B · `tools_only` 与 IDE `accessMode` 档位是否强制（K-09）

### 现状

- `helpers/permissions.js:21-23`：`tools_only`（数组）解析但 `not yet enforced`，是 granularity-2（按工具）预留；`:135-137` 保留数组占位，`:103-107,146-182` 的 `can`/`_enforce` 从不读它。`:195-197` 另有异步派发权限门占位。
- `mcp/ide-tools/contracts.js:11`（文件头）：外部 IDE（Cursor/VSCode 插件）没有 Petri 侧 `accessMode` 会话概念，硬接会造「外部 IDE 永远被拒」的假门；当前 18 个 `ide_*` 由 `confirmPolicy`（always/overwrite/false）统一在 dispatch 层强制高风险写操作确认。
- `mcp/ide-tools/index.js:107,120` 档位接入留 reopen。

### 候选

| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **B1（推荐）** | 维持现状：`tools_only` 保留为 schema 预留、IDE 维持 `confirmPolicy` 单轴；出材料等裁决 | 不造「外部 IDE 永远被拒」假门，不动默认放行档 |
| B2 | 全面强制 `tools_only` 白名单 | 触及 `moduleGate` 与工具分发，需定义「未配置 = 全放行还是全拒绝」的产品语义；配错会静默拒绝所有工具 |
| B3 | 把 Petri `accessMode` 映射到外部 IDE 调用 | 需先定义外部 IDE 的信任边界与会话协商（BLOCK-346 T5 同源 reopen），否则审批 UX 与执行语义不一致 |

### 风险

B2/B3 都会改变**默认放行语义**（用户已裁决面），且 B3 与「MCP trust 与 capability token 两轴分离」既有裁决可能冲突；在无外部 IDE 实机（V 类）时无法验证「不被误拒」，任何「已强制」声明都无证据。

### 推荐

**B1**。若裁决走 B2/B3，须先：①定义默认档与兜底语义（fail-closed 还是 fail-open）并留痕；②复用 `agent-tool-policy.js` / `mcp-tool-policy.js` 单一策略入口，不建第三套权限系统；③补外部 IDE 实机腿（V 类）与越界负测。

### 证据

`acceptance/post-h9-2026-11-10/k1/k1-permission-tier-truth.json`、`test/post-h9-k1-mainline.test.mjs`（档位未强制的机械核实 + 负测）。

### 补腿条件

用户裁决 + 外部 IDE 实机可达 + 默认档语义定义；三者未齐前不改 `permissions.js` / `contracts.js` 默认语义。

---

## 边界声明

本材料覆盖 U 类两项（K-08 产品语义、K-09 档位）。**未裁决前不生效**、不写 verified/completed、不冒充行为测试或实机证据。按蓝图 §5.3，K1 不停线空等，队列推进到下一可开工项（K-10 定义类防回退、K-25 前置分诊）。
