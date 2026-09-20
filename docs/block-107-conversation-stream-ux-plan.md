# BLOCK-107-CONVERSATION-STREAM-UX — 会话信息流呈现时间线化

**状态**：`active（2026-09-20 启动，P0-LAUNCH；用户裁决「按推荐的来」= 采纳 §7 全部推荐项含 D1=c；P0 数据层量化基线已补采见 §0.6，唯余帧时基线待实机采）`
**立项**：2026-09-20（用户裁决「新开个block优化我们的项目」；同日续接会话裁决「A」=先落 BLOCK-106 收口提交再登记本包，解除 canonical 写入避让）
**责任轨道**：BLOCK（多工作面：呈现层时间线模型 + 历史/实况双轨合流 + 实机验收，且含「时序真源放哪」的数据契约裁决）
**前序接口**：BLOCK-106 §2/§7 已把「轮询→SSE」「长列表虚拟化」「`task_events` 数据模型改造」明确列为**独立候选包**（`docs/block-106-startup-performance-ratchet-plan.md:72-74,111`）——本包承接**呈现面**，不承接那三项。

## 0. 问题定义

### 0.1 用户诉求

用户初始想法：**模仿 Qoder 的会话消息呈现方式**——助手回复随时间推进展开为一条**线**，思考 / 工具调用 / 文件改动 / 结论**按发生顺序交错**排列，流式追加，刷新后仍是同一条线。

用户 2026-09-20 追问确认：「我的初始想法是模仿 qoder 的会话消息的呈现方式，目前不是吗」——**答案：不是**。方向一致（过程在前、结论在后），但「时间线化」未做。本包即为此立项。

### 0.2 现状：以「消息容器 + 类型分组堆叠」呈现，不是时间线

`frontend/src/components/copilot/SimpleChat.tsx:1043-1113` 是单条消息内部的**固定模板顺序**：

| 顺序 | 区块 | 行号 |
| --- | --- | --- |
| 1 | 工具活动卡（手风琴） | `SimpleChat.tsx:1046` |
| 2 | 模型元信息 | `:1052` |
| 3 | loop 状态面板 | `:1054` |
| 4 | 阶段进度列表 | `:1057` |
| 5 | 结果编辑进度 | `:1064` |
| 6 | 结果节点 | `:1067` |
| 7 | 模型降级提示条 | `:1070` |
| 8 | 子智能体终态卡 | `:1078` |
| 9 | **正文** | `:1082` |
| 10 | 错误横幅 / 继续执行 | `:1100` / `:1113` |

问题不在顺序本身，而在它是**按类型分组**的：**所有**工具调用聚合成一个手风琴（`ToolActivityList.tsx:412`，摘要条+折叠，`groupToolActivities:483`、常规读折叠 `:491`），**所有**思考段聚合成另一个列表（`reasoningByIteration`），**所有**阶段进度聚成第三个列表（`AgentProgressList.tsx:13`）。

真实的交错——**思考 → 调工具 → 看结果 → 再思考 → 再调工具 → 给结论**——在渲染时被拍平为「工具一堆、思考一堆、进度一堆、正文一段」。**工具/思考片段在时间轴上的位置信息不存在**，想交错也没有素材。

### 0.3 根因：历史渲染走聚合快照，全局时序在聚合那一刻丢失

同一轮对话，**实况与历史走两条不同轨道**：

| | 实况（正在跑） | 历史（刷新 / 切回后） |
| --- | --- | --- |
| 数据源 | SSE 事件流（`frontend/src/components/copilot/copilotClient/agentTaskStream.ts:230-433`） | `copilot_messages.meta_json` 快照（`frontend/src/components/copilot/SimpleChat/types.ts:138-170`） |
| 时序 | **完整**（`seq` 严格递增，逐条到达） | **丢失**（只剩「类型 + 迭代号」） |
| 呈现 | 逐条到达、顺序正确 | 按类型分组重建 |

落库的 `meta_json` 是**聚合快照**（`core/biof3-server/conversation-adapter.js:97-175`）：`toolActivities` 是数组、`reasoningByIteration` 是「迭代号→文本」对象（`:164-167`）、`progressUpdates` 是另一个数组（`:117-119`）——**跨类型的全局顺序在聚合那一刻就丢了**，刷新后前端没有任何还原依据。

