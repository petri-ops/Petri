# 第六轮全量深度审计 · 通用智能体长任务能力对标 · M 波次蓝图（2026-11-11）

> **状态：candidate / 未发令 / 非 canonical**。本文件是只读审计交付物，落在 `acceptance/`（非 `docs/` managedRoot），不注册 `DOC-REGISTRY.json`、不占单包串行槽位、不宣称任何 active 工作包。当前串行槽位为空；本蓝图需用户显式发令后方可按 `$petri-project-governance` 注册 M 阶段 work-package。
> **本轮基线**：`main` HEAD `4127f5b5`（BLOCK-425 收口后）。工作区 **89 项已修改 + 67 项 untracked**（含并发写入者 UI/主题/设置页在制批），全程零触碰、零暂存、零提交、零产品代码改动。
> **与第五轮的关系**：本次用户发令与 `docs/post-k7-full-audit-and-blueprint-2026-11-10.md:16` 记录的发令逐字相同，但**新增「通用智能体能力现状 / 参照 reference/ZCode / 长任务差距」这一重点**；第五轮 L0–L7（BLOCK-404～411）、UI-D0～D5（BLOCK-415～420）、BLOCK-421～425 均已收口。本轮为**第六轮独立审计**，不重复已闭合发现、不回溯改历史评分。
> **波次命名**：W → S → H → K → L → **M**。**G0 开发期常态 · 不外推 packaged/Provider/GA。**

---

## §0 执行摘要

### 0.1 一句话结论

第五轮把「尺子、安全、断链、错误语义、性能数据面、结构单源、体验」推到十一维第六列 11 升 0 降、7/11 维达标；**第六轮的真实瓶颈已不是「还缺功能」，而是「通用智能体的长任务可信闭环没有闭合」**：Petri 具备 115 工具、事件水位续传、compaction、subagent、goal/plan/todo、guard-ack、token 计量等高密度机制层，但缺少 ①显式 Turn 状态机与完整资源边界族、②append-only transcript + hydrate 式崩溃续跑、③durable 任务图编排、④压缩后任务状态恢复契约、⑤工具能力元数据驱动的并行/权限/结果预算、⑥长任务评测装置与成功率基线、⑦traceId 全链与 usage 事实表。对照 `reference/ZCode`，这七项**恰好是它长任务能力的可本地移植主体**（全部位于 `apps/zcode-cli` 本地单进程，不依赖云端）。同时，十一维仍有 70 项可核对发现，其中 2 个当次红门、9 条安全 P1/P2、7 个 >1000 行巨型文件、4 套分散 gap-ledger。

### 0.2 当次机械门禁真值（2026-11-11，逐门串行取样，HEAD `4127f5b5`）

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| `docs:check` | PASS | 569 registered documents |
| `ui:audit:check` | PASS | 633 个带实现证据的 UI 编号 |
| `hygiene:check` | PASS | 列出 127+ untracked，仅报告 |
| `quality:secret` | PASS | 3 类 fixture 豁免在册 |
| `gate:code-size` | PASS | 台账 75 文件 / 86605 行 = 基线 / 生效例外 16 |
| `gate:arch-cycles` | PASS | 12 存量环在册，无新环 |
| `quality:knip:check` | PASS | 保留面 330 键冻结 |
| `skills:check` | PASS | 11 内置（2 skill.json + 9 SKILL.md）+ 3 领域包 |
| `quality:types` | PASS | `tsc --noEmit` 0 error（incremental） |
| `quality:arch` | PASS | R1–R5 无违规 |
| `quality:ear` | PASS | **1052/2269 = 46.4%**（阈值 40%；manifest 43.3%）→ 45% 目标已达成 |
| `test:changed:list` | PASS | exit 0 |
| `quality:lint` | **FAIL (1)** | **2 errors / 2445 warnings**；`SettingsNav.tsx:39`（set-state-in-effect）、`test/block414-backend-port-reuse.test.mjs:12`（no-unused-vars），均属在制 WIP |
| `quality:perf` | **FAIL (1)** | 连续 5 次采样存在红轮：**`packaged_start` 495–510ms vs 基线 379ms / 阈值 493ms**；其余 3 场景绿 |

合计 **12 绿 2 红**。**未取数**：`closeout` / `closeout:full`（`audit:compact` 会写盘且工作区含他方 WIP）、`test:changed --run`、`test:all:workspace`、`gate:post-h9-contracts`、`quality:surface`。一律不写「全绿」。

**红门归因**：`quality:lint` 两条 error 落在 BLOCK-423 设置页改版（`SettingsNav.tsx`）与 BLOCK-414 附带事故修复（`block414-backend-port-reuse.test.mjs`）的在制文件上 → **W 类在制 WIP 归属**，本轮零触碰。`quality:perf` 是真实读数红，按既有「不重采、不放宽」纪律登记，交 M0 判据阶段先核「基线是否仍绑定当前源码 digest」再决定是否重锚，不得直接放宽阈值。

### 0.3 主代理终审剔除项（防止重复报账与越权）

| 项 | 终审结论 | 依据 |
| --- | --- | --- |
| MCP `skill_execute` 恒返回「成功但零执行」 | **L2-1 已闭合**，不再登记 | `core/petri-server/mcp/registry.js:272-289` 已改 `no_execution_backend` fail-closed |
| MCP 双 server / `ide://` 资源不可达 | **L2-2 已闭合** | `src/mcp-server.js:27-41` 已声明 resources 并挂 list/read handler |
| `MAX_AGENT_ITERS = Infinity` | **产品契约，不是缺陷**。ZCode 主循环同为 `while(true)` 且明确「不用 tool call 次数做硬停止」 | `agent-tools/agent-loop-control.js:9-12`「goal-terminated, not round-terminated」；`reference/ZCode/apps/zcode-cli/AGENTS.md:12` |
| `workspace_exec` 黑名单默认只告警 + `/bin/sh -lc` | **用户 2026-11-05 S2 明确裁决「默认放行」**，不得作为待办推翻；仅登记风险与补偿控制 | `workspace-tools/internals.js:42-48,60-81`；`workspace-tools.js:695-707` |
| 空 Origin 可信 / token 门 | **L1-3 部分闭合**（env 回环过滤 + 无 Origin 变更动词随机 token），残留 GET 全放行与 env 未设时跳过 | `core/shared-backend/local-request-boundary.js:8-59,62-86` |
| `qualificationEligible:false` / Result Studio `experimental` / RS-P7 / Windows 签名 / i18n / 真实 Provider / 公证 / GA | **G0 常态与用户既有延期裁决，一律不外推、不列待办、不写改进点** | `AGENTS.md` §当前阶段纪律、`docs/AUDIT-LOG.md:109,112,113` |

### 0.4 十一维第七列（本轮独立估值，不回溯改第六列）

| 维度 | 第六列 | **第七列** | 升/平/降 | 归因 |
| --- | ---: | ---: | --- | --- |
| 功能完整性 | 4.5 | **4.5** | 平 | L2 断链闭合、UI-D0–D5 与 BLOCK-421–425 增量；165/168 通道零消费与 `needsApproval` 零读取者仍在（M-01） |
| 性能表现 | 4.0 | **3.8** | 降 0.2 | 当次 `quality:perf` 红轮、perf 仅 4 个 API 场景、长列表虚拟化与帧率门缺失（M-08～M-11） |
| 代码质量 | 4.2 | **4.1** | 降 0.1 | 当次 lint 2 errors（W 类）+ 2445 warnings 无只减锚 + 412 静默 catch 被门合法化（M-14～M-20） |
| 可维护性 | 3.9 | **3.8** | 降 0.1 | IPC 三真相、28 文件绕过 desktopBridge、设置页 3 套字段体系（M-21～M-26） |
| 可扩展性 | 4.5 | **4.4** | 降 0.1 | 新增 1 通道 ≥7 处 / 1 工具 7 处；工具四表无单一声明点（M-27～M-31） |
| 安全性 | 4.4 | **4.2** | 降 0.2 | 全局 Origin 门未挂载、MCP 写面可达 RCE 链、file drag 任意路径、权限降级只覆盖 defaultSession（M-32～M-40） |
| 界面与交互体验 | 4.2 | **4.2** | 平 | 对比度 4.40→4.81、设置页改版已落地；焦点环 8/9 诚实红、22 条人眼签字全空、D5 done-partial |
| 错误处理与边界 | 4.2 | **4.1** | 降 0.1 | 4 条 DDL 全静默、异常→`{}` 假成功、MCP uncaughtException 不退出、200MB body 无单源（M-47～M-53） |
| 测试覆盖 | 4.3 | **4.0** | 降 0.3 | agent loop 测试不跑 loop、SSE 契约测试手工 mirror 且未挂 impact-map、约 90 测试无规则引用、**无长任务评测基线**（M-54～M-59） |
| 文档完善度 | 4.7 | **4.5** | 降 0.2 | 两份已执行完的蓝图 status 仍 `planned`、541 份 md 入口错乱、4 套 gap-ledger 无单一剩余视图（M-60～M-64） |
| 依赖与架构 | 4.1 | **4.0** | 降 0.1 | typescript 双版本（U 类）、12 环未消亡、无 workspaces + postinstall 装 core、CVE 扫描 external-blocked |

**本轮口径**：0 升 4 平 7 降。下降不是「代码变坏」，而是**第六轮把「长任务能力」与「用户可感完成度」纳入评估口径后，原本按结构齐备给分的部分被证据扣分**；历史第六列数值保留原值。达标（≥4.4）由 7/11 降为 **3/11**（功能 4.5、界面 4.2 边缘、文档 4.5）。

---

## §1 事实基线

