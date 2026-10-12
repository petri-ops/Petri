---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W4 波「Gen UI 表达面双轨」——CP-13a accent 透传（沙箱跟随实例主题色）/CP-13b 文件导出（fragment 存档）/CP-11 artifact/job 数据面绑定（guest 只读数据通道+prompt 注入可用源）/CP-12 场景锚定 widget 模板库（gen-ui 模板文件+visualize 技能指引）；双轨=模板通用形+artifact 数据自有锚
acceptance:
  - CP-13a：沙箱 petri-set-globals 携带 accent（data-accent 变化→iframe 主题跟随）
  - CP-13b：卡片「导出 HTML」存档可用（原生另存对话框）
  - CP-11：guest getData(jobId) 只读通道（归属校验+有界投影）+契约
  - CP-12：模板文件 ≥3（bar/kpi/table）+visualize 技能模板节；技能契约校验绿
  - closeout 十三门绿 + 总纲 §4 W4 行回写
reopen: 任一 CP 出口断言未达即该 CP 返工；波内零停顿条款沿用（/goal 整波授权连续行使）
status: active
---

# BLOCK-174 — 竞争力总纲 W4 波（Gen UI 表达面双轨）

## 0. 来源与授权

- 总纲：[`agent-competitiveness-program.md`](./agent-competitiveness-program.md) §4-W4。
- 用户授权：/goal「按照波次 逐个推进…不需要问我」整波授权连续行使（W1/W2/W3 先例）。
- 双轨修正（用户裁决「不仅仅是增加数据资产」）：通用模板形与 artifact 数据锚**并轨**——模板不带数据绑定是空壳，数据绑定不带模板是低一致性输出。

## 1. 范围

- **CP-13a accent 透传**：GenUiCard 主题推送携带 accent（themes/accents token），guest 侧 theme.js 映射 `--petri-accent` 族。
- **CP-13b 导出**：卡片头部「导出 HTML」——把沙箱 fragment 原文经既有 files.saveTextFile 原生另存（UI-444 先例形态）。
- **CP-11 数据面绑定**：guest 桥新增 `petri.getData(toolJobId)` 只读 RPC——主进程校验 job 归属（会话绑定链）后有界返回 `{status, result}`（复用 localizeToolResult 投影上限）；gen-ui-prompt 注入「可用数据源 jobIds」清单（仅 workspace 绑定会话）。
- **CP-12 模板库**：`resources/gen-ui/templates/` 新增 bar/line/kpi/table 四模板（纯静态+CSS 变量主题，数据占位符由模型填充）；visualize 技能文档增「模板优先」节；skills:check 过。

## 2. 非范围

- 联邦回流 Gen UI 化（依赖双机环境，W6 后评估）；模板运行时注入/自动渲染引擎（保持「模型填数据」的显式形态）；实时数据流。

## 3. 门禁与完成语义

每 CP：定向红绿+tsc+lint。波末：closeout 十三门+实机探针（沙箱 accent/导出/数据通道，acceptance/block-174/）+UI 台账。出口全过+closeout 绿=completed；总纲 §4 W4 行回写。
