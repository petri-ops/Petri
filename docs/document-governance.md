# BioF3 项目与文档生命周期规范

最后更新：2026-08-16

规范编号：`GOV-DOC-1`

状态：`active / continuously enforced`

## 1. 目标

本规范保证任意 Agent 在长周期开发、上下文压缩、模型切换或人员交接后，都能从仓库恢复同一份项目事实，不再依赖聊天记忆或散落的临时计划。

治理由四层共同完成：

1. `AGENTS.md`：规定强制触发点和不可绕过边界。
2. `docs/`：保存人可读的 canonical 事实与完整规则。
3. `$biof3-project-governance`：规定 Agent 的执行顺序。
4. `scripts/docs-governance.mjs`：提供确定性的注册、覆盖和冲突门禁。

文档只能解释和索引事实，不能把未通过的代码、科学结果、UI 或资格状态写成通过。

## 2. 唯一事实分工

| 事实 | Canonical 位置 | 禁止做法 |
| --- | --- | --- |
| 长期方向 | `scientific-intelligence-os-vision.md` | 在短期计划中重写愿景 |
| 产品阶段顺序 | `v1-productization-roadmap.md` | 多份 roadmap 同时决定下一阶段 |
| 当前立即任务 | `next-steps-roadmap.md` | 用历史完成记录冒充当前任务 |
| 可恢复工程状态 | `project-workspace-handoff.md` | 只在聊天中保存 WIP/风险 |
| G0 永久基础主线 | `g0-living-foundation-plan.md` | 新建第二套 G0 主计划 |
| 当前工作包 | 对应唯一 Plan ID 文档 | 为每次进展新建一份计划 |
| UI 验收状态 | `ui-productization-audit.md` | 没有实机证据就写 verified |
| 审计广播 | `AUDIT-LOG.md` | 把阻塞发现只留在个人报告 |
| 机器可读目录 | `DOC-REGISTRY.json` | 新建无入口、无状态的 Markdown |

Git、SQLite、Artifact Truth、Acceptance Evidence 和实机结果优先于文档描述。发现不一致时先降级文档结论，再修复或补证据。

### 2.1 单工作包串行

项目采用单线串行开发：同一时间只有一个工作包处于 `active`，且该工作包内只有一个阶段处于进行中。上一阶段的交付、门禁与证据收口后才启动下一个。

因此：

- 不为提高并发而同时开启多个工作包，也不提前实现后续阶段的契约、迁移或 UI。
- 需要调整顺序时先修改 canonical 计划，再执行，不在实现中默默改序。
- `g0-current-work-package` 这一 truthDomain 由当前正式启动的工作包按需声明；无人声明时保持空缺，当前任务事实以 `next-steps-roadmap.md` 为准。
- 并行开发与 Worktree 属于例外，需满足 `worktree-governance.md` 的重开条件后才可启用。

## 3. 注册表契约

`docs/DOC-REGISTRY.json` 对 `docs/` 下除 `docs/archive/` 外的 Markdown 强制完整注册；已归档条目可按追溯需要继续保留在注册表。每项至少包含：

- `id`：稳定且唯一的文档或工作包标识。
- `path`：仓库相对路径，不允许绝对路径或 `..`。
- `kind`：文档责任类型。
- `status`：生命周期状态。
- `canonical`：是否代表某类当前唯一事实。
- `archivePolicy`：归档策略。

Canonical 文档还必须声明唯一 `truthDomain`。处于 `active` 或 `planned` 的 canonical 文档必须有 `entrypoint`，且入口必须真实链接到它。

允许的 `kind`：

- `governance`、`vision`、`roadmap`、`living-plan`
- `work-package`、`handoff`、`audit`
- `reference`、`release`

允许的 `status`：

- `active`：当前持续维护并决定事实。
- `planned`：已批准但尚未跨过启动门。
- `completed`：验收已完成，仍可能保留为证据记录。
- `reference`：稳定规范或背景，不决定当前优先级。
- `superseded`：已由明确文档替代，等待安全归档。
- `archived`：只用于 `docs/archive/`，不参与当前决策。

允许的 `archivePolicy`：

- `never_archive`：长期宪章、入口或持续台账。
- `retain_stable_path`：被代码、证据或长期规范稳定引用。
- `archive_after_completion`：完成并解除引用后可归档。
- `archive_when_superseded`：出现正式替代者并完成引用迁移后可归档。
- `manual_review`：历史状态或依赖不够明确，必须人工核对。



### 3.1 扩展字段填法与一致性约束

