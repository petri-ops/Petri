---
capability: block476-c53-p7-human-eye-closeout
status: completed
kind: work-package
truthDomain: block476-c53-p7-human-eye-closeout
entrypoint: docs/README.md
goal: C-53 UI-DESIGN-QUALITY 的收尾 P7（人眼收口的非观感准备）——沿 P1–P6 先例新增独立静态扫描器，从 canonical 真源机械复算人眼收口清单与证据索引六组读数（UI-706/707/709/710 台账状态 / E 类 22 条诚实分层 / 集中签字槽全空 / 本批新 UI 面观感槽 / 证据索引路径 / 观感留槽零代签），落模型可读 human-eye-closeout.json（生成器维护 manifest sha）+ 消费测试锚定（HK-01 红绿 + 篡改负测 fail-closed）。签字槽留用户、每项保持 pending_human_eye/in_progress，Agent 零代签、零 UI 运行时写面、零新增产品依赖
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器/契约缺席）后绿；含篡改负测 fail-closed（状态被写 verified / 签字槽被填 / 观感槽被代签 / 证据路径缺失 / 结构破坏全红）
  - 可复算：collectHumanEyeCloseout(root) 从 canonical 真源机械派生，落 resources/design-context/human-eye-closeout.json；--check 重算与落盘逐读数一致；生成器维护 manifest sha256
  - UI 台账四槽：UI-706/707/709/710 从 docs/ui-productization-audit.md 现读，每条 in_progress + pending_human_eye 在场、零 verified；漂移必红
  - E 类分层：从 e-class-human-eye-guide-2026-11-16.md 现读 11 verified / 2 cancelled / 9 in_progress（其中 3 条可过目）+ block-332 triage counts 现读；口径差异如实登记不伪造
  - 签字槽全空：从 ui-design-human-eye-route.md §3 现读 11 行签字槽（E-01/E-02/E-03 + H-01~H-08）全 `______`，任一被填必红
  - 本批新 UI 面：P4 八态 12 人眼格 / P5 与 P6 humanEyeSlots（in_progress、unSigned、readOnly）+ P2/P3 无观感面声明，从 acceptance 快照现读；漂移必红
  - 证据索引：每条清单项对应 acceptance/真源路径在场（可核）；缺失必红
  - 观感零代签：humanEyeSigned=false、status=in_progress、readOnly=true；签字槽留用户；本包零 UI 运行时写面
  - 零新增产品依赖；P0–P6 契约零回归；closeout 定向门禁 + impact-map 登记 + 六件套回写
reopen: 观感状态翻 verified/cancelled 属用户签字后按既有台账回写；本包不代签、不改观感状态
---

# BLOCK-476 · C-53 P7 人眼收口非观感准备（completed / P7-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-53 P7」——承接批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S6 / R8，前序 S5（BLOCK-475 / C-53 P6）已收口。
> **从属**：`docs/petri-master-charter.md` + AUDIT-LOG C-53 权威阶段（P0 基线冻结→P1 上下文包硬化→P2 IA→P3 视觉一致性→P4 响应式 a11y→P5 性能与可信状态→P6 产品 Skill v1.1→P7 人眼收口）；BLOCK-465/471/472/473/474/475 已完成。
> **定位**：S6 是治理批（非观感准备）——只整理人眼收口清单 + 证据索引，签字槽留用户，零代签；沿 P1–P6 先例把清单做成可复算的模型可读契约，便于用户逐条签字时机械核对。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c53-human-eye-closeout.mjs`——纯函数 `collectHumanEyeCloseout(root)` 从 canonical 真源机械复算六组读数，落 `resources/design-context/human-eye-closeout.json`（沿 P1–P6 design-context 先例，生成器自身维护 manifest sha256）：
   - **uiLedgerSlots**：`docs/ui-productization-audit.md` 现读 UI-706/707/709/710 四段标题，各含 `in_progress` 与 `pending_human_eye`、零 `verified`。
   - **eClassTiers**：`docs/e-class-human-eye-guide-2026-11-16.md` 现读分层计数（11 verified / 2 cancelled / 9 in_progress / 3 可过目）+ `acceptance/block-332/ui-ledger-triage.json` `counts` 现读；如实登记"22 条=2026-11-11 快照 / triage 现读 blocked 漂移"口径差异。
   - **signatureSlots**：`docs/ui-design-human-eye-route.md` §3 现读 11 行签字槽（E-01/E-02/E-03 + H-01~H-08）全 `______`，零填写。
   - **batchNewUiFaces**：P4 `responsive-a11y-snapshot.json` 八态 `humanEyeCells` + P5/P6 快照 `humanEyeSlots.value`（in_progress/未签/readOnly）+ P2/P3 evidence.md 无观感面声明。
   - **evidenceIndex**：上述每条清单项对应 acceptance/真源路径在场（可核）。
   - **humanEyeSlots**：观感留槽 `humanEyeSigned=false` / `status=in_progress` / `readOnly=true`，零代签。
2. **消费测试**：`test/c53-human-eye-closeout.test.mjs`——可复算（现读 vs 落盘逐读数深等）、六组读数断言、篡改负测（状态写 verified / 签字槽填名 / 观感槽代签 / 证据路径删 / 结构破坏）fail-closed、P0–P6 包零回归；HK-01 红→绿留痕。
3. **证据索引文档**：`acceptance/block476-c53-p7-human-eye-closeout/evidence.md` + `human-eye-closeout-snapshot.json`（生成器写盘）。

## 2. 非范围（exclusions）

- 任何观感状态翻 `verified`/`cancelled`；签字槽填写；产品运行时代码 / CSS / 组件 / 路由 / IPC 写面；
- 改 P0–P6 真源 JSON / 台账的语义部分（只读复算，零回归基线）；design-charter 冻结档位/预算变更；
- 新增产品 Skill 或产品级新依赖；Polyfork 授权结论与接入决策；post-h9 D5 原件处置；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c53-human-eye-closeout.test.mjs` 先红（模块缺席）后绿。
- **G2 可复算**：`node scripts/c53-human-eye-closeout.mjs --check` 重算通过；六组读数与落盘一致；manifest sha256 一致。
- **G3 零回归**：P0 `test/c53-design-context-pack.test.mjs` + P2–P6 `test/c53-*.test.mjs` 零回归；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写；观感项保持 in_progress 零代签。

