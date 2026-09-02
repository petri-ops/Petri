# BLOCK-40 — 会话改动水合（Conversation Changes Hydration）计划

> status: completed · truthDomain: `block-40-conv-changes-hydration` · registered: 2026-09-02

## 1. 背景

BLOCK-31 P2 建立的会话改动归属索引 `conversationChangesStore` 是**纯内存态**（live 工具结果 + `agent-task-done` 权威对账）。页面 reload 后 Map 清空，`AgentChangesCard` 因 `hasConversationScope=false` **回退「工作区改动」全量视图**，历史会话丢失精确归属（BLOCK-31 收口时登记的观察项，已获用户裁决启动收尾）。

权威清单已持久化：`agent-runner` 终态时把 task_events 回放聚合产物写入 `tasks.files_changed_json`（含 UI-273 的 `iteration`/`tool` 归属）；任务 `params.conversationId`（JSON）可精确查询。只缺一个只读端点 + 前端挂载水合。

## 2. 目标

reload（或冷启动）后打开历史会话，「本会话改动」立即恢复精确归属，与 BLOCK-31/273 的实时链路一致；无后端可查时诚实回退全量（现状行为）。

## 3. 非范围

- task_events 全文回放 / hunk 级归属 / exec 盲区精确归属（维持 unattributed 兜底语义）
- 批量水合多会话 / 跨页预取
- 审阅面板（git 全量事实源）任何改动
- 后端写路径改动（files_changed_json 语义不变）；0 新依赖；G1+ 不外推

## 4. 阶段

- **P1 后端只读端点**：`agent-task-store` 新增按会话查询（`json_extract(params,'$.conversationId')`，仅 terminal 任务，按 finished_at 倒序）+ 新路由 `GET /api/ai/agent/conversation-changes?conversationId=`：跨任务按 path 合并（新任务覆盖旧任务同路径），返回 `[{path,status,iteration,tool,lastChangedAt}]`（lastChangedAt 用 task finishedAt/createdAt 兜底）。conversationId 缺失 → 400；路径安全（只读、无文件系统访问）。
- **P2 前端水合**：`conversationChangesStore` 新增 `hydrateConversationFileChanges(conversationId, items)`——只填充 live 记录缺失的路径（live/已有记录优先，不覆盖），merged 状态去重；`AgentChangesCard` 挂载/切会话时 snapshot 为空则拉取（in-flight 去重、失败静默维持全量回退、成功后切「本会话改动」）。
- **P3 测试与门禁**：后端 node --test（多任务聚合/新覆盖旧/空 conversationId 400/无任务空清单/非 agent_loop 排除）+ 前端 vitest（水合合并不覆盖 live、AgentChangesCard 水合后切会话视图、失败回退）+ tsc + `docs:check` + `ui:audit:check`。
- **P4 实机收口**：dev Electron——会话 A agent 写文件 → **reload 页面** → 打开会话 A → 卡片直接显示「本会话改动」精确归属（不再全量），对照会话 B 隔离不串；证据 `acceptance/ui-277/`（UI-277）。

## 5. 验收门

- reload 后历史会话「本会话改动」恢复且归属字段（iteration/tool）与实时链路一致
- 会话间隔离不回退（BLOCK-31 S2 判据在 reload 后仍成立）
- 无权限/失败路径回退现状全量视图，不新增报错面
- 门禁：node --test 定向 + vitest 定向 + tsc 0 + docs:check + ui:audit:check

## 6. 进度记录

- 2026-09-02 P0 立项（用户裁决，承接 BLOCK-31 收口时登记的 roadmap 候选）：摸底确认 store 纯内存 + files_changed_json 权威清单含 iteration/tool + params.conversationId 可 JSON1 查询，材料齐备。
- 2026-09-02 P1 完成：`agent-task-store` 新增 `listByConversation` 语句 + `listConversationChanges`（跨任务按 path 合并、后写覆盖先写、terminal 任务限定）；新路由 `conversation-changes.js`（`GET /api/ai/agent/conversation-changes?conversationId=`，白名单校验、诚实空清单）并在 `routes/ai-agent/index.js` 注册。node --test `test/block40-conversation-changes.test.mjs` 7/7（多任务聚合/新覆盖旧/running 排除/400 校验/跨会话隔离/空清单）。
- 2026-09-02 P2 完成：`conversationChangesStore` 新增 `mergeConversationFileChanges`（只填充缺失路径，live/已有记录优先不覆盖）+ `hydrateConversationFileChanges`（in-flight + once 去重、失败静默维持全量回退）；`AgentChangesCard` 挂载/切会话时水合，成功后自动切「本会话改动」。vitest：`conversationChangesStore.hydrate.test.ts` 8/8 + `AgentChangesCard.test.tsx` 9/9（水合后自动切会话视图，deferred fetch 消竞态）。
- 2026-09-02 P3 完成：门禁全过——后端 node --test 7/7 + 回归 `agent-files-changed` 7/7、前端 vitest 17/17、tsc 0、docs:check 180 PASS、ui:audit:check PASS（UI-277 已登记 in_progress）。
- 2026-09-02 P4 实机收口完成（UI-277 verified）：实机暴露并修复两处 P1 遗留缺陷——① `listConversationChanges` 曾被 export 但未定义（require 即 ReferenceError，node --check 前已补齐）；② `routes/ai-agent/index.js` require 了 conversation-changes 但 `register()` 内漏调用（端点 404，已补挂载 + `_submodules`）。dev Electron（真实后端 :63008）四步过验：S1 会话 A agent 写 p40-a.txt → 卡片「本会话改动 · 第 1 轮 · p40-a.txt」，端点返回 `[{path:p40-a.txt,status:created,iteration:1,tool:workspace_write}]`；S2 reload 后会话 A 卡片直接恢复「本会话改动」（不再全量回退）；S3 会话 B 写 p40-b.txt → reload → B 默认恢复仅 p40-b.txt；S4 切回 A 仅 p40-a.txt（跨会话隔离不串）。证据 `acceptance/ui-277/`（4 截图 + evidence.json）。验收备注：:3001 是 wrapper 侧后端（BIOF3_DB_PATH=.biof3-dev-user-data/bioF3.db，空库），应用实际消费 Electron supervisor 托管后端（随机端口，BIOF3_DB_PATH=.biof3-dev-user-data/data/biof3.db）——端点冒烟必须打页面 `window.biof3Desktop.backendConfig.rApiBase` 注入的真实基址。门禁复跑：docs:check / ui:audit:check PASS。工作区遗留验收产物 p40-a.txt/p40-b.txt（tinkspace 项目工作区，git 为事实源，删除后卡片自动消失）。
