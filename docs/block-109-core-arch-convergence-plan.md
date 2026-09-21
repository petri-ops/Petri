# BLOCK-109-CORE-ARCH-CONVERGENCE — 会话核心链路架构收敛（单一事实源）

**状态**：`active（P0-LAUNCH；2026-09-21 立项即启动，用户裁决「基于这些点 开一个或多个block系统性优化gewu」——基于 ZCode 开源库（zai-org/ZCode，Apache-2.0）对比审计发现；D1–D6 按 §7 推荐留痕）`
**立项**：2026-09-21（对比审计报告存在于立项会话；证据 file:line 全部落在本仓与参考仓 `/Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/reference/ZCode`（shallow clone），可复现）
**责任轨道**：BLOCK（多工作面：后端事件模型 + 前端消费链 + 工具定义层 + 门禁基建，跨会话串行分阶段，含数据契约裁决）
**前序接口**：BLOCK-108 已收口（会话信息流呈现层 Qoder 化）；本包承接**链路与运行时层**，不触碰呈现层既有资产（BLOCK-107/108 沉淀的分段模型/时间线/簇呈现全部保留）。UI-431（BLOCK-108 名下增量，契约绿、面板实机待补）文件面与本包 P1 交叉（SimpleChat / conversationRunStore），按 D3 于 P0 先清偿。

## 0. 问题定义

### 0.1 立项来源：ZCode 开源库对比审计

2026-09-21 用户要求对比格物与 ZCode（Z.ai 开源编程工作台，本仓 `reference/ZCode`）并「基于这些点」系统性优化。对比审计（三路只读探索，证据 file:line 见 §0.2）定位五个结构性差距，全部映射到用户使用体感问题（状态恢复不一致 / 长会话变慢变贵 / 接入慢易漂移）。

### 0.2 现状根因（代码证据）

1. **对话链路多轨真相**：上下文组装在 `core/biof3-server/agent-runner.js:22-70` 与 legacy `core/biof3-server/routes/ai-agent/chat.js:34-70`（自留 786 行 SSE handler，`chat.js:15` 自述）**各拼一遍**；会话恢复 4 个入口（`conversationRunStore.ts` 的 resumeConversationRun / resumeInterruptedConversation / resumeOrphanAgentTasks / resumeSubAgentTasks）；主 agent 恢复态存前端 localStorage、子 agent 存后端 `loop_runs` 表族，仅靠注释约定「后者权威」（`frontend/src/components/copilot/conversationRunStore/subAgentTasks.ts:399-400`、`SimpleChat.tsx:325`）。
2. **上下文组装双轨 + 预算无治理**（压缩机制**已存在**，立项核实撤回对比审计的「无压缩」误判）：BLOCK-95 B2 rolling auto-compact（`helpers/conversation-compaction.js` 220 行，阈值自动+手动，默认开）与 BLOCK-98 M1/M3 microcompact+reactive+熔断+输入插队（`helpers/agent-resilience.js` 380 行，`agent-runner.js:672-704` 接线，flag `agent_resilience: true` 默认开）均已交付——**本包对压缩零重复**。剩余真实缺口：①上下文组装在 `agent-runner.js:22-70` 与 legacy `routes/ai-agent/chat.js:34-70`（自留 786 行 SSE handler，`chat.js:15` 自述）各拼一遍；②system-prompt 十余个注入源（`helpers/system-prompt.js` 494 行：chat-summary / user-facts / knowledge 召回 / plans / content-plugins…）无分段 token 预算治理。
3. **工具定义集中且无执行元数据**：71 个工具集中在 `agent-tools/tool-defs.js`（约 1500 行，`result_changeset_*` 与 `_in_context` 变体 8 对近乎复制）；无 readOnly/destructive/concurrentSafe/timeoutMs/needsApproval/riskLevel 元数据，调度无法按风险分组并行，权限拦截只能 policy 事后分类（`spawn-agent-tools.js:10`）。
4. **架构门禁无棘轮牙齿**：`gate:code-size` 台账为登记制（超标可登记放行，例外不过期）；dependency-cruiser 未启用 forbidCycles 硬门禁。
5. **卫生残留**：仓库提交了运行时数据库 `core/biof3-server/biof3.db`（含 -shm/-wal）；`src/main.js:578-580` 引用未定义标识符 `setupFigcodeIpc` 的死守卫。

**ZCode 参照做法**（借鉴设计、自研实现，Apache-2.0 合规见 §2 非范围）：约 70 种 SessionEvent 先落存储再扇出、前端只消费 EventReducer 投影（`reference/ZCode/packages/contracts/src/events/session.events.ts:83`）；工具 entry 元数据化 + 拓扑并行调度（`reference/ZCode/apps/zcode-cli/packages/core/src/tool/types.ts:63-80`）；architecture-policy 机器门禁 + sha256 基线 + 例外 expires 自动过期（`reference/ZCode/architecture-policy.yaml:59-65`）。压缩三层（compact/policy.ts）不移植——BLOCK-95/98 已有等价交付（§0.2-2）。

