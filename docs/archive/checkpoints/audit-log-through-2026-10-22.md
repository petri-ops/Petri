# 审计广播台历史归档 · through 2026-10-22

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-22（**BLOCK-239 Q8 MCP OAuth completed；无 active 工作包**）：HTTP MCP OAuth 授权码流程——SDK provider/auth + localhost callback + 密文 token store + 货架授权入口；授权前零投影、授权后重连出现。证据=Node 集成 6/6 + 前端 17/17 + 邻域 26/26 + 9223 live 11/11 + closeout 十三门。实机抓真=REST transport 丢失 + 未连接传输显示错误，均已修。UI-548 verified。stdio/SSE/revoke/真实 provider 矩阵 reopen。plan=`docs/block-239-q8-mcp-oauth-plan.md` §6。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-22（**BLOCK-239 Q8 MCP OAuth 立项 active（P0-LAUNCH）**）：HTTP MCP server 授权码流程——SDK 原生 `OAuthClientProvider`/`auth()` + localhost callback + 密文 token store + 货架授权入口；授权前工具零投影、授权后重连出现。非范围=stdio/SSE OAuth/revoke/真实 provider 矩阵。plan=`docs/block-239-q8-mcp-oauth-plan.md`。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-22T12:12:28.091Z -->
最后更新：2026-10-22（**BLOCK-241 Q8 大目录懒加载立项 active（P0-LAUNCH）**）：超阈值 MCP server 只投影 `catalog`（R1，list/describe）+ `call`（R2，按名代理）；调用时复核 server/tool policy；小目录零变化；状态面显示目录模式。非范围=动态 hint 降档/分页/设置页阈值/Q1 审批。plan=`docs/block-241-q8-mcp-lazy-catalog-plan.md`。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-22（**Q8 余项轻量批：MCP 四 hint completed；无 active 工作包**）：destructive/openWorld 覆盖 readOnly 降档（保守 R2），idempotent 记录；零 annotations 零漂移；不新增审批通道。证据=block240 7/7 + projection 15/15 + closeout 十三门。plan=本条目（轻量包）。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-22（**Q8 余项轻量批：MCP 四 hint 进策略 active**）：destructive/openWorld 覆盖 readOnly 降档（保守 R2）、idempotent 记录；零 annotations 零漂移；不新增审批通道。plan=本条目（轻量包）。G0 开发期常态 · 不外推 packaged/Provider/GA。
