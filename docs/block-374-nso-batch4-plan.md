---
capability: block-374-nso-batch4-mcp-subject
status: completed
goal: Batch-4 外部 MCP 主体治理边界裁决落地——按用户授权以工程判断收口：外部 MCP 主体由 MCP trust 语义治理（既有独立轴），不进 agent capability token 面，协议层档位协商裁决为不需要。
acceptance:
  - 结构契约：MCP registry 不引 agent 拦截器；capabilityEvidence 签发点唯一在 agent 拦截器；mcp/ 目录零出现
  - AUDIT-LOG 🟡（IDE MCP 写面档位）销号
reopen: 若未来需要外部 MCP 主体的 Petri 侧细粒度档位（如按项目隔离），须先做 MCP 握手期会话协商协议设计并用户裁决
---

# BLOCK-374 · Batch-4 外部 MCP 主体治理边界

> 裁决：用户「直接搞完剩余未做的内容」授权。分析：外部 MCP 调用方（Cursor/VSCode 经 stdio）无 Petri accessMode 会话、不经 agent 拦截器，本就由 MCP trust 轴治理（trust='ask' 对 destructiveHint 要求审批、'allow' 自动放行——BLOCK-243 已落地）。能力 token 是 agent 会话语义，强加给外部主体=造假门；协议层协商=无对应 Petri 概念的过度设计。**裁决=两轴分离**，契约测试钉住结构不变量。
