---
capability: harness-productization
goal: 把开发侧沉淀的 harness 资产按「产品化四问」分批转化为格物 agent 的编码能力——第一批以 C-13 符号图查询为起点，让 agent 在编码任务里能自主查询符号引用关系
acceptance:
  - P0 勘察结论落盘本 plan §3（资产四问盘点 + C-13 决策点 D1-D5 + 组合勘察缺口），实现动手前经用户确认
  - C-13 实现（P1）：红绿先行契约测试先落 → agent 工具注册四件套 → dev 栈实机走查（agent 自主调用符号查询完成编码任务）证据落 acceptance/block-124/
  - 台账同步：roadmap/AUDIT-LOG/backlog（C-13 编入注记、C-18/C-19 勘察转候选）同提交
reopen: 用户裁决产品方向回摆或本线让位其他主线时（参照 product-strategy-review-2026-09 §4）
status: active
---

# BLOCK-124 — Gewu Harness 产品化 · 第一批（P0 勘察）

> 立项：2026-09-26（P0-LAUNCH；用户裁决原话见 §1）。P0 勘察当日完成，**实现动手前等用户确认**（用户明示流程）。
> 能力：`harness-productization`（HK-04 增量采纳：立项即带 capability front-matter）。

## 1. 一句话目标与裁决来源

把开发侧 harness 资产（HK 系列、closeout 门禁、决策工具、走查探针）逐项过「产品化四问」，产出分批路线图；第一批实现件 = **C-13 符号图产品化**——symbol-graph 的 who-imports / classify-edges 查询注册为格物 agent 的内建工具，agent 在编码任务里能自主查询符号引用关系。

**用户裁决（2026-09-26 原话）**：「启动『Gewu Harness 产品化』第一批工作」+ 授权前置「2026-09-26 方向裁决：通用编码 harness 使用界面 = 开发主线（BLOCK-123 已整包 completed）」+「候选池 C-13 触发条件今日全部满足：HK-03 已收口 + 产品方向裁决落定」+ 流程约束「P0 勘察报告先给我看，确认后再进入实现」。

**红线（用户明示）**：
1. 开发侧 `.agents/skills` 与产品 `resources/skills` 两轨不混；产品化走资源 skill 轨**新建**，不复制文件。
2. dev-verify / impact-map / closeout 等纯开发设施**不产品化**。
3. 每步走立项检查单；范围外发现转候选池不扩 scope。

## 2. 范围与非范围

**范围内**：① P0 勘察（资产清单×四问 + C-13 方案骨架 + BLOCK-123 组合勘察）；② P1（待用户确认后）= C-13 落地；③ 勘察发现的范围外项登记候选池（C-18/C-19）。

**明确不做（非范围）**：插件/垂直生信域（C-15 在案）；RTK 输出压缩（C-14 在案）；审阅徽章 ±行数（C-16 在案）；closeout/决策工具 CLI 等开发设施的产品化（§3.2 逐项裁决为不产品化）；G1+ 事项（packaged/Provider/GA）。

## 3. P0 勘察结论（2026-09-26）

### 3.1 C-13 方案骨架与决策点

**资产现状**：`scripts/symbol-graph.mjs`（429 行，HK-03 P1 产物）——库函数 `buildGraph(rootDir)` / `whoImports(graph, symbol)` / `classifyEdges(graph, file)` 纯净可导入，CLI 只是文本薄壳；typescript Compiler API AST 级解析（.js/.cjs/.mjs/.ts/.tsx）；契约 `test/symbol-graph.test.mjs` 10/10；选型文档 `docs/hk03-symbol-graph-selection.md`；诚实盲区（变量形式动态 require/按路径动态调用/字符串引用）报 UNRESOLVED 不猜测。

**产品工具面空位已证实**：agent 内建工具 71 个（9 域），**零代码理解/符号查询工具**——search/query 均为知识空间/浏览器检索。C-13 填的是明确空位。

