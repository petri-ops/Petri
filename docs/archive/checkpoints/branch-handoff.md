# 并行分支待合并备忘录

> 维护方：非主 agent（只读审计 + 阻断性回归修复通道）
> 更新日期：2026-07-17（含 codex/* 分支 diff 审计结果）
> 用途：记录在 main 之外进行的并行工作分支，供主 agent / 项目负责人统筹合并时机

---

## 一、分支总览（2026-07-17 审计后）

| 分支名 | 状态 | 合并风险 | 建议操作 |
|--------|------|---------|---------|
| `fix/qa-smoke-stale-css-paths` | 🟢 待合并 | 零冲突 | 随时 merge |
| `codex/fix-collapsed-right-titlebar` | 🟡 待合并 | 三文件两边改过，无文本冲突但有语义风险 | 人工 review 后 merge |
| `codex/fix-collapsed-right-titlebar-minimal` | ⚪ 已合并残留 | - | 删除分支 |
| `codex/fix-external-webview-height` | ⚪ 已合并残留 | - | 删除分支 |
| `codex/restore-user-avatar` | ⚪ 已合并残留 | - | 删除分支 |
| `codex/restore-user-chat-bubble` | ⚪ 已合并残留 | - | 删除分支 |
| `codex/theme-linked-panels` | ⚪ 已合并残留 | - | 删除分支 |

**审计方法**：对每个分支执行 `git merge-base --is-ancestor <branch> main` 判定是否已包含，对未包含的分支执行 `git merge-tree` 预演检测冲突。

---

## 二、本非主 agent 创建的分支

### fix/qa-smoke-stale-css-paths 🟢

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

## 三、其他 agent 创建的分支（codex/*）

### codex/fix-collapsed-right-titlebar 🟡

| 字段 | 值 |
|------|-----|
| 分支名 | `codex/fix-collapsed-right-titlebar` |
| 提交 | `23705a3`（07-14 创建） |
| 改动 | 3 文件：`TitleBar.module.css`(+10)、`TitleBar.tsx`(129 行大改)、`project-workspace.tsx`(+4) |
| 是否已包含在 main | 否（有 1 个独立提交） |
| 文本冲突 | 无（`git merge-tree` 无 `<<<<<<<` 标记，git 能自动合并） |
| 语义冲突风险 | 中（三文件都 "changed in both"，见下） |

**关键风险点**：该分支基于 07-14 的 main 创建，但此后 main 已合并 `dcc9f2e`（`codex/fix-collapsed-right-titlebar-minimal`，即同一功能的 minimal 版本）及多次 Stage 1 UI 改动。合并预演显示三个文件都 "changed in both"：

| 文件 | main 侧改动 | 分支侧改动 |
|------|------------|-----------|
| `TitleBar.module.css` | minimal 版本 + Stage 1 UI 调整 | 完整版折叠逻辑 |
| `TitleBar.tsx` | minimal 版本 + Stage 1 UI 调整 | 完整版折叠逻辑（129 行重写） |
| `project-workspace.tsx` | Stage 1 多次改动 | 新增 useEffect（rightOpen 联动 rightToolMenuOpen） |

**判定**：虽然无文本冲突，但 `TitleBar.tsx` 被该分支重写了 129 行，而 main 侧也大改过同一文件。合并后可能出现**功能退化或重复逻辑**。**必须人工 review**，确认该分支的功能是否已被 main 的 minimal 版本覆盖，或需要手动 rebase 保留完整版逻辑。

**建议主 agent 处理方式**：
```bash
# 不要直接 merge，先看 diff 决定
git diff main...codex/fix-collapsed-right-titlebar
# 若决定采用，建议 rebase 到最新 main 再合并
git checkout codex/fix-collapsed-right-titlebar
git rebase main
# 解决可能的语义冲突后
git checkout main && git merge codex/fix-collapsed-right-titlebar
```

### 已合并残留分支（可安全删除）⚪

以下 5 个分支的 tip 提交均已包含在 main 中（`git merge-base --is-ancestor` 判定为是），是已合并的残留分支，**可安全删除**：

| 分支名 | tip 提交 | 说明 |
|--------|---------|------|
| `codex/fix-collapsed-right-titlebar-minimal` | `dcc9f2e` | 已合并入 main |
| `codex/fix-external-webview-height` | `8d51872` | 已合并入 main |
| `codex/restore-user-avatar` | `0b32e4d` | 已合并入 main |
| `codex/restore-user-chat-bubble` | `9755867` | 已合并入 main |
| `codex/theme-linked-panels` | `ee49a71` | 已合并入 main |

**删除命令**（建议主 agent 执行）：
```bash
git branch -D codex/fix-collapsed-right-titlebar-minimal \
             codex/fix-external-webview-height \
             codex/restore-user-avatar \
             codex/restore-user-chat-bubble \
             codex/theme-linked-panels
```

---

## 四、合并协作约定

为避免"不同 agent 干活不同步导致修改丢失"，约定如下：

1. **本非主 agent 只做两类工作**：
   - 只读审计和记录（文档提交到 main，主 agent pull 即可见）
   - 阻断性回归修复（走独立分支，记录到本备忘录）

2. **分支生命周期**：本 agent 创建的分支应**短命**，合并后立即删除，避免堆积。

3. **主 agent 责任**：每次开始 / 结束工作时，检查 `docs/branch-handoff.md` 和 `git branch` 是否有待合并分支。

4. **绝不**：force push、`reset --hard`、`git stash` 跨分支操作。

---

## 五、合并优先级建议

按风险从低到高，建议主 agent 按此顺序处理：

1. **先删除 5 个已合并残留分支**（零风险，清理工作区）
2. **合并 `fix/qa-smoke-stale-css-paths`**（零冲突，恢复门禁绿色）
3. **评估 `codex/fix-collapsed-right-titlebar`**（需人工 review，可能与 main 的 minimal 版本功能重复）
4. **完成 MODEL 工作后**，执行 `docs/archive/checkpoints/stage2-acceptance-audit.md` 第四节的实机验收

---

*本备忘录由非主 agent 维护。主 agent 合并本备忘录中任一分支后，请更新对应条目状态或删除已合并条目。*