## 4. 完成语义

G1–G4 全绿或明确 external-blocked + 六件套回写 + 证据落 `acceptance/block476-c53-p7-human-eye-closeout/`。本包无 UI 运行时写面（资源 JSON + 脚本 + 测试 + 文档/manifest 非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。签字槽与观感状态留用户，P7 的"完成"仅指非观感准备就绪。

## 5. 立项真值摸底（2026-11-18，HK-01 前）

| 读数 | 现读预期 | 真源 |
| --- | --- | --- |
| UI 台账四槽 | UI-706/707/709/710 各 in_progress + pending_human_eye，零 verified | `docs/ui-productization-audit.md` |
| E 类分层 | 22 条=11 verified / 2 cancelled / 9 in_progress（3 可过目）；triage blocked 现读 23（漂移如实登记） | `docs/e-class-human-eye-guide-2026-11-16.md` + `acceptance/block-332/ui-ledger-triage.json` |
| 签字槽 | 11 行全 `______`（E-01/E-02/E-03 + H-01~H-08） | `docs/ui-design-human-eye-route.md` §3 |
| 本批新 UI 面 | P4 humanEyeCells=12；P5/P6 humanEyeSigned=false + in_progress + readOnly；P2/P3 无观感面 | acceptance/block47{3,4,5}-*/ 快照 + evidence.md |
| 证据索引 | 每条对应路径在场 | acceptance/ + docs/ 真源 |
| 观感留槽 | in_progress、unSigned、readOnly | UI 台账 pending_human_eye |

## 6. 收口记录（2026-11-18）

HK-01 红（模块缺席 `ERR_MODULE_NOT_FOUND`）→ 绿 11/11；`--check` PASS（readingIds=6，uiLedgerAllInProgress=true，eClassTotal=22，signaturesBlank=true，evidencePresent=true）。六组读数：uiLedgerSlots（UI-706/707/709/710 各 in_progress + pending_human_eye 零 verified）/ eClassTiers（11 verified + 2 cancelled + 9 in_progress = 22、3 可过目、triage blocked 现读 23 漂移如实登记）/ signatureSlots（11 行签字槽全空 filled=0）/ batchNewUiFaces（P4 humanEyeCells=12、P5/P6 humanEyeSigned=false+in_progress+readOnly、P2/P3 无观感面）/ evidenceIndex（11 条路径全在场）/ humanEyeSlots（in_progress 零代签）。P0–P6 六消费测试 Node 57/57 零回归；manifest sha256 一致；零 UI 运行时写面/观感状态改动/新依赖/发现桥退化。证据=acceptance/block476-c53-p7-human-eye-closeout/。观感签字（UI-706/707/709/710 + E 类 22 条 + 11 签字槽 + P4/P5/P6 槽 + C-53 P7 人眼收口）全部保持 pending_human_eye / in_progress，签字槽留用户，Agent 零代签；P7"完成"仅指非观感准备就绪。C-53 P2–P7 全阶段收口，Polyfork 只读收集（S7）待用户发令。

## 7. 收口门禁归属（2026-11-18）

- `quality:perf` packaged_start 继承抖动（G0 噪声，在册）——本批零 perf 运行时面改动，归属既有基线，closeout 以 `--skip=quality:perf` 如实标 SKIPPED（不算 PASS）。
- `test-affected.test.mjs:90` 的 block464/block470 evidence gap = HEAD 既有映射盲区；按 P2–P6 先例 commit 后 closeout，diff 干净后两既有红不入范围。

G0 开发期常态 · 不外推 packaged/Provider/GA。