**接入点（勘察坐实）**：执行单入口 `core/biof3-server/agent-tools/tool-execution.js` `executeToolCall`（`mcp/registry.js` 是插件/skill MCP 轨即 run_tool→tool_job→artifact 链，**不是**本件归宿）；定义面 `tool-defs.js` facade 按 9 域汇编 `tool-defs/<domain>.js`；结果回 UI 走 `tool-events.js` → 前端 toolActivity 工具行。

**决策点（实现前需用户确认，推荐方案已标注）**：

| # | 决策点 | 选项 | 推荐 |
| --- | --- | --- | --- |
| D1 | typescript 依赖类 | a) devDependencies → dependencies；b) 懒 require + 不可用降级（packaged 静默缺位） | **a**——产品能力正当化；纯 JS 零原生绑定；走 DEPENDENCY-CHANGE-CHECKLIST 需用户显式裁决（默认「不增」例外） |
| D2 | 代码单源 | a) 库函数迁 `core/biof3-server/`，`scripts/symbol-graph.mjs` 变薄壳，10 条契约追新家；b) core 反向 import scripts（违依赖方向） | **a**——BLOCK-119 judge-core「core 单源 + scripts 薄壳」同款先例；quality:arch 依赖方向约束 |
| D3 | 工具轨 | a) agent-tools 内建轨新域（只读 `sideEffect=none`）；b) 插件 MCP run_tool 轨 | **a**——`decision_recent/summary`（BK-04）同款：只读查询非 artifact 产出型；四件套=定义+契约注册+contracts 测试+前后端动词/图标 fixture 同步 |
| D4 | 工具命名 | `codegraph_who_imports` / `codegraph_classify_edges`（或 symbol_* / workspace_* 前缀） | **codegraph_***（语义准确、与 workspace_* 读文件面区分） |
| D5 | v1 性能边界 | a) 无缓存 + 文件数上限 + 超限诚实报数；b) 加 TTL/增量缓存 | **a**——buildGraph 全量走查解析对中小项目秒级；缓存失效正确性复杂，留观察；UNRESOLVED 盲区语义透传进工具描述（agent 指引） |

**搭车能力**：`whoImports` 天然分类 USED_TEST/USED_PROD——agent 问「哪些测试引用这个模块」即免费覆盖，编码任务里「改这个函数要动哪些测试」有直答面。

### 3.2 资产清单 × 产品化四问

| 资产 | ① 产品用户是谁 | ② 什么形态承载 | ③ 产品是否已有等价能力 | ④ 边界在哪 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| HK-03 symbol-graph 查询 | 工作台里驱动编码任务的 agent 用户 | agent 内建只读工具（codegraph_*） | **无**（71 工具零代码理解面） | 静态分析 UNRESOLVED 盲区如实透传；不做语言服务器；dev CLI 保留开发轨 | ✅ 本批 C-13 |
| HK-04 规格层（front-matter 四键 + capability 视图） | 本仓开发治理，非产品用户 | dev docs 门禁（docs-governance.mjs） | 产品 skill 已有结构化元数据（skill.json：workflows/prompts/parameters） | 纯开发设施（红线 2） | ❌ 不产品化 |
| HK-01 红绿先行 | 本仓 agent 实践纪律 | dev-infra skill 节 + 委派任务书 §4 | 产品无此概念；产品侧回声（agent 先测后改的行为提示）属行为调优 | 纯开发设施；产品回声转候选 | ❌ 本批不产品化（→C-19） |
| HK-02 YAGNI 七维度 | 本仓评审纪律 | code-review skill 维度 7 | 无产品等价需求 | 同上 | ❌（→C-19） |
| closeout 十一门 | 本仓收口门禁 | dev-infra closeout-gates.mjs | 产品 agent 已有 verify_state + workspace_exec 跑测试 | 纯开发设施（红线 2，用户明示） | ❌ 不产品化 |
| 决策工具 CLI（test:suggest / doc:suggest / output:judge / decision:report / failure-triage） | 本仓开发流程 | dev CLI（block115/118/119 系脚本） | 产品运行时已有七接点热调 + report-guard 汇报门（已产品化的等价物） | dev CLI 服务本仓开发，不迁移 | ❌ 不产品化 |
| 走查探针（block123-p0/p1-*） | 本仓验收证据工具（scriptRole=governance） | dev 探针 + impact-map 登记 | 无需等价物（用户不可见） | 实机证据工具非回归测试 | ❌ 不产品化 |
| workspace 工具面 + 工作台四件套（file tree/标签/终端/审阅） | 产品用户 | 已是产品 | —— | —— | ✅ 已在产品（BLOCK-123 verified），按走查反馈迭代 |
| 产品 skill 轨（resources/skills，现有 3 个生信 skill） | 产品用户 | skill.json + workflows/prompts/parameters | —— | 红线 1：新建不复制 | 批次 3 候选（→C-18） |