以下字段都是 **optional**，但一经填写就必须遵守本节给出的时机约束与一致性约束。注册表 schema 校验在 `scripts/docs-governance.mjs` 的 `validateDocumentRegistry` 内执行；任何与本节冲突的写法都会在 `npm run docs:check` 报错，提交前必须修复。

#### 3.1.1 `registeredAt`

- 类型：ISO-8601 date string（`YYYY-MM-DD`）。
- 填写时机：登记项第一次被加入 `docs/DOC-REGISTRY.json` 时填写；登记项存在一天后再补记会被视为重写历史。
- 一致性约束：`registeredAt` 日期不得晚于当前 Git 仓库中该路径的首次提交（`git log --diff-filter=A --format=%as -- <path>`）；不晚于当前日期。
- 用途：审计可追溯；若文档迁移后路径变更，需保留原始 `registeredAt` 日期并通过 `notes` 字段追加迁移说明。

#### 3.1.2 `linkedCommits`

- 类型：`string[]`，元素为完整或 7 字符短 SHA。
- 填写时机：登记项涉及的关键收口 commit（例如收口 PR 的 merge commit、收口笔录 commit）落库后填写。每条登记项的 `linkedCommits` 总数 ≤ 5；超过 5 条需在 `notes` 中指向汇总台账。
- 一致性约束：每个 SHA 必须存在于仓库 Git 历史（`git cat-file -t <sha>`）；不得写入未推送的 commit。在文档迁移、状态变更或重新收口时同步追加，不得删除既有 `linkedCommits` 条目（除非该 commit 被 force-push 撤回）。

#### 3.1.3 `tags`

- 类型：`string[]`，元素为小写 kebab-case 标识，长度 2–24。
- 填写时机：用于跨登记项的主题检索与过滤；新增 tags 需与至少 1 个现有登记项复用（避免造词）。tags 不替代 `kind` / `status`；同一登记项 tags 数量 ≤ 6。
- 一致性约束：tags 集合包含 `archived` 或 `superseded` 状态登记项时，仍保留历史检索价值；不得在状态变更时删除 tags。

#### 3.1.4 `supersededBy`

- 类型：可选 `string[]`（元素为登记项 id）。
- 填写时机：仅在登记项进入 `superseded` 状态且候选替代登记项已落地（pathExists + schema PASS）后填写，不得提前；进入 `archived` 状态时仍可保留，作为追溯指针。
- 一致性约束：
  - 数组每个元素必须存在于注册表（`DOC-REGISTRY.json` 当前 `documents[]` 中）。
  - 数组中至少 1 个元素的 status 必须是 `active` / `planned` / `reference` / `completed`（保证替代者真正存在）。
  - 同 id 不得同时存在 `supersedes` 双向链（避免 A→B 且 B→A 循环）。
  - `supersededBy` 与 `supersedes` 字段类型完全不同：前者是"被替代"的去向，后者是"主动替代"的来向；允许同时存在但作用不同。
- 脚本校验：`validateDocumentRegistry` 会检查 `supersededBy` 类型为数组、元素已注册；若任一元素 status 为 `archived` / `superseded` 自身则报错。

#### 3.1.5 `notes`

- 类型：自由文本，≤ 240 字符。
- 填写时机：补充注册项或历史背景的简短说明，例如迁移路径、状态变更原因、scope 边界。长说明必须用专属文档（如 `docs/...` 或 `acceptance/...`）而不是挤进 `notes`。
- 一致性约束：不得在 `notes` 中写入与 `kind` / `status` / `canonical` / `truthDomain` 重复或冲突的事实；冲突时以这些字段为准。不得把 `notes` 当作"待办"使用（待办走 AUDIT-LOG，不入注册表）。

#### 3.1.6 字段一致性联动

- `canonical` 字段一旦从 `true` 改为 `false`，同一条目下的 `truthDomain` 字段必须删除（已在 P2 收口强制执行）。
- `status` 字段为 `archived` 或 `superseded` 时，条目不得保留 `truthDomain`（脚本侧 GATES-3 强制校验）；如需保留历史分组，使用 `tags`。
- `id` 字段一经登记不得修改；若登记项需换 id，必须新建条目并把旧条目改为 `superseded` 状态指向新条目。

### 3.2 JSON 输出契约（`--report` 模式）

`docs/` 治理栈的 3 个常驻门禁脚本（`scripts/docs-governance.mjs` /
`scripts/check-ui-productization-audit.mjs` / `scripts/test-affected.mjs`）在
`DOC-GOVERNANCE-GATES / GATES-2`（2026-08-16）阶段统一提供 `--report <path>`
JSON 输出模式，与既有 `--status` / `--check` / `--reconcile` / `--json` / `--run`
互不冲突。

