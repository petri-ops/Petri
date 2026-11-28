# .codebuddy seat 工具受限诊断（item 90 追加 · 2026-11-28）

## 现象

seat 三会话（Orca worktree 内新起的 codebuddy）只剩 Read/Grep/SendMessage，无 Bash/Write/Edit/Glob；历史会话（11-27 上午前）有全工具。

## 根因

`~/.codebuddy/settings.json` 的 `trustedDirectories` 只含两条：

1. `/private/tmp/zcode-bling`
2. `/Users/zhangdiandian/Documents/1.WorkDir/Petri`（owner 原库）

seat 的会话 cwd 是 Orca worktree（`/Users/zhangdiandian/orca/workspaces/Petri/crinoid` 等）——**不在 trust 列表**。codebuddy 的 workspace trust 语义：cwd 未 trust 的新会话进受限模式（只读工具），等用户在 UI 点信任。11-27 上午前 seat 在 owner 原库（trusted）跑，所以有全工具；转入新 worktree 后未 trust → 受限。

佐证：

- `~/.codebuddy/ide-acp/2568.json` 活跃连接 cwd = owner 原库（非 worktree）
- `~/.codebuddy/projects/` 下 14 个 worktree 会话目录存在（历史会话确实跑过 worktree），但 trust 状态不在 projects 里，而在 settings.json 的 trustedDirectories
- `sandbox.orderedRules`（106 条 preset 规则）均为 ~home 路径 allow，无 worktree 相关条目——preset 不背锅
- `.codebuddy/skills/`（仓库内）11-27 11:23 修改时间 = seat 在 worktree 里装过 skills（worktree 是 git 分发），但 skills 与工具权限无关

## 修复（已落）

`trustedDirectories` 追加两条：`/Users/zhangdiandian/orca/workspaces/Petri/crinoid` 与 `/Users/zhangdiandian/orca/workspaces/Petri`（批内新建 worktree 也覆盖）。备份：`~/.codebuddy/settings.json.bak-item91`。JSON 合法性已复验。

## 验证方法（owner 操作）

重启 seat 面板（或 codebuddy 应用）后新会话应可见 Bash/Write/Edit/Glob；若仍受限，在 codebuddy UI 对该 workspace 点一次「Trust」并检查 settings.json 的 trustedDirectories 是否被运行实例回写——若被回写覆盖，改为在 UI 内信任一次让其自行落盘。

## 边界

- 运行中的 codebuddy 实例可能持有 settings.json 内存态，改文件后必须重启实例才生效（所以「owner 重启 seat 面板」是必要步骤，不是可选项）。
- `core/petri-server/petri.db`（仓库内旧库）与 owner 原库（Documents）均不受本诊断影响。
