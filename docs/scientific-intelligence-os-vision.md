# BioF3 Scientific Intelligence OS — 核心愿景与阶段成长宪章

最后更新：2026-07-23

文档性质：`long-term core direction`

当前产品阶段：`Research Preview / G0 Living Foundation establishing`

长期北极星：`Local-first Scientific Intelligence OS`

## 1. 文档作用

本文是 BioF3 的长期方向文档，用于回答三个问题：

1. BioF3 最终要成为什么。
2. 当前已经位于哪一阶段。
3. 下一阶段何时可以开始，哪些能力现在不能提前建设。

本文不是当前开发任务清单，也不替代：

- `next-steps-roadmap.md`：当前正在做什么。
- `project-workspace-handoff.md`：当前代码与交接状态。
- `development-module-map.md`：模块责任边界。
- `g0-living-foundation-plan.md`：HLE 关闭后启动的永久基础层建设与维护计划。
- 各 HRT/HLE/UI/Plugin 专项计划：具体怎么实现和验收。

文档优先级固定为：

```text
长期方向与原则：本文
  ↓
产品阶段：v1-productization-roadmap.md
  ↓
当前工作：next-steps-roadmap.md
  ↓
工程恢复：project-workspace-handoff.md
  ↓
专项实施：当前工作包计划与验收证据
```

当长期愿景与当前工程条件发生冲突时，不允许跳过阶段出口直接实现远期架构。应先记录长期方向，再由当前阶段的真实用户任务、代码证据和验收门决定是否进入实施。

## 2. 核心愿景

BioF3 不应被定位为：

- 一个套着聊天界面的 R/Python 工具箱。
- 一个无限增加分析插件的插件容器。
- 一个只会生成代码或报告的 AI 助手。
- 一个只在单次会话中工作的工作流执行器。
- 一个声称可以替代科学家、生信工程师或统计学家的“全自动 AI 科学家”。

BioF3 的长期愿景是：

> 建设一个本地优先、证据驱动、可复现、可审阅并能够随研究持续演化的 Scientific Intelligence OS。

它应当把完整科学活动连接起来：

```text
科学问题
  → 假设
  → 实验与数据设计
  → 数据获取和理解
  → 计算分析
  → 证据验证
  → 科学主张
  → 图表、报告与论文
  → 审阅、反证与修正
  → 新问题和下一实验
```

BioF3 的核心价值不是“替用户多运行几个软件”，而是：

> 把科学问题、数据、决策、计算、证据、结论和复现记录组织成一个长期可信的研究系统。

## 3. 当前定位

现阶段最准确的产品定位是：

> BioF3 Desktop 是一个本地优先、Agent 主导、可复现的 AI 生物信息分析工作台，同时已经形成 Scientific Execution Kernel v1 的工程基础。

当前对用户的价值主张：

> 用户使用自然语言提出模糊的生信需求，BioF3 在本地理解数据、形成分析任务、调用科学插件、运行 R/Python、检查产物，并交付图表、数据表、脚本和复现记录。

当前对外不应使用：

- “完整 Scientific Intelligence OS”。
- “完全自主科学家”。
- “通用多组学平台已经完成”。
- “可替代专业生信和统计审阅”。
- “正式 GA 稳定产品”。

当前成熟度为：

```text
Research Preview
  = AI 生信工作台
  + Scientific Execution Kernel v1
  + 初步的可复现交付能力
```

## 4. 已有工作在长期架构中的位置

| 当前能力 | 当前价值 | 长期系统中的位置 |
|---|---|---|
| Project / Conversation | 项目、会话和文件作用域 | Research Workspace |
| Model Gateway | 多 Provider、能力和成本管理 | Intelligence Plane |
| ScientificTaskSpec | 模糊需求转结构化任务 | Scientific Intent Contract |
| Workflow DAG | 编排分析节点和依赖 | Research Execution Plan |
| Plugin SDK | 独立科学分析模块 | Scientific Capability Ecosystem |
| R/Python Runtime | 本地真实计算 | Compute Substrate |
| Job / Artifact Truth | 真实执行状态与产物 | Evidence Source Layer |
| Provenance / Delivery / Replay | 脚本、参数、输入输出和复现 | Reproducibility Layer |
| Harness Loop | 持续执行、验证、修复和恢复 | Scientific Execution Kernel |
| 文件/终端/结果预览 | 项目观察和操作 | Scientific Workbench |
| SQLite / 任务目录 | 本地持久化事实 | Local-first Data Plane |
| macOS 打包与更新 | 安装和迭代 | Desktop Product Layer |

