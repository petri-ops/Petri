# AUDIT-LOG 自动精简归档 · 2026-10-24（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ BLOCK-239（Q8 MCP OAuth，2026-10-22；用户「搞完 下一队列」） | 2026-10-22 | **completed**：HTTP MCP OAuth 授权码流程——SDK 原生 provider/auth + localhost callback + 密文 token store + 货架授权入口；授权前零投影、授权后重连出现。证据=Node 集成 6/6 + 前端 17/17 + 邻域 26/26 + 9223 live 11/11 + closeout 十三门 + output:judge PASS；UI-548 verified。实机抓真=REST transport 丢失 + 未连接传输显示错误，均已修。stdio/SSE/revoke/真实 provider 矩阵 reopen。plan=docs/block-239-q8-mcp-oauth-plan.md §6 | BLOCK-239 / P5-CLOSED |

<!-- audit-log-compact.mjs 追加 @ 2026-10-24T01:06:48.875Z -->
| ✅ Q8 四 hint（MCP，2026-10-22；用户「Q8 余项 搞完」） | 2026-10-22 | **completed**：`mcpToolContract` 把 readOnly/destructive/openWorld/idempotent 四 hint 写入合同——destructive/openWorld **覆盖** readOnly 降档（保守 R2/execution），idempotent 记录不改变风险档；零 annotations 零漂移；显式 contractMode 仍优先。证据=block240 7/7 + mcp-projection 15/15 + closeout 十三门。非范围=审批语义变更（随 Q1）、懒加载、深链安装 | Q8 / light |

<!-- audit-log-compact.mjs 追加 @ 2026-10-24T03:20:19.686Z -->
| ✅ BLOCK-241（Q8 大目录懒加载，2026-10-22；用户「启动 BLOCK-241：大目录懒加载」） | 2026-10-22 | **completed**：超阈值 MCP server 只投影 catalog（R1，list/describe）+ call（R2，按名代理）；call 时复核 server allow/block + 逐工具 enabled/timeout；小目录零变化；货架显示目录模式。证据=block241 5/5 + mcp-projection 15/15 + 前端 18/18 + 9223 live 7/7 + closeout 十三门；UI-549 verified。reopen=按 hint 动态降档/分页>200/设置页阈值/真实>200/Q1 | BLOCK-241 / P5-CLOSED |

<!-- audit-log-compact.mjs 追加 @ 2026-10-24T05:27:10.194Z -->
| ✅ BLOCK-242（Q8 深链安装安全面，2026-10-22；用户「按照建议开 242深链安装安全面 一次整完」） | 2026-10-22 | **completed**：`petri-install://` pack/mcp 双 kind——只读预览名称/来源/下载地址/大小/SHA-256/风险/替换警告；确认重取对账 + sha/size 双验；env 禁止；pack 走 pack-lifecycle、MCP 走 mcp-settings（冲突需显式替换）；OS 协议注册（测试实例跳过）+ 扩展页「从链接安装」。证据=core 8/8 + 弹层 2/2 + 通道漂移 5/5 + 隔离 9223 live 10/10 + closeout 十三门；UI-550 verified。reopen=packaged 真机唤起/签名/allowlist/Q1 | BLOCK-242 / P5-CLOSED |
