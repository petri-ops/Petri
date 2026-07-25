# BioF3 项目与文档生命周期规范

最后更新：2026-07-24

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

## 5. 当前渐进治理策略

2026-07-24 建立首个注册基线时，现存非归档 Markdown 全部纳入机器覆盖，但不批量移动历史文件。后续每次工作包收口只处理与该 Plan ID 相关的文档候选，逐步降低历史噪声。

LF12 已完成资格裁决并晋升 `G0 Baseline v1 = 1.0.0 qualified + maintained`，注册表中 `G0-LF12` 随之收口为 `completed`，`g0-current-work-package` 这一 truthDomain 已释放给下一个正式启动的工作包。其 acceptance 证据是长期资格记录，任何治理动作不得按普通文档搬迁、改写或重新生成。

Result Studio 与正式长期 Worktree 的 LF12 阻塞条件已解除，启动仍须满足 `G0-RS-WT0`：从已推送的干净 checkpoint 创建，并完成运行环境隔离验收。

## 6. 门禁命令

```bash
npm run docs:status
npm run docs:reconcile
npm run docs:check
```

- `docs:status`：查看注册数量、状态、类型、未注册文件和契约问题。
- `docs:reconcile`：查看孤立文档、归档候选、稳定保留项和冲突，不写文件。
- `docs:check`：作为提交和根检查门禁；注册缺失、路径失效、入口断链或 canonical 冲突时失败。

根 `npm run check` 包含 `docs:check`。这保证 Agent 不能在添加孤立计划后仍把项目宣称为已收口。
