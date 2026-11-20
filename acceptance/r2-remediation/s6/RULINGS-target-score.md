# S6c 目标分 4.4 方向性门槛 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S6c（P0-4）· 预置裁决 R6（采纳 4.4 为方向性门槛，现读评分卡与缺口明示，不伪造/不放宽/不改口径）。

## R-S6c-1 现读（2026-11-21）

- 评分卡（`acceptance/ui-design-assessment-2026-11-11/d5/before-after-scorecard.json`，静态复评口径）：
  after A=3.8 / B=3.5 / C=4.0 / D=4.7 → **综合 4.0**。（R2 报告引 4.1 为 V234 批口述值，现读 JSON=4.0，以现读为准。）
- `targetPerDimension=4.4` 此前标 U-02 `pending_user_ruling`（checklist §5:78 + scorecard honestBoundaries）。

## R-S6c-2 采纳（单一最合理选择）

4.4 采纳为**方向性门槛**（directional threshold，非放行门禁）：
- 回评方向锚：后续复评以 4.4 为目标线；现读 4.0，**缺口 0.4 明示**。
- B 维（观感维度）受「签字槽全空 ⇒ 持平不虚高」口径压制——人眼签字（或偏好预审闭环）是 4.4 的必要路径之一，
  无偏好覆盖的观感维度不代签（R12），故缺口主要由 A/C 维机械项 + B 维人眼签字两条腿收敛。
- ≤3 轮达不到则如实登记「目标 4.4 / 现读 x.x」，不伪造分数、不放宽判据、不改评分口径凑达标。

## R-S6c-3 落点

- `docs/ui-design-acceptance-checklist-v1.md` §5（评分公式 canonical）：建议值条目改为「已采纳为方向性门槛」+ 现读/缺口/边界。
- `scripts/ui-design-scorecard.mjs` honestBoundaries：U-02 pending 行改为已采纳 + 缺口明示（未来复评分产出时边界随行）。
- 历史 d5 JSON **不重算不改写**（11-11 批归档证据，回溯改历史分被 checklist §5 明令禁止）。

## 出口核验

- `node --check scripts/ui-design-scorecard.mjs` OK；docs:check 随 S8 收口链复跑。
- HK-01 豁免（纯治理文档/判据登记批，无行为契约）。
