# BioF3 Harness Roadmap v1

最后更新：2026-07-13

这份路线图回答三个问题：

1. Harness 现在已经做了什么。
2. Harness 现在正在做什么。
3. Harness 接下来按什么顺序推进，什么时候算完成。

目标是把 Harness 推到真正工程化、可用、可稳定的阶段，而不是停留在“更长的 prompt”。它最终要成为通用的交互式执行底座，生信分析只是首个主场景。

## 2026-07-13 今日 Harness 布局

当前 UI 细节阶段结束后，Harness 工作按以下顺序连续推进：

1. artifact truth boundary 已完成核心闭环：执行结束时校验声明产物与真实文件，统一缺失、空文件、不可读和类型不匹配诊断。
2. 把 artifact diagnostics 接入现有 `failureModes.code + failureModes.detect`，保证前端、Agent 和日志读取同一结构。
3. 真实二跳链路已打通：active artifact → 候选输入 → repair → readiness gate → run_tool → verify outputs。
4. 扩展弱模型回归，至少覆盖成功二跳、缺失上游产物、列名可修复、格式不可修复四类路径。
5. 最后处理 ABI、runtime、canonical path、vendor drift 与三平台 CI；平台问题不得绕过 Harness adapter 边界。

前置 UI checkpoint 已在 2026-07-13 通过 TypeScript、19 项定向测试、Electron 关键脚本语法检查和 SPA 生产构建，并已完成 commit / push；下一步直接进入第 1 项 artifact truth boundary。

今日 Harness 出口条件：

- manifest / DB / status API / disk 的产物状态有唯一可信口径。
- 缺失 artifact 不会进入默认预览或被当作成功输入。
- 至少一条真实二跳分析链路有自动化回归。
- 所有未完成项进入可执行交接，不依赖聊天上下文。

### Artifact truth boundary（2026-07-13 已完成核心）

- HTTP/前端与 MCP/Agent 执行链路共用 `artifact-truth.js`。
- 状态 API/SSE 对历史结果做磁盘复核和 DB 自愈。
- 统一 artifact failureModes 已注入 normalized plugin manifest 与新工具 scaffold。
- required missing/empty/type mismatch 为 blocked；optional missing/empty 为 degraded。
- 真实火山图执行与历史 Honeycomb demo 恢复均已通过。
- Core 实现已提交为 `96b6781 feat: validate tool result artifacts` 并推送远程分支。
- Stage 3 直接复用 truth artifacts，禁止二跳分析绑定 missing/empty/type-mismatch 产物。

### 二跳分析闭环（2026-07-13 已完成核心）

- active artifact 通过 `preferredPaths` 参与确定性输入排序。
- 只有扩展名、角色和表结构可匹配的 artifact 才能获得优先级。
- repair API 输出绝对路径，可直接交给隔离执行器。
- artifact scope blocked 自动回退 project scope。
- 真实 Honeycomb DEG artifact 已成功驱动下游 volcano-plot，并通过 artifact truth 校验。
- Core repair API 已提交为 `2ee2081 feat: prioritize active artifacts in repair` 并推送远程分支。

### 平台稳定性（2026-07-13 已完成核心）

- migration 与 r-server 统一走选定 Node 子进程，避免 Electron/system Node 原生 ABI 冲突。
- vendor lock 已同步到最新已推送 Core。
- MCP truth artifact 可由受管 `mcp-tool-jobs` 路径安全提供给结果预览。
- MCP 文件交付修复已提交为 `5733244 fix: serve managed MCP result artifacts` 并推送远程分支；Desktop vendor lock 已同步。
- macOS / Windows / Linux CI 最小矩阵已建立，覆盖 Harness、artifact truth、migration、platform compatibility 与 SPA。

## 1. 现状概览

### 已完成

#### A. 规范底座

- 已写 `docs/harness-engine-spec.md`。
- 已明确 Harness 的职责边界：
  - Skills 负责策略。
  - 插件负责真实计算。
  - Harness 负责编排、验证、修复、路由。
- Harness 的目标不再局限于生信流程，也要支持更通用的高频交互协作。

#### B. 插件契约

- 已统一 `plugin.json + tool-definition.json` 的 normalized view。
- `tools/list` 已透传：
  - `_manifest`
  - `outputSchema.artifacts`
  - `failureModes`
- 内置插件已补基本的 `pluginManifestVersion`、`supportedPlatforms`、`failureModes`。

#### C. 文件与项目索引

- 已有 `scripts/harness-file-index.mjs`。
- 已支持：
  - CSV / TSV / JSON / text / binary 探测
  - 表头、列类型、缺失值、样例行
  - DEG / matrix / sample sheet / manifest / summary 识别
  - `project / job / artifact / dataset / path` scope 解析
  - `--prompt-summary`
  - `--repair-params`
  - hash / 缓存读写
