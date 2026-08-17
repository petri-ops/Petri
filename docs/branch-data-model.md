# Branch Conversation Data Model

分支对话架构的 SQLite 持久化数据结构文档，供前端 Agent 对齐使用。

## 架构概览

```
Project (项目)
  └── Branch (分支) × N
        └── Message (消息) × N
```

- **Project**：工作空间单元，归属结果（Result Studio）
- **Branch**：对话分支，隔离对话历史，同一项目的分支共享结果
- **Message**：分支下的对话记录（user / assistant）

## SQLite Schema

文件：`src/migrations/005_branch_conversation.sql`

### projects 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| name | TEXT | NOT NULL | 项目名称 |
| created_at | INTEGER | NOT NULL | 创建时间戳（ms） |
| updated_at | INTEGER | NOT NULL | 更新时间戳（ms） |

### branches 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| project_id | TEXT | NOT NULL, FK | 所属项目 ID |
| name | TEXT | NOT NULL | 分支名称 |
| parent_branch_id | TEXT | FK (optional) | 父分支 ID（支持 fork） |
| created_at | INTEGER | NOT NULL | 创建时间戳（ms） |
| updated_at | INTEGER | NOT NULL | 更新时间戳（ms） |
| is_active | INTEGER | NOT NULL DEFAULT 0 | 是否当前激活分支 |

**索引**：
- `idx_branches_project` ON (project_id)
- `idx_branches_parent` ON (parent_branch_id)
- `idx_branches_active` ON (project_id, is_active)

### messages 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| branch_id | TEXT | NOT NULL, FK | 所属分支 ID |
| role | TEXT | NOT NULL, CHECK | 'user' 或 'assistant' |
| content | TEXT | NOT NULL | 消息内容 |
| metadata | TEXT | (nullable) | JSON，可存工具调用、附件等 |
| created_at | INTEGER | NOT NULL | 创建时间戳（ms） |

**索引**：
- `idx_messages_branch` ON (branch_id)
- `idx_messages_created` ON (branch_id, created_at)

## IPC 通道

文件：`src/ipc/branch-handlers.js`

### Project 通道

| 通道名 | 参数 | 返回 |
|--------|------|------|
| `branch:project:create` | `{ id, name }` | `{ ok, data }` |
| `branch:project:get` | `{ id }` | `{ ok, data }` |
| `branch:project:update` | `{ id, name }` | `{ ok, data }` |
| `branch:project:list` | `{}` | `{ ok, data: [] }` |

### Branch 通道

| 通道名 | 参数 | 返回 |
|--------|------|------|
| `branch:create` | `{ projectId, name, parentBranchId? }` | `{ ok, data }` |
| `branch:get` | `{ id }` | `{ ok, data }` |
| `branch:list` | `{ projectId }` | `{ ok, data: [] }` |
| `branch:switch` | `{ branchId, projectId }` | `{ ok, data }` |
| `branch:active` | `{ projectId }` | `{ ok, data }` |
| `branch:delete` | `{ id }` | `{ ok }` |
| `branch:rename` | `{ id, newName }` | `{ ok, data }` |
| `branch:children` | `{ parentBranchId }` | `{ ok, data: [] }` |

### Message 通道

| 通道名 | 参数 | 返回 |
|--------|------|------|
| `message:append` | `{ branchId, role, content, metadata? }` | `{ ok, data }` |
| `message:list` | `{ branchId, limit?, offset? }` | `{ ok, data: [] }` |
| `message:get` | `{ id }` | `{ ok, data }` |
| `message:count` | `{ branchId }` | `{ ok, data: number }` |
| `message:delete` | `{ id }` | `{ ok }` |
| `message:clear` | `{ branchId }` | `{ ok, data: count }` |

## MCP 工具

文件：`core/r-server/mcp/registry.js`

| 工具名 | 参数 | 说明 |
|--------|------|------|
| `branch_create` | `projectId, name, parentBranchId?` | 创建分支 |
| `branch_list` | `projectId` | 列出项目所有分支 |
| `branch_switch` | `branchId, projectId` | 切换当前分支 |
| `branch_delete` | `branchId` | 删除分支 |
| `branch_rename` | `branchId, newName` | 重命名分支 |
| `branch_get_active` | `projectId` | 获取当前激活分支 |
| `message_list` | `branchId, limit?, offset?` | 获取对话历史 |
| `message_append` | `branchId, role, content, metadata?` | 添加消息 |

