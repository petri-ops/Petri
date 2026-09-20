# BLOCK-108-CONVERSATION-STREAM-QODER-FIDELITY — 会话信息流 Qoder 化：执行间过渡叙述 + 簇内紧凑单行流

- registry: BLOCK-108-CONVERSATION-STREAM-QODER-FIDELITY / truthDomain: block-108-conversation-stream-qoder-fidelity
- 立项: 2026-09-21（用户裁决原话「你再看看 目前项目的信息流 我想的更进一步的靠近 qoder的情况 执行和执行之间是有过渡性的描述 执行内部是有运行的终端命令和结果 思考的情况 以及读取文件等 内部是紧凑的最好是单行展示 只有点击才会展开相关内容（这样能知道改了什么方便了解整个任务的执行情况）……接下来我要睡觉了 希望睡醒后你能搞定这个事情」＝立项 + 夜间自主推进预授权，附 Qoder 界面截图）
- UI 台账: **UI-429**
- 前置: BLOCK-107（UI-428，2026-09-21 verified）已交付分段模型（按 `iteration` 交错：思考节点/工具簇/阶段进度/叙述）与 D4 折叠策略；本包是呈现层的进一步 Qoder 保真，**不重做分段模型**。

## 0. 问题定义（对照 Qoder 截图）

Qoder 的会话信息流形态（用户截图实测）：

1. **执行之间有过渡性描述**：模型每轮的叙述文本（如「先看 docs/README.md 中 BLOCK-107 的登记行…确认收口要同步的状态标记。」）以**正文段落**渲染在下一个「执行工具 N 次」簇**之前**——读起来是「模型说话 → 模型做事 → 模型说话」的交替流。
2. **簇内是统一的紧凑单行流**：展开簇后每条记录占一行——`✓ 终端命令 已运行 ▪ · npm run docs:reconcile 2>&1 | tail -60`、`✓ 已思考 · <首行预览>`；**全部默认折叠，点击该行才展开**（终端命令展开=命令+输出；思考展开=全文）。
3. **簇头以次数为中心**：`执行工具 4 次` + 折叠箭头，收敛、可扫读。

现状（BLOCK-107 后）差距：

| # | 现状 | Qoder 目标 |
|---| --- | --- |
| G1 | 每轮叙述文本已按迭代捕获（`assistantProgress.record(streamedText, iter+1)`，`loop-orchestrator.js:771`，仅在该轮有工具调用时记录）→ `meta.progressUpdates` 落库（`conversation-adapter.js:118`）→ 前端已喂入段模型，但被渲染成**簇后**的弱化进度行（`AgentProgressItem`，且 UI-305 ①约定**省略首条意图**） | 正文式过渡段渲染在**簇前**，全部显示 |
| G2 | exec 类工具行默认展开为原生终端块（UI-315「ZCode 式」），非 exec 行虽有单行折叠但形态混杂；常规读取 ≥3 条再折叠一层（routine group） | 统一单行（含 exec），全部默认折叠，点击展开；无二级折叠 |
| G3 | 簇头摘要 =「已完成 3 项 · 3.9 s」（完成态）/「正在处理 1/3 项 · 已运行 Ns」（运行态） | 「执行工具 N 次」计数式簇头（保留需注意计数与秒表——L5 flow 契约依赖「N 项需注意」字样） |
| G4 | 思考是簇外的独立节点（ConversationTimeline 有意不传 `reasoningByIteration`） | 思考行在簇内（已思考 · 首行预览 · 点击展开全文） |

**数据层结论（P0 已核）与实机修正（P1 抓真）**：P0 只读探索结论为「过渡叙述数据链路已全通、零后端改动」——**实机腿第一跑证伪了持久化半条**：实况侧 `agent_progress` 事件链路完好（Q1 实机 PASS），但 `agent-runner.js` 落库 `appendAssistantMessage` 时传 `assistantProgress: null`，`meta.progressUpdates` 从未落库（loop-orchestrator 每轮 `record` 的快照只活在 SSE，刷新即失；这正是 P0 实测「全库仅 1 条」的真因，与 BLOCK-34 P1 修过的「工具记录消失」同构——工具记录随结果返回修了，progress 漏了）。修正：本包 P1 增补**持久化穿参一处**——loop-orchestrator 结果结构随返回 `assistantProgress`（recorder），agent-runner 落库照 `reasoningByIteration` 同款穿参，adapter 零改动（其 snapshot 消费端早已就绪）。§2 红线「零后端改动」据此修正为「零 schema 改动 / 零协议改动；仅 additive 穿参一处」。

## 1. 范围（P1→P3）

