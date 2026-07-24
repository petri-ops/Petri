# G0-LF12 Baseline Qualification — 首个永久可信基线资格工作包

最后更新：2026-07-24

状态：`completed`（2026-07-24）

计划编号：`G0-LF12`

主模块：`P-06 桌面集成与交付`

协作模块：`P-01`～`P-05`、`P-07`、`W-01`～`W-07`

跨模块关注点：`C-03 安全、确认与审计`、`C-04 状态与事件同步`、`C-05 测试与质量门禁`、`C-06 性能与交互手感`

资格对象：`0.6.0 establishing / not_yet_qualified` 封存基线

晋升结果：`G0 Baseline v1 = 1.0.0 qualified + maintained`

机器裁决：`16 / 16` 强制证据满足、`10 / 10` 零容忍观测为 `0`、`0` blocker

## 1. 决策结论

G0-LF12 不是文档收尾、证据汇总或版本号修改，而是对整个 G0 的综合生产资格认证。

只有在支持范围、科学真相、持久恢复、复现、资源、模型、插件、权限、UI、故障、迁移和 packaged-app 证据全部满足本计划时，才允许把首个 G0 基线晋升为：

```text
G0 Baseline v1 = qualified + maintained
```

LF12 失败不是产品失败。任何未满足项必须成为显式 blocker，基线继续保持：

```text
establishing / not_yet_qualified
```

不得通过降低断言、删除失败 fixture、扩大跳过范围或修改文档措辞制造资格通过。

## 2. 首个资格范围

首轮资格只覆盖有真实证据的范围：

| 维度 | 首轮候选范围 | 边界 |
|---|---|---|
| 平台 | macOS arm64 | Windows、Linux、macOS x64 分别按证据晋级 |
| 应用 | BioF3 Desktop packaged app | 开发壳通过不能替代 packaged 证据 |
| 存储 | 本地文件 + SQLite | 不声明云端、PostgreSQL 或共享数据库资格 |
| Runtime | 当前已发布 R/Python/Node 能力 | 未发布 bundle 和未验收架构不进入支持声明 |
| Provider | deterministic mock + 至少两种真实 Provider | Provider 文本不能改变确定性科学验收 |
| 科学任务 | 已进入 Conformance 的真实任务轨 | 不声明任意组学、任意插件或任意数据自动可用 |
| 权限 | 当前 read/full/developer 契约 | 完全访问仍受不可协商安全边界约束 |

资格报告必须分别表达：

- 已 qualified 的能力。
- 仅 preview/limited 的能力。
- 明确 unsupported 的能力。
- 尚未取得证据的能力。

不得用一个平台、一个 Provider 或一个任务的成功推断其他范围已合格。

## 3. 零容忍不变量

以下任一项出现即阻断资格：

1. failed、blocked 或未验证 Job 被展示为完成。
2. 会话、Task、Loop、Job、Artifact、Checkpoint、Delivery 或审计事实静默丢失。
3. 正式结果缺少输入、参数、脚本、环境、Job、Validator 或 lineage。
4. 跨项目数据、Artifact、会话、凭据或权限泄漏。
5. API Key、Authorization、Provider 响应、用户绝对路径或私有数据进入提交证据。
6. 为推进流程覆盖源数据、既有正式 Artifact 或用户无关 Git WIP。
7. 模型、缓存、压缩、fallback 或 UI 文本覆盖科学与执行真相。
8. migration 失败后静默创建新历史或假装升级成功。
9. 不可逆动作、远端发布或重大外部副作用绕过权限边界。
10. 为 LF12 新建第二套 executor、Job、Artifact、Loop、Workflow 或版本真相。

正式执行仍唯一为：

```text
run_tool → tool_job → artifact truth
```

## 4. 资格对象

### 4.1 `QualificationManifest v1`

至少固定：

- baselineId / baselineVersion / bundleDigest
- qualificationScope
- requiredEvidenceClasses
- zeroToleranceInvariants
- supportClaims
- excludedClaims
- evidenceFreshnessPolicy
- decisionPolicyVersion
- sourceCommit

### 4.2 `QualificationEvidenceLedger v1`

每条证据至少包含：

- evidenceId / evidenceClass / schemaVersion
- sourceCommit / baselineDigest
- platform / architecture / appMode
- Runtime / Provider 能力摘要
- command 或验收入口
- generatedAt / freshnessStatus
- counts / hashes / bounded result
- privacyClassification
- applicableClaims
- passed / degraded / blocked / unavailable
- blockerRefs

Ledger 只记录索引、摘要、哈希和有界状态，不复制原始用户数据、凭据、完整日志或 Provider 响应。

### 4.3 `QualificationDecision v1`

必须由确定性规则生成：

- `qualified`
- `not_yet_qualified`
- `blocked`

同时给出：

- satisfiedClaims
- limitedClaims
- unsupportedClaims
- blockers
- requiredRequalification
- decisionHash

模型可以解释结果，不能决定或覆盖结果。

## 5. 必须覆盖的证据域