这些工作不是零散功能，而是未来 Scientific Intelligence OS 的基础设施。

当前主要完成的是：

```text
需求 → 任务 → 计划 → 执行 → 结果 → 复现
```

长期还需要逐步补齐：

```text
问题 → 假设 → 设计 → 证据 → 主张 → 审阅 → 新研究
```

## 5. 北极星用户体验

未来一个完整用户旅程应是：

1. 用户用自然语言说明研究目标，即使表达模糊。
2. Agent 主动理解项目文件、数据结构和已有研究历史。
3. 系统区分可自动推断、需要确认和当前无法可靠回答的内容。
4. 系统建立问题、假设、数据和分析计划之间的关系。
5. Harness 使用真实插件、Runtime 和 Job/Artifact Truth 执行分析。
6. 每一步均有输入、方法、参数、脚本、产物和验证证据。
7. 可修复异常由系统诊断并产生新版本；关键科学决定交还用户。
8. 每张图、每张表和每条结论都可以追溯到支持它的证据。
9. 关闭会话、退出软件、切换模型或更换电脑后可以继续。
10. 最终交付不仅有结果，还包含限制、反证、复现包和下一研究问题。

最终用户应能够点击一句科学结论，沿着完整链路反向查看：

```text
Claim
  → Evidence
  → Figure / Table
  → Verified Artifact
  → Statistical Method
  → Parameters and Script
  → Job and Runtime
  → Dataset Snapshot
  → Study Design
  → Research Question
```

## 6. 不可动摇的产品原则

### 6.1 Local-first

- 用户数据和研究历史默认保存在本地。
- 远程模型、远程计算和外部数据服务必须显式选择并可审计。
- 没有网络时，本地项目、历史、结果和可复现包仍然可读取。
- 云能力是 adapter，不成为本地产品成立的前提。

### 6.2 Evidence-first

- 模型文本不是科学证据。
- 进程退出码 0 不等于科学结果可靠。
- 文件存在不等于任务完成。
- 科学主张必须引用经过验证的 Artifact、统计结果和来源。
- 失败、非显著、低功效和证据不足都可以是正确结果。

### 6.3 One execution truth

正式计算继续只有一条执行真相：

> `run_tool → tool_job → artifact truth`

Loop、UI、报告、Evidence Graph 和未来协作层只能引用和解释这条真相链，不得创建平行的执行状态。

### 6.4 Reproducibility by construction

- 每个正式图、表和报告都有本次运行脚本。
- 参数、输入、Runtime、插件和输出带版本/hash。
- 修改产生新版本和 parent lineage，不覆盖旧结果。
- 复现不是最后补写的方法说明，而是执行过程的默认产物。

### 6.5 Agent-led, scientifically governed

- Agent 主导文件定位、结构检查、计划组织、低风险执行和结果整理。
- 用户不必预先知道 R 包、命令或高级参数。
- 分组、对照、统计单位、配对、批次等关键科学设计不能被权限模式绕过。
- 系统应尽量减少提问，但不能用猜测换取“自动完成率”。

### 6.6 Durable research memory

- 长期记忆的主体是研究对象、决策、证据和未解决问题，不是聊天摘要。
- 原始消息和事实对象保留；摘要、embedding 和缓存可以重建。
- 模型切换、上下文压缩和软件升级不能修改历史事实。

### 6.7 Progressive growth

- 先把一个真实任务做深，再扩展十个插件。
- 先证明当前阶段出口，再实现下一阶段抽象。
- 新框架必须由真实用户任务和重复问题驱动。
- 不因远景宏大而在当前版本提前建设多 Agent、云平台或插件市场。

### 6.8 Honest product claims

- 自动测试、真实 Provider、打包态、视觉验收和科学审阅分别记录。
- 没有证据的能力标记为 planned、in_progress、unverified 或 unavailable。
- 不把原型、fixture 和离线纯函数测试描述为真实产品闭环。

## 7. 三种科学 Loop

### 7.1 Execution Loop

```text
理解任务
  → 计划
  → 执行
  → 验证
  → 诊断
  → 修复或重规划
  → 交付
```

当前 Harness Loop 主要负责这一层。

