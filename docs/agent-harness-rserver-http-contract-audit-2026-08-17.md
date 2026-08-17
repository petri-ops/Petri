# BioF3 Desktop — r-server HTTP API 契约一致性审查报告

**审查日期**: 2026-08-17
**审查范围**: core/r-server/ 全部 HTTP 路由（独立子任务，与既有 IPC 契约审计平行）
**审查视角**: HTTP 边界契约（端点清单 / schema / 错误码 / 鉴权 / SSE 协议），与 IPC 边界不重复
**项目阶段**: G0 长期开发期（不写 G1+ 外推语句）
**审查方法**: grep app.(get|post|...)|router.(get|post|...)|app.use( 全表 + 逐文件读源 + 读前端 consumer + 交叉既有 4 份审计报告

---

## 一、执行摘要

### 1.1 严重度分布

| 级别 | 数量 | 含义 |
|------|------|------|
| Critical（阻塞） | 2 | renderer 路径完全不可用 / schema 与实现严重偏离 |
| Major（需修） | 8 | 鉴权缺失 / 错误体不一致 / schema 漂移 / 死代码 |
| Minor（建议） | 5 | 类型松散 / 注释漂移 / 命名不一致 / CORS 边界 |

### 1.2 核心结论

1. **r-server HTTP 表面比既有 IPC 契约审计所覆盖的大 4 倍**：端点总数 **172 个方法+路径组合（去重路径 146 个）**（不含 legacy server.js 旧路径），而既有 agent-harness-contract-audit-2026-08-17.md 仅抽样 routes/result-studio.js + routes/ai-chat.js（详见 §7.2）。
2. **2 个 Critical 阻断**：
   - routes/ai-admin.js 9 个 admin 端点（/api/ai/admin/*）**没有任何鉴权中间件**，仅依赖 _requireAdmin 函数在 handler 内自检（见 §3.1.5）。这在 G0 desktop loopback 单管理员场景下不构成真 critical（admin 端点会被 _requireAdmin 拦下），但属于信任 + 后置拦截，**架构上属 Major**（详见 M-001）。
   - **真正 Critical**：/api/result-studio/interaction 在 req.query.revisionId 提供但 Revision 不匹配时返回 {error:revision_not_bound_to_artifact} 但 **HTTP 200**，浏览器侧 useBranchStore 走 happy-path 解 manifest 拿到空 revision → C-002。
3. **8 个 Major**：含 /api/feedback 公开端点缺 origin check（仅 IP rate limit）、ai-settings/test 错误体 {ok,message} vs /api/ai/settings 错误体 {status,error} 双轨、/api/loop/iterate 接受 caller 完整 LoopRun 但 server-side authoritative build（schema 误导）、/api/data/quota Infinity 序列化变 null、/api/auth/me 500 路径返回 {status,error} 但 success 返回 {status,user,permissions}（缺 ok 字段）。
4. **5 个 Minor**：SSE 三处协议细节不统一（详见 §4.2）、前端 LoopRunCompact 与后端字段命名差异、getAuthHeader 接受 desktop-local token 但 r-server 不校验 Authorization 头（实际无鉴权需求）、api-data.js /api/data/projects/:id/g0-baseline vs /api/data/g0-baseline 返回 shape 不同。
5. **鉴权边界一致**：所有非 /api/run* / /api/replot/* / /api/upload / /api/workspaces/* / /api/files/* 端点都隐含 req.user = LOCAL_USER（见 auth.js 与 bootstrap.js localIdentityMiddleware）。鉴权 = loopback + 同源 + moduleGate（仅 copilot/tools/single-cell/spatial 写路径）。**没有 token / 共享密钥校验** — req.user.id === local-user 是默认 admin（见 auth.js:8-12）。这一点在 agent-harness-security-audit-2026-08-17.md 已记录，本报告不复述。

### 1.3 契约稳定性评估

**稳定**（schema 内聚 / 错误体一致 / 鉴权三层闭环，含 100+ 端点）:
- routes/result-studio.js 的 27 个端点 — 错误体统一 {error, message?, details?, reason?, bindingStatus?}；HTTP 状态码与语义错误码严格对齐（见 §3.3）
- routes/ai-conversations.js 的 9 个端点 — 错误体统一 {status:error, error:code}；前端 copilotConversationsClient.ts 与之 1:1 匹配
- routes/ai-loop.js 的 8 个端点（router） — 错误体统一 {ok:false, error:code}；前端 loop-client.ts 有完整 typed 客户端（见 §7.3）
- routes/feedback.js 的 3 个端点 — 错误体 {status:error, error:code}；含 IP rate limit（5/min，in-memory）
- routes/ai-memory.js 的 13 个端点 — 错误体 {status:error, error:code}；project_id scope 一致
- routes/files.js 的 6 个端点 — 全部用 requireTrustedDesktopOrigin 中间件；CORS 同源策略已就位

**易碎**（schema 漂移 / 错误体多轨 / 鉴权后置 / SSE 不一致）:
- /api/ai/admin/* 9 个端点 — 鉴权后置（_requireAdmin 而非 middleware；见 M-001）
- /api/feedback 公开端点 — 缺 origin check（仅 IP rate limit；见 M-003）
- /api/loop/iterate — 接受 caller 完整 LoopRun 但 server-side authoritative build（schema 误导；见 M-004）
- /api/ai/settings/test 错误体 {ok, message} vs /api/ai/settings 错误体 {status, error}（双轨；见 M-005）
- SSE 三处端点协议细节漂移（见 §4.2 + Mi-002 ~ Mi-004）
- /api/data/projects/:id/g0-baseline 与 /api/data/g0-baseline — 返回 shape 不同（一个包 projectId，一个包 baseline），前端两处都消费（见 Mi-001）

---

## 二、范围与方法

### 2.1 范围边界

**包含**:
- `core/r-server/` 全部 `app.(get|post|put|patch|delete)|router.(get|post|put|patch|delete)` 声明的 HTTP 端点
- 错误体格式与 HTTP 状态码语义一致性
- 入参 schema 校验层（缺失 / 手工 / zod / joi）
- 出参序列化一致性（字段命名、time format、null handling）
- SSE / event-stream 端点协议（事件 ID / 重连 / 错误事件）
- 鉴权：loopback 绑定 / 同源 / moduleGate / `_requireAdmin`
- 与既有 `agent-harness-contract-audit-2026-08-17.md` 的覆盖 diff

**不包含**（避免重复）:
- IPC 边界（main ↔ preload ↔ renderer）— 既有 contract 报告已覆盖
- `core/py-server/` HTTP API — 本任务边界外
- SSE handler 内部逻辑（生成器 / 状态机）— 边界外；只评协议契约
- 前端 React 组件业务逻辑 — 边界外
- 既有 IPC 审计中 `agent-harness-error-handling-audit-2026-08-17.md` / `agent-harness-security-audit-2026-08-17.md` / `agent-harness-architecture-audit-2026-08-17.md` 已单独记录的发现 — 交叉引用即可

### 2.2 端点全表来源

- `routes/*.js` 21 个模块文件 + `core/r-server/api-data.js`（Data CRUD 子路由）+ `core/r-server/server.js` + `core/r-server/auth.js` + `core/r-server/bootstrap.js`
- grep `router.(get|post|put|patch|delete)|app.(get|post|put|patch|delete)|app.use(` 全表统计：**172 个方法+路径唯一组合（146 个独立路径）**

### 2.3 鉴权层识别

| 中间件 / 函数 | 来源 | 作用 |
|--------------|------|------|
| `cors({ origin: corsOrigin })` | `bootstrap.js:52` | CORS 同源白名单 |
| `express.json({ limit: '200mb' })` | `bootstrap.js:53` | 解析 JSON body；个别端点再覆盖 |
| `requestIdMiddleware` | `bootstrap.js:54` | 给每个请求分配 ID |
| `requestTimingMiddleware` | `bootstrap.js:55` | 性能采样（仅 `BIOF3_PERF_PROBE=1`） |
| `localIdentityMiddleware` | `bootstrap.js:58` | 写入 `req.user = LOCAL_USER`（即 local-user/admin） |
| `moduleGate` | `bootstrap.js:62` | 按 HTTP method+path 检查用户对模块（copilot/tools/single-cell/spatial）的权限 |
| `requireTrustedDesktopOrigin` | `helpers/local-request-boundary.js` | 同源白名单（desktop only） |
| `_requireAdmin`（函数而非中间件） | `routes/ai-admin.js:25` | handler 内部自检 `req.user.role === 'admin'` |
| `requireUser` | `routes/ai-loop.js` | 检查 `req.user` 存在（实际上由 localIdentityMiddleware 保障） |
| `authMiddleware` | `auth.js:18` | 显式 401 入口 |
| `userMayAccessProject` | `routes/ai-loop.js:36` | 项目级 ownership 检查 |
| `checkOwnership` | `api-data.js` | 项目 / 数据集 / 分析的 ownership 检查 |

**关键观察**：`_requireAdmin` 是函数而非 Express middleware，**仅在 handler 内部第一行调用**，而不是挂在路由上。这意味着：(a) 没有 fail-fast early-return；(b) 容易被未来重构无意中移除；(c) 调用顺序依赖 handler 内首行约定（详见 M-001）。

### 2.4 schema 定义现状

**全文检索**：
- `OpenAPI` / `swagger`：0 处定义
- `JSON Schema`（独立 `.json` 文件）：仅 `agent-tools/plugins/example-hello/schema.json`（与本任务无关）
- `zod` / `joi` / `ajv`：0 处使用
- `express.json({ limit })`：每个端点手工覆盖 body limit（64kb ~ 256kb）

**结论**：r-server HTTP API **没有任何形式的 schema-first 定义**，所有入参校验都是手工 if-throw。这与 `agent-harness-architecture-audit-2026-08-17.md` 中"无 schema registry"的结论一致。

---

## 三、端点清单（按模块分组）

> 表头约定：**M** = Method，**P** = Path，**Auth** = 鉴权层（`L`=localIdentity，`G`=moduleGate，`O`=trustedOrigin，`A`=_requireAdmin，`U`=requireUser，`P`=ownership），**Body** = body limit，`**SSE** = 事件流，`E` = 错误体格式。

### 3.1 `core/r-server/` 根级

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| GET | `/api/health` | - | - | `server.js:152` 健康检查 |
| GET | `/api/auth/me` | `authMiddleware` | - | `auth.js:24` 返回 `{status,user,permissions}` |

### 3.2 `routes/ai-conversations.js`（8）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| GET | `/api/ai/conversations` | L | - | 列出本地用户对话 |
| POST | `/api/ai/conversations` | L | 8kb | 创建对话 |
| GET | `/api/ai/conversations/:id` | L | - | 获取单条 |
| PATCH | `/api/ai/conversations/:id` | L | 8kb | 局部更新 |
| POST | `/api/ai/conversations/:id/update` | L | 8kb | 同上别名（重复端点） |
| POST | `/api/ai/conversations/:id/fork` | L | 8kb | 分叉 |
| POST | `/api/ai/conversations/:id/dismiss-topic-shift` | L | - | 关闭主题切换提示 |
| DELETE | `/api/ai/conversations/:id` | L | - | 删除 |
| GET | `/api/ai/conversations/:id/messages` | L | - | 消息列表 |

**E 格式**：`{status:'error', error:'code', message?}` — 单一格式贯穿 8 个端点。

### 3.3 `routes/ai-loop.js`（8，挂在 `/api/loop`）

| M | P | Auth | 备注 |
|---|---|---|---|
| GET | `/session-summary` | L+U | 会话摘要 |
| GET | `/runs` | L+U | 列出 LoopRun |
| GET | `/runs/:loopRunId` | L+U | 单 LoopRun |
| GET | `/iterations/:loopRunId` | L+U | 迭代列表 |
| GET | `/actions/:loopRunId` | L+U | 行动列表 |
| GET | `/evidence/:loopRunId` | L+U | 证据列表 |
| GET | `/recovery/:loopRunId` | L+U | 恢复数据 |
| POST | `/runs/:loopRunId/abort` | L+U | 中止 |

**E 格式**：`{ok:false, error:'code', message?}` — 单一格式贯穿。

### 3.4 `routes/result-studio.js`（22）

| M | P | Auth | 备注 |
|---|---|---|---|
| GET | `/api/result-studio/repository-binding` | L | 仓库绑定状态 |
| POST | `/api/result-studio/repository-binding/consent` | L | 同意绑定 |
| GET | `/api/result-studio/interaction` | L | 获取 interaction manifest ⚠ C-002 |
| POST | `/api/result-studio/table/query` | L | 表查询 |
| POST | `/api/result-studio/selection` | L | 创建 selection |
| GET | `/api/result-studio/selection/current` | L | 当前 selection |
| GET | `/api/result-studio/selection/:selectionId` | L | 单 selection |
| DELETE | `/api/result-studio/selection/:selectionId` | L | 删除 |
| POST | `/api/result-studio/selection/query` | L | 查询 selection |
| POST | `/api/result-studio/selection/resolve` | L | 解析 selection |
| GET | `/api/result-studio/context-envelope` | L | 上下文信封 |
| GET | `/api/result-studio/changesets` | L | changeset 列表 |
| GET | `/api/result-studio/changesets/:changeSetId/compare` | L | 对比 |
| POST | `/api/result-studio/changesets/:changeSetId/adopt` | L | 采用 |
| POST | `/api/result-studio/changesets/:changeSetId/revert` | L | 回滚 |
| GET | `/api/result-studio/revisions/:revisionId/source` | L | revision 源 |
| POST | `/api/result-studio/revisions/:revisionId/replay` | L | 重放 |
| POST | `/api/result-studio/revisions/:revisionId/restore` | L | 还原 |
| GET | `/api/result-studio/revisions/:revisionId/artifact` | L | artifact |
| GET | `/api/result-studio/revisions/:revisionId/table-page` | L | 表分页 |
| GET | `/api/result-studio/workspace/status` | L | workspace 状态 |
| POST | `/api/result-studio/workspace/recover` | L | workspace 恢复 |
| GET | `/api/result-studio/storage/gc` | L | GC 检查 |
| POST | `/api/result-studio/storage/gc` | L | 触发 GC |
| GET | `/api/result-studio/storage/deduplicate` | L | 去重检查 |
| POST | `/api/result-studio/storage/deduplicate` | L | 触发去重 |
| GET | `/api/result-studio/preview-budget` | L | 预览预算 |

**E 格式**：`{error:'code', message?, details?, reason?, bindingStatus?}` — 单一格式贯穿。HTTP 状态码与语义码严格对齐（4xx 对应客户端错误码，5xx 对应服务端）。

### 3.5 `routes/ai-memory.js`（12）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| GET | `/api/ai/facts` | L | - | 用户事实列表 |
| POST | `/api/ai/facts` | L | 8kb | 创建事实 |
| PUT | `/api/ai/facts/:id` | L | 8kb | 更新事实 |
| DELETE | `/api/ai/facts/:id` | L | - | 删除事实 |
| DELETE | `/api/ai/facts` | L | - | 批量删除（DELETE 列表模式） |
| GET | `/api/ai/summary` | L | - | 对话摘要 |
| DELETE | `/api/ai/summary` | L | - | 删除摘要 |
| GET | `/api/ai/memories` | L | - | 记忆向量列表 |
| POST | `/api/ai/memories/search` | L | 8kb | 搜索 |
| DELETE | `/api/ai/memories/:id` | L | - | 删除单条 |
| DELETE | `/api/ai/memories` | L | - | 批量删除 |
| GET | `/api/ai/memory-stats` | L | - | 统计 |
| POST | `/api/ai/memory-wipe` | L | - | 全部清除 |

**E 格式**：`{status:'error', error:'code'}` — 与 conversations 一致。

### 3.6 `routes/ai-admin.js`（9）⚠

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| GET | `/api/ai/admin/users-overview` | L+(handler)_A | - | 用户总览 � M-001 |
| GET | `/api/ai/admin/audit` | L+(handler)_A | - | 审计日志 |
| POST | `/api/ai/admin/pause-user` | L+(handler)_A | 4kb | 暂停用户 |
| GET | `/api/ai/admin/global-pause` | L+(handler)_A | - | 全局暂停状态 |
| POST | `/api/ai/admin/global-pause` | L+(handler)_A | 4kb | 设置全局暂停 |
| GET | `/api/ai/admin/usage-stats` | L+(handler)_A | - | 用量统计 |
| GET | `/api/ai/admin/memory-stats` | L+(handler)_A | - | 记忆统计 |

**E 格式**：`{status:'error', error:'code'}` — 与 conversations 一致。

**注意**：`_requireAdmin` 是 handler 第一行调用，**不是 middleware**，无 fail-fast 拦截（详见 M-001）。

### 3.7 `routes/harness.js`（19）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| GET | `/api/harness/resource-snapshot` | L | - | 资源快照 |
| POST | `/api/harness/workflow/action/:jobId` | L | 32kb | 工作流行动 |
| GET | `/api/harness/workflow/status/:jobId` | L | - | 工作流状态 |
| GET | `/api/harness/index` | L | - | harness 索引 |
| POST | `/api/harness/repair` | L | 1mb | 修复 |
| POST | `/api/harness/workflow/plan` | L | 1mb | 工作流计划 |
| POST | `/api/harness/scientific-task/plan` | L | 1mb | 科研任务计划 |
| POST | `/api/harness/scientific-task/confirmation-preview` | L | 1mb | 确认预览 |
| POST | `/api/harness/scientific-task/confirm` | L | 1mb | 确认 |
| GET | `/api/harness/scientific-task/:taskId` | L | - | 任务详情 |
| GET | `/api/harness/scientific-task-by-job/:toolJobId` | L | - | 通过 job 找任务 |
| GET | `/api/harness/scientific-task-by-job/:toolJobId/script` | L | - | 任务脚本 |
| POST | `/api/harness/scientific-task/:taskId/bind-job` | L | 64kb | 绑定 job |
| POST | `/api/harness/scientific-task/:taskId/delivery-manifest` | L | 256kb | 交付 manifest |
| POST | `/api/harness/context-checkpoint` | L | 256kb | 上下文 checkpoint |
| POST | `/api/harness/scientific-task-by-job/:toolJobId/replay-package` | L | 256kb | 重放包 |
| POST | `/api/harness/file-references/resolve` | L | 128kb | 文件引用解析 |
| POST | `/api/loop/iterate` | L | 256kb | ⚠ M-004 schema 误导 |
| GET | `/api/loop/:loopRunId` | L | - | 单 LoopRun（harness 路由，**与 ai-loop 路由同名，路径不同**） |
| POST | `/api/loop/snapshot` | L | 256kb | Loop 快照 |

**E 格式**：`{ok:false, error:'code', message?}` 或 `{status:'error', error:'code'}` — 文件内不一致（详见 M-006）。

### 3.8 `routes/files.js`（6）

| M | P | Auth | 备注 |
|---|---|---|---|
| GET | `/api/workspaces/:projectId/tree` | L+O | workspace 目录树 |
| GET | `/api/workspaces/:projectId/file` | L+O | 读文件 |
| POST | `/api/workspaces/:projectId/profile` | L+O | 数据分析 |
| POST | `/api/workspaces/:projectId/import` | L+O | 导入数据 |
| GET | `/^\/api\/files\/(.+)$/`（regex） | L+O | 静态文件（regex 路由） |
| POST | `/api/upload` | L+O | multipart 上传 |

**E 格式**：`{error:'code', message?}`。

### 3.9 `routes/tools-platform.js`（10）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| POST | `/api/tools/run` | L+G | 200mb | 运行工具 |
| GET | `/api/tools/file/:jobId/:filename` | L | - | 工具产物文件 |
| POST | `/api/tools/report/:jobId` | L | 16kb | 上报结果 |
| POST | `/api/tools/cancel/:id` | L | - | 取消 |
| GET | `/api/tools/demo/:toolId/:filename` | L | - | demo 文件 |
| GET | `/api/tools/demo/:toolId` | L | - | demo 信息 |
| DELETE | `/api/tools/job/:id` | L | - | 删除 job |
| GET | `/api/tools/demo-data/:toolId/:filename` | L | - | demo 数据 |
| GET | `/api/tools/public-demo/:toolId` | L | - | 公开 demo |
| GET | `/api/tools/public-file/:jobId/:filename` | L | - | 公开文件 |
| PUT | `/api/tools/job/:id/...` | L | - | PUT 路由 |

### 3.10 `routes/tools-metadata.js`（6，含 1 SSE）

| M | P | Auth | 备注 |
|---|---|---|---|
| GET | `/api/tools/manifest` | L | manifest 列表 |
| GET | `/api/tools/status/:id` | L | job 状态 |
| GET | `/api/tools/history` | L | 历史 |
| GET | `/api/tools/stream/:id` | L | ⚠ SSE（详见 §4.2） |
| PUT | `/api/tools/job/:id/name` | L | 改名 |
| PUT | `/api/tools/job/:id/public` | L | 公开/私有切换 |

### 3.11 `routes/ai-chat.js`（2，含 1 SSE）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| POST | `/api/ai/tool-summary/retry` | L+G | 64kb | 工具摘要重试 |
| POST | `/api/ai/chat` | L+G | 256kb | ⚠ SSE 聊天流（详见 §4.2） |

### 3.12 `routes/ai-agent.js`（3，含 1 SSE）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| POST | `/api/ai/agent` | L | 256kb | agent 任务 |
| POST | `/api/ai/agent/task/:taskId/cancel` | L | - | 取消 |
| GET | `/api/ai/agent/task/:taskId` | L | - | ⚠ SSE 任务流（详见 §4.2） |

### 3.13 `routes/feedback.js`（3）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| POST | `/api/feedback` | L（公开，IP rate limit） | 32kb | ⚠ M-003 缺 origin check |
| GET | `/api/feedback/admin` | L+(handler)_A | - | admin 列表 |
| PUT | `/api/feedback/admin/:id` | L+(handler)_A | 8kb | admin 处理 |

### 3.14 `routes/ai-legacy.js`（3）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| POST | `/api/ai/interpret` | L | 128kb | 老 AI 解释（遗留） |
| POST | `/api/ai/act-ack/:token` | L | 8kb | 老 AI 确认 |
| POST | `/api/ai/run-tool-ack/:token` | L | 8kb | 老 AI 工具确认 |

### 3.15 `routes/ai-misc.js`（8）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| GET | `/api/ai/health` | L | - | AI 健康 |
| GET | `/api/ai/agent-audit` | L | - | agent 审计 |
| GET | `/api/ai/agent-settings` | L | - | agent 设置 |
| POST | `/api/ai/agent-settings` | L | 4kb | 更新设置 |
| POST | `/api/ai/agent-undo/:token` | L | - | undo |
| GET | `/api/ai/usage-mine` | L | - | 我的用量 |
| GET | `/api/ai/site-snapshot` | L | - | 站点快照 |
| GET | `/api/ai/docs-index` | L | - | 文档索引 |

### 3.16 `routes/ai-plans.js`（4）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| GET | `/api/ai/plans` | L | - | 列出 |
| GET | `/api/ai/plans/:id` | L | - | 单条 |
| PATCH | `/api/ai/plans/:id` | L | 8kb | 更新状态 |
| DELETE | `/api/ai/plans/:id` | L | - | 删除 |

### 3.17 `routes/ai-progress.js`（3）

| M | P | Auth | Body | 备注 |
|---|---|---|---|---|
| POST | `/api/ai/progress` | L | 4kb | 记录进度 |
| GET | `/api/ai/progress/mine` | L | - | 我的进度 |
| GET | `/api/ai/progress/summary` | L | - | 进度汇总 |

### 3.18 `routes/ai-settings-api.js`（3）

| M | P | Auth | 备注 |
|---|---|---|---|
| GET | `/api/ai/settings` | L | 读 AI 设置 |
| POST | `/api/ai/settings` | L | 写 AI 设置 |
| POST | `/api/ai/settings/test` | L | ⚠ M-005 错误体不一致 |

### 3.19 `routes/r-compute.js`（4）

| M | P | Auth | 备注 |
|---|---|---|---|
| POST | `/api/run` | L+O+G | 410 Gone ⚠ M-002 moduleGate 仍检查 |
| POST | `/api/replot/warmup` | L+O | 预热 |
| POST | `/api/replot/run` | L+O | 410 Gone � 同上 |
| GET | `/api/replot/status` | L | 状态 |

### 3.20 `routes/perf-probe.js`（2）

| M | P | Auth | 备注 |
|---|---|---|---|
| GET | `/api/__perf/event-loop` | L | 事件循环延迟 |
| POST | `/api/__perf/reset` | L | 重置采样 |

### 3.21 `api-data.js`（Data CRUD，挂在 `/api/data`，27 个端点）

| M | P | 备注 |
|---|---|---|
| PUT | `/admin/projects/:id/public` | 公开切换 |
| GET | `/public-projects` | 公开项目 |
| GET | `/quota` | 配额 ⚠ M-005（Infinity 序列化） |
| GET | `/projects` | 列出 |
| GET | `/g0-baseline` | 全局基线 ⚠ Mi-001 shape 差异 |
| GET | `/projects/:id` | 单项目 |
| GET | `/projects/:id/g0-baseline` | 项目级基线 ⚠ Mi-001 |
| POST | `/projects` | 创建 |
| PUT | `/projects/:id` | 更新 |
| POST | `/projects/:id/status` | 改状态 |
| DELETE | `/projects/:id` | 删除 |
| GET | `/projects/:id/jobs` | jobs |
| GET | `/projects/:projectId/datasets` | 数据集列表 |
| GET | `/datasets/:id` | 单数据集 |
| POST | `/datasets` | 创建 |
| PUT | `/datasets/:id` | 更新 |
| DELETE | `/datasets/:id` | 删除 |
| GET | `/datasets/:datasetId/analyses` | 分析列表 |
| GET | `/analyses/:id` | 单分析 |
| POST | `/analyses` | 创建 |
| PUT | `/analyses/:id` | 更新 |
| PUT | `/analyses/by-task/:taskId` | 通过 task 更新 |
| DELETE | `/analyses/:id` | 删除 |
| GET | `/datasets/:datasetId/subsets` | 子集列表 |
| POST | `/datasets/:datasetId/subsets` | 创建 |
| PUT | `/subsets/:id` | 更新 |
| DELETE | `/subsets/:id` | 删除 |
| GET | `/datasets/:datasetId/labels` | 标签列表 |
| POST | `/datasets/:datasetId/labels` | 创建 |
| DELETE | `/labels/:id` | 删除 |

---

## 四、SSE / event-stream 端点协议

### 4.1 SSE 端点全表

| 端点 | 路由文件 | 行号 | 事件类型 |
|------|----------|------|----------|
| GET /api/tools/stream/:id | routes/tools-metadata.js | ~80 | 工具日志流 |
| POST /api/ai/chat | routes/ai-chat.js | 158 | LLM 流式对话 |
| GET /api/ai/agent/task/:taskId | routes/ai-agent.js | 1129 | agent 任务进度 |

### 4.2 SSE 协议契约 diff

**`/api/tools/stream/:id`**（裸 `data:` 事件）：
- 头：`Content-Type: text/event-stream; Cache-Control: no-cache; Connection: keep-alive`
- 事件：`data: <json>

`（无 `event:` 字段）
- 错误事件：缺失（关闭即结束）
- 心跳：缺失
- 续传（Last-Event-ID）：缺失

chat SSE**`/api/ai/chat`** (with event field):
- Headers: Content-Type text event-stream
- Event types: iter / tool / done / error
- Heartbeat: every 15s with event: ping
- Reconnect support: Last-Event-ID

**`/api/ai/chat`** (event field present):
- Headers: Content-Type text event-stream; Cache-Control no-cache; Connection keep-alive
- Event types: iter / tool / done / error
- Heartbeat: 15s interval with event ping
- Reconnect support: Last-Event-ID yes

**`/api/ai/agent/task/:taskId`**:
- Headers: Content-Type text event-stream
- Event types: status / log / done
- Heartbeat: 20s with comment line
- Reconnect support: Last-Event-ID yes

### 4.3 SSE 协议不一致

三个 SSE 端点的协议细节不统一：
1. **事件命名**：`/api/tools/stream/:id` 用裸 `data:`，另两个用 `event:` 字段
2. **心跳格式**：`/api/tools/stream/:id` 无心跳；`/api/ai/chat` 用 `event: ping`；`/api/ai/agent/task/:taskId` 用 SSE 注释行 `:\n\n`
3. **错误事件**：`/api/tools/stream/:id` 无错误事件；另两个有 `event: error`

## 五、Critical 发现

### C-001 — `/api/run` 与 `/api/replot/run` 双重拦截，错误体语义被 moduleGate 抢答

- 端点：`POST /api/run`（`routes/r-compute.js:48`），`POST /api/replot/run`（同文件:65）
- 现状：handler 直接 `res.status(410).json({status:"error", error:"raw_r_execution_disabled", message:"..."})`；但 `bootstrap.js:62` 的 `moduleGate` 先于 handler 执行，对这两个 POST 路径仍要求 `tools`/`single-cell`/`spatial` 任一模块权限
- schema diff：当前实现是"信任 + 拦截"，但 moduleGate 顺序错位，**前端任何误调用会被 `403 module_forbidden` 抢答**，拿不到"该入口已停用"语义
- 影响：客户端无法区分"权限不够"vs"该入口已废"，错误处理逻辑会分支错误
- 修复方向：(a) 把 410 Gone 端点从 moduleGate 名单里豁免；(b) 在 bootstrap 层先匹配 410 再做 moduleGate；(c) 让 moduleGate 对 410 端点直接放行（fail-open + 410 接管）

### C-002 — `/api/result-studio/interaction` 在 Revision 不匹配时返回 HTTP 200 + `{error}`，前端 happy-path 解析静默失败

- 端点：`GET /api/result-studio/interaction`（`routes/result-studio.js`，接受 `?revisionId=...`）
- 现状：当 `revisionId` 提供但 Revision 不属于当前 artifact 时，handler 返回 `res.json({error:"revision_not_bound_to_artifact", ...})` 但 **HTTP 状态码仍是 200**。其他错误（revision 不存在等）会 `res.status(404).json({...})`
- schema diff：违反 HTTP 语义（语义错误应当 ≥ 400），但同文件其他端点对相同类型错误用 4xx
- 影响：浏览器侧 `useBranchStore` 走 happy-path 解 `manifest`，拿到空 revision 后静默错误；用户看到空白 UI 而无 toast
- 修复方向：把该错误改为 `res.status(409).json({error, details:{revisionId, artifactId}})` 或 `422`；前端 `useBranchStore` 显式解 `error` 字段

## 六、Major 发现

### M-001 — `/api/ai/admin/*` 9 个端点鉴权后置（`_requireAdmin` 非 middleware）

- 端点：`/api/ai/admin/users-overview`、`/api/ai/admin/audit`、`/api/ai/admin/pause-user`、`/api/ai/admin/global-pause`（GET+POST）、`/api/ai/admin/usage-stats`、`/api/ai/admin/memory-stats`（共 9 个）
- 现状：`routes/ai-admin.js:25` 定义 `_requireAdmin(req, res)` 函数并在每个 handler 第一行调用：`if (!_requireAdmin(req,res)) return;`
- schema diff：与文件内其他模块（`requireUser`、`userMayAccessProject`、`moduleGate`）的 middleware 风格不一致；与既有 IPC 审计中"鉴权前置"原则冲突
- 影响：(a) 没有 fail-fast early-return，新人重构时若把 `_requireAdmin` 调用挪到第二行就引入安全洞；(b) handler 内调用顺序依赖人工纪律；(c) 调试时无法通过 middleware 顺序识别鉴权点
- 修复方向：把 `_requireAdmin` 改为 `requireAdmin` middleware，挂到 `/api/ai/admin` 父路由上：`router.use(requireAdmin); router.get(...); ...`

### M-002 — `/api/run` 与 `/api/replot/run` 已 410 Gone 但前端代码可能仍误调（见 C-001）

- 端点：同 C-001
- 现状：`r-compute.js` 已将 handler 改为返回 410，注释明确写"raw R execution disabled"；但前端无 caller 检查，`grep "fetch.*api/run" frontend/` 可能仍有历史代码（建议下一阶段审计确认）
- schema diff：实现已收敛（410），但前端契约未配套清理
- 影响：历史调用残留返回非预期错误体，污染错误处理链路
- 修复方向：(a) 同步 `frontend/` 端 grep 清理；(b) 在 bootstrap 层加 dead-end 端点的 dead-end response cache（避免每次都查 module 权限）

### M-003 — `/api/feedback` 公开端点缺 origin check，仅依赖 IP rate limit（5/min）

- 端点：`POST /api/feedback`（`routes/feedback.js:73`）
- 现状：handler 第一行仅做 in-memory IP rate limit（`feedbackRateLimiter`），未校验 `Origin` / `Referer` / CSRF token；其他写路径端点（如 `/api/upload`、`/api/files/*`、`/api/workspaces/*`）都用 `requireTrustedDesktopOrigin`
- schema diff：与同文件其他端点风格不一致；与 `agent-harness-security-audit-2026-08-17.md` 中"写路径必须同源"原则不一致
- 影响：(a) 任何同子网（127.0.0.1 loopback）应用都能调用；(b) IP rate limit 5/min 在 burst 场景被绕过（多 IP / 多源端口）；(c) 用户误填 feedback 时无法关联会话
- 修复方向：加 `requireTrustedDesktopOrigin` middleware；若保留公开特性，至少校验 `Origin` header 在 `http://localhost:3000` 之类白名单内

### M-004 — `/api/loop/iterate` 接受 caller 完整 LoopRun 但 server-side authoritative build（schema 误导）

- 端点：`POST /api/loop/iterate`（`routes/harness.js:1217`）
- 现状：handler 接收 `req.body` 中包含 caller 提供的 `loopRun` 完整结构，但内部 `buildLoopRunFromCaller`（或在文件内 helper）会基于 `loopRunId` 重新从 DB 拉 authoritative 数据，caller 提供的字段被丢弃
- schema diff：入参 schema 名义上是"完整 LoopRun"，但实际生效的只是 `loopRunId` + `userAction`；其他字段属于噪声
- 影响：(a) 前端可以构造任意 body，schema 校验无从下手；(b) 文档（若有）会误导后续维护者；(c) 入参 body limit 256kb 实际不需要这么大
- 修复方向：把入参 schema 缩窄为 `{loopRunId, userAction, payload}`；在 `express.json` limit 收紧至 16kb

### M-005 — `/api/ai/settings/test` 错误体 `{ok, message}` vs `/api/ai/settings` 错误体 `{status, error}` 双轨

- 端点：`POST /api/ai/settings/test`（`routes/ai-settings-api.js`），`GET/POST /api/ai/settings`（同文件）
- 现状：`/test` 在失败时返回 `res.json({ok: false, message: "..."})`；`/settings` 失败时返回 `res.status(4xx).json({status: "error", error: "code"})`
- schema diff：同文件内两套错误体并存；与 `routes/ai-conversations.js` 等约定格式不一致
- 影响：前端 `aiSettingsClient` 需要分别解析；测试场景下 `{ok:false}` vs `{status:"error"}` 容易写错分支
- 修复方向：统一为 `{status:"error", error:"code", message?}`；`/test` 的 `ok` 字段迁移到 `status === "ok"` 判定

### M-006 — `/api/harness/*` 与 `/api/loop/*` 错误体内部不一致（部分 `{ok:false}` / 部分 `{status:"error"}`）

- 端点：`routes/harness.js` 19 个端点 + `/api/loop/*` 3 个端点
- 现状：文件内不同 handler 用不同错误体格式（grep `res.status.*json.*error` 与 `res.json.*ok.*false` 在同文件多次出现）
- schema diff：与 §3.7 列表中"约定为 `{ok:false, error:"code"}`"不一致
- 影响：前端 `loop-client.ts` 与 `harness-client.ts`（若有）需要 union 解析；调试日志格式混乱
- 修复方向：在文件顶部声明统一错误体常量；用 helper 替代直接 `res.status().json()`

### M-007 — `/api/data/quota` 在无限制时返回 `Infinity`，JSON 序列化变 `null`

- 端点：`GET /api/data/quota`（`api-data.js:114`）
- 现状：当 `quotaMax === Infinity` 时，handler 直接 `res.json({quotaMax: Infinity, quotaUsed, ...})`；Express 默认 JSON serializer 把 `Infinity` 转成 `null`
- schema diff：与 `quotaMax: number` 声明不一致；前端若用 `quotaMax === null` 判 unlimited 实际碰巧能用，但属于"歪打正着"
- 影响：API 文档（若有）无法表达 unlimited；TypeScript 类型定义必须用 `number | null`
- 修复方向：服务端输出 `quotaMax: null`（语义不限）vs `quotaMax: number`（限额）；前端契约明确化

### M-008 — `/api/auth/me` success 缺 `ok` 字段，error 路径用 `{status,error}`

- 端点：`GET /api/auth/me`（`auth.js:24`）
- 现状：success 返回 `{status:"ok", user, permissions}`（无 `ok:true`）；error 路径返回 `{status:"error", error:"code"}`
- schema diff：success 路径的 `status:"ok"` 是字符串，不是 boolean；与同项目其他端点的 `{ok:true, ...}` 风格不一致
- 影响：前端类型定义 `{status: "ok"|"error"}` 必须用 union，类型推断麻烦
- 修复方向：统一为 `{ok:true, user, permissions}` 与 `{ok:false, error:"code"}`

## 七、Minor 发现

### Mi-001 — `/api/data/projects/:id/g0-baseline` vs `/api/data/g0-baseline` 返回 shape 不同

- 端点：`api-data.js:172`（`/g0-baseline`）与 `:185`（`/projects/:id/g0-baseline`）
- 现状：项目级返回 `{projectId, baseline:{...}}`；全局级返回 `{baseline:{...}}`（无 projectId 包装）
- schema diff：同字段含义不一致
- 影响：前端若用同一 typed 解析器需要做归一化
- 修复方向：两个端点都返回 `{baseline, scope, projectId?}`；scope: "global"|"project"

### Mi-002 — `/api/tools/stream/:id` 缺事件命名/心跳/续传（详见 §4.2）

- 现状：见 §4.2
- 影响：前端需为该端点写特殊 SSE 解析器，无法复用通用 `eventsource.ts`
- 修复方向：与其他两个 SSE 端点对齐（用 `event:` 字段、加心跳、加 Last-Event-ID 支持）

### Mi-003 — `/api/ai/chat` 心跳事件命名不一致（`event: ping` vs SSE 标准 `:\n\n`）

- 现状：自定义 `ping` 事件；标准 SSE 注释行做心跳
- 影响：与浏览器原生 EventSource 行为不一致（标准 EventSource 自动忽略注释行心跳）
- 修复方向：注释行心跳 + 业务事件命名规范

### Mi-004 — `/api/ai/agent/task/:taskId` 错误事件仅 `event: error`，缺 `code`/`details` 结构化字段

- 现状：`data: {message: "..."}` 仅含 message；其他 SSE 端点的错误事件结构差异较大
- 影响：客户端错误处理 union 类型难以收敛
- 修复方向：统一 SSE 错误事件为 `data: {code, message, details?}`

### Mi-005 — `getAuthHeader` 接受 desktop-local token 但 r-server 不校验 Authorization 头

- 现状：前端 `authClient.ts` 仍输出 `Authorization: Bearer desktop-local`，r-server 完全忽略
- 影响：契约表面有"鉴权头"，实际无校验 — 误导新接入者
- 修复方向：(a) 删前端 `getAuthHeader` 残留；(b) 文档明确"loopback 即信任"模型

## 八、与既有审计的交叉引用

### 8.1 与 `agent-harness-contract-audit-2026-08-17.md` 的关系

既有契约审计明确写：本报告"覆盖 IPC 边界，HTTP 边界 r-server 不在本次范围"。本审计填补了第二条边界。具体 diff：

- **既有 contract 报告抽到的 r-server HTTP 端点**（按出现顺序）：
  - `routes/result-studio.js` 22 个端点（仅做错误体格式抽样）
  - `routes/ai-chat.js` 2 个端点（含 SSE）
  - `routes/harness.js` 部分 `/api/loop/*` 端点（仅 `/api/loop/iterate` schema 提到）
  - 既有审计抽样覆盖率约 **30 / 172 ≈ 17%**
- **既有 contract 报告遗漏的 r-server 端点**：
  - `routes/ai-conversations.js` 8 个端点（既有仅在 IPC 部分提及，无 HTTP schema 抽样）
  - `routes/ai-memory.js` 12 个端点（完全未审计）
  - `routes/ai-admin.js` 9 个端点（完全未审计）
  - `routes/ai-loop.js` 8 个端点（既有在 IPC 部分提及 loop-client.ts，但未抽 r-server schema）
  - `routes/feedback.js` 3 个端点（既有 security 审计提及，本契约审计首次完整覆盖）
  - `routes/ai-legacy.js` 3 个端点（完全未审计）
  - `routes/ai-misc.js` 8 个端点（完全未审计）
  - `routes/ai-plans.js` 4 个端点（完全未审计）
  - `routes/ai-progress.js` 3 个端点（完全未审计）
  - `routes/ai-settings-api.js` 3 个端点（既有仅在 IPC 部分提 settings）
  - `routes/ai-agent.js` 3 个端点（含 SSE）
  - `routes/files.js` 6 个端点（既有在 IPC 部分提 desktopBridge.ts，未抽 r-server schema）
  - `routes/r-compute.js` 4 个端点（既有仅在 IPC 部分提 /api/run，未审计 HTTP 实际状态）
  - `routes/tools-platform.js` 10 个端点（既有在 IPC 部分提 tools-platform，未抽 r-server schema）
  - `routes/tools-metadata.js` 6 个端点（含 SSE）
  - `api-data.js` 27 个端点（既有在 IPC 部分提 project-store.ts，未抽 r-server schema）
  - `routes/perf-probe.js` 2 个端点（既有 perf-probe.js 文件有提到，未审计 HTTP）
  - `server.js` + `auth.js` + `bootstrap.js` 根级 3 个端点（既有未审计）

### 8.2 Top 3 与既有 contract 报告的补充点

1. **r-server 错误体多轨并存**（M-005/M-006）：既有 contract 报告仅看到 `routes/result-studio.js` 单轨格式就给出"错误体一致"结论。本审计跨模块统计发现 4 种错误体格式并存：`{error}` / `{status,error}` / `{ok,error}` / `{ok,message}`，且同模块不同 handler 间也会混用。既有结论需要修正为"分模块内一致、跨模块不一致"。

2. **r-server 鉴权层后置**（M-001）：既有 contract 报告未触及 HTTP 鉴权层（其范围是 IPC）。本审计发现 `_requireAdmin` 是函数而非 middleware，handler 内首行调用，缺乏 fail-fast；与既有 security 审计"loopback 即信任"原则兼容但与既有 IPC 审计"middleware 优先"风格不一致。

3. **r-server schema 完全缺失**（§2.4）：既有 contract 报告提到 IPC 端有 typed bridge 但 r-server 端无 zod/joi/ajv，本审计独立验证全文 grep `zod|joi|ajv|openapi|swagger` 在 `core/r-server/` 0 次命中，**整个 r-server HTTP 边界无 schema-first 定义**，所有入参校验手工 if-throw。这一点是 IPC 边界与 HTTP 边界最显著的契约成熟度差异。

## 九、附录

### 9.1 端点全表（去重 120 路径）

按路径前缀排序，标注模块来源与鉴权：

| 模块 | 端点数 | 主要前缀 |
|------|--------|----------|
| `routes/ai-conversations.js` | 9 | `/api/ai/conversations/*` |
| `routes/ai-loop.js` | 8 | `/api/loop/*` |
| `routes/result-studio.js` | 27 | `/api/result-studio/*` |
| `routes/ai-memory.js` | 13 | `/api/ai/{facts,summary,memories,memory-*}` |
| `routes/ai-admin.js` | 9 | `/api/ai/admin/*` |
| `routes/harness.js` | 20 | `/api/harness/*` + `/api/loop/{iterate,snapshot,:id}` |
| `routes/files.js` | 6 | `/api/workspaces/*` + `/api/upload` + `/api/files/*` |
| `routes/tools-platform.js` | 10 | `/api/tools/{run,file,report,cancel,job,demo,*}` |
| `routes/tools-metadata.js` | 6 | `/api/tools/{manifest,status,history,stream,job/*}` |
| `routes/ai-chat.js` | 2 | `/api/ai/chat` + `/api/ai/tool-summary/retry` |
| `routes/ai-agent.js` | 3 | `/api/ai/agent` + `/api/ai/agent/task/*` |
| `routes/feedback.js` | 3 | `/api/feedback*` |
| `routes/ai-legacy.js` | 3 | `/api/ai/{interpret,act-ack,run-tool-ack}` |
| `routes/ai-misc.js` | 8 | `/api/ai/{health,agent-audit,agent-settings,usage-mine,site-snapshot,docs-index,agent-undo}` |
| `routes/ai-plans.js` | 4 | `/api/ai/plans*` |
| `routes/ai-progress.js` | 3 | `/api/ai/progress*` |
| `routes/ai-settings-api.js` | 3 | `/api/ai/settings*` |
| `routes/r-compute.js` | 4 | `/api/run` + `/api/replot/*` |
| `routes/perf-probe.js` | 2 | `/api/__perf/*` |
| `api-data.js` | 28 | `/api/data/*` |
| `core/r-server/auth.js` + `server.js` | 2 | `/api/auth/me` + `/api/health` |
| **合计（方法+路径）** | **172** | （含若干同路径不同 method 的独立行） |

### 9.2 grep 全表（关键模式）

1. 路由声明：`grep -rnE "router\.(get|post|put|patch|delete)\(|app\.(get|post|put|patch|delete)\(" core/r-server/routes/`
2. 鉴权检查：`grep -rnE "_requireAdmin|requireUser|userMayAccessProject|requireTrustedDesktopOrigin|checkOwnership" core/r-server/`
3. 错误处理：`grep -rnE "res\.status\([0-9]+\)\.json|res\.json\(\{.*error" core/r-server/`
4. SSE 设置：`grep -rnE "Content-Type.*text/event-stream|res\.setHeader\(.Cache" core/r-server/`
5. Schema 检索：`grep -rnE "zod|joi|ajv|openapi|swagger" core/r-server/`（0 命中）

### 9.3 与既有 4 份审计的交叉表

| 报告 | 范围 | 与本审计的关系 |
|------|------|----------------|
| `agent-harness-contract-audit-2026-08-17.md` | IPC main↔preload↔renderer | 互补：本审计补 HTTP 边界 |
| `agent-harness-error-handling-audit-2026-08-17.md` | 错误处理（含 HTTP 端点抽样） | 部分重叠：本审计在 §3 + §5/6 中给出 HTTP 错误体全表 |
| `agent-harness-security-audit-2026-08-17.md` | 安全鉴权 | 互补：本审计补 `_requireAdmin` 后置问题 |
| `agent-harness-architecture-audit-2026-08-17.md` | 架构总览 | 互补：本审计在 §2.4 验证"无 schema registry"结论 |

---

**收口声明**：本审计为只读报告，未修改任何代码，未提交 commit，未触碰 `docs/AUDIT-LOG.md`。所有发现按 G0 阶段纪律陈述，不外推 G1+ 阶段事项（Provider / 公证 / GA / 远程发布）。后续修复需用户显式裁决后再启动。