| 轴 | 事实 |
| --- | --- |
| 代码规模 | 前端 891 个 `.ts/.tsx`（362 测试）；`core/` 584 个 js/ts/mjs/cjs；`src/` 98 个 `.js`；`scripts/` 523；`test/` 719 `.test.mjs` + 5 `.test.cjs`；`docs/` 541 份顶层 md（registry 569 文档 / 552 托管 md） |
| 能力面 | 115 工具 / 16 域 / 168 IPC 通道 / 283 路由端点（`docs/capability-map.md:5`），访问档 read / workspace-write / full |
| WIP（零触碰） | 89 项已修改（含 `docs/DOC-REGISTRY.json`、`docs/AUDIT-LOG.md`、`frontend/src/App.tsx`、多个 `.module.css`、设置面板）+ 67 项 untracked（含 `assets/`、`acceptance/ui-design-assessment-2026-11-11/`、多份 audit-log-compact 归档） |
| active | 层 1 串行槽位 **空**；层 2 常驻 `G0-LF`（`docs/g0-living-foundation-plan.md`）；planned 队列 4 项 |
| 证据等级 | 当次命令输出 > Git/源码 > acceptance JSON > canonical 文档；历史「全绿」不自动复用 |
| 本轮动作 | 五路只读源码实证（177/104/153/104/136 次检索）+ 主代理终审复核 + 当次 14 门取样 + 决策建议器取数 + 两份 `acceptance/` 交付物 |

---

## §2 十一维度逐项发现（70 条，M-01～M-70）

> 每条格式：`ID | 级别 | 现象与证据 | 影响 | 修法`。⏳ = 需动态验证，未定性。所有路径相对仓库根。

### 2.1 功能完整性（M-01～M-07）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-01 | P1 | `acceptance/functional-audit-2026-11-04/surface-matrix.json:10-11`：168 通道中 **165 前端零消费、2 缺 preload**；`docs/functional-audit-2026-11-04.md:44-48`：`needsApproval` 元数据**零生产读取者** | 「可达」是结构齐备，不是用户可用；审批元数据形同虚设 | 逐件分诊：真消费接线 / 保留并写理由 / 退役；`needsApproval` 接入 `agent-tool-interceptor` 决策 |
| M-02 | P1 | `docs/functional-audit-2026-11-04.md:25-42`：`browser_act` click/fill 无 ackToken 签发恒失败、`workspace_worktree_remove` R3 死工具、默认执行目标设置静默无效 | 专项审计发现的 P1 与矩阵「P1=0」并存 | 建立「矩阵结构判定」与「专项行为判定」双列，禁止互相冒充 |
| M-03 | P2 | `docs/capability-map.md:18-33` 报 16 域 115 工具 100% 可达，`docs/README.md:84` 写「17 个能力域」；该文件全文 0 处 `experimental`/`implemented_unverified` | 用户向能力图与 README 口径不一致，且不呈现证据等级 | 单源生成 + 增加 evidence-tier 列 |
| M-04 | P2 | `docs/capability-map.md:44-48`：P3 `storage_read_never_written` 2 条（`petri_token` 3 处、`petri.simplechat.extraRenderers` 1 处） | 读而不写的存储键 = 潜在死配置 | 补写侧或删读侧，矩阵 P3 归零 |
| M-05 | P2 | `scripts/functional-surface-audit.mjs:603` 只查「定义/契约/handler/挂载/调度元数据」 | 绿灯掩盖「用户真能用」 | 增加行为级抽样探针（每域 1 条真实调用）入门禁 |
| M-06 | P1 | `loop-orchestrator.js:739,1484` 终止靠 `shouldFinalizeAgentIteration` / `modelFinalized`；`helpers/automation-store.js:91-99,194-208` 有 goal 状态机；`AGENTS.md:39` + `helpers/system-prompt.js:391` 定义「以目标为输入」 | **人设与主循环未闭合**：目标达成由模型自报，长任务易假完成/目标漂移 | 增独立 goal verifier（证据校验 + 后台任务 settle defer），状态机驱动终止（M1） |
| M-07 | P2 | `helpers/plans.js:140-163` 持久化 `copilot_plan_steps`；`agent-tools/todo-tools.js:4-12` 明写「任务运行内临时 UI 态」；`conversationRunStore/conversationTodos.ts:5-8` 是会话级内存 Map | 长任务跨恢复 todo/plan 不同源、不保留 | 统一到 append-only transcript 的任务状态段（M2） |

### 2.2 性能表现（M-08～M-13）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-08 | P1 | 当次 `quality:perf` FAIL：`packaged_start` 495/510ms vs 基线 379ms、阈值 493ms；`docs/Petri-Desktop-Evaluation-Report-2026-11-05.md:94` 说「稳定红」、`:197` 又说「并非稳定红」；`docs/AUDIT-LOG.md:127`「perf=V 稳定红不重采不放宽」 | 结论不可复算、不可信；红门长期挂账 | M0 先核 `coreSha` 基线绑定与采样口径，再按「基线刷新需全量证据」流程处理，禁止直接抬阈值 |
| M-09 | P1 | `test/perf-baseline.json:10-80` 仅 4 场景（后端 spawn、消息分页、文件树、打包后端启动）；`docs/post-h9-k5-decision-material.md:7,60-62` 列出首屏 FCP / DOM 节点 / 帧率 / SSE / 导出 / 请求体占比全为 V 挂起 | 无用户可感性能证据 | M4 补常驻门：DOM 节点上限 + 滚动 P50/P95 + 首屏 paint |
| M-10 | P2 | `docs/design-review-2026-09.md:56`、`docs/block-95-session-io-plan.md:47,70`：消息列表无虚拟化、`displayMessages` 每流式 delta 全量重拼；`docs/block-250-projectworkspace-render-loop-plan.md:1-3` 重渲染环致 CDP 求值 6–30s | 长会话越用越卡，直接冲击长任务可用性 | 零新依赖窗口化 + React.memo 分段；配 M-09 帧率门 |
| M-11 | P2 | `scripts/block350-perf-gate.mjs:85-124` 阈值 `max(median×(1+tol), median+slack)`、容差 25–60%；第五轮 `:34,98` 记录读数退化 30–70% 仍判绿 | 性能退化可被宽门吸收 | 加「相对上一锚点最大退化率」判据 + 植入慢样本必红负测 |
| M-12 | P2 | `core/petri-server/bootstrap.js:53` `express.json({limit:'200mb'})`；另有 `budget-constants.js:12` 64MB、`routes/files.js:354` 16MB、`mobile-gateway/index.js:143` 64kb、`file-dialog.js:72` 20MB、`terminal.js:325` 32768 | 单请求 200MB 入内存 → OOM；上限无单源 | 收编 `budget-constants.js`，按路由细分 body 限制 |
| M-13 | P2 | `helpers/memory-vectors.js:93-94,118-131` 全表 SELECT 后 JS cosine；`helpers/knowledge-space.js:28-45,123-163` 向量通道同为暴力全表 | 长任务记忆/知识增长后检索线性劣化 | 引入 ANN 索引或分块上限；建 recall/MRR 基线 |

### 2.3 代码质量（M-14～M-20）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-14 | P1 | 当次 `quality:lint` 2 errors：`SettingsNav.tsx:39`（setState in effect）、`test/block414-backend-port-reuse.test.mjs:12`（unused require）；2445 warnings 无只减锚 | 阻塞门禁；warnings 持续增生 | 归 W 类在制 WIP，owner 收口；补 warnings 分域只减棘轮 |
| M-15 | P1 | 巨型文件：`SimpleChat.tsx` 1964、`tools-executor.js` ≥2031、`skill-schema.js` 1346、`project-workspace.tsx` 1225、`scene3d.js` 1088、`RightFileTree.tsx` 1062、`ToolActivityList.tsx` 1011、`src/main.js` 887；`gate:code-size` 只是棘轮不减 | 改动成本高、评审盲区 | W5b 逐刀拆分（每刀 = 一会话 + 拆前拆后同套定向测试绿） |
| M-16 | P1 | 空 `catch {}` ≥765 处（`src/` 62、`core/` ≥289、`frontend/src/` 22、`scripts/` ≥233、`test/` ≥159）；`test/silent-catch-baseline.json:5` total=412；`scripts/silent-catch-ratchet.mjs:31` 只认裸 `catch\s*\{\s*\}` | 412 处静默吞错被门合法化；`catch(e){}`/只 log 不抛不在口径 | 扩口径 + 按文件设下降时间表逐批清零，而非永久冻结 |
| M-17 | P2 | `acceptance/post-s7-2026-11-10/h10/cycle-clusters.json:5,48` 12 存量环仅归簇未消亡；`scripts/arch-cycles-gate.mjs:49-57` 只判新环 | 核心循环依赖长期债 | 逐环独立切片（抽 `runAgentLoop` 或依赖注入） |
| M-18 | P2 | `eslint-suppressions.json` 249 条规则级抑制；`test/knip-baseline.json` 330 冻结键 | 治理靠基线而非清理，本身成维护负担 | 批量收缩 + `--update` 下调，保留只减 |
| M-19 | P2 | 生产面 `console.log`：`src/` 53、`core/` ≥73；`src/main/_window-create.js:366-372` 渲染层任意 console 原样进主进程 stdout | 日志噪声 + prompt/token 泄漏面 | 分级 logger + 渲染层日志脱敏白名单 |
| M-20 | P2 | 补丁堆积 5 处：`src/main/core-utils.js:48-107`（dev/packaged/pure-Node 三态）、`src/preload.js:85,586` + `desktopBridge.ts:55-116`（双全局 + 四层投影桥）、`pack-write-bridge-contract.js:82-85,173-180`（v1 legacy）、`src/database/_db-singleton.js:27-58`（shim）、`src/main/env-coordinator.js:212-218`（3003 legacy）；`ToolActivityList.tsx` 单文件 53 处 BLOCK/UI 标记 | 读者要持有的概念数持续上升 | 判「补丁 vs 重构」：命中即 scoped 重构吸收，不再垫第五层 |