更关键的是：**完整时序其实存在**——`task_events` 表按 `seq` 严格递增落库（`core/biof3-server/agent-task-store.js:404-407` 的 `listEvents` 游标读，前端 agent 详情窗 UI-292 就是这么回放的）——但**主聊天历史渲染路径根本没读它**，只读 `meta_json`。

### 0.4 三条数据层硬约束（决定本包能做到什么）

1. **`meta_json` 无 schema、无上限**（`core/biof3-server/helpers/conversations.js:153` 只对 `content` 做 30,000 字符静默截断；`meta_json` 裸 `JSON.stringify`）→ 新增有序 `timeline[]` 字段不需要迁移文件（additive 结构），但也没有机械校验兜住形态漂移。
2. **`task_events` 逐 token 落库**（`core/biof3-server/agent-runner.js:371-380`：每个正文/思考增量写成一行，`eventType` 兜底 `'delta'`）——BLOCK-106 实测该表 236,087 行 / 13 天 ≈ 18k 行/天（`docs/block-106-startup-performance-ratchet-plan.md:39`）。若走「历史改由 `task_events` 回放」，必须先面对这个规模与 `getAgentTaskEventsSince` 默认 `limit 500` 且**无 hasMore 信封**（`agent-task-store.js:540`）的分页现实。
3. **历史加载取最新窗口 + rowid 游标**（`core/biof3-server/routes/ai-conversations.js:127-147`；limit 钳制 1-500、`before` keyset、`windowOffset` 走 `COUNT(*)`），前端首屏 200 条（`frontend/src/components/copilot/SimpleChat/hooks/useConversationResume.ts:103`）——时间线化不能破坏这条既有分页语义。

### 0.5 已有资产（不因追风格而退掉）

本仓已有相当多零件（UI-268 / UI-272 / UI-315 / UI-382 / UI-383 沉淀）：整消息摘要条 + 手风琴、终端块（`$` 命令 + 流式输出 + ANSI + 自动跟随）、行详情（diff 预览 / 子代理内联卡 / 中断操作）、思考行、routine 读组折叠（`ToolActivityList.tsx`）。这些在密度与信息量上**强于**目标形态，属保留资产，不得为风格对账而退化。

### 0.6 P0 量化基线（2026-09-20 实测，dev 库临时副本只读采集）

**采集方法**：`BIOF3_LOCAL_DATA_DIR` 指向的 dev 活动库（`.biof3-dev-user-data/data/biof3.db`，50.1 MB）连同 `-wal`/`-shm` 复制到临时目录后**只读**打开（活动库零写入，沿用 BLOCK-106 §0.3 手法）；探针为一次性 SQL（语义见各界标题）。**帧时基线未采**（需 dev Electron 实机 CDP，属 P1 动渲染前的实机面，见本节末）。

**① 规模对比——本包最硬的一条事实**

| 指标 | 实测 |
| --- | --- |
| `task_events` 行数 | **236,087** |
| `copilot_messages` 行数 | **180** |
| 事件 : 消息 | **1,312 : 1** |
| 其中 `delta` 事件 | **232,629（98.54%）**，payload 合计 11.04 MB（`avgPayloadBytes` 47.4、`maxPayloadBytes` 134） |
| `tasks` / `copilot_conversations` | 266 / 36（有消息者 25） |
| `conversation_compaction` | **0 行**（B2 压缩在本库从未产生记录——消息数远低于 `MIN_MESSAGES=24` 阈值） |

即：**23.6 万条事件流水最终只沉淀成 180 条持久消息**，且事件的 98.5% 是逐 token 正文碎片。

**② 单任务事件规模（= 重放代价）**

| 指标 | 实测 |
| --- | --- |
| 有事件的任务数 | 266 |
| 最大 / 平均事件数 | **15,646** / 887.5 |
| 最大任务的回放轮数 | ⌈15646/500⌉ = **32 轮**（`getAgentTaskEventsSince` 默认 `limit 500` 且**无 hasMore 信封**） |
| Top 5 事件数 | 15,646 / 11,656 / 10,579 / 10,053 / 7,087 |