### 7.2 Scientific Reasoning Loop

```text
提出假设
  → 获取证据
  → 分析数据
  → 检验假设
  → 寻找反证和替代解释
  → 修正解释
  → 形成有边界的科学主张
```

这一层要解决：

- 统计结果能支持多强的结论。
- 是否存在混杂、偏倚、样本量或方法限制。
- 哪些证据支持，哪些证据反对。
- 结果是否只是相关，是否涉及因果推断。
- 还需要哪些数据或实验验证。

### 7.3 Research Lifecycle Loop

```text
科学问题
  → 实验或数据
  → 分析
  → 发现
  → 新问题
  → 新实验
  → 再分析
```

BioF3 最终要保存和推动的是这个跨月、跨年、跨成员的研究循环。

三个 Loop 必须逐层建设：

```text
Execution Loop 稳定
  → Scientific Reasoning Loop
  → Research Lifecycle Loop
```

不得在 Execution Loop 尚不能可靠阻断假成功时，提前宣称系统已经能自主形成科学结论。

## 8. Scientific Evidence Graph

Evidence Graph 是未来 Scientific Intelligence OS 的核心数据模型，但当前阶段只保留方向，不立即实施。

### 8.1 核心对象

```text
ResearchProject
├── ResearchQuestion
├── Hypothesis
├── StudyDesign
├── DatasetSnapshot
├── ScientificDecision
├── ScientificTask
│   ├── WorkflowPlan
│   ├── LoopRun
│   ├── ToolJob
│   └── Artifact
├── Evidence
├── Claim
├── Limitation
├── ContradictoryEvidence
├── Figure / Table
├── Report / Manuscript
├── ReviewRecord
└── NextQuestion
```

### 8.2 核心关系

- Question 产生 Hypothesis。
- StudyDesign 约束 Dataset 和可使用的方法。
- ScientificTask 回答 Question 的一部分。
- Job/Artifact 产生可验证 Evidence。
- Evidence 支持、削弱或反对 Claim。
- Claim 必须披露 Limitation 和替代解释。
- Figure/Table 展示 Evidence，不自行成为新证据。
- ReviewRecord 对 Claim、Evidence 和方法进行审阅。
- 新证据可以修正旧 Claim，但不能覆盖历史版本。
- 未解决 Claim/矛盾产生 NextQuestion。

### 8.3 进入实现的前置条件

只有以下条件满足，才正式启动 Evidence Graph v1：

1. Harness 生产 Loop 已接入真实 Agent。
2. SPT-1 可以从真实聊天完成、阻断、修复和恢复。
3. 至少 3 个真实科学任务暴露出重复的 Evidence/Claim 需求。
4. Job、Artifact、Provenance、Delivery 和 Replay 契约稳定。
5. 已证明仅靠聊天消息和最终报告无法可靠管理这些关系。

## 9. 平台分层

### 9.1 Experience Plane

面向用户的科学工作台：

- 项目、会话和资源。
- Agent 主工作区。
- 数据、任务、DAG 和结果。
- Evidence/Claim 导航。
- 报告、论文和审阅。
- 成本、资源和运行状态。

### 9.2 Scientific Object and Evidence Plane

管理长期科学事实：

- Question、Hypothesis、StudyDesign。
- Dataset、Decision、Evidence、Claim。
- Limitation、Review、NextQuestion。

### 9.3 Intelligence and Control Plane

管理智能决策和持续执行：

- Model Gateway。
- Context/Memory。
- TaskSpec。
- Harness Loop。
- Validator、Diagnoser、Repair。
- 未来的科学解释和审阅角色。

### 9.4 Scientific Capability Plane

提供可组合科学能力：

- Plugin。
- Scientific Task Pack。
- Domain Pack。
- Evidence Pack。
- Validator Pack。
- Report/Manuscript Pack。

### 9.5 Data and Compute Plane

提供真实数据和计算：

- 本地文件、数据库和数据索引。
- R/Python/Node Runtime。
- CPU/GPU/内存/磁盘。
- 未来的 NAS、HPC 和云 adapter。
- 环境、依赖、缓存和复现。

### 9.6 Collaboration and Governance Plane

提供长期协作和可信治理：

- 角色、权限、审阅和批准。
- 项目版本、冻结和交接。
- 数据范围、隐私和审计。
- 科学主张、来源和可复现性签名。

## 10. 累积式成长层级

