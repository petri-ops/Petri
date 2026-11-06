---
capability: next-stage-optimization-blueprint-2026-11-06
status: planned
goal: 以全量评估为事实基线，在不扩展阶段边界、不新增依赖、不破坏通用 agent 身份的前提下，按波次把 Petri 优化成任务跑得完、错误看得见、证据可复跑、体验可信且结构可持续演进的本地通用 agent。
acceptance:
  - W0-W7 每波有目标、具体改进点、优先级、依赖和出口判据
  - 全部改进点锚定全量评估的发现台账或机械基线
  - 单工作包串行、红绿先行、零第二真相、零新增依赖、未知 WIP 原样保留
  - 本文件保持 planned，未把任何候选波次翻为 active
reopen: 用户逐波发令后按治理规范分配正式工作包编号并更新本蓝图状态
---

# 下一阶段优化蓝图（2026-11-06）

> 用户裁决依据：「全面评估项目的各个方面，我需要了解每一个细节，并据此建立一份蓝图，作为下一阶段的工作计划。不要设定工作量上限，核心目标就是优化项目、增强使用体验。」
> 形态：**planned 方向蓝图**，不是已启动的 active 工作包。每个 Wave 是候选工作包，按单工作包串行纪律逐波发令；正式 BLOCK/UI 编号在发令时按治理规范分配。
> 事实基线：[`Petri-Desktop-Holistic-Evaluation-2026-11-06.md`](./Petri-Desktop-Holistic-Evaluation-2026-11-06.md)。本报告不重写评估结论，只把发现转成分阶段目标、具体改进点、优先级、依赖与验收判据。

---

## §1 北极星与完成定义

### 1.1 一句话目标

把 Petri 从「能力面自洽、功能丰富」推进到 **「用户托付的长任务能跑完；每一步失败可解释；每次优化可由证据复核；界面在任何状态下都诚实、可达、可操作」**。

### 1.2 不变量

- **通用 agent 主线**：编排、知识、工具、模型计量、可靠性仍是核心；领域包按需放大，不把产品缩成生信工具或 3D 编辑器。
- **本地主权**：推理循环、工具、记忆、编排、证据都留在用户机器；可观测性优先落本地事件、SQLite、JSONL 与 acceptance。
- **可信与透明即能力**：审批、规则、ack、血缘、原因码、错误可见性是差异化能力，不是边角料。
- **证据自证**：行为测试、实机/DOM 几何、人眼观感、真实任务成功四类证据不得互相冒充。
- **零第二真相**：不新建第二 executor、Job、Artifact、Workflow、项目状态、UI truth、DB 连接源或插件源解析器。
- **用户裁决不回退**：`workspace_exec` 黑名单默认放行保持不变；只加强风险提示、审计、严格模式可发现性、per-call token 与其余执行准入边界。
- **零新增依赖**：默认复用 React 18、Vite、better-sqlite3、MCP SDK、dev-verify 和既有门禁；新增依赖须单独走治理检查单。
- **保护 WIP**：当前 22 个已跟踪修改 + 10 个未跟踪项只登记、不覆盖、不暂存、不清理，由其所有者决定提交或回退。
- **G0 开发期常态 · 不外推 packaged/Provider/GA**。

### 1.3 可量化总体出口

| 指标 | 当前 | 蓝图出口 |
| --- | --- | --- |
| 8 任务机械判据 | 两次 7/8、T6 波动 | 连续 3 次 8/8、0 干预、0 伪造判据、T7 无 windowOverride |
| `closeout` | 未在本轮跑；lint/code-size/perf 当前红 | 干净树连续 3 次 16 门 PASS |
| `quality:perf` | 三次 FAIL/PASS/FAIL | 连续 5 次 PASS，负测仍能判红 |
| `test:changed` | 1551 pass / 6 fail / 7 cancelled / 4 skipped | 0 fail / 0 cancelled；skip 均有显式原因 |
| `test:all:workspace` | SIGTERM，未完成 | 分片、有界、可复跑，全链完成且 0 fail |
| 工具/IPC/路由矩阵 | P1=0 / P2=0 / P3=2 | P1/P2=0，P3 逐件销号或显式 retain-with-reason |
| UI 台账 | 494 verified / 52 in_progress / 7 cancelled（标题计数） | 每条 in_progress 终态化；UI-694/695 实机观感确认 |
| EAR | 43.5% | ≥45%，且新增证据全部由负测守住 |
| 领域中性 / 工具数 / 模型面 / code-size 基线 | 多处红或漂移 | 基线由单源生成，新增即红，重打必须留因 |
| 安全边界 | sender guard / approval replay / DB close 有缺口 | 写 IPC、执行入口、DB 退出全部有机械契约 |
| 文档真相 | 488 注册、coverage 429 | coverage 自动一致；active 槽位与旧票逐件核销 |