**③ 按天新增（近 14 天有数据日）**：09-10 峰值 **44,929**、09-14 38,555、09-09 37,552、09-18 33,474、09-16 28,155、09-11 23,567、09-17 14,589、09-19 8,329、09-08 6,598、09-20 5、09-07 334（13 天均值 ≈ 18.2k 行/天，与 BLOCK-106 §0.3 一致）。

**④ `meta_json` 体积（= 历史渲染载荷）**

| 指标 | 实测 |
| --- | --- |
| 有 meta 的消息 | 180 / 180（100%） |
| meta 总体积 vs 正文总体积 | **340,021 B vs 49,155 B = 6.9 倍** |
| 单条 meta 均值 / 最大 | 1,889 B / **39,191 B** |
| 正文最大字符数 | 3,901（**从未触及 30,000 截断上限**，`contentAtTruncationCap = 0`） |

**⑤ 交错还原素材（决定分段模型可行性）**

| 指标 | 实测 |
| --- | --- |
| 含 `toolActivities` 的消息 | **64**（占 91 条 assistant 的 70%） |
| 活动总数 / 均值 / 单条最大 | **315** / 4.9 / **33** |
| 含 `reasoningByIteration` 的消息 | **86**，思考段共 **224** 段，单条最大 **14** 段 |
| 含 `progressUpdates` 的消息 | **1**（该字段实践中近乎不出现 → D5 的相关性大幅下降） |
| **`toolActivities[].iteration` 覆盖率** | **315 / 315 = 100%**（`callId` / `traceId` / `status` 同为 100%；`output` 0、`changeDiff` 3、`agentRunId` 0） |

**最富轮次实样**（`msg_60cf968e-e39`，meta **39,191 B** / 正文 3,864 字符）：33 个活动按 `iteration` 聚成 8+ 簇（iter1=4、iter2=4、iter3=3、iter4=4、iter5=4、iter6=6、iter7=6、iter8=2…），配 9 个思考段——**这正是目标形态「一簇 = 一次工具批」的真实数据形状**。`reasoningByIteration` 的键为数字串 `"1".."14"`，与活动的 `iteration` **同序可直接对齐**。

**⑥ 会话消息数分布（= 刷新重放分页轮数）**

| 指标 | 实测 |
| --- | --- |
| 会话数（有消息）/ 单会话均值 / 最大 | 25 / 7.2 / **64** |
| > 200 条 / > 500 条的会话 | **0 / 0** |

即当前数据下前端 200 条窗口**从不触发分页**——分页不是本包瓶颈面（但 §0.3 的既有语义仍须保护）。

**⑦ 工具种类（Top）**：`workspace_read` 50、`workspace_list` 48、`todo_write` 41、`knowledge_space_list` 37、`workspace_exec` 35、`knowledge_space_delete` 16、`workspace_find` 15、`workspace_search` 13、`delegate_to_gewu_node` 10。

**诚实边界**：①**消息流帧时基线未采**（需 dev Electron 实机，非库层 SQL），留待启动后 P1 前采，虚拟化取舍以它为准；②本基线为**单机 dev 库单点样本**，不等同全量分布；③§0.2–§0.4 的结构性事实仍以文件行号为准——本次实测**未推翻其中任何一条**，且 §0.3「实况/历史双轨不一致」被 ④⑤ 两组数据从两侧独立印证。

## 1. 范围（P0→P3）

- **P0 度量 + 时序真源裁决（先定契约，再动渲染）**：~~采集 §0.6 基线~~ → **已完成（2026-09-20，数字见 §0.6；唯余帧时基线待实机）**；据 §7 D1 裁决结果落定「时间线的真源」；产出「历史 vs 实况呈现一致性」的可判定口径（同一轮对话两条轨道渲染出的片段时间序必须一致）。
- **P1 分段模型 + 交错渲染**：把一轮回复建模为有序分段序列（叙述 / 思考 / 工具簇 / 进度 / 结果），按序渲染替换固定模板堆叠；簇头一行化（含失败计数、运行中秒表），运行簇展开、完成簇自动收起；思考行补一行预览。
- **P2 历史兼容 + 策略与视觉**：老数据（无 `timeline` 字段的历史 `meta_json`）降级渲染策略按 §7 D2 落地；默认折叠策略 / 动作词与图标统一；随包消化 `SimpleChat.tsx` 体量债（巨型文件台账线，走 `npm run gate:code-size` 登记制）；样式按 `$gewu-css-theme` 规范（海军蓝 token 阶梯 + `theme-token-contract` 门禁）。
- **P3 实机验收 + 收口**：dev Electron flow 覆盖多轮工具 / 失败重试 / 长会话 / 历史恢复，且**三宿主面**（右栏 chat tab、悬挂把手面、欢迎页）行为一致；UI 台账 verified 需实机证据；canonical 回写 + closeout 八门。

