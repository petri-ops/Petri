---
capability: block-396-post-h9-k0-criteria-baseline
status: completed
goal: 按第四轮蓝图 §4 K0 校准被实测推翻的判据、统一九组数字口径、给并发 WIP 与两个红门归属、补 lint∩hygiene 联动门，产出可机械恢复、当次取数的干净起点；本阶段不做优化。
acceptance:
  - 三条旧判据有作废记录 + 新判据负测（篡改证据必红）
  - k0-canonical-readings.json 在册，九组读数带 source/command/capturedAt/sourceCommit
  - lint∩hygiene 联动门有负测（植入临时产物必红），且不污染既有 lint 基线
  - WIP owner 归属表零未知 owner；两个红门在干净树重跑不复发
  - docs:check / ui:audit:check / 定向 test:changed / closeout 全绿；docs:reconcile 候选逐件复核
reopen: 工作区出现新并发写入者或判据证据被改写时，重跑 K0 三条判据契约与读数采集
---

# BLOCK-396 · post-H9 K0 判据校准与可信起点

> 状态：completed · COMPLETED
> 发令：用户 2026-11-10「按 docs/post-h9-optimization-blueprint-2026-11-10.md 从 K0 到 K7 全部推完，直到总收口」，显式预授权连续工作、全程零参与；工程判断/切片/顺序微调全部下放。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。
> 蓝图依据：§4 K0、§3 K-01～K-07、§6.2 最小 DoD、§5.3 停线条件。

## §1 立项自检（产品个性 · AGENTS.md 强制问句）

**与 ZCode/Codex 的差别形态**：本包不新增能力，只做「尺子准不准」。差别形态 = ①**本地可审计**：九组读数全部由仓库内脚本从权威源复算，带 `sourceCommit/platform/command/generatedAt`，任一 Agent 可离线复跑，不依赖云端报告；②**治理透明**：WIP owner 归属表与红门归属写进证据 JSON，不靠聊天记忆；③**证据自证**：三条被实测推翻的判据不是「文档声明作废」，而是用可篡改即红的负测把作废钉成机械契约——这是通用 agent 可靠性维度的形态，不是领域内容。对标产品借「判据先行」之形，落「证据可复算」之魂。

## §2 运行时事实校准（reopen 条款优先于蓝图写作时读数）

| 项 | 蓝图 §1.2 写作时 | 本次运行时读数（2026-11-10） | 处置 |
| --- | --- | --- | --- |
| HEAD | `6dc6ae86` | `a33a53cc`（BLOCK-395 收口） | 以运行时为准 |
| 并发 WIP | 10 M + 20 untracked，写入者活跃 | **0 M**，untracked 10 项（9 项 user-asset-guard 保护 + 蓝图原件） | K-05/06 的 W 前置已由其 owner 收口 |
| `ui:audit:check` | FAIL(1) | **PASS**（633 个带证据 UI 编号） | 不写产品缺陷，也不复用旧绿 |
| `quality:lint` | FAIL(1)，错误源漂移 | **0 errors / 2389 warnings**（warnings 属存量 `security/detect-object-injection`） | 在干净树重跑不复发 |
| `docs:check` | PASS 528 | **PASS 530 registered**（AUDIT-LOG 81KB 建议级提示） | 530 是当前基线 |

→ 结论：**K0 的「等在制 H10 收口」依赖已满足**，本阶段按当前读数重建起点，不空等、不代改他方文件。查证命令与输出见 `acceptance/post-h9-2026-11-10/k0/k0-start-baseline.json`。

## §3 蓝图声明勘误（原文零触碰，红线保护）

蓝图是 untracked 文件，用户红线「不动 10 项用户资产与任何未跟踪在制 WIP（不代改、不暂存、不代提交、不清理）」→ **本程序全程不改写蓝图原件**；勘误登记在 K0 证据与 canonical 台账，不产生第二份状态真相。

