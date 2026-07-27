# BioF3 Desktop — Current Next Steps

最后更新：2026-07-27

## 当前结论

`v0.0.1-rc.7` 是当前 OSS 线上版本，已完成代码、自动化、双架构构建、安装候选启动验收和公开更新链核验。Stage 1 UI 产品化、Stage 2 模型层、Stage 3 Harness 与标准流程、Stage 4 首个稳定产品版本及 Harness Phase 7 均已关闭。

当前不默认扩展分析功能。`G0-START`、LF0～LF12 的核心资格保持 maintained；RS0～RS8 的 Result Studio 引擎基础保留，但 2026-07-25 产品复核撤销了 RS9 的完整产品资格结论。Result Studio 当前为 `active / implemented_unverified`，rc.7 仍是工程候选版，不得描述为 GA。

LF12 已按 [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md) 的 Q0～Q7 收口。RS9 曾新增第 17 类 `result_studio_product`，但后续复核发现其五条任务由独立测试拼装、Provider 未执行真实工具闭环、视觉验收依赖人工布尔值、大表由 seed 直接构造；该证据现降级为 unit/synthetic/renderer historical evidence。`result-studio-editing` 在 RS-P7 前暂停 qualified support claim，不能影响或冒充 LF12 原始核心资格。

`G0-CHF0 Critical Cross-cutting Hardening`（[`g0-critical-crosscut-hardening-plan.md`](./g0-critical-crosscut-hardening-plan.md)）的首次 completed 结论已于 2026-07-27 被运行时反例撤销。当前唯一 active canonical 工作包重新为 `G0-CHF0`，按 CHF0-R1～R5 修复科学输出、PCA sample-ID、长任务/进程终态、HTTP 来源边界与 Acceptance 可追溯性。Result Studio P4R-0～P4R-2 既有交付和 non-qualifying 证据不回退；P4R-3 暂停至 CHF0 真实收口。

Result Studio 旧实现的 11 个提交已位于 `main`（检查点 `03e5826`）；`SDC-0 Profile Registry 与版本治理` 也已在分支 `codex/g0-sdc` 的 `7284921` 收口并推送，六个 canonical Profile 与 fail-closed typed DAG 边继续保留。按单工作包串行，`SDC-1`～`SDC-7` deferred，当前不创建 Worktree。

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
  → RS-P7 诚实重新资格
  → 重新评估 SDC-1
```

`G0-RS-P0`～`G0-RS-P3` 已依次收口；P4 Core 已形成 18/18 离线实现检查点并保持 `implemented_unverified`。P3 建立 `ResultStudioContextEnvelope v1` 与 `contextToken`：artifact/family、job、revision（含 current 与 ordinal）、脚本相对路径与 sha256、参数摘要、插件可编辑参数与声明动作、selection、validation、reproducibility 全部由后端从 SQLite/`tool_jobs`/插件 descriptor 重新投影，前端 activeArtifact 只作线索。模型可见 schema 新增 7 个工具（注册表共 32 个），6 个 `*_in_context` 工具的参数中不含 toolJobId/artifactId/revisionId/artifactFamilyId/selectionId；写操作强制校验 token，陈旧上下文返回 `context_token_stale`，intent 指向别的 Revision 返回 `context_intent_mismatch`，"归因只能到 Job"与跨项目 revision 一律 fail-closed。公开进度固定为「理解意图 → 判断影响 → 执行/重算 → 验证 → 候选可比较」五阶段，不展示隐藏推理链。证据为 `acceptance/g0-result-studio/rs-p3-agent-context.json`（20/20，non-qualifying）。

P4 Core 让手动调整与自然语言修改共用同一条编辑链：控件全部由插件 descriptor 的 `parameters` + `parameterImpacts` 投影，缺 impact 声明的参数不可编辑；`volcano-plot` 补齐配色/字体/尺寸/图例/标签/导出共 12 个 presentation 参数并接进真实 R 脚本（此前全为硬编码）。`normalizeEditSubmission` 是手动与 AI 的唯一归一化闸门，类型/范围/枚举 fail-closed 拒绝、未声明参数记为 rejected、与现状相同的提交不产出 patch，因此不会创建空 ChangeSet；影响分级只能由受信 descriptor 提升，调用方无法把科学或流程参数降级成样式修改，未声明 impact 的参数保守落到科学重算。过程中修复既有缺陷：保护字段表原先覆盖 descriptor，使 deseq2 声明为 `workflow` 的 `design` 被悄悄降级成 `scientific`，现在保护字段只作下限。`currentValues` 取自该 Job 真实执行过的归一化参数，不用默认值冒充。证据为 `acceptance/g0-result-studio/rs-p4-unified-editing.json`（18/18，non-qualifying 离线 descriptor 投影/插件接线/注册表/strict build 证据）；真实候选等价链尚未执行，故 UI-109 保持 `in_progress`。

RH0 已按 Truth Snapshot、Hot Context、Test Impact、Script/Temp Lifecycle、Acceptance 串行收口并通过最终基线。当前只允许准备并推进 `G0-RS-P4R Product Reframe`；P4R 未收口前不得启动 P5～P7。详细范围、非目标和出口见 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) §G0-RS-RH0 与 §P4R。

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

Harness Loop Engineering v1 与 Result Studio 引擎基础继续复用。G0 Living Foundation 的 LF12 核心保持 maintained；Result Studio 产品资格暂停并从 RS-P0 重新收口。Scientific Data Contract 的 SDC-0 已收口，SDC-1～SDC-7 延后到 RS-P7 之后重新评估。科学长任务继续走正式 Job/Artifact 链，不能借通用后台进程工具绕过。

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