G0～G6 不是完成一个就丢弃一个的线性项目阶段，而是永久叠加的能力层：

```text
G6  Continuous Research
G5  Scientific Capability Ecosystem
G4  Federated Scientific Intelligence
G3  Lab Scientific OS
G2  Evidence-centered Research
G1  Agent-native Scientific Analysis
G0  Living Scientific Foundation
```

上层能力以真实出口推进，不以日期和宣传目标推进。进入任何上层后，G0 仍然持续运行、验证、维护和进化；G0 回归始终具有最高发布阻断优先级。

### G0：Living Scientific Foundation

状态：`establishing`；首个基线通过后转为 `qualified + maintained`，永不归档。

G0 是 BioF3 永久存在的可信基础层，同时承担：

- 科学宪法：科学诚信、证据和结论边界。
- 执行内核：Task、Workflow、Loop、Job、Artifact、Validation 和 Delivery 的唯一真相。
- 持久基线：跨中断、关机、升级、迁移和模型切换保持研究连续。
- 兼容平台：Plugin、Runtime、Provider、数据和 UI 的版本协作。
- 进化机制：真实任务和事故经过 Replay、Shadow、兼容门和回滚后进入新基线。

G0 不是静态冻结层。它把变化分为：

1. 不变量内核：轻易不变，只能通过新主版本和迁移修改。
2. 版本化契约：兼容演进并携带 schema/contract version。
3. 动态策略：根据任务、资源、Provider 和成本自适应。
4. 可扩展能力：Plugin、Task Pack、Runtime 和 Adapter。
5. 实验隔离：候选策略先经过 fixture、历史回放和 shadow evaluation。

已完成的 HLE 负责建立 G0 的任务执行循环：

- 完成 Harness Loop 生产接线。
- 让真实 Job/Artifact/Validator 决定任务状态。
- 让可修复异常进入真实 Repair/新 Job。
- 让会话和摘要展示可恢复 Loop 进度。
- 用 SPT-1 完成真实产品验收。

HLE-C0～HLE-C5 已完成；G0-START 与 G0-LF0 已于 2026-07-24 建立 `establishing` 基线。当前按 [`g0-living-foundation-plan.md`](./g0-living-foundation-plan.md) 继续系统加固：

- 五层真相一致性。
- 跨崩溃、关机和升级的耐久恢复。
- 科学准确性、不确定性与负例。
- Replay Corpus 与结果漂移检测。
- 长任务、资源、模型、记忆、缓存和成本治理。
- Plugin/Runtime 供应链、安全和权限。
- UI 状态收敛、故障注入、耐久测试和兼容演进。
- 永久 G0 Conformance Suite。

G0 首个基线的资格出口：

- `G0-START` 确认 HLE 生产闭环真实完成。
- false completion、静默持久状态丢失、跨项目泄漏、凭据泄漏和无 lineage 正式产物保持零容忍。
- 支持范围内的旧项目、旧任务和 Replay Package 可以迁移、恢复和重放。
- 正常、边界、负例、故障、资源压力、模型切换和版本升级矩阵有证据。
- macOS 当前产品链完成 qualified baseline；其他平台按真实证据晋级。
- G0 Baseline Manifest、Support Matrix、Fault Matrix 和永久门禁落地。

建立首个 G0 基线期间禁止：

- 开始多 Agent 平台。
- 开发插件商城。
- 建设通用云计算后端。
- 大批量扩充不进入真实任务和 Conformance 的插件。
- 实施完整 Evidence Graph。
- 用上层功能优先级覆盖 G0 回归。

### G1：Agent-native Scientific Analysis Platform

状态：`next`

目标：

- 从一个旗舰任务扩展到至少 3 个稳定科学任务包。
- 建立科学任务级输入、验证、异常、交付和复现标准。
- 补齐长任务资源、取消、恢复和环境治理。
- 让分析小白可以在最少必要提问下完成端到端任务。

建议旗舰任务：

1. Bulk RNA-seq 差异分析与功能解释。
2. 单细胞基础发现流程。
3. 富集、网络或空间分析中的一个完整任务。

阶段出口：

- 3 个任务包均覆盖正常、可修复和科学阻断。
- 任务包使用可组合 Plugin，不在 Harness Core 硬编码算法。
- 不同模型/Profile 不改变确定性科学验收。
- 真实数据规模下资源、恢复和交付可接受。
- 用户能够从结果追溯到脚本、参数、输入和限制。

