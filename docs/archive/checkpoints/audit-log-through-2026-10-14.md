# 审计广播台历史归档 · through 2026-10-14

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-14（**BLOCK-166-NAV-GUARD 立项当日收口 completed（用户预授权加开第五批；2026-10-12「可以排期修」knownGap 落地）**：Gen UI 沙箱帧导航劫持收口——①拆除 BLOCK-166 P3 失实死码（params 签名不匹配+preventDefault 已证无效的「勿回退」注释）②主进程侦测推送（gen-ui:sandbox-hijacked 新通道，**进程登记法**：OOPIF routingId 跨导航会变/fragment 自导航不派发 will/CSP 拦截不提交 did，全参位实测定案；主可达路=did-fail-load(-30)）③GenUiCard 帧匹配即时重置（恢复 9-11s→亚秒）④30s×3 循环限幅挂起面。验证=组件 4/4+gen-ui 37/37+channels 5/5+tsc 0+实机探针全链 PASS（真 fragment 自劫持循环→挂起，导航→挂起 17s vs 心跳路径 ~29s+）。plan=docs/block-166-nav-guard-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。）
