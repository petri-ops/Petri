# G0 Living Foundation Engineering — 永久可信基础层计划

最后更新：2026-07-24

状态：`establishing`

计划编号：`G0-LF`

主模块：`P-01`～`P-07` 的共同基础契约

当前前置工作：`HLE-C0～HLE-C5 completed`、`G0-START completed`

启动条件：第 4 节的 `G0-START` 全部满足

长期属性：`permanent / versioned / continuously verified`

## 1. 决策结论

G0 不是完成后被 G1 替代的产品阶段，也不是一组暂时性的基础功能。

> G0 是 BioF3 永久存在的 Living Foundation：严谨、动态、可进化、准确、稳定，并且在所有未来版本中持续接受验证。

G1～G6 只能建立在 G0 之上。任何上层能力只要破坏 G0 的执行真相、科学诚信、持久化、复现、安全或兼容性，就不得发布。

HLE-C0～HLE-C5 只完成 G0 中的 Harness Loop 生产控制闭环。它是本计划的关键前置条件，但不等于 G0 已经建立完成。

HLE 已于 2026-07-24 完成生产收口。G0-START 与 G0-LF0 随后通过机器验收；当前继续在同一执行真相上建立 LF1～LF12，不重开 Harness 或第二套执行链。

## 2. G0 的核心定义

G0 同时承担五种角色：

| 角色 | 含义 |
|---|---|
| 科学宪法 | 定义系统不能违背的科学诚信、证据和结论边界 |
| 执行内核 | 定义任务、工作流、Job、Artifact、验证和交付的唯一事实链 |
| 持久基线 | 定义项目、会话、任务和结果跨中断、升级与迁移后的连续性 |
| 兼容平台 | 定义插件、Runtime、Provider、数据和 UI 的版本协作规则 |
| 进化机制 | 定义系统如何从真实任务、故障和回归中安全地学习并升级 |

G0 的长期状态不是简单的 `completed`，而是：

```text
establishing
  → qualified
  → maintained
  → evolved
  → re-qualified
```

一旦形成首个基线，G0 永远保持 `maintained`，不会因为进入 G1～G6 而关闭。

## 3. 稳定与动态如何同时成立

G0 采用同心层设计，不把所有东西都冻结，也不允许所有东西自由变化。

### 3.1 不变量内核

以下原则不可由模型、插件、Provider 或普通配置覆盖：

1. 正式执行只有一条事实链：

   ```text
   run_tool → tool_job → artifact truth
   ```

2. 模型文本不能覆盖 Job、文件、统计或 Validator 的真实结果。
3. failed/blocked Job 即使留下部分文件，也不能宣称任务完成。
4. 非显著结果允许诚实交付，不能为了符合期待调整阈值。
5. 项目数据、凭据和权限不能跨作用域泄漏。
6. 正式产物必须可以追溯到输入、参数、脚本、环境、Job 和校验信息。
7. 除非用户主动清除，持久任务事实不能因会话关闭、压缩或软件重启消失。
8. 不可逆动作、科学设计变化和外部副作用必须遵守明确的权限边界。

这些不变量的变更需要最高级别 RFC、迁移方案和新的 G0 主版本；普通功能开发无权修改。

### 3.2 版本化契约层

允许以兼容方式演进：

- ScientificTaskSpec
- Workflow DAG
- LoopRun / Iteration / Checkpoint
- Tool Job / Artifact Truth
- Validator Result
- Plugin Manifest / Tool Definition
- Delivery Manifest / Replay Package
- Context Envelope / Session Stage Projection
- Usage / Resource Snapshot

所有持久对象必须携带 schema 或 contract version。读取方支持明确的版本范围，不能依赖“恰好能解析”。

### 3.3 动态策略层

可以根据当前任务和环境动态变化：

- Provider 与模型能力路由
- 重试次数、退避和超时
- Repair Strategy 选择
- 资源预算和并发
- 缓存使用
- 上下文压缩与恢复策略
- Plugin/Runtime readiness
- 后台任务调度
- UI 摘要密度

动态策略只能在契约和安全预算内调整，必须留下决策原因与效果证据。

### 3.4 可扩展能力层

科学插件、Runtime bundle、任务包和平台 Adapter 可以独立增加，但必须通过 G0 Conformance Suite。

