# BioF3 Desktop IDE MCP 工具设计文档

> **文档状态**: 草稿 v0.1  
> **创建日期**: 2026-08-14  
> **目标**: 为 AI Copilot 提供 IDE 操作能力，实现文件管理、编辑器控制、搜索、Git 操作和终端管理

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [当前架构分析](#2-当前架构分析)
3. [工具设计](#3-工具设计)
4. [IPC 通信设计](#4-ipc-通信设计)
5. [MCP 工具注册](#5-mcp-工具注册)
6. [安全考虑](#6-安全考虑)
7. [实施计划](#7-实施计划)
8. [附录：类型定义](#8-附录类型定义)

---

## 1. 背景与目标

### 1.1 需求背景

BioF3 Desktop 作为全组学学习与实战平台，其 AI Copilot 需要具备操作 IDE 的能力。

### 1.2 设计目标

| 目标 | 描述 |
|------|------|
| **功能完整性** | 覆盖文件操作、编辑器、搜索、Git、终端五大场景 |
| **安全可控** | 路径验证、操作审计、用户确认机制 |
| **性能优先** | 异步执行、按需加载、增量更新 |
| **可扩展性** | 模块化设计，便于添加新工具 |

### 1.3 约束条件

- 前端使用 React 18 + TypeScript strict 模式
- Electron IPC 通过 `preload.js` 的 `contextBridge` 暴露
- MCP 工具注册遵循 `core/r-server/mcp/registry.js` 的 `listTools()` / `callTool()` 接口
- 状态管理：React useState + 自定义 hooks，禁止 zustand

---

## 2. 当前架构分析

### 2.1 现有架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Copilot (前端)                        │
│  frontend/src/components/copilot/                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    preload.js (contextBridge)                    │
│  window.biof3Desktop = {                                        │
│    files, terminal, plugins, runtime, backend, window, ...       │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      src/main.js (主进程)                       │
│  setupFileDialogIpc(), setupTerminalIpc(), setupPluginIpc()     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              src/mcp-server.js (MCP stdio server)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│            core/r-server/mcp/registry.js (工具注册表)             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 现有 IPC 通道

| 通道 | 功能 | 状态 |
|------|------|------|
| `file:save-dialog` | 保存文件对话框 | 已实现 |
| `file:open-dialog` | 打开文件对话框 | 已实现 |
| `file:open-path` | 系统打开文件 | 已实现 |
| `terminal:session-start` | 启动 PTY 会话 | 已实现 |
| `terminal:session-write` | 写入终端 | 已实现 |

---

## 3. 工具设计

### 3.1 文件操作工具组 (P0)

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `ide_file_read` | 读取文件内容 | path, encoding?, maxSize? |
| `ide_file_write` | 写入文件内容 | path, content, encoding?, mode? |
| `ide_file_create` | 创建新文件 | path, content?, template? |
| `ide_file_delete` | 删除文件 | path, recursive?, confirm? |
| `ide_file_rename` | 重命名/移动文件 | oldPath, newPath, overwrite? |
| `ide_file_exists` | 检查文件是否存在 | path |
| `ide_file_list` | 列出目录内容 | path, recursive?, filter?, maxFiles? |

### 3.2 编辑器操作工具组 (P0)

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `ide_editor_open` | 在编辑器中打开文件 | path, line?, column? |
| `ide_editor_close` | 关闭编辑器中的文件 | path?, force? |
| `ide_editor_get_open_files` | 获取打开的文件列表 | - |
| `ide_editor_set_active_file` | 设置当前活动文件 | path |
| `ide_editor_get_selection` | 获取当前选中文本 | path? |
| `ide_editor_set_selection` | 设置选中文本 | path, start, end? |

### 3.3 搜索工具组 (P1)

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `ide_search_in_files` | 全文搜索 | pattern, options? |
| `ide_search_symbols` | 搜索符号定义 | query, options? |
| `ide_goto_definition` | 跳转到符号定义 | path, line, column |

### 3.4 Git 操作工具组 (P2)

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `ide_git_status` | 获取工作区状态 | path? |
| `ide_git_diff` | 获取 diff 内容 | path?, staged?, options? |
| `ide_git_log` | 获取提交历史 | path?, limit?, options? |
| `ide_git_branch_list` | 列出分支 | path?, all? |

### 3.5 终端操作工具组 (P0)

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `ide_terminal_create` | 创建新终端会话 | name?, cwd?, shell? |
| `ide_terminal_write` | 向终端写入命令 | sessionId, command |
| `ide_terminal_read` | 读取终端输出 | sessionId, since? |
| `ide_terminal_close` | 关闭终端会话 | sessionId |
| `ide_terminal_list` | 列出所有会话 | - |

---

## 4. IPC 通信设计

### 4.1 通道命名规范

```
ide:file:read              ide:file:write            ide:file:create
ide:file:delete            ide:file:rename            ide:file:exists
ide:file:list              ide:editor:open            ide:editor:close
ide:editor:get-open-files  ide:editor:set-active-file ide:editor:get-selection
ide:editor:set-selection   ide:search:files           ide:search:symbols
ide:search:goto-definition ide:git:status            ide:git:diff
ide:git:log                ide:git:branch-list        ide:terminal:create
ide:terminal:write         ide:terminal:read         ide:terminal:close
ide:terminal:list
```

### 4.2 preload.js 扩展

```javascript
contextBridge.exposeInMainWorld('biof3Desktop', {
  // ... 现有接口 ...

  // IDE 工具
  ide: {
    file: {
      read: (path, options) => ipcRenderer.invoke('ide:file:read', path, options),
      write: (path, content, options) => ipcRenderer.invoke('ide:file:write', path, content, options),
      create: (path, options) => ipcRenderer.invoke('ide:file:create', path, options),
      delete: (path, options) => ipcRenderer.invoke('ide:file:delete', path, options),
      rename: (oldPath, newPath, options) => ipcRenderer.invoke('ide:file:rename', oldPath, newPath, options),
      exists: (path) => ipcRenderer.invoke('ide:file:exists', path),
      list: (path, options) => ipcRenderer.invoke('ide:file:list', path, options),
    },
    editor: {
      open: (path, options) => ipcRenderer.invoke('ide:editor:open', path, options),
      close: (path, options) => ipcRenderer.invoke('ide:editor:close', path, options),
      getOpenFiles: () => ipcRenderer.invoke('ide:editor:get-open-files'),
      setActiveFile: (path) => ipcRenderer.invoke('ide:editor:set-active-file', path),
      getSelection: (path) => ipcRenderer.invoke('ide:editor:get-selection', path),
      setSelection: (path, selection) => ipcRenderer.invoke('ide:editor:set-selection', path, selection),
      onFileOpened: (callback) => { /* ... */ },
      onFileClosed: (callback) => { /* ... */ },
      onSelectionChanged: (callback) => { /* ... */ },
    },
    search: {
      inFiles: (pattern, options) => ipcRenderer.invoke('ide:search:files', pattern, options),
      symbols: (query, options) => ipcRenderer.invoke('ide:search:symbols', query, options),
      gotoDefinition: (path, line, column) => ipcRenderer.invoke('ide:search:goto-definition', path, line, column),
    },
    git: {
      status: (path) => ipcRenderer.invoke('ide:git:status', path),
      diff: (path, staged, options) => ipcRenderer.invoke('ide:git:diff', path, staged, options),
      log: (path, options) => ipcRenderer.invoke('ide:git:log', path, options),
      branchList: (path, all) => ipcRenderer.invoke('ide:git:branch-list', path, all),
    },
    terminal: {
      create: (options) => ipcRenderer.invoke('ide:terminal:create', options),
      write: (sessionId, command) => ipcRenderer.invoke('ide:terminal:write', sessionId, command),
      read: (sessionId, since) => ipcRenderer.invoke('ide:terminal:read', sessionId, since),
      close: (sessionId) => ipcRenderer.invoke('ide:terminal:close', sessionId),
      list: () => ipcRenderer.invoke('ide:terminal:list'),
      onData: (callback) => { /* ... */ },
      onExit: (callback) => { /* ... */ },
    },
  },
});
```

---

## 5. MCP 工具注册

### 5.1 工具定义格式

```javascript
// src/ide-tools-registry.js
const ideTools = [
  {
    name: 'ide_file_read',
    description: '读取文件内容，支持文本和二进制',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
        encoding: { type: 'string', enum: ['utf8', 'base64', 'hex'], default: 'utf8' },
        maxSize: { type: 'number', default: 1048576 },
      },
      required: ['path'],
    },
  },
  // ... 其他工具定义
];
```

### 5.2 注册到 MCP Registry

```javascript
// core/r-server/mcp/registry.js
const pluginLoader = require('../plugin-loader');
const ideTools = require('../../../src/ide-tools-registry');

async function listTools() {
  const pluginTools = await pluginLoader.listToolsForMCP();
  return [...pluginTools, ...ideTools];
}

async function callTool(name, args, opts) {
  const ideTool = ideTools.find(t => t.name === name);
  if (ideTool) {
    return executeIdeTool(name, args);
  }
  // ... 回退到插件工具
}
```

---

## 6. 安全考虑

### 6.1 路径安全

| 风险 | 缓解措施 |
|------|----------|
| 目录遍历 | 使用 `path.normalize()` 并检查 `..` |
| 符号链接攻击 | 使用 `fs.realpathSync()` 解析真实路径 |
| 路径穿越 | 验证路径在允许范围内 |

### 6.2 操作审计

所有 IDE 操作记录到审计日志：
```javascript
{
  timestamp: '2026-08-14T12:00:00.000Z',
  tool: 'ide_file_write',
  args: { path: '/project/src/main.js' },
  userId: 'user_123',
  result: 'success',
  duration: 50,
}
```

### 6.3 用户确认机制

| 操作 | 风险等级 | 确认要求 |
|------|----------|----------|
| 文件删除 | 高 | 始终确认 |
| 文件覆盖 | 中 | 覆盖时确认 |
| 批量操作 | 中 | 超过 5 个文件时确认 |
| Git 危险操作 | 高 | 删除分支等确认 |

### 6.4 速率限制

| 操作 | 限制 |
|------|------|
| 文件读写 | 无限制 |
| 搜索 | 10 次/分钟 |
| Git 操作 | 20 次/分钟 |
| 终端写入 | 100 次/分钟 |

---

## 7. 实施计划

### 7.1 实施优先级

| 阶段 | 工具组 | 优先级 | 工作量 | 依赖 |
|------|--------|--------|--------|------|
| Phase 1 | 文件操作 (P0) | P0 | 中 | 现有文件 IPC |
| Phase 1 | 终端操作 (P0) | P0 | 低 | 已有 PTY |
| Phase 2 | 编辑器操作 (P0) | P0 | 中 | Monaco 集成 |
| Phase 2 | 搜索 (P1) | P1 | 高 | 文件索引 |
| Phase 3 | Git 操作 (P2) | P2 | 中 | simple-git |

### 7.2 Phase 1: 基础能力 (1-2 周)

| 任务 | 文件 | 描述 |
|------|------|------|
| T1.1 | `src/preload.js` | 扩展 IDE 文件/终端 bridge |
| T1.2 | `src/main.js` | 实现 `ide:file:*` IPC 处理器 |
| T1.3 | `src/ide-tools-registry.js` | 定义 IDE MCP 工具 |
| T1.4 | `core/r-server/mcp/registry.js` | 注册 IDE 工具 |
| T1.5 | `frontend/src/lib/electron.d.ts` | 添加 TypeScript 类型 |

### 7.3 Phase 2: 编辑器与搜索 (2-3 周)

| 任务 | 文件 | 描述 |
|------|------|------|
| T2.1 | `frontend/src/components/editor/` | Monaco 编辑器组件增强 |
| T2.2 | `src/main.js` | `ide:editor:*` IPC 处理器 |
| T2.3 | `src/ide-search-indexer.js` | 文件索引服务 |
| T2.4 | `src/main.js` | `ide:search:*` IPC 处理器 |

### 7.4 Phase 3: Git 集成 (1-2 周)

| 任务 | 文件 | 描述 |
|------|------|------|
| T3.1 | `package.json` | 添加 simple-git 依赖 |
| T3.2 | `src/ide-git-adapter.js` | Git 操作适配器 |
| T3.3 | `src/main.js` | `ide:git:*` IPC 处理器 |

### 7.5 验收标准

| 阶段 | 验收条件 |
|------|----------|
| Phase 1 | 文件读写测试通过、终端创建/写入/读取/关闭测试通过、MCP 工具列表包含所有 IDE 工具 |
| Phase 2 | 编辑器打开/关闭文件正常、全文搜索结果准确、符号搜索返回正确结果 |
| Phase 3 | Git status/diff/log/branch-list 功能正常、无安全漏洞 |

---

## 8. 附录：类型定义

### 8.1 通用类型

```typescript
interface Position {
  line: number;
  column: number;
}

interface FileInfo {
  name: string;
  path: string;
  relativePath: string;
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
  extension?: string;
}

interface SearchMatch {
  file: string;
  line: number;
  column: number;
  context: string;
  lineContent: string;
}

interface SymbolResult {
  name: string;
  kind: string;
  path: string;
  location: Position;
  containerName?: string;
  signature?: string;
}

interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  isClean: boolean;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  refs: string;
}

interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

interface TerminalSession {
  sessionId: string;
  name: string;
  pid: number;
  cwd: string;
  isActive: boolean;
  isRunning: boolean;
  startedAt: number;
}
```

---

## 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-08-14 | AI Agent | 初始版本 |

---

*文档生成：BioF3 Desktop IDE MCP Tools Design*
