# QODER-L1/L2 输出接线（2026-11-23，completed）

## 用户发令与裁决

用户「继续」（Jev 建议 L1L2-WIRING 0.67）：把 P1 `web-result-projection.js` 接入 `web-tools.js` 的 search/fetch 输出，additive 补 `summary`/`authority`，不改出网链/正文/审计。D2 权威度口径沿用上批默认（只透传上游、无则 null，不自造评分）。

## 交付

- `core/petri-server/agent-tools/web-tools.js`：
  - `tool_web_search`：`withAudit` 前对 `result.results` additive 合并——逐条 spread 保留原 `snippet`/`source`/`url`，补 `summary`（有界 ≤400）与 `authority`（deepseek 透传/searxng null）。
  - `tool_web_fetch`：成功返回 additive 补 `authority`（`projectFetchMetadata`，本包 output 无上游权威度故 null），**正文 `text` 一字不改**。
- 零新依赖；出网调用链（`guardedFetch`/`searchWeb`）、配置族、provider 归一、审计（`withAudit` 只记 source/cost）全未动。

## 验证

- HK-01 `test/qoder-l1l2-wiring.test.mjs` 红2→绿3（消费 P1 投影 / additive 保留原字段 / 红线）。
- 邻域 `block247-web-tools` + `block247-web-policy` + P1 核心 → Node **33/33**（additive 接线对既有 source/snippet/text 断言零回归）。
- docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。
- 诚实边界：authority 是行为合同字段（透传/诚实 null），不是本地权威度评分（D2 未裁决不自造）；未做前端展示变更（工具输出字段由消费方自愿使用）。

## 完成语义

L1/L2 从 P1 core → 完整输出接线 completed。

G0 开发期常态 · 不外推 packaged/Provider/GA。
