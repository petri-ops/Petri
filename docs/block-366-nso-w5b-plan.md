---
capability: block-366-nso-w5b-second-truth-cleanup
status: active
goal: NSO-W5b 架构去补丁——删除只剩名字的第二真相（死错误码、恒 null 桩、无消费的重试分类与 token 口径），并完成 runLoop 首个拆分切片（上下文预算步骤外提），降低读者需要同时持有的概念数。
acceptance:
  - ERROR_I18N 删除 13 个在 core/src 无任何生产者的 web 时代错误码；保留码均有生产者（契约逐码校验）
  - 删除零调用的 _loadWorkingTreeRejectEntries 恒 null 桩
  - provider-reliability.shouldRetry 委托网关 isRetryableProviderError（重试分类单源；矩阵一致性契约）
  - message-trimmer 删除无消费的 stats.categories / computeCategories / analyzeMessageTokens（token 口径以 token-estimator.computeContextBreakdown 为唯一）
  - runLoop 上下文预算步骤外提为独立模块；拆前冻结行为基线，拆后同一套定向测试全绿；loop-orchestrator.js 行数只减
  - knip 保留面只减（如删除项在基线内同批 --update 下调）
reopen: runLoop 其余段（provider 调用 / 工具批 / 终整理）后续切片按同一基线纪律推进
---

# BLOCK-366 · NSO-W5b 第二真相清理 + runLoop 首切片

> 蓝图依据：§8（W5-1/2/3）。前置：W1 已收口（BLOCK-365），在制批已落地，W5 其余项零阻塞。

## 更正（2026-11-06）

BLOCK-364 提交说明写「在用实现是 llm-providers/provider-reliability.js 的 CircuitBreaker」——实核不成立：provider-reliability 的 `CircuitBreaker` 与 `shouldRetry` 在 core/src 均**无生产消费方**（仅 index.js 再导出 + 测试 + P6 源绑定清单）。本包按「单源」处置：shouldRetry 委托网关分类器；CircuitBreaker 保留（P6 源绑定在册、删除需随 P6 重算同批），并在此如实更正。

## 非范围

- 不新增依赖；不改任何现存错误码的文案或语义
- 并发写入者 UI-696 批零触碰
