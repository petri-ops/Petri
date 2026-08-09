-- G0-RS-P5 — authoritative Result Studio workflow graph (migration 002)
--
-- This file is generated from core/shared-backend/result-workflow-graph.js.
-- It only adds persistent graph snapshots; Job, Artifact and Revision Truth
-- remain in their existing canonical tables.

CREATE TABLE IF NOT EXISTS result_workflow_graphs (
  graph_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  root_tool_job_id TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  nodes_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_workflow_graphs_project_digest ON result_workflow_graphs(project_id, source_digest);

CREATE INDEX IF NOT EXISTS idx_rs_workflow_graphs_project_root ON result_workflow_graphs(project_id, root_tool_job_id);