- **P1 段模型就位**：`conversationSegments.ts` ① progress 分段从「簇后」改序为「簇前」（bucket 内顺序 progress → tools）；② reasoning 折入同迭代的 tools 分段（`ToolsSegment` 新增可选 `reasoningText` 字段；纯思考迭代仍产出独立 ReasoningSegment，行为不变）。既有 18 条段模型契约测试同步更新（行为变化即本包意图，逐条留痕）。
- **P2 时间线上轴**：`ConversationTimeline.tsx` ① progress 分段经 `renderProgress` 渲染为过渡叙述（容器从弱化进度样式改为正文式叙述容器）；② 折叠进簇的思考不再产出独立节点；③ `SimpleChat.tsx` 的 `renderProgress` 回调改为正文段落渲染（**含首条**——UI-305「首条意图省略」约定在时间线呈现上被本包裁决取代；末条运行中标记保留）。
- **P3 簇内 Qoder 行形态**（`ToolActivityList.tsx`，门控=`collapseWhenSettled`（时间线模式），Dock/桥接等旧调用方零变化）：① 簇头改计数式「执行工具 N 次」（运行中=「正在执行工具 N 项 · 已运行 Ns」；保留「N 项需注意」与耗时）；② 统一单行行式（**含 exec**）：状态字形（✓/✕/spinner）+ 类别标签（终端命令/已思考/读取/编辑/…）+ 单行预览（命令/首行预览/路径）+ 耗时 + 箭头，全部默认折叠；③ 点击展开：exec=命令+ANSI 输出（沿用 TerminalRow 的滚动跟随/复制/截断语义），其余沿用 ActivityRow 展开体（子智能体内联卡/changeDiff/输出/原因）；④ 时间线模式下移除 routine-group 二级折叠；⑤ 思考行按迭代插在簇内（`reasoningByIteration` 由时间线传入，本轮有工具时）。

## 2. 非范围（红线）

- 零 schema 改动 / 零事件协议改动；后端仅限 §1 P1 修正所述的 additive 穿参一处（assistantProgress 随结果返回，镜像 BLOCK-34 P1 / UI-272 既有先例）。
- 零新依赖；不碰 `frontend/package.json` / lockfile（P6 源绑定）。
- 不动 Dock（ToolActivityDock）、非时间线旧调用方形态、SimpleChat 降级路径（D2：无时间线素材退回分组堆叠）。
- 不做会话列表/消息气泡/输入区改造；不做「已压缩上下文」分隔标记（compaction 呈现，另立候选）。
- 不删改 harness 工具（bg_exec 审计仅产出建议，见 §7 裁决项）。

## 3. 依赖与环境纪律

- dev 栈：**2026-09-21 依赖换代后未重启**（react-router v7 / vite 8 / vitest 5 已 `npm install`）——实机验收前必须重启 dev Electron（`BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"`，fnm Node 24）；后端零改动，但 node_modules 已换代的 vite/dev 栈必须重新拉起。
- flow 只连自管测试实例（:9223），零触碰用户主窗（:9222）。

## 4. 证据位置

- `acceptance/block-108/`（flow 证据 JSON + PNG）
- flow：`.agents/skills/gewu-dev-infra/dev-verify/flows/block108-qoder-stream.cjs`

## 5. 验收门禁清单（收口时逐项对账）

1. 段模型/时间线/簇渲染契约测试绿：`conversationSegments.test.ts` + `ConversationTimeline.test.tsx` + `ToolActivityList.test.tsx` + `SimpleChat.test.tsx`（vitest 5 工具链）。
2. 实机 flow（真实模型轮次）断言全绿：
   - Q1 过渡叙述：簇与簇之间观察到正文式过渡段（≥1 处），且位于其对应簇之前；
   - Q2 计数式簇头：簇头含「执行工具」/「正在执行工具」字样 + 折叠箭头；
   - Q3 统一单行：展开簇后所有活动行（含终端命令）默认折叠单行，无默认展开的终端块；
   - Q4 点击展开：点击终端行展开出命令+输出，点击收起还原；
   - Q5 思考入簇：有思考的迭代在簇内出现「已思考」行；
   - Q6 刷新后历史同序（历史/实况一致性，沿用 §BLOCK-107 契约口径）；
   - Q7 临时数据清理。
3. `npm run closeout` 九门全绿（hygiene → docs:check → ui:audit:check → test:changed → gate:code-size → quality:secret → quality:arch → quality:lint → quality:types）。

## 6. 完成语义

- 预期节奏：一次会话 P1→P3 收口（用户睡眠窗口内）。若实机腿跨会话，按阶段登记 `P#-COMPLETED`，不外溢范围。
- 收口 = 门禁全绿 + canonical 回写（work package 本 plan / roadmap / handoff / AUDIT-LOG / ui-audit UI-429 verified）+ snapshot 标签 + 推送。

## 7. 预置裁决项（收口时呈报，不做即改）

### 7.1 harness 封装命令审计（用户问：「内置的工具 类似于 bg_exec 等等命令属于后期封装的命令是否有必要？希望用系统自带命令来解决问题 减少个性化的封装」）

**审计对象**（`core/biof3-server/agent-tools/tool-defs.js`，共 74 个工具）中执行类封装族：

| 工具 | 形态 | 系统原生替代 |
| --- | --- | --- |
| `workspace_exec` | 同步执行 + `yield_ms` 中间档（250ms-30s 超时转后台进程表） | shell 直接跑命令 |
| `workspace_exec_background` | 后台执行 + 进程表 | `nohup … &` / `Start-Process` |
| `process_status` / `process_stop` | 进程表查询/停止 | `ps` / `TaskStop-Process` 等 |

