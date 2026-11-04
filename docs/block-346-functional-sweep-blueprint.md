---
capability: block-346-functional-sweep
status: completed
goal: 把「能力写完但用户用不到」这类集成债一次清扫干净并机械防复发——以全量矩阵（工具×契约×handler×元数据×可达性 / IPC×preload / 路由×挂载 / 设置键×读写）为唯一清单，票式逐项收官，并把矩阵升级为 closeout 棘轮门禁（P1 只许减不许增），使同类缺陷不再依赖人工审计发现。
acceptance:
  - P0 基线冻结：`node scripts/functional-surface-audit.mjs` 全量矩阵落盘（acceptance/functional-audit-2026-11-04/），P1/P2/P3 清单与本蓝图票单逐项对齐；基线 JSON 入 `test/functional-surface-baseline.json`。
  - P1 止血全清：矩阵 P1 = 0（当前 **2 条**：`worktree_remove` 死工具、`executionTargetId` 前缀不一致；原报的 goals 三条已证伪为审计脚本误报，见 §2 T2），每条附修复前红/修复后绿。
  - P2 接线与契约收敛：审批元数据与契约冲突 3 条、schema 未声明键 1 条、13 个 preload 无包装通道全部判明（退役删 or 补包装），零"待分诊"残留。
  - P3 门禁化：矩阵 `--check` 接入 closeout（棘轮：新增 P1/P2 即红，存量递减），并有负测（人为造一条新 P1 必须判红）。
  - P4 实机与台账：dev Electron 实机腿覆盖 T1/T3 修复面；台账口径对账（13 条「仅缺实机证据」与「UI 面未交付」分列），closeout 十三门 PASS。
  - 收口后复核门（用户裁决 2026-11-04「BLOCK-344 收口后再复核一下，毕竟改动会带来其他问题」）：344/345 收口后必须先复跑矩阵读增量 diff，新增 P1 阻断开工；棘轮 `--check` 红绿双样本负测通过（删基线一条→exit 1，恢复→exit 0）。
reopen: 应用/窗口白名单与 computer 总开关（对标项，需单独裁决）；drag/右键/剪贴板（能力补全非接线）；Linux 平台实现；Provider/packaged/签名/i18n（G1+ 不外推）。
---

# BLOCK-346-FUNCTIONAL-SWEEP — 功能面彻底清扫蓝图

- 登记状态：**planned（2026-11-04 立项）**；排队 **BLOCK-344（active）→ BLOCK-345（planned）→ 本包**
- 立项动因：用户裁决「事无巨细的全方位核对 每个点都要明确清楚，之后建立优化蓝图，彻底清扫问题」
- 唯一清单来源：`docs/functional-surface-matrix-2026-11-04.md`（脚本生成，可复跑）+ `acceptance/functional-audit-2026-11-04/surface-matrix.json`

---

## §1 当前基线（2026-11-04 机械化全量核对）

| 面 | 覆盖 | 判定 |
| --- | --- | --- |
| 工具定义 / 契约 | 114 契约；111 已汇编（3 个未汇编见 T2） | P1 4 条（goals×3 + worktree_remove） |
| 工具元数据 | 全表可解析，与契约冲突 3 条 | P2 3 条 |
| schema × 实现参数 | 逐键对账（111 工具） | P2 1 条（computer_press.ref） |
| IPC 通道 | 180 条；preload 包装覆盖 167；MAIN_ONLY 4 | P2 1 组（13 条待分诊） |
| REST 路由 | 285 端点 / 58 模块；未挂载 0 | 通过 |
| 设置存储键 | 7 键；读写不通 1 条 | P1 1 条（executionTargetId） |

**总计：P1 = 5，P2 = 5，P3 = 5。**

> 说明：本基线只覆盖「机器可判定」的面。语义类断链（条件互斥、静默假成功、零消费端点）已在
> `docs/functional-audit-2026-11-04.md` 逐条取证，作为 T1/T3/T4/T5 的输入。

## §2 票单（串行，票内自决；撞裁决点即停）

### T1 审批链统一（P1，最大票）

