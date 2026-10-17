# 审计广播台历史归档 · through 2026-10-17

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-17（**BLOCK-193-EVALS-CAPTURE-REPLAY 整包 completed（评测 v2 第五切片·capture/replay 真实录制态；closeout 十三门全绿；实机录制 real 3/3 PASS·measures=model → 离线零 API 回放 3/3 PASS·measures=recorded-replay）**）：录制态=**收割生产 io-transcript 台账**（不新建代理、不写第二套 SSE 解析，零新增采集面）+ 入库双闸（`secret-scan` 模式单源密钥扫描 + 合成任务闸核验转录逐字含仓库 prompt）+ replay 复用 `startMockProvider` 且缺 `outbound_contains` 哨兵即判红 + (suite,provider) 产物 namespace（回放报告/基线与真模型互不覆盖，堵掉假绿通道）。**顺带修出 BLOCK-189 既有缺陷**（实机腿踩出，非新引入）：`outbound_contains` 把 `JSON.stringify` 的单行 blob 喂给按「折到行尾」设计的 `<ENV>` 归一化规则 → 一路吞掉整条出站，真模型三例哨兵全 ×0 假红；读侧还原转义换行修复，`normalizeContextString` 本体与快照 fp `ed098adbc5d63943` 零变更，并固化缺陷守卫测（如实登记：该哨兵此前只由旁路请求满足，修复后 agent 主请求亦计入=加强）。契约测 15/15（含罐头假绿反证）·邻域 58/58·`test:changed base=9e16b7ca` 94pass/0fail·smoke 9/9 golden 1/1 不回归·`evals:gate` real 与 real-replay 双回归 0·`output:judge` fit=3.05 PASS。录制产物 `evals/recordings/real/` 共 10.2KB——体积一侧实测根本不是问题。plan=docs/block-193-evals-capture-replay-plan.md。**无 active 工作包**。G0 开发期常态 · 不外推 packaged/Provider/GA。）