## 数据库模块 API

文件：`src/database/branch-db.js`

### Project 操作

```javascript
const { createProject, getProject, updateProjectName, listProjects } = require('./database/branch-db');

// 创建项目
const project = createProject(uuid(), 'My Project');

// 获取项目
const project = getProject(projectId);

// 更新项目名称
const success = updateProjectName(projectId, 'New Name');

// 列出所有项目
const projects = listProjects();
```

### Branch 操作

```javascript
const { createBranch, getBranch, listBranches, switchBranch, getActiveBranch, deleteBranch, renameBranch } = require('./database/branch-db');

// 创建分支
const branch = createBranch(uuid(), projectId, 'Branch A');

// 列出项目所有分支
const branches = listBranches(projectId);

// 切换激活分支
const success = switchBranch(branchId, projectId);

// 获取当前激活分支
const active = getActiveBranch(projectId);

// 重命名分支
const success = renameBranch(branchId, 'New Branch Name');

// 删除分支
const success = deleteBranch(branchId);
```

### Message 操作

```javascript
const { appendMessage, listMessages, getMessage, countMessages, deleteMessage, clearMessages } = require('./database/branch-db');

// 添加消息
const message = appendMessage(uuid(), branchId, 'user', 'Hello, how are you?');

// 添加带元数据的消息
const message = appendMessage(uuid(), branchId, 'assistant', 'I am fine!', {
  toolCalls: [{ name: 'search', args: {} }]
});

// 获取对话历史
const messages = listMessages(branchId, 100, 0);

// 获取消息数量
const count = countMessages(branchId);

// 清空分支消息
const deleted = clearMessages(branchId);
```

## 前端调用示例

### 通过 IPC 调用

```typescript
import { invoke } from '@electron/remote';

async function createBranch(projectId: string, name: string) {
  const result = await invoke('branch:create', { projectId, name });
  return result.data;
}

async function appendMessage(branchId: string, role: string, content: string) {
  const result = await invoke('message:append', { branchId, role, content });
  return result.data;
}

async function getConversation(branchId: string) {
  const result = await invoke('message:list', { branchId, limit: 50 });
  return result.data;
}
```

### 通过 MCP 工具调用

```typescript
// 通过 Copilot/Agent 调用 MCP 工具
const branch = await callMcpTool('branch_create', {
  projectId: 'project-uuid',
  name: 'Experiment A'
});

const messages = await callMcpTool('message_list', {
  branchId: 'branch-uuid',
  limit: 50
});

await callMcpTool('message_append', {
  branchId: 'branch-uuid',
  role: 'user',
  content: 'Analyze this single-cell data...'
});
```

## 约束与注意事项

1. **ID 生成**：使用 `crypto.randomUUID()` 生成 UUID v4
2. **时间戳**：使用 `Date.now()` 毫秒级时间戳
3. **元数据**：存储为 JSON 字符串，读取时需 `JSON.parse()`
4. **级联删除**：删除分支时自动删除其所有消息（ON DELETE CASCADE）
5. **唯一激活**：同一项目同时只能有一个 `is_active = 1` 的分支
6. **角色验证**：消息 role 只能是 'user' 或 'assistant'

---

# Result Studio

分析结果（Result）的持久化架构。**核心原则：Result 归属项目，不归属分支。**

## 架构原则

- 用户在 Branch A 分析 → 切换 Branch B → 结果保持不变
- 同一项目的所有分支共享同一份 Result
- Branch 只隔离对话历史（Messages），不隔离分析结果
- `source_branch_id` 仅用于追溯，不影响访问权限

## SQLite Schema

文件：`src/migrations/006_result_studio.sql`

### results 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| project_id | TEXT | NOT NULL, FK | 所属项目 ID |
| type | TEXT | NOT NULL, CHECK | 'chart' / 'table' / 'code' / 'text' / 'file' |
| name | TEXT | NOT NULL | 结果名称 |
| data | TEXT | NOT NULL | JSON 存储结果数据 |
| config | TEXT | (nullable) | 图表配置、渲染参数等 |
| source_branch_id | TEXT | (nullable) | 创建时所在的分支（仅用于追溯） |
| created_at | INTEGER | NOT NULL | 创建时间戳（ms） |
| updated_at | INTEGER | NOT NULL | 更新时间戳（ms） |

**索引**：
- `idx_results_project` ON (project_id)
- `idx_results_type` ON (project_id, type)
- `idx_results_created` ON (project_id, created_at DESC)

