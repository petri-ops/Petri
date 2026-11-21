## UI-714: 乙组观察点落地小批——compose chart/table 渲染接线 + 左栏导航 aria-current + model-btn hover 收敛单一档（2026-11-20 **in_progress（代码+契约+实机腿 3/3 allPass；观感零代签）**）

**判据与实现**（三处均为 2026-11-20 YI-REST 系列登记的观察点落地，用户发令「开整」）：

1. **chart/table 渲染接线**：`registerDefaultRenderers()` 此前仅测试注入，compose 渲染面的 chart/table 叶子一直走 TextRenderer raw-payload 兜底（乙6 完成态实证 chart 以结构化 JSON 形态显示；P7 定性=渲染缺口非数据形态）。接线=`ComposeCard` 挂载 effect 幂等调用（Map.set），SimpleChat result-card 注入仍按原契约延迟。HK-01 红→绿：catalog.test 新增断言（svg 在场+无 raw JSON）先红后绿；定向 8 文件 102/102（含 ChartRenderer/TableRenderer/extraRenderers/theme-token 19 断言零回归）。**实机腿**：ui709-live 夹具（真实 ComposeCard+五节点 spec）chart svg 在场、raw JSON 消失、数据标记 4+图例钮在场——证据=acceptance/ui-714/chart-live.png+live-assertion.json。夹具页手设深背景 vs 组件默认 light token 的柱体低对比属夹具样式，非产品缺陷（真实会话按主题 token）——观感（图表配色/可读性）留用户实机过目。
2. **左栏导航 aria-current**（乙5 navItem:active 留因闭环）：QuickActions isActive 恒 false（mode:null）→ 随路由派生 routeActiveKey（/extensions→扩展、/knowledge→知识空间标 aria-current=page；「新建任务」为动作钮不标）。LeftPanel.test 双测（/extensions 与 /knowledge 正断言+项目路由全不标）。
3. **model-btn hover 收敛**（乙7 H-03 留因闭环）：`.sc-model-btn:hover` 原借 `--petri-user-bubble-bg`（气泡底，暗 0.06）→ 改 `--petri-hover` 真源（暗 0.07 单一档）。ui-visual PASS（hover 单源）；实机探针暗色 hover computed=rgba(230,237,243,0.07)。

**边界**：零新依赖；`code-size` 重打（LeftPanel.tsx 842→851 +9 行=本批派生块，留因；loop-orchestrator 指纹随前批残留在案）；loop-orchestrator/其余他方面零触碰；renderers/index 与 ResultCardRenderer 头注释同步现状。**观感零代签**——chart 在真实会话中的视觉质量与 hover 色差感知留用户过目后翻 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

