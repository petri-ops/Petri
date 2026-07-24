# BioF3 Git Worktree 开发治理规范

最后更新：2026-07-24

规范编号：`GOV-WT-1`

状态：`active policy / formal rollout gated by G0-RS-WT0`

## 1. 定位

Git Worktree 不是复制项目，也不是把当前目录转移到多个目录。它让同一 Git 仓库的不同分支在不同工作目录中同时检出，共享对象数据库和提交历史，但各自拥有独立的工作区与索引。

BioF3 使用 Worktree 的目标是隔离有边界的并行开发和运行环境，不是无限增加并发 Agent。最终交付仍通过 Git commit、review、merge 或明确的 patch 完成，禁止靠 `cp` 合并目录。

## 2. 正式启动门

当前正式 Worktree 主线固定为：

```text
G0-LF12 qualified + maintained 并形成干净、已提交 checkpoint
  → G0-RS-WT0 Codex Worktree Readiness
  → 创建 Result Studio 永久 Worktree
  → G0-RS0～G0-RS9
```

LF12 完成前不得为了提前开发 Result Studio 创建正式 RS Worktree。`G0-RS-WT0` 的详细交付和验收仍以 `g0-result-studio-plan.md` 为准，本文件提供跨阶段长期纪律。

当前状态：LF12 已 `qualified + maintained`，该前置条件不再阻塞。剩余启动条件只有 `G0-RS-WT0` 本身——base checkpoint 已提交并推送、工作区 clean、运行环境隔离验收通过。

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