## 2. 非范围（红线）

- **消息流虚拟化**：BLOCK-106 §7 已登记为独立候选（`plan:111`），本包只做渲染结构，不引入虚拟化库（凭 `DEPENDENCY-CHANGE-CHECKLIST`，默认答案「不做」）。
- **轮询 → SSE 改造**：BLOCK-106 §2 明确「属独立候选包——需先有帧时/事件循环基线」（`plan:72`）。本包不把 `ToolActivityDock.tsx:104,133`（1s）、`useTerminalSubAgentResults.ts:37`（5s）、`useConversationResume.ts:198`（5s 镜像）三条轮询并入 SSE。
- **`task_events` 数据模型改造**：UUID `task_id` → 整型外键、逐 token 行聚合等（BLOCK-106 §2 明确排除，`plan:74`）。本包若选 D1-a（历史走 `task_events` 回放），只做**读路径**消费，不改写入契约与历史行。
- **后端事件协议大改**：不改 SSE 事件名/信封形态（`{seq, eventType, payload}`，`routes/ai-agent/events.js:99,126`）；若确需新事件须单独裁决并在 plan 留痕。
- **不新增依赖**、**不碰 `frontend/package.json` 与 `frontend/package-lock.json`**（P6 源绑定集合）。
- **G1+ 不外推**：packaged / Provider / GA 不属本包证据面。

## 3. 依赖与环境纪律

- dev 栈在跑（后端 `:3001`、Vite dev server `:3000`）；后端改动必须重启 dev Electron 再验。
- 实机验收一律走 BLOCK-100 自管测试实例（`:9223`），零扰动用户主窗。
- 开工 / 收口前各 `git fetch` 一次对账；其他包在制面（若存在）列明文件面并承诺零触碰。
- 前端测试与类型门禁：`npm run test:files --prefix frontend -- <files>`、`npm run build:check --prefix frontend`（注意：`tsc -b` 当前有在册存量红 29 项，见 `docs/AUDIT-LOG.md` 🟡 2026-09-20 行——本包须自证「未触碰文件」边界或推动该红处置）。

## 4. 证据位置

`acceptance/block-107/`（P0 基线采集、P1/P2 前后对账、P3 实机 flow 证据与截图）。

## 5. 验收门禁清单（收口时逐项对账）

1. 前端定向测试绿（分段模型纯函数 + 渲染族 + 历史降级路径）；`tsc --noEmit` 本包改动文件 0 命中。
2. **历史/实况一致性契约**：同一轮对话（同一 task）经「实况 SSE」与「历史加载」两条轨道投影出的片段时间序一致（机械断言，非人工目检）。
3. **老数据兼容红线**：无 `timeline` 字段的历史会话仍可正常渲染，不得白屏或丢正文。
4. 样式门禁：`theme-token-contract.test.ts` 绿（若涉 CSS）。
5. `npm run gate:code-size`：`SimpleChat.tsx` 等改动文件不超台账线（拆分则净减）。
6. 实机 flow（dev Electron，自管实例）：多轮工具 / 失败重试 / 长会话 / 历史恢复 + 三宿主面行为一致，断言全绿并留截图。
7. `npm run closeout` 八门全绿 + `docs:check` PASS + UI 台账同提交更新（`UI-###` 编号）。

## 6. 完成语义

- 本包 `completed` 的判据是「**分段模型落地且有机械一致性契约** + **实机看到按发生顺序推进的线** + **老数据兼容不退化**」三条同时成立；缺一条按实际状态登记（如 `completed-with-gap`）。
- 「更像 Qoder」不得由观感断言——必须有 §5 第 2 条的机械对账与实机 flow 断言。
- 预期节奏：P0 定契约后 P1→P3 目标一次会话收口；若 P1 触发渲染回归需跨会话，按阶段登记 `P#-COMPLETED`，不外溢后续阶段范围。

