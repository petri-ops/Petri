---
capability: block-397-post-h9-k1-agent-mainline
status: active
goal: 按第四轮蓝图 §4 K1 逐件核实「已定义但未生效」的四类能力。凡声明被实码推翻的按证据校准；凡涉及既有用户裁决的出一页决策材料并停线跳项；可机械验证的兑现度用红绿先行 + 负测钉死，不新增能力、不建第二账本。
acceptance:
  - K-08/09/10 与 K-25 前置逐件有终态与证据/决策材料指针，无静默消失
  - 不撤销 mcp/registry.js:333「桌面版不写库」既有产品裁决，不向 ai_usage 灌零 token 行
  - 定义类（goals / viewer 能力位）有防回退行为断言与负测
  - U 类一页材料含现状/候选/风险/推荐/证据/补腿条件，Agent 不代答
  - docs:check / ui:audit:check / 定向 test:changed / closeout 全绿
reopen: 用户裁决 MCP 桌面计量语义或 tools_only/accessMode 档位后，按材料候选另立切片，不在本包改默认语义
---

# BLOCK-397 · post-H9 K1 通用 agent 主线兑现度

> 状态：active · P0-LAUNCH
> 发令：用户 2026-11-10 预授权连续工作「K0→K7 全部推完，全程零参与」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 立项自检（产品个性 · 强制问句）

**与 ZCode/Codex 的差别形态**：通用云端 agent 会把「定义已在」当「能力生效」；本包反过来把「不接线」也做成可审计证据：①**本地可审计**——四条声明逐件回溯到 file:line 与运行时行为断言，不靠文档自述；②**治理透明**——触及既有用户裁决（`mcp/registry.js:333` 桌面不写库、IDE 档位 reopen）一律出 U 类决策材料并停线跳项，不代答、不擅自改默认语义；③**证据自证**——「链上零 LLM 调用」由静态 require 图 + 真实 `callTool` 行为双证钉死，且带篡改负测。形态上这是「能力兑现度审计」而非「补功能」，不收缩通用 agent 主线，只是把模型计量一维的边界钉准。

## §2 运行时核实结论（三处蓝图声明被实码推翻/误判）

| 蓝图声明 | 实码核实 | 终态方向 |
| --- | --- | --- |
| K-08「MCP 执行链不写 ai_usage = 计量盲区，需把 recordAiUsage 接到 registry.js:333」 | **误判（范畴错误）**：`src/mcp-server.js` 是纯 stdio 壳；`mcp/` 全目录 require 图内 `llm-providers\|model-gateway\|llm-client\|callModelTask\|ai-usage-helper` **0 命中**；`skill_execute` 的 `skill-runtime.js` 也无 LLM。链上零 token 可计。`ai-usage.js:56-84` 是单表 token 计量，每次 MCP 工具调用写一行会灌 `tokens=0/model=null/kind='other'`，污染 `calls`/`unknownCostCalls`/会话·项目·供应商聚合，且 `conversationId=null` 进不了 `loop-orchestrator.js:754` 的熔断查询。`registry.js:333` 是**显式产品裁决**（无用户上下文），不是漏接 | `retain-with-reason` + U 类决策材料（若要改产品语义需用户裁决） |
| K-10「goals.js 3 个定义未被 16 域 facade require」 | **声明过时**：`agent-orchestration.js:208` `...require('./goals')`，三定义一直在 `TOOL_DEFS`；`test/block346-tool-defs-assembly.test.mjs` 已立自我纠错契约 | `done`（防回退契约加钉 3 个 goal 名） |
| K-10「viewerRegistry 6 个 adapter 能力位全 false」 | **声明过时**：`viewerRegistry.ts:68-86` 12 档中 table/json/text/markdown/model3d canSelect=true、table canCompare=true、markdown/pdf/video/svg-editor canExport=true（BLOCK-151/175/322/342 接线）；仅 report/image/binary/spreadsheet 三位全 false 且各有语义理由 | `retain-with-reason`（保留当前能力位，不新增零消费声明位） |
| K-09「tools_only / IDE accessMode 档位未强制」 | 现状成立但 `permissions.js:21-23` 是 granularity-2 预留，`contracts.js:11` 明写外部 IDE 无 Petri accessMode 会话概念、硬接会造「永远被拒」的假门 | `pending_user_ruling` + 一页材料 |

## §3 范围 / 非范围 / 依赖 / 风险

- **范围**：①K-08 证据校准（静态 require 图 + `callTool` 行为断言 + 篡改负测）；②K-09/K-08 产品语义 U 类一页决策材料；③K-10 定义类防回退契约（goals 三定义在 TOOL_DEFS、viewer 能力位消费面）；④K-25 前置：165 通道第一批「有用户入口」机械分诊 + 零消费检测可信度负测；⑤32 条台账 K-08/09/10/25 逐件终态。
- **非范围**（红线）：不向 `ai_usage` 写零 token 行；不新建第二计量账本/执行器/事件通道；不改 `mcp/registry.js:333` 的默认语义；不改 `tools_only`/`accessMode` 默认放行档；不撤销任何既有用户裁决；不为过门放宽任何基线；不动 10 项用户资产；不碰蓝图原件。
- **依赖**：K0（判据校准 + 台账基座 + 干净树）。
- **风险**：①K-08 若误接线会污染唯一计量账本 → 用行为断言 + 篡改负测把「不接」钉成可复跑证据；②U 类材料可能被误读为「已完成」→ 证据类标 `decision-material` 且 `verdict` 禁用 PASS/verified；③viewer 能力位前端测试为 `.test.ts`，需走 vitest 定向而非 node --test → 用 `getToolDefs` 之外的纯 TS 契约（本包只做 Node 侧可验证部分，前端位由既有 5 个 viewerRegistry 测试承载，不重复开发）。

## §4 touchSurface / sharedBaselines

- `touchSurface`: `docs/block-397-*.md`、`docs/post-h9-k1-*-decision-material.md`、`scripts/lib/post-h9-k1-*`、`test/post-h9-k1-*`、`acceptance/post-h9-2026-11-10/k1/**`、`acceptance/post-h9-2026-11-10/gap-terminal-ledger.json`、`test/impact-map.json`、canonical 六件套（治理工具同批回写）。
- `sharedBaselines`: `eslint-suppressions.json` / `test/knip-baseline.json` / `test/silent-catch-baseline.json` / `test/impact-map-coverage-baseline.json` 全部零改动。

## §5 验收门禁

| 门 | 命令 | 预期 |
| --- | --- | --- |
| K1 契约 | `node --test test/post-h9-k1-mainline.test.mjs` | 全绿 + 篡改负测 |
| 台账/证据 | `node scripts/lib/post-h9-gap-ledger.mjs` | ok=true |
| 文档/UI | `npm run docs:check` / `npm run ui:audit:check` | 全绿 |
| 收口 | `npm run closeout` | 全绿 |

## §6 完成语义

K1 的 `completed` = 「可机械验证子集 + 逐件终态 + U 类材料」。**未闭合**：MCP 桌面计量语义、tools_only/IDE 档位（U 类待用户裁决）；165 通道逐件销号的其余 2/3（归 K5）；成本熔断覆盖 MCP（需先有模型调用与 conversation 上下文，属结构性大改）。这些不写 completed/verified，逐件写补腿条件。

## §7 证据目录

`acceptance/post-h9-2026-11-10/k1/`，四字段齐备，U 类材料 `evidenceClass: decision-material`。

**入口直链**：[post-h9-k1-decision-material.md](./post-h9-k1-decision-material.md)（K-08/K-09 U 类决策输入，未裁决前不生效）。
