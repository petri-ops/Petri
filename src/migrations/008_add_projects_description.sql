-- migration 008: 补齐 projects.description 列
--
-- 背景：
-- - migration 005 创建 projects 表时未包含 description 列
-- - core/r-server/db.js 通过 ALTER TABLE 在运行时添加该列
-- - 导致两套建库路径产生 schema 漂移
--
-- 本 migration 补齐该列，统一 schema 定义到 src/migrations/（唯一 source of truth）
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已包裹事务
-- - 使用 ALTER TABLE ADD COLUMN（SQLite 3.2.0+ 支持）
-- - 幂等性：通过条件检查实现（SQLite 3.35.0+ 的 IF NOT EXISTS 不可用）

-- SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS，
-- 但 migration version 控制确保只执行一次。
-- 如果因某些原因（如手工 ALTER）列已存在，事务会回滚但不影响其他 migration。

ALTER TABLE projects ADD COLUMN description TEXT DEFAULT '';
