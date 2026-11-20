# 乙组剩余（乙5–乙8）证据包 · BLOCK-503 人眼核对

> 采集时间：2026-11-20（dev Electron 可见窗 + CDP 9222；需窗口尺寸/主题/accent 操作的项在 9223 离屏测试实例取材，跑完 kill）。
> **判定归用户**：本包全部为截图 + DOM/机械读数，**零代签**——观感 verified/cancelled 由用户按 BLOCK-503 清单口令回填（Agent 按口令回写台账）。

## 索引

| 项 | 证据目录 | 采集形态 | 机械结论摘要 |
|---|---|---|---|
| 乙5 · P4 八态矩阵 12 人眼格 | `yi5-matrix/` | 16 PNG（4 类元件×{hover,active,focus-visible}×默认/触发态）+ findings.json + matrix-checklist.md（判定列留空） | 11/12 格机械读数就位；input:hover 无 :hover 规则（CSS 真源佐证，零差异为真实读数）；navItem:active 由 /extensions 四货架真 tabs（aria-selected）承载，左栏 QuickActions isActive 恒 false（mode:null）为诚实读数 |
| 乙6 · P5/P6 四槽 | `yi6-p5p6/` | 6 PNG（空态/流式 pending/compose 占位/compose 完成/错误态/skill 工具行）+ findings.json | 5 腿全绿：流式 pending（运行统计条+占位无 JSON 泄漏）、compose 完成（合成持久化消息经真实 hydrate 链渲染，metric 卡在场）、错误 banner（role=alert）、P6 skill 链两行工具行（已列技能/已读技能本地化标签） |
| 乙7-A · H-01+H-02 | `yi7a-h01h02/` | 4 PNG + findings.json | H-01：/extensions bare（无品牌 chip）vs 项目工作区 chip+标题 双态读数；H-02：769 未触发/768 恰好触发（matchMedia max-width:768 单源，768 态左栏元素按 CSS @media 真实消失） |
| 乙7-B · H-03+H-04 | `yi7b-h03h04/` | 5+10 PNG + findings.json | H-03：暗色 4 类元件 hover 同档 rgba(230,237,243,0.07)（文本钮 0.06 如实登记；input 无 :hover 规则）；H-04：5 accent×明暗 10 态 outline 全随 accent 明暗成对派生（专用 token --petri-selected-border） |
| 乙7-C · H-05+H-06 | `yi7c-h05h06/` | 5+4 PNG + findings.json | H-05：5 个真实三级文字样本对比度 4.75–21.0（当场无 <4.5 项，4.40:1 组合未复现——如实标注）；H-06：4/12 缺口文件实测（3 个 fv=true 可见焦点环；desktop.css fv=false+outline:none=登记在册的真 gap 实锤），8 个如实标注不可达（数据/组件未挂载） |
| 乙8 · E-01+E-02 | `yi8-e01e02/` | 5+3 PNG + findings.json | E-01：五步机械点击序列（MCP 货架 2 击、设置→快捷键 3 击、审阅=右栏 tab、新建任务=工作台视图不路由 /projects——如实读数）；成功率/首击率=真人样本判据。E-02：22 条分层扫描（可过目 3 条 UI-695/200/331 截图；11 verified 在场复核受限如实标注；2 cancelled 留因核对） |

## 环境与边界（如实登记）

1. **窗口尺寸事故与复原**：采证早期用 CDP `Emulation.setDeviceMetricsOverride` 试图做 H-02 真实窗口 resize，在 Electron 上留下 target 级仿真残影（窗口指标一度错乱）；**已重启 dev 栈复原**（现窗口 1937×1328，media query/matchMedia 读数正常）。此后所有尺寸类取证改走 9223 测试实例 + 应用自带 zoomBy IPC（CSS 布局视口等效），主窗零 Emulation 触碰。
2. **乙6 会话污染**：mock SSE 注入的消息落在当前 fixture 会话（UI-711 同款先例）；mock run 无后端持久化，视图会在完成后回空——完成态经 messages 劫持的合成持久化消息呈现（前端 hydrate 链全真实，如实标注）。
3. **H-02 判据形态**：CDP 在 Electron 无真实窗口 resize（Emulation override→clear 恒回弹，实测沉淀）；zoom 路线=CSS 布局视口等效（media query 真实响应），窗口步进 ~1.5px，769 态取最近可达宽，读数如实。
4. **H-04 色数漂移**：路线写 4 主题色×明暗 8 态；现选面板 5 档（teal/blue/violet/rose/amber）→ 全量 10 态取材，漂移如实登记。
5. **H-06 覆盖**：12 缺口文件中 4 个实测（AnnotationBar 需 artifact、审阅三件需工作树变更态、知识控制台需会话、扩展两件组件未挂载、home 页组件未命中——各自如实标注）；VoiceOver 朗读部分留真人（路线原文）。
6. **E-02 verified 项**：复核以「面可达性+当前数据可见性」为限（子智能体族 6 条需真实多轮任务数据），不冒充观感签字。
7. **零写面**：未改任何 CSS/组件/配置/持久数据；乙6 受控注入仅落内存态；主题/accent/投影标志均用后复原。

G0 开发期常态 · 不外推 packaged/Provider/GA。
