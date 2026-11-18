---
capability: block468-infra-debt-settlement
status: completed
kind: work-package
truthDomain: block468-infra-debt-settlement
entrypoint: docs/README.md
goal: S4 基础设施清偿批（R5，治理批无产品代码）——① 修 lint-ledger --update 死代码路径（基线在场时无法下调），补工具负测（红绿证据），棘轮语义不放宽；② Q-MATRIX §5 统计行收拢到 BLOCK-263 changelog 口径（✅74/🟡21/🔴0/⛔7=102，注明来源）；③ knip 基线 346 键一次性定性批（旁挂报告逐类说明留痕，不放宽守卫）
acceptance:
  - HK-01（治理批豁免声明 + 工具负测作红绿）：planWarnBaselineUpdate 纯函数负测先红后绿——任一域上涨拒绝 update（不放宽棘轮）/ 下降允许下调 / 缺席首打；不新建第二套判据
  - lint-ledger --update 在基线在场时真正可下调（旧实现死代码），compareWarnDomains 既有只减语义零改
  - Q-MATRIX §5 统计行（:318）与 §12 changelog（:769）两处口径一致=74/21/0/7=102，注明来源 BLOCK-263 changelog
  - knip 346 键逐类定性旁挂报告落 acceptance（exports CK-11 六批 / files 动态入口 / types 存量上界），knip-ratchet.test 与 quality:knip:check 仍绿（不放宽）
  - closeout 定向门禁 + impact-map 登记 + 六件套回写；零产品代码改动
---

# BLOCK-468 · S4 基础设施清偿批（completed / DEBT-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 预授权 R5 = 基础设施清偿批（五步串行 S4）。治理批，无产品代码。
> **从属**：`docs/next-phase-e2e-prompt-2026-11-18.md` §5 S4 + `docs/petri-master-charter.md`。

## 1. 范围（scope）

1. **A · lint-ledger --update 修复**：`scripts/lint-ledger-verify.mjs` 抽纯函数 `planWarnBaselineUpdate(current, baseline)`——`!baseline` 首打 / 任一域 `>` 基线则 `reject`（issues，不放宽）/ 全域 `≤` 则写 `min(current,baseline)` 下调；main 的 `--update` 分支改调该函数（原 `:143 if (!baseline && UPDATE)` 死代码修活）。既有 `compareWarnDomains` 只减判据零改。工具负测先红后绿（项目侧判据侧红绿，BLOCK-426 先例）。
2. **B · Q-MATRIX §5 收拢**：`docs/qoder-essence-absorption-plan.md:318` 的 `✅69/🟡25/🔴1/⛔7=102`（BLOCK-260 旧口径）改为 `✅74/🟡21/🔴0/⛔7=102`，来源注记=BLOCK-263 changelog（§12 :769）；只改统计行，不碰矩阵行/§6.5 队列。
3. **C · knip 定性批**：新建 `acceptance/block468-infra-debt/knip-qualification-report.md`——346 键按三类（exports/files/types）逐类定性说明 + 代表性键举例 + 与 `test/knip-baseline.json` `_about` 对齐；不改基线键集/不放宽 `quality:knip:check`。

## 2. 非范围（exclusions）

- 产品代码 / UI 写面 / 观感签字；改任何基线语义放宽（warnings 上调、knip 键删除达放宽、perf 基线重打）；C-53 P2-P7 / W11 后续阶段；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：工具负测（`test/lint-ledger-update.test.mjs`）先红后绿；既有 m0/block404 lint 负测零回归。
- **G2 一致性**：Q-MATRIX 两处口径一致；knip-ratchet.test 1/1 + quality:knip:check PASS。
- **G3 治理**：docs/ui-audit/closeout 定向 + impact-map + 六件套。

## 4. 完成语义

G1–G3 全绿或明确 external-blocked + 六件套 + 证据落 `acceptance/block468-infra-debt/`。HK-01 豁免声明：本批主体为治理文档批，工具负测即判据侧红绿证据（BLOCK-404/426 先例）。零观感面。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口记录（2026-11-18）

G1 红→绿 4/4（工具负测，HK-01 判据侧）+ lint 负测 34/34；G2 Q-MATRIX 两处一致（74/21/0/7=102）+ knip 346 键定性报告 + knip/ratchet 绿；G3 docs/ui-audit/closeout 见 AUDIT-LOG。单源 JSON 重生成 406 规则/621 文档。证据=acceptance/block468-infra-debt/。零产品代码/观感/基线放宽。

G0 开发期常态 · 不外推 packaged/Provider/GA。