> 这些是**蓝图出口判据**，不是当前已达成状态；任何 Wave 未完成都不得把总出口写成 completed/verified。

---

## §2a 执行进度（2026-11-06 收尾回写 · W7b）

| Wave | 状态 | 承载包 | 完成证据 |
| --- | --- | --- | --- |
| W0 | ✅ completed（带例外） | BLOCK-359 | 干净树 closeout:full 与 P6 源绑定重算移交为 W1 入口门（阻断=在制批处置待裁决） |
| W1 | ✅ completed（带例外） | BLOCK-365 | 用户 2026-11-06「行 … 把剩下没做的统一搞完」= 授权接收在制批；F-01/02/03/14/15/16 + 重试可观测已交付；task.failed 前端投影、真实 provider 长任务、P6 重算（待 UI-696）留 reopen |
| W2 | ✅ completed（带例外） | BLOCK-360 | W2-5（外部 MCP 主体档位未决）、W2-7（数据模型批）显式移交 |
| W3 | ⏸ deferred | 待立项 | 需改 UI 台账；并发写入者（模型偏好 UI，UI-696）11 项未提交，待其收口 |
| W4 | ✅ completed（带例外） | BLOCK-361 | 矩阵/货架/能力地图生成器化移交 W7b |
| W5 | 🔶 partial | BLOCK-364（W5a） | 死熔断删除+测试覆盖棘轮已交付；其余项落在制批文件 |
| W6 | 🔶 partial | BLOCK-363（W6a） | 进程组 teardown 已交付；并行挂起根因另批（串行默认已绕过） |
| W7 | 🔶 partial | BLOCK-362（W7a） | compact 脏目标守卫+coverage 校验已交付；W7b=本节回写+生成器同源+最终回写 |

**收尾顺序（用户令「统一搞完」，串行不并行）**：W1（接收在制批 → W0 出口兑现 → W1 主项）→ W5b 其余项（runLoop 拆分等，在制批落地后零阻塞）→ W2b 遗留（agent 主体 capability token；外部 MCP 主体保持现状待档位裁决 · 链哈希迁移+回填+校验器 · 后端 FK 证据门）→ W3（待并发写入者 UI-696 收口；仍未收口则先 W6b）→ W6b（并行挂起根因 · 请求体预算核对）→ W7b（生成器同源 · 证据元数据 · closeout 全门出结果 · 评估评分终评 · canonical 终回写）。遇五类停止条件只问一个问题。

程序级结论（如实）：「干净树 closeout 连续 3 次 16 门 PASS」「test:changed 0 fail/0 cancelled」两项程序级出口**未达成**——closeout 每轮 fail-fast 于 test:changed 门，红项均已逐件归因（在制批 model-surface/P6、C-46 p4r、并发写入者 UI 台账、存量 NEXT-03），无一为本程序引入；2026-11-06 收尾补跑 10 门（test:changed 之外全部），剩余红仅并发写入者两文件指纹（随其提交重打）。

## §2 波次总览

| Wave | 名称 | 优先级 | 核心目标 | 依赖 | 完成级别 |
| --- | --- | --- | --- | --- | --- |
| W0 | 事实冻结与门禁复绿 | **P0** | 分离 HEAD/WIP、修复质量门、建立可复跑全量测试 | 无 | 所有后续 Wave 的入口 |
| W1 | Agent 主链韧性与错误可见性 | **P0** | 流中故障、上下文预算、压缩/降级、SSE 收尾单源化 | W0 | 长任务可靠 |
| W2 | 安全准入、IPC 与数据真值 | **P0** | sender guard、capability token、DB/产物链、错误降级 | W0；与 W1 共享执行语义需串行 | 可信边界 |
| W3 | 用户体验可信化与可达性 | **P1** | viewer/能力位、错误态、a11y、隐藏层、长列表、实机观感 | W1/W2 的行为契约稳定 | 体验增强主波 |
| W4 | 扩展生态单源化 | **P1** | 插件源、工具元数据、MCP schema、health、证据生成 | W0；与 W2 的 registry 面串行 | 可扩展 |
| W5 | 架构去补丁与测试有效性 | **P1/P2** | `runLoop` 拆分、第二真相清理、行为测试替代源码扫描 | W1/W2/W4 完成契约抽取 | 长期可维护 |
| W6 | 性能与规模化体验 | **P2** | 低耗时门、增量压缩、DOM 预算、启动/文件树/长会话 | W1/W3/W5 | 持续顺畅 |
| W7 | 治理台账与证据运营 | **P2** | 文档计数、账本自稳、能力地图/货架/UI 台账生成器化 | 全波增量；每 Wave 同步少量回写 | 可恢复、可审计 |

