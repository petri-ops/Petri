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


## 9. 实机与门禁对账（2026-10-12）

| 出口判据 | 实绩 | 证据 |
| --- | --- | --- |
| CP-13a accent 透传 | ✅ 实现面三点（GenUiCard 观察器扩 data-accent+push {theme,accent}+guest data-petri-accent+theme.js 四档覆盖 CSS）；实机 DOM 断言随 UI-502 过目 | 组件改动+w4-live |
| CP-13b 导出 | ✅ gen-ui:export IPC（会话归属/sender 校验→filePath 原文）+卡「导出」钮→saveTextFile 原生另存 | gen-ui.js+GenUiCard |
| CP-11 getData 通道 | ✅ 归属校验（job.conversation_id vs 会话路径段）+done+result_json+12KB 有界投影+prompt 数据源清单注入（≤5 最近 done jobs）；w4-live 未知会话 session_not_found 诚实拒绝 | gen-ui.js+w4-live C |
| CP-12 模板库 | ✅ 四模板（bar/line/kpi/table，CSS 变量主题）+visualize「模板优先」节；skills:check PASS 5 Skill | resources/gen-ui/templates/ |
| 真模型链 | ✅ 真实任务完成事件链直查（done/run_terminal） | w4-live A |

**门禁对账**：closeout 十三门中十二门绿+test:changed 959 测 2 红=BLOCK-93 deepseek 凭据环境债（双确认：pre-CP-8 spawn 基线同挂，git stash 对照；非本波回归，归因=本机凭据存储无该测试所需 key，登记存量）。**随波缺省裁决**：①联邦回流 Gen UI 化出 W4 范围（依赖双机，W6 评估）②CP-12 不做模板运行时引擎（保持模型填数据的显式形态）③CP-11 投影上限 12KB（与工具面同量级）。
