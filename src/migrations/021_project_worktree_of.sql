-- migration 021: projects 增加 worktree_of（BLOCK-336 P2 项目层声明式副本）
--
-- 背景：
-- - BLOCK-336 P1 落地 agent 工具面 worktree 四件；P2 让「项目」本身可以是某个
--   本地 git 项目的副本（worktreeOf），workspace_path 指向 <dataDir>/worktrees/<projectId>。
-- - 登记源仍是 <dataDir>/worktrees/registry.json（helpers/worktree-contract.js），
--   本列只存「这个项目是哪个项目的副本」这一声明事实，不重复存路径/分支。
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已包裹事务
-- - 只加列不改造既有行：存量项目 worktree_of 为 NULL，行为零变化

ALTER TABLE projects ADD COLUMN worktree_of TEXT;