- 已支持基于缓存的增量索引重建，可复用未变化文件的旧索引并局部更新新增/删除/修改文件。

#### D. 参数修复与诊断

- 已有 `repairHarnessParams()`。
- 已有 `diagnoseHarnessRunReadiness()`。
- 已能处理：
  - 文件输入预填
  - DEG 常见列名别名
  - 数值参数裁剪
  - runtime 不可用 / 文件不匹配 / 样本不足等诊断
  - `failureModes.code` + `failureModes.detect` 双通道匹配
  - PCA 场景下的 sample / group 不匹配诊断
- DEG 场景下的数值列异常与空显著集诊断
- 新工具默认先继承通用 failureModes 模板，再按需补工具特异诊断。

#### E. 真实执行链路

- 已接入 canonical execution context。
- `run_tool` 可写入：
  - `execution`
  - `canonicalJobDir`
  - `canonicalOutputDir`
  - `canonicalResultDir`
- artifact / file 元信息已补 `canonicalPath`。

#### F. 平台抽象

- 已有 `createLocalHarnessPlatform()`。
- 已支持 localRoot → canonicalRoot 映射。
- 已把跨平台 runtime 兼容主线吸收进来。

#### G. 前端联动

- 项目工作台已接入 project / artifact scope 的 Harness summary。
- 参数确认卡已能调用 repair API。
- 结果与项目上下文已开始联动。

### 正在做

#### 1. Phase 2 收口

- 增量索引。
- 更完整的 failureModes。
- 更广的弱模型回归测试。
- 更稳的 diagnostic gate。

2026-07-13 新进展：

- repair proposal audit 已落地，不再覆盖用户显式列映射；用户数值调整必须标记确认。
- `ready / recoverable / blocked` 稳定口径已补齐。
- 不可修复表结构和全无效数值输入已进入阻塞回归。
- 历史 artifact 二跳 workflow API 已通过真实验证。

#### 2. 合并后稳定化

- 桌面壳稳定。
- 路由稳定。
- vendor 同步稳定。
- 跨平台 runtime 的真实机验证继续补齐。

## 2. 当前阶段划分

### Phase 1：契约统一

状态：已完成核心，仍可补边角。

目标：

- plugin manifest 统一。
- artifact schema 统一。
- failureModes 统一。
- tool listing 可机器读。

完成标准：

- 新插件不用改主 prompt。
- 工具定义可直接被 Harness 消费。
- 出错时能按统一结构回传。

### Phase 2：文件探测 + 参数修复 + 诊断

状态：已完成。

目标：

- 用户只给文件位置，系统能识别数据结构。
- 参数能自动修复一轮。
- 运行前能判断能不能跑。

完成标准：

- 文件输入不再依赖用户解释格式。
- 常见分析能直接补出合理默认值。
- 明显不可执行的任务会被 blocked。

### Phase 3：执行链路标准化

状态：已完成（2026-07-13）。

目标：

- 所有执行统一走 canonical execution context。
- 本地 / 远端 / 容器的接口一致。
- job / artifact / result 的路径和状态能被稳定追踪。

完成标准：

- 任一工具执行都能记录标准执行元信息。
- 参数修复、诊断、结果解释可以复用同一套上下文。

当前实现：

- `shared-backend/execution-context.js` 是唯一 canonical execution context 工厂，契约版本为 1。
- HTTP、MCP、Harness plan、R/Python step task queue 均复用该工厂，不再各自维护路径映射。
- 适配器显式区分 `local / container / remote`，同时保留旧的 mode/workDir/canonicalWorkDir 字段兼容现有消费者。
- task submit、worker run、result files 都记录 execution；artifact/output/file 自动获得 host path 与 canonicalPath。
- local、container、platform enqueue 和旧 MCP/Agent 路径均有自动化回归。

### Phase 4：弱模型可用性

状态：已完成（2026-07-13）。

目标：

- 不依赖强模型也能跑通标准分析。
- Tool selection、repair、diagnostics 能确定性工作。

完成标准：

- 不调用 LLM 也能通过规则选对一批标准工具。
- 至少对 DESeq2 / volcano / PCA / gene-correlation 这类常用场景稳定可用。

当前实现：

- version 1 薄任务包覆盖差异表达、火山图、PCA、相关性、富集、聚类、注释、整合、拟时序、通讯、细胞周期和 Doublet 共 12 类意图。
- 任务包只描述意图和候选 tool id，不包含脚本、执行器或 artifact 真相。
- `rankHarnessToolsForRequest()` 将任务包意图、真实 manifest 和文件索引组合评分；未知请求不会臆造工具。
- workflow plan 在未提供 manifest 时可从已安装/内置插件确定性选择；候选工具不可用时返回 `no_matching_tool`。
- 独立 `harness:evaluate` 门禁覆盖 12 类选型、未知请求、repair、blocked/recoverable、二跳 artifact 和运行时诊断。
- 真实历史结果 `tj_mrhgg5cf_ib7o` 验证通过：自动选择 volcano、绑定 DEG 表、补列映射、裁剪 top_n 并进入显式确认。

