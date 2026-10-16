# 审计广播台历史归档 · through 2026-10-14

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-14（**BLOCK-166-NAV-GUARD 立项当日收口 completed（用户预授权加开第五批；2026-10-12「可以排期修」knownGap 落地）**：Gen UI 沙箱帧导航劫持收口——①拆除 BLOCK-166 P3 失实死码（params 签名不匹配+preventDefault 已证无效的「勿回退」注释）②主进程侦测推送（gen-ui:sandbox-hijacked 新通道，**进程登记法**：OOPIF routingId 跨导航会变/fragment 自导航不派发 will/CSP 拦截不提交 did，全参位实测定案；主可达路=did-fail-load(-30)）③GenUiCard 帧匹配即时重置（恢复 9-11s→亚秒）④30s×3 循环限幅挂起面。验证=组件 4/4+gen-ui 37/37+channels 5/5+tsc 0+实机探针全链 PASS（真 fragment 自劫持循环→挂起，导航→挂起 17s vs 心跳路径 ~29s+）。plan=docs/block-166-nav-guard-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-10-16T07:30:36.179Z -->
最后更新：2026-10-14（**BLOCK-183-DATA-BRIDGE-WS 整包 completed（当日立项当日收口；CP-19 收官=竞争力总纲 19 包全闭环；用户裁决「行 你启动我来测试看看」）**：数据桥 WS 化——P0 /m/api/ws 扩 `data` 信封（GET 七路径白名单 fail-closed+并发上限+8s 超时；服务端 loopback 自调既有路由零第二实现）+P1 前端 projectionWsData 单连接 WS-first+3 连失败 5min 冷却回退 HTTP（BLOCK-162 形态复用）；POST/写面/agent 流/终端流零触碰。验证=红绿 8+6 用例+block162 邻域 13/13+tsc 0+test:changed 全绿+实机探针 allPass（七路径 data-res 与 HTTP 逐字节同形状，acceptance/block-183/）。**顺手清偿**=streamReconnect 4 存量红（BLOCK-159 抖动+无硬上限语义未同步该测试，干净树 bisect 坐实非本包面）+AUDIT-LOG 三条过期 🟡 行销号（轻量对账批）。plan=docs/block-183-data-bridge-ws-plan.md §6。G0 开发期常态 · 不外推 packaged/Provider/GA。）
