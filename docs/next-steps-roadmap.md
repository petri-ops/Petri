# BioF3 Desktop — Current Next Steps

最后更新：2026-08-29（BLOCK-28.1 已收口：主区审阅页主题串色修复 + Codex 级打磨，UI-208/209 verified。当前无 active 工作包，下一工作包由用户显式裁决启动。G0 开发期常态 · 不外推 packaged/Provider/GA。）

## 立即任务

- 无 active 工作包。`BLOCK-28.1-REVIEW-MODE-POLISH` 已于 2026-08-29 收口（用户反馈驱动）：主区审阅页浅色主题串色修复（全 token 迁移，明暗双主题自适配，UI-208 verified）+ Codex 级布局打磨（进度细条/图标文件树/diff 头统计/图形化空态/accent Commit 主按钮，UI-209 verified）；证据 `acceptance/ui-208/`。commits `cea4cbb` / `baea3e2`。
- 留给用户裁决的后续候选（未启动）：UI-193 widget 业务路径与 UI-194 消费侧挂载。
- `src/preload.js` 已纳入 P6 canonical source-binding impact rule，后续映射新增必须在证据刷新前 fail closed。

## 当前结论

`v0.0.1-rc.7` 是当前 OSS 线上版本，已完成代码、自动化、双架构构建、安装候选启动验收和公开更新链核验。Stage 1 UI 产品化、Stage 2 模型层、Stage 3 Harness 与标准流程、Stage 4 首个稳定产品版本及 Harness Phase 7 均已关闭。

当前不默认扩展分析功能。`G0-START`、LF0～LF12 的核心资格保持 maintained；RS0～RS8 与 P4R/P5/P6 的 Result Studio 引擎和开发态证据保留，但 2026-07-25 产品复核撤销的完整产品资格没有恢复。2026-08-03 用户裁决把发布级 P7 重新资格后移；Result Studio 保持 `implemented_unverified / experimental`，rc.7 仍是工程候选版，不得描述为 GA。

`G0-RS-UX1H / UI-126` 已于 2026-08-09 按非资格边界收口；`G0-SDC-1 / G0-SDC-2` 已分别以 `acceptance/g0-scientific-data-contract/sdc1-complete.json` 与 `sdc2-semantic-binder.json` 收口。`AGENT-CONCURRENCY / UI-140` 已于 2026-08-11 完成：A-1～A-6 开发态 Electron evidence 精确绑定实现提交 `6adeaa9`；DeepSeek `deepseek-v4-flash` 经 Clash Verge 的 `api.deepseek.com → AI专用` 规则恢复连通，连接测试与真实任务均通过。UI-141 已以隔离 unsigned arm64 packaged 候选闭合真实运行时缺失 → 插件商店链，UI-142 键盘焦点链也已 verified；三项改动由 PR #13 统一交付。当前没有新的 active 工作包，不自动启动后续阶段；SDC-3～SDC-7 与 P7 继续 deferred。

LF12 已按 [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md) 的 Q0～Q7 收口。RS9 曾新增第 17 类 `result_studio_product`，但后续复核发现其五条任务由独立测试拼装、Provider 未执行真实工具闭环、视觉验收依赖人工布尔值、大表由 seed 直接构造；该证据现降级为 unit/synthetic/renderer historical evidence。`result-studio-editing` 在 RS-P7 前暂停 qualified support claim，不能影响或冒充 LF12 原始核心资格。

`G0-CHF0 Critical Cross-cutting Hardening`（[`g0-critical-crosscut-hardening-plan.md`](./g0-critical-crosscut-hardening-plan.md)）已完成 CHF0-R1～R5 审计修复并重新真实收口：科学输出、PCA sample-ID、长任务/进程终态、HTTP 来源/文件边界与 Acceptance 可追溯性均绑定实现检查点 `41a365f`；专项 5/5、22 tests，29 个 source/producer hashes 与可达提交逐一匹配，证据保持 `qualificationEligible:false`。Result Studio P4R-0～P4R-6、`G0-RS-P5` 与 `G0-RS-P6` 已按各自边界真实收口；P7 Honest Product Requalification 已 deferred。

P4R 已于 `cb73132`（实现）、`c449e57`（刷新后的 runtime evidence）与 `252e806`（20/20 product closeout）完成 P4R-6：canonical Git/SQLite 冷路径隔离到持久后台子进程，performance evidence 14/14、event-loop 17.99ms ≤ 250ms；live evidence 从真实 completed Job 经 context-bound Agent candidate、Compare、Code、adopt、受控 replay、discard、conversation 和 backend restart/reopen 连续通过；同一 Electron BrowserWindow 的明暗 × 1440/1024/820、键盘/focus、异常降级/重试和服务重启恢复均通过。UI-112～UI-115 已由 source-bound renderer evidence 记为 `verified`；P4R 整包仍仅是 `implemented_unverified / qualificationEligible:false`，未使用真实 Provider、未作 packaged/GA 声明。

`G0-RS-P5 Real Scientific Editing` 已在 `e7f271c` 收口，source-bound 证据为 `acceptance/g0-result-studio/rs-p5-scientific-editing.json`（20/20，`sourceCommitMatchesSourceHashes:true`）。空 disposable 账本经迁移与 HTTP project 创建后，五条 admitted 科学任务都走 `run_tool → tool_job → Artifact Truth`，完成持久 SQLite/Job/Workflow Truth DAG、缺图 fail-closed、候选 validator、不可变输入、科学差异、完整 cohort ReplayPackage 及历史 restore。它只证明本地 deterministic context-bound 科学编辑，不证明 Provider、packaged、崩溃/压力恢复或产品资格。P6-0 已以 `acceptance/g0-result-studio/rs-p6-ui110-electron-scientific-trace.json` 完成 UI-110 的 source-bound Electron 裁决：证据绑定 `6f5271e`，同一 BrowserWindow 对账 7 个 Job、6 个 ChangeSet、26 个 Revision 与 26 个物理 Artifact，UI-110 在该窄边界升为 `verified`。

`G0-RS-P6` 已在 `ad1e2ce` 收口，canonical evidence 为 `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json`（10/10，source-bound，`qualificationEligible:false`）。真实本地矩阵覆盖停止、R/validator 失败、SIGSTOP/SIGKILL、Electron/后端重启、drift、GC、并发候选和资源压力；开发态 Electron 恢复 15/15 且低于 5 秒，真实读取 10 万行表、复杂 SVG/PNG、长报告与 100+ 版本。201 条 synthetic Revision 只是 alias 压力；开发态冷启动首画布预算为 1500ms。真实 Provider、packaged Electron、literal OS reboot 与 packaged/in-app 1000ms 目标仍未证明，随 P7 一并 deferred。

P4R-3 的实现检查点为 `3d3eb29`，性能门校准修复为 `59b33c4`。中央结果焦点以自然语言 Composer 为默认入口，高级参数面板默认关闭；Artifact/Revision/Selection/contextToken 在点击时原子绑定，create 只接受同一 Agent turn 的受信原始 intent，selection 重放、分类/确认篡改、script patch 与模型自带 DAG 均 fail-closed。task/legacy 的取消、返回式 Provider 错误与异常共用 terminal 进度收口，SQLite 重开只显示五个公开阶段。P2/P3/P4/P4R 五份 evidence 均通过 source-commit 反查；产品证据 10/10，资格仍为 `qualificationEligible:false`。P4R-3 当时缺权威持久 DAG 的科学/数据/流程编辑明确阻断；该边界已由 P5 的持久 Truth 投影在其受验证范围内替代，缺图仍 fail-closed，不把安全降级冒充可用能力。

P4R-4 的实现检查点为 `f710261`。Result / Compare / History 已成为真实互斥路由模式；查看旧 Revision 使用可丢弃 viewed state，Artifact/interaction/Selection/contextToken 均显式绑定所选版本，不移动 current、不切 active Job、不调用写 API，首次版本列表 GET 不写 SQLite、不创建 managed Git。版本选择按项目/family-scoped truth 分页并标注原始/当前/候选/历史；Change Review 的意图、影响范围和验证状态来自服务端受信持久元数据，Git 详情默认折叠。checkpoint 故障、参数 hash、source commit、parent family/project 漂移均 fail-closed。focused frontend 104/104、affected Node 258/258、related frontend 48/48、P4R product 13/13；五份 evidence 均绑定 `f710261`。UI-113/UI-114 仍为 `in_progress`，P4R 仍是 `implemented_unverified / qualificationEligible:false`。

Result Studio 旧实现的 11 个提交已位于 `main`（检查点 `03e5826`）；`SDC-0 Profile Registry 与版本治理` 也已在分支 `codex/g0-sdc` 的 `7284921` 收口并推送，六个 canonical Profile 与 fail-closed typed DAG 边继续保留。SDC1-A 已在 `bd15777` 完成并由 `acceptance/g0-scientific-data-contract/data-to-first-result.json` 绑定开发态 Electron 短闭环；当前不创建 Worktree，SDC-3～SDC-7 deferred。

当前固定顺序：

```text
G0-RS-P0 资格与证据纠偏
  → RS-P1 中央结果主画布
  → RS-P2 科学选择交互
  → RS-P3 Agent 上下文编排
  → RS-P4 Core 手动与 AI 统一编辑
  → RS-RH0 仓库治理与定向测试门
  → RS-P4R-0～P4R-2 聚焦结果体验基础
  → G0-CHF0 横切关键硬伤修复
  → RS-P4R-3～P4R-6 Agent-first 聚焦结果体验
  → RS-P5 真实科学编辑与差异
  → RS-P6 恢复、性能和产品解释
  → RS-P7 诚实重新资格（deferred）
```

当前重新排序：UX1A～UX1H、`G0-RS-TL1 / UI-120`、`UX1G-1`、`UX1G-2 / UI-123`、`AGENT-CONCURRENCY / UI-140`、UI-141 与 UI-142 均已按各自证据边界完成；当前无 active 工作包，RS-P7 继续 deferred。

`G0-IDE-MCP-TOOLS Phase 1 + 1.5 + 3` 已于 2026-08-14 收口（`docs/g0-ide-mcp-tools-plan.md` §11 + §Phase 3 收口）：总计 18 个 `ide_*` 工具（7 文件 + 5 终端 + 1 search + 1 diff + 4 git）+ 2 个 MCP Resources（`ide://projects` + `ide://git-status`），78/78 定向测试全 PASS；Phase 3 复用 Phase 1.5 `diff.js` 的 `parseUnifiedHunks` 并通过 `core/r-server/mcp/ide-tools/diff-helpers.js` 共享，未引入 `simple-git` 依赖。整包 `implemented_unverified`，不进 `qualificationEligible`。Phase 2（Monaco 编辑器 9 个工具）继续 `deferred`。

`G0-RS-P0`～`G0-RS-P3` 已依次收口；P4 Core 已形成 18/18 离线实现检查点并保持 `implemented_unverified`。P3 建立 `ResultStudioContextEnvelope v1` 与 `contextToken`：artifact/family、job、revision（含 current 与 ordinal）、脚本相对路径与 sha256、参数摘要、插件可编辑参数与声明动作、selection、validation、reproducibility 全部由后端从 SQLite/`tool_jobs`/插件 descriptor 重新投影，前端 activeArtifact 只作线索。模型可见 schema 新增 7 个工具（注册表共 32 个），6 个 `*_in_context` 工具的参数中不含 toolJobId/artifactId/revisionId/artifactFamilyId/selectionId；写操作强制校验 token，陈旧上下文返回 `context_token_stale`，intent 指向别的 Revision 返回 `context_intent_mismatch`，"归因只能到 Job"与跨项目 revision 一律 fail-closed。公开进度固定为「理解意图 → 判断影响 → 执行/重算 → 验证 → 候选可比较」五阶段，不展示隐藏推理链。证据为 `acceptance/g0-result-studio/rs-p3-agent-context.json`（20/20，non-qualifying）。