### 3.5 实验隔离层

新的模型策略、Validator、缓存、自动修复和调度逻辑先进入 shadow/replay 环境，不能直接改变正式任务。

推广路径固定为：

```text
proposal
  → isolated fixture
  → historical replay
  → shadow evaluation
  → compatibility gate
  → controlled rollout
  → baseline promotion
  → continuous monitoring
  → rollback when necessary
```

## 4. HLE 完成后的启动门 `G0-START`

以下条件已于 2026-07-24 同时满足，本计划已从 `queued_after_hle` 进入 `establishing`：

- [x] HLE-C0～HLE-C5 状态和代码事实一致。
- [x] SPT-1 正常、自动修复、科学阻断三条生产轨迹有证据。
- [x] failed Job + partial files 的生产假成功回归稳定阻断。
- [x] 软件重启后 Loop、Job、阶段结论和恢复动作可重建。
- [x] 双 Provider 真实轨迹完成，未把 mock 当真实验收。
- [x] 前端开发壳或打包态完成 Loop、恢复和结果视觉核对。
- [x] Replay Package、脚本、参数、输入和输出 Hash 可从真实任务验证。
- [x] 根检查、测试、前端测试和构建没有未解释回归。
- [x] HLE 主计划、生产收口计划、Audit Log 和 handoff 状态一致。
- [x] 当前基线提交已安全落盘并可从 Git 恢复。

`G0-START`：`completed`。机器证据位于 `acceptance/g0-living-foundation/g0-start-audit.json`；任何一项以后回归都会由根 `npm run check` 阻断。

## 5. G0 的六项品质契约

### 5.1 严谨 `rigorous`

严谨不是增加更多提示词，而是：

- 每个状态有契约和来源。
- 每个结论有公开证据和限制。
- 每个异常有分类、处置和退出条件。
- 每个完成声明有机器可核验的门禁。
- 每个变更有兼容性影响和回归证据。
- 每个无法验证的能力明确标记为 unverified。

### 5.2 动态 `adaptive`

动态不是失控自修改，而是系统能够感知：

- 数据类型、大小和质量
- 可用 R/Python/Node Runtime
- Plugin 和包 readiness
- Provider 能力、延迟、错误和成本
- CPU、内存、磁盘和任务压力
- 会话长度、上下文质量和压缩风险
- Job、Artifact、Validator 和用户决策状态

并在边界内选择最合适的执行、修复、缓存、调度和呈现策略。

### 5.3 可进化 `evolvable`

可进化要求：

- 业务能力通过插件和任务包增加。
- 平台差异停留在 Adapter。
- 契约有版本、迁移和弃用周期。
- 历史项目成为兼容回归 fixture。
- 每个真实事故转化为永久回归用例。
- 每次策略升级先跑历史 Replay Corpus。
- 新版本可以解释相对旧版本发生了什么变化。

### 5.4 准确 `accurate`

准确不仅是数值没有算错，还包括：

- 输入身份准确。
- 方法适用性准确。
- 参数和对比设计准确。
- Artifact 与本次 Job 的 lineage 准确。
- 统计字段、单位、方向和多重校正准确。
- 结论强度与证据强度匹配。
- 不确定、矛盾和无法回答被准确表达。
- UI 展示与后端真实状态一致。

### 5.5 稳定 `stable`

稳定必须经得起：

- 长任务
- 大文件和大量文件
- Provider 波动
- Runtime 进程退出
- 用户取消
- 软件退出与系统关机
- 磁盘和内存压力
- 重复事件和重复提交
- 文件部分写入
- 数据库升级
- 插件和 Runtime 升级

### 5.6 可审计 `auditable`

系统必须保留：

- 用户消息和公开阶段结论
- Agent 动作和工具调用
- Job、日志、Validator 和 Repair
- 用户确认与权限决策
- 模型/Profile/Provider 使用记录
- Token、缓存、资源和成本
- 版本、迁移、升级和恢复记录

系统不依赖无法持久化或无法审阅的隐藏推理链。后续分析依赖的是公开阶段结论、结构化决策和执行证据。

## 6. 五层真相格

G0 不再用一个 `completed` 覆盖所有含义，而是区分五层真相：

