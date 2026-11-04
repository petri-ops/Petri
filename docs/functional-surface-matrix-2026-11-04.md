# 功能面全量核对矩阵（generated）

> 本文件由 `scripts/functional-surface-audit.mjs` 生成，勿手改；复跑即刷新。
> 基线：`HEAD`（工作区在制文件 0 个不计入判定）。生成时间：2026-11-04T11:31:14.013Z

## 0. 覆盖汇总

| 面 | 数量 |
| --- | --- |
| 工具定义 | 115（16 域；文本降级 0 域） |
| 工具契约 | 115 |
| 调度元数据 | 116 |
| IPC 通道 | 180（preload 缺包装 14；前端零消费 177） |
| 路由端点 | 285（47 模块；未挂载 0） |
| 设置存储键 | 7 |
| 判定 P1 / P2 / P3 | **0 / 7 / 4** |

## 1. P1 明细（能力在、用户用不到）

（无）

## 2. P2 明细（契约不一致 / 半接线）

| 类别 | 对象 | 说明 |
| --- | --- | --- |
| schema_undeclared_args | `followup_task` | 实现读未声明键：role |
| schema_undeclared_args | `computer_press` | 实现读未声明键：ref |
| schema_undeclared_args | `model3d_propose` | 实现读未声明键：path |
| schema_undeclared_args | `model3d_apply` | 实现读未声明键：reason |
| schema_undeclared_args | `model3d_export` | 实现读未声明键：scenePath |
| approval_meta_contract_conflict | `result_edit_plan` | metadata 需审批但契约 sideEffect=none |
| approval_meta_contract_conflict | `result_edit_plan_in_context` | metadata 需审批但契约 sideEffect=none |

## 3. P3 明细（卫生；最多列 60 条）

| 类别 | 对象 | 说明 |
| --- | --- | --- |
| ipc_dead_channels | `12 个通道` | 登记有主进程 handler 但 preload 无包装且前端零消费（死通道：删或接线待裁决）：branch:children, branch:get, branch:project:create, branch:project:get, branch:project:list, branch:project:update, message:append, message:clear, message:count, message:delete, message:get, message:list |
| storage_read_never_written | `executionTargetId` | 2 处：readBrandStorage@frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts , readBrandStorage@frontend/src/components/desktop/DesktopSettingsPanel/sections/RemoteTargets.tsx |
| storage_read_never_written | `petri:notify-on-done` | 1 处：getItem@frontend/src/components/copilot/SimpleChat.tsx |
| storage_read_never_written | `petri_token` | 5 处：getItem@frontend/src/components/copilot/copilotClient/apiBase.ts , getItem@frontend/src/components/copilot/copilotClient/apiBase.ts , getItem@frontend/src/components/copilot/copilotConversationsClient.ts , getItem@frontend/src/hooks/useSshHeartbeat.ts , getItem@frontend/src/hooks/useSshHeartbeat.ts |

## 4. 工具全量矩阵

