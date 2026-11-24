# G0 distinctStates 裁决落地 + UI-706 口径翻正（2026-11-24）

## 用户发令与裁决

「行，能否一次性搞完呢」= 批准 `docs/remaining-work-plan-2026-11-23.md` B 类 7 项建议全批。可执行两项（G0 distinctStates / UI-706 口径）一次性落地；其余 5 项按建议维持不做/未裁决/待条件登记。

## 1. G0 qualified 补 distinctStates（已批准接受先红）

- **改动**：`scripts/g0-qualification-visual.mjs` 的 `evaluateVisualEvidence` 新增 `distinctStates`（五态 sha256 须全唯一）；`test/g0-qualification-visual.test.mjs` 理想夹具改 5 个不同 sha + 新增重复 sha 负测。
- **HK-01 3/3 绿**（判据正确）。
- **`g0:qualification:visual` 实机红（exit=1，`visual_qualification_failed`）**：真实证据 `acceptance/g0-qualification/visual-state-convergence.json` 的 5 张 PNG 只有 4 个唯一 sha（第 1 张与第 5 张逐字节相同，`bb54acff…`），`distinctStates=false` → `verdict.passed=false` → line 133 先于 runner-stale 抛错。**这是用户明确批准的诚实红**——不补拍第 5 张、不伪造 sha、不写回 evidence 掩盖缺口。
- **影响**：`g0:qualification` / `g0:qualification:live` / `postcheck` 连带红（commandGates 短路）；重开条件=补齐第 5 张真实独立态证据。与 G0 当前阶段纪律一致：不外推 GA/资格声明。

## 2. UI-706/707/709/710 口径翻正

- 台账 BLOCK-478/479/480 历史登记行后加 2026-11-24 归位注记：四项按台账标题行均为 verified（11-19 用户口令 + 人眼核对卡），registry BLOCK status=completed。
- **E 类观感槽与所有 `pending_human_eye` 签字位零代签、不动**——只同步编号状态口径。

## 3. 其余 5 项裁决登记

C-50 不做 / D-04 i18n 不做 / C-56 英文另批维持未裁决 / C-32 待漂移门独立包 / C-26-27 不批预算——写入规划文档 B 类表裁决注记，不开工。

## 门禁

- HK-01 3/3；docs:check PASS(665) / ui:audit PASS / lint 0 error / tsc 0 / test:changed 0。
- **已知红（已批准）**：`g0:qualification:visual` 及依赖它的 g0 汇总门——证据真实缺口，非回归。

G0 开发期常态 · 不外推 packaged/Provider/GA。
