---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W5 波「数据资产面接线」——CP-14 选择总线跨 viewer 能力位接线（canSelect/canCompare 占位接线 ≥4 类 viewer +「选择→agent」链路）/CP-15 ArtifactPinPane 可拖拽比例（60/40 固定→自由拖）+renderer 补课清单对账；成果面切片 C/E 收尾（方向文档 artifact-plane-direction 承接）
acceptance:
  - CP-14：canSelect 接线 ≥4 类 viewer（表格/markdown/json/text 等只读族）；选中实体经选择总线→「继续分析」引用链实机（组件契约）
  - CP-14b：canCompare 至少一类成对 viewer 接线（如 table↔table）
  - CP-15：分屏比例可拖拽（分隔条拖动 20-80% 钳制）+renderer 清单对账（9 类 adapter 渲染缺口如实清点）
  - closeout 十三门绿 + 总纲 §4 W5 行回写
reopen: 任一 CP 出口断言未达即该 CP 返工；波内零停顿条款沿用（/goal 整波授权连续行使）
status: active
---

# BLOCK-175 — 竞争力总纲 W5 波（数据资产面接线）

## 0. 来源与授权

- 总纲：[`agent-competitiveness-program.md`](./agent-competitiveness-program.md) §4-W5（CP-14/15）。
- 用户授权：/goal「按照波次 逐个推进…不需要问我」整波授权连续行使（W1~W4 先例）。
- 防重复：artifact-plane-direction（reference）切片 C=选择总线跨视图（本波 CP-14 承接）、切片 E=renderer 补课（CP-15 承接）；方向文档不重写。

## 1. 范围

- **CP-14 选择总线跨 viewer**：viewerRegistry 的 canSelect/canCompare 占位按 viewer 实际能力接线（表格/JSON/markdown/text 只读族可选中；表格族可成对比较）；选择总线事件→「继续分析」引用链（既有 ContinueAnalysisMenu 消费面扩展）。
- **CP-15 分屏拖拽+renderer 对账**：ArtifactPinPane 分隔条拖拽（20-80% 钳制，持久化到本地偏好）；renderer 清单对账（9 类 adapter 渲染缺口清点，缺口如实登记不硬造）。

## 2. 非范围

- 多 artifact 分屏 >2 窗格；viewer 运行时插件化；选择→写回数据集（只读引用链为准）；G1+ 不外推。

## 3. 门禁与完成语义

每 CP：定向红绿+tsc+lint。波末：closeout 十三门+实机断言（acceptance/block-175/）+UI 台账。出口全过+closeout 绿=completed；总纲 §4 W5 行回写。
