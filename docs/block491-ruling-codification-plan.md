---
capability: block491-ruling-codification
status: active
phase: P0-LAUNCH
goal: 把用户对 BLOCK-322 / RULING-04 特征级引用 v2 的 D1–D5 裁决（2026-11-18 用户显式发令逐项确认）固化为可复算、可审计的机器可读契约与中性扫描器；只做裁决材料落地与契约冻结，不启动任何 SceneSpec 契约变更或 v2a/v2b/v2c/GD-T 几何实现票。
acceptance:
  - 五项裁决（D1 派生缓存 / D2 新增 aFeature·bFeature / D3 禁 OCCT 建几何 / D4 v2a 先行 / D5 数值一致性判据）逐项以推荐形态 + 用户原话固化，状态 ruled（本包只固化不实现）
  - 中性扫描器从本地主权真源（裁决材料 + 用户发令登记 + AGENTS 红线）机械复算六组读数，产出模型可读 ruling-codification 契约；HK-01 红绿先行（缺席红 + 篡改负测 fail-closed）
  - 零产品代码写面 / 零新依赖 / 零 SceneSpec 契约变更 / 观感 pending_human_eye 零代签 / 不碰 G1+
  - 一张牌一个串行槽位：本包 completed 后实现票（P4-05b / P3-03 v2a / v2b / v2c）保持 deferred_user_ruling，未获用户发令不启动
  - 六件套回写 + 定向测试 + closeout 门禁 + 证据落 acceptance/ + commit/push
reopen: 用户改判任一 D 项形态（如接受 OCCT 建几何或改回 nodeId#featureId 字符串语法）、或显式发令启动某个实现票（P4-05b / P3-03 v2a / v2b / v2c）时，本契约须同步重算并重开对应实现包
supersedes: 无（BLOCK-322 主纲仍在；本包是其 RULING-04 裁决的固化落地，不改主纲状态）
---

# BLOCK-491 · BLOCK-322-RULING D1–D5 裁决固化包

日期：2026-11-18 · 关联：[BLOCK-322 3D 全方位能力纲](./block-322-model3d-full-spectrum-plan.md) §3.5 RULING-04 · [RULING-04 v2 裁决材料](./block-322-ruling-04-feature-reference-v2.md) §4/§5

## 0. 一句话

RULING-04 v2 材料（2026-10-31）给出 D1–D5 五项裁决点与单一推荐，但状态始终是 `pending_user_ruling` / `reference`——「未裁决不开工」。2026-11-18 用户显式发令逐项确认采纳推荐形态并要求「以 RULING-04 另立新包」。本包把这份裁决**固化**为可机器复核的契约并冻结边界，**不动任何产品代码**；几何/数据模型实现另案待发令。

## 1. 裁决来源（原话留痕）

用户 2026-11-18 发令「开始 BLOCK-322-RULING」→ Agent 停下核实（发令所指执行序列不含本工作包、D1–D5 材料明写 Agent 不代答）→ 用户结构化裁决：

- **裁决方式**：采纳推荐形态——「D1 派生缓存 / D2 新增 aFeature、bFeature / D3 禁 OCCT 建几何 / D4 v2a 先行 / D5 数值一致性判据，据此正式立项后开工」。
- **canonical 依据**：以 `docs/block-322-ruling-04-feature-reference-v2.md` 为基础**另立新包**（不归并旧 BLOCK-322 completed-closable 主纲，也不占其槽位）。

> 本包只固化「裁决已采纳」这一事实与其边界；「开工」按 RULING-04 §5 的「每票独立可停」执行——本包即第一票（治理/契约票），几何实现票需用户逐票发令（见 §4 非范围）。

## 2. 范围（本包做什么）

1. **裁决回填**：把 RULING-04 材料 D1–D5 的「状态」行从推荐措辞对齐到 `ruled（2026-11-18 用户裁决）`，逐项附用户裁决形态；§9「本材料不承诺」保持，补一条落地指向本契约。
2. **契约冻结**：新增 `resources/ruling-codification/block322-ruling-codification.json`（模型可读），记录五项裁决的对象/推荐形态/用户原话/状态/实现票映射 + 边界（零新依赖/不改契约/观感零代签/实现票 deferred）。
3. **中性扫描器**：新增 `scripts/block491-ruling-codification.mjs` 纯函数，从本地主权真源（RULING-04 材料 + 本 plan + AGENTS.md + UI 台账 + package.json）机械复算六组读数；`--check` 复算比对，违反不变量抛错。
4. **消费测试**：`test/block491-ruling-codification.test.mjs`——HK-01 红绿先行（先写缺席红测试，再写实现转绿）+ 五裁决逐项锚定 + 篡改负测 fail-closed（改形态值/翻观感/加新依赖/放行 OCCT 建几何/改 deferred 为 active 一律红）。
5. **证据与台账**：快照 + 契约 + manifest（sha256）落 `acceptance/block491-ruling-codification/`；impact-map 挂 rule；六件套 canonical 回写；commit/push + snapshot 标签。

