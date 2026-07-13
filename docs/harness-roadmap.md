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

状态：已完成初始版，继续收口。

目标：

- 用户只给文件位置，系统能识别数据结构。
- 参数能自动修复一轮。
- 运行前能判断能不能跑。

完成标准：

- 文件输入不再依赖用户解释格式。
- 常见分析能直接补出合理默认值。
- 明显不可执行的任务会被 blocked。

### Phase 3：执行链路标准化

状态：进行中。

目标：

- 所有执行统一走 canonical execution context。
- 本地 / 远端 / 容器的接口一致。
- job / artifact / result 的路径和状态能被稳定追踪。

完成标准：

- 任一工具执行都能记录标准执行元信息。
- 参数修复、诊断、结果解释可以复用同一套上下文。

### Phase 4：弱模型可用性

状态：进行中。

目标：

- 不依赖强模型也能跑通标准分析。
- Tool selection、repair、diagnostics 能确定性工作。

完成标准：

- 不调用 LLM 也能通过规则选对一批标准工具。
- 至少对 DESeq2 / volcano / PCA / gene-correlation 这类常用场景稳定可用。

### Phase 5：工作流编排

状态：下一阶段重点。

目标：

- 把多步骤分析收成工作流模板。
- Skills 变成“流程知识”，不是“执行真相”。
- 支持项目级的连续分析链路。
- 也支持局部修改、反复追问、结果再分析这类交互式回合。

完成标准：

- 一个任务能自动拆成 inspect → infer → select → run → verify → report。
- 用户不需要手动把每一步喂给模型。

### Phase 6：远端执行与多平台扩展

状态：后续重点。

目标：

- 远端 worker、集群、Windows/Linux/macOS 都接入同一套 Harness 抽象。
- 通用交互式协作能力在这些平台上保持一致。

完成标准：

- 平台差异只存在于 adapter 层。
- 任务逻辑不因平台变化而重写。

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

- 同一套 Harness 能跑本地、远端、Windows、Linux、macOS。

## 5. 现在不该做什么

- 不要再把 Harness 写成更长的 prompt。
- 不要先追远端集群的“炫技式”接入。
- 不要为了单个平台重写核心逻辑。
- 不要把 Skills 和插件职责混在一起。

## 6. 近期执行建议

接下来最稳妥的顺序是：

1. Phase 2 收口。
2. Phase 3 统一执行链路。
3. Phase 4 做弱模型回归。
4. 再进入 Phase 5 的工作流编排。

这条路线最符合当前阶段的产品成熟度。
