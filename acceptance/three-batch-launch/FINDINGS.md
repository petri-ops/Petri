# 三类并档执行（2026-11-23）

## 用户发令与裁决

「C-56 你可以自己获取、E-01 我有喜好应该自己搞定、🟡9 开始吧可以立项了」+ 三项裁决：E-01 按用户委托 Agent 审定翻 verified、C-56 用合成夹具端到端演练（明确非真实稿件、不改判据语义）、🟡9 立 9 项评审稿 + Jev 首推 A2 立刻开工。

## 1. E-01 → verified（用户委托审定）

- 证据现成：`acceptance/block503-outputs/yi-rest/p3-e01-walk/review.md:21`（Agent 审定·用户委托先例）、5 步走查全达击数 1/2/2/3、10 张 step PNG、`findings.json`。
- 补 `E-01-result.md`（路线 §6 第 6 步记录表），按 user 裁决翻 verified：签字槽 + 头部状态 + IA 决策材料 §6 同批回写；留痕「n=1 代理走查留因替代真人样本判据、真人口令被本次裁决覆盖、推翻权保留」。
- 首击严格口径 1/4=25% 未达 70% 如实记录（按 ≤3 击达标口径判 pass），不掩盖。

## 2. C-56 合成夹具端到端演练

- 新驱动 `scripts/c56-paper-writing-drill.mjs`：真实 `tool_skill_discover` → `tool_skill_get` → 读 system.md 规则 → 11 项保真不变量机械复核（四保护/F1-F6/数字锁定 98.7%/provenance/非真实标注/§9 判据未改）。
- 实跑 `acceptance/c56-synthetic-drill/drill-result.json`：`passed=true 11/11`，`nonRealManuscript=true`、`criterionSemanticsUnchanged=true`。
- 手册 §9「用户给出文件路径 + 完整读取原文」判据**未改**——合成夹具演练不替代真实稿件改写。
- HK-01 `test/c56-skill-drill.test.mjs` 4/4（红3→绿）。

## 3. 🟡9 立项评审稿 + A2 开工

- canonical `docs/qoder-yellow9-reopen-review.md`：9 项（A2/E12/J2/J4/J6/L1/L2/L5/L6）范围/形态/待裁决 D/验收边界登记；TASK-FORM=立项评审稿；A2 唯一 active、其余 queued；L1/L2 只借行为合同；零新依赖默认。
- 三件套：DOC-REGISTRY（QODER-YELLOW9-REOPEN，docs 664）+ README 512i + AUDIT-LOG 启动登记行。
- A2 P1 完成：`core/petri-server/helpers/approval-explanation.js`（`buildApprovalExplanationPrompt`/`normalizeModelExplanation`/`resolveModelExplanation`），复用 `callModelTask({role:'explanation'})` 零新依赖，fail-soft 返回 null 不阻断审批；HK-01 `test/qoder-a2-approval-explanation.test.mjs` 红4→绿5。
- **A2 未 completed**：P2（按需 POST 路由 + tool-events 字段）与 P3（GuardAckCard 解释按钮/骨架/失败降级 + 类型/CSS）未做，active 包保持进行中。

## 门禁

- 全量本批定向 **33/33**；docs:check PASS(664) / ui:audit PASS / lint 0 error / tsc 0 / test:changed 0（影响图：C-56 演练归 closed-batch、A2 归 qoder-yellow9-a2-explanation 规则）。
- 截图：E-01 证据沿用既有 10 张 step PNG（本批无新截图）；C-56/A2 为纯逻辑，无 GUI 面。

G0 开发期常态 · 不外推 packaged/Provider/GA。