### G2：Evidence-centered Research Workbench

状态：`later`

目标：

- 实现 Scientific Evidence Graph v1。
- 把 Question、Hypothesis、Evidence、Claim 和 Limitation 变成持久对象。
- 让图表、报告和科学主张引用同一证据图。
- 加入科学反证、替代解释和结论边界。

阶段出口：

- 至少 3 个真实项目使用 Evidence Graph 管理结果。
- Claim 能反向追溯到 Artifact、方法和数据。
- 新分析可以支持、削弱或修正旧 Claim。
- 报告和论文内容不复制出第二套科学状态。

### G3：Lab Scientific OS

状态：`future`

目标：

- 从个人项目扩展到课题组和实验室。
- 加入成员、角色、审阅、批准、版本和项目交接。
- 支持共享运行资源、数据范围和实验室知识。

阶段出口：

- 多成员协作不破坏项目事实和权限。
- 科学决策、图表和结论具有审阅记录。
- 项目可以在成员变动和设备迁移后继续。
- 实验室知识来自可追溯项目对象，不是无来源的共享摘要。

### G4：Federated Scientific Intelligence OS

状态：`future`

目标：

- 在 local-first 前提下接入 NAS、实验室服务器、HPC 和云计算。
- 支持更完整的转录组、单细胞、空间、代谢组、蛋白组和临床数据。
- 按数据隐私、资源、模型能力和成本选择执行位置。

阶段出口：

- 本地和远程 adapter 使用同一 Task/Job/Artifact/Evidence 契约。
- 远程运行不要求把所有数据上传第三方。
- 跨设备任务可恢复、审计和复现。
- 计算成本、数据范围和访问权清晰可见。

### G5：Scientific Capability Ecosystem

状态：`future`

目标：

- 冻结公共 Plugin、Task Pack、Evidence Pack 和 Validator 标准。
- 建立开发者工具、兼容矩阵、benchmark 和分发治理。
- 支持第三方能力而不牺牲科学质量、隐私和复现。

进入条件：

- 内置插件和任务包已经通过真实产品长期验证。
- 外部开发者需求真实存在。
- 版本、Runtime、权限和签名治理可以承担第三方风险。

### G6：Continuous Research System

状态：`north-star`

目标：

- 持续维护项目假设、证据、矛盾、限制和未解决问题。
- 从新数据和新结果中更新研究图谱。
- 生成可审阅的下一实验、下一分析和新问题建议。
- 长期陪伴一个研究项目，而不是只响应一次请求。

这仍然是需要科学家主导和审阅的研究系统，不是替代科学责任主体的自动研究机器。

## 11. 上层能力跃迁规则

### 11.1 只实现当前基础工作和一个可验证的下一步

每个需求必须标为：

| 分类 | 含义 | 行动 |
|---|---|---|
| `NOW` | 当前基础或上层出口必需 | 可进入正式计划和开发 |
| `NEXT` | 当前出口后紧接的能力 | 可做设计和夹具，不提前大规模实现 |
| `LATER` | 中期方向 | 记录需求和进入条件 |
| `RESEARCH` | 长期探索 | 只做研究，不成为当前产品承诺 |

### 11.2 进入下一能力层必须同时满足

- 当前阶段核心用户旅程真实跑通。
- 自动检查、真实 Provider、实机 UI 和科学验收分别有证据。
- 关键失败模式有稳定处理。
- 现有对象和契约能够支撑迁移。
- 下一阶段问题在真实项目中重复出现，而不是假设出来。
- 用户确认进入新阶段。

此外，每个 G1～G6 工作包必须声明依赖的 G0 baseline version，并为 G0 Conformance Matrix 增加必要覆盖。进入上层后，G0 同时保持 `maintained`，不是 `completed`。

### 11.3 不允许用未来愿景覆盖当前事实

- 远期名称不能改变当前产品成熟度。
- Roadmap 不能把 planned 写成 complete。
- fixture 不能冒充真实项目。
- 模型自评不能冒充科学审阅。
- 新 UI 不能发明后端不存在的状态。

## 12. 新需求决策框架

任何新想法进入开发前回答：