### 3.3 BLOCK-123 组合勘察：编码任务里 agent 还缺什么

三轮走查（P0 六环节 + 错误恢复 + 多文件 TTL）已证闭环零断点；在此基线上，勘察识别的**增量缺口**（非断点）：

1. **代码理解查询面**（本批 C-13 直接补位）：agent 现在答「谁在用这个函数/删了会崩哪」只能 grep+逐文件读；who-imports/classify-edges 给出 AST 级直答 + USED_TEST 反向测试面。
2. **exec 错误反馈增形**（G-04 绕路的根治方向）：指令带了不存在的 runner 名时 agent 多绕一次字面重试——若 exec 命令不存在（ENOENT）时错误信息列可用候选（如项目内检测到的 *.test.js / package.json scripts），可省一轮。批次 2 候选。
3. **reject→agent 调整回路**（C-17a）：审阅面板拒绝目前止于 UI 状态，agent 无信号感知「用户拒了什么、为什么」；回路打通后 agent 可自主调整。批次 2 候选。
4. **终端反馈面**（C-17b）：终端 dock 已在（G-02 销号确认设计如此），但「agent 执行过程在终端面的可见性」体验未走查。批次 2 候选。
5. **git 查询面观察项**：agent 无 git_* 工具，但审阅/提交走 UI 面已闭环（ReviewMode verified）、workspace_exec 可达 git CLI——暂不扩，真实使用反馈触发再议。

## 4. 分批产品化路线图

| 批次 | 内容 | 启动条件 | 载体 |
| --- | --- | --- | --- |
| 批次 1（本包 P1） | **C-13 落地**：D1-D5 按确认裁决执行——库函数迁 core 单源 + agent-tools 四件套 + 红绿契约 + 实机走查（agent 自主调用符号查询完成一次删除安全性判定或重构影响面任务） | **用户确认本 P0 报告后** | 本 plan P1；证据 acceptance/block-124/ |
| 批次 2 | 编码缺口小刀：G-04 exec 错误增形 / C-17a reject→回路 / C-17b 终端反馈面——按真实使用反馈择优，逐项独立登记 | 真实使用反馈触发或用户点名 | 各自独立 UI-###/BLOCK 登记 |
| 批次 3 | 编码 playbook 资源 skill（产品 skill 轨新建）/ 开发纪律产品回声（红绿先行提示 + YAGNI 自检的行为化评估） | 候选池条件满足 | C-18 / C-19 |

## 5. 验收门禁与证据位置

- P1 实现门禁：红绿先行（契约测试先红后绿，证据随收口笔录）+ `npm run test:changed` 定向 + tsc 0 + docs:check + ui:audit:check + closeout 相关门（quality 系）；新脚本 impact-map 登记。
- 实机走查：dev 栈测试实例，agent 真实编码任务自主调用 codegraph_* 工具，SSE 工具序列 + 任务完成证据落 `acceptance/block-124/`。
- 完成语义：dev Electron 边界内 verified（当前阶段最高证据等级）。

## 6. 边界与风险

- **WIP 隔离**：会话启动核对到 `eslint-suppressions.json`（M，LeftPanel.test.tsx 抑制计数，来源不明）+ untracked `nul` / `ui446-tes2.txt`（UI-446 会话残留）——本包零触碰，已如实上报用户。
- typescript 迁依赖类（D1）影响安装体积（纯 JS ~MB 级），G0 不校验 packaged 体积，如实登记待 G1 观察。
- G0 开发期常态 · 不外推 packaged/Provider/GA；单工作包串行纪律不变。
