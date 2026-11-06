---
capability: block-364-nso-w5a-dead-code-and-coverage
status: active
goal: NSO-W5a 架构去补丁与测试有效性的零交集子集——删除零消费的第二套熔断实现；让「测试不进影响图就永远不被定向执行」变成机械可见且只减不增。
acceptance:
  - core/petri-server/helpers/circuit-breaker.js 删除（git grep 证明零代码引用；provider-reliability 的 CircuitBreaker 是唯一在用实现）
  - 新增 impact-map 测试覆盖棘轮：每个 test/*.test.* 必须被某条规则 tests 引用，或列在存量基线；基线条目已被映射/已删除时须同批移出（只减）
  - 负测：合成未映射新测试判红；基线残留已映射条目判红
reopen: runLoop 拆分、恒 null 桩、legacy ERROR_I18N、双重试分类合并均位于在制批文件（loop-orchestrator / system-prompt / model-gateway），在制批处置裁决后随 W1/W5b 处理
---

# BLOCK-364 · NSO-W5a 死代码清理 + 影响图测试覆盖棘轮

> 蓝图依据：§8（W5-3 第二真相清理、W5-4 impact-map 覆盖全部测试并 fail-closed）。
> 实测：643 个测试文件中 147 个不被任何规则 `tests` 引用——相关生产代码改动时 `test:changed` 不会跑到它们，只在全量分片里出现（W0 全量分片的部分「仅全量暴露」红即此类）。
