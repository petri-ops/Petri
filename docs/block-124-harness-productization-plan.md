---
capability: harness-productization
goal: 把开发侧沉淀的 harness 资产按「产品化四问」分批转化为格物 agent 的编码能力——第一批以 C-13 符号图查询为起点，让 agent 在编码任务里能自主查询符号引用关系
acceptance:
  - P0 勘察结论落盘本 plan §3（资产四问盘点 + C-13 决策点 D1-D5 + 组合勘察缺口），实现动手前经用户确认
  - C-13 实现（P1）：红绿先行契约测试先落 → agent 工具注册四件套 → dev 栈实机走查（agent 自主调用符号查询完成编码任务）证据落 acceptance/block-124/
  - 台账同步：roadmap/AUDIT-LOG/backlog（C-13 编入注记、C-18/C-19 勘察转候选）同提交
reopen: 用户裁决产品方向回摆或本线让位其他主线时（参照 product-strategy-review-2026-09 §4）
status: completed
---

# BLOCK-124 — Gewu Harness 产品化 · 第一批（P0 勘察 + P1 C-13 实现）

> 立项：2026-09-26（P0-LAUNCH；用户裁决原话见 §1）。P0 勘察当日完成；用户第二轮裁决「自己来做个全面的校验和确认…开始吧」=确认下放，P1 当日实现并实机走查 allPass → **2026-09-26 整包 completed**（rider=UI-447 待用户实机过目）。
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

**决策点（P1 已全部落定；用户 2026-09-26 第二轮裁决「自己来做个全面的校验和确认…开始吧」=确认权下放，D1-D5 按推荐执行）**：

| # | 决策点 | 裁决（已落定） | 落地证据 |
| --- | --- | --- | --- |
| D1 | typescript 依赖类 | **a）devDependencies → dependencies**——实测包体 23MB 纯 JS 零原生绑定；走 DEPENDENCY-CHANGE-CHECKLIST 留痕（既有依赖迁移节非新增依赖） | package.json（提交 786f27a2）；P6 源绑定含 package.json 哈希，下次重打吸收（BK-08 同款先例） |
| D2 | 代码单源 | **a）库函数迁 `core/biof3-server/helpers/code-graph.js`，`scripts/symbol-graph.mjs` 变 CLI 薄壳**，13 条契约追新家（判据零弱化 + 3 条新判据） | test/symbol-graph.test.mjs 13/13 |
| D3 | 工具轨 | **a）agent-tools 内建只读轨**（session 基线域=任何域收窄恒在场；`contract('workspace','none','R0',['project.files'],5000)`；根解析复用 withWorkspace 双闸不吃自由路径） | registry.js HANDLERS/CONTRACTS + codegraph-tools.js |
| D4 | 工具命名 | `codegraph_who_imports` / `codegraph_classify_edges` | tool-defs/session.js（工具总数 74→76，四处总数钉同步） |
| D5 | v1 性能边界 | **a）无缓存 + maxFiles=5000 诚实拒绝 + 输出有界（hits≤50/exports≤150/outbound≤60）**；实测基准见 §3.1.1；agent 编辑文件后重查自然拿到新图（无陈旧缓存正确性问题） | codegraph-tools.js + 基准表 |

**搭车能力**：`whoImports` 天然分类 USED_TEST/USED_PROD——agent 问「哪些测试引用这个模块」即免费覆盖，编码任务里「改这个函数要动哪些测试」有直答面。

#### 3.1.1 性能/稳定性基准（P1 前实测，2026-09-26，win32 本机）

| 场景 | 文件数 | 边数 | 耗时 | 内存 |
| --- | --- | --- | --- | --- |
| 本仓全仓（worst case 实测） | 1604 | 8644 | 1756ms | 原版峰值堆 +445MB |
| frontend/src | 458 | 1920 | 405ms | +60MB |
| core | 387 | 1616 | 386ms | +74MB |
| 合成小项目（agent 走查典型） | 9 | 7 | 1ms | ~0 |
| whoImports（图已建） | — | — | 1.4ms | — |

基准驱动三项产品化加固（相对 HK-03 原版，全部有测试背书）：
1. **流式建图**：逐文件「解析→抽取→丢弃」，SourceFile 不再全量驻留——峰值内存与项目规模解耦（原版 1604 文件冲 445MB，大项目会打爆后端堆）。
2. **分批让位**：每 50 文件 `setImmediate` 交还事件循环——秒级同步建图不再卡死后端 SSE/REST（CLI 传 `yieldEvery:0` 保持同步语义）。
3. **通用 tsconfig/jsconfig paths 别名解析**（ts.readConfigFile 处理 JSONC）：替代原版 `@/ → frontend/src` 仓库特化硬编码；无别名配置不猜测，`@/` 如实 UNRESOLVED。

