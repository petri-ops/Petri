# Backend Gateway 架构设计

## 概述

Backend Gateway 是 Petri Desktop 后端架构的统一入口层，协调 R Server (3003)、Python Server (3004) 和其他后端服务，提供单一入口点进行工具发现、健康检查和执行路由。

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         BackendStatusProvider (Gateway Health)       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │ IPC Bridge
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Backend Gateway (Port 3002)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Tool Registry                      │   │
│  │   - R Tools    - Python Tools   - Built-in Tools   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Routes:                                                    │
│  - GET  /health          → 聚合健康检查                     │
│  - GET  /api/tools       → 列出所有工具                     │
│  - GET  /api/tools/:id   → 工具详情                         │
│  - POST /api/execute     → 执行工具（自动路由）             │
│  - GET  /api/services    → 服务状态列表                     │
│  - /r-server/*           → 代理到 R Server                  │
│  - /py-server/*         → 代理到 Python Server             │
└────────────────┬──────────────────────┬─────────────────────┘
                 │                      │
                 ▼                      ▼
┌───────────────────────┐    ┌───────────────────────────┐
│   R Server (3003)     │    │   Python Server (3004)    │
│                       │    │                           │
│  - MCP Registry       │    │  - Tool Router            │
│  - Plugin Tools       │    │  - Python Pool            │
│  - AI Bridge          │    │  - Raw Execution          │
└───────────────────────┘    └───────────────────────────┘
```

## Phase 1: 统一工具注册表 (tool-registry.js)

### 位置
`core/shared-backend/tool-registry.js`

### ToolEntry 接口

```typescript
interface ToolEntry {
  id: string;                    // 工具唯一标识
  name: string;                  // 工具显示名称
  language: 'r' | 'python' | 'builtin';
  endpoint: string;              // 执行端点
  metadata: {
    description: string;         // 工具描述
    inputSchema: object;        // 输入参数 schema
    outputSchema: object;       // 输出 schema
  }
}
```

### 注册表 API

| 函数 | 描述 |
|------|------|
| `registerTool(tool)` | 注册工具 |
| `getTool(id)` | 获取工具详情 |
| `listTools(filter?)` | 列出工具（可选 language 过滤） |
| `getToolsByLanguage(language)` | 按语言筛选 |
| `getRTools()` | 获取 R 工具 |
| `getPythonTools()` | 获取 Python 工具 |
| `getBuiltinTools()` | 获取内置工具 |
| `migrateFromRServerRegistry()` | 从 R Server 迁移工具 |
| `getStats()` | 获取统计信息 |

### 内置工具

注册表预置了以下内置工具：

| ID | 名称 | 语言 | 描述 |
|----|------|------|------|
| `volcano-plot` | Volcano Plot | R | 火山图可视化 |
| `heatmap-basic` | Basic Heatmap | R | 热图可视化 |
| `go-enrichment` | GO Enrichment | R | GO 富集分析 |

## Phase 2: Gateway 服务 (gateway/)

### 目录结构

```
core/gateway/
├── server.js       # Express 服务主入口
├── agent.js       # Gateway Agent 封装
├── index.js       # 模块导出
├── package.json   # 依赖声明
└── .env.example   # 环境变量示例
```

### 服务配置

| 环境变量 | 默认值 | 描述 |
|----------|--------|------|
| `GATEWAY_PORT` | 3002 | Gateway 监听端口 |
| `R_SERVER_URL` | http://127.0.0.1:3003 | R Server 地址 |
| `PY_SERVER_URL` | http://127.0.0.1:3004 | Python Server 地址 |
| `GATEWAY_TIMEOUT` | 300000 | 请求超时 (5min) |

### API 端点

#### 健康检查

```
GET /health
```

响应：
```json
{
  "gateway": true,
  "timestamp": "2026-08-14T08:50:00.000Z",
  "uptime": 3600,
  "services": {
    "rServer": { "status": "healthy" },
    "pyServer": { "status": "healthy" },
    "database": { "status": "healthy" }
  },
  "tools": {
    "total": 15,
    "byLanguage": { "r": 10, "python": 3, "builtin": 3 }
  }
}
```

#### 工具列表

```
GET /api/tools?language=r
```

#### 工具执行

```
POST /api/execute
Content-Type: application/json

{
  "toolId": "volcano-plot",
  "params": {
    "deg_table": "/path/to/degs.csv",
    "pvalue": 0.05,
    "logfc": 1
  }
}
```

### 断路器模式

Agent 实现断路器模式防止级联故障：

- 连续 5 次失败后断开
- 60 秒后自动重置
- 可通过 `resetCircuitBreaker()` 手动重置

## Phase 3: 前端适配

### 新增文件

| 文件 | 描述 |
|------|------|
| `frontend/src/lib/gateway-client.ts` | Gateway 客户端封装 |

### 增强 BackendStatusProvider

添加 Gateway 健康状态到后端状态感知层。

## 验收标准

### Phase 1 验收

```bash
node -e "const tr = require('./core/shared-backend/tool-registry'); console.log(tr.listTools())"
```

### Phase 2 验收

```bash
curl http://localhost:3002/health
```

### Phase 3 验收

- 前端能通过 Gateway 调用工具
- BackendStatusProvider 显示 Gateway 状态

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-08-14 | 1.0.0 | 初始实现：tool-registry + gateway + 前端适配 |
