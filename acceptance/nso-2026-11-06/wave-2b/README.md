# NSO Wave-2b 证据（BLOCK-367 · 2026-11-06）

- 契约 `test/nso-w2b-capability-audit.test.mjs` 1/1（红→绿：capabilityEvidence 缺失→在场+装配顺序钉住）；approval 邻域 31/31 零行为漂移。
- 实核修正（F-06）：once 指纹在 `agent-tool-interceptor.js` 消耗点（entry.handler 之前）同步消耗——评估「审批未在 executor 侧重放/消耗」的预设对 agent 主体不成立；外部 MCP 主体保持裁决位。
- Jev：output:judge 首轮 RETRY（fit 2.83，判词=未逐条回答）→ 按三条验收逐条重答 PASS（fit 3.1）。
