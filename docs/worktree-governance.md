# Petri Git Worktree 开发治理规范

最后更新：2026-11-02

规范编号：`GOV-WT-1`

状态：`active policy / infrastructure ready (v1)`（2026-11-02 BLOCK-336 交付：休眠期结束，本规范 §3～§8 由「人工纪律」转为「有基础设施承载的正式流程」；v1 能力边界见 §2.1——**§5 只实现端口约定、§7 缺 Artifact 检查**，两项如实登记、不代偿、不外推）

## 1. 定位

Git Worktree 不是复制项目，也不是把当前目录转移到多个目录。它让同一 Git 仓库的不同分支在不同工作目录中同时检出，共享对象数据库和提交历史，但各自拥有独立的工作区与索引。

Petri 使用 Worktree 的目标是隔离有边界的并行开发和运行环境，不是无限增加并发 Agent。最终交付仍通过 Git commit、review、merge 或明确的 patch 完成，禁止靠 `cp` 合并目录。

## 2. 启动门与基础设施现状（v1）

当前没有活跃 Worktree；基础设施已就绪，按本文件 §3～§8 正式流程使用。

历史上曾规划的路径是 `G0-LF12 干净 checkpoint → G0-RS-WT0 → 创建 Result Studio 永久 Worktree → G0-RS0～G0-RS9`。LF12 已 `qualified + maintained`，该前置条件不再阻塞；2026-07-24 复核认定隔离收益已随 LF 开发线关闭而消失，`G0-RS-WT0` 标记 `deferred`，Result Studio 改为在主工作区单线串行开发。判据与重开条件记录在 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) §14。

**2026-11-02 重开点（BLOCK-336 交付生效）**：本规范的重开条件由 BLOCK-336「worktree 通用基础设施 v1」触发并由其交付关闭——八节纪律不再是纯文档，而是有机械承载：

| § | 承载物 | 证据 |
| --- | --- | --- |
| §3 适用标准 | 用户裁决即重开点；首批消费者=BLOCK-335 自优化闭环（项目层副本） | 见本文件状态段 |
| §4 一一对应 | agent 工具 `workspace_worktree_create/list/remove/merge_request` + `helpers/worktree-contract.checkContract`（分支/目录/Agent/包四规则一次报全） | `test/block336-worktree-infrastructure.test.mjs` 10/10 |
| §5 环境隔离 | `derivePortBase`（`PETRI_WORKTREE_PORT_BASE`，默认 3101、步长 10）写入登记条目 `ports` | 同上（**仅端口约定**，见 §2.1） |
| §6 同步与合并 | `merge_request` 只出摘要（`merged=false`）、主仓 HEAD 不变；**工具永不 merge** | 单测 + 实机 V7 |
| §7 保留与移除 | 脏树 fail-closed 并列文件、`allowUnmergedAhead` 显式档、确认后 `--force`、**分支保留** | 单测 + 实机 V8-V11 |
| §8 集中管理 | `<dataDir>/worktrees/registry.json` 单源 + `worktree-audit.jsonl` 永久证据 + `task_events` 当下可观测流 | 单测 + 实机 V12-V13 |

**项目层入口**：`createProject({ worktreeOf })` 让「项目本身」是某个本地 git 项目的副本（`workspace_path` 指向 `<dataDir>/worktrees/<projectId>`，分支 `worktree/<projectId>`，删除时联动清理并保护脏树）。REST：`POST/PUT/DELETE /api/data/projects`（脏树删除需 `?confirmWorktreeDirty=1`，否则 409 + 文件清单）。

### 2.1 v1 能力边界（如实登记，不得代偿）

- **§5 只实现端口约定**：Electron `userData`、SQLite、结果/上传/tmp/日志的物理隔离**尚未自动装配**——在 Worktree 内跑完整后端实例仍属 reopen（见 plan frontmatter）。
- **§7 缺 Artifact 检查**：移除前的「Artifact/ChangeSet 没有只存在于该目录」目前靠人工核对，v1 无关联面。
- **并发**：v1 是「一包一副本」串行语义；多副本并发写同一主仓的合并队列属 reopen。
- 上述三项的 reopen 判据以 [`block-336-worktree-infrastructure-plan.md`](./block-336-worktree-infrastructure-plan.md) frontmatter 为准（本文件不另立判据）。