### 六组冻结读数（READING_IDS）

| id | 含义 | 真源 |
| --- | --- | --- |
| `rulings` | D1–D5 五项：对象/形态值/状态 ruled/用户原话在场 | RULING-04 材料 + 本 plan §1 |
| `featureIdentity` | D1 派生缓存 + sha/dimensions 版本键 + 不一致 fail-closed + D3 禁 OCCT 建几何 | 材料 §2/§4 + AGENTS 红线 |
| `referenceSyntax` | D2 新增 aFeature/bFeature 白名单键 + 旧场景零迁移 + 非 `nodeId#featureId` 字符串 | 材料 §4 D2 |
| `implementationTickets` | 实现票分期与 deferred：P4-05b / v2a / v2b 待发令、v2c 明确 deferred、不随本裁决项登记 | 材料 §5 |
| `gdtAcceptance` | D5 数值一致性判据（标注文本 + 视图投影坐标 + 解析尺寸一致），禁主观「像不像」 | 材料 §4 D5 |
| `boundaries` | 观感零代签 / 零新依赖 / 不改 SceneSpec 契约 / 零产品写面 / 不碰 G1+ | AGENTS + UI 台账 + package.json |

## 3. 非范围（exclusions · 红线）

- **不动产品代码**：`core/petri-server/helpers/scene3d.js`、`model3d-cad-drawing.js`、前端约束编辑器/查看器一律零改动。
- **不改契约**：SceneSpec 契约（`aFeature`/`bFeature`/`features[]`/`nodeId#featureId`）只登记为「已裁决 + deferred 实现」，不在本包落地。
- **不启动实现票**：P4-05b（GD&T 特征锚第一刀）、P3-03 v2a（旋转平面贴合）、v2b（features[] 数据模型 + 前后端）、v2c（曲面/边，材料已判 deferred）——均未获发令，保持 `deferred_user_ruling`。
- **零新依赖**：不引入任何 npm/pip 包；occt-wasm 仍是 RULING-01 已批只读依赖，本包不调用其建模 API。
- **观感零代签**：UI-706/707/709/710 + E 类人眼项保持 in_progress / pending_human_eye。
- **不碰 G1+**：不外推 Provider / 公证 / GA / packaged。
- **零触碰他方 WIP**：`docs/architecture/gateway-design.md`、`docs/pending-work-backlog.md`（C-56 行）、`docs/block490-capability-intake-review-plan.md` 均属他方/其他包，本包不改写其内容（README/DOC-REGISTRY 仅追加本包条目）。

## 4. 实现票映射（本包固化，另案发令）

| 票 | 内容 | 前置裁决 | 本包后状态 |
| --- | --- | --- | --- |
| P4-05b | `tolerances[].feature` 可解析引用 + HLR 出尺寸线/文字 | D1/D2/D5 | `deferred_user_ruling`（待发令） |
| P3-03 v2a | 求值器局部系→世界系合成，旋转平面贴合 | D4 | `deferred_user_ruling`（待发令） |
| P3-03 v2b | `features[]` 数据模型 + 基元派生 + CAD 抽特征 + 前端编辑器 | D1/D2/D3 | `deferred_user_ruling`（待发令） |
| P3-03 v2c | 曲面/边贴合与相切约束 | D4（v2a 先行，v2c 单列） | `deferred`（材料已判不做，等真实需求） |
| P4-04b / RULING-03 / P5-02 | IGES 导出 / 切片 CLI / 真实 key | 不随本裁决 | 维持既有判定 |

## 5. 证据位置

- `acceptance/block491-ruling-codification/ruling-codification-snapshot.json`（六组读数快照）
- `acceptance/block491-ruling-codification/manifest.json`（契约 sha256 对账）
- `resources/ruling-codification/block322-ruling-codification.json`（模型可读契约）
- 测试输出：HK-01 缺席红 + 转绿 + 篡改负测摘要（收口笔录留痕）

## 6. 验收门禁（收口逐项对账）

- `node --test test/block491-ruling-codification.test.mjs`（HK-01 红绿 + 逐读数 + 篡改负测）
- `node scripts/block491-ruling-codification.mjs --check`（复算一致）
- 零回归：RULING-04 材料结构仍在 + BLOCK-322 主纲 reference 未被改状态 + 观感四槽 in_progress
- `npm run docs:check` + `npm run ui:audit:check` + `npm run closeout`（定向）
- 六件套：plan / roadmap / handoff / AUDIT-LOG / DOC-REGISTRY / README 入口

## 7. 红旗归属（非本包）

- `docs/architecture/gateway-design.md`（他 agent WIP，零触碰）
- `docs/pending-work-backlog.md` C-56 行 / `docs/block490-capability-intake-review-plan.md`（规划条目，零触碰）
- post-h9 未跟踪蓝图 / test:changed evidence.json 债务 / 既有 lint/types 漂移（既有红，非本包文件面）

G0 开发期常态 · 不外推 packaged/Provider/GA。