**执行纪律**：Wave 内可分多个正式工作包，但同一时间只有一个 active 工作包与一个进行中阶段；每包必须有独立 plan、registry、AUDIT-LOG 启动/收口行、acceptance 证据目录、影响图登记和 closeout。不得为了“并行提速”提前实现后续 Wave 的契约。

---

## §3 W0 · 事实冻结与门禁复绿（P0）

### 3.1 目标

把当前「脏树、多套基线、间歇红门、全量套件未完成」变成干净、可复跑、可归因的起点。

### 3.2 具体改进点

1. **HEAD↔WIP 清单**：用机器可读 JSON 列 22 M / 10 ?? / 335+/61-，标注模型链、Agent loop、提示词、测试四类归属；不改动文件内容。
2. **WIP 归属裁决**：由 WIP 所有者决定提交、丢弃或另立工作包；Agent 只提供清单和冲突面，不代做破坏性处置。
3. **lint 真红**：删除 `frontend/src/components/copilot/SimpleChat/modelConfigAndCollapse.test.tsx:40-41` 两处不必要类型断言，保留行为断言。
4. **code-size 真红**：判断 `workspace-tools.js` 1636 行是合法增长还是补丁堆积；合法则 `--write` 重打并说明，否则先做 scoped 重构；同步移除 `PluginStorePanel.tsx` 已过期例外。
5. **性能门加固**：`scripts/block350-perf-gate.mjs` 的低耗时场景改「绝对上限 + 相对容差」双判据；连续 5 次 PASS；保留“植入慢样本必红”的负测；不降低对真实性能退化的敏感度。
6. **工具数基线单源**：把 `test/block116-decision-platform.test.mjs:277-282`、`test/block157-skill-visibility.test.mjs:41-45`、`test/tool-activity-labels.test.mjs:22-25` 的 114 改为读取 tool-defs facade 计数；新增/删除工具仍需 `--update` 留因。
7. **model-surface / 领域中性裁决**：WIP 的 `systemPromptChars 1083 > 993` 必须显式重打或收缩提示词；`FederationJobs.tsx::deseq2` 由用户裁决“改 UI 文案”或“按工具重扫”，不得静默放宽棘轮。
8. **全量测试分片**：把 `test:all:workspace` 拆为 Node 域、前端域、长时/实机域三段，用 `task:run` 有界记录 exit.json；超时结论为未知，不得写 PASS；未登记 `test/*.test.mjs` 到 impact-map 一律 fail-closed。
9. **脏树证据隔离**：P6 source binding 测试只在 clean tree 采样；脏树时明确 `source_binding_not_current`，不重打 acceptance 证据。
10. **canonical 对账**：`state` 的 `G0-LF` active、handoff“无 active”、roadmap 顶部下一建议、AUDIT-LOG 旧 P1 行逐件核销，形成唯一接手状态。

### 3.3 出口判据

- `npm run closeout` 在干净树连续 3 次 16 门 PASS；`quality:perf` 单独连续 5 次 PASS + 负测红。
- `test:changed` 0 fail / 0 cancelled；`test:all:workspace` 三段各自有 exit.json 和完整日志。
- `git status` 无未知 WIP，或所有 WIP 有明确 owner/Plan ID 且文件面不相交。
- `docs:check`、`ui:audit:check`、`hygiene:check` PASS；coverage 字段与 status 一致。

---

## §4 W1 · Agent 主链韧性与错误可见性（P0）

### 4.1 目标

让长任务在流中断、上下文增长、压缩、降级、取消、最终整理失败时都能给出**确定、可见、可恢复**的行为。

### 4.2 具体改进点