| 真相层 | 回答的问题 | 主要来源 |
|---|---|---|
| Execution Truth | 命令是否真实运行并退出 | Tool Job / process |
| Artifact Truth | 声明的文件是否存在、完整并属于本次运行 | 文件系统 / hash / lineage |
| Scientific Truth | 方法、统计和领域验证是否支持结果 | Validator / assumptions |
| Delivery Truth | 图、表、脚本、参数和复现材料是否齐全 | Delivery / Replay |
| Experience Truth | 用户看到的状态是否与前四层一致 | UI projection / event log |

正式完成必须满足任务契约要求的所有真相层。

允许的科学结论状态至少包括：

```text
verified
supported_with_limitations
inconclusive
contradicted
blocked
unavailable
```

G0 只建立轻量 Evidence Envelope，记录结论、证据引用、假设和限制；不在本计划中提前实施完整 Scientific Evidence Graph。

## 7. 两条永久循环

### 7.1 任务执行循环

```text
understand
  → plan
  → execute
  → observe
  → validate
  → diagnose
  → repair/replan
  → deliver/block
```

HLE 负责建立这条循环的生产能力。

### 7.2 基线进化循环

```text
real task / incident / regression
  → structured observation
  → root cause
  → baseline gap
  → proposed change
  → replay and shadow evaluation
  → compatibility review
  → controlled promotion
  → new regression fixture
```

这条循环让 G0 保持动态，同时避免模型或开发者直接修改正式基线。

## 8. 工作包总览

| 编号 | 工作包 | 核心结果 | 前置 |
|---|---|---|---|
| G0-LF0 | 宪章与 Baseline Registry | 可机器读取的 G0 身份和不变量 | G0-START |
| G0-LF1 | Truth Lattice | 五层真相一致性与完成门 | LF0 |
| G0-LF2 | Durable State | 跨崩溃、关机、升级的耐久恢复 | LF0 |
| G0-LF3 | Scientific Accuracy | 方法、统计、不确定性和科学阻断基线 | LF1 |
| G0-LF4 | Reproducibility Lab | Replay、漂移检测与历史语料 | LF1、LF2 |
| G0-LF5 | Adaptive Runtime | 资源感知、长任务和动态调度 | LF2 |
| G0-LF6 | Model/Memory/Cost | 模型切换、压缩、缓存和成本稳定性 | LF2 |
| G0-LF7 | Capability Supply Chain | 插件、R/Python 包、Runtime 和 Adapter 治理 | LF0 |
| G0-LF8 | Security & Permission | 数据、路径、命令、凭据和外部副作用边界 | LF0 |
| G0-LF9 | Observable Experience | UI 与真实状态收敛、阶段结论和支持证据 | LF1、LF2 |
| G0-LF10 | Resilience Lab | 故障注入、压力、耐久和恢复矩阵 | LF2～LF9 |
| G0-LF11 | Evolution Pipeline | RFC、兼容、迁移、shadow、发布和回滚 | LF4、LF10 |
| G0-LF12 | Baseline Qualification | G0 Baseline v1 资格评审与永久门禁 | LF0～LF11 |

LF1～LF9 可在 LF0 完成后按文件边界有限并行，但 LF10～LF12 必须基于前序真实结果，不得提前宣布通过。

## 9. G0-LF0：宪章与 Baseline Registry

状态：`completed`（2026-07-24）

### 目标

把“G0 是什么”从文档口号变成可检查的基线身份。

### 交付物

- `G0 Constitution`：不变量、禁止项和变更等级。
- `Baseline Manifest`：契约、数据库、Plugin SDK、Runtime、Replay 格式版本。
- `Support Matrix`：操作系统、架构、Provider、Runtime、插件和项目版本。
- `Capability Status Vocabulary`：available/qualified/experimental/unavailable。
- `Change Class`：policy、compatible-contract、migration、breaking。
- 自动检查：持久对象和交付包携带必要版本。

### 验收

- 任意项目可以回答“由哪个 G0 基线创建、当前由哪个基线打开”。
- 不支持的版本组合明确阻断或迁移，不发生静默降级。
- 当前只宣称真实验收过的平台；macOS 之外未验证项不得伪装支持。

### 已落地