### 0.3 已有资产（不退化）

`loop-orchestrator.js` 状态机、`task_events` 表（seq 严格递增，`agent-task-store.js:404-407`）、UI-292 agent 详情窗事件回放、BLOCK-38 agent-task-resume 链路、BLOCK-107/108 呈现层（分段模型/时间线/簇）、`impact-map.json` 定向测试——全部保留复用；本包是**在其下补事件单一事实源**，不是推倒呈现层。

## 1. 阶段划分（P0 → P3，串行；每阶段可独立验收可中断恢复）

### P0-LAUNCH：登记 + 拆前基线 + 尾巴清偿

1. 五件套登记（本 plan / DOC-REGISTRY / README / roadmap / AUDIT-LOG）。
2. **拆前行为基线**（BLOCK-92 先例：拆前基线拆后对账）：固化「一轮带工具调用的会话」端到端契约测试（输入→SSE 事件序列→落库→恢复），作为 P1 重构的行为等价判据。
3. **UI-431 尾巴清偿**（D3）：AgentRunPanel 子智能体面板实机补验，UI 台账翻 verified——P1 动 conversationRunStore/SimpleChat 文件面前必须落定。
4. **卫生清偿**：`biof3.db`/`-shm`/`-wal` 从 git 索引移除并入 `.gitignore`（先核对路径解析确认非测试夹具依赖）；删 `main.js:578-580` 死守卫；`hygiene:check` + 定向测试绿。
5. **事件模型评审**（P1 前置设计裁决）：事件类型枚举、存储落点（`task_events` 扩列 vs 新表）、保留策略（BLOCK-106 实测 18k 行/天的规模约束）、与 `meta_json` 聚合快照的迁移共存策略——写成 plan 附录 A 后过用户裁决再动代码。

### P1：事件溯源单一事实源 + 组装唯一化（本包核心，风险最高）

1. 后端会话运行事件模型：运行期一切状态变迁（turn 开始/模型流/工具调用/进度/完成）以**事件**为唯一真相先落库再扇出（自研，语义参照 SessionEvent，非复制）。
2. 前端 `conversationRunStore` 改为消费后端事件投影：实况（SSE）与历史（事件回放）同源，删除「前端组装快照 + localStorage 恢复态」双轨。
3. legacy `routes/ai-agent/chat.js` 786 行 SSE handler 退役：先双轨对照（契约测试证等价）后物理删除；**上下文组装随退役收敛到 `history-assembly.js` 单链**（吸收原「P2 组装收口」工作面）。
4. 4 个 resume 入口收敛为 1 个（统一走事件回放重建），主/子 agent 恢复同源（`loop_runs` 并入事件真相或建立单向投影，消除「注释约定权威」）。
5. 验收：P0 基线契约测试在新链路全绿（行为等价）+ 新增 dev-verify flow `block109-single-truth-live`（实况/刷新/重启恢复三腿）+ `test:changed` 定向绿。

### P2：工具定义元数据化 + 调度分组

1. `tool-defs.js` 按域拆分（workspace_* / computer_* / knowledge_* / result_* / spawn-* 等），物理目录即域。
2. 每工具补执行元数据：`readOnly` / `destructive` / `concurrentSafe` / `timeoutMs` / `needsApproval` / `riskLevel`。
3. 调度器按元数据分组：只读并发安全组并行执行，破坏性工具串行 + 审批门。
4. MCP 工具（`mcp/registry.js`）投影同轨元数据，消除第二套执行语义。
5. 验收：元数据完备性机械门禁（新工具缺元数据即红）+ 并行调度行为契约测试 + `test:changed` 定向绿。

### P3：架构门禁基线化（收口阶段）

1. `gate:code-size` 升级：sha256 指纹基线 + 例外带 `expires` 自动过期（到期未清即红，续期需登记理由）。
2. dependency-cruiser 增 forbidCycles 硬门禁（存量环入基线，新环即红）。
3. 两门禁接入 closeout 聚合链。
4. 验收：门禁自测（构造违规样本红 / 合规样本绿）+ 一次全链 closeout。

## 2. 范围与非范围

**范围**：§1 四阶段全部工作面；`core/biof3-server` 会话链路 / `frontend/src/components/copilot` 消费链 / `agent-tools` 定义层 / 门禁脚本。

**非范围（exclusions）**：

- **上下文压缩机制**：BLOCK-95 B2（rolling auto-compact）+ BLOCK-98（microcompact/reactive/熔断/输入插队）已交付且默认开，本包零重复；分段 token 预算治理登记候选池（压缩已在，预算价值需重估后另裁）。
- G1+ 全部事项（Provider / packaged / GA / 公证）——G0 开发期常态 · 不外推。
- 前端长列表虚拟化（独立候选包，BLOCK-107 收口时已转交）。
- 轮询→SSE 改造（BLOCK-106 登记的独立候选，本包 P1 复用既有 SSE 通道不改其触发方式）。
- `node:sqlite` 迁移（D2：登记为候选池专项，需独立裁决启动；不阻塞本包任何阶段）。
- preload/channels/electron.d.ts 三份契约单源化（大面，候选池登记，另行裁决）。
- **ZCode 代码直接复制**：Apache-2.0 下仅借鉴设计与工程思路自研实现；如未来确需引入片段，另行按协议保留版权与 NOTICE 归属（独立合规动作，不在本包）。
- 呈现层重做：BLOCK-107/108 的时间线/分段/簇资产零退化（P1 只换数据来源，不换呈现）。