1. **流式错误穿透**：在 `llm-client.callChatProvider` → `ModelGateway.chat` → provider 全链透传 `errorsAsRejections`（或网关默认开启 + 显式 opt-out）；补 `callChatProvider → gateway → provider` 的本地 SSE RST 集成测试，断言 `agent_status(network_retry)` 与正文恢复。
2. **上下文预算每轮化**：把 `loop-orchestrator.js:222,767-809` 的一次性 latch 改成每轮估算、每轮 `token_budget`、幂等 trim；补“连续两轮增长再次触发修剪”行为测试。
3. **compaction 单源**：抽 `resolveCompactionMode()` 统一视图/摘要/阈值；`chat.js` 透传 `maxOutput`；更正 `chat.js:34,220,223` 与 `feature-flags.js:28-31` 冲突注释；四种 flag 组合矩阵测试。
4. **压缩失败可见 + 增量摘要**：`conversation-compaction.js` 发 `compaction_failed{reason}`；只对 `rowid > covers_rowid` 的增量行合并摘要；补重复压缩输入长度有界测试。
5. **trimmer 真实 dropped 集合**：`message-trimmer.js` 返回实际丢弃集/id；`loop-orchestrator.js:815-823,844-856` 只按真实 dropped 生成摘要，且只有 `compactSummaryText` 非空才注入 note；补无 `tool_call_id` 的孤儿 tool 负测与 `trim_skipped` 事件。
6. **降级分类单源**：抽 `classifyProviderFailure` / `resolveFallbackCandidates`，不可降级优先、结构化错误码优先；补 cancelled+timeout、401+api_error、多绑定上界三个负测；统一请求级与任务级候选。
7. **SSE 收尾契约**：定义 `error / done / task.failed` 三态；失败必须可结束客户端等待；降级续跑任务不得用 `onEvent: () => {}` 隐藏进度，至少把新 taskId、状态与最终正文投影回原会话。
8. **重试可观测**：首 token stall 静默重试改为带 `agent_status(provider_retry)` 与 reasonCode；不把重试当错误，也不把重试隐藏。
9. **token 账本单源**：删/收编 `computeCategories` 恒 0 的 `other` 与 `computeContextBreakdown` 双口径；UI、事件、成本估算使用同一结构。
10. **自然长任务回归**：去掉 T7 `windowOverride=20000`，在真实默认窗口下触发压缩；T7 20 项 FACT 全收、0 干预；全套 8 任务连续 3 次 8/8。

### 4.3 出口判据

- 全链 RST、连续两轮预算、4 flag 组合、增量摘要、无 id 孤儿 tool、取消/401/多绑定、SSE done/error 七类行为测试全绿。
- 无静默 catch：所有降级有 reasonCode + 事件/UI 可见；`compaction_failed` / `trim_skipped` / `provider_retry` 可在轨迹面查到。
- 8 任务连续 3 次 8/8；T6 口令不再波动；人眼判据按冻结表集中落盘。

---

## §5 W2 · 安全准入、IPC 与数据真值（P0）

### 5.1 目标

在保持用户 exec 裁决的前提下，把“策略判定”和“真正执行”焊成一条可审计闭环，并让产物/数据库链可自证。

### 5.2 具体改进点

1. **IPC 注册包装器**：所有 `ipcMain.handle` 经统一包装器强制 `assertTrustedSender(event)` 与参数 schema；`file-dialog.js:430-455` 等写 handler 接入；root 由主进程 project store 反查，忽略 renderer 传入 root。
2. **IPC 双向门禁**：`test/ipc-channels-registry.test.mjs` 改正则抽 preload 全量通道字面量，与 `channels.js` 做集合相等；CONSUMERS 改 glob 枚举；注释字符串不得再制造假绿。
3. **一次性 capability token**：approval store 的 fingerprint/ctxSnapshot/TTL 生成 token；`tools-executor`、`run-plugin-script`、SSH runner 三入口在执行边界校验并消耗；参数改动、过期、跨 task 重放一律拒绝。
4. **exec token 收窄**：`workspace-tools.js:695-710` 的 `PETRI_WORKSPACE_EXEC_TOKEN` 改 per-call `handlerOptions` 注入，不下沉到子进程 env；命令 `env/printenv` 不得读回；补默认放行环境下风险提示日志、审计与 `PETRI_EXEC_STRICT_DENYLIST=1` 可发现性测试。**默认放行裁决不变**。
5. **DB 单源**：抽 `pathResolver + connectionFactory`，统一 `PETRI_LOCAL_DATA_DIR` / `PETRI_DB_PATH`、WAL、busy_timeout、foreign_keys、mmap；`migration-runner.js:39,56`、desktop singleton、core connection 全部复用。
6. **迁移与退出**：文件名按数值排序 + 三位正则 + 重号 fail-fast；`will-quit` 在后端关闭后 `closeAll()` 并 `wal_checkpoint(TRUNCATE)`；迁移失败不得静默继续启动。
7. **产物链哈希**：revision 增 `prevChainHash` / `chainHash = sha256(prev + canonical(revision))`；deliver manifest 重算产物文件 sha256 并纳 `prevManifestHash`；导出包带根哈希与独立校验器。
8. **动态防护与审批统一**：`command-risk-rules`、`agent-tool-policy`、`approval-request-store`、四档 accessMode、MCP trust 共用同一决策结构；任何新入口都必须接同一拦截器。
9. **静默 warn 升级**：MCP registry 8 处初始化 warn 汇总为 `health{degraded, reasons}`；必需模块缺失时 listTools/callTool 明确降级，不宣称完整可用。
10. **安全回归**：sender guard、root 反查、token 消耗、参数改写、过期重放、跨进程 env leakage、DB close、manifest 篡改各有负测。