## 7. 预置裁决项（启动前需用户裁决）

| # | 裁决点 | 选项与代价 | 推荐 |
| --- | --- | --- | --- |
| **D1** | **时间线真源放哪**（本包最关键的架构分叉） | **a** 历史渲染改走 `task_events` 回放：时序天然完整、与实况同源；**实测代价**=§0.6-①② 事件:消息 = 1,312:1、98.54% 是逐 token 碎片、最大任务 15,646 事件需 **32 轮** 500 条分页。**b** `meta_json` 增有序 `timeline[]`：additive 零迁移；代价=写入路径两处（`conversation-adapter.js:97-175` + `chat.js:1189-1224`）须同步，老数据无该字段。**c** 呈现层按 `iteration` 交错：**实测已证实可行**（§0.6-⑤ 活动 `iteration` 覆盖 315/315 = 100%，`reasoningByIteration` 键同序可对齐），零数据层改动、零写入路径改造 | **c**（2026-09-20 依 §0.6 实测**修正**：原推荐 b 基于静态读码，当时不知 `iteration` 100% 齐全；实测显示 c 足以还原**迭代级**真序，且素材仅 315 活动 + 224 思考段。若后续需要迭代**内**更细粒度、或让进度/结果节点也上轴交织，再升 b 作为增强） |
| D2 | 历史老数据兼容策略 | 降级为现有「类型分组堆叠」（零风险）vs 用 `meta.reasoningByIteration` 迭代号 + `toolActivities[].iteration` 尽力还原穿插顺序 | 后者（尽力还原，失败退回分组堆叠），并写进 §5-3 契约 |
| D3 | 簇粒度 | 「每批工具调用一簇」vs 「沿用现有 routine 读组折叠规则」（`ToolActivityList.tsx:491`） | 以现有 routine 折叠为基线扩展为「按迭代分批」，避免同一信息两套聚类规则 |
| D4 | 终端块默认展开 vs 折叠 | 现为 UI-315 ZCode 风格默认展开（与「折叠=一行」的密度相反） | 改为运行中展开、完成后折叠为一行（保留点开看全文） |
| D5 | `progressUpdates`（阶段进度）并入叙事脊线的方式 | 作为独立分段插在对应工具簇之后 vs 并入簇头摘要 | 前者（它是「模型自己说的阶段结论」，属叙事不属工具） |
| D6 | 是否同包消化 `SimpleChat.tsx` 体量债 | 同包拆（范围变大）vs 仅登记 | 同包拆分（P2），走 `gate:code-size` 台账 |

**裁决记录（2026-09-20，用户裁决原话「按推荐的来」）**：**D1=c**（呈现层按 `iteration` 交错——依 §0.6 实测修正，原推荐 b 降为增强备选）、D2=尽力还原（失败退回分组堆叠）、D3=按迭代分批（以现有 routine 折叠为基线扩展）、D4=运行中展开 / 完成后折叠为一行、D5=阶段进度作为独立分段插在对应工具簇之后、D6=同包拆分（P2）。UI 台账编号=**UI-428**。

## 8. 与既有资产的关系

- **UI-268 / UI-272 / UI-315 / UI-382 / UI-383**：工具活动卡、思考段、终端块、子代理卡、diff 预览——**保留资产**，本包在其上做「时序化 + 分段化」，不重建。
- **BLOCK-95 A1**（消息 rowid 游标分页）：本包不得破坏其语义（§0.4-3）。
- **BLOCK-95 B2**（rolling compaction 视图投影）：压缩摘要卡目前挂在消息信封（`ai-conversations.js:154-165`），时间线化后需决定它在轴上的位置（并入 D1/D5 裁决）。
- **BLOCK-98 M2 / BLOCK-106 §7**：`task_events` 规模与保留策略是本包 D1-a 的既有约束来源。
- **BLOCK-100**：实机验收实例与隔离纪律沿用。

G0 开发期常态 · 不外推 packaged/Provider/GA。