### 2.4 可维护性（M-21～M-26）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-21 | P1 | `src/ipc/channels.js:11-258` 168 通道 + `src/preload.js` 634 行自包含字面量 + `docs/ipc-catalog.md:3,9-17` 停在 2026-08-19 的「108 注册 / 42 shadow」 | IPC 三份真相，目录严重滞后 | 由 `channels.js` 生成 catalog；preload 保持自包含但纳入双向门 |
| M-22 | P1 | `frontend/src` 内 `window.petriDesktop` 直读 **28 文件 / 64 行**（`hooks/useAutoUpdate.ts:52,76,101,127,146`、`pages/home.tsx:152,253`、`titlebar/shared.tsx:22,26,121,127` …）；`.dependency-cruiser.cjs:18-33` R1/R2 只拦 electron/node 内建 | 绕过 desktopBridge，破坏唯一桥纪律 | 扩 R1 规则到全局直读 + 逐文件迁移，保留 alias 兼容层 |
| M-23 | P2 | `resolveDataDir()` 7 处、`readConfig()` 5 处、`resolveCore` ≥71 处；`docs/block-105-code-quality-governance-plan.md:61` jscpd 2.7%，热点 `loop-orchestrator↔chat.js` 167 行 / `agent-runner↔chat.js` 125 行 | 同概念多镜像，修改易漏 | 单源 + 静态门（L5 已开四 mirror，续推剩余） |
| M-24 | P2 | `docs/AUDIT-LOG.md:2`（BLOCK-425）：设置页 **3 套字段样式体系**，模型接口 298 行 DOM / 联网计算自有 `styles.field` / 用量快捷键统计卡；高级 4 项（决策原语 118 下拉）；首批 `SettingsField` 仅改造 11 项 | 一致性与发现率差 | 续推剩余分区；高级项独立开发者页 |
| M-25 | P2 | `docs/README.md` 206KB：`:85` 标题在中段、`:37-38` 编号 393 重复、`:96` 三文档挤一行；541 份 md 无分类导航/阅读顺序 | 文档入口不可用 | 按月滚动索引 + 分类导航（治理 skill 已有 `docs:roll-index`） |
| M-26 | P2 | `docs/pending-work-backlog.md:3` 自称「历史快照，停在 2026-10-31」但 `:17` 仍写「所有已知未完成项唯一 canonical」；多套读数：impact-map 366/90 vs 365/120、registry 569/552 vs 544/527、closeout 16/17/19 | 无单一「当前剩余工作」视图 | 数值口径 JSON 单源 + README 入口只引单源 |

### 2.5 可扩展性（M-27～M-31）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-27 | P1 | 新增 1 条 IPC 通道 ≥7 处（`channels.js` / `preload.js` / `src/ipc/<domain>.js` / `electron.d.ts` / `ipc-catalog.md` + validator / registry test / 三矩阵重生成）；新增 1 工具 7 处（`docs/block-124-harness-productization-plan.md:101`）；新增 1 页面 ≥5 处 | 扩展成本随面线性上升 | 单一声明生成器产出四表/两视图（M3 工具面 + M6 IPC 面） |
| M-28 | P2 | `needsApproval` 全仓生产读取者 0（`core/petri-server/agent-tools/tool-metadata.js`、`worktree-tools.js` 仅定义） | 声明与消费断链 | 与 M-01 同批接线 |
| M-29 | P2 | `resources/skills/manifest.json` 11 内置 Skill，仅 `coding-playbook` / `visualize` 有 `skill.json`，其余 9 个只有 `SKILL.md` | 两套清单格式并存 | 统一结构化清单，`skills:check` 加一致性断言 |
| M-30 | P2 | `src/plugin-manager.js:14-22,50-54` 自述「1457→~360 行」但实测 556 行，靠 `void` 空语句保 21 个 public exports | 兼容性负担阻碍收敛 | 逐导出消费方盘点后退役 |
| M-31 | P2 | `src/migration-runner.js:33` 明写「不经 resolveCore」的第二路径；`knip.json:30-37` 6 个 `ignoreDependencies`；`scripts/knip-ratchet.mjs:16-17` 依赖类不进棘轮；core 懒 require 是 Knip 盲区 | 死依赖/死文件不可见 | 登记制 pathNot + 动态 require 静态注册表 |

### 2.6 安全性（M-32～M-40）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-32 | P1 | `core/petri-server/routes/mcp-client.js:174-195` `POST /api/mcp/servers` 可写任意 stdio `command`/`args`；`bootstrap.js:51-70` **未全局挂** `requireTrustedDesktopOrigin`（全仓 `routes/` 仅 `ssh-projects.js:11` 与 `files.js` 两处使用）；`routes/index.js:88` autoConnect 触发 spawn | 本机任意进程 / 伪造 Origin → 本地 RCE | 全局 `app.use(requireTrustedDesktopOrigin)`；MCP 写面额外会话 token + command 白名单 |
| M-33 | P1 | `core/shared-backend/local-request-boundary.js:49-50,62-85`：空 Origin `return true`；token 仅「变更动词 ∧ env 已设」才校验；GET 全放行；`Bearer desktop-local` 为常量（`helpers/automation-runner.js:16`） | :3001 全量 API 对本机进程基本无鉴权 | 空 Origin 全方法也要求 token；boot 无条件生成 per-boot 随机 token；废弃常量 Bearer |
| M-34 | P1 | `src/ipc/file-dialog.js:310-318,357-366`：`file:start-drag` 的 `localPath` 仅判字符串非空即 `event.sender.startDrag({file})`，零 realpath 边界；`:228,313,335` name 只过滤 `"<>|?*`、控制字符、`.`/`..` 字面量，**未过滤 `/ \ ../`**，写盘 `path.join(tempDir, ...)` | 任意本机文件（SSH key/凭据 DB）可作 OS 拖拽源；路径穿越写任意磁盘 | 复用 `resolveWorkspaceFile`（`:374-402`）登记根 + `path.basename()` + 目标根前缀断言 |
| M-35 | P1 | `src/main.js:557-569` 权限策略装配异常时 deny-all 只装 `session.defaultSession`；webview 用分区 `persist:petri-browser`（`security-hardening.js:41-42`），降级时回落 Electron 自动批准 | 任意站点拿摄像头/麦克风/定位 | 降级分支遍历已存在 session + `app.on('session-created')`；失败即拒绝创建 webview |
| M-36 | P2·裁决 | `workspace-tools/internals.js:60-81` 4 条黑名单默认只 `console.warn` 后 `{ok:true}`；`workspace-tools.js:695-707` 整条命令交 `/bin/sh -lc`；注释 `:42-48` 记录 **2026-11-05 S2 用户裁决「默认放行」** | 模型获得等价任意命令执行能力 | **不修改默认裁决**；补补偿控制：不可信内容隔离（M-39）、审批元数据接线（M-01）、命令审计 trace（M4）、文档显式风险声明 |
| M-37 | P2 | `src/main/external-url-policy.js:11-21` / `security-hardening.js:229-238` / `gen-ui/external-link.js:19-21` 三处 `shell.openExternal` 无域名白名单；guest handler 连 userinfo 都不过滤；`src/ipc/gen-ui.js:247-250` 直接 `openExternal(href)` | 钓鱼/凭据形态诱导 | 抽单一 `openSanitizedExternal`，三处复用 + host 白名单 |
| M-38 | P2 | `core/shared-backend/capability-bundles.js:205-215` `execFile('tar', ['-xzf',...,'-C',installDir])` 无 `--no-absolute-names/--no-same-owner`、无条目校验；`src/plugin/zip.js:14` 承诺「不留半截目录」但 `:47-91` 无 `fs.rmSync(destDir)`，`plugin-manager.js:132-134` 失败只删 zip | tar 路径穿越；恶意 zip 残留半截插件目录 | tar 参数加固 + `tar -tzf` 逐条校验；try/finally 清 destDir |
| M-39 | P2 | `helpers/desktop-agent-prompt.js:18-41` 无「网页/文件/工具输出不可信、不得当作指令」条款；`helpers/web-fetch-policy.js` 抓取文本直接进上下文，无 `<untrusted>` 包裹；`src/main/csp-config.js:52-90` `onBeforeRequest` 除 gen-ui 外一律 `callback({})` 放行、无 allowlist（dev 仍 `script-src 'unsafe-inline'`，全模式 `style-src 'unsafe-inline'`） | 注入文本可改写工具决策，与 M-36 串成链 | 系统提示加边界条款 + 外部内容统一 `untrusted` 包装 + 帧导航 allowlist |
| M-40 | P2 | `scripts/secret-scan.mjs:64-70` `execFileSync('git',['grep',...])` 的 `catch { continue }` 把任何 git 错误当「无命中」；只扫 tracked、8 个正则、`test/` 与 `acceptance/block-105/` 全豁免 | `quality:secret` 在 git 异常时静默 PASS；新密钥格式漏检 | 区分 exit 1 与其它错误（门 FAIL）；改文件系统遍历；补 JWT/自定义 token 模式 |

