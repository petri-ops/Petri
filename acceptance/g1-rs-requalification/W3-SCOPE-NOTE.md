# G1 首包 W3 · Git consent UI 与 historical alternative 核码结论（2026-11-25）

> 发令：Orca msg_678d5e6b9f88（W2 收口成立，按序开 W3；核码起点=后端已有 opt-in，判缺前端 consent 面与 trace 接线）。
> 本件=核码结论 + 裁决点，**不改产品代码/不改资格矩阵/不复活退役能力**。

## §1 重大事实偏差（canonical 权威）

发令与 G1-READINESS（2026-11-24）写「后端已有 opt-in，缺前端 consent UI」——但核真（C-32/C-43）显示**该前提已失效**：

- **UI-462（2026-10-03 owner 裁决，2026-10-30 verified）**：Result Studio「接入用户自有 Git 仓库」能力**整体退役**——版本历史只进 managed 私有存储 `.petri/git`，`GitRepositoryConsent` 弹窗 + repository 子域 2 端点 + consent 存储三方法 + consent schema 全部拆除，`bindProjectRepository` 收敛 managed-only，11 处 existing 分支坍缩。
- UI 台账 UI-127 条目明确：**「G0-RS-P7 / EXISTING-GIT-CONSENT（已随退役终结；P7 重开条件中的 existing Git consent UI 项随之失效）」**。
- 核码实证：`git-repository-binding.js:10`「接入用户自有仓库能力整体退役…只剩 managed 一种模式」；`result-studio-repository.js:222` consent 表「保留但不再被任何路径读写」；`existing_repository_not_attached_without_consent` 在 core 生产代码**零命中**；前端 consent UI 零命中（本就不该存在，非"未实现"）。

结论：**W3 的「Git consent UI 五条 task trace」子项前提不成立**——能力已退役、P7 对应条件已失效（UI-462 canonical > G1-READINESS 旧表述）。不复活退役能力、不造已删的 UI。

## §2 资格矩阵残留（真实缺口，需裁决）

- `core/shared-backend/result-studio-qualification.js:18-19` 的 `REQUIRED_ENVIRONMENTS` 仍列 `existing_clean_git`/`existing_dirty_git`；
- `core/shared-backend/result-studio-evidence-bundle.js:278,447` 仍有 `repository.mode === 'existing' && consentObserved` 分支。
- 这些是**未随 UI-462 同步清理的资格矩阵残留**——要求 G1 资格证据去测一个产品已删除的模式，逻辑矛盾。修它=改资格判据，属 owner 裁决点。

## §3 historical alternative compare（核码）

- `historical_alternative_compare` 是 P7 五个 REQUIRED_TASKS 之一（`result-studio-qualification.js:14`）；`result-compare-service.js:1023` 有 `historical_changeset_cohort` scope、`result-studio-repository.js` 有 restore/replay 门——本仓已有相关能力，待判是否需补"可观测产品契约"HK-01（与 W1/W2 同构），**不新增第二套 compare**。

## §4 裁决点（请 owner 只回「行/不行」）

**最合理建议**：
1. Git consent UI 子项按 UI-462 canonical **判定失效并挂账**（不复活、不实现前端 consent）；
2. 资格矩阵残留（`REQUIRED_ENVIRONMENTS` 的 existing_* 两项 + evidence-bundle existing 分支）**单列为「P7 资格契约与 UI-462 对齐」子包**，待 owner 裁决是否清理（改资格判据须 owner 拍板，不在 W3 实现面）；
3. W3 本机只推进本仓可独立验证且前提成立的 **historical alternative compare 可观测契约**（HK-01 红绿 + 既有门零放宽，与 W1/W2 同构）。

理由=UI-462 是 owner 已裁决并 verified 的 canonical 事实，高于 G1-READINESS 的旧表述；不基于失效前提造代码、不擅自改资格矩阵。

回「行」即按上述推进；回「不行」请给方向（例如仍要实现 consent UI——则须先推翻 UI-462，属新裁决）。

## §5 边界

- 不翻 `qualificationEligible`、不冒充历史证据为资格、不动兄弟仓、不改退役能力；heatmap 挂账维持；W4/W5 外部挂账维持；19 WIP/frogfish 零触碰、观感零代签、push 等放行。