### result_tags 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| result_id | TEXT | NOT NULL, FK | 关联结果 ID |
| tag | TEXT | NOT NULL | 标签名 |
| UNIQUE | (result_id, tag) | | 同一结果的标签不重复 |

**索引**：
- `idx_result_tags_result` ON (result_id)

### result_versions 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| result_id | TEXT | NOT NULL, FK | 关联结果 ID |
| version | INTEGER | NOT NULL | 版本号（自增） |
| data | TEXT | NOT NULL | 版本数据快照 |
| created_at | INTEGER | NOT NULL | 创建时间戳（ms） |
| created_by_branch_id | TEXT | (nullable) | 创建时的分支（用于追溯） |

**索引**：
- `idx_result_versions_result` ON (result_id, version DESC)

## IPC 通道

文件：`src/ipc/result-handlers.js`

### Result 通道

| 通道名 | 参数 | 返回 |
|--------|------|------|
| `result:create` | `{ projectId, type, name, data, config?, sourceBranchId? }` | `{ ok, data }` |
| `result:get` | `{ id }` | `{ ok, data }` |
| `result:list` | `{ projectId, type?, tag?, limit?, offset? }` | `{ ok, data: [] }` |
| `result:update` | `{ id, updates: { name?, data?, config? } }` | `{ ok, data }` |
| `result:delete` | `{ id }` | `{ ok }` |
| `result:count` | `{ projectId, type? }` | `{ ok, data: number }` |

### Version 通道

| 通道名 | 参数 | 返回 |
|--------|------|------|
| `result:version:create` | `{ resultId, data, branchId? }` | `{ ok, data }` |
| `result:version:list` | `{ resultId }` | `{ ok, data: [] }` |
| `result:version:get` | `{ id }` | `{ ok, data }` |

### Tag 通道

| 通道名 | 参数 | 返回 |
|--------|------|------|
| `result:tag:add` | `{ resultId, tag }` | `{ ok, data }` |
| `result:tag:remove` | `{ resultId, tag }` | `{ ok, data }` |
| `result:tag:list` | `{ resultId }` | `{ ok, data: [] }` |

## 数据库模块 API

文件：`src/database/result-db.js`

### Result 操作

```javascript
const { createResult, getResult, listResults, updateResult, deleteResult, countResults } = require('./database/result-db');

// 创建结果
const result = createResult(uuid(), projectId, 'chart', 'PCA Visualization', chartData, config, branchId);

// 获取结果
const result = getResult(resultId);

// 列出项目所有结果（跨分支可见）
const results = listResults(projectId, { type: 'chart', limit: 20 });

// 更新结果
updateResult(resultId, { name: 'New Name', data: newData });

// 统计结果数量
const count = countResults(projectId, 'chart');

// 删除结果
deleteResult(resultId);
```

### Version 操作

```javascript
const { createVersion, listVersions, getVersion } = require('./database/result-db');

// 创建版本快照
const version = createVersion(uuid(), resultId, currentData, branchId);

// 列出所有版本（按版本号降序）
const versions = listVersions(resultId);

// 获取特定版本
const version = getVersion(versionId);
```

### Tag 操作

```javascript
const { addTag, removeTag, listTags } = require('./database/result-db');

// 添加标签
addTag(uuid(), resultId, 'significant');

// 列出结果标签
const tags = listTags(resultId);

// 移除标签
removeTag(resultId, 'significant');
```

## 前端调用示例

```typescript
import { invoke } from '@electron/remote';

// 创建 Result
const result = await invoke('result:create', {
  projectId,
  type: 'chart',
  name: 'PCA Visualization',
  data: chartData,
  sourceBranchId: currentBranchId,
});

// 列出项目所有结果（跨分支可见）
const results = await invoke('result:list', { projectId });

// 创建版本快照
const version = await invoke('result:version:create', {
  resultId: result.data.id,
  data: result.data.data,
  branchId: currentBranchId,
});
```

## 约束与注意事项

1. **Result 归属项目**：Result 的主键是 `project_id`，不是 `branch_id`
2. **source_branch_id 追溯性**：仅记录创建时的分支，不影响跨分支访问
3. **版本自增**：每个 Result 的版本号独立递增，从 1 开始
4. **标签唯一性**：同一 Result 的标签不能重复（UNIQUE 约束）
5. **级联删除**：删除 Result 时自动删除其所有标签和版本（ON DELETE CASCADE）