### 5.3 出口判据

- 所有写 IPC 有 sender guard 与参数 schema；双向通道集合相等门禁绿。
- 三执行入口必须出示并消耗 capability token；默认放行风险提示/严格模式/审计三态可复核。
- DB 只有一个 pathResolver/connectionFactory；退出 checkpoint 有真实进程回归。
- revision/manifest 全链哈希可由独立校验器复算；篡改留痕且 fail-closed。

---

## §6 W3 · 用户体验可信化与可达性（P1）

### 6.1 目标

把“看起来能用”升级为“任何状态下用户都知道发生了什么、能用什么、为什么不能用”。

### 6.2 具体改进点

1. **能力位单一链路**：`viewerRegistry` 的 `canSelect/canCompare/canExport` 一路上抛到 Canvas、ContextBar、导航、钉住、导出；按钮禁用时给具体原因，禁止静默回落。
2. **viewer 分派重构**：扩展名优先、kind 兜底；`preview===false` 返回可读 reason；为 report/pdf/video/svg/model3d/spreadsheet 建决策表快照测试；Shell 展示降级原因与“打开原文件”出口。
3. **失败可见性契约**：`ThemeProvider.prefsSync.failed`、`ExperimentalFeaturesSection` 拉取失败、`ResultArtifactShell` 恢复错误、`ExternalImportPanel` 回执、SimpleChat 队列溢出提示统一为 `role=alert/status` + 原因码 + 重试/复核入口；4 秒自动消退的提示同时进通知中心或可回看区域。
4. **焦点与键盘基线**：非 chat 投影层加 `inert`；项目树/会话/搜索列表改 `role=tree/treeitem` + `aria-expanded` + roving tabindex；分屏把手用 `slider`；补一条隐藏层不可聚焦、树可键盘展开的 a11y 冒烟 flow。
5. **表单语义**：ExternalImportPanel 加 `fieldset/legend`、`label/htmlFor`、补丁值 `JSON.stringify` 格式化、回滚结果 live region；危险导入保持两步武装。
6. **布局单源**：`CenterPanel.tsx:199-207` 双层同名 layout 嵌套改为单一 `XxxLayout.module.css`；遵守 CSS 主题 skill 的“布局层重构而非追加、单一真源、旧规则失效、四块几何量测、拖到两倍/缩到一半自查”。
7. **字号与主题**：硬编码 `fontSize:11` 等收敛到 token；亮/暗/字号/accent/motion 四轴做端到端视觉取证；theme token 17/17 继续守住。
8. **长列表 DOM 预算**：消息、会话、结果库统一视口窗口化并设 DOM 上限；先用零依赖 `content-visibility` 与分页，不引入虚拟列表库；用 CDP 实测节点数、滚动帧率、首屏时间定义重开条件。
9. **UI 台账终态化**：52 条 `in_progress` 按 A/B/C/D/E 分诊；能 CDP 代行的补腿，缺真实数据/环境的显式条件腿，纯人眼项集中一次人工路线；UI-694/695 的实机切换、长任务折叠、观感稳定逐条取证。
10. **视觉验收四件套**：元素级截图过目、可视列边界+祖先链溢出量测、长内容三态、flex/grid 祖先链 `min-width:0`；DOM 几何绿不得替代视觉绿。

### 6.3 出口判据