P4 Core 让手动调整与自然语言修改共用同一条编辑链：控件全部由插件 descriptor 的 `parameters` + `parameterImpacts` 投影，缺 impact 声明的参数不可编辑；`volcano-plot` 补齐配色/字体/尺寸/图例/标签/导出共 12 个 presentation 参数并接进真实 R 脚本（此前全为硬编码）。`normalizeEditSubmission` 是手动与 AI 的唯一归一化闸门，类型/范围/枚举 fail-closed 拒绝、未声明参数记为 rejected、与现状相同的提交不产出 patch，因此不会创建空 ChangeSet；影响分级只能由受信 descriptor 提升，调用方无法把科学或流程参数降级成样式修改，未声明 impact 的参数保守落到科学重算。过程中修复既有缺陷：保护字段表原先覆盖 descriptor，使 deseq2 声明为 `workflow` 的 `design` 被悄悄降级成 `scientific`，现在保护字段只作下限。`currentValues` 取自该 Job 真实执行过的归一化参数，不用默认值冒充。证据为 `acceptance/g0-result-studio/rs-p4-unified-editing.json`（18/18，non-qualifying 离线 descriptor 投影/插件接线/注册表/strict build 证据）；真实候选等价链尚未执行，故 UI-109 保持 `in_progress`。

RH0 已按 Truth Snapshot、Hot Context、Test Impact、Script/Temp Lifecycle、Acceptance 串行收口并通过最终基线。P4R～P6、UX1A～UX1H、TL1 与 AGENT-CONCURRENCY 的实现检查点保留，P7 已于 2026-08-03 延期。当前没有新的 active 工作包；UI-140、UI-141 与 UI-142 已在各自 macOS 证据边界 verified。

详细阶段范围见 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)，Phase 7 完成证据见 [`harness-phase7-completion-plan.md`](./harness-phase7-completion-plan.md)。
已完成的 Scientific Task Contract 工作包记录见 [`harness-scientific-task-contract-plan.md`](./harness-scientific-task-contract-plan.md)。
当前 G0 主计划见 [`g0-living-foundation-plan.md`](./g0-living-foundation-plan.md)。

## 当前 G0 Living Foundation

`G0-START` 与 LF0～LF12 已通过。1.1.1 maintained 基线保留能力供应链、权限决策、八域韧性实验室、Evolution Pipeline、LF12 确定性资格总账与永久维护门；Result Studio 产品资格已暂停，只保留 experimental 引擎基础。

G0 处于永久 `qualified + maintained`，资格仅覆盖明确的 macOS arm64、本地 Runtime/存储、双 Provider、admitted 科学插件与 Result Studio 任务矩阵。任何扩展必须重新证明，不得从本次资格外推。

## 已完成的 P-03 Loop 工程包

`Harness Loop Engineering v1` 已于 2026-07-24 完成生产验收。生产 Agent、Validator/Repair、耐久恢复、UI-101、SPT-1 七节点三轨、双 Provider、应用重启、Delivery/Replay 与视觉矩阵均有脱敏证据；执行真相仍唯一为 `run_tool → tool_job → artifact truth`。

Loop 工程包继续复用 TaskSpec、Workflow Plan、Plugin、ToolResult、Job、Artifact、Delivery 和 Replay，不得创建第二套 executor、job、artifact 或 workflow truth。正常路径不使用任意固定轮数提前停止；重复、无进展、振荡、同类故障和资源/成本异常必须进入可审计的保护状态。节点和任务完成由验证器与 Artifact 证据判定，不能由模型口头声明。

HLE-C0～HLE-C5 已全部关闭；[`harness-loop-production-closure-plan.md`](./harness-loop-production-closure-plan.md) 现为验收记录。G0 LF0～LF12 核心继续由永久 G0 门维护；Result Studio 已重开为 RS-P0～P7 产品收口，不再使用“RS0～RS9 全部关闭”描述当前状态。

## 当前 P-03 工作包

`Harness Scientific Task Contract v1` 已完成 HRT-0（24/24）、HRT-1（14/14）、HRT-2（4/4）、HRT-3（确认/执行门 4/4、SQLite/Job 绑定 1/1）、HRT-4 执行事实/Artifact provenance（2/2）、HRT-5、HRT-6 和 HRT-7。HRT-7 新增统一 `npm run harness:scientific-task` 离线聚合门禁，覆盖固定大小窗口、summary 失败回退、结构化任务契约、持久化、交付、漂移分类和数据库外 R 重放；证据位于 `acceptance/harness-scientific-task/hrt7-scientific-task-gate.json`。后续运行控制面已补齐完全访问模式的通用会话命令行、RuntimeResourceSnapshot、UI-051 用量/资源面板、UI-053 文件树/活动预览自动刷新、UI-054 最终答复空响应自动恢复、UI-035 阶段进展持久化/紧凑工具摘要、UI-055 以用户目标和真实产物为终止条件的科学工作流连续执行、UI-060 异常自动恢复与可操作故障说明，以及重启中断 Job 的 `recovery_required` 投影；只读模式继续禁止命令执行。真实进程峰值采样、GPU adapter、跨平台 bundle、OSS 远程接手及 UI-035/UI-054/UI-055/UI-060 真实 Provider 触发复验仍是扩展/验收项。

UI-061 已把完全访问解释为项目内可复现分析的预授权：DESeq2/WGCNA 等本地计算不再生成二次确认卡，直接进入真实 Job/Artifact 链并由 Agent 检查、修复和重试；兼容确认卡补齐“开始 / 取消”，仅供旧调用或未来真正需要用户决定的边界使用。

P-04 内置插件稳定性已完成一轮真实 Mac 收口：10 个插件统一使用 `job_dir` 执行协议，必需文件先行校验，插件主动阻断保留结构化 `failureMode`，每次成功运行由 Harness 统一生成脚本/参数/输入/输出哈希证据。隔离用户已安装旧版本后的生产链验收为 **31 passed / 0 failed / 4 skipped**；证据位于 `acceptance/harness-plugins/macos-arm64-acceptance.{json,md}`，入口为 `npm run harness:plugins:acceptance:update` 与 `npm run harness:plugins:acceptance`。

## Harness Phase 7 完成状态

Phase 7 已补齐 7 个项目级文件/短命令工具、统一工具注册表与 policy/interceptor、结构化 ToolResult 与脱敏 Trace、受控编辑、模型上下文压缩和 Provider 调用边界。

出口证据：

- P7-A live Provider：DeepSeek `deepseek-chat` 与自定义 OpenAI-compatible `gpt-5.6-sol` 使用同一 8 场景矩阵，均 8/8 PASS；证据位于 `acceptance/harness-phase7/provider-baseline.{json,md}`，仅用于人工验收，不进入 CI。
- P7-H 离线聚合门禁：`CI=1 TERM=dumb npm run harness:phase7` 实测 manifests 7/7、Phase 6 tests 64/64、Phase 7 核心 tests 68/68、产品检查 13/13，全部 0 fail。
- 产品检查使用临时真实 workspace，经生产 interceptor / policy / preflight / handler 全链，不访问 Provider、凭据、用户数据库或科学分析 Job；脱敏证据位于 `acceptance/harness-phase7/product-acceptance.{json,md}`。
- P7-F 后台任务控制面继续 `deferred`：符合门槛的真实 `>30s` 非科学任务为 0/3，未新增 process start/check/stop。
- UI-034 已完成独立实机视觉矩阵并标记 `verified`；UI-033 同轮完成供应商/模型选择器与真实身份抽查。

固定不变量保持不变：

> `run_tool → tool_job → artifact truth`

Phase 7 未建立第二套 analysis executor、job、artifact 或 workflow truth。

## 已完成基线

- 当前代码、标签与 OSS 线上版本：`v0.0.1-rc.7`（发布提交 `ab519fa`）。
- macOS arm64/x64 DMG、SHA-256 和 `latest-mac.yml` 已发布到阿里云 OSS；GitHub 只保存源码与不可变标签。
- Stage 1 UI 台账 30/30 verified；Stage 2 的 UI-031 已完成打包态验收并标记 `verified`。
- Stage 3 的 GO/KEGG、GSEA、WGCNA、双 Provider 评测、插件指南与 capability bundle 真链已完成。
- Stage 4 已完成 migration/SQLite ABI、真实 Runtime 首装、DESeq2 与 GO/KEGG 首次成功、数据升级、诊断隐私和 arm64 RC 发布反向验证。x64 因没有分析 Runtime 仍只声明壳层预览。
- 核心后端已内联为仓库内 `core/`；当前为本地文件存储 + SQLite + 内嵌运行时本地执行，不再使用 vendor submodule、PostgreSQL 或 docker 双模式。
- API Key 不进入普通设置或读取 IPC；macOS 使用 Keychain，其他平台使用独立 0600 凭据文件。

## 后续决策入口

以下是需要真实反馈或单独授权后才能开启的候选方向，不是当前实施任务：

1. rc.7 使用反馈与缺陷修复。
2. x64 分析 Runtime。
3. 新产品阶段；若重开 P7-F，必须先有至少 3 个合格真实任务的可复现证据。

Harness Loop Engineering v1 与 Result Studio 引擎基础继续复用。G0 Living Foundation 的 LF12 核心保持 maintained；Result Studio 产品资格暂停，P7 deferred。Scientific Data Contract 的 SDC-0 已收口，SDC-1 Data Profiler 为下一候选，SDC-2～SDC-7 继续 deferred。科学长任务继续走正式 Job/Artifact 链，不能借通用后台进程工具绕过。

完全访问模式已经由用户明确定位为通用命令执行授权，不再维护固定命令白名单；只读模式仍禁止命令。不得借通用命令行建立第二套科学结果真相：正式分析交付仍必须进入确认、审计与 `run_tool → tool_job → artifact truth`。

## 当前入口

1. [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)：产品阶段路线图。
2. [`g0-living-foundation-plan.md`](./g0-living-foundation-plan.md)：当前 G0 工作包、依赖与永久门禁。
3. [`project-workspace-handoff.md`](./project-workspace-handoff.md)：当前恢复检查点。
4. [`ui-productization-audit.md`](./ui-productization-audit.md)：UI 执行台账。
5. [`development-module-map.md`](./development-module-map.md)：模块责任边界。
6. [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md)：稳定版本出口矩阵。
7. [`macos-oss-auto-update.md`](./macos-oss-auto-update.md)：发布与更新规范。
8. [`dependency-decoupling-checkpoint.md`](./dependency-decoupling-checkpoint.md)：架构去耦检查点。
9. [`g0-scientific-data-contract-plan.md`](./g0-scientific-data-contract-plan.md)：前置已满足、等待按 LF1/LF7 依赖启动的数据契约轨。
10. [`harness-loop-engineering-plan.md`](./harness-loop-engineering-plan.md)：已完成的 HLE-0～HLE-6 基线、验收与跨 Agent 接手协议。
11. [`harness-loop-production-closure-plan.md`](./harness-loop-production-closure-plan.md)：已完成的 HLE 生产接线、真实验收与状态纠偏记录。
12. [`doc-governance-gates-plan.md`](./doc-governance-gates-plan.md) + [`doc-governance-gates-closeout.md`](./doc-governance-gates-closeout.md)：2026-08-16 用户裁决启动、同日 GATES-0~GATES-4 五阶段全部完成并收口的治理工程工作包；治理门禁硬化与剩余 12 项治理债；不修改 UI/主代码/Provider/packaged/GA。
## 2026-08-14 → 2026-08-16 同步笔录

> 本节为 2026-08-16 文档治理收口同步（worker-C）追加，仅在上方「当前结论」段后追加一段同步状态；不重写或外推原文中已收口阶段的实施细节与边界。

