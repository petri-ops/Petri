# BLOCK-29.5-REVIEW-READONLY-VISION — 审阅 git 只读视野扩展（遮挡修复 + 全分支历史 + blame + 两提交对比 + 小件） Plan

- **Plan ID**: `BLOCK-29.5-REVIEW-READONLY-VISION`（用户裁决「确认」，2026-08-30——确认启动上轮列出的只读视野候选菜单）
- **状态**: `active`（P0）
- **truthDomain**: `block-29-5-review-readonly-vision`
- **阶段**: P0 登记（本 commit）→ P1~P5 串行（每个 PHASE 独立提交 + 独立 UI-### 台账同步）→ P6 桥桩实机总验收 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景

用户方向「理论上只要想都应该能看到的」。UI-223/224 已交付提交详情头与文件全文；本包把剩余只读视野一次补齐。**全部为只读**：查看任意分支/标签的提交史、逐行归属、任意两提交对比、stash/标签查看、未跟踪文件预览。写操作（分支切换、暂存区两栏、push-pull、stash pop/apply）维持此前裁决排除。

## 2. 阶段

- **P1（UI-225）窄面板「改动/历史」tab 遮挡修复**：根因——`.rvw-summary` 不换行，窄宽度下 `summary-left`（flex:1）被挤到近 0 宽，`summary-actions` 起点左移，其内容叠在 tabs 命中区上（UI-219 观察项、UI-223/224 验收两次实锤真实点击被拦）。修复：`.rvw-summary` 允许 wrap、`summary-left` `min-width: fit-content`（tabs/stats 不再被挤压）、`summary-actions` `flex-wrap + justify-content: flex-end`。验收 = 真实 Playwright 点击（非 force）通过 + 截图。
- **P2（UI-226）全分支历史**：adapter `listBranches()`（`for-each-ref refs/heads`，只读）+ ref 校验提为 `assertSafeRef` helper；`git:commit-log` 参数 additive 透传 `ref`；新只读 IPC `git:branch-list`；hook 增 `branches/activeBranch`，历史头部加分支选择器（当前分支标记，切换即按该 ref 重载历史）；不切工作区分支、不写 refs。
- **P3（UI-227）blame 逐行归属**：adapter `blame({path, ref})`（`--porcelain` 解析，commit 信息按 sha 去重，行数上限 fail-closed 截断）；新只读 IPC `git:blame`；提交文件视图增第四态「blame」（行号 + shortSha + 作者·日期 + 内容三列等宽栅格，标注该提交时点版本）。
- **P4（UI-228）任意两提交对比**：`git:commit-diff` 参数 additive 支持 `{fromRef, toRef}` 区间模式（复用 `parseDiffFiles` 与 sha/ref 白名单）；`git:commit-file-content` 支持 `{fromRef, toRef}` 区间取两版全文；hook 增对比模式（历史头部「对比」入口 → 依次点两提交 = 基准→目标 → 渲染区间文件条 + diff，标题显示 `A..B`，可退出）。
- **P5（UI-229）小件**：① stash 只读列表（adapter `stashList()` + IPC `git:stash-list` + 历史头部入口，仅查看不 pop/apply）；② 标签：adapter `tagList()` + IPC `git:tag-list` + 历史选择器标签分组；③ 未跟踪文件预览：手风琴未跟踪行展开经既有 `fileContent({ref:'WORKTREE'})`（`fileWorkTreeContent` 本就读磁盘）渲染只读全文，替换占位说明。

**非范围**：分支切换 / 暂存区两栏 / push-pull / stash 写操作 / commit amend / AI 审阅 0 重新引入；0 新依赖。

## 3. 门禁（每 PHASE）

tsc 0 / 定向 vitest（adapter 解析单测或组件用例随 PHASE 增）/ node --check（改 adapter/IPC 时）/ docs:check / ui:audit:check；P6 总验收：localhost:3000 磁盘真实 git 桥桩跨分支/blame/对比/stash/未跟踪断言，截图 `acceptance/ui-225/`~`acceptance/ui-229/`；docs:reconcile。

G0 开发期常态 · 不外推 packaged/Provider/GA.