1. 它解决哪个真实用户目标？
2. 属于当前哪个阶段？
3. 主模块和事实来源是什么？
4. 能否通过 Plugin/Task Pack 实现，而不是修改 Harness Core？
5. 是否强化 Evidence、Truth、Reproducibility 或 Recovery？
6. 是否会创建第二套状态、执行器或结果真相？
7. 有什么脱敏 fixture 和真实验收？
8. 它的资源、Token、隐私和维护成本是什么？
9. 如果暂时不做，是否阻塞当前阶段出口？
10. 是否已经取得用户对阶段扩张的确认？

不能回答这些问题的需求，先进入 `LATER` 或 `RESEARCH`，不直接开发。

## 13. 产品与科学质量指标

### 13.1 Truth

- 假成功率。
- Artifact/Job/报告状态一致性。
- 无来源科学结论数量。
- 输入、参数、脚本和产物追溯覆盖率。

### 13.2 Reproducibility

- Replay 成功率。
- 数据库外任务包可验证率。
- 环境/插件/输入漂移识别率。
- 图表独立复现入口覆盖率。

### 13.3 Autonomy

- 真实任务目标完成率。
- 自动修复成功率。
- 无效工具调用和重复循环次数。
- 用户提问数量及其必要性。

### 13.4 Scientific integrity

- 关键设计缺失时的正确阻断率。
- 非显著结果被正确交付而非重复调参的比例。
- Claim 的 Evidence 和 Limitation 覆盖。
- 反证和替代解释的记录完整度。

### 13.5 Durability

- 会话、应用和机器重启恢复率。
- 丢失/损坏文件的正确识别率。
- 项目导出、迁移和重开成功率。

### 13.6 Efficiency

- Token、费用、延迟和缓存命中。
- CPU、内存、磁盘和 GPU 资源使用。
- 首个有效证据时间。
- 单任务人工介入成本。

指标必须按任务、数据规模、Provider、插件和版本记录。不能为了提高自动完成率牺牲科学正确性。

## 14. 产品形态成长

```text
当前：
本地 AI 生物信息分析工作台
  +
Scientific Execution Kernel v1

下一阶段：
Agent-native Scientific Analysis Platform

中期：
Evidence-centered Research Workbench

长期：
Lab Scientific OS
  → Federated Scientific Intelligence OS
  → Continuous Research System
```

对应产品用户范围：

```text
个人学习与分析
  → 生信工程师和研究者
  → 课题组
  → 实验室
  → 研究机构与科学能力生态
```

用户范围扩张必须以产品可靠性和数据治理成熟为前提，不以注册量或插件数量驱动架构。

## 15. 当前阶段行动约束

当前唯一主线仍是：

> 在已完成的 HLE、G0-START、LF0～LF6 与 LF9 上，收口 LF7/LF8 并建立 LF10 Resilience Lab，持续保持永久 Conformance。

与愿景相关但当前只记录、不实施的方向：

- Evidence Graph v1。
- 多专业 Agent/Reviewer。
- 实验室协作。
- HPC/云计算联邦。
- 第三方插件生态。
- Continuous Research。

当前阶段的优先决策顺序：

1. `G0-START` 与 `G0-LF0` 已完成，永久 `g0:lf0` 门禁必须保持通过。
2. G0-LF5/LF6/LF9 已完成；收口 LF7/LF8 并启动 LF10 故障实验室。
3. 按 G0-LF3～LF12 完成准确、复现、资源、安全、故障和兼容资格。
4. G0 Baseline v1 qualified 后转入永久 maintained。
5. 在继续维护 G0 的同时，才选择第二和第三个旗舰科学任务进入 G1。
6. 只有满足第 8.3 节条件后，立项 Evidence Graph v1。

## 16. 长期定位语句

当前对外：

> BioF3 是一个本地优先的 AI 生物信息分析工作台，帮助用户把模糊的科学需求转化为可执行、可验证、可复现的分析结果。

下一阶段：

> BioF3 是一个 Agent-native 科学分析平台，能够持续执行、验证、修复并交付可复现的生物信息分析任务。

长期愿景：

> BioF3 是一个本地优先的 Scientific Intelligence OS，用可信的科学对象、执行证据和长期研究记忆，连接问题、数据、分析、主张、审阅和下一研究。

## 17. 守护原则

未来每次产品扩张都必须守住：

> 立足当前真实用户任务，以科学证据和可复现性为中心，一次只跨越一个经过验收的阶段。

愿景负责指出方向，阶段出口负责控制速度，真实证据负责决定我们是否可以继续前进。
