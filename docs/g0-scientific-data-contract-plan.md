# G0 Scientific Data Contract & Adaptation Baseline

最后更新：2026-07-25

状态：`planned / SDC-0 completed / SDC-1 deferred`（2026-07-25 因 Result Studio 产品复核让出唯一 active 工作包；已完成代码与证据保留）

计划编号：`G0-SDC`

主模块：`P-04 Plugin SDK 与分析能力`

影响模块：`P-01`、`P-02`、`P-03`、`P-05`、`W-03`、`W-04`

对应 G0 工作包：`G0-LF0`、`G0-LF1`、`G0-LF3`、`G0-LF4`、`G0-LF7`、`G0-LF10`

前置条件：

1. ✅ HLE-C0～HLE-C5 真实产品出口全部满足（2026-07-24）。
2. ✅ `G0-START` 审计通过（10/10，2026-07-24）。
3. ✅ `G0-LF0` 已建立 Constitution、Baseline Registry、版本身份和 Support Matrix（2026-07-24）。

启动边界：本计划已于 2026-07-25 完成 `SDC-0` Profile Registry 与版本治理。产品复核确认 Result Studio 尚未具备真实结果选择、编辑和资格闭环，因此 `SDC-1`～`SDC-7` 暂不启动；当前唯一 active 工作包回到 `G0-RS`，待 `G0-RS-P7` 收口后再评估恢复 `SDC-1`。单工作包串行不变，已完成的 SDC-0 不回滚、不冒充完整数据适配能力。

## 1. 决策结论

真实用户数据不会稳定地符合某个 R 包或插件的理想输入。常见情况包括：

- CSV 实际使用制表符或非 UTF-8 编码。
- 第一列是 gene ID，但列名缺失或重复。
- 表达矩阵方向反转。
- 样本名称包含前后缀、空格或大小写差异。
- metadata 使用 `group`、`status`、`treatment` 等不同列名表达 `condition`。
- 输入是 TPM/FPKM，却被误当作 raw integer counts。
- DEG 表使用 `log2FC`、`logFC`、`avg_log2FC` 或 `log2FoldChange`。
- p-value、adjusted p-value、方向和基因 ID 类型缺失或含义不明确。
- 上游插件输出了文件，但其内容不满足下游插件的科学或结构契约。

因此，BioF3 不能采用以下两种不可靠方式：

1. 把原始数据直接传给插件，等待 R/Python 报错后再临时修改。
2. 为了让流程继续而静默猜测科学含义、覆盖原文件或修改插件源码。

正式路线是：

> 先观察和理解数据，再建立语义绑定；结构性问题通过可复现 Adapter 转换为版本化标准 Profile；插件运行前执行 Preflight，运行后验证 Artifact Profile；只有验证后的 Artifact 才能进入下游 DAG。

本计划是 G0 内部的数据与插件契约基线，不是新的 Harness、执行器、Job 系统或插件市场。

正式执行继续只有一条真相链：

```text
run_tool → tool_job → artifact truth
```

Profiler、Binder、Adapter、Standardizer 和 Validator 必须复用这条真相链。任何会产生正式文件的转换都必须成为可追溯 Job，而不是模型在内存中偷偷改数据。

## 2. 当前种子与真实缺口

当前已经存在：

- `core/shared-backend/artifact-profiles.js`
- `biof3.deg.v1`
- `deg-standardizer`
- DESeq2 输入 Preflight
- `metadata → coldata` 显式绑定
- `volcano-plot` 的 LFC 列适配
- Plugin Contract lint
- 每次成功运行的脚本、参数、输入和输出 Hash 证据

这些能力证明标准 Profile 路线可行，但仍只是 DEG 链路的种子实现。

当前不得宣称：

- 已有通用 Data Profile Registry。
- 任意不规则数据都可自动理解。
- 所有插件都声明了完整输入和输出语义。
- DAG 会自动插入 Adapter/Standardizer。
- 所有自动转换都有独立脚本和 lineage。
- 所有插件组合都已通过真实不规则数据验收。

## 3. 目标生产控制流

