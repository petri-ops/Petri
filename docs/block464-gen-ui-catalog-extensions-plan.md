---
capability: block464-gen-ui-catalog-extensions
status: active
goal: W11 P4 catalog 扩展点深化（BLOCK-464）——compose spec 模板库（CP-12 spec 化）+ visualize skill 双形态分工补章 + pack.json provides.composeTemplates 投影契约（领域包 manifest 段，fail-closed 白名单）+ 零内核改动判据复验（领域入驻配方复验：增量全落 pack-contributions 配方面与 skill/模板资产）
acceptance:
  - HK-01 红绿先行：模板命中契约（每模板过 parseComposeSpec）+ 投影契约测试（白名单/上限/非法 entry fail-closed）先红后绿
  - 3 个 compose spec 模板 JSON 在册（overview/table-report/trend-chart）且全部可渲染
  - visualize skill 补章（::compose vs ::visualize 双形态分工）过 skills:check
  - pack-contributions composeTemplates 段 additive（沿 BLOCK-216 LIMITS 模式）；demo pack fixture 契约测试在册；/api/packs/contributions 自动透出
  - 内核面零 diff 证明（agent-runner/registry/IPC channels/routes 增量仅投影配方面）
---

# BLOCK-464 · W11 P4 catalog 扩展点深化（active / P4-LAUNCH）

> **发令**：用户 2026-11-18「好的 按照你的建议 继续推进」（= Jev 单一建议 gen-ui P4 catalog 扩展点深化获批）。
> **从属**：`docs/gen-ui-data-plane-evaluation-2026-11-17.md` §9 P4（CP-12 模板 spec 化 + visualize skill 补章 + catalog 扩展点契约）+ `docs/petri-master-charter.md`。
> **存量对账（plan 差异）**：CP-12 的 HTML fragment 模板库已由 BLOCK-174 交付（bar/line/kpi/table + skill 模板优先节）——评估的「模板 spec 化」指把模板思想搬进 ::compose spec 世界；「catalog 扩展点契约」的 pack 投影机制已由 BLOCK-216 立好（provides 白名单 + LIMITS + /api/packs/contributions），本包只加 additive 段，不建第二投影。

## 1. 范围（scope）

1. **A · compose spec 模板库（CP-12 spec 化）**：`resources/gen-ui/compose-templates/` 三个 spec 模板 JSON——`job-overview.json`（card+metric 组）、`table-report.json`（card+table 组）、`trend-chart.json`（card+chart 组）；每模板带 `description` 与占位说明（模型复制填值）。模板命中契约测试：逐模板 `parseComposeSpec` 绿 + ComposeTree 渲染断言。
2. **B · visualize skill 双形态分工补章**：`resources/skills/visualize/prompts/system.md` 增「::compose（结构化受控渲染）优先」节——结构化数据展示（指标/表格/图表/3D 产物引用）优先 `::compose` spec；交互式/富可视（自绘 SVG/D3、表单、动画）才走 `::visualize` HTML fragment；两条指令并存非替代。过 `npm run skills:check`（skill-integrity --write 随批重算）。
3. **C · pack catalog 扩展点契约 v1（领域包 manifest 段）**：`core/petri-server/helpers/pack-contributions.js` 新增 `provides.composeTemplates[]` 投影段——白名单字段 `{id, title, description?, spec}`、上限（沿 LIMITS 模式：8 条/spec 4KB/id 64/标题 120）、`spec` 必须过投影侧轻校验（version/root/nodes 形状与 compose spec 同构；非法条目丢弃 + diagnostic，fail-closed）；`/api/packs/contributions` 自动透出（既有 REST 零改动）。demo fixture 契约测试红绿。**消费面 v1 = 模型可读**（skill 补章指引模型经 `/api/packs/contributions` 查领域模板；模板正文也可由包 promptFragments 承载）；前端 UI 消费与组件 kind 扩展（新 renderer 注册）= v2 候选如实登记不冒充。
4. **D · 零内核改动判据复验**：diff 分析入 acceptance（agent-runner/mcp registry/IPC channels/前端内核组件零 diff；增量=pack-contributions 投影配方 additive + skill/模板资产）。

## 2. 非范围（exclusions）

- 前端 UI 消费 pack 模板（模板选择器/插补 UI）——v2 候选；
- 组件 kind 级扩展（领域新 renderer 执行面）——需前端组件注册与安全审计，v2 另裁；
- pack.json 其它段/安装注册表（pack-registry 零改动）；
- ::visualize 沙箱链行为改动（skill 补章只加指引）；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`compose/templates.test.tsx`（模板命中+渲染）+ `test/block464-pack-compose-templates.test.mjs`（投影白名单/上限/非法丢弃）先红后绿。
- **G2 零回归**：gen-ui compose 邻域 + pack-contributions 既有测试全绿；skills:check PASS。
- **G3 内核零改动**：diff 分析入 acceptance。
- **G4 治理**：closeout 定向门 + impact-map 登记。

## 4. 完成语义

completed = G1–G4 全绿或明确 external-blocked + 六件套回写。无观感面（skill/模板/投影均非用户 UI 写面；如实登记于证据）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