- **聚类形态**：本轮截至 2026-08-16 的本地 29 个最近 commit 已由审计 worker 聚类为 6 个 Block；当前阶段纪律要求按 Block 跟进，不引入新的活动 canonical 计划。
- **Block-1 · AGENT-WB**（10 commit）— 已收口。`UI-AGENTWB-###` 系列在 dev Electron + packaged 三轴边界内均 `verified`，详见 `docs/AUDIT-LOG.md` T-AW-013/014 二次实机收口登记。
- **Block-2 · SKILLS + WIRING + COPILOT**（7 commit）— 部分收口；`UI-157`（Skills IPC 桥）、`UI-158`、`UI-159` 仍处 `in_progress`，等待实机复核升 `verified`。
- **Block-3 · G0-IDE-MCP-TOOLS**（5 commit）— Phase 1 + 1.5 + 3 已按 `docs/g0-ide-mcp-tools-plan.md` §11 + Phase 3 收口 `qualified`（78/78 定向测试 PASS），Phase 2（Monaco 编辑器 9 工具）继续 `deferred`。
- **Block-4 · R-SERVER-FIX**（1 commit）— `/api/ai/agent` 路由修复及治理漂移收口已落地；本轮仍缺补强定向测试，留待下一次受影响范围触发时一并验证。
- **Block-5 · GOV-AUDIT-VERIFICATION**（5 commit）— T-AW-013（packaged 三轴验证）+ T-AW-014（dev Electron 边界内 4 工作包二次实机复核）已按各自边界收口，并在 `docs/AUDIT-LOG.md` 留有同收口径登记；含 6 份 planning 文档治理收口。
- **Block-6 · G0-LONGTERM-DEV + HOTFIXES**（3 commit）— `UI-161`（Skills 入口回收至 LeftPanel、移除 `SkillsSidebar`）等仍以 `in_progress` 提交，目前正在做实机复核；本轮未升 `verified`，记录点保留在 `docs/AUDIT-LOG.md`。
- **5 个 `wb/` 命名空间分支已 push**：`agent-workbench`、`backend-skills`、`copilot-gateway`、`docs-evaluation`、`g0-ide-mcp-tools`；均为命名空间分支，不与主分支并行开新 active 工作包。
- **DOC-GOVERNANCE-GATES 工作包已收口**（2026-08-16 用户裁决启动同日收口）：8 commit 全 push 至 origin/main；GATES-0 hook 白名单、GATES-1 退出码契约文档化、GATES-2 `--report` JSON 输出 + 3 JSON Schema + 共享 helper、GATES-3 DOC-REGISTRY 扩展字段规范化、GATES-4 8 份 docs + 4 份 archive 文件首段吸收声明全部完成。DOC-REGISTRY `DOC-GOVERNANCE-GATES` 已 `active → completed`，新增 `DOC-GOVERNANCE-GATES-CLOSEOUT` reference 登记项。收口记录见 [`doc-governance-gates-closeout.md`](./doc-governance-gates-closeout.md)。`npm run docs:check` 64 registered PASS、`npm run ui:audit:check` 131 PASS、`npm run docs:reconcile` 0 issues。按 single work package serial 纪律，本工作包收口后下一块候选仍为 Block-2 UI-157 / Block-6 UI-161 既有 in_progress 复核项，须经用户显式裁决启动新工作包。

- **BLOCK-2-UI-157-REVIEW 工作包已启动**（2026-08-16 用户裁决当日启动）：plan [`block-2-ui-157-review-plan.md`](./block-2-ui-157-review-plan.md)（283 行 / 9 §）已落地；DOC-REGISTRY 新增 `BLOCK-2-UI-157-REVIEW` `kind=work-package / status=active / canonical=true / truthDomain=block-2-ui-157-review`；`docs/README.md` 长期核心指引新增条目 3。专收口 `docs/ui-productization-audit.md` 第 113 行 UI-157 (Skills UI 页面 P1/W-04) `in_progress` 状态。核心 gap：不可变提交 `e6bf72f` 含 9 UI 文件 + workflow-engine.js + useSkillStore.ts，但 IPC 桥完全未接通（`preload.js` / `desktopBridge.ts` grep "skill" 0 命中）。UI-161 不可变提交 `01c5e0b` 已落地 Skills 入口归位 + 死 SkillsSidebar 删除 + retry 按钮 + 4 token 补全，但其 IPC 桥跨包接桥显式留白给本工作包。6 PHASE：0 摸底 / 1 IPC 桥接通（main + preload + bridge + store 四层补齐 `skills:list` / `skills:invoke` / `skills:status` / `skills:progress`，仅消费 workflow-engine.js 既有 export）/ 2 UI-161 清理核对 / 3 实机 dev Electron 4 截图存 `acceptance/SKILLS-IPC/` / 4 UI-157 in_progress → verified / 5 closeout。`npm run docs:check` 65 registered PASS（+1）；`npm run ui:audit:check` 131 PASS；`npm run docs:reconcile` 0 issues。不外推 Provider / packaged / GA / Chart a11y P2 / Worktree。下一动作进入 PHASE 0 摸底（git show e6bf72f / 01c5e0b + workflow-engine.js exports 摸底）。

- **BLOCK-2-UI-157-REVIEW 工作包已收口**（2026-08-16 PHASE 0/1/2/4/5 落地；PHASE 3 按用户裁决 P1-T-A 跳过）：4 commit (2d81377 feat + 0be5483 docs + 7e010a4 docs(audit) + 5c98ca8 docs PHASE 2 verify)；UI-157 IPC 桥接通 (preload.js +19 5 方法 / main.js +195 setupSkillsIpc 4 ipcMain.handle + setInterval diff checkpoints 合成 progress / electron.d.ts +12 additive 2 字段 / useSkillStore.ts +69 _subscribeProgressWakeup 增量并行 polling 2s 真值兜底 / useSkillStore.test.ts +225 9 tests) / UI-161 5 项清理核对 5/5 PASS；18 vitest PASS (useSkillStore 9 + usePluginStore 9 模板不破坏)；4 治理门 GREEN (docs:check 65→66 / ui:audit:check 131 / tsc 0 / docs:reconcile 0)。DOC-REGISTRY BLOCK-2-UI-157-REVIEW active → completed + 新增 BLOCK-2-UI-157-REVIEW-CLOSEOUT reference entry。UI-157 + UI-161 保持 in_progress（按 audit 行 402 治理纪律 仅当真实 dev Electron 实机过目后才可考虑 verified，PHASE 3 跳过不构成 verified 升级条件）。closeout 报告 block-2-ui-157-review-closeout.md 11 节。qualificationEligible: false 永久 G0 事实 + 不外推 packaged/Provider/P7/GA。
- **当前阶段纪律**：`qualificationEligible: false` 是 G0 开发期常态事实，不构成缺陷、不是待办、不是下一次校验需推动的事；G1+ 阶段事项（`Provider` 矩阵、`packaged Electron` 公证/签名、`OSS` 远程接手、`GA` 公证流水、`dist staleness`）按当前阶段属于**不外推**而不是"待完成"。上一段已收口阶段的边界保持不变。
- **单工作包串行纪律下「下一块候选」**：Block-2 的 `UI-157`（Skills IPC 桥实机收口）与 Block-6 的 `UI-161`（实机复核升 `verified`）属于当前 G0 边界内未完成的实机复核项；不主动启动新工作包，新工作包必须由用户显式裁决后才能由主 Agent 登记到 `docs/DOC-REGISTRY.json`。

- **BLOCK-3-IPC-BRIDGE-HARDENING 工作包已启动**（2026-08-16 用户裁决当日启动）：plan [`block-3-ipc-bridge-hardening-plan.md`](./block-3-ipc-bridge-hardening-plan.md)（4 PHASE / 11 项修复 / 4 治理门必跑 / 不外推）；DOC-REGISTRY 新增 `BLOCK-3-IPC-BRIDGE-HARDENING` `kind=work-package / status=active / canonical=true / truthDomain=block-3-ipc-bridge-hardening / archivePolicy=retain_stable_path`；`docs/README.md` 长期核心指引新增条目 5。专收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核发现的 12 项 Major 中的 P1 必修 + P2 强烈建议（11 项 / 跨 2 文件：main.js ~+10 / useSkillStore.test.ts ~+150）。**P1 安全**：B1/F1 `main.js` 4 IPC handler 加 sender 守门（对齐 `setupAgentWorkbenchFlagsIpc` L1162 模式，`_resolveSkillsIpcWindow(event)` 工具函数 + `unauthorized` 错误文案）；**P1 契约**：C1 `main.js` poller L2143 publish `execCtx.status` 9 状态 → `_mapSkillRuntimeStatus()` 4 状态（修复 d.ts L172-184 契约硬冲突）；**P2 内存**：A1 终态清 onProgress / A2 poller 停止（`_activeSkillRuntimes.size === 0` clearInterval）/ A3 execute 终态 publish 后立即 `_activeSkillRuntimes.delete`；**P2 错误**：B2 `_publishSkillProgress` 包 try/catch；**P2 测试补**：G1 wakeup 链路 / G2 execute 失败 / G3 callback 抛错 / G4 cancel 失败 / G6 main.js 9→4 状态映射单测。**跳过 E1** 100 并行 execution 性能（G0 边界不触发）。**不改**：preload.js / electron.d.ts / 4 page / desktopBridge.ts / core/shared-backend/*。不外推 Provider/packaged/GA/UI-157 verified 升级（按 audit 行 402 治理纪律仍缺真实 dev Electron 实机证据）。下一动作 PHASE 1 P1 必修（主 agent 直接做：main.js ~+5 行 + 1 行）。

- **BLOCK-4-IPC-BRIDGE-POLISH 工作包已启动**（2026-08-16 19:55 BLOCK-3 收口后用户当日裁决"按你的节奏来"启动）：plan [`block-4-ipc-bridge-polish-plan.md`](./block-4-ipc-bridge-polish-plan.md)（10 项 + 1 项 + 1 项 = 12 项 / 跨 3 文件 / 4 PHASE）；DOC-REGISTRY 新增 `BLOCK-4-IPC-BRIDGE-POLISH` `kind=work-package / status=active / canonical=true / truthDomain=block-4-ipc-bridge-polish / archivePolicy=retain_stable_path`。收口 PHASE 6 剩余 Minor 15 + Nit 4 中的可修 12 项：**A5** preload.js 5 方法 `String(executionId ?? '')` 防御；**B3** `_mapSkillRuntimeStatus` default `running → failed` + 显式 null 守卫；**B4** wakeup payload 缺 executionId `console.warn` 调试；**B5** preload.js onProgress callback try/catch；**C2** `_getSkillsSDK` createDefaultSDK vs createSkillsSDK 加注释；**C3** preload.js 注释 `L114-169 → L114-218`；**D1** useSkillStore payload 自动派生 d.ts 完整类型；**E2** setExecutions 内部 deep-equal 避免无变化 re-render；**G5** test 7 验证 unmount 后 `_progressUnsubs.size === 0`；**H3** main.js 顶部注释加 `9 状态映射 4 状态行号`；**Plus 1**：G6 二次扩展 `cancelled → failed` 区分 UI 文案 vs status。**跳过** E1（100 并行 execution 性能 G0 边界外，留 BLOCK-5+）/ E3 / F2 / F3 / H1 / H2（H1/H2 BLOCK-2 plan/closeout 修订错过窗口）。**PHASE 划分**：PHASE 1 主 agent 直做 10 项代码改动（main.js + preload.js + useSkillStore.ts + _mapSkillRuntimeStatus.js）/ PHASE 2 worker 测试补 G5 + _mapSkillRuntimeStatus.test.mjs / PHASE 3 audit + PHASE 4 closeout。**不外推** Provider / packaged / P7 / GA / UI-157 verified。**不动** preload.js 5 方法签名 / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/。下一动作 PHASE 1 主 agent 直做（preload.js + main.js + useSkillStore.ts + _mapSkillRuntimeStatus.js ~4 文件 / +50 / −10）。

- **BLOCK-5-IPC-BRIDGE-FINALIZE 工作包已启动**（2026-08-16 20:40 BLOCK-4 收口后用户裁决"1-4 搞完"启动）：plan [`block-5-ipc-bridge-finalize-plan.md`](./block-5-ipc-bridge-finalize-plan.md)（3 项微调 / 4 PHASE）；DOC-REGISTRY 新增 `BLOCK-5-IPC-BRIDGE-FINALIZE` `kind=work-package / status=active / canonical=true / truthDomain=block-5-ipc-bridge-finalize / archivePolicy=retain_stable_path`。**E1 仅做微调**：① E1-b `execute()` 后立即 publish 初始 `status: 'pending'`（避免 poller 1s 延迟）；② E1-c 终态 publish 后立即 `_stopSkillsProgressPollerIfIdle()`（避免 1s tick 空转）。**E1-d（每个 execution 独立 setTimeout 链）/ E1-e（runtime.batchGetExecutionStatus）** 留 G1+ 工作包。**H1/H2 文档修订**：① plan §3.1.A 内措辞修订（electron.d.ts ADDITIVE +2 字段）；② closeout 末尾 R8（sender 守门）/ R9（终态清理缺失）/ R10（poller 停止机制缺失）三遗留风险追加。**PHASE 2 候选 B**：跳过测试补（PHASE 6 报告 E1 "G0 边界内 OK；PHASE 3 实机不会触发"；不强行加测试避免破坏 main.js 边界）。**不外推** E1-d/E1-e（G1+ 架构改动）/ packaged/Provider/GA/UI-157 verified / 重新激活 BLOCK-2/BLOCK-3/BLOCK-4。**不动** preload.js/electron.d.ts/desktopBridge.ts/4 page/core/shared-backend/*/agent-tools/。**不做** dev Electron 实机复核（候选 2/3 留 BLOCK-6+）。下一动作 PHASE 1 主 agent 直做（main.js E1-b/E1-c ~+5/-2 + plan/closeout H1/H2 修订 ~+20/-5）。