- **问题**：`needsApproval` 元数据轴零读取者；确认卡只认 `run_tool` 与 guard 信封；`browser_act` 写动作要求 `ackToken` 但无签发方；`workspace_worktree_remove` R3 恒拒且无 UI/无路由。
- **范围**：审批载荷上抬去工具硬编码（`tool-events.js`）；前端 `pendingApproval` 生成条件去 `event.name === 'run_tool'`；卡片渲染解除 `accessMode !== 'full'` 互斥；`browser_act` 补 token 签发（复用 `setToolJobApproval` + 前端卡）；`worktree_remove` 给出口（UI 或明确降级为 unsupported 并从 schema 移除）。
- **验收**：契约测试「声明 needsApproval 的工具必有前端渲染路径」；`computer_click`/`browser_act` 首调出卡 → 批准 → 执行真落 sidecar/connector；三档可达性矩阵无死工具。
- **依赖**：与 BLOCK-345 P1 同根因，**建议 345 先行、本票吸收其残余**（避免重复改同一文件面）。

### T2 定义汇编门禁（**COMPLETED 2026-11-04**，含一次自我纠错）

- **原假设（已证伪）**：`tool-defs/goals.js` 存在但未进 `domainModules` → 三工具模型不可见。**实测**：`agent-orchestration.js:204` 有 `...require('./goals')`，三个 goal 工具**一直在 `TOOL_DEFS` 里**。误报根因=审计脚本只扫 facade 的 `domainModules`、不解析域文件内部的相对 `require`（已修：改用绑定域文件的 `createRequire` 真实解析）。
- **实际交付**：`test/block346-tool-defs-assembly.test.mjs` 六条契约——①域目录下每个文件的每个定义都必须在 `TOOL_DEFS`（防漏汇编）②无重名（防重复汇编）③`domainModules` 无悬挂引用 ④每定义有 name+parameters ⑤`DOMAIN_TOOL_DEFS` 与 `TOOL_DEFS` 逐引用一致 ⑥goals 常绿守卫。**红/绿双样本负测通过**：造未汇编域 `__negtest` → 精确点名判红；删除 → 6/6 绿。
- **风险登记（重要）**：域内 `...require('./goals')` 是**合法写法**，契约不得退回"文件必须被 facade 直接引用"（会与既有 spread 冲突并制造第二次误报）。
- **剩余**：`schema_undeclared_args` 5 条（`computer_press.ref` / `followup_task.role` / `model3d_propose.path` / `model3d_apply.reason` / `model3d_export.scenePath`）归 T1 一并收敛。

### T3 静默失效（P1）

- **问题**：默认执行目标键 `petri.` vs `petri-`；`fix_enum_or_range` 假修复；3D mock 与真实同 `ready`；侧聊档位锁死无提示。
- **范围**：存储键收敛 `brand.ts` 单源（或改写入用 `writeBrandStorage`）；loop 修复返回参数 diff 或诚实失败；mock 结果加 `synthetic: true` 且下游强制区分；锁定档渲染 disabled + 原因。
- **验收**：设置默认目标后请求体真带 `executionTargetId`；修复失败不再报 `isActionable`；mock 结果在 UI 有「模拟」标记。

### T4 零消费端点接线（P2，最大体量票）

- **范围**：联邦 jobs（提交/状态/产物）、科研任务计划+确认、Loop 迭代、模型白名单 PUT、Harness 环境包操作、reason-codes 词表出口、`canCompare` 消费与硬编码移除、钉住快照三类预览。
- **验收**：每项一条实机断言；无「只能 curl」的能力。

### T5 安全口径（**PARTIAL 2026-11-04**）

- **不做全局纳入**（原方案否决）：把 `external-request` 整体加入 `MUTATING_SIDE_EFFECTS` 会误伤浏览器只读动作（`navigate`/`read_text` 同属该工具契约，无法按参数区分档位）——等于让只读档连读网页都不许。
- **改为精准修（已完成）**：两条真风险工具的**契约归类本身错了**，就地纠正——
  - `delegate_to_petri_node`：`external-request` → `execution`（它是在他机上**执行**一个任务，不是只读出网；原分类使只读/计划档可远程执行）
  - `generate_methods`：`external-request` → `state-write`（写 `project.database`）