详细规则、schema 索引与同步引用见 [`docs/schemas/README.md`](./schemas/README.md)。

#### 3.2.1 公共字段语义

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schemaVersion` | `integer`（const 1） | GATES-2 锁定为 1；扩展字段在 v2 引入 |
| `generatedAt` | ISO-8601 string | 报告产出时间 |
| `script` | string (const) | 产生报告的脚本路径；稳定标识 |
| `mode` | `"report"` | 始终为 `report` |
| `exitCode` | `0 \| 1 \| 2` | 进程退出码，与 §4.5 契约一致 |
| `summary.status` | `PASS \| FAIL \| CLASSIFICATION_CONFLICT` | 业务分类 |
| `summary.result` | `pass \| fail \| classification_conflict` | 小写机器友好等价 |
| `reportPath` | absolute path | 落盘路径；写失败时省略 |

各脚本的 `issues` / `failures` / `plan` 字段定义见各自 schema。

#### 3.2.2 强制约束

- `--report <path>` 必须出现在 argv 中且下一 token 必须是非空、非 `--` 前缀的路径。
- 写盘前 **必须** schema 校验通过；写入失败或 schema 失败 → exit 2（分类冲突）。
- `--report` 与 `--status` / `--check` / `--reconcile` 互斥（仅对 `docs-governance` 适用）。
- 报告产出永远走共享 helper `scripts/lib/gate-report-schema.mjs` 的 `validateReport()`；
  优先使用 Ajv 6.x（已 transitive devDep），缺失时降级为内置 draft-07 子集。
- 报告内容**不得**包含绝对用户家目录、密码、token 等敏感字段；如需引用路径须是仓库相对路径。

#### 3.2.3 同步引用

- canonical schema 索引：[`docs/schemas/README.md`](./schemas/README.md)
- 计划：[`docs/doc-governance-gates-plan.md` §2 GATES-2](./doc-governance-gates-plan.md)
- skill：`$biof3-project-governance` 的"Run the deterministic controls"
- 退出码定义：本文件 §4.5

## 4. 生命周期

### 4.1 创建

1. 先检查注册表和现有计划，确认不是已有 Plan 的增量。
2. 定义稳定 ID、唯一责任、范围外事项、依赖、验收与证据路径。
3. 添加注册项和至少一个明确入口。
4. 若改变当前优先级，同步 roadmap、next steps 和 handoff；否则不要制造无意义状态改动。
5. 运行 `npm run docs:check`。

临时分析笔记优先放任务工作目录或聊天，不要默认进入长期 `docs/`。

### 4.2 执行中

- 进展回写原工作包，不按日期创建重复状态文档。
- 只有当前事实变化才更新 handoff；长篇证据进入 acceptance 或专项记录。
- 工作包状态由门禁和证据决定，不由任务耗时、提交数量或 Agent 自述决定。
- 发现 canonical 冲突时停止宣称完成，先执行 reconcile。

### 4.3 完成

完成一个 Goal、阶段或工作包时必须同时满足：

1. 计划内验收项有对应的当前证据。
2. 工作包正文写明最终状态、范围和遗留边界。
3. 当前 roadmap、next steps、handoff 与审计/UI 台账按责任同步。
4. 注册表状态和归档策略准确。
5. `npm run docs:reconcile` 已复核。
6. `npm run docs:check` 通过。

科学、Provider、packaged-app、视觉和长时间运行证据不能被普通单元测试或文档勾选替代。

### 4.4 Supersede 与归档

- 替代文档先登记 `supersedes`，再迁移所有 canonical 入口。
- Acceptance 证据不作为普通历史文档移动；其保留规则由对应验收契约决定。
- 归档前核对 Git 状态、入站引用、Plan ID、未完成事项和可恢复提交。
- `docs:reconcile` 只生成候选，不自动移动、删除或改写文件。
- 禁止按时间批量归档，禁止在未知 WIP 存在时大范围整理。
- 完成但仍被稳定引用的 Harness、Plugin、G0 规范保持 `completed/reference + retain_stable_path`，不为追求目录整洁破坏链接。

### 4.5 门禁退出码契约

`docs/` 治理栈的 3 个常驻门禁脚本（`scripts/docs-governance.mjs` /
`scripts/check-ui-productization-audit.mjs` / `scripts/test-affected.mjs` —
`npm run test:changed:list` 实际入口）共享同一套退出码契约，2026-08-16
经 DOC-GOVERNANCE-GATES / GATES-1 阶段固化：

| 退出码 | 语义 | 触发场景 | 处理动作 |
| --- | --- | --- | --- |
| `0` | PASS | 校验通过 / 状态报告正常输出 / 全部测试通过 | 视作收口 |
| `1` | FAIL | 校验发现问题（注册缺失、路径失效、入口断链、canonical 冲突）；UI 实现未同步台账；node test / 门禁子命令非 0 退出 | 必须修复后才能宣称收口 |
| `2` | 分类冲突 | CLI 调用冲突（同时传入多个互斥模式）；`test:changed` 改动文件未被 `test/impact-map.json` 任一规则匹配；`test-affected.mjs` 解析 / 校验异常；UI 门禁 GATES-3 触发 `hasUnmappedSurface`（commit subject 引用未在 `docs/ui-productization-audit.md` 注册的 UI-### 编号且不在 `LEGACY_EXEMPTIONS`）；`--print-mode=development` 模式下未命中 `LEGACY_*_EXEMPTIONS` 的 UI_AUDIT_SYNC / UI_ID_MISSING 降级为 2；UI `--report` 模式写盘失败 / schema 校验失败 | **不是 fail-closed**：补 rule / 加 patterns / 修 CLI 调用 / 把未登记 UI-### 写入 `docs/ui-productization-audit.md` 后重跑，绝不代表业务代码或工作包"未通过" |

`2` 的语义在过去常被误解为 fail-closed。本契约明确把"分类冲突"与
"实际 FAIL"拆开：`2` 只描述工具调用 / 分类层的歧义，与 `docs/` 治理栈
是否在当前工作包内"未通过契约"无关。所有 `2` 路径必须输出明确"分类冲突"
诊断消息，并在 stderr 提示处理方式（见 `scripts/test-affected.mjs`
`printPlan` 与底部 `catch` 分支）。

收口前后，所有 `npm run docs:check` / `npm run ui:audit:check` / `npm run
test:changed:list` 调用方必须按上述契约解释退出码；任何把 `2` 视作"工作包
未通过"的描述在收口笔录中都会被纠正。

## 5. 当前渐进治理策略

2026-07-24 建立首个注册基线时，现存非归档 Markdown 全部纳入机器覆盖，但不批量移动历史文件。后续每次工作包收口只处理与该 Plan ID 相关的文档候选，逐步降低历史噪声。

LF12 已完成首次核心资格裁决。2026-07-25 产品复核确认 RS9 的 Result Studio qualification 主要由独立测试、fixture、renderer seed 与人工视觉布尔值组合，不能证明连续真实产品任务；因此 LF12 原始核心资格继续 maintained，`result-studio-editing` 支持声明暂停，`G0-RS` 重新成为唯一 active 工作包并按 RS-P0～P7 收口。`G0-SDC0` 已完成且保留，SDC-1～SDC-7 为 planned/deferred。既有 qualification 与 Result Studio acceptance 证据作为历史证据保留，但必须按真实类型分类，不能据此继续外推产品资格。

`G0-RS-WT0` 继续 `deferred`：当前 Result Studio 产品收口在主工作区单线串行执行，不创建 Worktree；如将来满足 `worktree-governance.md` 的重开条件，必须先从已推送干净 checkpoint 建立并隔离运行环境。

## 6. 门禁命令

```bash
# docs/ 治理栈（默认人类可读）
npm run docs:status
npm run docs:reconcile
npm run docs:check