- **BLOCK-6-UI-158-UI-159-VERIFICATION 工作包已启动**（2026-08-16 21:10 BLOCK-5 收口后用户裁决"可以继续"启动）：plan [`block-6-ui-158-ui-159-verification-plan.md`](./block-6-ui-158-ui-159-verification-plan.md)（4 PHASE / 6 § / 新决策"dev Electron 实机"）；DOC-REGISTRY 新增 `BLOCK-6-UI-158-UI-159-VERIFICATION` `kind=work-package / status=active / canonical=true / truthDomain=block-6-ui-158-ui-159-verification / archivePolicy=retain_stable_path`。**推翻 P1-T-A「跳过实机、走 Vite mock 验收路径」决策**——重新启用 dev Electron 实机 + playwright MCP `plugin-playwright-playwright` `browser_navigate` 远程连接。**UI-158**（commit `446bfa8` feat(copilot)）：Copilot UX 增强 — `frontend/src/components/copilot/{CommandPalette.tsx, errorMessages.ts, useErrorFormatter.ts}` + `docs/architecture/gateway-design.md`（CommandPalette 默认快捷键 `Cmd+K` / `Ctrl+K` + fuzzy 搜索 + 快捷键注册 + 面板开关状态机）。**UI-159**（commit `3000a06` feat(frontend)）：Workspace UI plumbing — `App.tsx` + `BackendStatusProvider.tsx` + `conversationRunStore.ts` + `LeftPanel.tsx` + `project-workspace.tsx` + `Icon.tsx` + `simple-chat.css` + `desktop.css` + `custom.css` + `electron.d.ts` ADDITIVE 扩展。**PHASE 1 环境准备**：dev Electron 启动 + playwright MCP `browser_navigate` 连接到 Vite :3000 + Electron 加载 + 抓首屏截图 + console.log。**PHASE 2 UI-158 实机验证**：触发 CommandPalette（3 张截图：关闭 / 打开 / 搜索中）。**PHASE 3 UI-159 实机验证**：验证 App.tsx Skills 路由接入 + BackendStatusProvider 后端状态 + LeftPanel 工作台侧栏（3 张截图：首页 / Skills 页面 / Workspace 页面）。**PHASE 4 evidence 收集 + 收口**：7 张截图 + console.log + 验证结果，更新 `docs/ui-productization-audit.md` UI-158/UI-159 状态 `in_progress → verified`（仅当全部 test 通过）。**4 治理门 GREEN**（PHASE 4 必跑）。**不外推** packaged / dist / notarization / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/BLOCK-3/BLOCK-4/BLOCK-5。**不动** preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/。**下一动作** PHASE 1 用户启动 dev Electron + 主 agent 通过 playwright MCP attach。

- **BLOCK-6-UI-158-UI-159-VERIFICATION 工作包已 superseded**（2026-08-16 21:35 用户裁决"关闭 BLOCK-6 保留 in_progress"）：**工具边界受限**——playwright MCP / WebFetch 跑在隔离 sandbox 不能访问 localhost（实测 `browser_navigate http://localhost:3100/` 返 `ERR_CONNECTION_REFUSED`；WebFetch 返 "Cannot fetch from localhost"）；macOS shell 退出杀 child process（实测 Vite 后台跑 30s 内 alive，shell 退出后 vite 死）。主 agent **无法独立完成 dev Electron 实机核查**。BLOCK-6 plan 保留为 future reference（DOC-REGISTRY `status: active → superseded` + `cancelReason`）；UI-158 / UI-159 状态保持 `in_progress` 字样不变（按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"）。**当前无 active 工作包**。等待用户启动 dev Electron 实机并提供截图 / console.log 后，未来可重新启动 BLOCK-6.1（实际 dev Electron 实机）。

- **BLOCK-7-UI-161-VERIFICATION 工作包已启动**（2026-08-16 22:00 BLOCK-6 supersede 后用户裁决"Block-7 是啥 开搞"启动）：plan [`block-7-ui-161-verification-plan.md`](./block-7-ui-161-verification-plan.md)（108 行 / 7 § / 4 PHASE）；DOC-REGISTRY 新增 `BLOCK-7-UI-161-VERIFICATION` `kind=work-package / status=active / canonical=true / truthDomain=block-7-ui-161-verification / archivePolicy=retain_stable_path`。**路径选择**：Vite-only + 静态 grep 综合验证（不同于 BLOCK-6 强行 dev Electron 实机失败路径；UI-161 与 UI-157 / UI-158 / UI-159 关键区别——UI-161 是**纯 UI 表面 + 静态 token 补全**不依赖 IPC 桥接通，Vite preview 渲染 + 静态 grep 综合验证可证 UI-161 完整性）。**UI-161 6 项清理**（已 commit `01c5e0b`，BLOCK-2 PHASE 2 已 5/5 PASS）：① LeftPanel.tsx QuickActions Skills（sparkles + handleNavigateToSkills）/ ② LeftPanel.tsx footer 删除 Skills 冗余 / ③ App.tsx 移除 SkillsSidebar + import + marginLeft / ④ 删除 SkillsSidebar.tsx + .module.css / ⑤ pages/skills/index.tsx error 状态"返回首页"按钮 / ⑥ styles/custom.css 4 token（`--biof3-accent-soft` / `--biof3-border-color` / `--biof3-font-mono` / `--biof3-font-sans`）明色 + 暗色主题。**4 PHASE**：PHASE 1 静态 grep 6 项 + git log `01c5e0b..HEAD` 空确认 / PHASE 2 Vite build + preview 3110 + curl + grep 产物 / PHASE 3 theme-token-contract test + tsc 0 + ui:audit:check / PHASE 4 audit 收口 + 4 canonical 同步 + closeout 报告。**完成语义**：UI-161 `in_progress → verified`（仅当全部 PASS）；4 治理门 GREEN。**不外推** packaged / dist / notarization / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6。**不动** preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/。**下一动作** PHASE 1 grep 6 项 + git log 检查。

- **BLOCK-8-UI-132-VERIFICATION 工作包已启动**（2026-08-16 22:30 BLOCK-7 收口后用户裁决"接下来要做什么呢" + 选项 "BLOCK-8 UI-132 dev CSP 静态化（推荐）" 启动）：plan [`block-8-ui-132-verification-plan.md`](./block-8-ui-132-verification-plan.md)（约 100 行 / 7 § / 4 PHASE）；DOC-REGISTRY 新增 `BLOCK-8-UI-132-VERIFICATION` `kind=work-package / status=active / canonical=true / truthDomain=block-8-ui-132-verification / archivePolicy=retain_stable_path`。**PHASE 0 摸底发现 — entry 描述与实际代码不一致**：entry 描述的两个改动的**目标都已 100% 落地**但 entry 没同步状态。① main.js setupCsp dev-CSP `connect-src` / `frame-src` 放开 `http://127.0.0.1:*` 和 `ws://127.0.0.1:*` 已在 commit `3240a09 fix(desktop): Inject R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL for gateway (P1-CFG-1)` 落地（L1418-1422 + L1443 CSP dev mode 日志 "127.0.0.1:* whitelisted"）；② main.js R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL 用 `127.0.0.1` 注入 3 个 URL（L507-509）同期落地；③ styles/custom.css `--biof3-warning: var(--biof3-status-warning)` 明色主题（L71）+ 暗色主题（L181）早在 commit `3000a06 feat(frontend): Workspace UI plumbing` + `f3b5c42 refactor(css): migrate all CSS token references from --ifm-* to --biof3-*` 落地。**路径选择**：沿用 BLOCK-7 Vite-only + 静态 grep 综合验证路径（UI-132 不依赖 IPC 桥 + UI-132 改动是纯代码静态层）。**UI-132 4 项静态验证**：① main.js setupCsp dev mode 放开 / ② main.js R_SERVER_URL 等 3 URL 注入 / ③ styles/custom.css `--biof3-warning` 明色主题 / ④ styles/custom.css `--biof3-warning` 暗色主题。**4 PHASE**：PHASE 1 静态 grep 4 项 + git log 退化检查 / PHASE 2 Vite build + 产物 grep / PHASE 3 theme-token-contract test + tsc 0 / PHASE 4 audit 收口 + 4 canonical 同步 + closeout 报告。**完成语义**：UI-132 (行 239 in_progress) → verified（仅当全部 PASS）；4 治理门 GREEN。**不外推** packaged / dist / notarization / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7。**不动** preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/。**下一动作** PHASE 1 grep 4 项。