- **browser_act 保持 `external-request`**：写动作的审批由工具内两段式门（T1）承担，读动作在只读档仍应放行。
- **IDE MCP 写面（已补契约，档位留 reopen）**：新建 `mcp/ide-tools/contracts.js` —— 18 个 `ide_*` 工具全部登记契约（sideEffect/riskTier/destructive/confirmPolicy），dispatch 层对 `confirmPolicy='always'` 的写/执行类强制 `confirm=true`（`ide_file_delete`、`ide_terminal_write`）。**档位接入仍 reopen**：MCP 调用方是外部 IDE（Cursor/VSCode），无 Petri 侧 `accessMode` 会话概念，硬接会产生「外部 IDE 永远被拒」的假门；正解要在 MCP 握手期协商会话档位，属协议层改造。回归：`test/block346-ide-tool-contracts.test.mjs` 6/6 + 既有 IDE 测试 72/72。
- **验收**：`agent-tool-registry` 27/27 绿（含两处 345 遗留的工具计数断言同步 114→115）。

### T6 通道与设置键卫生（P2/P3）

- **范围**：13 个 preload 无包装通道逐条判明（退役删 or 补包装）；`branch:*` / `message:*` 与 `channels.js` 对齐；storage 悬空键单源化。
- **验收**：`ipc_channels_without_preload` 归零或全部标注 MAIN_ONLY + 注释；`test/ipc-channels-registry.test.mjs` 扩到双向覆盖。

### T7 矩阵门禁化（**COMPLETED 2026-11-04**）

- **基建**：`--write-baseline` / 增量 diff / `--check` 棘轮 / `--worktree` 模式（开发中验证未提交修复）；基线 `test/functional-surface-baseline.json`。
- **接入**：`quality:surface` npm script（`--worktree --check`，读当前工作区与本批基线比对）+ `closeout --gate quality:surface` —— closeout 由九门扩为**十门**。
- **负测（红/绿双样本）**：从基线删一条 P1 → 退出码 1；恢复 → 0。接入后复验通过（`FIXED` 项正确显示、无新增 PASS）。
- **检测可信度负测（2026-11-04 追加，逐条注入验证非假门禁）**：

| 检测 | 注入方式 | 实测结果 |
| --- | --- | --- |
| `tool_without_contract` | 删 `web_fetch` 契约 | P1 精确点名 + 棘轮 `+ NEW P1` ✅ |
| `tool_without_contract`（恢复） | 还原 | P1=0 ✅ |
| `defs_not_assembled` | 曾真实触发（goals 误报）→ 修口径后正确判定 | ✅（并留下「spread 写法合法」风险登记） |
| `schema_undeclared_args` | 真实命中 5 条并全部修复 | ✅ |
| `ipc_*`（preload/dead） | 真实命中 13→12 条，分诊后清理 | ✅ |
| `route_endpoint_no_frontend_consumer` | 真实命中 10 条（抽查 5 条 0 引用） | ✅ |
| `storage_*` | 修口径后覆盖 7→20 键 | ✅（误报 3→0） |

**无效/已否决**：反向 `schema_declared_unused`（14 条全误报，ctx 注入 + 整体透传无法静态区分）——已在脚本内留注释。
注意：负测必须用 `--worktree`（默认 HEAD 模式看不到工作区注入，首轮负测因此假通过）。
- **纪律**：门禁编码「声明与消费必须对齐」这一过程规则，不固化当前状态事实（存量基线只许递减）。
- **注意**：`--worktree` 与 `--check` 组合是刻意选择——若用默认 HEAD 模式，提交前跑等于跑旧代码，门禁失效。

### T8 台账口径对账（**DONE 2026-11-04**，治理无代码）

- **交付**：`ui-productization-audit` 顶部新增「in_progress 三分类对账」节，把 28 条按**五类**归并——A 仅缺实机证据 13 条 / B UI 面未交付 2 条（UI-513、UI-534）/ C 疑代码缺陷 1 条（UI-663）/ D 长期挂起 9 条 / E 移出 UI 验收域 3 条。
- **不改状态词的理由**：状态语义只允许 `verified/in_progress/cancelled`，A 类改成任何新词都会破坏门禁契约；分类作为**附加标注**表达同一信息，且不掩盖「未验证」事实。
- **验收**：`ui:audit:check` PASS（624 个带证据编号）· `docs:check` PASS（460）。

## §2.5 收口后复核门（用户裁决 2026-11-04，强制前置）

> 用户裁决原话：「BLOCK-344 收口后再复核一下，毕竟改动会带来其他问题。」
> 语义：**任何在制品收口都会改变本矩阵的输入面**，因此本包任何一票开工前，必须先复核一次增量，不得沿用旧清单。