1. §0.2/§2.2/§3 写「400/800 档与 100 档同为 7202 节点」→ 证据 `h8/dom-budget-live.json:166,438,506` 实为 `100 档 allNodes=3052`，400/800 档各 7202；真正相同的是 100/400/800 档的 `convRowMatches` 同为 500（plateau）与 400/800 两档全字段相同。K0 新判据以 plateau 为准。
2. §2.1/§3 K-10「goals 3 个定义未被 facade require、viewer 6 个能力位全 false」已被后续代码推翻（goals 经 `agent-orchestration.js:208` 间接汇编进 TOOL_DEFS；viewerRegistry 12 档能力位已接线）→ 归 K1 逐件 retian/retain 判定，不重复开发。
3. §4 K1「熔断挂载在 routes/ai-agent/cost-cap.js」表述不准：该文件只是 GET/PUT 设置面，真正熔断在 `loop-orchestrator.js:681-765`；`mcp/registry.js:333` 的「桌面版不写库（无用户上下文）」是**既存产品裁决**，按红线不撤销 → K1 出 U 类决策材料而非擅自接线。

## §4 范围 / 非范围 / 依赖 / 风险

- **范围**：三条判据作废+新判据负测；九组数字口径机器可读单源；`lint 扫描根 ∩ hygiene 未跟踪临时产物` 联动门（K-05 同类第二次复发防护）；WIP owner 归属表；README 第 2 行 `active` → `completed` 与 registry 对账；`audit:compact` 自稳；`docs:reconcile` 候选逐件复核；干净树门禁取证。
- **非范围**（明确不做）：不做任何优化（K0 目标即「尺子不准时不优化」）；不改 `ai-conversations.js` 的 LIMIT 100（归 K2）；不改 `eslint-suppressions.json` 基线；不改蓝图原件；不代提交 10 项 untracked；不撤销任何既有用户裁决；不新建第二台账/执行器/计量账本。
- **依赖**：无上游（全程序前置）；下游 K1–K7 依赖本阶段判据与读数。
- **风险**：①`audit:compact` 搬移会改 AUDIT-LOG 行数 → 处置=搬移不改写、跑完 `docs:check` 验证入口直链；②治理工具改 registry 采用 2-space canonical 整体重写 → fail-closed 守卫 + 负测；③新脚本引入 knip 死导出 → 工具与库均不导出未消费符号，K0 收口跑 `quality:knip:check` 验证。

## §5 touchSurface / sharedBaselines

- `touchSurface`: `docs/block-396-*.md`、`docs/README.md`、`docs/DOC-REGISTRY.json`、`docs/next-steps-roadmap.md`、`docs/project-workspace-handoff.md`、`docs/AUDIT-LOG.md`、`scripts/post-h9-*`、`scripts/lib/post-h9-*`、`test/post-h9-*`、`acceptance/post-h9-2026-11-10/**`、`test/impact-map.json`。
- `sharedBaselines`: `eslint-suppressions.json`（零改动）、`test/knip-baseline.json`（零改动）、`test/silent-catch-baseline.json`（零改动）、`test/impact-map-coverage-baseline.json`（零改动）。
- **并行**：单包串行，本阶段唯一 active work-package；G0-LF 为常驻 living-plan 不占槽位。

## §6 验收门禁（收口时逐项对账）

| 门 | 命令 | 预期 |
| --- | --- | --- |
| 判据作废契约 | `node --test test/post-h9-k0-criteria-void.test.mjs` | 全绿，含 3 条篡改负测 |
| 读数/证据/台账契约 | `node --test test/post-h9-evidence-and-ledger.test.mjs` | 全绿，含负测 |
| lint∩hygiene 联动门 | `node scripts/post-h9-k0-lint-hygiene-gate.mjs` + 契约测 | 全绿，含植入负测 |
| 治理工具负测 | `node scripts/post-h9-governance.mjs selftest` | 12/12 |
| 文档/UI 门 | `npm run docs:check` / `npm run ui:audit:check` | 全绿 |
| 收口链 | `npm run closeout` | 19 阻塞门 + 1 报告级 |
| 干净树 | `npm run closeout:full` | 全绿（干净树重生成产物后） |

## §7 完成语义

本阶段 `completed` 仅指「可机械验证子集 + 逐件终态」：K-01/02/03/04/07 有当前证据闭合；K-05/06 以 W 类归属收口（owner 已收口、Agent 零触碰）；需 CDP 实机/人眼的 DOM 8 档重立与 debt 观感逐件标 `external-blocked`/`pending_human_eye` 并写补腿条件（归 K3/K5/K7）。**未跑、跳过、复用证据一律如实标注，不写通过。**

## §8 证据目录

`acceptance/post-h9-2026-11-10/k0/`，每份 JSON 带 `sourceCommit / platform / command / generatedAt / evidenceClass / verdict`。
