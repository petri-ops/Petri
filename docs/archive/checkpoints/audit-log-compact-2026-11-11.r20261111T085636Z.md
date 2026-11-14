# AUDIT-LOG 自动精简归档 · 2026-11-11（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ **BLOCK-412（补腿批第一刀 · messages 读契约）completed**：L-31 续——独立 COUNT 退役（窗口列 COUNT(*) OVER (PARTITION BY conversation_id ORDER BY rowid) 页查询内算绝对偏移；rowid 语义保持=fork 同 ts 安全；20 页滚动 COUNT 调用数 1→0 蓝图口径）+ export 流式分块（keyset rowid> 500 行/块增量 res.write；组合原语抽取单源保持逐字节等价）；红 2→4/4、同套绿 block95 双套+block408+K2+block412=35/35、批跑 422/424（P6=W、BLOCK-87 并发 flake 单跑 6/6 绿如实归属）；Jev no_key 未恢复（V 类补腿=用户 export TYPESAFE_API_KEY） 零新增依赖 | 2026-11-11 | BLOCK-412 / COMPLETED |