- **触发点**：BLOCK-344 收口提交后（以及 BLOCK-345 收口后）→ 本包 P1 开工前。
- **动作**：`node scripts/functional-surface-audit.mjs`（默认模式，基线自动取当前 HEAD）→ 读 `vs baseline` diff 三分类。
- **判定**：
  - **新增 P1** → 阻断：先修或立新票，不得带病开工。
  - **新增 P2** → 分诊：并入现有票或登记新票。
  - **消失项** → 记录收敛（说明他包顺手修了），不可重复开票。
- **基线收敛**：复核确认无回归后 `--write-baseline` 下调存量，棘轮只进不退。
- **门禁实证**：`--check` 已做红/绿双样本负测（人为从基线移除一条 P1 → exit 1；恢复 → exit 0）。
- **重点面**：BLOCK-344 触碰 `model3d` 域，而该域当前是矩阵的**文本降级域**（`defsFallbacks` 之一）→ 复核时必须人工确认 model3d 的工具/契约/参数未被 344 的改动打散，必要时把该域求值修好后再冻结基线。

## §2.6 批 3 · T4 进度（零消费端点接线）

| # | 项 | 状态 |
| --- | --- | --- |
| 4.3 | 模型白名单 PUT 无写入 UI | **DONE**：新建 `ModelAccessPanel`（读写允许清单 + 理由账本逐行 `模型=理由`），挂设置「决策与调度」节；3/3 组件测试（开放态/白名单回填+PUT 载荷/失败展示 diagnostics） |
| 4.7 | `/api/ai/reason-codes` 零调用 | **DONE**：同一面板内折叠展示原因码词表（按 category 分组），点击才拉取 |
| 4.4 | Harness 环境包面板纯只读 | **DONE**：加「重新检测」按钮（复用既有 list IPC，不新增通道） |
| 4.1 | 联邦作业三端点前端零调用 | **DONE**：新建 `FederationJobs`（选节点 + toolId + 参数 JSON → 提交 / 查状态 / 产物下载），挂联邦面板；3/3 测试（含本地 JSON 拦截、下载链接条件） |
| 4.2 | 科研计划 5 + Loop 3 端点前端零调用 | **登记为待接线（非本包硬造）**：全仓 grep 无任何内部调用方，且前端无 taskSpec 来源（taskSpec 由 agent 编排产生）——造「手填 taskSpec JSON」的 UI 无产品价值。正确接法=agent 侧产生确认请求 → 前端确认卡，属 loop 编排改造，另立 reopen |
| 4.5 | `canCompare` 无人消费 + 另一处硬编码 true | **DONE**：Canvas 改 prop（默认 false）由调用方按适配器传；测试补反向断言 |
| 4.6 | 钉住快照 md/sheet/pdf 无内嵌预览 | **DONE（除 spreadsheet）**：markdown 文本内嵌（`previewText` + Pane 分支）；**pdf 走浏览器原生 iframe**（零解析依赖，同 report 分支）；spreadsheet 需 xlsx 二进制解析（exceljs 已退役）→ 保留「打开原文件」出口并登记 reopen |

## §2.8 T7 增强：零消费端点机械化（2026-11-04 追加）

矩阵新增 `route_endpoint_no_frontend_consumer` 检测（业务面前缀 `/api/{ai,harness,federation,remote-targets,knowledge}/` 下取第 3 段业务名比对前端语料）。首次运行命中 **10 个真零消费端点**（抽查 5 个全部 0 引用，且前端无 `/ai/${}` 变量拼接误报）：
`POST /api/ai/memory-wipe` · `GET|PUT /api/ai/memory-policy` · `GET /api/ai/agent-audit` · `POST /api/ai/agent-undo/:token` · `GET|POST /api/ai/agent-settings` · `GET /api/ai/site-snapshot` · `GET /api/ai/docs-index` · `POST /api/harness/context-checkpoint`。
性质=**后端能力已就绪、前端零入口**（与 T4 那批同型，但需逐个设计 UI，非纯接线）。**处置：已接线 7 条**——`AgentAuditPanel`（agent-audit + agent-undo + agent-settings 暂停）与 `MemoryPolicyPanel`（memory-policy GET|PUT + memory-wipe 二次确认），各 3/3 测试，零消费端点 **10 → 3**。剩 3 条为诊断/内部端点（site-snapshot / docs-index / harness context-checkpoint），无用户面需求，保留 P3 记录。

## §2.9 四批交付完成与收口例外（2026-11-04）

