# BLOCK-41 — git 写操作三期（分支切换 / 暂存区两栏 / push-pull）计划

> status: completed · truthDomain: `block-41-git-write-ops-phase3` · registered: 2026-09-02

## 1. 背景

git 一期～二期（BLOCK-29 / 29.2～29.7）已交付全部只读视野（提交历史/详情/文件全文/blame/stash/标签/分支只读切换视图）与部分写操作（AI 审阅 accept 流的 stage+commit、单文件放弃、撤销上次提交）。「分支切换 / 暂存区两栏 / push-pull」自 BLOCK-29 起维持排除，登记为 roadmap 候选待用户裁决。2026-09-02 用户显式裁决启动本工作包（BLOCK-40 收口提交 `c7036dc0` 后）。

现状盘点结论（P0 摸底）：

- `core/shared-backend/git-adapter.js` 已有 `stage({paths})` / `commit({message,paths})`（`--only` 路径受限提交）/ `createBranch` / `discardFile` / `undoLastCommit` / `applyPatch`；**缺** `unstage`、真实分支 checkout、`push` / `pull` / remote 状态。
- `src/ipc/working-tree-review.js` 的 `git:commit-review`（L500-565）是现有写 handler 范本（resolveGitAdapter(projectId) + safeInvoke + `{ok:false,error,message}` 错误面）。
- 前端改动 tab 当前单栏（`git status --porcelain` 两列 XY 状态已拿到未分组展示）；分支选择器（UI-247 并入 summary 行）只切历史查询 ref，**不真 checkout**；无 push/pull 入口。
- 认证：桌面端直接 fork 系统 `git`，push/pull 依赖系统 credential helper；`run()` 已有 timeout + `redactGitDiagnostic` 诊断脱敏。

## 2. 用户裁决（2026-09-02）

- 范围：git 写操作三期三项全做（分支切换 / 暂存区两栏 / push-pull）。
- 暂存区两栏**含手动提交框**（staged 栏输入信息 → 提交，复用/扩展 adapter.commit 链路，形成完整闭环）。
- 分支切换遇未提交改动：**阻止并提示**（拒绝 checkout 并列出冲突文件；stash 写操作维持排除）。

## 3. 目标

审阅面板（右侧 dock，项目工作区仓库）具备 VS Code SCM 级基本写闭环：改动文件可暂存/取消暂存（两栏分组 + staged diff 查看）→ staged 栏提交；分支选择器可真实切换（脏树保护）；summary 行可 push/pull 并显示 ahead/behind。

## 4. 非范围

- stash 写操作（pop/apply/drop）/ commit amend / rebase-merge 冲突解决 UI / 交互式变基
- 远程仓库管理 UI（仅 `git remote -v` 只读列举；添加/删除远程不做）
- credential 管理与 UI（依赖系统 credential helper；`GIT_TERMINAL_PROMPT=0` 防挂起，认证失败诚实报错）
- merge 冲突标记文件的编辑器级解决流程（冲突时诚实报错 + `repositoryState().midOperation` 可见）
- AI 审阅 0 重新引入；0 新依赖；G0 开发期常态 · 不外推 packaged/Provider/GA

## 5. 阶段

- **P1 adapter 写方法**（`core/shared-backend/git-adapter.js`）：
  - `unstage({paths})`：`git reset -q HEAD -- <显式 pathspec>`（整树写法被 assertSafePathspecs 拒绝；unborn HEAD 回退 `git rm --cached`）。
  - `commitIndex({message})`：提交整个暂存区（`git commit -q --no-verify -m`，无 pathspec），供手动提交框使用（与 `commit({paths})` 的 `--only` 语义区分）。
  - `checkoutBranch({name})`：`repositoryState().midOperation` 拒绝；tracked 脏时拒绝（`checkout_dirty_worktree`，冲突清单 = 本地已改路径 ∩ `git diff --name-only HEAD..target`，无交集时列全部脏文件）；干净则 `git checkout -q <name>`（name 经 assertSafeRef 校验，限 listBranches 本地分支）。
  - `remoteList()`：`git remote -v` 只读解析。
  - `remoteStatus()`：`git fetch --quiet`（allowFailure + 短超时，离线诚实降级）→ `rev-parse --abbrev-ref HEAD@{upstream}` → `rev-list --left-right --count upstream...HEAD` 得 `{remote, branch, upstream, ahead, behind}`。
  - `push({remote, branch, setUpstream})`：`git push`（`-u` 可选；env `GIT_TERMINAL_PROMPT=0`、timeout 120s；stderr 脱敏透出）。
  - `pull({remote, branch})`：`git pull <remote> <branch>`（同 env/timeout；冲突/认证失败诚实报错）。
- **P2 IPC + preload**（`src/ipc/working-tree-review.js` + `src/preload.js` + `src/electron.d.ts`）：新增 `git:stage-paths` / `git:unstage-paths` / `git:commit-index` / `git:checkout-branch` / `git:remote-status` / `git:push` / `git:pull` 七条通道，全部走 `resolveGitAdapter(args.projectId)`（BLOCK-32 项目级隔离）+ safeInvoke 错误面；preload `workingTreeReview` 子树 additive 暴露。
- **P3 前端**（`frontend/src/components/desktop/WorkingTreeReview/`）：改动 tab staged/unstaged 两栏分组（porcelain XY 已含 staged 信息）+ 行内 stage/unstage 按钮 + staged 文件 diff 走 `diff({staged:true})` + staged 栏提交框（单行 input + ⌘Enter，空信息禁用，复用 BLOCK-28-9 按需出现语言）+ 分支选择器升级真切换（confirm + 脏树拒绝提示冲突文件）+ summary 行 push/pull 按钮 + ahead/behind 徽标；`useWorkingTreeReview` 扩展对应方法；样式沿用 `--biof3-*` token。
- **P4 测试与实机收口**：adapter 真实仓库快测（unstage/commitIndex/checkout 脏树拒绝/checkout 干净切换/push-pull 诚实失败）+ 前端 vitest 定向 + tsc + docs:check + ui:audit:check；dev Electron 实机走查（暂存/取消暂存/提交/分支切换/脏树拒绝/push-pull 徽标），证据 `acceptance/ui-278/`（UI-278）。