- `core/shared-backend/g0/` 保存 Constitution、Baseline Manifest/Registry、Support Matrix 与固定治理词汇。
- `core/shared-backend/g0-baseline.js` 对机器资源、现行契约版本、摘要和项目兼容性执行确定性校验。
- `project_g0_baselines` 记录项目创建/打开时的 baseline、manifest 与 bundle 身份；legacy 项目标记未知创建基线，未来主版本或同版本摘要冲突保持可读但阻断正式写入/执行。
- `/api/data/g0-baseline` 与 `/api/data/projects/:id/g0-baseline` 提供有界公开投影，前端项目类型同步携带该身份。
- `npm run g0:lf0` 已接入根 `npm run check`；验收证据位于 `acceptance/g0-living-foundation/`。

`G0-LF0`：`completed`。这只表示首个 `establishing` 基线身份已经建立，不表示 G0 已 `qualified`；资格状态必须等待 LF1～LF12。

## 10. G0-LF1：Truth Lattice

### 目标

让 Job、Artifact、科学验证、交付和 UI 的状态无法互相矛盾。

### 重点任务

- 建立统一 Truth Projection。
- 为五层真相定义来源、版本、更新时间和证据引用。
- 完成状态只能由 projection 计算，不能由聊天文本直接写入。
- 重复、乱序和迟到事件保持幂等。
- 缓存结果必须绑定输入、参数、环境和代码指纹。
- 文件变更后 Artifact Truth 自动失效或重新协调。

### 零容忍验收

- false success：0。
- 跨项目 Artifact 绑定：0。
- UI 显示完成但正式真相未完成：0。
- 无 lineage 的正式结果：0。

## 11. G0-LF2：Durable State

### 目标

让研究任务在时间上连续存在。

### 故障边界

- Electron Renderer 崩溃
- Electron Main 退出
- R/Python Server 退出
- 操作系统关机
- Provider 流中断
- 用户主动终止
- SQLite 写入中断
- Artifact 写入一半
- Checkpoint 损坏
- 数据库 migration 失败

### 重点任务

- 明确每类状态的 durable owner。
- 关键状态原子写入或可协调。
- 建立 append-only audit timeline 和可重建 projection；不要求为此重写成完整 Event Sourcing。
- 启动时 reconcile running/stale/partial 状态。
- 支持项目级备份、导出、校验和恢复演练。
- 旧会话、旧任务和公开阶段结论跨升级保留。

### 验收

每个指定故障点执行 kill/restart 后，系统只能进入：

- 安全续跑
- 安全重试
- 明确阻断
- 明确等待

不得无声丢失、重复执行不可逆动作或伪造完成。

## 12. G0-LF3：Scientific Accuracy

### 目标

把“算出了文件”升级为“科学上可以准确解释其含义和边界”。

### 重点任务

- Validator 声明适用数据、方法假设和证据等级。
- 参数变化区分工程修复与科学设计变化。
- 关键统计字段、单位、方向、多重校正和样本匹配有确定性检查。
- 非显著、矛盾、低功效和缺少设计信息进入正确结论状态。
- 公开阶段结论只表达用户需要的科学结论、证据和限制。
- 建立 negative controls、boundary cases 和 contradictory fixtures。
- 关键任务允许独立实现或参考工具交叉核验，但不要求所有任务双算。

### 禁止

- 根据用户期望选择阈值。
- 重试直到显著。
- 用模型常识替代数据证据。
- 把低置信度推断包装为事实。

## 13. G0-LF4：Reproducibility Lab

### 目标

让历史任务成为新版本的持续检验材料。

### 重点任务

- 建立 Replay Corpus：正常、边界、故障、旧版本和真实脱敏任务。
- 区分 deterministic artifact、tolerance-based artifact 和 narrative artifact。
- 记录输入、脚本、参数、Runtime、包、插件、环境和随机种子。
- 新版本批量 Replay，输出结构化 Drift Report。
- Drift 分类：expected、compatible、scientifically_material、unknown。
- 缓存命中也必须能够解释来源和有效性。
- 每个修复过的事故进入 Corpus。

### 验收

- 支持范围内的旧项目可以重放。
- 科学实质变化必须被检测和审阅。
- 报告措辞变化不能掩盖底层统计漂移。

## 14. G0-LF5：Adaptive Runtime

### 目标