### 2.7 界面与交互体验（M-41～M-46）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-41 | P1 | `acceptance/ui-design-assessment-2026-11-11/d4/gate-readout.json:8,18-23`：focus 缺口 12 文件 / 16 声明；首跑 9/9 假绿作废，终态 **8/9 诚实红**（`outlineStyle:"none"`） | 键盘/读屏用户不可见焦点 | 补 `:focus-visible` 规则 + 只减棘轮 + 9223 离屏复测 |
| M-42 | P1 | `docs/ui-design-human-eye-route.md:43-57` 11 行签字槽全空；22 条 `pending_human_eye`；`d5/before-after-scorecard.json` 静态分 3.6→4.0 明写「不写 verified」，B 维 3.5→3.5 持平 | 工程绿 ≠ 用户观感绿 | 自动生成测试路线，保持 pending_human_eye，Agent 不代答 |
| M-43 | P2 | `ASSESSMENT-AND-PLAN.md:55-57`：17 个互不统一断点、`@media` 仅 32 处/15 文件、≥89 CSS 文件零响应式、JS `767` vs CSS `768`；U-04 档位收敛 `pending_user_ruling` | 窄屏体验不可预测 | 断点单源（已有 `uiBreakpoints.ts`，续推消费面）+ U 类材料 |
| M-44 | P2 | `d4/gate-readout.json:35` `light tertiary on subtle` 4.40:1；BLOCK-422 改 `#71717a→#6b6b73` 达 4.81:1 / 32 对全绿，但观感仍 pending | 对比度数值达标、观感未签 | 保留数值门，观感归 E |
| M-45 | P2 | `acceptance/block-332/ui-ledger-triage.json`：canonical sections 497 / uniqueIds 488 / debt 35；机械 grep 口径 verified 1176 / in_progress 296（`ASSESSMENT-AND-PLAN.md:69`） | 多套并存计数，禁止混用 | 明确 canonical 唯一分诊口径，机械读数只作诊断 |
| M-46 | P2 | `docs/ui-productization-audit.md:40-41`：D5 `closeout:full` 连续 3 次 exit 1（P6 源绑定），程序终态 done-partial | 全量收口证据未闭合 | 干净树 + owner 重采 P6 + 三连复跑 |

### 2.8 错误处理与边界情况（M-47～M-53）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-47 | P1 | `core/petri-server/routes/ai-memory.js:13-16` 连 4 条 `ALTER TABLE/CREATE INDEX` 全静默；`src/ipc/ai-settings.js:23-31` 异常返回 `{}`（无 ok:false / code）；`src/ipc/pack.js:34-41` 异常返回全 0 统计 | 假成功：配置/迁移失败被当「无配置」 | 具名 reasonCode + 上层可呈现的降级状态 |
| M-48 | P1 | `core/petri-server/mcp/server.js:83-85` `uncaughtException` 捕获后**不退出**且把 `err.message` 回客户端；`src/main.js` 全文无 `process.on('uncaught'/'unhandledRejection')` | 进程带病运行 + 信息回显 | 与 `server.js:135-143` 同形退出；主进程挂全局处理 |
| M-49 | P2 | `routes/index.js:88` `void autoConnectConfigured().catch(() => {})`；`mobile-gateway/index.js:53` `appendFile(..., () => {})` fail-open；`mobile-gateway/index.js:498-500` 顶层 500 不 log | MCP 连接失败不可见 | 结构化 error 事件 + 有界重试 + 健康面 |
| M-50 | P2 | `routes/files.js:269-270,321-322` limit/offset 无上界/整数/非负校验；`:380` `res.send(fs.readFileSync(target))` 无大小上限；`:278-295` 下载失败只 `destroy()` 不删半截文件 | 语义错 / OOM / 残留文件 | 上限常量收编 + 非负整数断言 + try/finally 清理 |
| M-51 | P2 | `helpers/ai-settings.js:284-315,416-461` 多处 read-modify-write + 直接 `writeFileSync` 非原子，跨 Electron/petri-server 进程无锁；`:40-47` mtimeMs+size 签名 + `:83-89` catch 兜底 | 用户「以为保存成功」实际保留旧值 | `pid.tmp` + rename（复用 `credential-store.js:42-46`）+ 单写者 |
| M-52 | P2 | `docs/AUDIT-LOG.md:108` 🟡 墙面板取消跨后端可达性未定（双后端脑裂，owner=:3001 的 job 15s 无效果）；`workspace-tools/internals.js:314` 后台进程表为内存态、`:1067` detached，重启后查不到但子进程可能仍在跑 | 取消不生效 / 孤儿进程 | 单一 owner 路由 + 启动时进程表对账 |
| M-53 | P2 | `src/ipc/working-tree-review/context.js:18-28` `safeInvoke` 把原始 `e.message` 回渲染层；`src/ipc/file-dialog.js:101` 用户取消却回 `{ok:true, canceled:true}` | 内部路径/错误细节外泄；失败形状三套并存 | 白名单错误映射 + 统一 IPC 信封 |

### 2.9 测试覆盖（M-54～M-59）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-54 | P1 | `test/agent-runner-loop-orchestrator.test.mjs:25-45` 只断言 `runLoop` 是 async function + 用 `readFileSync` 正则检查不得 require 某模块，**导入生产模块却不执行 loop** | 主循环回归无行为测试 | M4 建可注入 provider 的 loop 行为测试（红绿先行） |
| M-55 | P1 | `test/loop-sse-contract.test.mjs:1-8,15-25` 自述「type/contract test」，用本地工厂 mirror 事件形状，**不导入任何 SSE 发射器**；该文件列于 `test/impact-map-coverage-baseline.json:70` ⇒ 改生产 SSE 不触发 `test:changed` | 契约测试无法捕获实现漂移 | 真实 SSE 端点行为测试 + 挂 impact-map rule |
| M-56 | P1 | 约 90 个测试文件未被任何 impact-map rule 的 `tests` 引用（`test/impact-map-coverage-baseline.json:2,5-80`）；`test/jspdf-removed.test.mjs`、`test/script-entry-guard.test.mjs` 是纯源码字符串扫描 | 定向测试漏跑；测实现不测行为 | 覆盖率只减棘轮 + 行为断言改造 |
| M-57 | P1 | **无长任务评测装置**：`evals/CATALOG.md:11,17-19,25-33` golden 仅 1 mock 回合、real 3 任务 duration 2573/2575/27891ms、smoke 10 个 2–6 回合；`evals/baselines/` 无「长任务成功率 / 完成度 / 跨恢复一致性」指标；唯一 `t7-long-haul` 曾在 20k 窗口压缩后 provider 400 死（`docs/block-348-eval-report.md:83-93`，后修复但无常驻门） | **长任务能力无法自证** | M4 建本地长任务 fixture + 成功率基线 + 压缩/恢复/取消三类回归 |
| M-58 | P2 | `evals:run` / `evals:gate` 不在 `package.json:186` 的 closeout 门序列；`scripts/evals-run.mjs:74-76` real 无凭据时全 `skipped` 且仍可绿 | 评测结果不参与收口 | 把 mock/replay 档接入 closeout，real 档保持 external-blocked |
| M-59 | P2 | `test:changed` `--test-timeout` 由 120s 提到 600s（单个防复发全量扫描用例 solo 505–864s，`scripts/test-affected.mjs:82-85,222-226`） | 定向测试名不副实，耗时近全量 | 拆分片 + 常驻缓存，保留 fail-closed |

### 2.10 文档完善度（M-60～M-64）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-60 | P1 | `docs/DOC-REGISTRY.json` 中 `POST-K7-FULL-AUDIT-AND-BLUEPRINT-2026-11-10` 与 `POST-H9-OPTIMIZATION-BLUEPRINT-2026-11-10` 的 status 仍 **`planned`**，而其 L0–L7 / K0–K7 阶段包均 `completed`（BLOCK-404～411 / 396～403）；对应蓝图本体 front-matter 亦 `planned` | 注册状态与执行终态不一致，恢复者误判队列 | 按治理 skill 翻转为 `reference`/`completed` 并同步入口行 |
| M-61 | P2 | `scripts/docs-governance.mjs:267-336` 只判 schema/path/kind/status/入口直链，**不判内容语义滞后** | 过期文档仍能绿 | 增「front-matter 声明状态 vs 阶段包终态」对账门 |
| M-62 | P2 | 541 份顶层 md、`docs/README.md` 206KB 结构错乱（M-25）；`docs/post-h9-2026-11-10-final-report.md:65` 136 归档候选零归档 | 入口不可用、历史债堆积 | 按月滚动 + 分批归档（工作区有 WIP 时只列不动） |
| M-63 | P2 | 4 套 gap-ledger 分载未闭合项：L7 93 条（done 64 / done-partial 19 / U 2 / retain 5 / 人眼 1 / external 2）、H7 34 条（15 done-partial + 12 retain）、K7 32 条（9 done-partial + 5 deferred + 3 U）、UI D5 32 条（8 done-partial + 7 U + 2 人眼 + 4 external + 5 retain）；L7 `_about` 自称 90 条但 statuses 相加 93 | **无单一「当前剩余工作」视图**，计数不一致 | 汇总只读视图（不搬移、不改原文），逐件保留原 owner |
| M-64 | P2 | `docs/AUDIT-LOG.md` 头部 8 条「最后更新」链 + 多份 `audit-log-compact-2026-11-11.r*.md` 归档残件；`docs/README.md:107` 与 `docs/Petri-Desktop-Evaluation-Report-2026-11-05.md:94,197` 的 perf 结论互相矛盾 | 结论不可复算 | 数字口径单源 JSON；矛盾声明降级并修入口 |

### 2.11 依赖与架构合理性（M-65～M-70）