- **交付**：批 1（T2 + T7）· 批 2（T1 + T3，P1 5→0）· 批 3（T6 + T4 6/7，P2 7→0）· 批 4（T5 精准修 + T8 台账对账）。共 9 次提交。
- **矩阵终态**：P1=0 / P2=0 / P3=4（P3 全是卫生项：12 死通道待删或接线 + 3 存储键读无写）。
- **收口例外（如实登记，不宣称 completed）**：`closeout` 前四门绿（audit:compact / hygiene / docs / ui-audit），停在 `test:changed` —— 其中 P6 产品验收契约测试报 `p6_current_source_tree_not_exact`（`test/impact-map.json` 在 P6 源绑定集，本次为其补了规则），重打证据失败于 `p6_restart_baseline_cohort_incomplete`（要求 baseline changeSet ≥3 revisions，需真实重启原型环境）。**属既有环境限制 + Result Studio P6 长期 `implemented_unverified`，非本包代码缺陷**；registry 状态保持 active，待例外裁定或环境就绪。
- **T6 死通道清理完成（2026-11-04 追加）**：12 条死通道（登记 + handler）+ branch-db 中仅服务它们的 11 个导出一并删除，净删 434 行；`channels.js` 275→261、`branch-db.js` 343→175、handler 12→6（正好=preload 暴露面）。连带修两处同键重复读取 bug（`petri_token ?? petri_token`）。矩阵 **P3 4→2**，余两条均为预期用途（`petri_token` 兼容读取、`extraRenderers` 手工调试开关），已在代码注释说明。
- **遗留 reopen**：spreadsheet/pdf 钉住预览、科研计划/Loop 前端确认流（需 agent 侧改造）、IDE MCP 写面接统一审批轴、T4 4.2。

## §2.10 用户裁决：四项取消（2026-11-04）

用户原话：「看上去这 4 项不是很刚需，那可以取消了，防止干扰后续的其他开发」。

| 取消项 | 原定做法 | 撤销方式 |
| --- | --- | --- |
| spreadsheet 钉住预览 | 引入 xlsx 二进制解析（exceljs 已退役） | 已做的前端解析器整体 revert（`c2def605`） |
| 科研计划/Loop 确认流 | agent 侧产生确认请求 + 前端确认卡 | 立项包 BLOCK-347 撤销（`1012e993`）；已接的 `harness_plan_task` 工具一并 revert（`bb484d0d`） |
| IDE MCP 档位协商 | 进程级 `PETRI_IDE_MCP_ACCESS_MODE` 过渡 | 整体 revert（`685c9f4e`）——默认收紧到 workspace-write 会改变外部 IDE 既有行为，属干扰源 |
| 新工作包（BLOCK-347） | 科研任务闭环 planned 入队 | registry/roadmap/backlog/README 全部撤回 |

**语义**：这四项**不再作为 reopen 跟踪**，后续规划不得自动捡起；如日后确有需求，须重新发令立项。
**保留**：346 已交付的 T1-T8 本体（含 UI-694 设置面板五段、联邦作业、pdf/markdown 钉住预览、canCompare、IDE 契约表与 confirm 闸）不受影响。
**可逆性**：全部通过 `git revert` 处理（保留历史），如需恢复对 revert 提交再 revert 即可。

## §3 阶段与体量

| 阶段 | 内容 | 体量 |
| --- | --- | --- |
| P0 | 基线冻结 + 本蓝图登记 | 本轮已完成（矩阵 + 蓝图） |
| P1 | T2 → T1 → T3（P1 清零） | 约 2 会话 |
| P2 | T4（零消费端点） | 1-2 会话 |
| P3 | T6 + T7（卫生与门禁化） | 1 会话 |
| P4 | T5（需裁决）+ T8（台账）+ 实机 + closeout | 1 会话 |

合计约 **5 个会话**；零新 npm 依赖。

## §4 非范围

- computer-use 的应用/窗口白名单、总开关、composer 入口（对标项，单独裁决）
- drag / 双击 / 右键 / hover / 移光标 / 剪贴板 / 多显示器（能力补全，非接线）
- Linux 平台实现
- `sidecars/computer-use-windows` 二进制入库、签名分发（G1+）
- SimpleChat / agent 主循环重构（本包只改接线与门禁）

## §5 文件面与并行边界