让本地执行根据真实硬件和任务特点动态调整，同时保持结果契约稳定。

### 重点任务

- CPU、内存、磁盘、进程、队列和任务资源快照。
- 长任务后台运行、暂停、取消、恢复和优雅终止。
- 资源预算、并发、分块和临时空间治理。
- Runtime/包 readiness 和缺失能力的自动准备。
- 资源修复与科学方法替换严格区分。
- 摘要卡展示当前任务、排队、资源风险和预计后续动作。
- 为不同硬件形成经验证的 resource profile，而不是写死单机参数。

### 安全边界

资源不足时可以调整调度、分块和缓存；如果调整会改变科学可比性，必须留下决策并进入科学边界处理。

## 15. G0-LF6：Model、Memory、Cache 与 Cost

### 目标

让模型随时切换、上下文持续增长和成本变化都不破坏任务真相。

### 重点任务

- Model Gateway 能力与错误归一化。
- 模型/Profile 切换不改变确定性科学门禁。
- Context Envelope 独立于单次 Provider 上下文。
- 原始消息、公开阶段结论、结构化决策、动作和工具结果耐久保存。
- 自动压缩基于风险和任务阶段，不只根据 token 阈值。
- 压缩后通过事实完整性检查；可从 durable facts 重建。
- 缓存分为 prompt、provider、tool、artifact 和 replay 层，分别定义有效性。
- 缓存失效绑定模型、Prompt、工具、输入、参数和契约版本。
- Token、缓存命中、费用和质量指标进入同一 usage ledger。
- Provider 失败的 fallback 必须显式、可审计并遵守用户策略。

### 零容忍验收

- 凭据进入消息、日志、缓存或诊断包：0。
- 压缩导致必要科学事实永久丢失：0。
- 缓存跨错误项目或错误输入复用：0。

## 16. G0-LF7：Capability Supply Chain

### 目标

让插件、R/Python 包和 Runtime 成为可验证、可替换、可迁移的科学能力。

### 重点任务

- 内置、安装和开发插件使用同一 Manifest/Tool/Artifact 契约。
- Plugin SDK conformance fixtures。
- Runtime 与包版本锁定、Hash、来源和 readiness。
- 插件声明 failureModes、validators、资源特征和平台支持。
- 一图一表一结果保留本次独立脚本或可直接抽取的脚本。
- Adapter 隔离 macOS/Windows/Linux 差异。
- 当前先建立 macOS qualified baseline；其他平台按证据晋级。
- 插件升级进行历史 Replay 和结果 Drift 检查。
- 供应链下载、解压、路径和签名/Hash 验证。

### 禁止

- 为单个插件在 Core 建立特殊执行器。
- 插件自行定义第二套 Job/Artifact 状态。
- 大量增加未进入真实任务和 Conformance 的插件。

## 17. G0-LF8：Security & Permission

### 目标

让 Agent 主导分析，但自动化边界清晰、可解释且不会因“完全访问”失去安全性。

### 权限模型

权限模式只决定可自动采取动作的范围，不改变：

- 项目隔离
- 凭据保护
- 科学诚信
- 不可逆动作保护
- 外部副作用审计

### 重点任务

- 文件读写、命令、网络、插件、Provider 和外部应用分别建模。
- 安全且可恢复的分析动作在允许模式下自动完成。
- 关键科学设计变化、不可逆数据操作和外部发布进入明确决策门。
- 命令不只用静态 allowlist；结合模式、作用域、风险、路径和副作用评估。
- 开发者模式能力与普通用户能力明确隔离。
- 诊断包默认最小化并脱敏。
- 插件和 Runtime 供应链安全纳入发布门。

## 18. G0-LF9：Observable Experience

### 目标

让用户看到的是准确、紧凑、可追溯的系统状态。

### 重点任务

- 阶段性结论在下一次工具调用、取消、失败和恢复后继续存在。
- 默认只展示阶段结论；动作、工具、日志和证据按需展开。
- 用户终止后保留已经发生的公开阶段结论和执行记录。
- 文件树自动响应真实文件变更。
- Loop、Job、Artifact、文件、结果卡和摘要状态统一投影。
- 异常先自动诊断和处理；无法解决时显示原因、影响和可行动建议。
- Token、缓存、费用、CPU、内存、磁盘和队列进入紧凑摘要。
- 不展示或依赖模型隐藏思维过程；展示可审阅的阶段结论和证据。