## 6. 验收门

- 暂存/取消暂存即时反映两栏分组；staged diff 与 `git diff --cached` 一致；提交后历史与改动刷新
- 干净树分支切换成功且 status/diff/history 全刷新；脏树拒绝并列出冲突文件
- push/pull 真实仓库语义正确（无远程/无 upstream/认证失败诚实报错不挂起）；ahead/behind 徽标与 `git status -sb` 一致
- 写操作全部经项目工作区仓库解析（projectId）；非 git 项目诚实空态不回归
- 门禁：adapter 真仓库快测 + 定向 vitest + tsc 0 + docs:check + ui:audit:check

## 7. 进度记录

- 2026-09-02 P0 立项（用户裁决）：BLOCK-40 收口提交 `c7036dc0` 后启动；摸底确认 adapter 缺 unstage/checkout/push/pull、IPC 有 `git:commit-review` 写范本、前端分支选择器仅只读 ref；两项范围决策已裁决（含提交框 / 脏树阻止并提示）。
- 2026-09-02 P1 完成：git-adapter 新增 `runAsync`（execFile 异步执行器，push/pull 网络操作不阻塞主进程事件循环）+ 7 方法——`unstage`（reset -q HEAD --，unborn 回退 rm --cached）/ `commitIndex`（无 pathspec 提交整个暂存区，与 commit({paths}) 的 --only 语义区分）/ `checkoutBranch`（midOperation 拒绝、仅本地分支、幂等、脏树拒绝 `checkout_dirty_worktree` 带冲突清单=本地已改∩HEAD..target 差异）/ `remoteList` / `remoteStatus`（async：fetch allowFailure 离线降级 → @{upstream} → rev-list left-right ahead/behind）/ `push`（async，--set-upstream 可选，branch.<name>.remote→origin 兜底）/ `pull`（async，merge 语义）。真实仓库快测 18/18 PASS（含脏树拒绝+冲突清单、push 后 ahead/behind 归零）。
- 2026-09-02 P2 完成：working-tree-review.js 新增 7 条 IPC（git:stage-paths / unstage-paths / commit-index / checkout-branch / remote-list / remote-status / push / pull，全部 resolveGitAdapter(args.projectId) + assertSender + safeInvoke）；preload `workingTreeReview` 子树 additive 暴露 8 方法（stagePaths/unstagePaths/commitIndex/checkoutBranch/remoteList/remoteStatus/push/pull）；electron.d.ts 类型同步。三文件 node --check 通过。
- 2026-09-02 P3 完成：useWorkingTreeReview 新增 stagedDiff（refresh 时 staged 文件存在则一并取回 `diff({staged:true})`，HEAD→index）+ stagePaths/unstagePaths/commitIndex/checkoutBranch（成功后 setSelectedFilePath(null) + 全视野刷新）/loadRemoteStatus/pushRemote（无 upstream 首推自动 -u）/pullRemote；decideHunk/rejectHunkByInverseHunk hunk 查找 staged 优先。ReviewMode.tsx：改动 tab staged/unstaged 两栏分组（dock 手风琴 + 主区左树同构，分区标题「暂存的更改/更改」+ 计数）+ 行内 stage/unstage 按钮（plus/minus）+ staged 文件行/主区 diff/悬浮预览走 staged diff + staged 栏提交框（单行 + ⌘Enter，空信息禁用，按需出现）+ 改动分区分支选择器真切换（confirm → 脏树失败横幅列冲突文件）+ summary 行 push/pull 按钮 + ↑ahead/↓behind 徽标；ReviewMode.css 全 --biof3-* token。electron.d.ts status files 补 staged/indexStatus/worktreeStatus。门禁：WorkingTreeReview vitest 38/38（新增 ReviewMode.block41.test.tsx 9/9）/ tsc 0 / git-adapter.test.mjs 39/39 / artifact-truth 等 28/28 / docs:check 181 / ui:audit:check PASS（UI-278 已登记 in_progress）。
- 2026-09-02 P4 完成（UI-278 verified）：dev Electron 实机走查（CDP :9222，后端 22:25 启动晚于全部改动文件 mtime）。使用临时专用仓库 + bare remote（`POST /data/projects` 建项目 block41-test 指向之，验收后项目与仓库均已清理，不触碰用户真实仓库）验证 8 场景全 PASS：① 两栏分组（unstaged 显示 / staged 空时分区隐藏）② 行内暂存 → staged 栏 + staged diff（HEAD→index）+ 提交框按需出现 ③ 行内取消暂存回 unstaged ④ 提交框真实 commit（637fc59，ahead ↑1→↑2，git 双核对）⑤ 脏树切换拒绝（红色横幅列冲突文件 a.txt，选择器停留原分支，仓库实际未切换）⑥ 干净树切换 feature-b/main 往返（UI 与 `git branch --show-current` 一致）⑦ push → 徽标「已同步」、ahead/behind 0/0、bare remote 收到提交 ⑧ 制造 behind=1 后 pull → fast-forward、behind 归零。截图与记录 `acceptance/ui-278/`。计划 completed。G0 开发期常态 · 不外推 packaged / Provider / GA。