因此本规范自 2026-11-02 起是**生效纪律**：§3～§8 为唯一执行标准，不得临时另立简化流程；能力边界按 §2.1 如实执行，越界即停在边界上报，不得用文档措辞代偿实现缺口。

## 3. 适用标准

只有满足以下条件才适合新建 Worktree：

- 工作包有稳定 ID、明确范围、验收与文件所有权。
- 基础分支是已验证、已提交的 checkpoint。
- 工作持续时间或运行环境足以证明隔离收益高于同步成本。
- 与其他活跃工作包不存在模糊的核心文件所有权。
- 端口、SQLite、Electron `userData`、结果和日志能够物理隔离。

以下情况不应新建：一次性小修、同一文件的并行编辑、主线有未知未提交改动、只是为了多开 Agent、没有合并与验收边界。

## 4. 一一对应契约

每个活跃 Worktree 必须登记并保持：

| 字段 | 要求 |
| --- | --- |
| Worktree 名称/路径 | 唯一、可识别，不放进主仓库受跟踪目录 |
| Branch | 使用 `codex/<work-package>-<scope>` 或工作包批准的固定分支 |
| Owner | 一个主 Agent/线程负责最终状态 |
| Plan ID | 绑定唯一工作包，不承载无关任务 |
| Base checkpoint | 记录来源 commit |
| File ownership | 明确主要目录和共享契约文件 |
| Runtime namespace | 独立端口、数据目录、日志与临时目录 |
| Merge gate | 明确测试、证据、review 与目标分支 |

Worktree 目录可长期保留，但不能被当作备份。可恢复性来自 commit、Artifact、Acceptance 和 Handoff，而不是某个未管理的目录仍然存在。

## 5. 环境隔离

- 每个 Worktree 使用独立的 Electron `userData`、SQLite、results/uploads/tmp/logs。
- Vite、R/Python/Plumber 与其他后台进程使用不冲突的端口，并记录进程归属。
- `node_modules`、原生 ABI 与构建目录在各 Worktree 内独立初始化，不共享可变构建产物。
- 只复制 `.worktreeinclude` 明确允许的忽略文件；API Key、凭据和项目外私有数据默认不复制。
- Worktree 隔离不改变源数据不可变、Artifact Truth、项目权限和科学验证边界。

## 6. 同步与合并

1. 开工前确认 base commit、目标分支和工作区 clean。
2. 共享契约发生变化时及时广播；若另一 Worktree 依赖旧契约，停止并先重新对齐。
3. 提交保持工作包内聚，不混入主工作区或其他 Worktree 的改动。
4. 合并前复核目标分支新提交、语义冲突、专项门禁和根检查。
5. 通过 Git 合并、rebase 或经 review 的 cherry-pick/patch 交付；不得复制整目录覆盖。
6. 合并后在目标分支重跑与风险相称的检查，文档和注册表随工作包一起收口。

## 7. 保留与移除

完成阶段后可以移除 Worktree；无近期用途时应移除，避免目录、端口和分支状态误导后续 Agent。短期保留只在以下情况下合理：

- 工作包尚有明确下一波，且 owner、分支和 Handoff 仍有效。
- 需要保留独立实机/打包复验环境。
- 尚有已登记、未采用的 ChangeSet 或 Artifact 需要处理。

移除前必须确认：

- 工作区无未提交改动，或已形成明确 commit/snapshot。
- 需要的提交已合并、推送或以可恢复方式保存。
- Artifact、脚本、Acceptance 和未采用 ChangeSet 没有只存在于该目录。
- 独立进程已停止，端口和运行目录已释放或保留有说明。
- Handoff、Worktree 登记和分支状态已更新。

严禁强制移除含未知 WIP 的 Worktree。普通移除不会删除已提交历史，但未提交文件可能丢失，因此清理动作必须显式、可审计。

## 8. Codex 集中管理方式

Codex 每次恢复并行开发时先读取：

```bash
git worktree list --porcelain
git status --short --branch
git branch --verbose --verbose
```

随后按 Plan ID 核对 owner、路径、base、当前提交、WIP、测试和合并目标。Codex 可以集中汇总状态与安排串并行顺序，但不能跨 Worktree 擅自提交、丢弃或清理其他 Agent 的 WIP。