### 状态收敛验收

同一任务在聊天、摘要、任务详情、文件和结果视图中不能出现互相冲突的状态。

## 19. G0-LF10：Resilience Lab

### 目标

不等待用户遇到事故，而是系统性制造事故来证明 G0。

### Fault Matrix

- Provider：timeout、429、5xx、断流、格式漂移、工具调用循环。
- Runtime：未安装、包缺失、ABI 错误、进程退出、卡死。
- Storage：磁盘满、权限失败、部分写入、文件被外部修改。
- Database：锁竞争、重复事件、migration 中断、checkpoint 损坏。
- Resource：内存压力、CPU 饱和、队列积压、超大输入。
- User：取消、关闭窗口、关机、跨会话继续、重复发送。
- Plugin：schema 错误、声明产物缺失、输出格式漂移。
- Model：切换 Provider、上下文压缩、缓存失效、最终整理失败。

### 测试类型

- deterministic unit/contract
- integration
- process-kill recovery
- packaged-app fault injection
- endurance/soak
- historical replay
- privacy/security
- visual state consistency

### 规则

每个生产事故必须进入 Fault Matrix 或 Replay Corpus，形成系统“免疫记忆”。

## 20. G0-LF11：Evolution Pipeline

### 目标

让 G0 可以长期进化而不漂移。

### 变更等级

| 等级 | 示例 | 要求 |
|---|---|---|
| Policy | timeout、调度、摘要密度 | 指标、回放、回滚 |
| Compatible Contract | 新增可选字段、Validator | contract test、旧 fixture |
| Migration | schema、project format | migration、backup、rollback |
| Breaking Baseline | 不变量或必需字段变化 | RFC、新主版本、完整资格评审 |

### Promotion Gate

任何进入 G0 基线的变化必须提供：

- 问题证据
- 影响范围
- 对照基线
- Replay/Shadow 结果
- 科学和兼容风险
- 数据迁移
- 回滚路径
- 新增永久回归

### 动态策略学习

允许系统从历史任务建议更好的资源、模型、缓存和修复策略，但：

- 学到的是候选策略，不是直接修改正式基线。
- 训练/统计数据必须有隐私边界。
- 策略必须可解释、版本化、回放和回滚。
- 科学阈值和结论规则不能通过隐式在线学习漂移。

## 21. G0-LF12：Baseline Qualification

### 目标

建立第一个可长期维护的 `G0 Baseline v1`。

### 资格证据

- Constitution 与 Baseline Manifest。
- 五层 Truth Lattice 一致性报告。
- Durable State 故障恢复报告。
- Scientific Accuracy 正例、反例和边界用例。
- Replay Corpus 与 Drift Report。
- Resource/long-task 报告。
- Model/Memory/Cache/Cost 矩阵。
- Plugin/Runtime supply-chain 报告。
- Security/Permission 报告。
- UI state-convergence 实机证据。
- Fault Matrix、soak 和 packaged-app 结果。
- Migration、upgrade、rollback 演练。

### Baseline 状态

通过后：

```text
G0 Baseline v1 = qualified + maintained
```

它不是“完成归档”。以后每次产品发布都要重新执行适用门禁；每次 G0 变更都要重新资格确认。

## 22. 永久 Conformance Matrix

G0 不依赖单一 SPT-1，而采用多维覆盖：

| 维度 | 基线样例 |
|---|---|
| Runtime | R、Python、纯 Node/文件工具 |
| DAG | 单节点、线性、多分支、汇合、局部重跑 |
| Duration | 短任务、长任务、后台任务 |
| Data | 小文件、大文件、大量文件、外部修改 |
| Outcome | verified、limited、inconclusive、blocked、failed |
| Recovery | retry、repair、replan、resume、cancel |
| Provider | 至少两种真实 Provider + deterministic mock |
| Version | 当前项目、旧项目、迁移失败和回滚 |
| Resource | 正常、内存压力、磁盘压力、队列积压 |
| Platform | macOS qualified；其他平台按真实证据晋级 |

采用风险驱动和 pairwise 组合，不要求笛卡尔积全部执行，但高风险组合必须有明确覆盖。

