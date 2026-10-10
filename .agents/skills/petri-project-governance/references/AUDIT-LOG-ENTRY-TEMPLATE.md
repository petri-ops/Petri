# AUDIT-LOG 条目模板

> `docs/AUDIT-LOG.md` 是活跃广播台：只保存需要主 Agent 看见的活跃项与最近处理记录，不堆完成历史。
> 新条目插表首；头部"最后更新"行前插同主题摘要。历史（archive/、已收口 plan 内的旧引用）不改写。

## 表行格式

```
| YYYY-MM-DD | **<PLAN-ID 或主题> <动作>（<状态/阶段>）**：<正文> | <PLAN-ID> / <PHASE> |
```

## 正文要件（按动作类型取舍，缺项说明原因）

**启动登记（active）**：用户裁决来源原话 → 范围与非范围（红线）→ 阶段划分 → 环境纪律 → 与并行包的文件面隔离声明。

**阶段/收口（completed / P#-COMPLETED）**：门禁总账（定向测试 x/x + tsc 0 + docs/ui 门禁）→ 实机断言（脚本名 + N 断言 allPass，证据落 `acceptance/<block>/`）→ 实机抓真修复 → 范围守住 → 遗留候选 → 红旗归属（他包在制面/存量漂移，如实归属）→ 提交哈希。

**planned 立项评估**：可行性结论 → 设计裁决 D1-Dn（⏳ 待评审项标注）→ 风险诚实登记 → 阶段划分 → 排队现状。

## 固定纪律

- 「G0 开发期常态 · 不外推 packaged/Provider/GA」**每条收口恰一次**；不列举未做的 G1+ 项
- 断言与证据数字不可编造；`qualificationEligible: false` 是 G0 常态，不写入任何条目
- 轻量小包可不建独立 plan 文件：写明"plan=本条目（对标 TEST-INFRA-DEBT 轻量模式）"
- 加映（addendum）：同一包后续增量用"加映 N"标题，DOC-REGISTRY/plan 状态头同步

## 最小示例（收口）

```
| 2026-09-09 | **BLOCK-71-DEV-INFRA-SOLIDIFY 登记并同会话收口（用户裁决「全做」；plan=本条目，对标 TEST-INFRA-DEBT 轻量模式）**：
交付 ①…⑦；顺手清 <存量债>；门禁实况：docs:check PASS(N)/docs:reconcile 0/定向单测 x/x；
<红旗> 三门红为并行在制面或存量漂移，非本包文件面，如实登记。BLOCK-69/70 文件面零触碰。
G0 开发期常态 · 不外推 packaged/Provider/GA. | BLOCK-71-DEV-INFRA-SOLIDIFY / COMPLETED |
```