```text
用户科学目标
  → Raw Data Snapshot
  → Data Profiler
  → Semantic Binder
  → Scientific Design Gate
  → Canonical Profile Compatibility
  → 必要时生成 Adapter Plan
  → run_tool 执行 Adapter / Standardizer Job
  → 验证标准化 Artifact
  → Plugin Preflight
  → run_tool 执行科学插件
  → Output Profile Validator
  → Typed DAG Binding
  → 下游插件或交付
```

其中每一步都必须回答：

1. 输入是什么。
2. 系统观察到了什么。
3. 哪些含义可以确定。
4. 哪些转换已经执行。
5. 哪些假设仍未满足。
6. 输出是否满足下游契约。

## 4. 三类问题与自动化边界

| 问题类型 | 示例 | 默认行为 |
|---|---|---|
| 结构性、确定性 | 分隔符、编码、表头、矩阵转置、已知列别名、路径 | 自动生成 Adapter Job |
| 科学设计或语义不确定 | 对照组、配对、批次、统计单位、TPM 是否可替代 counts | 阻断并询问最少必要问题 |
| 插件实现缺陷 | manifest 错误、脚本参数错、输出与声明不一致 | 停止当前任务，进入独立插件修复 |

权限模式只能决定允许自动采取哪些动作，不能绕过科学设计 Gate。

完全访问模式下可以自动执行安全、可恢复且语义确定的 Adapter；不能自动猜测对照组、配对关系、批次设计或统计方法适用性。

## 5. 核心持久对象

### 5.1 RawDataSnapshot

记录用户数据的只读身份：

- projectId
- relativePath
- size
- modifiedAt
- sha256
- detectedMediaType
- detectedEncoding
- detectedDelimiter
- row/column sample
- snapshotVersion

Profiler 和 Adapter 都引用 Snapshot。原文件变化后，旧 Profile、Binding 和缓存必须失效或重新协调。

### 5.2 DataProfileObservation

记录系统从文件中确定性观察到的事实：

- shape 与 orientation 候选
- headers
- inferred primitive types
- missingness
- uniqueness
- duplicate IDs
- numeric/integer ratios
- value ranges
- candidate identifier types
- sample/gene overlap
- warnings 与 evidence refs

Observation 不直接声明科学含义。

### 5.3 SemanticBinding

把原始文件和字段绑定到科学角色：

- bindingId / schemaVersion
- source snapshot
- target profile
- file role
- column role mapping
- confidence
- evidence
- assumptions
- unresolved questions
- decision class

决策分类固定为：

```text
auto_resolved
requires_confirmation
cannot_reliably_answer
```

### 5.4 Canonical Data / Artifact Profile

每个 Profile 至少定义：

- profileId 与 schemaVersion
- 科学含义
- 数据粒度
- 行列方向
- 必需和可选字段
- 字段类型、单位、范围和 nullable
- ID 类型与允许的命名空间
- 已知 alias
- 内容级 validation rules
- provenance 要求
- 生产者和消费者能力
- compatible / migration / breaking 规则

`biof3.deg.v1` 是现有种子，后续必须按同一治理方式扩展。

### 5.5 AdapterPlan

描述确定性转换：

- source profile / target profile
- transformation steps
- affected fields
- scientific meaning changed: true/false
- required confirmation
- output path
- script language
- expected Artifact Profile
- cache key inputs

只要 `scientific meaning changed = true`，就不能作为普通自动格式修复执行。

### 5.6 PluginIOContract

每个插件必须声明：

- accepted input profiles 与版本范围
- produced output profiles
- required file roles
- required scientific design fields
- Preflight rules
- Postflight rules
- failureModes
- recoverability
- resource/runtime requirements
- platform support

插件不能只声明“接收 CSV”或“输出 CSV”。

## 6. 工作包

### SDC-0：Profile Registry 与版本治理

状态：`completed`（2026-07-25）

收口证据：

- `core/shared-backend/artifact-profiles.js` 已成为版本化 Registry，首批六个 Canonical Profile 全部落地，并区分 `data / artifact / display` 三类。
- `core/shared-backend/agent-workflow.js` 对未注册 Profile 返回 `unregistered_artifact_profile`，未注册 Profile 无法成为 typed DAG 正式边。
- 变更分级与兼容判定：`classifyProfileChange` 覆盖 compatible / migration / breaking，`resolveProfileCompatibility` 精确匹配且未知版本 fail-closed。
- `test/g0-sdc0-profile-registry.test.mjs` 7/7 通过；`npm run g0:sdc0` 10/10 通过，脱敏证据为 `acceptance/g0-scientific-data-contract/profile-registry.json`。
- 门禁接线：`npm run check` 的 `postcheck` 已包含 `g0:sdc0`，本轮全量 `npm run check` 通过，`npm test` 1339 pass / 0 fail / 11 skipped。