| 域 | 核心证明 |
|---|---|
| Constitution / Baseline | Manifest、Registry、Support Matrix 与契约版本一致 |
| Truth Lattice | Job、Artifact、Scientific、Delivery、Presentation 五层不互相越权 |
| Durable State | 中断、重启、关机、重复事件、部分写入后可恢复或诚实阻断 |
| Scientific Accuracy | 正例、反例、边界、非显著、低功效、矛盾和设计缺失 |
| Replay / Drift | 输入、参数、脚本、环境、插件和结论漂移可分类 |
| Runtime / Resource | 长任务、内存、CPU、磁盘、队列、取消和恢复 |
| Model / Memory / Cost | Provider 切换、压缩、缓存、fallback、Token 和费用边界 |
| Plugin / Supply Chain | 来源、Hash、Runtime、独立脚本、Validator、升级 Replay |
| Security / Permission | 项目隔离、凭据、源数据、命令、网络和外部副作用 |
| Observable Experience | 聊天、摘要、任务、文件和结果视图状态收敛 |
| Resilience | 八域 Fault Matrix、soak、异常恢复和无假成功 |
| Migration / Upgrade | 旧项目、旧契约、升级中断、备份、回滚和重新打开 |

## 6. 分阶段执行计划

### LF12-Q0：资格契约与支持边界

交付：

- Qualification Manifest/Decision/Ledger schema。
- 首轮 macOS arm64 支持范围。
- 零容忍、强制、条件和延期项分类。
- 证据有效期与重新资格规则。
- 资格状态机与 reason codes。

验收：

- 缺少强制证据时只能 `not_yet_qualified`。
- unsupported 不得被 UI 或文档提升为 qualified。
- qualification 决策可重复、可哈希、与模型无关。

### LF12-Q1：证据总账与缺口审计

交付：

- 索引 LF0～LF11、HRT、HLE、Plugin、UI、Runtime 和发布证据。
- 校验 sourceCommit、bundleDigest、平台、架构、生成时间和隐私等级。
- 过期、重复、矛盾、缺失和范围不匹配检测。
- 机器可读 Gap/Blocker Report。

验收：

- 每项 support claim 至少有一条适用证据。
- 历史 PASS 不能在源码或范围漂移后继续冒充有效。
- 原始数据、凭据、URL 和用户绝对路径泄漏为 0。

### LF12-Q2：科学真相与复现资格

交付：

- 五层 Truth 一致性矩阵。
- 正常、负例、边界、非显著、低功效、矛盾和科学阻断任务。
- Replay Corpus 与 Drift Report。
- 独立脚本、参数、输入、输出和环境校验。
- 不规则输入与科学设计缺失的诚实处理证据。

验收：

- false completion 为 0。
- 非显著结果可以诚实交付。
- 科学设计变化不能伪装为工程修复。
- 重放结果的确定性或允许误差范围明确。

### LF12-Q3：耐久、恢复与迁移资格

交付：

- 会话、Task、Loop、Job、Artifact、Checkpoint 和 Delivery 恢复矩阵。
- 强制退出、应用重启和关机恢复。
- 重复事件、锁竞争、部分写入和 checkpoint 损坏。
- 旧项目/旧 Baseline/旧 ReplayPackage 升级。
- migration 中断、备份和 rollback 演练。

验收：

- 除非用户明确清理，正式事实不会自动消失。
- 恢复幂等，不重复执行已完成的不可重复动作。
- 升级失败的项目保持可读，并明确阻断不安全正式写入。

### LF12-Q4：Runtime、资源、模型与供应链资格

交付：

- R、Python、Node 和文件工具矩阵。
- Runtime/package/plugin readiness、Hash、来源和平台报告。
- 长任务、内存、CPU、磁盘、队列和大输入报告。
- Provider 切换、上下文压缩、缓存、fallback、Token 和费用矩阵。
- 插件升级 Replay/Drift 与独立脚本核验。

验收：

- 资源不足进入等待、分块、排队或诚实阻断，不改变科学标准。
- fallback 能力兼容、策略允许、可审计且不改变科学门禁。
- 未验证平台和 Runtime 不进入 qualified 支持声明。

### LF12-Q5：安全、UI、Fault Matrix 与 packaged-app

交付：

- read/full/developer 权限矩阵。
- 项目隔离、凭据脱敏、源数据不可变和外部副作用报告。
- Provider、Runtime、Storage、Database、Resource、User、Plugin、Model 八域故障执行。
- soak/endurance 报告。
- packaged macOS arm64 真实任务。
- 聊天、摘要、任务、文件和结果视图状态收敛视觉证据。

验收：

- 自动化门禁、真实 Provider、packaged、视觉和 soak 证据分开记录。
- 开发环境成功不能替代 packaged-app。
- UI 不自行推断完成，不展示隐藏思维链。
- 异常必须有原因、影响、恢复状态和可行动建议。

### LF12-Q6：最终资格裁决

交付：

- 完整 Qualification Report。
- Support Matrix 最终范围。
- blocker 关闭记录。
- G0 Baseline v1 Manifest/Registry 候选。
- 资格前后 migration 与 rollback 路径。

验收：

- 所有强制 claim 通过。
- 所有零容忍计数为 0。
- 所有延期项不在 qualified 宣称中。
- 资格决策可由干净 checkout 重建。
- 未通过时不修改为 qualified。