- 能力位、viewer 降级、同步失败、实验开关、恢复错误都有可见原因与可操作出口。
- 隐藏层不可 Tab；树/分隔件/表单有语义；亮暗与窄窗口无溢出、无重叠、列表视口比 ≥0.8。
- UI 台账每条 in_progress 终态为 verified / cancelled / retain-with-reason；截图不可得如实 `screenshot_unavailable`。

---

## §7 W4 · 扩展生态单源化（P1）

### 7.1 目标

让插件、Skills、MCP、领域包在任意 dataDir/dev/pack 形态下都按同一套源、元数据、schema 和健康状态工作。

### 7.2 具体改进点

1. **插件源统一**：`mcp/registry.js:375-395` 改调 `plugin-loader.resolveDefaultPluginSources()` 与 `resolveInstalledPluginsDir()`；删除硬编码 `~/Documents/Petri-Local/plugins` 分叉；builtin/installed/development/pack 四源优先级契约测试。
2. **工具名双形状**：`listTools.withMetadata` 复用 `helpers/tool-filter.js` 的 `{name}` / `{function.name}` 取名；每条工具必须有 `executionMetadata`，动态插件取保守缺省；`listTools` 全量快照入机械门。
3. **MCP schema 单源**：`skill_discover.source` enum 从 `SOURCE_PRIORITY` 派生，纳入 `pack`；`plugin-loader._inputsToInputSchema` 显式 boolean/file/directory 映射；unknown type 告警或 fail-closed。
4. **插件入口确定性**：`plugin-loader.js:114-120` 不再静默 `files[0]`；由 `plugin.json` 声明 `entryScript`，未声明即 fail-closed 或仅同名精确匹配；readdir 排序稳定。
5. **装配函数合并**：`loadFromSourcesArray` 与 `loadPluginsFromSources` 合为单一 `loadPlugins(sourcePlan)`，保留归一化 Manifest v1；动态 `path.join` require 收编为静态依赖或显式 registry。
6. **启动 health**：初始化失败汇总 `health{degraded, missing[], reasons[]}`，由 listTools/callTool 与设置货架展示；必须模块缺失不得宣称可用。
7. **证据生成器化**：`acceptance/block-352/shelf-matrix.json` 改确定性生成 + 落盘一致性负测；4 个 detour 按 bundle 状态、C-46 票状态、demo 差异自动复判，不手工清零。
8. **供应链完整性**：`resources/skills/manifest.json` 的 artifacts `sha256:null` 在构建期补齐或显式 `unavailable+reason`；`skills:check` 增加 artifacts 形状与键一致性检查。
9. **能力地图同步**：功能矩阵、货架矩阵、能力地图三份产物用同一生成器输出 G0 边界、访问档、外部资源与 detour 状态；禁止越界宣称。
10. **领域中性**：核心 prompt/UI 不新增领域词；pack 注入保持按需；`deseq2` 等兼容键逐件裁决，保留须有白名单理由。

### 7.3 出口判据

- 四源解析、executionMetadata、source enum、inputSchema 类型、入口选择均有行为测试/快照。
- 缺依赖/初始化失败时 health 与 UI 同时显示降级，不出现“显示可用但 listTools 空”。
- 三份矩阵可由同一命令重建，人工改动判红；detour 触发条件可机械复判。

---

## §8 W5 · 架构去补丁与测试有效性（P1/P2）

### 8.1 目标

降低读者需要持有的概念数，把“保护实现细节的测试”换成“保护行为的测试”。

### 8.2 具体改进点

