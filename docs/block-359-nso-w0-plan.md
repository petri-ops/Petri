---
capability: block-359-nso-wave0-fact-freeze
status: active
goal: 事实冻结与门禁复绿——分离 HEAD/WIP、修复 lint/code-size/perf 真红、工具数与领域中性基线单源化或显式裁决、全量测试分片有界、canonical active 槽位与 AUDIT-LOG 旧票对账，为 NSO W1-W7 建立可复跑、可归因的起点。
acceptance:
  - HEAD↔WIP 清单机器可读（acceptance/nso-2026-11-06/wave-0/wip-inventory.json），三面归属 + 零触碰纪律在案
  - lint 0 error；gate:code-size PASS（重打留因或 scoped 重构）；quality:perf 双判据 + 连续 5 次 PASS + 负测仍红
  - 工具数基线单源化（3 个测试读 tool-defs facade）；领域中性 deseq2 修正文案（不放宽棘轮）；model-surface 显式裁决（WIP 归因，W1 落地重打）
  - 全量测试三段分片有界（Node/前端/长时实机），task:run 记录 exit.json，超时=未知不写 PASS
  - canonical 对账：active 槽位唯一、AUDIT-LOG 旧 P1 票逐件核销、handoff/roadmap 与 registry 一致
  - evidence 落 acceptance/nso-2026-11-06/wave-0/；closeout 在当前树跑并如实分账（WIP 绑定红单独归因）
reopen: 蓝图任一波次范围变化或 WIP 归属裁决变化时由用户重新发令更新本 plan
---

# BLOCK-359 · NSO-W0 事实冻结与门禁复绿

> 蓝图依据：[`next-stage-optimization-blueprint-2026-11-06.md`](./next-stage-optimization-blueprint-2026-11-06.md) §3。用户预授权原话：「我在此预先授权连续工作：W0 收口后自动进入 W1，依次 W0 → W1 → W2 → W3 → W4 → W5 → W6 → W7，不逐项回来请示；所有常规工程判断由你自决并留痕。」

## 1. 范围、非范围、风险与触碰面

**核心纪律：WIP 在制批零触碰**（三面清单见 [`acceptance/nso-2026-11-06/wave-0/wip-inventory.json`](../acceptance/nso-2026-11-06/wave-0/wip-inventory.json)）。

- **非范围**：①WIP 在制批（wip-agent-resilience-candidate 全部文件）零触碰，W1 评审后落地；②用户资产与临时目录（`assets/`、`model3d/`、`petri-logo*`、`tmp-*`、`pelican-bicycle.html`）不动；③不新增依赖、不放宽任何棘轮基线、不重打 P6 证据、不外推 packaged/Provider/GA；④C-46 兄弟仓不改、C-47 不猜测性修复、O-1 人眼项不代答。
- **风险**：①WIP 在场使 `test:changed` 含 2 条 WIP 绑定红（model-surface / p6 dirty-tree）——按 inventory `attributedReds` 归因，W1 落地后复绿；②`p4r-invariants` 依赖兄弟仓 `../petri-pack-bio`（已在位，待复测确认）。
- **触碰面**：`modelConfigAndCollapse.test.tsx`（lint）、`workspace-tools.js` 判定 + code-size 台账、`scripts/block350-perf-gate.mjs` + 契约测试、block116/block157/tool-activity-labels（工具数单源）、`FederationJobs.tsx`（领域中性文案）、`package.json` + 分片脚本、canonical 六件套。
- **完成语义**：本 plan 验收逐条对账 + closeout 当前树分账 + 台账回写 + 显式路径提交；W1 吸收 WIP 后干净树复跑 `closeout:full` 复绿为 W1 责任。

## 2. 验收门禁清单（收口逐项对账）

1. lint 0 error（修 `modelConfigAndCollapse.test.tsx:40-41`）
2. `gate:code-size` PASS（workspace-tools.js 判定 + PluginStorePanel 例外清理）
3. `quality:perf` 双判据 + 连续 5 次 PASS + 负测仍红
4. 工具数单源（block116/block157/tool-activity-labels 读 facade）
5. 领域中性 `deseq2` 文案修正（实码核对后）；model-surface 显式裁决（WIP 归因）
6. 全量测试三段分片有界 + exit.json
7. canonical 对账（active 槽位/AUDIT-LOG 旧票/handoff/roadmap）
8. closeout 当前树分账 + 证据落 `acceptance/nso-2026-11-06/wave-0/`

## 3. 收口状态（2026-11-06）

- **交付项**：§2 验收门禁清单 1–7 全部完成，证据见 `acceptance/nso-2026-11-06/wave-0/`（README 为索引）。
- **收口门禁**：`npm run closeout` 在 test:changed 门 FAIL（未 SKIP、未放宽）。红项全部归因：
  - 在制批绑定（会话开始时既存的 22+10 在制集，零触碰）：`block325 model-surface`（system-prompt 增长 993→1083）、`g0-rs-p6`（P6 源文件失配 5 个，其中 3 个为在制批文件 result-context-binding.js / anthropic.js / model-gateway.js，另 2 个 package.json / impact-map.json 随本包提交后需 P6 源绑定重算）；
  - 兄弟仓 C-46：`p4r-invariants` 1 红 + 7 取消（deseq2.R 语法错，未授权不改）；
  - 存量 HEAD 红：`ui-ledger-status-contract` 证据债棘轮（受阻 24 > 上限 23，来源 = UI-695 提交新增段且命中外部条件词；测量证据已按契约要求重跑同步，上限未放宽；闭合路径 = W3 UI-695 实机腿）。
- **阻塞**：在制批同时与 W1 文件面重叠（loop-orchestrator / model-gateway / model-fallback-policy / agent-loop-control）。按用户红线「若这些 WIP 阻断验收，停下给出唯一阻塞问题」，本包停在收口前，等待在制批处置裁决；裁决后在干净树复跑 `closeout:full` 并完成 P6 源绑定重算，再翻 completed。