### Phase 5：工作流编排

状态：Agent-led analysis foundation v1 已完成（2026-07-13）。

目标：

- 把多步骤分析收成工作流模板。
- Skills 变成“流程知识”，不是“执行真相”。
- 支持项目级的连续分析链路。

当前实现：

- `run_tool` 统一提供 `list / plan / bind_artifact / run` 四种 Agent 操作。
- 三个薄模板覆盖 Bulk RNA、单细胞标准分析和已有 DEG 结果二次分析；模板只引用 tool id，不拥有执行逻辑。
- 10 个单细胞步骤不再是“可见但不可执行”：全部具有参数 schema、真实 task type 和 MCP/Agent 提交通道。
- step task 通过 `__harness.toolJobId` 关联现有 tool job；queued/running/completed/failed 和 artifact truth 会回写同一 job。
- `cell-cycle` 与 `doublet` 已接入真实 generator switch 和任务类型白名单。
- 下游输入只能通过 `bind_artifact` 从当前用户真实 tool job 的 valid artifact truth 绑定；degraded/unverified artifact 会被拒绝。
- 默认 `autoExecute: false`，Agent 必须逐步运行、检查结果、绑定 lineage，再决定下一步。
- 真实二跳验证：历史 valid DEG artifact → Agent lineage → 新 volcano job，完成后 truth valid、5 项产物。

下一阶段不再扩写 plan 表面结构，也不批量补分析内容；进入 Phase 6，收口 Plugin SDK、基于现有 tool job 的工作流运行时和 fixture 质量门禁。
- 也支持局部修改、反复追问、结果再分析这类交互式回合。

完成标准：

- 一个任务能自动拆成 inspect → infer → select → run → verify → report。
- 用户不需要手动把每一步喂给模型。

当前实现：

- `createHarnessWorkflowPlan()` 固定八阶段协议并输出 runnable、readiness、confirmationRequired。
- `/api/harness/workflow/plan` 复用现有 scope 授权、索引、repair、diagnostics 和 canonical execution context。
- Core 检查点为 `f491b61 feat: expose canonical harness workflow plans`，Desktop vendor lock 已同步。
- 尚未创建第二套执行器；后续必须把阶段推进映射到现有 `run_tool → tool_job → artifact truth`。

2026-07-13 状态机接续：

- `run_tool → tool_job → artifact truth` 已映射到八阶段只读状态投影。
- `/api/harness/workflow/status/:jobId` 在投影前执行共享 artifact truth 自愈。
- API 提供 `terminal / recoverable / resumeFrom / nextActions`，明确区分执行重试和产物修复。
- 两个真实历史 job 已验证到 report completed；内部 `manifest.json` 不再计入 artifact。
- Core 状态机检查点为 `4af1be2 feat: project tool jobs into recoverable workflows`，Desktop vendor lock 已同步。
- 下一步是在现有 Agent/结果区消费该状态，并为 retry/repair 动作增加显式、可审计的执行入口。

2026-07-13 UI 接续：

- 摘要卡与结果工具已消费 workflow status；轮询只在可见时发生，terminal 自动停止。
- 摘要卡使用八段细轨道，结果工具使用单行 truth/recovery 状态，不新增工作流主页。
- `retry_run / repair_artifacts / review_artifacts` 只转换为要求二次确认的 Agent 请求，不直接触发副作用。
- 真实 valid job 已完成视觉和 DOM 核对；下一步补 recoverable/blocked fixture 与确认后状态闭环。

2026-07-13 Recovery 阶段完成：

- recoverable/blocked UI、短期确认 token、动作白名单、审计历史和状态刷新已闭环。
- artifact reconcile 与 retry run 都复用现有 truth/MCP registry，不新增执行器。
- SQLite/PG 参数审计写入使用统一 `updateToolJobParams()`。
- 一个历史 R runtime 失败 job 已真实重试为 completed + truth valid；一个 valid job 已真实 reconcile 并保持 valid。
- Core recovery 检查点为 `8cb2620 feat: close recoverable workflow actions`，Desktop vendor lock 已同步。
- `repair_artifacts` 仍由 Agent 提出方案并二次确认，这是刻意的安全边界。
- Phase 5 下一步转向多步骤 template/状态联动，不继续扩大恢复按钮集合。

### Phase 6：Plugin SDK 与 Agent Workflow Runtime