| 工具 | 域 | 契约 | handler | 元数据 | risk | sideEffect | 审批声明 | 三档可达 | 未声明参数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `interrupt_agent` | agent-orchestration | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `send_message` | agent-orchestration | ✓ | ✓ | ✓ | R1 | state-write | yes | yes | - |
| `followup_task` | agent-orchestration | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | role |
| `spawn_agent` | agent-orchestration | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `read_agent_journal` | agent-orchestration | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `list_agents` | agent-orchestration | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `wait_agent` | agent-orchestration | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `create_goal` | agent-orchestration | ✓ | ✓ | ✓ | R1 | state-write | no | yes | - |
| `get_goal` | agent-orchestration | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `update_goal` | agent-orchestration | ✓ | ✓ | ✓ | R1 | state-write | no | yes | - |
| `query` | browser | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `read_page` | browser | ✓ | ✓ | ✓ | R1 | external-request | no | yes | - |
| `search` | browser | ✓ | ✓ | ✓ | R1 | external-request | no | yes | - |
| `act` | browser | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `read_image` | browser | ✓ | ✓ | ✓ | R1 | external-request | no | yes | - |
| `read_video` | browser | ✓ | ✓ | ✓ | R1 | external-request | no | yes | - |
| `browser_connect` | browser | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `browser_act` | browser | ✓ | ✓ | ✓ | R2 | external-request | yes | yes | - |
| `browser_status` | browser | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `browser_disconnect` | browser | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `godot_run` | godot | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `godot_scene_apply` | godot | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `computer_snapshot` | computer | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `computer_click` | computer | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `computer_type` | computer | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `computer_press` | computer | ✓ | ✓ | ✓ | R2 | execution | yes | yes | ref |
| `computer_scroll` | computer | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `computer_screenshot` | computer | ✓ | ✓ | ✓ | R1 | workspace-write | no | yes | - |
| `computer_wait` | computer | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `computer_close` | computer | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `computer_authorize` | computer | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `knowledge_search` | knowledge | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `knowledge_status` | knowledge | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `knowledge_read` | knowledge | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `knowledge_space_list` | knowledge | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `knowledge_space_impact` | knowledge | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `knowledge_space_create` | knowledge | ✓ | ✓ | ✓ | R1 | state-write | yes | yes | - |
| `knowledge_space_rename` | knowledge | ✓ | ✓ | ✓ | R1 | state-write | yes | yes | - |
| `knowledge_space_enable` | knowledge | ✓ | ✓ | ✓ | R1 | state-write | yes | yes | - |
| `knowledge_space_bind` | knowledge | ✓ | ✓ | ✓ | R1 | state-write | yes | yes | - |
| `knowledge_space_delete` | knowledge | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `knowledge_space_clear` | knowledge | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `knowledge_doc_list` | knowledge | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `knowledge_doc_move` | knowledge | ✓ | ✓ | ✓ | R1 | state-write | yes | yes | - |
| `knowledge_doc_delete` | knowledge | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `knowledge_doc_reindex` | knowledge | ✓ | ✓ | ✓ | R1 | state-write | yes | yes | - |
| `model3d_inspect` | model3d | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `model3d_validate` | model3d | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `model3d_propose` | model3d | ✓ | ✓ | ✓ | R1 | none | no | yes | path |
| `model3d_apply` | model3d | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | reason |
| `model3d_render` | model3d | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `model3d_visual_qa` | model3d | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `model3d_export` | model3d | ✓ | ✓ | ✓ | R2 | execution | yes | yes | scenePath |
| `model3d_share` | model3d | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `model3d_asset` | model3d | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `model3d_bom` | model3d | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `model3d_recipe` | model3d | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `model3d_blend_ops` | model3d | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `delegate_to_petri_node` | remote | ✓ | ✓ | ✓ | R2 | external-request | yes | yes | - |
| `federation_list_peers` | remote | ✓ | ✓ | ✓ | R1 | external-request | no | yes | - |
| `resident_task_create` | resident | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `resident_task_list` | resident | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `resident_task_read` | resident | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `generate_methods` | result-studio | ✓ | ✓ | ✓ | R1 | external-request | yes | yes | - |
| `result_edit_plan` | result-studio | ✓ | ✓ | ✓ | R0 | none | yes | yes | - |
| `result_changeset_create` | result-studio | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `result_changeset_status` | result-studio | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `result_changeset_compare` | result-studio | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `result_changeset_adopt` | result-studio | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `result_changeset_revert` | result-studio | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `artifact_revision_list` | result-studio | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `artifact_revision_restore` | result-studio | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `result_selection_run` | result-studio | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `result_studio_context` | result-studio | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `result_edit_plan_in_context` | result-studio | ✓ | ✓ | ✓ | R0 | none | yes | yes | - |
| `result_changeset_create_in_context` | result-studio | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `result_enrichment_from_context` | result-studio | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `result_changeset_status_in_context` | result-studio | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `result_changeset_compare_in_context` | result-studio | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `result_changeset_adopt_in_context` | result-studio | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `result_changeset_revert_in_context` | result-studio | ✓ | ✓ | ✓ | R2 | state-write | yes | yes | - |
| `process_status` | session | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `process_stop` | session | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `system_info` | session | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `plan` | session | ✓ | ✓ | ✓ | R1 | state-write | no | yes | - |
| `todo_write` | session | ✓ | ✓ | ✓ | R1 | state-write | no | yes | - |
| `verify_state` | session | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `decision_summary` | session | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `decision_recent` | session | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `run_tool` | session | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `result_summary` | session | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `codegraph_who_imports` | session | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `codegraph_classify_edges` | session | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `ask_user_question` | session | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `result_annotations_list` | session | ✓ | ✓ | ✓ | R1 | none | no | yes | - |
| `skill_discover` | skill | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `skill_get` | skill | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `skill_preflight` | skill | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `svg_inspect` | svg | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `svg_edit` | svg | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `web_search` | web | ✓ | ✓ | ✓ | R1 | external-request | no | yes | - |
| `web_fetch` | web | ✓ | ✓ | ✓ | R1 | external-request | no | yes | - |
| `run_workflow` | workflow | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `workspace_list` | workspace | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `workspace_find` | workspace | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `workspace_search` | workspace | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `workspace_read` | workspace | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `workspace_write` | workspace | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `workspace_replace` | workspace | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `workspace_exec` | workspace | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `workspace_exec_background` | workspace | ✓ | ✓ | ✓ | R2 | execution | yes | yes | - |
| `workspace_worktree_create` | worktree | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `workspace_worktree_list` | worktree | ✓ | ✓ | ✓ | R0 | none | no | yes | - |
| `workspace_worktree_remove` | worktree | ✓ | ✓ | ✓ | R2 | workspace-write | yes | yes | - |
| `workspace_worktree_merge_request` | worktree | ✓ | ✓ | ✓ | R1 | state-write | no | yes | - |

## 5. 设置键悬空与前缀不一致

- `executionTargetId` — read_never_written（2 处）
- `petri:notify-on-done` — read_never_written（1 处）
- `petri_token` — read_never_written（5 处）

## 6. 在制文件（本轮不计入判定）

（无）
