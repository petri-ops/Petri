# AUDIT-LOG 自动精简归档 · 2026-10-24（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ BLOCK-239（Q8 MCP OAuth，2026-10-22；用户「搞完 下一队列」） | 2026-10-22 | **completed**：HTTP MCP OAuth 授权码流程——SDK 原生 provider/auth + localhost callback + 密文 token store + 货架授权入口；授权前零投影、授权后重连出现。证据=Node 集成 6/6 + 前端 17/17 + 邻域 26/26 + 9223 live 11/11 + closeout 十三门 + output:judge PASS；UI-548 verified。实机抓真=REST transport 丢失 + 未连接传输显示错误，均已修。stdio/SSE/revoke/真实 provider 矩阵 reopen。plan=docs/block-239-q8-mcp-oauth-plan.md §6 | BLOCK-239 / P5-CLOSED |

<!-- audit-log-compact.mjs 追加 @ 2026-10-24T01:06:48.875Z -->
| ✅ Q8 四 hint（MCP，2026-10-22；用户「Q8 余项 搞完」） | 2026-10-22 | **completed**：`mcpToolContract` 把 readOnly/destructive/openWorld/idempotent 四 hint 写入合同——destructive/openWorld **覆盖** readOnly 降档（保守 R2/execution），idempotent 记录不改变风险档；零 annotations 零漂移；显式 contractMode 仍优先。证据=block240 7/7 + mcp-projection 15/15 + closeout 十三门。非范围=审批语义变更（随 Q1）、懒加载、深链安装 | Q8 / light |