状态：已完成并推送（2026-07-13）。Core `dcd2043`，Desktop `2d000d5`，vendor lock 已同步。

目标：

- 把 scaffold、manifest/schema/failureModes 校验、插件发现和注册诊断收成稳定 SDK。
- 多步骤计划直接读取现有 tool job/artifact truth，支持依赖判断、断点恢复、下一动作和可审计 lineage。
- Agent 按 plan → run → verify → bind → decide/recover 单步推进，默认不自动盲跑完整流程。
- fixture 门禁覆盖插件契约、repair/diagnostics、artifact truth、lineage 和 adapter 一致性。
- local/container/remote 继续使用统一 canonical execution context，平台差异只存在于 adapter 层。

完成标准：

- 新插件只需 manifest、脚本和 fixture，即可被平台发现、校验、执行、登记产物并供 Agent 调用。
- 插件缺陷在安装或 CI 阶段返回结构化诊断。
- workflow 可从已有 job 状态恢复，只有 valid artifact 能激活下游。
- 使用现有 Bulk RNA/单细胞各完成一条样板验证，不以批量编写流程作为 Phase 6 交付。

2026-07-13 验收结果：

- 统一 `plugin-sdk.js` 已覆盖 built-in、installed、development 三类来源、显式优先级、manifest/脚本/failure mode 校验和版本化结构诊断。
- MCP、安装注册、scaffold 与 Agent 工具定义已接入同一契约；scaffold 默认生成最小 input/fixture。
- 多步骤 runtime 直接从原 tool job 与 artifact truth 投影 9 类步骤状态，并输出 terminal、recoverable、readyStepIds、resumeFromStepId 与 nextActions。
- `run_tool` 已支持 `status / next`；workflow step run 会先重建状态，只允许 ready step，lineage bind 仅接受真实 job 的 valid、类型匹配 artifact，重复 bind 幂等。
- Bulk RNA 与单细胞 JSON fixture 覆盖 valid lineage、degraded recovery、确认断点和不可恢复阻塞；`npm run harness:phase6`、全量 `npm test`、Harness/Agent 评测和 adapter 回归均已通过。
- Core `dcd2043` 与 Desktop `2d000d5` 已提交并推送，Desktop `.vendor-lock` 与 submodule 指针一致；Phase 6 正式关闭。

## 3. 推荐推进顺序

### 第一优先级

1. 把 `failureModes` 通用模板补完整，并让新工具默认继承。
2. 把增量索引做好。
3. 把弱模型回归扩到更多真实场景。
4. 把执行链路统一到 canonical context。

### 第二优先级

1. 把 Skills 逐步改成流程模板。
2. 把常见分析收成标准工作流。
3. 把参数确认卡和结果卡做得更像“执行面板”而不是“弹窗”。

### 第三优先级

1. 补三平台 CI。
2. 接远端 worker / cluster adapter。
3. 把大项目索引做成后台增量更新。

## 4. 每阶段的出口条件

### Phase 1 Exit

- 插件声明完整。
- artifact 统一。
- failureModes 可读。

### Phase 2 Exit

- 文件不需要用户手把手解释。
- repair 能修第一轮。
- diagnostics 能拦明显错误。

### Phase 3 Exit

- 执行上下文统一。
- job / result / artifact 可追踪。

### Phase 4 Exit

- 弱模型也能稳定跑标准工具。

### Phase 5 Exit

- 多步骤任务可自动编排。

### Phase 6 Exit

- Plugin SDK、workflow runtime、Agent 单步闭环和 fixture 门禁全部可用。
- 同一套 Harness 能通过 adapter 跑本地、容器、远端、Windows、Linux、macOS。
- 接入新流程不需要修改 Agent 核心、执行器和结果系统。

## 5. 现在不该做什么

- 不要再把 Harness 写成更长的 prompt。
- 不要先追远端集群的“炫技式”接入。
- 不要为了单个平台重写核心逻辑。
- 不要把 Skills 和插件职责混在一起。

## 6. 近期执行建议

Phase 6 已关闭。接下来按以下顺序进入标准流程覆盖：

1. 以 GO/KEGG 富集作为首个真实 SDK 接入试点，复用现有 enrichment task pack、R 脚本和 DEG artifact，不新增平台特例。
2. 补齐 manifest、failureModes、fixture、诊断和 artifact schema，跑通 Agent 单步执行、valid lineage 与失败恢复。
3. 保持 `npm run harness:phase6`、全量 Harness/Agent 评测和 adapter 回归为必过门禁；试点暴露的平台缺陷只做通用修复。
4. 试点通过后沉淀可复制样板，再按 GSEA、WGCNA 等优先级逐个接入；覆盖足够后再强化结果多轮调整和局部重跑。