| ID | 级别 | 现象与证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| M-65 | P2·U | 根 `package.json:284` `typescript ^5.9.3` vs `frontend/package.json:71` `^5.5.4`；`docs/block-411…:45` 列为 U 类「只读检出，不擅自升级」 | 双版本类型面漂移 | **不改默认**，出升级评审材料（changelog + lockfile diff + 前后同套定向测试） |
| M-66 | P2 | 根 `package.json` 无 `workspaces`，靠 `postinstall: node scripts/install-core-deps.mjs` 装 core 依赖；`archiver` / `better-sqlite3` / `uuid` / `pdfjs-dist` / react 族 / typescript 在根与子包重复声明 | 非标准 monorepo，依赖树不可控 | 评估 workspaces 迁移（需用户裁决，零新增依赖前提下） |
| M-67 | P2 | `docs/block-105-code-quality-governance-plan.md:61` 已知漏洞 root 20 + frontend 12、`extract-zip` high 无修复路径；`docs/block-411…:42` CVE 联网扫描 `external-blocked`；`knip.json:30-37` 6 依赖永不判 unused | 风险面不可见 | 本地静态清单 + 出网授权后 `npm audit --omit=dev`（V 类） |
| M-68 | P2 | `.dependency-cruiser.cjs:35-40` R3 唯一登记桥 `src/main/env-coordinator.js`；`src/migration-runner.js:33` 另有不经 `resolveCore` 的第二路径；`core/petri-server` 417 个 js 中大量懒 require | 静态图与运行期不一致 | 登记制 pathNot + 动态入口静态注册 |
| M-69 | P2 | 12 个存量循环依赖（M-17）；`acceptance/post-s7-2026-11-10/h10/cycle-clusters.json:11` 明写「消亡需抽 runAgentLoop 或依赖注入」 | 核心循环难以独立测试/替换，直接阻碍 M1/M2 | 与 M1 状态机抽取同批设计 |
| M-70 | P2 | 115 工具 / 168 通道 / 283 路由由三套生成器分别产出（`scripts/functional-surface-audit.mjs`、`scripts/block357-capability-map.mjs`、`scripts/validate-ipc-catalog.mjs`）；`docs/ipc-catalog.md` 已滞后（M-21） | 三矩阵互相不校验，口径易漂 | 共用单一 surface schema + 跨矩阵对账门 |

---

## §3 通用智能体能力现状与 `reference/ZCode` 长任务对标（本轮重点）

### 3.1 Petri 现状（按产品五维）

| 维 | 已有实现 | 深度判据 |
| --- | --- | --- |
| 编排 | 事件驱动 + 水位续传 + 轻量队列 + 血缘 ledger + subagent | `agent-task-store.js:273-280,402-408`（`task_events` seq + `afterSeq` 回放）；`:569-573` 明写「总线只是尽快知道，兜底仍走 2s 水位轮询」；`routes/ai-agent/events.js:28` 断线重连；`db/schema.js:89,110-126,174-181` loop ledger / state snapshot；`helpers/runtime.js:19-23` 并发 8/5/4；`spawn-agent-tools.js:56-60,250-266,399-467` 子 agent（默认深度 1） |
| 知识 | FTS5 + 向量 RRF 混合检索、user facts、chat summary、会话 compaction | `helpers/knowledge-space.js:3-10,28-45,123-163`；`helpers/memory-vectors.js:24-41,93-131` 暴力 cosine；知识空间默认 `enabled=0`（`src/migrations/009_knowledge_space.sql:19-31`） |
| 工具 | 115 工具 / 16 域、MCP 单入口、schema 校验、动态审批、结果截断 | `mcp/registry.js:8-9,548-575,875-880,965-968`；`agent-tools/registry.js:508-573`；`agent-tool-policy.js:271-317,347-409`；`tool-execution.js:10-14,92-105,382-449`（MODEL_RESULT_LIMIT 6000） |
| 模型计量 | token_budget 事件、ai_usage 账本、成本上限软提示 | `agent-runner.js:638-685`；`helpers/ai-usage.js:23-29,236-246`（价格表硬编码 + fixed fallback）；`loop-orchestrator.js:749-764` 超限只 push system 提示 |
| 可靠性 | SSE 重连 + 终态回放、服务重启清扫、断点式 resume、重试/取消、guard-ack | `conversationRunStore.ts:669-683,753-816`；`copilotClient/agentTaskStream.ts:40-47,140-173,299-357`（无最大重连次数）；`routes/ai-agent/resume.js:10-19,159-170,188-203`；`server.js:163-178`「can't safely resume mid-session」 |

**已有长任务正面证据**：`docs/ui-productization-audit.md:1334` 记录真实流程连续运行 134 秒、越过计划/QC/失败诊断/脚本修复/重跑直至 22 个产物；`t7-long-haul` 49 工具调用 / 20 FACT。**但这两条是单次观测，不是可复现的稳定性基线**。

### 3.2 ZCode 长任务机制解剖（全部位于 `reference/ZCode/apps/zcode-cli` 本地单进程）

| # | 机制 | 关键证据 |
| --- | --- | --- |
| 1 | `while(true)` 主循环 + **显式 TurnMachine 11 态转移表** + 单点 `AbortSignal` 检查点 | `packages/core/src/runtime/methods/turn-loop.ts:67-72,144-167,252-266`；`agent/turn-state.ts:27-38,233-265`；`agent/turn-machine.ts:92-104,308-339`；`docs/design/v2/turn-cancellation.md:13-23,55-76` |
| 2 | 无步数硬上限，但边界族完整：compact / 权限拒绝 / 工具超时 / 输出截断 / provider retry 上限 / 用户 cancel | `apps/zcode-cli/AGENTS.md:12`；`docs/design/v2/loop/tool-calling-loop.md:3`；`adapters/src/model/runner-retry.ts:15-18,41-63`；`failure-classifier.ts:82-100` |
| 3 | `/expert` **durable 长任务工作流**：8 阶段 DAG、状态持久化到 `~/.zcode/cli/workflows/runs/<runId>/`、每节点转移后落盘、连续错误阈值暂停 | `workflow/definition.ts:11-30,32-122`（maxConcurrentLoops 2 / maxConsecutiveErrors 3 / maxPlannerRuns 10 / reactLoop.maxRounds 30）；`workflow/scheduler.ts:65-71,94-146`；`docs/design/v2/expert-workflow.md:5,31-42,122` |
| 4 | **append-only transcript + hydrate 式崩溃续跑**：不存运行时状态，重启后从 message/part 重建，把半截 tool part 合成 interrupted result 消除 dangling tool call；resume 带 `interruptedToolCount / resumedTodoCount / resumedTarget` | `docs/design/v2/session-persistence.md:37-58`；`agent/session-history-hydrator.ts:328-387`；`runtime/methods/resume.ts:81-94,115-125,163-194,222-258,293-305` |
| 5 | 双层压缩：microcompact → auto compact；阈值 `ctxWindow − outputReserve(21k) − buffer(13k)`；**provider usage 为权威** + 本地估算兜底；连续失败熔断 + 压缩后快速回填熔断 | `compact/policy.ts:6-14,67-88,90-157`；`runtime/methods/compact.ts:185-217,233-247`；`turn-loop-state.ts:24-25,181-195` |
| 6 | **压缩后任务状态恢复契约**：summary 强制含「当前进度 / 下一步 / 未完成 todo / 已发生错误与修复 / 环境权限模式」；恢复 plan 文件引用 + 重读 5 文件（50k token 上限） | `docs/design/v2/compact/README.md:29-39,80-91`；`runtime/methods/compact-active.ts:526-540,622-666`；`runtime/helpers/compact-post-reminders.ts:27-29,68-95` |
| 7 | **工具能力元数据驱动一切**：`readOnly/destructive/concurrentSafe/sideEffectScope/timeoutMs/maxOutputBytes/needsApproval` 一处声明，供拓扑并行调度（默认并发 10）、权限判定、结果落盘 artifact + 2000 字预览、错误结构化投影 | `tool/types.ts:75-111`；`tool/registry.ts:30-70,104-125`；`tool/scheduler.ts:48,60-152`；`tool/executor/batch-runner.ts:24-96`；`tool/result-persistence-format.ts:3-7,46-86`；`tool/executor/errors.ts:10-75` |
| 8 | PermissionBroker fail-closed（无 broker 即 deny）+ hook 竞速单一 settled 闩 + 可恢复拒绝（拒绝反馈原样转 steer） | `permission/broker.ts:24-39,41-167`；`docs/design/v2/permission-broker.md:44-61,100-117`；`permission-responder-race.md:40-47,66-78` |
| 9 | 实例级 RuntimeCommandQueue（now/next/later + 单 drain gate）+ `commandId/baseRevision CAS/ACK duplicate|stale|noop` 幂等；后台任务 `<task-notification>` 唤醒主会话 | `docs/design/v2/loop/runtime-command-queue-plan.md:5-7,34-39,83-100`；`docs/zcode-protocol.md:54-57,75,89-95` |
| 10 | 会话级 goal + **独立 no-tool verifier** + 后台任务全部 settle 后才允许判完成 | `docs/design/v2/session-target.md:5,48-63,75,93`；`goal-background-task-notification-plan.md:5,24-26` |
| 11 | traceId 贯穿父子/后台/重试（OpenTelemetry SpanWriter）+ `model_usage/turn_usage/tool_usage` 三表无限保留 | `apps/zcode-cli/AGENTS.md:69-76`；`packages/telemetry/src/agent-trace-runtime.ts:3-45`；`docs/design/v2/usage-observability.md:16-24,53-77` |
| 12 | **长任务 fixture**：`.agents/skills/zcode-large-task-fixture` 向两个本地 SQLite 注入 `--turns 3000` ≈ 6000 messages / 20000 parts，覆盖 todo/tool 状态/patch/compaction/subtask/retry/usage | `SKILL.md:9-14,22-24,41-67`；`scripts/generate-large-task-fixture.mjs:10-12,30,89-124`；`e2e/compact-microcompact/README.md:5-18` |

**反面教材（最有价值）**：`docs/ZCode 项目架构分析与改进建议.md:131-226` 记近 90 天 **fix commit 2236（55%）**、热点文件 fix 几乎 100% 在 7 天内再被 fix；根因 = 状态多副本（模型选择 6 个来源 / 69 文件持有 selectedModel）、隐式事件状态机（27 种 UI 事件无状态表）、CI 门禁空心化（`when: never`）、错误吞噬（约 720 个 catch）。对应 `reference/ZCode/AGENTS.md:43` 的硬约束：「唯一所有者、接口、依赖方向、事件顺序与幂等边界，不能用超时掩盖同步问题」。