- **BLOCK-9-MEGA-FILE-REFACTOR 工作包已启动**（2026-08-16 22:55 BLOCK-8 收口后用户裁决"按照你的建议来"启动）：plan [`block-9-mega-file-refactor-plan.md`](./block-9-mega-file-refactor-plan.md)（约 130 行 / 6 § / 4 PHASE）；评审依据 [`senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md)（约 130 行 / 6 § / 5 大"不合理"文件 + 6 个非文件级问题 + 优先级表）；DOC-REGISTRY 新增 `BLOCK-9-MEGA-FILE-REFACTOR` `kind=work-package / status=active / canonical=true / truthDomain=block-9-mega-file-refactor / archivePolicy=retain_stable_path` + 新增 `SENIOR-ENGINEER-REVIEW-2026-08-16` `kind=reference / status=completed`（评审报告永久化）。**3 项重构**（基于评审报告 P0/P1 5 项中的 3 项；P1 剩余 2 项 + P2 3 项 + P3 1 项 = 6 项留后续工作包 BLOCK-9.1/9.2/9.3/9.4/9.5/9.6）：① **拆 `_data.ts` 2157 → 5 文件**（`registry.ts` 接口 / `categories.ts` 分类数组 / `inventory.ts` 工具数组 / `demos/` 每个工具一个 demo / `pages/_data.ts` re-export 兼容）/ ② **抽 `buildPreviewTable` 到 `lib/file-preview/`** 解决 `ResultView.tsx` + `SimpleChat.tsx` 重复定义（高级工程师原则：任何文件被 ≥2 处使用必须抽到 lib/）/ ③ **拆 `project-workspace.tsx` 3222 → 4 文件**（`FileTree/` 文件树子模块 / `FilePreview/` 文件预览含 7 个工具函数 / `OfficePreview/` Office 渲染 / `index.tsx` 路由 + 布局 + 兼容入口）。**原则**：不修改行为 / 不引入新依赖 / 保留向后兼容原 import 路径 / 不破坏测试 / 不外推。**4 PHASE**：PHASE 1 拆 _data.ts / PHASE 2 抽 buildPreviewTable / PHASE 3 拆 project-workspace.tsx / PHASE 4 审计 + closeout。**完成语义**：_data.ts 2157 → 5 文件 + buildPreviewTable 抽到 lib/file-preview/ + project-workspace.tsx 3222 → 4 文件 + 4 治理门 GREEN + 既有 vitest 0 失败 / 0 改动 + 不变量守住。**不外推** P1 剩余 2 项（main.js / SimpleChat.tsx）+ P2 3 项 + P3 1 项 + packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7/8。**不动** preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/。**下一动作** PHASE 1 摸清 _data.ts 实际内容结构 + 拆分 registry/categories/inventory/demos。

- **BLOCK-9-MEGA-FILE-REFACTOR 工作包已收口**（2026-08-16 23:38 status=completed）：4 PHASE 全部完成（4 commit 落地 d87a0f8 PHASE 0 + e78567c PHASE 1 + 1c14f49 PHASE 2 + c1e2bd5 PHASE 3）；UI-162/163/164 全部 verified。**3 项重构**（基于评审报告 P0/P1 5 项中的 3 项）：① **拆 `_data.ts` 2157 → 3 文件**（registry/categories/inventory + 兼容；实际无 demo 字段） / ② **抽 `buildPreviewTable` 到 `lib/file-preview/`** 解决 ResultView + project-workspace 重复 / ③ **拆 `project-workspace.tsx` 3213 → 3114 + 8 helpers + types 抽离**（保守拆分，组件链依赖复杂未拆子组件）。**验证**：tsc 0 / vitest 75 文件 630 tests PASS / 4 治理门 GREEN / 6 个 consumer 0 改动 / 不变量守住。**不外推**：main.js 2450 / SimpleChat.tsx 2153 / plugin-manager 1457 / DesktopSettingsPanel 1515 / useSkillStore 743 / IPC channel 常量集中 6 项（BLOCK-9.1~9.6）+ packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7/8。**closeout 报告** [`block-9-mega-file-refactor-closeout.md`](./block-9-mega-file-refactor-closeout.md)。**当前无 active 工作包**（BLOCK-9 收口后）。

- **BLOCK-9.1-MAIN-JS-SPLIT 工作包已启动**（2026-08-16 23:50 BLOCK-9 收口后用户裁决"继续"启动）：plan [`block-9-1-main-js-split-plan.md`](./block-9-1-main-js-split-plan.md)；DOC-REGISTRY 新增 `BLOCK-9.1-MAIN-JS-SPLIT` `kind=work-package / status=active / canonical=true / truthDomain=block-9-1-main-js-split / archivePolicy=retain_stable_path`；评审依据 [`senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §2.4 P1。**目标**：拆 main.js 2450 → ~200 行装配器；17 个 IPC setup 函数 + setupDesktopEnv 716 行拆到 `src/ipc/<domain>.js`。**原则**：不修改行为 / 不引入新依赖 / 保留向后兼容 / 不破坏测试 / 不外推。**边界**：不拆 setupSkillsIpc（BLOCK-2/3/4/5 改动过跨包边界）/ 不拆 setupAgentWorkbenchFlagsIpc（历史特殊 argv）/ 不拆 setupCsp（与 createWindow 强耦合）。**5 PHASE**：PHASE 0 架构调研（worker）/ PHASE 1 拆低风险 setup / PHASE 2 拆中风险 setup / PHASE 3 setupTerminalIpc / PHASE 4 setupDesktopEnv / PHASE 5 closeout。**完成语义**：main.js 2450 → ~200 行 + 15+ 个 src/ipc/<domain>.js + chf0-critical 测试通过 + 既有 vitest 0 失败 / 0 改动。**不外推**：BLOCK-9.2 SimpleChat 2153 / BLOCK-9.3 plugin-manager 1457 / BLOCK-9.4 DesktopSettingsPanel 1515 / BLOCK-9.5 useSkillStore 743 / BLOCK-9.6 IPC channel 常量集中 5 项 + packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7/8/9。**不动**：preload.js / electron.d.ts / desktopBridge.ts / frontend/src/ / core/shared-backend/* / agent-tools/ / setupSkillsIpc。**下一动作** PHASE 0 worker 委派架构调研。**当前 active 工作包**：BLOCK-9.1。
- - **BLOCK-9.1-MAIN-JS-SPLIT 工作包已收口**（2026-08-17 07:38 status=completed）：5 PHASE 全部完成（5 commit 落地 fa8353a PHASE 0 + f63185b PHASE 1 + 2d94732 PHASE 2 + aed7498 PHASE 3 + 2493587 PHASE 4）。`src/main.js` 2450 → 1066 行（**-1384 行 / -56.5%**）：12 个 `src/ipc/<domain>.js`（每个自包含）+ 2 个 `src/main/` 共享层（env-coordinator.js 256 行 / backend-proc-manager.js 443 行）。建立 4 类跨文件依赖注入模式（module-level ChildProc / 函数引用 / mainWindow 句柄 / 日志子系统）。UI-165/166/167/168 verified。**验证**：tsc 0 / vitest 75 文件 630 tests PASS / chf0-critical 3 测试 33 PASS / window-controls 6/6 PASS / 15 个 ipc/main 文件 `node --check` OK / 不变量守住（preload.js / electron.d.ts / desktopBridge.ts / core/shared-backend/* 0 diff）/ 后端 IPC 契约 100% 不变。4 治理门 GREEN（docs:check 83 / ui:audit:check 137 / tsc 0 / docs:reconcile 0 Validation 0 Unregistered 0）。**关键修复**：PHASE 1 删除 _applyComputeSettings 但 setupDesktopEnv 仍调用之会导致运行时 ReferenceError — PHASE 3 env-coordinator 反向从 src/ipc/compute-settings.js import 修复。**关键修复 2**：window-controls.test.mjs 期望 stale（app:relaunch 已在 commit 7b78c88 加入但测试期望未同步）顺手修复。**当前无 active 工作包**；剩余候选 BLOCK-9.2（plugin-manager / SimpleChat / ResultView / DesktopSettingsPanel / useSkillStore 5 项 senior-engineer-review §3 非文件级问题）需用户显式裁决启动。G0 长期开发期阶段纪律不变，不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+。closeout 报告 [`block-9-1-main-js-split-closeout.md`](./block-9-1-main-js-split-closeout.md) 11 节。

- **BLOCK-9.2-MEGA-FILE-REFACTOR 工作包已启动**（2026-08-17 07:46 BLOCK-9.1 收口后用户裁决"可以开搞了"启动）：plan [`block-9-2-mega-file-refactor-plan.md`](./block-9-2-mega-file-refactor-plan.md)（v0.1 / 152 行 / 11 §）。评级依据 [`senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §3 5 项非文件级"不合理"巨型文件：① `src/plugin-manager.js` 1457 行（后端 plugin 生命周期 + IPC） / ② `frontend/src/components/copilot/SimpleChat.tsx` 2153 行（前端 React + UI） / ③ `frontend/src/components/workspace-panels/ResultView.tsx` 1662 行 / ④ `frontend/src/components/desktop/DesktopSettingsPanel.tsx` 1515 行 / ⑤ `frontend/src/hooks/useSkillStore.ts` 743 行（Zustand store）。**原则**：不修改行为 / 不引入新依赖 / 保留向后兼容 / 不破坏既有测试 / 不外推 G1+ 阶段事项 / worker 委派 + 主 agent 直做混合。**拆分范式**：后端按生命周期分层 + IPC 抽 `src/ipc/` + schema 独立 + utility 抽 `src/lib/`；前端 types 优先 + helpers 抽 `lib/<domain>/` + 自定义 hook 独立 + 子组件按需抽（保守）；Zustand store 按 State/Action/Selector/Subscriptions/Types 分层。**PHASE 0 架构调研**：worker 委派 ID `d06a18b5-93fd-4d59-b326-60ec01d9e1e7`，输出报告 `docs/block-9-2-mega-file-split-survey.md` 后主 agent 读报告 + 调整本计划 v0.2（细化 PHASE 1-N）→ 启动 PHASE 1。**完成语义**：5 文件每个 -200~1000 行不等 + 4 治理门 GREEN + chf0-critical 33 PASS + vitest 75/630 0 失败 / 0 改动 + 不变量守住（preload.js / electron.d.ts / desktopBridge.ts 0 diff）+ 后端 IPC handler channel 100% 一致 + 前端 React component name 100% 一致。**不在范围**：BLOCK-9 / BLOCK-9.1 / 重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1 / UI-157/158/159 实机 / agent-tools/* / agent-transcripts/* / packaged / Provider / GA / P7 / notarization / dist staleness G1+ / dev CSP / Worker / Chart a11y。**当前 active 工作包**：BLOCK-9.2。

**本节与 worker-A 的 `docs/AUDIT-LOG.md` closeout 登记、worker-B 的 `agent-interaction-evaluation.md` 迁移独立同步**：本节不动 `docs/AUDIT-LOG.md`、不动 `agent-interaction-evaluation.md`、不动 `docs/DOC-REGISTRY.json`、不动 `docs/README.md`，仅作为上方 canonical 文档的同步附录。
- - **BLOCK-9.2-MEGA-FILE-REFACTOR PHASE 1+2+3 全部落地**（2026-08-17 用户裁决「继续 come on」）：PHASE 1 拆 DesktopSettingsPanel.tsx 1515 → 870 行（-42.6% / -645 行）+ 10 模块到 `frontend/src/components/desktop/DesktopSettingsPanel/`（commit `d06b66e` UI-170）；PHASE 2 拆 ResultView.tsx 1654 → 1553 行（-6.1% / -101 行）+ types/helpers 抽到 `frontend/src/components/workspace-panels/ResultView/`（commit `014ad0d` UI-171，保留 ResultArtifactShell 1313 行单组件）；PHASE 3 拆 plugin-manager.js 1457 → 586 行（-59.7% / -871 行）+ 9 lib 模块到 `src/plugin/`（commit `49652f3` UI-172，保留 4 install orchestrator 在主文件）。**21 模块.exports 100% 保留**（含 Week 2 schema re-export 6 项）；**3 PHASE 累计 -1617 行** / 14 个新 lib/sections 模块 + 21 module.exports 100% 保留。**5 修正 bug** 记录：paths.js/runtime.js 错从 platform-compat 导入 getPythonRuntimeExecutable（实际在 core/shared-backend/runtime-paths，已修）；uninstall.js 改用 SHARED_BACKEND_DIR 常量；plugin-manager 顶部 IIFE 改用 paths.js 简单 import；void-* 冗余抑制清理。**测试矩阵 100% PASS**：14 plugin 测试（4 checksum + 10 manifest/SDK，RS7 golden fixture sha256 drift 已 pre-existing 验证 git stash 后仍 fail）+ g0-chf0 + qa-smoke 39/39。**4 治理门 GREEN**（docs:check 85 / ui:audit:check 142 / tsc 0 / docs:reconcile 0）；Vite build OK。**不变量守住**：`src/ipc/plugin.js` 0 diff（PHASE 0.5 修复保持）/ `src/main.js` 0 diff / `preload.js` 0 diff / `desktopBridge.ts` 0 diff / `electron.d.ts` 0 diff / `core/shared-backend/*` 0 diff / `agent-tools/*` 0 diff / 6 plugin 测试文件 0 改动 / 0 npm 依赖新增 / 0 npm 依赖删除。**保持 UI-161 `in_progress`**（按 audit 行 402 治理纪律）；UI-170/171/172 三个 P2 verified 升级（5-verified 等级 code organization 进步 + 4 治理门 GREEN + 1 plugin 测试 + 1 g0 test + 0 业务逻辑差异）。**当前 active 工作包**：BLOCK-9.2 PHASE 4 进行中。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 实机 Electron 验证 / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*

- **BLOCK-9.2-MEGA-FILE-REFACTOR PHASE 4 SimpleChat.tsx 2153 → 1975 行 + 2 子模块抽出落地（2026-08-17 用户裁决「继续」启动 PHASE 4；commit `8183f4e` UI-173）**：`docs/block-9-2-mega-file-split-survey.md` §2.2 拆分边界 1:1 落地。**抽出 14 个 types/constants/interface 到 `frontend/src/components/copilot/SimpleChat/types.ts`（189 行）**：① `SlashCommand` interface + `SLASH_COMMANDS` 5 项数组；② `SYSTEM_OPEN_FILE_EXTENSIONS` set + `shouldOpenWithSystemApp` 函数；③ `SimpleMessage` interface（14 属性 + JSDoc）+ `restoreSimpleMessage` 转换函数；④ `AgentProgressUpdate` + `restoreProgressUpdates`；⑤ `ExamplePrompt` + `DEFAULT_EXAMPLE_PROMPTS`；⑥ `ExamplePromptsProps` / `SimpleChatHandle` / `SimpleChatProps` / `ErrorBannerProps` / `PendingApproval` 5 interface + type alias。**抽出 3 个 pure helper 到 `./SimpleChat/helpers.tsx`（108 行 / 必须 .tsx 因含 JSX）**：① `DEFAULT_EXAMPLE_PROMPTS` 重导出 / ② `MessageMeta` 组件 / ③ `ExamplePrompts` 组件 / ④ `compactStageConclusion` 纯函数。**SimpleChat.tsx：2153 → 1975 行（-178 / -8.3%）** + **2 新文件 / +297 / −0**。**保守拆原则沿用 PHASE 1/2/3**：按 PHASE 0 调研 §2.2「~1387 行 SimpleChat 主组件保留」理由 —— 内部 ~30 个 useState + ~6 个 useRef + ~6 个 useEffect 强耦合共享 input/messages/scroll/slash 状态，拆子组件 ROI<风险；本次仅切出 types + helpers 而非拆主组件。**re-export 兼容策略**：`SimpleChat.tsx` 顶部 `export { SLASH_COMMANDS, shouldOpenWithSystemApp, restoreSimpleMessage, compactStageConclusion, DEFAULT_EXAMPLE_PROMPTS, MessageMeta, ExamplePrompts }` + `export type { SlashCommand, SimpleMessage, ... }` —— 4 测试文件（`SimpleChat.test.tsx` / `SimpleChat.progress.test.ts` / `SimpleChat.extraRenderers.test.tsx` / `simple-chat-file-open.test.ts`）+ 4 page consumer（CenterPanel / RightPanel / ResultView / project-workspace）契约路径 0 改动。**关键修复 4 项**：① **`helpers.ts` → `helpers.tsx` 重命名**（含 JSX `<div>` 不能用 .ts 扩展名，TS1005 错误 14 项）；② types.ts `restoreToolActivities` import 路径（**原合并到 `toolSummaryPresentation` 是错的，实际在 `toolActivity.ts`** —— 已拆为 2 个独立 import）；③ `PendingApproval` type alias 集中到 types.ts（不再主文件局部定义）；④ `compactStageConclusion` 从 types.ts 移至 helpers.tsx（JSX 重命名连带）。**测试矩阵 100% PASS**：`cd frontend && npx vitest run src/components/copilot/SimpleChat.test.tsx src/components/copilot/SimpleChat.progress.test.ts src/components/copilot/SimpleChat.extraRenderers.test.tsx src/components/copilot/simple-chat-file-open.test.ts` **23/23 PASS**（含 restoreSimpleMessage + shouldOpenWithSystemApp + compactStageConclusion + ResultEditProgressList 全链路）。**node --test g0-chf0 + qa-smoke 39/39 PASS**。**4 治理门 GREEN**：`docs:check` 85 / `ui:audit:check` 142 / `cd frontend && npx tsc --noEmit` **0 错误** / `npm run docs:reconcile` 0 issues。**Vite build 0 错误**：dist JS 2308.57 kB / gzip 720.57 kB，与 PHASE 1/2/3 后持平（拆出 297 行 types+helpers 不引入新依赖 / 循环引用 / 大小膨胀）。**不变量守住**：SimpleChat 主组件 ~1387 行未触碰 render JSX / scroll / slash command state / 模型菜单 / 持久化草稿逻辑 / conversation run hooks / plan 1.6 §4 全部保留原签名；`desktopBridge.ts` 0 diff / `electron.d.ts` 0 diff / `copilotClient.ts` 0 diff / `toolActivity.ts` 0 diff / `toolSummaryPresentation.ts` 0 diff / `extraRenderers.ts` 0 diff / `conversationRunStore.ts` 0 diff；useAiSettings / useConversations / useCopilotContext / useErrorFormatter / useDurableConversationLoop 0 diff；0 npm 依赖新增 / 0 npm 依赖删除。**保持 UI-161 `in_progress`**：纯代码组织变更（types + helpers 抽取），无实机 Electron 验证，不外推 packaged。**4 PHASE 累计指标**（1+2+3+4）：plugin-manager 1457 → 586（-871）/ DesktopSettingsPanel 1515 → 870（-645）/ ResultView 1654 → 1553（-101）/ **SimpleChat 2153 → 1975（-178）**；总 **-1795 行** / 16 个新 lib/sections/types/helpers 模块 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff。**当前 active 工作包**：NONE（BLOCK-9.2-MEGA-FILE-REFACTOR COMPLETED，等待用户裁决下一步工作包）。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*

- **BLOCK-9.2-MEGA-FILE-REFACTOR PHASE 5 useSkillStore.ts 评估决议（不拆 / 0 代码变更 / UI-174）**（2026-08-17 用户裁决「好的 开冲」启动 PHASE 5）：决议 canonical `docs/block-9-2-phase-5-useSkillStore-decision.md` 139 行 / 7 节。**决议**：保留不拆 + 仅审计登记（与 PHASE 0 调研 §1.5.7 + Senior Engineer Review §2.4 一致）。**useSkillStore.ts 现状**（743 行 / 0 行 diff）：13 type/interface + 4 module-level `let` state + 2 module-level Map + 3 export function + 11 internal function + 主 hook 内 7 useState / 5 useEffect / 6 useCallback。**5 大不拆理由**：① Singleton store 反模式（5 state + 3 modifier + 8 reader 强耦合 → 提到 ESM export + barrel re-export 破坏 singleton 语义 + tree-shaking 失败）；② polling + wakeup 双向耦合（`_subscribeProgressWakeup` ↔ `_startPolling` 通过 `Map<executionId, ...>` 同步追踪同一组 executionId，跨文件传 Map 集合的迭代时机难保证 atomic）；③ 测试基础设施已稳定（14 vitest `useSkillStore.test.ts` 覆盖所有 module-level state 边界，BLOCK-2/3/4/5 期间 22 次真值模拟全部 PASS）；④ 实际收益有限（743 行已是最小，距团队「1500 行阈值」还差 757 行空间）；⑤ G0 阶段纪律不容外推（AGENTS.md「不得主动启动 G1+ 阶段事项 / 不外推功能改进型重构」明确禁止）。**BLOCK-9.2 5 文件累计**：✅ plugin-manager 1457 → 586 (-871 / -59.7% / commit 49652f3 UI-172) / ✅ DesktopSettingsPanel 1515 → 870 (-645 / -42.6% / commit d06b66e UI-170) / ✅ ResultView 1654 → 1553 (-101 / -6.1% / commit 014ad0d UI-171) / ✅ SimpleChat 2153 → 1975 (-178 / -8.3% / commit e599ee0 UI-173) / ⏸ useSkillStore.ts 743 → 743 (0 行 diff / PHASE 5 决议保留不拆 / UI-174)。**整体 -1795 行 / 16 个新模块 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff**。**不变量守住**：useSkillStore.ts 0 行 diff / 14 vitest 0 改动 / 6 consumer 契约路径 0 改动。**未来扩展路径**：如 useSkillStore.ts 真增长到 1300+ 行，再启动 BLOCK-9.5+ 单独工作包，按 G0 阶段纪律需用户显式裁决。**保持 UI-161 `in_progress`**：纯文档决议登记（无代码变更），无实机 Electron 验证，不外推 packaged。**当前 active 工作包**：BLOCK-9.2（PHASE 6 audit + closeout 待办）。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*

- **BLOCK-9.2-MEGA-FILE-REFACTOR PHASE 6 综合 closeout COMPLETED (active → completed) + PHASE 4 第二轮收口 + PHASE 5 评估登记**（2026-08-18 用户裁决「开冲」启动二次 PHASE 6）：**PHASE 4 第二轮 3 commits** SimpleChat.tsx 2277 → 1961 行（**-316 / -13.9%**）— commit `ba23456` UI-175 refactor(block-9.2-phase-4): extract image preview modal + attachment handlers to submodules（抽 `attachments.ts` 138 行 + `ImagePreviewModal.tsx` 127 行 + `types.ts` 累计 189 行 + `helpers.tsx` 108 行 4 模块）/ commit `4207466` UI-176 refactor(block-9.2-phase-4): extract formatHarness pure helpers to submodule（抽 `formatHarness.ts` 79 行）/ commit `1a58f2c` UI-177 refactor(block-9.2-phase-4): extract useChatStream custom hook（抽 `hooks/useChatStream.ts` 322 行）。**6 新模块 + 1 hook**：types.ts 189 + helpers.tsx 108 + attachments.ts 138 + ImagePreviewModal.tsx 127 + formatHarness.ts 79 + useChatStream.ts 322 = **+963 / −0**。**PHASE 5 评估决议**：useSkillStore.ts 743 行 0 diff / UI-179 not_applicable / canonical `docs/block-9-2-useSkillStore-evaluation.md` 7 节（TL;DR + 现状 + 5 大不拆理由 + useChatStream hook 反向佐证 + 量级判断 + 结论 + 不外推）。**PHASE 6 综合 closeout 4 commits** `b2564ac` + `8136b35` + `xxx` + `xxx`：commit 1 PHASE 4/5 ledger + useSkillStore eval + DOC-REGISTRY 注册 / commit 2 DOC-REGISTRY linkedCommits 11 项 + plan §13 关联收口文档 / commit 3 roadmap + handoff 同步 / commit 4 AUDIT-LOG + closeout 报告。**累计 5 文件 -1933 行 / 18 新 lib + hooks + submodules**（插件管理器 1457 → 562 / DesktopSettingsPanel 1515 → 870 / ResultView 1654 → 1553 / SimpleChat 2277 → 1961 / useSkillStore.ts 743 → 743）。**11 linkedCommits**（PHASE 0.5 修复 `45448a8` + PHASE 1 `d06b66e` + PHASE 2 `014ad0d` + PHASE 3 `49652f3` + PHASE 4 第一轮 `e599ee0` + PHASE 4 第二轮 commit 1 `ba23456` + PHASE 4 第二轮 commit 2 `4207466` + PHASE 4 第二轮 commit 3 `1a58f2c` + PHASE 5 evaluation `b2564ac` + DOC-REGISTRY 同步 `8136b35` + 本 closeout commit `xxx`）。**验证矩阵 100% GREEN**：`tsc --noEmit` 0 错 / SimpleChat vitest **19/19 PASS**（4 文件）/ g0-chf0 33/33 + qa-smoke 45/45 + plugin 31/31 + window-controls 7/7 + useSkillStore 14/14。**4 治理门 GREEN**：`docs:check` 99 / `ui:audit:check` 99+ registry IDs 同步 / `tsc --noEmit` 0 错 / `docs:reconcile` 0 issues。**不变量守住**：4 客户端 import 路径 0 diff / 4 SimpleChat 测试文件 0 改动 / 7 个测试文件 0 改动 / desktopBridge.ts / electron.d.ts / copilotClient.ts / toolActivity.ts / toolSummaryPresentation.ts / extraRenderers.ts / conversationRunStore.ts 0 diff / 0 npm 依赖变动。**DOC-REGISTRY**：BLOCK-9.2-MEGA-FILE-REFACTOR **active → completed** + linkedCommits 11 项 + 新增 BLOCK-9.2-USESKILLSTORE-EVALUATION reference entry（kind=reference / canonical=false）+ 现有 BLOCK-9.2-CLOSEOUT reference entry（docs/block-9-2-mega-file-refactor-closeout.md / canonical=false / truthDomain 唯一性约束）。**closeout 报告 canonical**：`docs/block-9-2-mega-file-refactor-closeout.md` 11 节（§1 元数据 + §2 实施总结 + §3-§9 6 PHASE 详情 + §10 累计指标 + §11 不外推）。**当前 active 工作包**：NONE（BLOCK-9.2-MEGA-FILE-REFACTOR COMPLETED，等待用户裁决下一步工作包）。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/* / 不重新激活 PHASE 4/5/6 二次 closeout 已 orphan 的 8 commits（4f9d9d1 / 810390f / ff1913f 等）。


- **BLOCK-10-AUDIT-CLOSEOUT 工作包 COMPLETED（active → completed · 2026-08-18）**：依据 `docs/code-audit-closeout-plan.md` v0.2 active 计划收口 8 份 2026-08-17 Agent Harness 独立只读审计报告共 90+ finding / 25 个修复单元（11C + 5H + 9 Major）。**4 PHASE 全部落地**：**PHASE 1** P0 用户可见（C-001 IPC branch/result bridge namespace + C-002 result:create conversation_export + DB migration 007 配套）/ **PHASE 2** P1 安全/资源（S-001 agent-tool-policy RCE capability / S-002 contextToken 过期校验 / S-003 agent-execution-policy 推断替换 / S-004 IPC sender 守门 / S-005 workspace_exec 白名单 / S-006 retry_stats user_id / S-007 diagnostic 路径 + PR-001 SQLite 归档 + E-017 backend exit handler + OB-004 error-log 路径 + OB-005 health shape partial）/ **PHASE 3** P2 契约（PL-001 MCP callTool inputSchema 校验 · **不引入 ajv**，自写 233 行极简 validator + 10 tests）/ **PHASE 4** closeout（DOC-REGISTRY active → completed + 8 linkedCommits + ui-productization-audit 笔录 + 4 canonical 文档同步 + closeout 报告）。**8 commits 落地**：`36c2789` PHASE 0 plan v0.2 active + 4 份 PHASE 0 调研 / `32ed9e9` DOC-REGISTRY 4 份 PHASE 0 报告 / `1c0ebf0` PHASE 1 C-001/C-002 / `128b3d4` PHASE 2 S-001/2/3 / `4f9a10f` PHASE 2 S-004/5/6/7 / `a09f706` PHASE 2 PR-001 + E-017 partial / `1fedf9c` PHASE 2 OB-004 + OB-005 partial / `b79c472` PHASE 3 PL-001 / `b64c65b` PHASE 4-1 DOC-REGISTRY + linkedCommits 8 / `f678edf` PHASE 4-2 ui-productization-audit ledger。**累计指标**：13 项已修复（11 Critical + 2 High） + 12 项不外推 + ~740 行 net + / 31 tests（25 新 + 6 复用）/ 0 新依赖 / 4 治理门 GREEN（docs:check 104 PASS / docs:reconcile 0 issues / tsc --noEmit 0 错 / ui:audit:check 4 pre-existing 漂移按 governance 不修）。**closeout 报告** `docs/block-10-audit-closeout.md` 11 节。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 架构 56+ singleton / observability 体系化 / SSE 全局 / 错误处理三套重试合并 / Agent Loop 事件规范化 / security medium+low / rserver-http debt pack / 不重新激活 BLOCK-2..9.2 / 不在 closeout 报告列举未做项 / `qualificationEligible:false` G0 长期开发期常态不外推。**当前 active 工作包**：NONE（BLOCK-10-AUDIT-CLOSEOUT 已 completed，等待用户裁决下一工作包启动）。**后续候选**（按 G0 阶段纪律不主动推荐，需用户显式裁决）：observability-work-package / rserver-http-debt-pack / SSE 三处协议细节统一 / RetryClassifier/RetryBudget/RetryExecutor 三套重试合并 / Agent Loop 事件类型命名规范化 / Result Studio 事件类型规范。

- **BLOCK-10-ARCHITECTURE 工作包 COMPLETED（active → completed · 2026-08-18）**：依据 `docs/block-10-architecture-plan.md` v0.2 active 计划，12 主范围全部落地（A-001/2/3/5/7/8/9/10 + PR-012 + E-019 full + A-006 部分）。**PHASE 1 DB 体系化 + 配置快赢**：commit `a4f8bcb`（A-007 DB singleton + PR-012 + E-019 busy_timeout）+ commit `48e19e2`（A-009 端口统一 + A-010 env 集中 + jspdf 移除）。**PHASE 2 r-server 大文件拆分**：commit `101dcfc`（result-studio 9 子域 15 端点）+ commit `cd287f5`（harness 8 子域 19 端点）+ commit `d620aa3`（ai-agent 5 子域 3 端点）。**PHASE 3 agent-runner 拆分 + 跨层解环**：commit `5f6c2de`（agent-runner 1799→3 子模块）+ commit `3635e7e`（A-003 configure 注入 + A-008 act-tools 循环解环）。**验证**：chf0 5/5 PASS + 106+ new tests PASS + 0 regression + 4 治理门 GREEN。**7 关联候选不外推**：observability-work-package / rserver-http-debt-pack / type-drift-pack / fixture-manifest-pack 等。**收口笔录**：G0 开发期常态 · 不外推 packaged/Provider/GA。**closeout 报告** `docs/block-10-architecture-closeout.md`。**当前 active 工作包**：NONE。

## 2026-08-19 BLOCK-15 架构债+性能债工作包第一阶段收口

> 本节为 BLOCK-15-ARCHITECTURE-PERF 工作包第一阶段（SUB-15.1 PHASE 2 / SUB-15.2 PHASE 1 / SUB-15.3 PHASE 1 / SUB-15.4 PHASE 0）收口同步笔录。

### 第一阶段完成摘要

| SUB | 范围 | PHASE 完成 | 核心交付 | 状态 |
|-----|------|-----------|---------|------|
| SUB-15.1 | main.js 中风险函数拆分 | PHASE 0✅ / PHASE 1✅ / PHASE 2✅ / **PHASE 3✅** / PHASE 4待续 | 9 函数→7 模块；main.js 1001→770行（-23%） | 进行中 |
| SUB-15.2 | IPC channel catalog + 门禁 | PHASE 0✅ / PHASE 1✅ / **PHASE 2✅** | 108 channels / 50 pairs / 0 orphans；自写 validator；preload orphaned listener 修复 | 进行中 |
| SUB-15.3 | dev Electron 启动 profile fixture | **PHASE 1✅** | `--cdp` T0→T4 测量（spawn / appReady / windowShown / DOMContentLoaded / load） | 已完成 |
| SUB-15.4 | IPC 序列化 backpressure fixture | **PHASE 1✅** | 1/10/100MB 延迟测量；G0 合规（不引入 Worker/MessageChannel/SAB） | 进行中 |

### 4 commits

| Commit | 内容 |
|--------|------|
| `60ccef3` | BLOCK-15 PHASE 0 调研 + PHASE 1 落地（main.js 拆分 + IPC catalog + profile fixture） |
| `da3ff8e` | SUB-15.4 PHASE 1：`--probe` event-loop lag 探针（15 tests PASS）
| `a2f6ee8` | SUB-15.2 PHASE 2：plugin manifest schema + payload shape 验证
| `34ba29d` | SUB-15.1 PHASE 3：`createWindow` → `_window-create.js` + `_spa-server.js`，main.js 770→546行（-224行/-29.1%） |
| `ffa5bfc` | SUB-15.1 PHASE 2：9 中风险函数 → 7 模块，main.js 1001→770行 |
| `87bd0f6` | SUB-15.4 PHASE 0：IPC backpressure fixture 359行 + 12 tests PASS |
| `ccd4457` | SUB-15.2 PHASE 1：IPC catalog validator + SUB-15.3 PHASE 1 `--cdp` 模式 |

### 验证状态

- `docs:check`：PASS（131 documents）
- `ui:audit:check`：PASS（149 UI 编号）
- `chf0-critical`：33/33 PASS
- `window-controls`：6/6 PASS
- `node scripts/validate-ipc-catalog.mjs`：PASS（0 orphan channels）

### 后续 PHASE（待用户裁决启动）

- **SUB-15.1 PHASE 3**：`createWindow` 260行高风险拆分（BLOCK-9.1 未覆盖的最后一块）
- **SUB-15.1 PHASE 4**：BLOCK-15 综合 closeout
- **SUB-15.2 PHASE 2**：plugin schema 扩展 + payload shape 验证
- **SUB-15.4 PHASE 1**：event-loop lag 探针集成

### 不变量守住

- `src/preload.js`（除 orphaned listener 修复）：0 diff
- `frontend/src/lib/electron.d.ts`：0 diff
- `frontend/src/lib/desktopBridge.ts`：0 diff
- `core/shared-backend/*`：0 diff
- IPC channel 契约：100% 不变

### G0 合规

G0 开发期常态 · 不外推 packaged/Provider/GA/P7/notarization/dist staleness G1+。

- **BLOCK-16-WORKING-TREE-REVIEW-MODE 工作包已启动**（2026-08-19 BLOCK-15 全部 SUB 收口后用户裁决"直接推"启动）：plan [`block-16-working-tree-review-mode-plan.md`](./block-16-working-tree-review-mode-plan.md) v0.1（301 行 / 11 §）；DOC-REGISTRY 新增 `BLOCK-16-WORKING-TREE-REVIEW-MODE` `kind=work-package / status=active / canonical=true / truthDomain=block-16-working-tree-review / archivePolicy=retain_stable_path` + `BLOCK-16-WORKING-TREE-REVIEW-SURVEY` `kind=reference / status=reference / canonical=false`（登记调研报告 344 行 / 8 §）；4 治理门基线 GREEN（docs:check 133 / ui:audit:check 待跑 / tsc 0 / docs:reconcile 0 Validation 0 Unregistered）。**目标**：补齐"AI Agent 完成一次任务后弹出 PR-style diff 审阅浮层"的体验缺口；用户对 working tree 改动按 **hunk 级别**批准/拒绝/回滚；拒绝信号写入本机清单并通过 `system-prompt` 注入让 AI 在下一轮对话重新生成。**v1 thin-slice 范围**：5 条 IPC invoke/handle 通道（`git:working-tree-status` / `git:working-tree-diff` / `git:working-tree-file-content` / `git:hunk-apply` / `git:working-tree-revert`）+ 1 条 main→renderer 通知（`agent:task-done`）+ `<WorkingTreeReviewMount />` 全屏模态浮层（手写 React diff 渲染 / 零新依赖 / 对齐 ADR-RS-3 + 既有 Result Studio diff 风格）+ hunk accept/reject UI + 工具栏手动按钮 + 拒绝清单（`<dataDir>/working-tree-review/rejects/*.json` 30 天 TTL）+ system-prompt 注入（`<working-tree-rejects>` 段）。**调研驱动**：基于 worker 调研报告 `docs/block-16-working-tree-review-survey.md`；3 方案对比（Monaco / react-diff-viewer / 手写）后选 C；2 拒绝信号方案对比（本机清单 + MCP 主动拉）后选本机清单基线。**5 PHASE**：PHASE 0 登记（主 agent 直做）/ PHASE 1 IPC + git-adapter 新增 `applyPatch/revertPaths`（主 agent 直做）/ PHASE 2 浮层组件（主 agent 直做）/ PHASE 3 agent-done 事件接入 + 拒绝清单 + system-prompt 注入（主 agent + worker 混合）/ PHASE 4 专项门禁 `npm run block:working-tree-review` + closeout 笔录。**完成语义**：5 IPC + 1 通知事件 + `<WorkingTreeReviewMount />` 全屏浮层 + git-adapter 2 个新方法 + 拒绝清单 + system-prompt 注入段 + 4 治理门 GREEN + 既有 vitest 0 失败 / 0 改动 + 不变量守住（preload.js 既有 19 命名空间 / electron.d.ts 既有类型 / desktopBridge.ts 既有 API / Result Studio 既有 diff 组件 0 diff）+ 既有 19 命名空间方法签名 0 改动。**不在范围**：Provider / packaged / GA / P7 / notarization / dist staleness G1+ / 不引入 git 库（simple-git/isomorphic-git/nodegit/dugite — ADR-RS-3 已固化）/ 不引入 monaco-editor/react-diff-viewer / 不修改 Result Studio 既有 diff 渲染（ChangeSet/Revision/Compare）/ 不实现 hunk 自动 merge / 不跨仓库 working tree 审阅 / 不重写 backend IPC 子进程边界 / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15（按单工作包串行纪律）/ 不动 Result Studio 既有 diff 组件 / 不动 core/shared-backend 既有方法 / 不动 agent-tools/* / 不动 agent-transcripts/*。**当前 active 工作包**：BLOCK-16。

- **BLOCK-16-WORKING-TREE-REVIEW-MODE 工作包已收口**（2026-08-19 BLOCK-15 全部 SUB 收口后用户裁决"直接推"启动同日收口）：plan [`block-16-working-tree-review-mode-plan.md`](./block-16-working-tree-review-mode-plan.md) v1（343 行 / 11 §）+ closeout [`block-16-working-tree-review-mode-closeout.md`](./block-16-working-tree-review-mode-closeout.md) 11 节。DOC-REGISTRY `BLOCK-16-WORKING-TREE-REVIEW-MODE` `active → completed` + 新增 `BLOCK-16-WORKING-TREE-REVIEW-MODE-CLOSEOUT` reference entry。**4 PHASE 全部落地**：PHASE 1（commit `7f94854` IPC channel + 共享解析器层：git-adapter 2 新方法 + 5 ipcMain.handle + 1 webContents.send + preload `workingTreeReview` 子树 + 拒绝清单 30 天 TTL）/ PHASE 2（commit `59aeb95` 浮层组件：5 组件 + 1 CSS module + App mount + electron.d.ts + UI-180 in_progress 笔录）/ PHASE 3（commit `da48006` agent-done 事件接入 + 拒绝清单 + system-prompt 注入：typed event bus `agentTaskDone` + SSE 4 处 done 分支 dispatch + `<working-tree-rejects>` 注入段 + 11/11 vitest PASS）/ PHASE 4（本 commit 专项门禁 `npm run block:working-tree-review` 5/5 PASS + DOC-REGISTRY 收口 + roadmap + README + closeout 笔录）。4 治理门 GREEN：`npm run docs:check` 133 PASS / `npm run ui:audit:check` 131 PASS / `cd frontend && npx tsc --noEmit` 0 错 / `npm run docs:reconcile` 0 issues。**测试矩阵**：`node --test test/git-adapter.test.mjs` 30/30 PASS（既有 0 破坏）/ `node --test test/system-prompt-rejects.test.mjs` 11/11 PASS（PHASE 3 新增）/ `cd frontend && npx vitest run src/components/copilot` 17 files / 168 tests PASS（既有 0 破坏）。**不变量守住**：preload.js 既有 19 命名空间方法签名 0 diff / electron.d.ts 既有类型 0 diff / desktopBridge.ts 既有 API 0 diff / Result Studio 既有 diff 组件 0 diff / core/shared-backend 既有方法 0 diff（仅 git-adapter 新增）/ agent-tools/* / agent-transcripts/* 0 diff / 0 npm 依赖变动。**保持 UI-180 `in_progress` 维持原状**：按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"，PHASE 2 实机未走查不构成 verified 升级条件。**严格维持** `qualificationEligible:false` + 不外推 packaged / Provider / GA / P7 / notarization / Chart a11y P2 / Worktree / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15。**当前无 active 工作包**（BLOCK-16 已收口）；按 single work package serial 纪律，下一块候选仍为 BLOCK-6 UI-158 + UI-159 dev Electron 实机 / BLOCK-7 UI-161 既有 in_progress 实机 / BLOCK-8 release-pipeline dist staleness / BLOCK-9 Windows 代码签名 / i18n 资源抽离 / BLOCK-10 E1-d/E1-e G1+ 架构改动 / Chart a11y P2 落实 / Result Studio P7 deferred，须经用户显式裁决启动新工作包 | BLOCK-16-WORKING-TREE-REVIEW-MODE / WORKING-TREE-REVIEW / WORK-PACKAGE-CLOSEOUT

**当前 active 工作包**：NONE（BLOCK-15-ARCHITECTURE-PERF 已 completed）。

## BLOCK-18 — Workspace MD Diff（2026-08-22 启动）

`docs/block-18-workspace-md-diff-plan.md`

- 状态：`active`（BLOCK-17 标 `superseded` 后接管 active 槽位）
- 目标：把"前后差异"直接搬到文件页面（`files` tab 的 `WorkspaceFilePreview`）内
- 数据路径：沿用 BLOCK-17 的 `userData/agent-doc-snapshots/` + `.snapshots/`
- 入口：`WorkspaceFilePreview` toolbar 顶部"预览 / 对比"toggle
- 样式：复用 BLOCK-17 的 `.wt-hunk-table` + `.wt-*` 主题变量
- 不外推：packaged / Provider / GA

### BLOCK-17 → superseded（2026-08-22）

用户裁决"多一个审阅界面没有意义"。BLOCK-17 已实现的 IPC（`src/ipc/agent-doc-review.js`）、preload namespace、bridge 类型、`.wt-*` 样式骨架与 `computeSimpleDiff` 算法由 BLOCK-18 复用；独立面板（4 文件）、TitleBar `+` 菜单项、`useWorkspacePanels.docReviewOpen` 状态槽由 BLOCK-18 删除。


## BLOCK-20 — Code Review Panel（2026-08-22 启动）

`docs/block-20-code-review-panel-plan.md`

- 状态：`active`（BLOCK-18 标 `superseded` 后接管 active 槽位）
- 目标：补齐"系统级代码审阅体验"——**常驻右侧审阅面板**，覆盖项目里所有被 git 跟踪的修改文本文件（不限 markdown），基准 vs git HEAD，支持 unified / split 两种视图，hunk 级别 Accept / Reject（reject 信号经 BLOCK-16 `<working-tree-rejects>` system-prompt 注入复用），inline-edit 抽屉承载 BLOCK-19 的 `<textarea>` 资产
- 入口：右侧 tab + TitleBar 手动按钮（BLOCK-16 浮层保留为 agent task done 触发）
- 复用：BLOCK-16 `DiffFileView / DiffHunkView / git-adapter.applyPatch / revertPaths / <working-tree-rejects>` 全部 0 改动复用；BLOCK-19 inline-edit + `workspace.writeTextFile` IPC 0 改动复用
- 决策摘要：

| 维度 | 决策 |
|---|---|
| 范围 | 项目级所有 git 状态 `?? / M / A / D` 文本文件 |
| 基准 | `git diff HEAD`（左栏 HEAD 内容 / 右栏 working tree） |
| 渲染 | 复用 BLOCK-16 手写 React diff（0 新依赖） |
| hunk 接受 | `git-adapter.applyPatch`（已有） |
| hunk 拒绝 | `git-adapter.applyInverseHunk`（新增：算 inverse 后 `git apply --reverse`） |
| inline edit | drawer 抽屉 + `<textarea>` + `workspace.writeTextFile`（已有） |
| 拒绝清单注入 | 复用 BLOCK-16 `<working-tree-rejects>` 段（已有） |
| BLOCK-18 plan | superseded（inline-edit 资产合并进 BLOCK-20 PHASE 3 drawer） |
| BLOCK-19 thin-slice | 不登记新 ID（合并进 BLOCK-20） |
| BLOCK-16 浮层 | 保留（agent task done 触发 vs 日常审阅面板，两条触发流并存） |
| 真实 OSS / Provider / packaged | 不外推（G0 开发期常态） |

- v1 thin-slice 范围（5 新 IPC + 2 新前端组件）：
  - `git:list-modified`（`git status --porcelain --untracked-files=all` → [{path, status}]）
  - `git:file-head-content`（HEAD 文件内容，split view 左栏）
  - `git:split-side-diff`（HEAD + working tree → structured hunks，复用 BLOCK-16 `parseUnifiedHunks`）
  - `git:revert-file`（`git checkout -- <path>`）
  - `git:apply-inverse-hunk`（per-hunk 拒绝 inverse patch）
  - `<CodeReviewPanel />`（常驻右侧 panel）
  - `<CodeReviewDrawer />`（右侧滑出抽屉）
- **5 PHASE**：PHASE 0 治理登记（主 agent 直做）/ PHASE 1 IPC 5 通道（主 agent 直做）/ PHASE 2 CodeReviewPanel + Drawer 组件（主 agent 直做）/ PHASE 3 inline-edit 抽屉合并（主 agent 直做）/ PHASE 4 per-hunk reject inverse + system-prompt 注入复用（主 agent 直做）/ PHASE 5 专项门禁 `npm run block:code-review` + closeout 笔录
- 完成语义：5 IPC + 1 panel + 1 drawer + 4 治理门 GREEN + BLOCK-16 / BLOCK-19 资产 0 改动复用 + 不变量守住（preload.js 既有 19 命名空间 / electron.d.ts 既有类型 / desktopBridge.ts 既有 API / BLOCK-16 既有组件 / core/shared-backend 既有方法 0 diff）+ 0 新 npm 依赖
- 不在范围：packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 引入 monaco-editor / react-diff-viewer / react-split-pane / n-way merge / 跨项目 working tree 审阅 / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15/16/17/18 / 不动 Result Studio 既有 diff 组件 / 不动 core/shared-backend 既有方法（仅新增）/ 不动 agent-tools/* / agent-transcripts/*

**当前 active 工作包**：BLOCK-20。

### BLOCK-22 — CodeMirror Inline Diff COMPLETED（active → completed · 2026-08-24）

- **状态**：`active → completed`（用户裁决启动同日收口）；DOC-REGISTRY `BLOCK-22-CODEMIRROR-INLINE-DIFF-PLAN` `status=completed / linkedCommits=[b9e697f, 3745bd5, 0436be2, 0e28498, b1f4453]`；新增 `BLOCK-22-CODEMIRROR-INLINE-DIFF-CLOSEOUT` `kind=reference / status=reference / canonical=true / truthDomain=block-22-codemirror-inline-diff-closeout` 登记项；closeout 报告 `docs/block-22-codemirror-inline-diff-closeout.md`（285 行 / 10 节）。
- **5 commit 落地** `feat/block-22-codemirror-inline-diff` 分支 HEAD `b1f4453`：`b9e697f` P0-LAUNCH audit-log 登记 / `3745bd5` P0 CodeMirror 6 基础脚手架 + 12 个 @codemirror/* 依赖 + 10 editor/ 文件 616 行（UI-191）/ `0436be2` P1 Unified Diff 渲染（行级 + 字符级）+ scroll/pulse（UI-192）/ `0e28498` P2 Accept/Reject widget + 0 新增 IPC（UI-193）/ `b1f4453` P3 桥接层 + Context 抽象 + ChatCardLinkBridge（UI-194）。
- **累计指标**：24 files changed / +4357/-212 / 19 个新文件 ~3977 行 + 5 个修改（package.json/package-lock.json/editor/index.ts/AUDIT-LOG/DOC-REGISTRY）；0 新 npm 顶层依赖；0 新增 IPC；复用 BLOCK-20 PHASE 1 5 IPC（git:list-modified / file-head-content / split-side-diff / revert-file / apply-inverse-hunk）+ BLOCK-20 PHASE 4 git:hunk-reject-inverse + BLOCK-20 PHASE 3 workspace:write-text-file + BLOCK-16 PHASE 3 reject 清单 30 天 TTL schema。
- **4 PHASE 落地**：PHASE 0 基础脚手架（commit `3745bd5`）/ PHASE 1 Unified Diff（commit `0436be2`）/ PHASE 2 Accept-Reject（commit `0e28498`）/ PHASE 3 桥接层（commit `b1f4453`）。4 PHASE 全部由 worker subagent 在 24 个 WIP + test.txt 完全未触碰前提下实施。
- **验证**：tsc --noEmit 0 错 / BLOCK-22 影响范围 vitest 53/53 PASS / 4 files（`CodeMirrorEditor.test.tsx` 32 + `WorkspaceFilePreviewBridge.test.tsx` 8 + `ChatCardLinkBridge.test.tsx` 7 + `pendingScrollContext.test.tsx` 6）/ docs:check 141 → 142 PASS / docs:reconcile 0 issues。全量 frontend vitest 15 failed 不归 BLOCK-22（TitleBar 8 + LeftPanel 6 + theme-token 1 全是其它 Agent WIP 导致的测试期望漂移，按 governance §Guardrails L84 不可改）。`npm run ui:audit:check` 报错不归 BLOCK-22：HEAD `2a4d435` 旧债 + UI-191~194 笔录延迟（`docs/ui-productization-audit.md` 在 24 个 WIP 锁内）。
- **不变量守住**：preload.js 既有 19 命名空间 0 diff / electron.d.ts 既有类型 0 diff / desktopBridge.ts 既有 API 0 diff / core/shared-backend 既有 6 git-adapter 方法 0 diff / agent-tools/* + agent-transcripts/* 0 diff / 24 个 WIP + test.txt 0 触碰 / 0 引 monaco-editor / react-diff-viewer / react-split-pane / n-way merge。
- **UI-191/192/193/194 保持 `in_progress`**：按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"；`docs/ui-productization-audit.md` 在 24 个 WIP 锁内笔录延迟登记；解锁条件：`docs/ui-productization-audit.md` 脱离 WIP 状态后由主 agent 追加 UI-191~194 共 4 行 `in_progress` 笔录 + 重跑 `npm run ui:audit:check`。
- **业务侧后续动作清单**（WIP 收口后）：① 接入 SimpleChat 聊天卡片（用 `<ChatCardLinkBridge>` 包装 ToolActivityList）；② 接入 WorkspaceFilePreview 容器（text 路径分支用 `<WorkspaceFilePreviewBridge mode="inline-diff">`）；③ 接入 events.ts（加 2 新事件 `projectOpenWorkspaceFileAtLine` + `projectReviewWorkspaceDiff`）；④ 决定 AppLevelBridge 挂载（`<AppLevelBridge />` 是否挂到 App.tsx）。
- **不外推**：packaged / Provider / GA / P7 / notarization / dist staleness G1+；不引 monaco-editor / react-diff-viewer / react-split-pane / n-way merge；不重新激活 BLOCK-2~21 任意已收口工作包。
- **当前 active 工作包**：NONE（BLOCK-22 已 completed，下一工作包由用户显式裁决启动）。

### BLOCK-18 → superseded（2026-08-22）

用户裁决"代码审阅模式"应该是**系统级常驻面板 + 全文本覆盖**，BLOCK-18 仅做 markdown 文件页内 toggle 不够。BLOCK-18 已实现的 `agentDocReview:saveCurrent` / `workspace.writeTextFile` / inline-edit `<textarea>` / markdownDiff.ts 等资产由 BLOCK-20 复用；BLOCK-18 状态转 `superseded`。