1. **`runLoop` 行为基线**：先冻结 init/provider/tools/decision/finalize 五段输入输出，拆成可单测函数；同套定向测试拆前拆后双绿。
2. **目标文件体量**：`loop-orchestrator.js` 从 1675 行降到 <600 行主编排文件（或等价职责拆分），`SimpleChat.tsx`、`workspace-tools.js` 按既有棘轮只减不增；不靠抬高基线通过。
3. **第二真相清理**：删 `helpers/circuit-breaker.js` 零消费熔断、恒 null 桩、legacy `ERROR_I18N`、死参 `emitToolResult/conversationState`、`computeCategories`；`isRetryableProviderError` 与 `provider-reliability.shouldRetry` 合并。
4. **行为测试替代源码扫描**：`test/agent-runner-loop-orchestrator.test.mjs`、`test/loop-orchestrator-subdomains.test.mjs` 的 `src.includes`/行数断言逐步换成事件、状态机、错误码、恢复行为断言；未登记测试全部进 impact-map 并 fail-closed。
5. **架构环消亡**：13 个存量环按簇设里程碑，每消一簇用 `--update` 下调基线；新增环保持红；不为了数字好看一次性抬基线。
6. **版本/常量单源**：artifact-truth、result-studio-contracts、delivery-manifest 的 schema version 收进 registry；迁移版本用同一数值/格式校验器。
7. **CSS 布局债**：按 W3 的单一真源文件，清理旧容器规则、固定高度、死 fallback；每次布局改动前数同类规则，>3 即重构。
8. **死代码棘轮**：`quality:knip:check` 保留面在清理后 `--update` 下调；动态 require 盲区补静态注册，不把 report-only 数字当精确债。
9. **补丁 vs 重构门禁**：同一处第二次叠条件/flag/特例时，工作包必须先给 scoped 重构方案与行为基线，否则评审不批准再垫一层。
10. **回归→门禁转化**：流式 RST、tool 配对、context latch、sender guard、MCP 元数据已出现两次或具备隐性后果/可机械化条件时，把负测映射写进对应 gate 注释与报告。

### 8.3 出口判据

- 主链拆分为行为可测单元，同类缺陷负测在 gate 内有显式映射。
- 源码扫描契约数量清零或有明确遗留理由；impact-map 覆盖全部测试且未知路径 fail-closed。
- 存量环与 Knip 保留面只减不增；code-size 例外逐项消亡。

---

## §9 W6 · 性能与规模化体验（P2）

### 9.1 目标

从“有基线”升级为“长会话、长列表、大项目、打包启动都有持续预算和稳定门”。

### 9.2 具体改进点

1. **性能门双判据**：W0 落地后在冷启动、长会话、大目录、packaged_start 四场景分别设绝对上限 + 相对容差；低耗时场景避免纯百分比卡在噪声带。
2. **连续绿证据**：`quality:perf` 连续 5 次 PASS，采样日志保留；负测植入慢样本仍判红；每次基线变化留因。
3. **增量压缩成本**：W1 的增量摘要上线后，测量重复压缩输入长度、模型调用次数和 token 曲线；设“会话翻倍但单次摘要输入有界”断言。
4. **请求体预算**：每轮 `token_budget` 与 `computeContextBreakdown` 同源；工具定义、系统提示、消息、工具结果、输出预留五类占比可核对；超阈值自动裁剪并留事件。
5. **DOM 预算**：消息/会话/结果库三面统一节点上限；用 CDP 量测 ≥400 条会话、>10k 节点或用户卡顿报告作为重开条件；默认零依赖 `content-visibility`。
6. **启动与 DB**：migration 单连接、busy_timeout、advisory lock；冷启动分解 require/迁移/后端 health/SPA 200/CDP 页面五段，避免“后端绿但屏幕黑”。
7. **文件树与分页**：C-47 只在有可复现步骤后归因；分页、软上限、轮询收敛统一状态机，避免首击正常、复击回弹或重置第一页。
8. **资源清理**：listener/poller/socket/DB/后台进程都有 teardown 回归；全量测试不再因孤儿进程 SIGTERM。
9. **成本与计量**：token、cache、duration、模型归因按单次 attempt 记录；`ai_usage`、轨迹、ContextBudgetBar 同源，不允许“显示一套、请求一套”。

### 9.3 出口判据

- 四场景连续 5 次 PASS；冷启动五段读数可复跑；长会话 DOM 节点与滚动帧率有实测证据。
- 20k 窗口自然长任务无 provider 400、无静默 fatal；重复压缩输入长度有界。
- 全量测试完成且无孤儿进程；teardown 有真实进程回归。

---

## §10 W7 · 治理台账与证据运营（P2）

### 10.1 目标

让任何 Agent 换模型/换会话后都能恢复同一份真相，且证据不会随文档更新被悄悄升格。

### 10.2 具体改进点