尚未验证：本子包为契约层，未包含真实不规则数据端到端产品验收（属 SDC-7 范围），因此本计划整体仍为 `active`，不得宣称 `qualified`。

目标：

- 将 `artifact-profiles.js` 从单个 DEG Profile 种子升级为正式 Registry。
- 区分 Data Profile、Artifact Profile 和 Display Artifact。
- 建立 profile version、compatibility、migration 和 deprecation 契约。

首批 Profile：

1. `biof3.counts-matrix.v1`
2. `biof3.sample-metadata.v1`
3. `biof3.expression-matrix.v1`
4. `biof3.deg.v1`
5. `biof3.gene-list.v1`
6. `biof3.enrichment-table.v1`

出口：

- Profile 有机器可读 schema、内容级规则和版本身份。
- 未注册 Profile 不能形成 typed DAG 正式边。
- Profile 变更可以判定 compatible / migration / breaking。

### SDC-1：Data Profiler

状态：`pending`

目标：

- 在完整加载大文件前生成安全、有限、可缓存的结构观察。
- 识别编码、分隔符、表头、方向候选、类型、缺失、重复和 ID 特征。

要求：

- 只读。
- 采样边界明确。
- 大文件不进入模型上下文。
- 观察结果绑定 Snapshot Hash。
- 不能把推测写成事实。

出口：

- 不规则 CSV/TSV/文本矩阵产生稳定 Observation。
- 文件变化后缓存不复用。
- 错误编码、空文件、超宽表和截断行有结构化诊断。

### SDC-2：Semantic Binder 与最少必要确认

状态：`pending`

目标：

- 把文件、列和数据粒度映射到插件需要的科学角色。
- 自动区分可确定映射和不可替代的科学决策。

要求：

- 列 alias、名称相似度、值分布和跨文件 ID overlap 共同形成证据。
- confidence 不能成为绕过科学确认的唯一理由。
- 对照组、配对、批次和实验单位不得仅根据列名自动决定。

出口：

- 自动绑定、需确认、无法可靠回答三类结果稳定可复现。
- 同一 Snapshot 和 Registry 版本产生相同确定性绑定结果。
- 用户确认形成持久 ScientificDecision，不只存在聊天文本中。

### SDC-3：可复现 Adapter / Standardizer

状态：`pending`

目标：

- 将结构确定但格式不兼容的数据转换为 Canonical Profile。

典型能力：

- encoding/delimiter normalization
- safe header repair
- matrix transpose
- column alias mapping
- ID cleanup
- sample ordering
- deterministic type conversion
- canonical column ordering

要求：

- 不覆盖原文件。
- 一个正式转换产生一个真实 Job。
- 每个输出有独立可直接运行的脚本。
- 输入、参数、脚本、Runtime 和输出 Hash 齐全。
- 转换结果进入 Artifact Truth 和 Profile Validator。

出口：

- 任意 Adapter 输出可以在数据库外用脚本复现。
- 重跑使用稳定 cache key，但缓存命中仍保留 provenance。
- 转换失败不会污染后续插件。

### SDC-4：Plugin I/O Contract 与 Conformance

状态：`pending`

目标：

- 让所有内置插件通过同一输入输出契约，而不是在 Agent Prompt 或 Core 写特殊规则。

要求：

- manifest 声明 Profile 和版本范围。
- Preflight 检查文件、字段、内容、科学设计和 Runtime。
- Postflight 检查必需 Artifact、内容和 lineage。
- failureModes 标记 recoverable / requires_user / plugin_defect。
- 插件不得创建第二套 Job 或 Artifact 状态。

出口：

- 当前内置插件全部通过 Contract lint。
- 不合格插件在发现阶段或 Preflight 阶段阻断。
- Core 不存在按插件 ID 硬编码的输入输出兼容分支。