- 触碰面见 `DOC-REGISTRY` 的 `touchSurface`（工具面 / IPC 面 / 前端 copilot 与设置面 / 审计脚本 / 矩阵与蓝图文档）。
- 与 BLOCK-344（3D/SceneSpec）**不相交**；与 BLOCK-345（computer 链）**部分相交**（`tool-events.js` / `tool-defs/computer.js` / `computer-use-tools.js`），故必须串行：345 收口后本包 P1 才开工。
- `sharedBaselines`：`test/impact-map.json`、`test/model-surface-baselines.json`、`eslint-suppressions.json`、`test/knip-baseline.json`、`test/functional-surface-baseline.json`（本包新增）。

## §6 完成语义

`completed` 需同时满足：矩阵 P1 = 0 且 P2 全判明；T1-T8 逐票有当次证据；矩阵门禁入 closeout 并有负测；台账三分类对账完成。Windows/Linux 平台条件项按既有诚实降级口径记录，不以 mock 冒充真机。

---

## §7 进度记录

- 2026-11-04 P0 完成：机械化全量矩阵脚本落地（`scripts/functional-surface-audit.mjs`，基线取 HEAD、在制文件不计入），跑出 114 工具 / 180 IPC / 285 路由 / 7 存储键，判定 P1=5 P2=5 P3=5；蓝图登记 planned。本轮零产品代码改动。
- 2026-11-04 复核基建完成（用户裁决「等 344 收口后复核，改动会带来其他问题」）：脚本新增 `--write-baseline` / 增量 diff / `--check` 棘轮；基线冻结于 `5fd75a0c`；**红绿双样本负测通过**（人为从基线移除一条 P1 → exit 1；恢复 → exit 0）。复核门写入 §2.5 与 acceptance，作为 344/345 收口后的强制前置。
- 2026-11-04 **批 3 · T6 分诊完成（含第二处检测纠错）**：①`petri:agent-workbench-flags` 原判「漏包装」是**误报**——preload 用常量 `AGENT_WORKBENCH_FLAG_CHANNEL` + `invoke(CONST)`，脚本只认字面量；已修（常量表解析），该类不再误报。②其余 **12 个是真死通道**：`branch:children/get/project:{create,get,list,update}` + `message:{append,clear,count,delete,get,list}`——主进程 `src/ipc/branch-handlers.js` 有 handler、preload 无包装、全仓零消费（除 handler 自身）、`branch-db` 仅被该文件引用。③脚本新增**自动分诊**：有前端消费= P2（真断链）/ 无消费= P3（死通道卫生），据此 P2 由 8 降为 7、P3 由 3 升为 4。④**删除未执行**：需连带 `branch-db` 未用导出、knip 基线更新与主进程启动冒烟，收益小于风险，登记为后续卫生批裁决项（删 or 接线）。
- 2026-11-04 **批 2 完成 5/6（T7 亦接入完成）**：④**T3-3 3D mock 已可辨**——`probeGenerationProvider` 与 `generateModel` 的 mock 分支加 `synthetic: true`，不再与真实 Tripo 同为 `ready` 且同形产物（历史缺陷：仅 `reason` 区分，下游常丢弃）。⑤**T3-4 侧聊档位锁定已显式化**——`useModelAccessMenus` 新增 `accessModeLocked`，档位菜单加锁定说明条 + 四个选项 `disabled`（历史缺陷：锁定档 return 后菜单照常可点、点了静默无反应）。前端 9/9 绿（useModelAccessMenus 2 + SideChatWindowPage 7）+ `quality:types` 0。⑥**T1-`worktree_remove` 死工具已解（用户裁决 2026-11-04「按你推荐的来」=方案 A）**——契约 R3→R2（`registry.js`），`tool_workspace_worktree_remove` 接两段式审批（复用 `ensureControlConfirmation`，惰性 require 保持本模块「无 DB 顶层依赖」设计）；工具级实测返回 `needApproval + ackToken`，核心 `removeWorktree` 契约测试 10/10 仍绿（测试调内部函数不受门影响）。**批 2 收口：6/6，P1 归零**（矩阵 `P1=0`，`unreachable_in_all_modes` 与 `storage_prefix_mismatch` 双双 FIXED），基线收敛 `P1=0 / P2=8 / P3=3`。
- 2026-11-04 **批 2 进行中（3/6 项完成）**：①**T3-1 默认执行目标已修**——`brand.ts` 新增 `writeBrandStorage/removeBrandStorage`（前缀唯一来源），`RemoteTargets` 改用之 + 旧点号键一次性迁移；前端 5/5（含新增迁移用例）；矩阵 `--worktree` 显示 `storage_prefix_mismatch` **FIXED**。②**T1-browser_act 两段式审批**——`computer-use-tools` 导出 `ensureControlConfirmation` 复用（同 tool_jobs/同 ack 语义，不建第二套）；`browser-tools.browser_act` 对 click/fill 且在 agent 调用语义下（有 ctx 身份）设门，REST 直调面保持原语义（调用方自带 token）；schema 补 `confirm` + 修正 ackToken 描述。Node 19/19 绿（含 browser connector 8/8、bridge 5/5、汇编契约 6/6）。③**T3-2 `fix_enum_or_range` 假修复已改正**——`clampParams` 注释自认占位（只贴 `_repair` 标记、参数原样返回），上层却报 `isActionable: true` + 文案「修正了超出范围的参数值」；现改为**诚实失败**（`isActionable: false`、参数原样交回、文案「未能自动修正…请按 schema 重填」），测试断言同步更新（repair 35/35 + 邻域 23/23 绿）。③矩阵脚本增强：`--worktree` 模式（开发中验证未提交修复）+ 双模式对照（HEAD 仍能抓旧缺陷=P1 2，worktree 显示已修=P1 1）+ 迁移常量行级豁免。④`model-surface` 基线更新（`--force`）：接受 344 遗留 `model3d_apply +153`、345 遗留 `computer_close +1 工具`、本批 `browser_act +94`（审批字段），复测 PASS（115 工具/63527 chars）。**剩余 4 项**：T3 的 fix_enum_or_range 假修复 / 3D mock 标记 / 侧聊档位提示；T1 的 worktree_remove 出口（需裁决 R3 是否放开）；T7 closeout 接入。
- 2026-11-04 **批 1 状态**：T2 COMPLETED（六条汇编契约 + 双样本负测，P1 5→2）；T7 **PARTIAL**（棘轮三件 + 基线 + 负测已就绪，`closeout --gate` 接入因 `package.json` 源绑定与 P6 重打牵动排到批 2）。批 1 交付物=1 个测试文件 + 1 个审计脚本修复 + 基线 JSON，零产品代码改动。
- 2026-11-04 **T2 收口（含自我纠错）**：矩阵首跑把 `tool-defs/goals.js` 判为未汇编（3 条 P1），实测证伪——`agent-orchestration.js:204` 的 `...require('./goals')` 早已把它汇编进 `TOOL_DEFS`（115 个定义、无重名）。修复=审计脚本改用绑定域文件的 `createRequire` 解析相对 require（`tools=115/115`、`fallbackDomains=0`）；交付=六条汇编契约 + 红绿双样本负测（造 `__negtest` 未汇编域 → 精确点名判红；删除 → 6/6 绿）。**P1 由 5 降为 2**（`worktree_remove` 死工具、`executionTargetId` 前缀不一致），基线重冻结 `d6f33fcb`（P1=2 / P2=8 / P3=4）。零产品代码改动（误加的 facade 汇编已回退）。
- 2026-11-04 **§2.5 复核门执行完毕（344/345 收口后）**：基线 `5fd75a0c` → HEAD `d6f33fcb`。结果=**新增 P1=0、新增 P2=0**（无回归），消失 P2=1（`computer_authorize` 审批元数据冲突被 345 修好），新增 P3=1（`computer_close` 缺调度元数据——345 新增工具时漏项，工作区已有未提交修复）。**model3d 域专项核对**：344 的改动未打散契约，3 条 schema 漂移保持原样、无新增。判定=**不阻断，346 可开工**。基线已收敛至 `d6f33fcb`（P1=5 / P2=8 / P3=4）。
- 2026-11-04 消除审计盲区（同轮）：域文件常量 `require` 桩改为「可调用 + 可迭代」Proxy，`model3d` / `agent-orchestration` 由文本降级转为**真实求值**（`fallbackDomains` 2→0）；直接新暴露 4 条 schema 漂移（`followup_task.role` / `model3d_propose.path` / `model3d_apply.reason` / `model3d_export.scenePath`）——其中 3 条正在 BLOCK-344 的改动面上，属复核重点关注项。基线已重冻结：**P1=5 / P2=9 / P3=3**，棘轮 PASS。