另：maxFiles 上限（工具层 5000/内核安全网 20000，超限抛 `too_many_files` 供工具层 `available:false` 诚实拒绝）+ 单文件读取容错（unreadable 记 parseErrors 跳过不炸全图）。

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

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| 批次 1（本包 P1） | **C-13 落地**：红绿先行（契约先落 ERR_MODULE_NOT_FOUND×14 红→70/70 绿）+ 内核迁 core 单源 + 三项加固 + 七面注册（工具总数 74→76 四处钉同步）+ typescript 迁 dependencies | **✅ 2026-09-26 完成（提交 786f27a2）**；实机走查 allPass（§4.1） |
| 批次 2 | 编码缺口小刀：G-04 exec 错误增形 / C-17a reject→回路 / C-17b 终端反馈面——按真实使用反馈择优，逐项独立登记 | 候选（C-17 在册） |
| 批次 3 | 编码 playbook 资源 skill（C-18）/ 开发纪律产品回声（C-19） | 候选池在册 |

### 4.1 P1 实机走查（探针 scripts/block124-p1-codegraph-walkthrough.mjs；证据 acceptance/block-124/）

任务=「查清 legacyRound 引用关系→确认安全→删→跑测试」（指令不点名工具）。**allPass=true**：真实模型 21 秒完成，工具序列=system_info → workspace_list → **codegraph_who_imports** → workspace_search → read×5 → todo_write → **replace×2（删导出+清无用导入）** → workspace_search → **codegraph_who_imports（删除前复核）** → read×2 → **exec×4（跑测试验证）**——影响面判定→安全清理→验证的教科书序列；工具结果正确回传（`available:true · symbol legacyRound · totalHits 1` + UNUSED 判定）；探针独立复核=导出真删/ui.mjs 导入真清/测试真过。探针侧瑕疵如实登记：S6 最终回答文本采集事件名口径未命中（涩），强证据以 S5 独立复核为准。

## 5. 验收门禁与证据位置（P1 收口实账）

- 红绿先行：test/codegraph-tools.test.mjs（7 测试）+ test/symbol-graph.test.mjs（13 测试）先落 **ERR_MODULE_NOT_FOUND×14 红** → 实现后 70/70 绿（含四处总数钉与先例回归：agent-tool-registry/tool-activity-labels/block109-metadata/block113-prerouting/block116）。
- 门禁总账：test:changed 全链（Node 定向 + 前端 vitest + docs:check 284 + ui:audit + frontend tsc）+ quality:lint 0 error + quality:knip:check（基线 244→243 棘轮下调）+ quality:arch + gate:arch-cycles + quality:secret + gate:code-size（withWorkspace 导出 +2 行随批重打台账）+ quality:types 0。
- 实机走查：§4.1（allPass，证据 acceptance/block-124/p1-walkthrough.json + log）。
- 完成语义：dev Electron 边界内 verified（当前阶段最高证据等级）；**rider=UI-447 工具行呈现待用户实机过目**（台账 in_progress，证据已备）。
- 存量债顺手清偿三件：block116-decision-platform.test.mjs:281 总数钉存量红（BLOCK-121 漏改 73→74，本批改 76）+ UI-446 未用导入 lint 存量红（conversationChangesStore.unread.test.ts）+ UI-446 残留文件两个（nul / ui446-tes2.txt，ee9b367f 清理遗漏，test:changed 分类冲突拦截坐实）。

## 6. 边界与风险（收口对账）

- **WIP 隔离**：`eslint-suppressions.json`（M，LeftPanel.test.tsx 抑制计数，来源不明）全程零触碰、未入本包提交——遗留待归属会话处置。
- typescript 迁 dependencies（D1）实测 23MB；G0 不校验 packaged 体积。package.json 哈希在 P6 源绑定集合内，下次 P6 重打吸收（BK-08 同款先例，非本包阻塞）。
- 远程 ssh 执行目标的项目暂无远程代码图（工具描述已注明本地工作区语义；远程面未来候选）。
- dev 栈 :3001 后端为本实机走查以新代码重启（`npm --prefix core/biof3-server start` 同款 env），dev Electron 渲染层走自家后端不受影响。
- G0 开发期常态 · 不外推 packaged/Provider/GA；单工作包串行纪律不变。
