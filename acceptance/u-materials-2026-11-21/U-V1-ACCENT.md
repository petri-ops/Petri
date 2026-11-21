# U 材料 · V1 accent 剩余合法语义（2026-11-21 · pending_user_ruling 零代答）

> 现状现读：c53 accentTotal=**269**（V1 356→V1-U 316→269）；`targetMet=false` 诚实未达（内部目标 ≤130）。
> 269 中 ~186 处为 design-charter §2 明确允许的**五类合法语义**（主按钮/激活选中/链接/焦点环/状态），
> 被 theme-token-contract 棘轮逐文件冻结为合法（acceptance/v1-accent-scarcity/GATE-LEDGER.md 在案）。

## 可选方向（GATE-LEDGER 原文四项，任何一项都改变交互观感）

| 方向 | 净减 | 剩余 | 代价 |
|---|---|---|---|
| A hover accent 字色→中性 hover（反馈靠底/边框） | ~47 | ~222 | hover 反馈弱化（彩色字→灰） |
| B active 选中字色→text-primary+保留 accent 底 | ~54 | ~215 | 选中态字色不再着色 |
| C focus 环→中性 --petri-ring | ~52 | ~217 | 焦点环失去品牌色一致性 |
| D 维持现状 269 | 0 | 269 | 内部目标 ≤130 判「合语义下限已达成」 |

## 单一推荐：**D 维持现状**（一句理由）

186 处全是宪章允许的交互反馈语义（不是装饰滥用），强改 A/B/C 每项都牺牲已验证的交互反馈
（A4 预审 46/46 与 UI-717 全量 verified 的观感基线会变）；≤130 是内部天花板不是你的诉求原话——
若你要「更素」，可对 A/B/C 单项单独发令走偏好预审（每项独立可逆）。

## 裁决格式

`U-V1-ACCENT：D（维持）` 或 `U-V1-ACCENT：A`（等单项代号）；裁决后回写 GATE-LEDGER+targetMet 口径。