### SDC-5：Typed DAG Compiler

状态：`pending`

目标：

- 在 DAG 建立时检查每条边的 Profile 兼容性。
- 需要转换时插入显式 Adapter / Standardizer 节点。

规则：

```text
compatible
  → 直接绑定

adaptable_without_scientific_change
  → 插入 Adapter Job

requires_scientific_decision
  → 等待确认

incompatible
  → 阻断或重规划
```

出口：

- 下游插件不能消费未验证或不兼容 Artifact。
- 已验证节点不因下游失败而重跑。
- Adapter 节点在 DAG、摘要、Delivery 和 Replay 中可见。

### SDC-6：Preflight、Postflight 与 Repair Boundary

状态：`pending`

目标：

- 将数据格式修复、科学设计决策和插件缺陷严格分流。

要求：

- Preflight 在创建昂贵科学 Job 前完成。
- Postflight 在下游绑定前完成。
- 自动 Repair 创建新 Job 和 parent lineage。
- 科学方法改变进入 ScientificDecision。
- 插件源码缺陷进入独立开发任务，当前分析不原地修源码。

出口：

- 结构问题可自动修复。
- 科学问题不会被自动格式修复掩盖。
- failed + partial Artifact 永远不能进入下游。

### SDC-7：Irregular Data Corpus 与真实产品验收

状态：`pending`

目标：

- 用真实不规则输入证明整条链路，而不是只用标准 fixture。

最小语料：

1. CSV 扩展名但 TSV 内容。
2. UTF-8 BOM 和一种非 UTF-8 编码。
3. counts 矩阵方向反转。
4. metadata 样本顺序不同。
5. 样本 ID 前后缀差异。
6. `group` alias → `condition`。
7. 缺少对照组定义。
8. condition 含 NA。
9. TPM/FPKM 输入请求 DESeq2。
10. DEG 使用 `log2FC`。
11. DEG 缺少 padj 或 padj 全 NA。
12. 基因 ID 类型与富集数据库不兼容。
13. 上游输出文件存在但 Profile 校验失败。
14. Adapter 中断后恢复。
15. 文件在规划后被外部修改。

验收轨迹：

- 自动结构修复成功。
- 必要科学确认后成功。
- 无法可靠回答时正确阻断。
- Adapter 失败后安全恢复。
- Plugin 输出漂移被 Postflight 阻断。

## 7. 证据目录

```text
acceptance/g0-scientific-data-contract/
├── baseline.json
├── profile-registry.json
├── profiler-matrix.json
├── semantic-binding-matrix.json
├── adapter-replay-matrix.json
├── plugin-io-contract-matrix.json
├── typed-dag-matrix.json
├── repair-boundary-matrix.json
├── irregular-data-corpus/
└── product-acceptance.md
```

证据只能保存脱敏 fixture、结构化诊断、Hash、版本和相对路径，不保存真实用户数据、完整大表或凭据。

## 8. 测试层级

| 层级 | 必须覆盖 |
|---|---|
| Contract | Profile schema、版本、兼容、迁移、unknown profile |
| Profiler | 编码、分隔符、类型、方向、缺失、重复、大文件边界 |
| Binding | alias、ID overlap、置信度、科学确认边界 |
| Adapter | 脚本生成、原文件不变、Hash、幂等、缓存、失败清理 |
| Plugin | input/output profile、Preflight、Postflight、failureModes |
| DAG | compatible、adapter、confirmation、incompatible |
| Recovery | Adapter 中断、文件漂移、应用重启、重复 actionKey |
| Scientific | counts/TPM、对照、配对、批次、非显著和证据不足 |
| Product | 真实聊天、真实 Job/Artifact、交付、Replay、UI 摘要 |

## 9. 零容忍验收

- 静默覆盖用户原始数据：0。
- 未记录脚本的正式数据转换：0。
- 未验证 Profile 进入下游插件：0。
- 科学设计问题被结构修复绕过：0。
- failed/partial Artifact 被当作有效输入：0。
- 跨项目缓存或 Artifact 复用：0。
- 模型文本覆盖 Validator/Job/Artifact Truth：0。
- 为单个插件在 Harness Core 增加特殊执行路径：0。

## 10. 完成定义