### 3.3 差距矩阵（Petri ↔ ZCode）

| # | 能力 | Petri | ZCode | 差距性质 | 对长任务的影响 | 可移植性 |
| --- | --- | --- | --- | --- | --- | --- |
| G-01 | 主循环状态机 | `for(iter < Infinity && !aborted())` + 6 个闭包状态变量、loop decision 隐式 | 11 态 `TurnPhase` + `canTransitionTo` 转移表 + 非法转移抛错 | **缺显式状态机**（非「缺步数上限」——ZCode 同样无上限） | 暂停/取消/权限等待/完成缺少可断言的阶段语义，异常路径难复现 | 高（纯本地内核） |
| G-02 | 资源边界族 | 仅有重复工具调用熔断（3 次）、continuation 链 4 / token 65536、成本软提示、工具级 300s | compact 阈值/熔断 + 工具超时 + 输出预算 + provider retry 上限 + 取消一等结果 | **边界不完整**：成本/墙钟/输出预算未形成统一族，成本超限不 break | 模型绕圈时可持续消耗；无法自证「有界收敛」 | 高 |
| G-03 | 崩溃续跑 | `resume.js:159-170` 用原 `messages` + `task_events` 摘要合成新 user 指令，新建 task 重跑；`server.js:169-178` 明写不能原位恢复 | append-only message/part + hydrate + 合成 interrupted tool result + 恢复 todo/target/permission | **粒度差一档**：Petri 是「读摘要继续」，ZCode 是「精确重建 transcript」 | 几十轮后崩溃易重复已完成步骤、漏中间产物、dangling tool call | 高（ZCode 自己也没有运行时 checkpoint，两边都要补） |
| G-04 | Durable 任务图 | goal 状态机 + 持久化 plan steps + 临时 todo + subagent（默认深度 1）+ loop ledger（血缘记录） | `/expert` 8 阶段 DAG、每节点转移持久化、连续错误暂停、maxPlannerRuns | **缺编排层**：ledger 是记录不是调度器 | 多阶段长任务无「阶段完成→派发→失败重试→暂停」的系统保证 | 高 |
| G-05 | 压缩权威源与恢复契约 | rolling compaction（DB 原文不删）+ microcompact 占位符 + auto 摘要；阈值 0.85×ctxWindow，本地估算 | provider `usage` 为最高优先级 + 21k/13k 公式 + 双熔断 + summary 强制含进度/下一步/todo/错误 + 重读文件 | **缺权威源与状态恢复**：压缩后任务状态靠模型记忆 | 长任务越跑越易丢失早期目标/参数/失败诊断 | 高 |
| G-06 | 工具元数据驱动 | 四表分载（tool-defs/registry/tool-metadata/contracts）、`needsApproval` 零生产读取者、MODEL_RESULT_LIMIT 6000 硬编码 | 一处 `ToolMetadata` 驱动并行调度/权限/结果落盘/错误投影 | **声明与消费断链** | 长任务工具调用多，串行 + 结果截断策略不一致，吞吐与可审计性受限 | 高 |
| G-07 | 权限模型 | 用户规则 + 动态策略 + guard-ack（**任务内内存态**，跨会话不持久） | fail-closed broker + hook 竞速闩 + 可恢复拒绝 + session 级 grant | **缺 fail-closed 默认与竞速收口** | 长任务跨恢复后审批状态丢失，无人值守易卡死或降级 | 高 |
| G-08 | 幂等与命令队列 | `task_events` 无 `UNIQUE(task_id,seq)`、事件总线明确「不是投递保证」、2s 水位轮询 | `commandId + baseRevision CAS` + ACK duplicate/stale/noop + 单 drain gate | **缺幂等边界** | 重连/重放可能重复事件，长任务 UI 与后端状态漂移 | 高 |
| G-09 | 目标完成验证 | 完成由模型 final answer / loop decision / 取消决定 | 会话级 goal + 独立 no-tool verifier + 后台全部 settle 才判完成 | **人设未闭合**（M-06） | 假完成、目标漂移、「计划做完但产物未成」 | 高（spec 强、实现部分为计划文档，需自己落地） |
| G-10 | 可观测 | trace 内存 200 条 / 15min TTL、ai_usage 单表 + 硬编码价格、token_budget 事件 | OTel SpanWriter + traceId 贯穿 + 三表无限保留 | **不可回溯长任务全程** | 出事后无法重建几十轮的决策链与成本 | 高 |
| G-11 | 评测装置 | 719 Node + 362 前端测试、evals 短任务、`t7-long-haul` 单次观测、真实任务 0/8 external-blocked | 3000 轮合成 fixture + real-model compact e2e + memory bench | **无长任务压力/回归基线** | 任何「长任务已支持」的声明都不可自证 | 高 |
| G-12 | 不可信内容边界 | 系统提示无 untrusted 条款、网页/工具输出无包装 | 工具结果预算 + 结构化投影 + 权限门 | 两侧都不完备，但 Petri 与 M-36 串成 RCE 链 | 注入可改写长任务工具决策 | 高 |

### 3.4 关键判断（避免误判）

1. **「没有 maxTurns」不是差距**。`MAX_AGENT_ITERS=Infinity` 是 Petri 的产品契约（`agent-loop-control.js:9`「goal-terminated, not round-terminated」），ZCode `apps/zcode-cli/AGENTS.md:12` 明确持同一设计。真正差距是 **ZCode 用一整套替代边界把「无界」变成「有界收敛」，Petri 的边界族偏薄且相互不联动**（G-02）。因此 M1 的目标是「补边界族与状态机」，**不是**给主循环加步数硬上限（那会撤销既有产品裁决）。
2. **「checkpoint」两边都没有**。ZCode `docs/design/v2/session-persistence.md:37` 明写不做 operation journal / checkpoint 表，其 `CheckpointCreated` 只服务工作区文件快照与 rewind。Petri 的 `context_checkpoints`（`db/schema.js:68-83`）只存结构化投影、`loop-checkpoint.js:14-17` 把恢复编排列为集成层职责。**这是可超越对标的点**：Petri 已有 loop ledger / state snapshots / task_events 三套持久化材料，具备做「真·运行时 checkpoint」的基础，不必照抄 hydrate 方案。
3. **ZCode 长任务智能全部在本地 CLI，可移植度高**（G-01～G-11 的证据集中在 `apps/zcode-cli/packages/core|adapters|telemetry`，不依赖云端即可成立）。**不可照搬 3 类**：①外部 Relay / 账号 JWT / OSS 多版本发布 / continuous-replayable 双投递（`docs/web-remote-control/web-remote-control-architecture.md:64-103`）；②Electron Main + Window Host + RemoteConnectionRegistry + workspaceKey lease 的多进程树（源于多窗口 + 手机远控，Petri 只需保留「CLI 单一真相源 + command inbox 串行 admission」这一内核结论）；③官方 provider 网关 / 订阅计费 / CDN 市场 / 第三方 IM Bots（`official-coding-plan-gateway.ts:8-11`、`streaming-recovery.ts:16-20`）。
4. **Petri 的差异化必须保留**：本地主权、全链可审计、证据自证、动态审批与用户规则、artifact/血缘，是 ZCode 云端链路不具备的形态优势。对标只借「形」（状态机、任务图、元数据、fixture），落点必须长成「本地可审计」的形态——每个新增机制都要带事件可重放、成本可计量、审批可追溯。

### 3.5 改进方向总纲（8 条）

| # | 方向 | 对应差距 | 阶段 |
| --- | --- | --- | --- |
| D-1 | 显式 Turn 状态机 + 单点取消/暂停/权限等待阶段（不新增步数硬上限） | G-01 | M1 |
| D-2 | 统一资源边界族：provider usage 权威、compact 双熔断、工具超时/输出预算、成本超限可配置硬收尾 | G-02/G-05 | M1/M3 |
| D-3 | goal verifier 独立验收 + 后台 settle defer，把「以目标为输入」闭合进终止判据 | G-09 | M1 |
| D-4 | append-only transcript + 中断 tool result 合成 + 运行时 checkpoint（利用已有 loop ledger） | G-03 | M2 |
| D-5 | durable 任务图编排：阶段 DAG、每节点落盘、连续错误暂停、可恢复重派 | G-04 | M2 |
| D-6 | 工具能力元数据单源 → 并行调度 / 权限 / 结果预算 / 错误投影四处消费；fail-closed 审批与可恢复拒绝 | G-06/G-07 | M3 |
| D-7 | 本地长任务 fixture（≥1000 轮合成）+ 成功率/完成度/跨恢复一致性基线 + evals 入 closeout | G-11 | M4 |
| D-8 | traceId 全链 + usage 三表 + commandId/CAS 幂等 + 不可信内容 `untrusted` 包装 | G-08/G-10/G-12 | M3/M4 |

---

## §4 M 波次蓝图（M0–M7）

> 通用约定：**单工作包串行**；每阶段发令时按 `$petri-project-governance` 分配 BLOCK 编号并注册 work-package；本蓝图是 `candidate`，不占串行槽位。优先级 P0=程序前置 / P1=主线 / P2=工程债。所有阶段：零新增依赖、红绿先行（HK-01）、定向测试、`closeout` 收口、六件套 canonical 回写。**U/E/V/W 四类不代答**（见 §6.3）。

### M0 · 判据校准与可信起点（P0 · 全程序前置）

