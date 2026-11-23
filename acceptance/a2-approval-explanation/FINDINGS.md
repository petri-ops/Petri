# QODER-A2 审批意图解释（2026-11-23，P1+P2+P3 收口）

## 范围与裁决

用户发令「按照你的建议 冲」= 续做 A2 P2/P3（Jev 1.00）。评审稿默认 D1 零新 provider / D2 复用现有本地模型绑定。A2 验收=「解释可读 + 失败降级不阻断审批」，零新依赖。

## 三阶段交付

- **P1**（前批已落）：`core/petri-server/helpers/approval-explanation.js`——`buildApprovalExplanationPrompt`/`normalizeModelExplanation`/`resolveModelExplanation`，复用 `callModelTask({role:'explanation'})`，fail-soft 返 null；HK-01 5/5。
- **P2 后端路由**：`core/petri-server/routes/ai-agent/task-actions.js` 新增 `POST /api/ai/agent/task/:taskId/approval/:requestId/explain`——从 `getApprovalRequest` 取确定性 intent → `resolveModelExplanation` → 成功返 `{ok,explanation}`、失败返 `{ok,explanation:null,explainUnavailable:true}`；**不改审批状态、不写回 deny/allow 语义**、401/403/404 鉴权与既有路由同形。端到端测试 2/2（fail-soft + 404 不泄漏）。
- **P3 前端**：`GuardAckCard.tsx` 加「解释」按钮 + 分析中骨架（aria-label）+ 失败提示，模型解释覆盖确定性文案；`useGuardAck.ts` 加 `handleGuardExplain`（失败吞掉、保留原说明、异步清解释态避免 cascading render lint）；`SimpleChat.tsx` 透传；`simple-chat.css` 用既有 token 加骨架样式、零新颜色字面量。**审批按钮全程可用**（不因解释中禁用）。组件测试 15/15（含新增按需解释用例）。

## HK-01 红绿

- `test/qoder-a2-approval-explanation.test.mjs`（P1）红4→绿5。
- `test/qoder-a2-explain-ui.test.mjs`（P2/P3 源码契约）红3→绿4。
- `test/qoder-a2-explain-route.test.mjs`（路由端到端）2/2 绿。
- 组件 `GuardAckCard.test.tsx` 15/15 绿。

## 门禁

- 本包 Node 定向 11/11（`node-tests.txt`）；前端组件 15/15（`component-test.txt`）。
- tsc 0 / lint 0 error / docs:check PASS(664) / ui-audit PASS / test:changed 0。
- 红线：未改产品 sandbox/CSP/凭据/B1 token/handler/pack 声明；零新依赖；观感 UI-721 保持 in_progress 不代签；不碰 G1+。

## 完成语义

A2 验收达成（解释可读 + 失败降级不阻断审批），registry `QODER-YELLOW9-REOPEN` 中 A2 从 active 实施包翻 completed；其余 8 项仍 queued 待逐项发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。