**结论：有必要保留，不建议删**。理由：

1. **跨进程生命周期**：后台命令若由 shell 原生后台化（`&`），进程脱离 harness 管辖——输出无处捕获（时间线看不到运行输出，与本包目标直接冲突）、无法查询状态、无法确定性停止、会话结束成孤儿。`workspace_exec_background` 把进程登记进进程表，才有了 UI-315 的输出尾流、ToolActivityDock 后台面板与停止按钮。
2. **跨平台语义**：Windows 默认 shell（cmd）无作业控制，PowerShell `Start-Job` 与 POSIX `&` 语义不兼容；原生方案要求模型按平台写不同命令，出错面反而更大。封装层抹平了这一差异（`shell: auto/powershell/posix/cmd`）。
3. **主流 harness 同构**：Claude Code（Bash `run_in_background`）、Codex 等均自带后台执行封装而非依赖模型写原生后台命令——「模型负责说什么，harness 负责怎么活」是共识边界。
4. **与本包的关系**：时间线里「终端命令 + 流式输出」的呈现（Qoder 形态的核心素材）正是这些封装写入 tool_output/toolActivities 才成立的。

**可收敛点（登记待裁决，本包不动）**：① `workspace_exec` 的 `yield_ms` 中间档（同步/让渡/后台三态合一）是三态里最复杂的一态，若实跑数据显示中间档使用率趋零，可裁决简化为「同步（带超时）+ 后台」两态；② 全仓 74 个工具中 `result_*_in_context` 族 7 个与 `result_changeset_*` 族 5 个高度同形，存在合并空间；`computer_*` 族 8 个属 OS 级自动化封装，同属「封装有必要」范畴。以上收敛均为行为变更，需用户裁决后另立小包。

### 7.2 UI-305 呈现约定被本包取代的登记

UI-305 ①「首条阶段进度（意图）由宿主省略」与弱化进度行样式，在时间线呈现上被本包裁决（用户 Qoder 截图 + 「执行和执行之间是有过渡性的描述」）取代：过渡段全部显示、正文式渲染。`progressUpdates` 数据语义不变，UI-305 的其他消费面不受影响。

## 8. 与既有资产的关系

- UI-268（摘要条+内联手风琴）/UI-272（两级折叠）/UI-273（changeDiff）/UI-315（终端块）/UI-316（子智能体行内状态）/UI-382/385/387（子智能体卡）全部保留：本包只改「时间线模式下的行形态与簇头文案」，展开体复用既有实现。
- BLOCK-107 D1=c/D2/D3/D4/D6 裁决全部沿用；D5 的「插在对应工具簇之后」修正为「渲染在对应簇之前」（用户 2026-09-21 Qoder 形态裁决，见 §7.2）；P2c 秒表保留进新簇头。

## 9. 收口笔录（2026-09-21，一次会话 P0→P3 + 实机收口；夜间预授权）

- **交付**：P1 段模型（过渡叙述簇前 + 思考折入 ToolsSegment）+ P2 时间线上轴（过渡叙述正文式容器、含首条、思考入簇传参）+ P3 簇内 Qoder 行形态（计数式簇头 / 统一单行含 exec 默认折叠 / 点击展开 / 思考入簇 / 移除 routine 二级折叠）+ 持久化穿参一处（assistantProgress 随结果返回，§1 修正）。门控 `collapseWhenSettled`，Dock/桥接/降级路径零变化。
- **实机抓真三件**（首跑 4/7 → 修正后 7/7）：①持久化穿参缺失（§1 修正，真后端缺陷）；②flow 采样窗口 3 样本在模型迭代间思考停顿处误判终态 → 提到 10 样本；③Q4 选择器只展开末簇而 exec 在前簇 → 改全簇展开。②③属 flow 设计非产品。
- **附带抓真（依赖升级批连带 ×2，本包修复）**：vite 8.3.0 dev server 双断链（`__SERVER_FORWARD_CONSOLE__` 未替换致 React 不挂载 + 内置 oxc refresh codegen 调 `getRefreshReg` 而 plugin-react 6.1.1 运行时未导出）→ index.html 兜底 + dev-only polyfill 插件，均为 dev-only、上游对齐后可删。**含义：依赖升级批合入后 `npm run dev` 全仓渲染面不可用**，本包实机腿是首次暴露（build/测试路径不可见）。
- **门禁**：契约测试 segments 19/19 + timeline 11/11 + toolActivity 14/14 + SimpleChat 15/15；全量前端 146 文件全绿（vitest 5）；tsc 0 红 / lint 0 error / arch / secret / docs:check 262 / ui:audit / hygiene / code-size / test:changed 九门全绿；实机 flow `block108-qoder-stream` **7/7**（Q1 过渡叙述×5 簇前、Q2 计数簇头+需注意、Q3 统一单行、Q4 点击展开、Q5 思考入簇×5、Q6 刷新同序、Q7 清理）。UI-429 **verified**。
- **裁决呈报（plan §7.1）**：exec 封装族建议保留；`yield_ms` 中间档收敛与 `result_*_in_context` 族合并等行为变更待用户裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。
