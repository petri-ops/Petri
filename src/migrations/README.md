# Petri Desktop Database Migrations

## 唯一 source of truth

**所有用户数据 schema 定义只存在于本目录的 `.sql` 文件中。**

禁止在任何代码文件（包括 `core/r-server/db.js`）中写用户数据表的 `CREATE TABLE` / `ALTER TABLE` 语句。

## Migration 规则

### 文件命名

```
NNN_description.sql
```

- `NNN`：三位数字，从 001 递增（005, 006, 007, 008...）
- `description`：简短英文描述，用下划线连接（`add_projects_description`）

### SQL 约束

1. **不含 `BEGIN/COMMIT`**：`migration-runner.js` 自动把每个文件包在事务内
2. **不使用 SQLite 非标准语法**：
   - ❌ `INSERT OR REPLACE`（用标准 `INSERT ... ON CONFLICT`）
   - ❌ `AUTOINCREMENT`（用 `INTEGER PRIMARY KEY` 即可）
   - ❌ `PRAGMA`（启动时在 `db.js` 统一设置）
3. **单个 migration 失败自动回滚**，不影响已应用的其他 migration
4. **ALTER TABLE 不支持 `IF NOT EXISTS`**：由 `schema_migrations` 表的 version 控制，不重复执行

### 幂等性

Migration 通过 `schema_migrations` 表记录已应用版本，每个文件只跑一次。

不需要在 SQL 中写 `IF NOT EXISTS`（`CREATE TABLE` 除外，作为防御）。

## Schema 变更流程

### 1. 创建新 migration 文件

```bash
# 找到当前最大版本号
ls src/migrations/ | sort | tail -1
# 007_result_conversation_export_type.sql

# 创建下一个版本
touch src/migrations/008_your_change.sql
```

### 2. 编写 SQL

```sql
-- migration 008: 你的变更描述
--
-- 背景：为什么需要这次变更
--
-- 约束：
-- - 不含 BEGIN/COMMIT
-- - 不使用 INSERT OR REPLACE / AUTOINCREMENT

CREATE TABLE IF NOT EXISTS your_table (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_your_table_name ON your_table(name);
```

### 3. 本地测试

```bash
# 删除测试数据库，重新跑 migration
rm -f .petri-dev-user-data/data/petri.db*

# 启动 Electron，会自动执行 migration
npm run dev

# 检查 schema 是否正确
sqlite3 .petri-dev-user-data/data/petri.db ".schema your_table"
```

### 4. 验证一致性

```bash
# 跑 schema 验证门禁（未来实现）
npm run schema:verify
```

### 5. 提交

```bash
git add src/migrations/008_your_change.sql
git commit -m "feat(migration): add your_table for feature X"
```

提交前必须通过 `npm run check`（包含文档治理门禁，未来会集成 schema 验证）。

## 当前 schema

由 migration 001-008 构建（按应用顺序）：

### 001_result_studio.sql
- `result_versions`：Result Studio 版本历史
- `result_artifacts`：结果 artifact 存储

### 002_result_workflow_graph.sql
- `workflow_steps`：工作流步骤图

### 003_result_ref_transactions.sql
- `result_ref_transactions`：Result 引用事务

### 004_git_repository_consent.sql
- `git_repository_consent`：Git 仓库授权记录

### 005_branch_conversation.sql
- `projects`：项目元数据（id, name, created_at, updated_at）
- `branches`：对话分支
- `messages`：分支消息

### 006_result_studio.sql
- `results`：Result Studio 主表

### 007_result_conversation_export_type.sql
- `conversation_exports`：对话导出记录

### 008_add_projects_description.sql
- 补齐 `projects.description` 列

## 运行时元数据表（不在 migration 中）

以下表由 `core/r-server/db.js` 直接创建，因为它们是**运行时元数据**（非用户数据持久化）：

- `project_g0_baselines`：G0-LF0 基线兼容性记录
- `loop_runs`：AI 循环运行状态（内存态为主）

如果未来需要统一管理，应创建对应 migration 并删除 `db.js` 中的内联定义。

## 历史 schema 漂移修复

**2026-08-20 修复记录**：

- **问题**：migration 005 创建 `projects` 表时缺 `description` 列，但 `core/r-server/db.js` 内联 schema 包含该列，导致两套建库路径产生漂移。
- **根因**：双轨建库（migration + 内联 schema），没有唯一 source of truth。
- **修复**：
  1. 新增 migration 008 补齐 `description` 列
  2. 删除 `db.js` 中 `projects` / `datasets` / `analyses` 的内联 `CREATE TABLE`
  3. 建立本文档约束："唯一 source of truth = migration"

## 未来改进

### Schema 验证门禁（规划中）

创建 `scripts/verify-schema.js`：

1. 在临时库跑完所有 migration
2. 读取实际 schema（表名、列名、类型、约束）
3. 对比 `db.js` 代码中使用的表/列（通过 `db.prepare()` 调用提取）
4. 发现不一致立即报错

集成到 `npm run check`，确保 migration 与代码使用的 schema 一致。

### Migration 回滚（暂不支持）

SQLite 不支持原生 `ALTER TABLE DROP COLUMN`（3.35.0+ 才支持，且有限制）。

如果需要回滚，目前只能：
1. 创建新表（正确 schema）
2. 复制数据
3. 删除旧表
4. 重命名新表

建议：尽量通过新增 migration 修正，而不是回滚。

## 故障排查

### Migration 卡住或失败

```bash
# 1. 查看已应用的 migration
sqlite3 .petri-dev-user-data/data/petri.db \
  "SELECT version, applied_at FROM schema_migrations ORDER BY version;"

# 2. 查看具体表结构
sqlite3 .petri-dev-user-data/data/petri.db ".schema projects"

# 3. 如果需要重置（⚠️ 会丢失所有数据）
rm -f .petri-dev-user-data/data/petri.db*
npm run dev  # 重新跑所有 migration
```

### 两个数据库 schema 不一致

项目中可能存在两个数据库文件：
- `.petri-dev-user-data/data/petri.db`（主库，通过 migration 构建）
- `core/r-server/petri.db`（历史遗留，通过 `db.js` 内联 schema 构建）

**2026-08-20 后应该只使用主库**。如果发现 `core/r-server/petri.db`，可以安全删除：

```bash
rm -f core/r-server/petri.db*
```

启动时 `src/main.js` 会确保主库 schema 最新。

## 参考资料

- [SQLite ALTER TABLE 文档](https://www.sqlite.org/lang_altertable.html)
- [better-sqlite3 文档](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- `src/migration-runner.js`：Migration 执行器实现