本计划首个基线只有同时满足以下条件才能标记 `qualified`：

1. 首批六个 Canonical Profile 落地。
2. Data Profiler、Semantic Binder 和 Adapter 使用版本化契约。
3. 当前内置插件声明并通过 I/O Contract。
4. Typed DAG 可以拒绝不兼容边并插入可复现 Adapter。
5. 每个正式转换有独立脚本、参数、输入和输出 Hash。
6. 不规则数据语料完成自动修复、确认和阻断三轨。
7. 至少一个真实 Bulk RNA-seq 产品任务完成端到端验收。
8. 自动检查、真实应用、重启、Replay 和 UI 证据分别记录。
9. G0 Conformance Matrix 纳入本计划的永久回归。

通过后，本计划转为 `qualified + maintained`，新插件、新 Profile 和新 Adapter 必须持续经过同一门禁。

## 11. 明确非目标

本计划不建设：

- 第二套 Harness 或 Loop。
- 第二套 Job / Artifact 数据库。
- 插件商城。
- 大批量新增科学插件。
- 完整 Evidence Graph。
- 通用 ETL 平台。
- 依赖模型隐藏推理的自动数据理解。

## 12. 跨 Agent 执行纪律

1. 每次开始先读 `docs/AUDIT-LOG.md`。
2. 核对 HLE、`G0-START` 和 `G0-LF0` 是否真实满足。
3. 前置未满足时只允许维护计划和 fixture，不得实施生产代码。
4. 每次只完成一个 SDC 工作包。
5. 先写失败 fixture，再实现。
6. 不修改另一个 Agent 的 WIP。
7. 不用 `git add .` 或 `git add -A`。
8. 自动测试、真实产品、重启、跨平台和视觉证据分别记录。
9. 每次提交声明一个主模块；本计划默认主模块为 `P-04`。
10. 未经用户授权不 push、不发布、不上传 OSS。

## 13. 可复用 Agent 提示词

```text
你正在开发 BioF3 Desktop。

仓库：
/Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop

目标：
按 docs/g0-scientific-data-contract-plan.md 实施当前允许启动的第一个未完成 SDC 工作包。核心目标是让不规则用户数据经过 Profiler、Semantic Binding、可复现 Adapter、Plugin I/O Contract 和 typed DAG 后再进入科学插件；不能等待 R/Python 报错后临时修文件，也不能用自动格式转换猜测关键科学设计。

开始前必须：
1. git status --short --branch
2. git log -8 --oneline --decorate
3. git rev-parse HEAD && git rev-parse origin/main
4. 阅读 AGENTS.md、docs/AUDIT-LOG.md、docs/g0-living-foundation-plan.md、docs/g0-scientific-data-contract-plan.md、docs/development-module-map.md、docs/project-workspace-handoff.md
5. 核对 HLE-C0～C5、G0-START 和 G0-LF0 的真实证据

启动门：
- 如果 HLE、G0-START 或 G0-LF0 未满足，不得提前写本计划生产代码；只报告缺口或完善脱敏 fixture/验收设计。
- 如果满足，只实施一个 SDC 子包，按 SDC-0 → SDC-7 顺序推进。

不变量：
- run_tool → tool_job → artifact truth 是唯一执行真相。
- 不覆盖用户原始数据。
- 任何正式转换都生成独立可运行脚本、新 Job、新 Artifact、Hash 和 lineage。
- 科学设计不明确时阻断并提出最少必要问题，不能猜测。
- 插件缺陷作为独立开发修复，分析 Agent 不得原地修改内置插件源码。
- 不在 Harness Core 为某个插件写特殊执行器或结果状态。
- 不碰其他 Agent 的 WIP；只暂存自己的明确文件，禁止 git add . / git add -A。

验收：
- 先写失败测试和不规则数据 fixture。
- 运行本子包专项测试、npm test、npm run check；涉及前端时增加 frontend test/check/build。
- 真实产品、Provider、重启、Replay、跨平台和视觉证据不得由离线测试冒充。
- 同步更新本计划、docs/AUDIT-LOG.md 和必要 handoff；无真实证据时保持 in_progress。

交付：
报告完成内容、验证命令与结果、当前仍未验证项、Git 状态和下一个 SDC 子包。未经明确授权不要 push。
```
