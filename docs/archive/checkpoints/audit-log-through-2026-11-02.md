# 审计广播台历史归档 · through 2026-11-02

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-02（**BLOCK-328-EARLY-LOOP-GUARD completed（当日立项当日收口；用户裁决「行呀 开整」）**：327 取证收口两道防线——①加载期守卫 `helpers/early-loop-guard.js`（server.js 在 require('./db') 前定格基准、db 加载后超 3000ms 告警；**实证**：持写锁 3.5s 启动 → `[early-loop] ⚠ module-load phase took ~3456ms` 在监听前打出，昨天隐形的同步 busy 等待现在可见）②`initSchemaWithBusyRetry`（退避 2s/5s，仅 busy_timeout 10s 耗尽后介入，非 BUSY 立抛 fail-closed）。零行为变化（正常启动无告警无重试）。证据=契约 5/5（含真进程持锁集成）+ 邻域 13/13 + closeout 十一门 PASS。**实机抓真**：`db/schema.js` 被先 require 时循环加载 TDZ（HEAD 同样崩 initSchema is not a function）——本包把自有导出前置挂载到 require('./connection') 之前消除入口盲点，但 `getCurrentG0Baseline` TDZ 属存量，登记 🟡 不扩界。plan=docs/block-328-early-loop-guard-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。）
