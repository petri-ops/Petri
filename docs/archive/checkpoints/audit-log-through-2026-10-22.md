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

<!-- audit-log-compact.mjs 追加 @ 2026-10-22T16:31:10.447Z -->
最后更新：2026-10-22（**BLOCK-242 Q8 深链安装安全面立项 active（P0-LAUNCH）**）：`petri-install://` pack/mcp 双 kind——来源/下载地址/大小/SHA-256/风险/替换警告只读预览；确认重取对账 + sha 双验；env 禁止；安装复用 pack-lifecycle/installPlugin；扩展页「从链接安装」。非范围=packaged 真机唤起/签名/远程目录/Q1 审批。plan=`docs/block-242-q8-deeplink-install-plan.md`。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-22（**BLOCK-241 Q8 大目录懒加载 completed；无 active 工作包**）：超阈值 MCP server 只投影 catalog(R1 list/describe)+call(R2 按名代理)；调用时复核 server/tool policy；小目录零变化；货架显示目录模式。证据=block241 5/5 + projection 15/15 + 前端 18/18 + 9223 live 7/7 + closeout 十三门；UI-549 verified。reopen=按 hint 动态降档/分页>200/设置页阈值/真实>200/Q1。plan=`docs/block-241-q8-mcp-lazy-catalog-plan.md` §6。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-23T01:40:07.565Z -->
最后更新：2026-10-22（**BLOCK-243 Q1 审批契约 v2 + MCP trust 生效立项 active（P0-LAUNCH）**）：审批请求 scope once/task/always；updatedInput 批准时重跑 schema/preflight/policy（只放行本次 guardKey，新风险拒绝）；permission.resolved 审计（原始/生效参数哈希 + 有界脱敏 + 耗时）；重复 pending 幂等 + 计数；MCP `trust='ask'` 仅对 destructiveHint 工具要求审批、`allow` 自动放行（调用时重读）；审批卡三变体/确定性解释/长命令折叠/参数编辑/范围/两步武装。非范围=非 MCP 持久 always/模型解释/编辑重发 checkpoint/权限三档。plan=`docs/block-243-q1-approval-contract-plan.md`。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-22（**BLOCK-242 Q8 深链安装安全面 completed；无 active 工作包**）：`petri-install://` pack/mcp 双 kind——来源/下载地址/大小/SHA-256/风险/替换警告只读预览；确认重取对账 + sha 双验；env 禁止；pack 走 pack-lifecycle、MCP 走 mcp-settings；扩展页「从链接安装」。证据=core 8/8 + 弹层 2/2 + 通道 5/5 + 隔离 9223 live 10/10 + closeout 十三门；UI-550 verified。reopen=packaged 唤起/签名/allowlist/Q1。plan=`docs/block-242-q8-deeplink-install-plan.md` §6。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-23T07:03:39.287Z -->
最后更新：2026-10-22（**BLOCK-243 Q1 审批契约 v2 + MCP trust 生效 completed；无 active 工作包**）：审批 scope once/task/always + updatedInput 批准前重跑 schema/preflight/policy（新风险拒绝）+ 编辑参数执行替换 + permission.resolved 审计（原始/生效哈希/脱敏输入/耗时）+ 重复/计数；MCP `trust='ask'` 对 destructiveHint 工具生效、`allow` 自动放行（调用时重读），货架可改回 ask；审批卡三变体/确定性解释/长命令折叠/参数编辑/范围/两步武装。证据=Node 契约 15/15 + 邻域 69 通过 0 失败 + 前端 59/59 + types 0 + 隔离 API 实机 14/14 + 隔离 9223 亮 21/21/暗 21/21 + closeout 十三门；UI-551 verified。实机抓真=测试实例 `show:false` 与 `--onscreen` 冲突致截图超时，已修 `_window-create.js`。reopen=非 MCP 持久 always/模型解释/编辑重发 checkpoint/权限三档。plan=`docs/block-243-q1-approval-contract-plan.md` §6。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-23T11:55:14.754Z -->
最后更新：2026-10-22（**QODER 剩余队列对账 + Q-MATRIX 回写（docs-only）**）：抓真 Q1 的 A1 非 guard 通用审批、A5 同参循环检测、A8 逐工具列表与 C19 ASQ **只在 Q-MATRIX 原表、未写进 BLOCK-243 reopen**；Q9 余项散在各 BLOCK reopen，UI-544/545/546 只在 UI 台账/roadmap 一句话。处置=BLOCK-243 plan 补齐 4 项 reopen；Q-MATRIX 6 包回写为 **✅32 / 🟡47 / 🔴16 / ⛔7 = 102**；Qoder 总纲新增 **§6.5 剩余队列**（Q1-REM/Q2/Q2b/Q3/Q4a/Q7/Q4b/Q5-REM/Q6-REM/Q8-REM/Q9-REM/P4-REM + V-REM）；backlog/roadmap/handoff 指向 §6.5。docs:check/ui:audit/hygiene 绿。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-23T13:32:11.202Z -->
最后更新：2026-10-22（**BLOCK-244 Q1-REM 审批控制面收尾立项 active（P0-LAUNCH）**）：逐工具 allow/ask/deny 策略（A1/A8）+ 同参循环防护（A5）+ 确定性意图/侧边任务变体（A2/A7）+ `ask_user_question` 结构化提问（C19）+ 完全访问确认层（D3）+ 编辑重发 workspace-checkpoint（C5）；复用既有审批资源/guardKey/指纹通道。非范围=模型意图解释/规则合成 UI/多问题批次/G1+。plan=`docs/block-244-q1-rem-approval-tail-plan.md`。G0 开发期常态 · 不外推 packaged/Provider/GA。