### LF12-Q7：永久门禁与维护

交付：

- `npm run g0:qualification` 离线聚合门禁。
- 单独的真实 Provider、packaged、soak 和视觉验收入口。
- 根检查与发布门接线。
- 证据有效期、事故回灌和重新资格机制。
- LF11 Promotion Gate 与 LF12 requalification 接线。

验收：

- 后续 G0 变化不能绕过 Promotion Gate。
- 适用证据漂移后自动失效。
- 新平台、新 Runtime、新 Provider 和新能力按范围独立晋级。

## 7. 资格测试矩阵

至少覆盖：

| 维度 | 样例 |
|---|---|
| Runtime | R、Python、Node、文件工具 |
| DAG | 单节点、线性、分支、汇合、局部重跑 |
| Duration | 短任务、长任务、后台任务 |
| Data | 小文件、大文件、大量文件、不规则结构、外部修改 |
| Outcome | verified、limited、inconclusive、blocked、failed |
| Recovery | retry、repair、replan、resume、cancel |
| Provider | 两种真实 Provider + deterministic mock |
| Version | 当前项目、旧项目、迁移失败、rollback |
| App | 开发壳、packaged app |
| UI | 明暗主题、820px、常规宽屏、历史恢复 |

## 8. 建议命令与证据布局

建议新增：

```text
npm run g0:qualification:test
npm run g0:qualification:audit
npm run g0:qualification:migration
npm run g0:qualification:fault
npm run g0:qualification:packaged
npm run g0:qualification
npm run g0:qualification:update
```

建议证据目录：

```text
acceptance/g0-qualification/
├── qualification-manifest.json
├── evidence-ledger.json
├── qualification-decision.json
├── qualification-report.md
├── truth-science-replay/
├── durability-migration/
├── runtime-supply-security/
├── resilience-soak/
└── packaged-ui/
```

证据只保留有界摘要、计数和哈希；真实用户数据、凭据、完整 Provider 响应、内部 URL 和绝对用户路径不得进入 Git。

## 9. 提交与证据绑定规范

采用两提交收口：

1. `feat(g0): establish baseline qualification (G0-LF12)`
2. 基于上述源码提交重新生成全部适用证据。
3. 确认每份证据的 `sourceCommit` 精确绑定源码提交。
4. `test(g0): qualify first maintained baseline (G0-LF12)`

不得把尚未提交源码时生成的旧 HEAD 写成资格证据来源。

## 10. 完成定义

只有全部满足时 LF12 才能标记完成：

- [x] Q0～Q7 均有实现、测试和证据。
- [x] 首轮支持范围明确且没有越界宣称。
- [x] 十六类资格证据完整、有效、脱敏且绑定同一封存基线。
- [x] 零容忍不变量失败数为 0。
- [x] 自动化、真实 Provider、packaged、视觉、soak 和 migration 证据分别真实完成。
- [x] 所有 blocker 已关闭或对应能力明确排除在支持范围外。
- [x] 根检查、资格门禁、前端测试/构建和发布门通过。
- [x] 干净 checkout 可以重建资格裁决。
- [x] Baseline Manifest、Registry、Support Matrix、文档和 UI 状态一致。
- [x] `G0 Baseline v1 = qualified + maintained` 由机器裁决支持，而非人工口头声明。

完成证据见 [`../acceptance/g0-qualification/qualification-report.md`](../acceptance/g0-qualification/qualification-report.md)。资格后任何 bundle、major、支持范围、证据有效性或事故状态变化均进入 LF11 Promotion + LF12 requalification，不允许沿用本次结论静默晋升。

## 11. LF12 之后

LF12 通过后，G0 进入永久 `maintained`，不会归档。随后才允许启动已规划的 Result Studio 与 G1 能力工作。

Result Studio 的正式计划为 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md)，核心是：

- 结果交互、选择上下文和意图理解。
- Git-backed 脚本、参数、Manifest 和文本版本。
- ArtifactRevision、ChangeSet、Diff、比较、采用、撤销和恢复。
- 每个正式图表、表格和报告保留独立可执行脚本。
- 继续复用 `run_tool → tool_job → artifact truth`，不创建第二执行真相。

Result Studio 不属于 LF12 资格范围内的待开发功能；LF12 只验证当前结果投影和 UI 状态收敛。不得为了提前建设 Result Studio 而降低 LF12 资格要求。

## 12. 任意 Agent 接手提示

开始 LF12 前必须：

1. 读取 `docs/AUDIT-LOG.md`。
2. 读取本计划、`g0-living-foundation-plan.md`、module map、roadmap 和 handoff。
3. 核对 `main`、`origin/main`、工作区和当前 Baseline Manifest。
4. 先建立 Qualification Ledger 与失败 fixture，再实现裁决。
5. 不把无法执行的真实验收写成通过。
6. 不修改或提交其他 Agent/User 的 WIP。
7. 每个增量标明一个主 W/P 模块和必要的跨模块关注点。
8. 每波保持 `not_yet_qualified`，直到 Q6 最终裁决真实通过。