## 23. 指标与 SLO

G0 不使用一个综合分数掩盖问题，而使用多维 Scorecard。

### 零容忍指标

- false completion
- silent durable-state loss
- cross-project data leakage
- credential leakage
- untracked formal artifact
- scientific threshold manipulation

以上任何一次出现都阻断发布。

### 需要在 LF0 建立基线后确定阈值的指标

- 任务恢复成功率和恢复耗时
- UI/后端状态收敛时间
- Replay 漂移率
- 自动修复成功率和误修复率
- Provider fallback 发生率
- 缓存命中率与错误复用率
- 长任务取消和清理耗时
- CPU、内存和磁盘治理开销
- Token/费用估算误差
- 旧项目兼容率

不得在缺少真实基线数据时编造漂亮阈值。LF0/LF10 负责建立测量方法和初始分布，再批准 SLO。

## 24. 证据目录与状态管理

建议使用独立证据根：

```text
acceptance/g0-living-foundation/
├── baseline/
├── truth/
├── durability/
├── scientific-accuracy/
├── replay/
├── resources/
├── model-memory-cost/
├── capabilities/
├── security/
├── experience/
├── resilience/
├── migration/
└── g0-qualification.json
```

证据只保存脱敏数据、结构化摘要和必要截图，不保存凭据和不必要的用户原始数据。

每个工作包使用：

```text
queued
in_progress
blocked
implemented_unverified
qualified
maintained
```

`implemented_unverified` 不能被写成 `qualified`。

## 25. 与 G1～G6 的关系

G1～G6 是建立在 G0 上的能力层，不是新的基础真相系统。

每个上层工作包必须声明：

- 依赖的 G0 baseline version。
- 使用的持久对象和契约。
- 新增的 Plugin/Task Pack/Adapter。
- 对 G0 Conformance Matrix 的新增覆盖。
- 是否需要 G0 RFC 或 migration。
- 上层失败时如何退回安全的 G0 状态。

G1 可以在 `G0 Baseline v1` qualified 后启动；G0 同时转入 maintained。二者可以并行演进，但任何 G0 回归优先于上层新功能。

## 26. 明确非目标

本计划不直接建设：

- 完整 Scientific Evidence Graph
- 多 Agent 组织
- 插件商城
- 云端协作平台
- HPC 联邦
- 自主实验室
- Continuous Research

本计划只为这些未来能力提供不易破坏、可以验证、能够进化的基础。

## 27. 交接给任意 Agent 的执行规则

启动任一 G0-LF 工作包前：

1. 先读 `docs/AUDIT-LOG.md`。
2. 核对 `G0-START`，HLE 未关闭则停止实施。
3. 读取本计划、模块地图、handoff 和相关现有契约。
4. 只认当前代码、持久数据和验收证据，不认旧文档口号。
5. 标明一个主模块和必要的跨模块关注点。
6. 不创建第二 executor、Job、Artifact、Loop 或会话真相。
7. 先写失败 fixture，再做实现。
8. 自动检查、真实 Provider、实机、打包态和视觉证据分别记录。
9. 不把无法执行的验收标为通过。
10. 只提交本工作包文件，不混入其他 Agent 的 WIP。

## 28. 当前行动

`G0-START` 与 `G0-LF0` 已完成，G0 处于 `establishing`，尚未 `qualified`。

下一主线按依赖启动：

1. `G0-LF1 Truth Lattice`：统一 Job、Artifact、科学验证、Delivery 与 UI 的完成投影。
2. `G0-LF2 Durable State`：建立跨崩溃、关机和版本升级的全对象恢复矩阵。
3. `G0-SDC` 已满足启动前置，可作为 LF1/LF7 的真实数据契约轨进入计划，但不得绕过 LF1/LF2 或直接批量扩张插件。

任何后续工作仍须通过 `npm run g0:lf0`，且不得把当前 `not_yet_qualified` 基线写成 qualified。

## 29. 守护语句

> G0 不是静止的地基，而是一套有免疫、有记忆、有边界、有证据的活基础。它允许能力持续变化，但不允许真相悄悄变化；允许系统不断学习，但不允许科学标准漂移；允许架构逐步扩展，但所有新能力都必须重新证明自己仍然站在可信基础之上。
