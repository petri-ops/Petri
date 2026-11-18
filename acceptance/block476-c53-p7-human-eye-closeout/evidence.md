# BLOCK-476 / C-53 P7 人眼收口非观感准备 — 证据（2026-11-18）

## 发令与范围
- 用户发令「开始 C-53 P7」（批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S6/R8）；前序 S5（BLOCK-475 / P6）已收口。
- **定位**：S6 是治理批（非观感准备）——只整理人眼收口清单 + 证据索引，签字槽留用户，零代签；沿 P1–P6 先例把清单做成可复算的模型可读契约，便于用户逐条签字时机械核对。
- 关键决策：**不改**观感状态、不填签字槽、不改 P0–P6 真源（它们是零回归基线，只读复算）；零 UI 运行时写面。

## HK-01 红绿
- RED（模块缺席）：`node --test test/c53-human-eye-closeout.test.mjs` → `ERR_MODULE_NOT_FOUND: scripts/c53-human-eye-closeout.mjs`（pass 0 / fail 1）。
- GREEN：`tests 11 / pass 11 / fail 0`——①快照/契约六组读数结构完整 ②逐读数现读一致（可复算）③UI 台账四槽 in_progress + pending_human_eye 零 verified ④E 类 22 条诚实分层 ⑤签字槽 11 行全空 ⑥本批新 UI 面观感槽 ⑦证据索引齐 ⑧观感留槽零代签 ⑨manifest sha256 ⑩篡改负测 fail-closed ⑪P0–P6 零回归。

## 现读六组读数（`human-eye-closeout.json`）
- **uiLedgerSlots**：`docs/ui-productization-audit.md` 现读 UI-706/707/709/710 四段——各 `inProgress=true` / `pendingHumanEye=true` / `verified=false`；`allInProgress` / `allPendingHumanEye` / `noneVerified` 三项全真。
- **eClassTiers**：`e-class-human-eye-guide-2026-11-16.md` 现读 11 verified / 2 cancelled / 9 in_progress（3 可过目）= 22 条；`acceptance/block-332/ui-ledger-triage.json` `counts.blocked=23`、`live-missing=15` 现读；`driftDisclosed=true`——如实登记"22 条=2026-11-11 blocked 快照标签，triage 现读已漂移到 23"，不伪造、不改台账。
- **signatureSlots**：`ui-design-human-eye-route.md` §3 现读 11 行签字槽（E-01/E-02/E-03 + H-01~H-08）——`total=11` / `filled=0` / `allBlank=true`。
- **batchNewUiFaces**：P4 八态 `humanEyeCells=12`（complete）；P5/P6 `humanEyeSlots` 各 `humanEyeSigned=false` / `status=in_progress` / `readOnly=true` / 2 槽；P2/P3 evidence.md 明确「无 pending_human_eye 面」；`allUnsigned=true`。
- **evidenceIndex**：11 条真源/acceptance 路径逐条在场，`allPresent=true`（可核）。
- **humanEyeSlots**：`humanEyeSigned=false` / `status=in_progress` / `readOnly=true`——观感留槽零代签。

## 扫描器
- `scripts/c53-human-eye-closeout.mjs`：`collectHumanEyeCloseout` / `scanUiLedgerSlots` / `scanEClassTiers` / `scanSignatureSlots` / `scanBatchNewUiFaces` / `scanEvidenceIndex` / `validateCloseoutIntegrity` 纯函数 + `--check`（不写盘）+ `sourcesOverride` 篡改注入；契约 sha 由生成器自身维护 manifest（沿 P1–P6 先例）。
- `--check` PASS（readingIds=6，uiLedgerAllInProgress=true，eClassTotal=22，signaturesBlank=true，evidencePresent=true）。

## 证据索引（每条人眼项的 acceptance/真源路径）
| 清单项 | 状态 | 证据路径 |
| --- | --- | --- |
| UI-706 API Endpoint 能力面 | in_progress / pending_human_eye | `docs/ui-productization-audit.md` UI-706 段 |
| UI-707 模型级上下文/思考 | in_progress / pending_human_eye | `docs/ui-productization-audit.md` UI-707 段 |
| UI-709 Gen UI ::compose | in_progress / pending_human_eye | `docs/ui-productization-audit.md` UI-709 段 |
| UI-710 SceneSpec 证据面板 | in_progress / pending_human_eye | `docs/ui-productization-audit.md` UI-710 段 |
| E 类 22 条分层 | 11 verified / 2 cancelled / 9 in_progress | `docs/e-class-human-eye-guide-2026-11-16.md` + `acceptance/block-332/ui-ledger-triage.json` |
| 集中签字槽 11 行 | 全空 / pending_human_eye | `docs/ui-design-human-eye-route.md` §3 |
| E-01 树测试 / E-02 22 条 / E-03 SUS | pending_human_eye | `docs/ui-design-ia-decision-material.md` §6 + `docs/ui-design-human-eye-route.md` §1 |
| P4 八态 12 人眼格 | in_progress | `acceptance/block473-c53-p4-responsive-a11y/responsive-a11y-snapshot.json` |
| P5 流式/加载空错误观感槽 | in_progress / unSigned | `acceptance/block474-c53-p5-performance-trust/performance-trust-snapshot.json` |
| P6 Skill 契约观感槽 | in_progress / unSigned | `acceptance/block475-c53-p6-skill-contract/skill-contract-snapshot.json` |
| P2/P3 无观感面声明 | n/a | `acceptance/block471-c53-p2-ia/evidence.md` + `acceptance/block472-c53-p3-visual-consistency/evidence.md` |

## 观感零代签（用户动作清单）
- 以下**全部保持 `pending_human_eye` / `in_progress`，签字槽留空，Agent 零代签**：UI-706/707/709/710、E 类 22 条（9 in_progress 中 3 条可过目）、集中签字槽 11 行、P4 人眼格、P5/P6 观感槽、C-53 P7 人眼收口。
- P7 的"完成"仅指**非观感准备就绪**（清单齐 + 证据索引齐 + 可机械核对）；人眼签字由用户实机过目后按既有台账回写。

## 边界与零回归
- P0–P6 六个消费测试 `node --test` 57/57 零回归；`--check` 与落盘逐读数一致；manifest sha256 一致。
- 零产品运行时代码 / CSS / 组件 / 路由 / IPC 写面；零观感状态改动；零新增依赖；design-charter 冻结项零触碰；用户 untracked 资产零触碰。
- perf SKIPPED（G0 噪声）与 block464/470 gap 既有红归属如实（见 plan §7）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
