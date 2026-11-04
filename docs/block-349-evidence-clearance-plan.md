---
capability: block-349-evidence-clearance
status: planned
goal: 把 UI 台账里「代码完成、仅缺实机证据」的 13 条逐个实机跑通转 verified，或环境不可得时诚实降级 cancelled，使 in_progress 从 28 降至 ≤15。
acceptance:
  - 13 条每条有终态（verified 或 cancelled）+ 证据路径或不可得原因。
  - in_progress 条数 28 → ≤15（可机械复算）。
  - 每条 verified 必须有当次实机证据路径；无证据的 verified = 不通过。
  - 环境清单与终态表一一对应，无「未说明的挂起」；npm run ui:audit:check PASS。
reopen: G1+ 项；B 类 UI 面未交付两条（UI-513 / UI-534）不属本包；新增功能域；已取消四项不复活。
---

# BLOCK-349 — 13 条实机证据清偿（计划）

- 登记状态：**planned（2026-11-05 立项，逐包发令开工）**
- 总纲：`docs/next-phase-program-2026-11-05.md`
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md` §5 T-B；BLOCK-346 T8 五分类
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

---

## §1 立项依据

BLOCK-346 T8 对账把 28 条 `in_progress` 分成五类，其中 **A 类 13 条**是「代码与组件测试已完成、只缺真实数据/环境/运行时」：UI-382/383/384/386/387/390（条件腿，需真实子智能体数据）、458（tool_jobs 老化数据）、459（T5 状态门控残留）、471（真实隧道环境）、526（R 运行时）、532（tool_jobs 实机腿）、535（代码+组件测试完成）、389（500+ 文件夹具）。长期挂起会让「未验证」被误读成「未完成」，也让台账看起来欠账更重。

## §2 范围（逐条）

- **开工第一步先列环境清单**：真实子智能体数据 / tool_jobs 老化数据 / T5 状态门控残留 / 真实隧道环境 / R 运行时 / 500+ 文件夹具，逐条标「可得 / 不可得 + 原因」。
- 对 13 条逐条：写或复用一条**可复跑**实机探针（优先复用 `acceptance/` 既有 flow），跑一次，记录证据指针到 `acceptance/block-349/`。
- 探针通过：`docs/ui-productization-audit.md` 对应行 → `verified`，附证据路径。
- 环境不可得：状态 → `cancelled`，写明「环境不可得 + 具体缺什么 + 何时可补」，**不得继续挂 `in_progress`**。
- 产出清偿报告（`docs/block-349-clearance-report.md`）：13 行终态表 + 环境清单 + 仍挂起项处置建议。

## §3 非范围（越界即停工）

- 不补做 **B 类 UI 面未交付**两条（UI-513 跨端偏好同步、UI-534 MCP 货架治理控件）——那是能力缺口，不是证据清偿
- 不改 UI 台账状态词表（只用 `verified / in_progress / cancelled`）
- 不安装新运行时 / 第三方服务来「制造」实机环境（如实登记不可得即可）
- 不重新实现被测功能；不改 `scripts/check-ui-productization-audit.mjs` 放宽校验

## §4 验收（可度量）

- 13 条每条有终态（verified / cancelled）+ 证据路径或不可得原因
- `in_progress` 28 → ≤15，可机械复算（脚本输出条数）
- 每条 `verified` 有当次实机证据路径；收口前逐条人工复核路径存在
- 环境清单与终态表一一对应，无「未说明的挂起」
- `npm run ui:audit:check` PASS

## §5 门禁（机械）

- 新增 `test/block349-clearance.test.mjs`：终态表完整性、`verified` 必有证据路径
- 新增探针登记 `test/impact-map.json`（含 `acceptance/block-349/**`）
- `npm run ui:audit:check` / `docs:check` / `quality:surface` / `quality:knip:check` / `closeout` 14 门
- 开工前总纲 §6.1、收口 §6.2 检查单

## §6 依赖 · 风险 · 边界

### 6.1 依赖

无（可与 348 并行，但按单包纪律串行排第 2）。BLOCK-351 依赖本包产出的可复跑探针。

### 6.2 风险登记

- R 运行时 / 真实隧道 / 真实子智能体数据本机可能确实没有 → 走 `cancelled`，**不得伪造证据**
- 并行会话可能同时在改 UI 台账 → 开工前 `git status` 核对，改动用行级精确替换
- 「verified」写错即台账污染 → 收口前逐条复核证据路径存在
- UI 台账 122KB+ 近单读阈 → 摘要行等量替换，必要时 `npm run audit:compact`

### 6.3 touchSurface

`docs/ui-productization-audit.md`、`acceptance/block-349/**`、`scripts/block349-*.mjs`、`test/block349-*.test.mjs`、`docs/block-349-*.md`、`test/impact-map.json`

### 6.4 sharedBaselines

`test/impact-map.json`、`test/functional-surface-baseline.json`、`eslint-suppressions.json`、`acceptance/block-92/size-baseline.json`（若改 UI 组件）

## §7 完成语义（DoD）

13 条终态表 + 环境清单 + 报告落盘；`in_progress ≤15` 可复算；`ui:audit:check` PASS；总纲 §8 填行；registry → completed；README / roadmap / backlog / AUDIT-LOG 回写；`docs:reconcile` 0 issues；`closeout` 全绿。

**本计划不是开工授权**；状态流转与范围变更按总纲 §2。