| 改进点 | 映射 | 验收标准 | 复跑命令 |
| --- | --- | --- | --- |
| M0-1 解 `quality:lint` 2 红（W 类归属登记 + owner 收口，不代改在制文件）；建 warnings 分域只减棘轮 | M-14 | 干净树上 lint 0 error；棘轮植入新 warning 必红负测 3/3 | `npm run quality:lint` |
| M0-2 解 `quality:perf` 红轮：先核 `coreSha` 基线绑定与 `packaged_start` 采样口径，再按证据流程重锚 or 修实现；**禁止直接抬阈值/放宽容差** | M-08/M-11 | 连续 5 次采样 PASS 且读数落 `acceptance/`；植入慢样本必红 | `npm run quality:perf` |
| M0-3 数值口径单源：perf 矛盾结论降级 + registry/impact-map/closeout 门数现读取数 | M-26/M-64 | 单一 JSON 真源；`docs/README.md` 只引单源；门数对账 0 冲突 | `npm run docs:check` |
| M0-4 翻转两份已完成蓝图的 registry status，加 front-matter 状态对账门 | M-60/M-61 | 植入「阶段包 completed 而蓝图 planned」必红负测；`docs:check` PASS | `npm run docs:check && npm run docs:reconcile` |
| M0-5 汇总 4 套 gap-ledger 为只读剩余工作视图（不搬移原文）+ 修正 L7 90/93 计数 | M-63 | 逐件保留 owner/终态；零 in_progress；计数可复算 | `node scripts/...`（本阶段新建） |
| M0-6 当次 14 门全量复取样，未取数项如实标注 | — | 14 门读数表，红项有归因，不写全绿 | §0.2 命令集 |

**出口**：`closeout` 定向全绿（W 类红如实标注）、14 门读数可复算、零产品行为变化、零基线放宽。

### M1 · 长任务内核：状态机 · 边界族 · 目标验证（P0 · 本轮主线）

| 改进点 | 映射 | 验收标准 |
| --- | --- | --- |
| M1-1 抽 `TurnMachine`（Idle→AwaitingModel→Streaming→SchedulingTools→ExecutingTools→Aggregating→AwaitingPermission→Completing/Error/Cancelled），非法转移 fail-closed；借 M-69 依赖注入顺带打断核心环 | G-01/M-69 | 状态枚举 + 转移表 + 每边界 `throwIfAborted` 单测 ≥20 例；植入非法转移必红；`gate:arch-cycles` 环数只减 |
| M1-2 统一资源边界族：provider usage 权威 token 源、compact 双熔断（连续失败 / 压缩后快速回填）、工具超时/输出预算单源、成本超限可配置硬收尾（默认保持软提示，**不改用户裁决**） | G-02/M-06 | 预算常量单入口；4 类越界各有红绿先行测试；`cost_cap_exceeded` 事件链不丢 |
| M1-3 goal verifier：独立 no-tool 校验（产物/证据存在性 + todo 全终态 + 后台任务全部 settle），状态机驱动终止 | G-09/M-06 | 「模型自报完成但无产物」必红用例；`agent_goals.status` 与 loop 终态对账门 |
| M1-4 取消/暂停成为一等结果：稳定 `turn_cancelled` 类型、每 model/tool 边界检查点、暂停只在迭代边界生效的语义显式化 | G-01 | 取消注入三态（model 中/工具中/权限等待）行为测试 + SSE 终态对账 |
| M1-5 主循环行为测试基座：可注入 provider 的 loop 执行（替代 M-54 的「只断言 async function」） | M-54 | 真实跑 ≥30 轮 mock loop，断言状态轨迹与终态；挂 impact-map rule |

**出口**：`npm run closeout` + 新增 `gate:long-task-kernel`（状态机/边界/verifier 三类负测全绿）；`MAX_AGENT_ITERS` 语义保持 `Infinity` 不变（产品契约）；零新增依赖。

### M2 · 长任务可靠性：续跑 · 任务图 · 幂等（P0）

| 改进点 | 映射 | 验收标准 |
| --- | --- | --- |
| M2-1 append-only transcript：统一 message/part 落盘，恢复时从已落盘记录 hydrate，把 pending/running tool call 合成 interrupted result 消除 dangling tool call | G-03 | 崩溃注入（第 N 轮 kill）→ 重启 resume → 工具调用数/消息序列逐字对齐；`interruptedToolCount` 可观测 |
| M2-2 运行时 checkpoint：复用 `loop_iterations` / `loop_state_snapshots` / `task_events`，存 `messages` 视图 hash + 工具控制器状态，实现**超越 ZCode 的原位恢复**（保留 hydrate 作降级路径） | G-03/M-07 | checkpoint 写/读/校验三段单测；损坏 checkpoint 不静默吞错；恢复后 todo/plan/permission 一致 |
| M2-3 durable 任务图编排：阶段 DAG 定义 + 每节点状态转移落盘 + `maxConsecutiveErrors` 暂停 + 失败节点重派；与 `goal` 状态机单一 owner | G-04/M-07 | 8 阶段样例任务跑通；kill/resume 后节点状态不回退；连续错误阈值负测 |
| M2-4 幂等边界：`task_events` 加 `UNIQUE(task_id, seq)` + `commandId` CAS + ACK duplicate/stale/noop；事件总线仍只作「尽快知道」 | G-08 | 重放/重复投递不产生重复副作用；水位续传 2s 兜底不变；`routes/ai-agent/events.js` afterSeq 契约绿 |
| M2-5 取消跨后端单一 owner + 后台进程启动对账（内存进程表 → 持久化租约） | M-52 | 取消在 owner 进程 15s 内生效；重启后孤儿进程可识别 |

**出口**：崩溃恢复端到端 flow（dev-verify，9223 离屏，跑完立即 kill）+ `gate:long-task-resume` 连续 3 轮 PASS；不改 `server.js` 既有 recovery 语义以外的默认值。

### M3 · 上下文与工具能力面（P1）

| 改进点 | 映射 | 验收标准 |
| --- | --- | --- |
| M3-1 compact 恢复契约：summary 模板强制含「当前进度/下一步/未完成 todo/已发生错误与修复/环境权限模式」，压缩后重读关键文件（有界 5 文件 / 50k token） | G-05 | 压缩前后「下一步动作」一致性判定测试；缺字段必红 |
| M3-2 工具能力元数据单源：一份声明产出 `TOOL_DEFS`/`CONTRACTS`/`TOOL_METADATA`/调度元数据四视图，消除 115/114/71 计数漂移 | G-06/M-27/M-70 | 跨表锚 `CONTRACTS⊆TOOL_METADATA` 门；新增 1 工具改动处由 7 → 1 |
| M3-3 声明驱动并行调度：`readOnly/concurrentSafe/sideEffectScope` 参与拓扑分组、组内并行（默认并发上限可配），`stopTurnAfterResult` 给剩余工具补合成取消结果 | G-06 | 拓扑排序 + 环检测单测；并行组行为测试；无 dangling tool call |
| M3-4 结果预算统一：超预算落本地 artifact 只回预览（保头尾截断），错误结构化投影（模型可见原文 vs UI 摘要分离） | G-06/M-19 | 大输出不进模型上下文；artifact 路径可审计；`MODEL_RESULT_LIMIT` 不再是唯一硬编码 |
| M3-5 权限 fail-closed + 竞速闩 + 可恢复拒绝：无审批通道即 deny；hook 与 broker 并发竞速单一 settled、败者 abort；拒绝反馈原样转 steer；ack 跨恢复持久化 | G-07/M-01/M-36 | 无 broker deny 负测；竞速植入双响应必红；guard-ack 跨 resume 不丢 |
| M3-6 不可信内容边界：系统提示加条款，web_fetch/文件读取/MCP 输出统一 `untrusted` 包装与来源标注 | G-12/M-39 | 注入文本不触发工具决策的负测；包装不破坏现有 schema |

**出口**：`gate:tool-capability` 全绿；`quality:surface` 矩阵重生成后 P1/P2=0 且计数单源；`needsApproval` 生产读取者 >0。

### M4 · 评测与可观测（P1）

| 改进点 | 映射 | 验收标准 |
| --- | --- | --- |
| M4-1 本地长任务 fixture：向本地 SQLite 注入 ≥1000 轮合成任务（todo/tool part/compaction/subtask/retry/usage），提供生成/校验/删除三命令与 manifest | G-11/M-57 | fixture 生成可复现（manifest 计数对账）；零出网、零真实 Provider |
| M4-2 长任务成功率/完成度/跨恢复一致性基线 + evals mock/replay 档接入 closeout（real 档保持 external-blocked，不外推） | G-11/M-57/M-58 | `evals:gate` 有长任务判据；基线回归即红；`closeout` 可见该门 |
| M4-3 traceId 贯穿主 loop / subagent / 后台 / 重试 / 工具；`tool-trace-store` 从内存 200 条 TTL 扩为可持久化投影（保留内存快查） | G-10 | 单任务全链 trace 可重建；跨重启可查；不改现有 SSE 事件形状 |
| M4-4 usage 事实表：model/turn/tool 三层 + 价格表落配置（去掉硬编码 fallback）+ `model_request_failed` 也记账 | G-10 | 长任务成本可对账到轮次；计量在 compact 前完成 |
| M4-5 用户可感性能常驻门：DOM 节点上限、滚动帧率 P50/P95、首屏 paint、导出耗时；长列表窗口化（零新依赖） | M-09/M-10 | CDP 六视口断言；植入 400+ 节点必红；`quality:perf` 场景由 4 → ≥7 |
| M4-6 SSE 真实端点行为测试 + 挂 impact-map rule；约 90 个未引用测试分批挂载 | M-55/M-56 | 改生产 SSE 代码 `test:changed` 必触发；覆盖率只减棘轮 |

**出口**：`npm run evals:gate` 长任务档绿 + `quality:perf` 扩展场景 5/5 + `gate:long-task-observability` 全绿；真实 Provider 类证据仍标 external-blocked（G0 不外推）。

