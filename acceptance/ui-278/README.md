# UI-278 · BLOCK-41 git 写操作三期 — dev Electron 实机验收记录

- 日期：2026-09-02
- 环境：dev Electron（CDP :9222），后端进程 22:25 启动晚于全部改动文件 mtime（新代码已加载）
- 测试仓库：临时专用仓库（`/tmp/petri-block41-repo` + bare remote，验收后已清理），通过 `POST /data/projects` 创建项目 `block41-test`（`p_mtk79a8i_ybr7`，验收后已删除），不触碰用户真实仓库

## 场景与证据

| # | 场景 | 结果 | 证据 |
|---|------|------|------|
| 1 | 改动 tab 两栏分组：unstaged 栏「更改 1」显示 c.txt；staged 空时分区隐藏 | PASS | CDP 断言 `rvw-section-unstaged` |
| 2 | 行内「暂存」→ staged 栏「暂存的更改 1」+ staged diff（HEAD→index，+1 new file）+ 提交框按需出现 | PASS | `staged-section-commit-box.png` |
| 3 | 行内「取消暂存」→ 文件回到 unstaged 栏 | PASS | CDP 断言分区往返 |
| 4 | staged 栏提交框：填提交信息 →「提交暂存」→ 真实 commit `637fc59`，树清空，ahead 徽标 ↑1→↑2 | PASS | CDP + `git log` / `rev-list` 双核对 |
| 5 | 分支切换脏树拒绝：已跟踪文件脏 → 红色横幅列冲突文件 `a.txt`，选择器停留 main，仓库实际分支未变 | PASS | `checkout-dirty-reject-banner.png` |
| 6 | 分支切换干净通过：恢复 a.txt 后切换 feature-b 成功，UI 与 `git branch --show-current` 一致；切回 main 同样成功 | PASS | CDP + git 双核对 |
| 7 | push：↑2 徽标 → 点击「推送（origin/main）」→ 徽标变「已同步」，ahead/behind 0/0，bare remote 收到 `637fc59` | PASS | CDP + remote 仓库 log |
| 8 | pull：制造远程侧新提交（behind=1）→ 点击「拉取（origin/main）」→ fast-forward 到 `89775a5`，behind 归零，「已同步」 | PASS | CDP + `git log` 核对 |

## 备注

- 分支切换走 `window.confirm` 确认；CDP 驱动时临时覆盖 `window.confirm = () => true`（仅验收脚本内，不改产品代码）
- 无 upstream 时徽标不显示、首推自动 `-u` 的行为由单元测试 `ReviewMode.block41.test.tsx` 覆盖
- G0 开发期常态 · 不外推 packaged / Provider / GA