## 3. 依赖与风险

| 风险 | 缓解 |
| --- | --- |
| P1 动核心链路，回归面最大 | P0 拆前行为基线 + 双轨对照期 + legacy 物理删除放在等价证明之后 |
| `task_events` 规模（18k 行/天） | P0 事件模型评审必须含保留策略/清扫设计（BLOCK-106 SCAN→SEARCH 先例可援引） |
| UI-431 文件面交叉 | D3：P0 先清偿面板实机补验，P1 才动交叉文件 |
| 老会话 `meta_json` 无事件素材 | 历史兼容降级路径（BLOCK-107 P2 先例：无素材退回既有分组渲染，老会话不白屏） |
| P2 压缩误删关键上下文 | 压缩前后模型可见内容对照测试 + 首尾保留策略 + 熔断 |

## 4. 验收门禁（收口时逐项对账）

- 每阶段：`npm run test:changed`（impact-map 登记本包规则）+ `quality:types` + `quality:lint`。
- P0：基线契约测试落库 + UI-431 verified + hygiene:check 绿。
- P1：行为等价对照绿 + `block109-single-truth-live` 实机三腿 + legacy chat.js 物理删除后全绿 + 组装单链断言（legacy require 清零）。
- P2：元数据完备性门禁 + 调度契约测试。
- P3：门禁自测红/绿样本 + closeout 九门全绿。
- 收口：`npm run docs:reconcile` 逐候选核对 + `docs:check` + registry `completed`。

## 5. 完成语义

四阶段全部验收门禁绿 + legacy 双轨（chat.js / 4 resume 入口 / localStorage 恢复态）物理删除 + DOC-REGISTRY `completed` + roadmap/AUDIT-LOG 收口行 + UI-431 已于 P0 verified。任一阶段可中断：进度回写本 plan 状态头，恢复按 plan 对账。

## 6. 环境纪律

dev 栈启动走既有 `restart-dev-stack.sh` / `npm run dev`（Watchdog 已退役，主动性回归手动）；后端变更须重启后端进程；单工作包串行，本包 active 期间不开新包。

## 7. 裁决项留痕（D1–D6，按推荐执行）

| # | 裁决 | 推荐与执行 |
| --- | --- |
| D1 | 一个母包多 P 阶段 vs 多 BLOCK 排队 | **单母包**：剩余方向有依赖顺序（事件溯源是根；工具元数据在其后；门禁收口放最后），拆多包会造成人为排队间隙与重复上下文。用户裁决「一个或多个」含「一个」选项，采纳之 |
| D2 | `node:sqlite` 迁移评估是否入包 | 不入包，登记候选池：产出是结论的专项，且涉及全数据层，独立裁决启动 |
| D3 | UI-431 面板实机尾巴 | P0 先清偿翻 verified：P1 动其文件面前落定，避免「验收中文件被改」的账实纠缠 |
| D4 | legacy chat.js 退役方式 | 先双轨对照证等价再物理删除，不搞长期共存开关（避免第三轨） |
| D5 | 压缩方向是否移植 ZCode 三层 | **零移植**：立项核实 BLOCK-95 B2 + BLOCK-98 已交付等价机制（对比审计初判「无压缩」系盘点盲区，本 plan §0.2-2 已撤回修正）；分段预算登记候选池待价值重估 |
| D6 | P3 门禁是否 blocking | blocking 入 closeout 链：门禁不红即无牙齿（BLOCK-105 先例） |

## 8. 与相邻包/候选的关系

- **BLOCK-95 B2 / BLOCK-98**（已收口）：上下文压缩既有交付，本包零重复；P1 组装单链化时以「压缩只作用于视图层、DB 原文不动」为其红线延续。
- **BLOCK-107/108**（已收口）：呈现层资产全部保留；本包 P1 为其数据面换源，`block107-*` / `block108-*` dev-verify flows 是 P1 行为等价验收的现成腿。
- **BLOCK-106 §2/§7 登记的候选**（task_events 数据模型改造 / 轮询→SSE）：前者由本包 P1 **吸收实现**（候选无独立 Plan ID，本包即其归宿）；后者仍留候选池，本包不改轮询触发方式。
- **虚拟化候选包**（排队中）：无文件面冲突（其动列表渲染层，本包动数据链）。
- **本包新登记候选**（§2 非范围）：`node:sqlite` 评估、三契约单源化、分段 token 预算——记录于 roadmap 候选区，启动需显式裁决。