### M5 · 安全与正确性纵深（P0/P1）

| 改进点 | 映射 | 验收标准 |
| --- | --- | --- |
| M5-1 全局挂 `requireTrustedDesktopOrigin` + MCP 写面 command 白名单/会话 token | M-32 | 伪造 Origin / 无 token 写 MCP 必 403 负测；autoConnect 链不绕过 |
| M5-2 空 Origin 全方法 token 校验 + per-boot 随机 token 无条件生成 + 废弃 `Bearer desktop-local` 常量 | M-33 | GET/POST 无 token 均拒；内部调用方全带 token；回归 6/6 |
| M5-3 `file:start-drag` localPath 登记根 + realpath 边界；name `path.basename` + 目标根前缀断言；补内容长度上限 | M-34 | SSH key 路径 / `../` 穿越植入必红 |
| M5-4 权限降级覆盖所有 session（含 `persist:petri-browser`）+ `session-created` 钩子；帧导航 allowlist + CSP `unsafe-inline` 收敛（dev retain 需留因） | M-35/M-39 | 装配失败注入后 guest 权限仍 deny-all；三处 openExternal 统一 sanitizer |
| M5-5 tar 解压参数加固 + 条目校验；zip 失败 try/finally 清 destDir | M-38 | `../`/绝对路径/符号链接条目必红；无半截目录残留 |
| M5-6 假成功治理：DDL 静默 / 异常→`{}` / 全 0 统计改具名 reasonCode；MCP uncaughtException 退出 + 主进程全局 handler；统一 IPC 失败信封 | M-47/M-48/M-53 | 注入失败必得 `ok:false + code`；42→55 原因码词表门仍绿 |
| M5-7 `quality:secret` 改文件系统遍历 + git 错误 fail-closed + 补 token 模式；日志脱敏 | M-40/M-19 | 植入假密钥必红；模拟 git 故障门 FAIL（不静默 PASS） |
| M5-8 上限常量收编 + limit/offset 断言 + 原子写入（tmp+rename）+ 下载失败清理 | M-12/M-50/M-51 | 并发写 10 次无覆盖；200MB body 被拒；半截文件零残留 |

**出口**：安全负测全套绿、`quality:secret`/`quality:arch` 绿、**不改 `workspace_exec` 默认放行裁决**（M-36 仅补补偿控制与风险声明）。

### M6 · 工程债务与体验（P2）

分组推进，每组一个会话、拆前拆后同套定向测试绿：

| 组 | 改进点 | 映射 | 验收标准 |
| --- | --- | --- | --- |
| M6-A 结构单源 | IPC 三真相收敛、28 文件绕桥迁移、resolveDataDir/readConfig 单源、12 环逐环消亡、三矩阵共用 schema | M-17/M-21/M-22/M-23/M-70 | `quality:arch` / `arch-cycles` / `code-size` 三门绿；环数只减 |
| M6-B 巨型文件 | W5b 逐刀拆 `SimpleChat` / `tools-executor` / `project-workspace` / `scene3d`；每刀 ≤−100 行 | M-15 | 每刀拆前拆后同套绿；`code-size` 锚点下降后重打（非放宽） |
| M6-C 静默与日志 | 412 静默 catch 扩口径 + 分域下降表；console 分级 + 渲染层脱敏 | M-16/M-19 | `gate:silent-catch` 基线只减；warnings 不增 |
| M6-D 体验 | focus-visible 12 文件 / 16 声明清零、断点消费面统一、设置页剩余分区、对比度观感路线 | M-24/M-41/M-43/M-44 | `gate:ui-a11y` 9/9；22 条人眼路线自动生成、签字槽保持空 |
| M6-E 功能可用 | 165 通道逐件分诊、`browser_act`/worktree_remove/默认执行目标、P3 存储键、capability-map evidence-tier | M-01～M-05 | `quality:surface` 双列（结构 + 行为）判定；P3 归零 |
| M6-F 文档与依赖 | docs/README 分类导航、4 套 ledger 视图落地、Skill 清单统一、workspaces 评估材料、typescript U 类材料 | M-25/M-29/M-60～M-67 | `docs:check` / `skills:check` 绿；U 类材料状态 pending_user_ruling |

### M7 · 总收口与证据（P2）

1. 70 条发现 + G-01～G-12 差距逐件终态（done / done-partial / retain-with-reason / pending_human_eye / external-blocked / pending_user_ruling），零 in_progress、零编造计数。
2. 干净树 `closeout:full` 连续 3 次全门 PASS 0 SKIP；`gate:post-h9-contracts` 全绿；`docs:reconcile` 0 validation issues。
3. 十一维第八列复评（逐维升/平/降 + 归因 + 当前源码锚点），不回溯改第七列。
4. 长任务能力自证包：fixture manifest + 成功率基线 + 崩溃恢复 flow 证据 + trace/usage 对账 + 负面边界（不宣称「稳定完成长任务」除非有当次证据）。
5. 六件套 canonical 同批回写；AUDIT-LOG 登记；本蓝图状态由 `candidate` 转 `completed`（需用户发令后的正式注册流程）。

---

## §5 优先级矩阵与发令顺序

| 序 | 阶段 | 优先级 | 依赖 | 体量 | 关键 blocker |
| --- | --- | --- | --- | --- | --- |
| 1 | M0 | P0 | — | 小（判据/文档批） | W 类在制 WIP（lint 2 errors）；perf 基线绑定 |
| 2 | M1 | P0 | M0 | 大（内核） | 核心循环 12 环；不改 `Infinity` 产品契约 |
| 3 | M2 | P0 | M1 | 大（内核） | 崩溃恢复需 9223 离屏实机 |
| 4 | M3 | P1 | M1 | 中 | 工具四表改造面广，需拆前拆后基线 |
| 5 | M4 | P1 | M2, M3 | 中 | 真实 Provider 类证据 V 挂起（不外推） |
| 6 | M5 | P0/P1 | M0 | 中 | `workspace_exec` 默认放行是用户裁决，只补补偿控制 |
| 7 | M6 | P2 | M1–M5 | 大（多会话） | CSS/UI 在制 WIP owner 归属 |
| 8 | M7 | P2 | 全部 | 小 | 干净树 + P6 源绑定 owner 重采 |

> 安全 P1（M5）虽排第 6，但**可在 M0 之后按单点发令提前**，不违反单包串行（一次只一个 active）。

---

## §6 验收协议

### 6.1 每阶段固定循环（八步）

启动三步（`npm run state` + AUDIT-LOG 🔴/🟢 + `git --no-optional-locks status --porcelain` / `git diff --name-only HEAD`）→ `WORK-PACKAGE-LAUNCH-CHECKLIST` → 决策建议器到点即跑 → 判「补丁 vs 重构」 → 红绿先行 → 实现 + 定向验证 → `closeout` + 六维度评审 + 六件套回写 → NEXT-STEP-BRIEF 交付块。

### 6.2 证据五类不互冒充

行为/契约测试 · 机械门禁 · DOM/CDP 实机 · 人眼观感 · 真实任务成功。未跑/跳过/复用/在制 WIP 引起的红如实标注；`exit 124/125 = unknown` 不是成功。

### 6.3 U / E / V / W 四类边界（「无需用户参与」的合规解法）

| 类 | 项 | 处置 |
| --- | --- | --- |
| U 用户裁决 | ADMISSION observe→enforce、FK OFF/ON、`workspace_exec` 默认放行、typescript 双版本、虚拟列表是否引入依赖 | 出一页决策材料，状态 `pending_user_ruling`，不改默认语义 |
| E 人眼 | 22 条 + H-01～H-08、暗色/读屏/对比度观感 | 自动生成测试路线，保持 `pending_human_eye`，绝不写 verified |
| V 凭据/出网/平台 | 真实任务 0/8、CVE 联网、macOS TCC/packaged | `external-blocked` + 补腿条件；**G0 不外推** |
| W 在制 WIP | 89 M + 67 untracked（含 `docs/DOC-REGISTRY.json`、`*.module.css`、设置面板） | 零触碰、零 stage、零提交，登记 owner 归属 |

### 6.4 复跑命令

```
npm run state
git --no-optional-locks status --porcelain && git diff --name-only HEAD
npm run docs:check && npm run ui:audit:check
npm run gate:post-h9-contracts
npm run quality:lint && npm run quality:types && npm run quality:arch && npm run quality:secret
npm run gate:code-size && npm run gate:arch-cycles && npm run gate:silent-catch
npm run quality:knip:check && npm run quality:ear && npm run quality:perf
npm run test:changed:list && npm run test:changed
npm run evals:gate && npm run closeout        # 锚点存疑/全程序收口用 closeout:full
npm run docs:reconcile && npm run docs:check
npm run output:judge && npm run decision:session
```

---

## §7 与既有 canonical 的关系

- 不新建第二份当前状态真相：本文件 `candidate`，未注册 `DOC-REGISTRY.json`、不占串行槽位；正式发令后按治理 skill 注册 M 各阶段 work-package，并把本蓝图登记为 `living-plan`。
- 承接链：W0–W7 → S0–S7 → H0–H7 → K0–K7 → **L0–L7（BLOCK-404～411）** → UI-D0–D5（BLOCK-415～420）+ BLOCK-421～425 → **M0–M7（本蓝图）**。
- 已闭合、不再列为改进点：MCP 假成功、MCP 双 server、四 P1 注入（L-50～L-53）、SSE 终态、fork 事务化、COUNT 索引化、export 流式、resolveCore 四 mirror、主题门扩面、SimpleChat 第一刀等。
- `AGENTS.md` 的产品个性纪律、G0 阶段纪律、技术栈与门禁规范为唯一工程指令；本蓝图不新增第二套规范。
- **G0 开发期常态 · 不外推 packaged/Provider/GA。**
