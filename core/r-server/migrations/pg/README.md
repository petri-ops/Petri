# PostgreSQL migrations (阶段 B)

Apply **in order** on an empty database:

```bash
export DATABASE_URL='postgres://user:pass@host:5432/biof3'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/pg/001_core.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/pg/002_analytics.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/pg/003_copilot_ai.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/pg/004_feedback.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/pg/005_tasks.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/pg/006_tool_jobs.sql
```

Or from repo root:

```bash
./scripts/apply-pg-migrations.sh "$DATABASE_URL"
```

Or use the one-click ECS deployment (recommended):

```bash
# 1. 登录 ECS，一键部署 PG + 建表
bash deploy/ecs-nginx/deploy-ecs-pg.sh

# 2. 上传 SQLite 数据文件并迁移
SQLITE_PATH=/tmp/biof3.db \
PG_URL="postgres://postgres:密码@localhost:5432/biof3" \
  bash deploy/ecs-nginx/biof3-db-migrate.sh
```

| File | Tables |
|------|--------|
| `001_core.sql` | projects, datasets, analyses, users, site_settings, subsets, cell_labels |
| `002_analytics.sql` | user_heartbeats, page_views, daily_stats |
| `003_copilot_ai.sql` | copilot_*, user_facts, memory_vectors, ai_usage, agent_audit, … |
| `004_feedback.sql` | feedbacks |
| `005_tasks.sql` | tasks (async R/Python queue) |
| `006_tool_jobs.sql` | tool_jobs (deseq2, seurat, ml-classifier, … tool submissions) |
| `007_fix_sequences.sql` | (数据迁移后运行) 修复 BIGSERIAL 序列 |
| `008_gov_and_dataset_parent.sql` | copilot_global_settings + datasets.parent_dataset_id 列 |
| `009_plan_links.sql` | copilot_plans.conversation_id + copilot_plan_steps.analysis_id 列 |

## Data import (maintenance window)

### 推荐方式：PG 原生 COPY via SQLite foreign table

ECS PG 容器内置 `sqlite3`，可直接创建 SQLite foreign table 无缝迁移：

```bash
# 1. 上传 SQLite 文件到 ECS
scp biof3.db <user>@<ecs-ip>:/tmp/

# 2. 在 PG 容器内执行（推荐，无需安装任何工具）
docker exec -i biof3-pg psql -U postgres -d biof3 << 'EOF'
-- 附加 SQLite 文件为只读 foreign table
CREATE EXTENSION if not exists sqlite_fdw;
CREATE SERVER if not exists sqlite_biof3 FOREIGN DATA WRAPPER sqlite_fdw
  OPTIONS (database '/tmp/biof3.db');

IMPORT FOREIGN SCHEMA sqlite_biof3 LIMIT TO (
  users, projects, datasets, analyses, subsets, cell_labels,
  copilot_conversations, copilot_messages, copilot_plans, copilot_plan_steps,
  user_facts, chat_summaries, memory_vectors, chat_audit, ai_usage,
  agent_audit, copilot_settings, user_progress, review_queue,
  feedbacks, tasks, tool_jobs, user_heartbeats, page_views, daily_stats,
  site_settings, copilot_global_settings
) FROM SERVER sqlite_biof3 INTO public;

-- 然后运行迁移脚本
\i /repo/deploy/ecs-nginx/biof3-db-migrate.sh
EOF
```

### 备选：pgloader（需要安装）

```bash
pgloader biof3.db "postgres://user:pass@host:5432/biof3"
```

### 验证

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
psql "$DATABASE_URL" -c "SELECT key FROM site_settings WHERE key='guest_permissions';"
# 运行 007_fix_sequences.sql 修复序列
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/pg/007_fix_sequences.sql
```

## 迁移完成后的环境变量

```bash
# .env 或 systemd service
DATABASE_URL="postgres://postgres:你的密码@localhost:5432/biof3?sslmode=disable"
BIOF3_P2_PG=1          # 迁移 P2 表后开启
# BIOF3_PG_AUX_SQLITE_PATH="/path/to/biof3.db"  # 迁移过渡期可选
R_SERVER_PORT=3003
```

回滚（如果有问题）：

```bash
# 删掉 DATABASE_URL，重启 r-server，继续用 SQLite
unset DATABASE_URL && pm2 restart biof3
```