# 机器可读 JSON 报告（GATES-2 阶段入侵，--report 模式）
node scripts/docs-governance.mjs --report /tmp/docs-report.json
node scripts/check-ui-productization-audit.mjs --report /tmp/ui-report.json
node scripts/test-affected.mjs --report /tmp/test-report.json
```

- `docs:status`：查看注册数量、状态、类型、未注册文件和契约问题。
- `docs:reconcile`：查看孤立文档、归档候选、稳定保留项和冲突，不写文件。
- `docs:check`：作为提交和根检查门禁；注册缺失、路径失效、入口断链或 canonical 冲突时失败。

`--report <path>` JSON 输出模式（GATES-2 / 2026-08-16 加固）：

- 与 `--status` / `--check` / `--reconcile` 互斥，输出机器可读 JSON，落盘前必须
  schema 校验通过；写失败 / schema 失败 → exit 2（分类冲突）。
- 字段语义与 schema 索引见 §3.2 与 [`docs/schemas/README.md`](./schemas/README.md)。
- 与 `ui:audit:check` / `test:changed:list` pipeline 联动：CI / sub-agent 可直接
  消费 JSON 报告，无需 reparse stdout。

根 `npm run check` 包含 `docs:check` 与 `ui:audit:check`，但**不**自动触发 `--report`。
`--report` 仅在调用方显式传入 path 时启用，避免污染常规 gate 输出。
