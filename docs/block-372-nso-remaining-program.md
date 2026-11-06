---
capability: block-372-nso-remaining-program
status: active
goal: NSO 收尾总纲——把评估报告 F-06/F-20 及 W3b 挂起项之外的全部未做项排入可执行批次，串行集中解决。
acceptance:
  - Batch-1 链哈希数据模型批：artifact_revisions 增 prev_chain_hash/chain_hash 迁移+回填+deliver manifest 产物字节重算+独立校验器（scripts/verify-artifact-chain.mjs）+篡改 fail-closed 负测
  - Batch-2 后端 FK 证据门：后端连接开 foreign_keys=ON + 全量回归（test:all:sharded）绿后翻转策略模块声明；红则回退并登记违约行清单
  - Batch-3 台账 52 条 in_progress 终态化：ui:audit:triage 分诊 → CDP 可代行者补腿翻 verified → 其余如实 retain-with-reason
  - Batch-4 外部 MCP 主体档位：按用户裁决实现 capability token 协商（当前待裁决）
reopen: 各批按自身 plan 收口
---

# BLOCK-372 · NSO 剩余项集中解决总纲

> 用户裁决：2026-11-06「安排上后续未做的所有事情，接下来集中解决」。串行 Batch-1 → 2 → 3 → 4。
> 已完成不再列：NSO 十一包（359-371）+ 实机走查补验（c0257037）。

## 批次状态

- Batch-1 **pending**（体量最大：迁移+回填+校验器）
- Batch-2 **pending**（前置=Batch-1 的全量回归可复用同一轮）
- Batch-3 **pending**（52 条逐条）
- Batch-4 **blocked**（待用户裁决外部 MCP 主体档位协商方案——AUDIT-LOG 🟡 在案）
