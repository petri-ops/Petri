-- Run ONCE as PostgreSQL initial / master user (NOT biof3_app), connected to database biof3:
--   psql -h ... -U <master> -d biof3 -f 000_grant_app.sql
-- Aliyun managed RDS note is historical; current production uses ECS Docker PostgreSQL.

GRANT CONNECT ON DATABASE biof3 TO biof3_app;
GRANT USAGE, CREATE ON SCHEMA public TO biof3_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO biof3_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO biof3_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO biof3_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO biof3_app;