1. **coverage 自动字段**：`docs/DOC-REGISTRY.json` 的 `documentCount`、`managedMarkdown`、`lastUpdated` 由 `docs:status` 生成/校验，禁止手工漂移。
2. **AUDIT-LOG 自稳**：`audit:compact` 入收口首步并保持幂等；超长行拆到专项 plan，只在台账留指针；旧 P1 条目按结论逐件 ✅ / retain-with-reason。
3. **active 槽位唯一**：`state`、DOC-REGISTRY、roadmap、handoff 的 active Plan ID 与阶段一致；`G0-LF` 与“无 active”冲突由治理批裁定，不任选对实现方便的一份。
4. **README 近期入口**：当月条目脚本化维护，跨月 roll-index；新报告/蓝图同批登记，避免无入口 Markdown。
5. **四账本生成器**：能力地图、功能矩阵、货架矩阵、UI 台账摘要各由确定性生成器输出；人工改动判红；越界宣称守卫继续保留。
6. **证据生命周期**：acceptance 文件记录 source commit、platform、命令、生成时间、负测指针；历史 PASS 只在 source/dependency digest 相同时复用。
7. **交接协议**：每 Wave 收口写 plan、registry、roadmap、handoff、AUDIT-LOG、UI 台账；说明 WIP 保留、未跑门禁、外部依赖和人工项。
8. **阶段纪律**：报告中只写一次 “G0 开发期常态 · 不外推 packaged/Provider/GA”；不把发布资格事项列为当前缺口或下一步提议。

### 10.3 出口判据

- `docs:reconcile` 候选逐件复核，`docs:check` PASS；coverage 与 status 一致；无第二 active canonical。
- 每个 Wave 有 acceptance 目录、复跑命令、负测和交接笔录；未跑/跳过/复用证据如实标注。
- 下一 Agent 只读 `state + AUDIT-LOG + roadmap + handoff + active plan` 即可恢复当前事实。

---

## §11 发令与验收协议

### 11.1 发令顺序

```text
W0 发令 → 收口并复跑全局门禁
  ↓
W1 发令 → 长任务与 8 任务套件收口
  ↓
W2 发令 → 安全/DB/产物链收口
  ↓
W3 发令 → 体验与 a11y 收口
  ↓
W4 发令 → 扩展生态单源收口
  ↓
W5 发令 → 架构拆分与测试有效性收口
  ↓
W6 发令 → 性能与规模化收口
  ↓
W7 发令 → 治理与证据运营收口
```

W1/W2 都触及执行语义，必须串行；W3/W4 若后续发现共享文件或 sharedBaselines，按 registry 三判据自动排队，不并行抢文件面。

### 11.2 每个正式工作包的最小 DoD

- 独立 plan：范围、非范围、依赖、风险、touchSurface、sharedBaselines、验收、完成语义。
- 红绿先行：新行为/缺陷修复先落失败测试，再写最小实现；纯重构用拆前拆后同套绿作行为基线。
- 当次证据：命令输出、exit code、acceptance JSON、实机/视觉证据、负测、未覆盖范围。
- 门禁：`docs:check` + `ui:audit:check` + 定向 `test:changed` + 本 Wave 专项门禁 + `closeout`；干净树上只跑一次全量门禁。
- canonical 回写：registry、README、roadmap、handoff、AUDIT-LOG、UI 台账同批；未达证据不写 verified/completed。
- 收口报告：P1 修复清单、P2 留痕、外部/人工/环境边界、WIP 保留状态、下一步唯一建议。

### 11.3 明确不做

- 不新增功能域或工具族来充进度。
- 不新建第二 executor、Job、Artifact、Workflow、项目状态、UI truth、DB 连接源或插件源解析器。
- 不为过门放宽 lint/types/knip/code-size/model-surface/domain-neutrality/perf/EAR 基线；重打必须显式留因和负测。
- 不把 DOM 断言、机械判据或进程 health 冒充视觉观感、人眼质量或真实任务成功。
- 不覆盖、暂存、删除或提交当前未知 WIP。
- 不在 C-47 未复现归因前做猜测性修复；不在兄弟仓授权前改 C-46。
- 不启动阶段跃迁，不外推 packaged/Provider/GA。

---

## §12 与既有 canonical 的关系

- 本蓝图是 `planned` 方向文件，不替代 `docs/next-steps-roadmap.md` 的当前立即任务，也不把任何 Wave 自动翻成 active。
- `docs/Petri-Desktop-Holistic-Evaluation-2026-11-06.md` 是本蓝图唯一事实基线；若源码/基线变化，先更新评估受影响章节再执行 Wave。
- 发令后按 `$petri-project-governance` 分配正式工作包编号、登记 registry 与 AUDIT-LOG；本文件只保留波次、目标和验收，不记录每日进度。
- 每个 Wave 的 acceptance 证据目录建议为 `acceptance/nso-2026-11-06/wave-N/`，具体路径在正式 plan 中钉死。

---

*本蓝图不设工作量上限，但设证据上限：任何没有当前证据的“完成”“通过”“可信”都不得写入收口报告。*
