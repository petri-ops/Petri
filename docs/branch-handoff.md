# 并行分支待合并备忘录

> 维护方：非主 agent（只读审计 + 阻断性回归修复通道）
> 更新日期：2026-07-17
> 用途：记录在 main 之外进行的并行工作分支，供主 agent / 项目负责人统筹合并时机

---

## 一、由本非主 agent 创建的分支

### fix/qa-smoke-stale-css-paths

| 字段 | 值 |
|------|-----|
| 分支名 | `fix/qa-smoke-stale-css-paths` |
| 提交 | `ce1f054` |
| 改动 | `scripts/qa-smoke.mjs`（2 行删除） |
| 基于提交 | `c71916d`（main 的 MODEL 工作之前） |
| 阶段归属 | **不属于 MODEL-1~5，不推进任何阶段进度**，归类为 roadmap 允许的「阻断性回归随时修复」平行通道 |
| 与 MODEL 文件重叠 | 零重叠（仅改检查脚本，不碰 core/、frontend/src/、src/main.js） |
| 合并冲突风险 | 极低 |

**根因**：Stage 1 期间两个页面（`_desktop-dashboard.module.css`、`tools.module.css`）被重构移除，但 qa-smoke themes 检查仍硬编码引用这两个不存在的路径，导致 5 项检查全部失败。该失败在 MODEL 工作开始前就已存在（core 去耦提交 `9ab94f3` 已记录为历史遗留 baseline）。

**处理方式**：从 `cssFiles` 列表移除两个陈旧路径。移除后剩余 9 个真实存在文件，`--biof3-*` token 合计 1478 处，远超阈值 10，检查仍然有效。qa-smoke 全部 7 项检查恢复绿色。

**合并方式**（建议主 agent 执行）：
```bash
git merge fix/qa-smoke-stale-css-paths
# 或
git cherry-pick ce1f054
```

**合并时机**：任何时候均可，不依赖 MODEL 工作完成。建议主 agent 在下一次合入前顺手 merge，让门禁恢复绿色。

---

## 二、已存在的 codex/* 分支（非本 agent 创建，仅供记录）

以下分支由其他 agent（codex 终端）在独立 worktree 中创建，与主 agent 的 MODEL 工作可能存在重叠风险。**本 agent 未审计其内容，合并前需主 agent 自行核对。**

| 分支名 | 提交 | worktree 路径 | 描述 |
|--------|------|---------------|------|
| `codex/fix-collapsed-right-titlebar` | `23705a3` | `/private/tmp/biof3-collapse-titlebar` | Fully collapse right title bar tools |
| `codex/fix-collapsed-right-titlebar-minimal` | `dcc9f2e` | `/private/tmp/biof3-collapse-minimal` | Fully collapse right title bar tools |
| `codex/fix-external-webview-height` | `8d51872` | `/private/tmp/biof3-webview-flex` | Fix external browser webview height |
| `codex/restore-user-avatar` | `0b32e4d` | `/private/tmp/biof3-user-avatar` | Restore user avatar in chat messages |
| `codex/restore-user-chat-bubble` | `9755867` | `/private/tmp/biof3-chat-bubble` | Restore themed user chat bubbles |
| `codex/theme-linked-panels` | `ee49a71` | `/private/tmp/biof3-desktop-theme-sync` | Sync reports browser and file tree themes |

**风险提示**：
- 这些分支都涉及前端 UI（titlebar / webview / avatar / chat bubble / theme），与主 agent 的 MODEL 工作（core/ + frontend 模型相关文件）**文件重叠风险较低**，但仍需主 agent 逐一核对 diff。
- 其中 `codex/restore-user-chat-bubble` 和 `codex/restore-user-avatar` 可能涉及 SimpleChat 组件，而 SimpleChat 也被 MODEL 的 `useAiSettings` 迁移影响过，合并时需重点检查冲突。
- 建议合并顺序：先合并本 agent 的 `fix/qa-smoke-stale-css-paths`（零风险），再由主 agent 逐一评估 codex/* 分支。

---

## 三、合并协作约定

为避免"不同 agent 干活不同步导致修改丢失"，约定如下：

1. **本非主 agent 只做两类工作**：
   - 只读审计和记录（文档提交到 main，主 agent pull 即可见）
   - 阻断性回归修复（走独立分支，记录到本备忘录）

2. **分支生命周期**：本 agent 创建的分支应**短命**，合并后立即删除，避免堆积。

3. **主 agent 责任**：每次开始 / 结束工作时，检查 `docs/branch-handoff.md` 和 `git branch` 是否有待合并分支。

4. **绝不**：force push、`reset --hard`、`git stash` 跨分支操作。

---

*本备忘录由非主 agent 维护。主 agent 合并本备忘录中任一分支后，请更新对应条目状态或删除已合并条目。*
