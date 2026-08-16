# BioF3 IDE 改造计划

**文档状态**: 草稿  
**创建时间**: 2026-08-14  
**版本**: v0.1.0  
**Owner**: BioF3 Desktop Team  

---

## 目录

1. [概述与愿景](#1-概述与愿景)
2. [当前能力与差距分析](#2-当前能力与差距分析)
3. [架构设计](#3-架构设计)
4. [Phase 1: 快速见效增强](#4-phase-1-快速见效增强-2-3人周)
5. [Phase 2: 核心 IDE 功能](#5-phase-2-核心-ide-功能-8-12人周)
6. [Phase 3: 高级能力](#6-phase-3-高级能力-12-16人周)
7. [技术选型](#7-技术选型)
8. [风险评估与缓解](#8-风险评估与缓解)
9. [实施里程碑](#9-实施里程碑)
10. [验收标准](#10-验收标准)
11. [附录](#附录)

---

## 1. 概述与愿景

### 1.1 BioF3 IDE 定位

BioF3 IDE 是面向生信分析家的 **AI 增强开发环境**，深度整合全组学数据分析能力与现代化代码编辑体验。

**核心用户画像**：
- 生物信息学研究员和科学家
- 需要编写 R/Python 脚本进行数据分析
- 希望在同一环境中完成代码编写、执行和结果可视化
- 需要 AI 辅助进行代码生成和错误诊断

### 1.2 与 Cursor 的差异化策略

| 维度 | Cursor | BioF3 IDE |
|------|--------|-----------|
| **定位** | 通用代码编辑器 | 生信专用开发环境 |
| **AI 集成** | 第三方 AI API | 原生 BioF3 Copilot 深度集成 |
| **数据分析** | 需要外部终端 | 内置 R/Python 执行环境 |
| **生信工具链** | 无 | 原生支持 BWA、GATK、STAR 等 |
| **结果可视化** | 外部工具 | 内置交互式图表 |
| **文件关联** | 通用文件 | 项目-对话-结果三元组 |

**差异化策略**：
1. **垂直深耕**：不做通用 IDE，做生信领域最专业的开发工具
2. **AI First**：AI 不是插件，而是 IDE 的核心交互范式
3. **数据闭环**：代码编写 → 执行 → 可视化 → 对话记录 → 结果管理，全链路无缝衔接

### 1.3 核心价值主张

```
┌─────────────────────────────────────────────────────────────┐
│                    BioF3 IDE 核心价值                        │
├─────────────────────────────────────────────────────────────┤
│  🎯 领域专精    生信分析脚本一键执行，无需环境配置              │
│  🤖 AI 原生      AI 辅助编写、调试、可视化，全流程 AI 增强     │
│  📊 结果闭环     代码与结果关联，版本化存储，可追溯复现        │
│  🔗 Copilot 深度集成  对话上下文自动注入代码上下文            │
│  ⚡ 高效开发     Monaco Editor + 生信语法 + AI 补全           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 当前能力与差距分析

### 2.1 基于已有评估的能力矩阵

| 功能模块 | 当前状态 | 目标状态 | 差距 | 优先级 | 相关文件 |
|----------|----------|----------|------|--------|----------|
| **编辑器核心** |
| 代码高亮 | ✅ 已实现 (HighlightedCode) | 专业级语法高亮 | 缺少行号、折叠、minimap | P1 | `ui/CodeHighlight.tsx` |
| Monaco Editor | ❌ 未实现 | 完整 Monaco 集成 | 需要全新开发 | P0 | - |
| 多文件 Tab | ❌ 未实现 | Tab 系统 | 需从零开发 | P0 | - |
| **文件管理** |
| 文件资源管理器 | ✅ 基础实现 (LeftPanel) | VSCode 风格文件树 | 缺少目录折叠、图标、右键菜单 | P1 | `workspace-panels/LeftPanel.tsx` |
| 工作目录绑定 | ✅ 已实现 | 保持 | - | - | `project-workspace.tsx` |
| Git 状态显示 | ❌ 未实现 | Git 徽章 | 需要集成 Git 操作 | P1 | - |
| **终端** |
| 嵌入式终端 | ✅ 已实现 (BottomTerminal) | 多 Tab 终端 | 只有单会话 | P1 | `workspace-panels/BottomTerminal.tsx` |
| 终端主题 | ✅ 已实现 | 保持 + 优化 | - | - | `themes/terminal-themes.ts` |
| **AI 集成** |
| Copilot 聊天 | ✅ 已实现 (SimpleChat) | 保持 + 增强 | - | - | `copilot/SimpleChat.tsx` |
| 命令面板 | ✅ 基础实现 (CommandPalette) | 增强 | 快捷键绑定 | P2 | `copilot/CommandPalette.tsx` |
| AI 代码补全 | ❌ 未实现 | Inline Suggestion | 需要 LSP 集成 | P2 | - |
| **项目系统** |
| 项目管理 | ✅ 已实现 | 保持 | - | - | `lib/project-store.ts` |
| 对话管理 | ✅ 已实现 | 保持 | - | - | `copilot/conversations/` |
| 结果管理 | ✅ 已实现 (ResultStudio) | 保持 | - | - | `result-studio/` |
| **布局系统** |
| 三栏布局 | ✅ 已实现 | 保持 + 可调整 | - | - | `project-workspace.tsx` |
| 面板拖拽 | ✅ 基础实现 | 增强 | 缺少保存布局 | P2 | `hooks/useResizableColumns.ts` |
| 主题系统 | ✅ 已实现 | 保持 | - | - | `themes/ThemeProvider.tsx` |

### 2.2 关键差距详情

#### Gap 1: 缺少专业代码编辑器 (P0)
- **现状**: 使用 `highlight.js` 进行代码高亮，仅支持只读展示
- **目标**: Monaco Editor 支持完整编辑功能
- **影响**: 无法直接在 IDE 中编写和修改代码

#### Gap 2: 缺少 Tab 系统 (P0)
- **现状**: 每次只能查看一个文件
- **目标**: 支持多文件同时打开，Tab 切换
- **影响**: 无法同时对比多个文件

#### Gap 3: 文件浏览器功能不足 (P1)
- **现状**: 仅显示项目-对话层级，缺少真实文件系统视图
- **目标**: 目录树 + 文件图标 + 右键菜单 + Git 状态
- **影响**: 生信分析师无法直观浏览工作目录

#### Gap 4: 缺少 Git UI (P1)
- **现状**: 无 Git 面板
- **目标**: Status/Diff/Commit/Branch 完整面板
- **影响**: 无法在 IDE 内完成版本控制操作

#### Gap 5: 单终端会话 (P1)
- **现状**: 只有一个终端 Tab
- **目标**: 多 Tab 终端
- **影响**: 无法同时运行多个命令

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BioF3 IDE 架构                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Electron Shell (src/main.js)                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Window Manager          │  IPC Handler Hub     │  System Tray      │   │
│  │  • 多窗口管理             │  • file:open-path   │  • 菜单           │   │
│  │  • 面板布局持久化         │  • git:*             │  • Dock           │   │
│  │  • 快捷键注册             │  • search:*         │                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Renderer Process (React 18 + TypeScript)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         IDE Shell Layout                              │   │
│  │  ┌────────┬────────────────────────────────────────┬────────────┐   │   │
│  │  │Activity│              Editor Group               │  Sidebar   │   │   │
│  │  │  Bar   │  ┌──────────────────────────────────┐  │ (Optional) │   │   │
│  │  │        │  │  EditorTabBar (多文件 Tab)       │  │            │   │   │
│  │  │ 🔍     │  ├──────────────────────────────────┤  │ • Search   │   │   │
│  │  │ 📁     │  │                                   │  │ • Git      │   │   │
│  │  │ 🔀     │  │  Monaco Editor / Result Preview  │  │ • Extensions│   │   │
│  │  │ 📦     │  │                                   │  │            │   │   │
│  │  │ ⚙️     │  ├──────────────────────────────────┤  │            │   │   │
│  │  │        │  │  Bottom Panel (Terminal/Problems) │  │            │   │   │
│  │  └────────┴──┴──────────────────────────────────┴──┴────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Status Bar (Git branch / Encoding / Language / Position)             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│  MCP Tool Layer (src/mcp-server.js)                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  IDE Tools                    │  Bioinfo Tools                       │   │
│  │  ─────────                    │  ─────────────                       │   │
│  │  • file:read                  │  • bio:runscript                     │   │
│  │  • file:write                │  • bio:align                         │   │
│  │  • file:search               │  • bio:annotate                      │   │
│  │  • git:status                │  • bio:visualize                     │   │
│  │  • git:commit                │                                      │   │
│  │  • git:diff                  │                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Backend Services (core/r-server, core/py-server)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  R Runtime (renv)      │  Python Runtime (venv)   │  SQLite DB   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 新增组件清单

#### 3.2.1 IDE 核心组件 (frontend/src/components/ide/)

| 组件名称 | 路径 | 功能描述 | 依赖 | 优先级 |
|----------|------|----------|------|--------|
| `IDELayout` | `ide/IDELayout.tsx` | IDE 主布局容器，管理所有面板 | React | P0 |
| `ActivityBar` | `ide/ActivityBar.tsx` | 左侧活动栏（图标导航） | IDELayout | P0 |
| `EditorGroup` | `ide/EditorGroup.tsx` | 编辑器组，管理多个编辑器实例 | IDELayout, Monaco | P0 |
| `EditorTabBar` | `ide/EditorTabBar.tsx` | 多文件 Tab 栏 | EditorGroup | P0 |
| `EditorTab` | `ide/EditorTab.tsx` | 单个 Tab 组件 | EditorTabBar | P0 |
| `MonacoEditor` | `ide/MonacoEditor.tsx` | Monaco Editor 封装 | @monaco-editor/react | P0 |
| `FileExplorer` | `ide/FileExplorer.tsx` | 文件资源管理器 | IDELayout | P1 |
| `FileTree` | `ide/FileTree.tsx` | 目录树组件 | FileExplorer | P1 |
| `FileTreeItem` | `ide/FileTreeItem.tsx` | 单个文件/目录项 | FileTree | P1 |
| `TerminalPanel` | `ide/TerminalPanel.tsx` | 终端面板（多 Tab） | IDELayout | P1 |
| `TerminalTabBar` | `ide/TerminalTabBar.tsx` | 终端 Tab 栏 | TerminalPanel | P1 |
| `GitPanel` | `ide/GitPanel.tsx` | Git 状态面板 | IDELayout | P1 |
| `GitStatusView` | `ide/GitStatusView.tsx` | Git 变更列表 | GitPanel | P1 |
| `GitDiffView` | `ide/GitDiffView.tsx` | Diff 查看器 | GitPanel | P1 |
| `SearchPanel` | `ide/SearchPanel.tsx` | 搜索面板 | IDELayout | P1 |
| `SearchResults` | `ide/SearchResults.tsx` | 搜索结果列表 | SearchPanel | P1 |
| `StatusBar` | `ide/StatusBar.tsx` | 底部状态栏 | IDELayout | P1 |
| `ContextMenu` | `ide/ContextMenu.tsx` | 右键菜单组件 | - | P1 |
| `Minimap` | `ide/Minimap.tsx` | 代码缩略图 | MonacoEditor | P2 |
| `Breadcrumb` | `ide/Breadcrumb.tsx` | 路径面包屑 | FileExplorer | P2 |

#### 3.2.2 IDE Hooks (frontend/src/hooks/)

| Hook 名称 | 路径 | 功能描述 | 依赖 | 优先级 |
|-----------|------|----------|------|--------|
| `useEditorTabs` | `hooks/useEditorTabs.ts` | Tab 状态管理 | useState | P0 |
| `useFileTree` | `hooks/useFileTree.ts` | 文件树状态和操作 | IPC Bridge | P0 |
| `useMonaco` | `hooks/useMonaco.ts` | Monaco 实例管理 | @monaco-editor/react | P0 |
| `useTerminalTabs` | `hooks/useTerminalTabs.ts` | 终端 Tab 管理 | useTerminalSession | P1 |
| `useGitStatus` | `hooks/useGitStatus.ts` | Git 状态查询 | IPC Bridge | P1 |
| `useSearch` | `hooks/useSearch.ts` | 搜索功能 | IPC Bridge | P1 |
| `useKeyboardShortcuts` | `hooks/useKeyboardShortcuts.ts` | 快捷键管理 | - | P1 |
| `useEditorConfig` | `hooks/useEditorConfig.ts` | 编辑器配置管理 | localStorage | P1 |

#### 3.2.3 IDE Context (frontend/src/context/)

| Context 名称 | 路径 | 功能描述 | Provider |
|-------------|------|----------|----------|
| `IDEContext` | `context/IDEContext.tsx` | IDE 全局状态 | IDEContextProvider |

### 3.3 需要修改的现有文件

#### 3.3.1 路由与布局

| 文件 | 修改内容 | 风险 |
|------|----------|------|
| `frontend/src/App.tsx` | 添加 IDE 路由 `/ide/:projectId?` | 低 - 仅添加路由 |
| `frontend/src/pages/project-workspace.tsx` | 重构为使用新 IDELayout 或共存 | 高 - 核心布局文件 |

#### 3.3.2 现有组件增强

| 文件 | 修改内容 | 风险 |
|------|----------|------|
| `frontend/src/components/workspace-panels/LeftPanel.tsx` | 增强为可选的文件浏览器模式 | 中 - 已有组件 |
| `frontend/src/components/workspace-panels/BottomTerminal.tsx` | 支持多 Tab | 中 - 扩展现有组件 |
| `frontend/src/components/ui/CodeHighlight.tsx` | 保留作为轻量替代 | 低 - 无破坏性变更 |

#### 3.3.3 Electron IPC 扩展

| 文件 | 新增 IPC | 说明 |
|------|----------|------|
| `src/main.js` | `file:read`, `file:write`, `file:list`, `file:stat` | 文件操作 |
| `src/main.js` | `git:status`, `git:commit`, `git:diff`, `git:log` | Git 操作 |
| `src/main.js` | `search:files`, `search:content` | 搜索功能 |

#### 3.3.4 MCP 工具扩展

| 文件 | 新增工具 | 说明 |
|------|----------|------|
| `src/mcp-server.js` | `ide_file_read` | IDE 读取文件 |
| `src/mcp-server.js` | `ide_file_write` | IDE 写入文件 |
| `src/mcp-server.js` | `ide_search` | IDE 搜索 |
| `src/mcp-server.js` | `ide_git_status` | Git 状态 |

---

## 4. Phase 1: 快速见效增强 (2-3人周)

**目标**: 在最短时间内提供可用的 IDE 雏形，让用户可以直观感受到价值

### 4.1 Monaco Editor 只读模式

#### 目标
替代当前的 `HighlightedCode`，实现更专业的代码高亮展示

#### 实现方式

```typescript
// frontend/src/components/ide/MonacoEditor.tsx
import Editor, { type OnMount } from '@monaco-editor/react';

interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

// 1. 安装依赖
// npm install @monaco-editor/react monaco-editor

// 2. 配置生信语言支持
const BIOLANGUAGE_CONFIG = {
  id: 'r',
  extensions: ['.r', '.R'],
  aliases: ['R', 'r'],
  loader: () => import('monaco-editor/esm/vs/basic-languages/r/r.js')
};
```

#### 验收标准

| 标准 | 描述 | 测试方式 |
|------|------|----------|
| 渲染性能 | 1000 行代码 < 100ms | Chrome DevTools |
| 语言支持 | R, Python, JavaScript 语法高亮 | 手动测试 |
| 只读模式 | 无法编辑但可选择复制 | 交互测试 |
| 主题适配 | 跟随应用主题 (亮/暗) | 主题切换测试 |

### 4.2 多文件 Tab 系统

#### 目标
支持多文件同时打开，Tab 切换

#### 实现方式

```typescript
// frontend/src/components/ide/EditorTabBar.tsx
interface EditorTab {
  id: string;
  path: string;
  name: string;
  language?: string;
  content?: string;
  isDirty: boolean;
}

interface EditorTabBarProps {
  tabs: EditorTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReorderTabs: (from: number, to: number) => void;
}
```

#### 文件操作

| 操作 | 快捷键 | 实现方式 |
|------|--------|----------|
| 新建 Tab | `Ctrl/Cmd + T` | 打开文件选择器 |
| 关闭 Tab | `Ctrl/Cmd + W` | 关闭当前 Tab |
| 切换 Tab | `Ctrl/Cmd + Tab` | 循环切换 |
| 关闭其他 | `Ctrl/Cmd + K W` | 关闭除当前外的所有 |

#### 验收标准

| 标准 | 描述 |
|------|------|
| Tab 显示 | 正确显示文件名和状态图标 |
| 切换 | 点击/快捷键切换正确 |
| 关闭 | 关闭后自动切换到相邻 Tab |
| 拖拽排序 | 拖拽后 Tab 顺序正确 |
| 状态持久化 | 刷新后 Tab 状态恢复 |

### 4.3 增强文件资源管理器

#### 目标
更接近 IDE 的文件浏览体验

#### 实现方式

```typescript
// frontend/src/components/ide/FileTree.tsx
interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children?: FileNode[];
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked';
}

// 功能清单
// 1. 目录树折叠/展开（已有基础）
// 2. 文件图标（基于扩展名）
// 3. 右键菜单（新建/重命名/删除）
// 4. Git 状态徽章
// 5. 搜索过滤
// 6. 拖拽移动
```

#### 右键菜单设计

```
┌─────────────────────┐
│ 📄 新建文件          │
│ 📁 新建文件夹        │
├─────────────────────┤
│ ✏️ 重命名            │
│ 🗑️ 删除              │
│ 📋 复制路径          │
├─────────────────────┤
│ 🔍 在文件中查找      │
│ 📝 用...打开         │
└─────────────────────┘
```

#### 验收标准

| 标准 | 描述 |
|------|------|
| 目录显示 | 正确显示嵌套结构 |
| 折叠展开 | 点击箭头正确响应 |
| 文件图标 | 常见扩展名有对应图标 |
| 右键菜单 | 所有操作正确执行 |
| Git 徽章 | 显示正确的 Git 状态 |

### 4.4 终端多 Tab

#### 目标
支持多个终端会话

#### 实现方式

```typescript
// frontend/src/components/ide/TerminalPanel.tsx
interface TerminalTab {
  id: string;
  title: string;
  session: TerminalSession;
}

// 复用现有 useTerminalSession，扩展为多实例管理
// frontend/src/hooks/useTerminalTabs.ts
```

#### 验收标准

| 标准 | 描述 |
|------|------|
| 多 Tab | 正确创建和切换 |
| 新建关闭 | 操作正确响应 |
| 标题更新 | 显示当前目录 |
| 会话隔离 | 各 Tab 独立运行 |

### 4.5 Phase 1 交付清单

| 组件 | 文件 | 优先级 |
|------|------|--------|
| Monaco Editor 只读 | `ide/MonacoEditor.tsx` | P0 |
| Editor Tab Bar | `ide/EditorTabBar.tsx` | P0 |
| Editor Tab | `ide/EditorTab.tsx` | P0 |
| File Explorer | `ide/FileExplorer.tsx` | P1 |
| File Tree | `ide/FileTree.tsx` | P1 |
| File Tree Item | `ide/FileTreeItem.tsx` | P1 |
| Terminal Tab Bar | `ide/TerminalTabBar.tsx` | P1 |
| IDE Layout | `ide/IDELayout.tsx` | P0 |
| Activity Bar | `ide/ActivityBar.tsx` | P1 |

---

## 5. Phase 2: 核心 IDE 功能 (8-12人周)

### 5.1 Monaco Editor 完整编辑

#### 5.1.1 文件读写

```typescript
// IPC 定义
interface FileReadRequest {
  path: string;
  encoding?: 'utf-8' | 'base64';
}

interface FileWriteRequest {
  path: string;
  content: string;
  create?: boolean;
  overwrite?: boolean;
}
```

#### 5.1.2 自动保存

```typescript
// 自动保存策略
const AUTO_SAVE_CONFIG = {
  delay: 1000, // 停止输入后 1 秒
  enabled: true,
  backup: true, // 保存到 .backup 目录
};
```

#### 5.1.3 代码补全

```typescript
// 使用 Monaco 内置补全 + 自定义生信词库
const BIO_COMPLETIONS = [
  // R 包
  { label: 'library(dplyr)', kind: 'module', insertText: 'library(\${1:dplyr})' },
  { label: '%>%', kind: 'operator', insertText: '%>%' },
  // Python 生信库
  { label: 'import scanpy', kind: 'module', insertText: 'import scanpy as sc' },
  { label: 'adata = sc.AnnData', kind: 'function', insertText: 'adata = sc.AnnData(\${1:X})' },
];
```

#### 5.1.4 验收标准

| 标准 | 描述 |
|------|------|
| 文件打开 | < 200ms (1MB 以内) |
| 文件保存 | < 500ms |
| 自动保存 | 无数据丢失 |
| 语法检查 | ESLint/ESR 集成 |
| 代码补全 | 响应 < 100ms |

### 5.2 Git 完整面板

#### 5.2.1 Git Status 面板

```typescript
// frontend/src/components/ide/GitStatusView.tsx
interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
}
```

#### 5.2.2 Diff View

```typescript
// frontend/src/components/ide/GitDiffView.tsx
interface DiffViewProps {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}
```

#### 5.2.3 Commit 界面

```
┌────────────────────────────────────────────────────────────┐
│  Commit Changes                                    [×]     │
├────────────────────────────────────────────────────────────┤
│  Message:                                                 │
│  ┌────────────────────────────────────────────────────┐   │
│  │ [TICKET-123] Add differential expression analysis  │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  Changes (3 files):                                       │
│  ☑ analysis/de_analysis.R                                 │
│  ☑ scripts/visualize.R                                   │
│  ☐ README.md                                             │
│                                                            │
│  [Cancel]                    [Commit (3)]                 │
└────────────────────────────────────────────────────────────┘
```

#### 5.2.4 Branch Selector

```
┌─────────────────────────────────────┐
│  main                    [▼]       │
├─────────────────────────────────────┤
│  🔵 main                        ✓   │
│  🔵 feature/de-analysis             │
│  🔵 hotfix/bug-123                 │
├─────────────────────────────────────┤
│  + Create new branch...             │
└─────────────────────────────────────┘
```

### 5.3 代码搜索与替换

#### 5.3.1 文件内搜索

| 功能 | 快捷键 |
|------|--------|
| 打开搜索 | `Ctrl/Cmd + F` |
| 下一个匹配 | `F3` / `Enter` |
| 上一个匹配 | `Shift + F3` / `Shift + Enter` |
| 替换 | `Ctrl/Cmd + H` |
| 全部替换 | `Ctrl/Cmd + Shift + H` |
| 关闭 | `Escape` |

#### 5.3.2 项目级搜索

| 功能 | 快捷键 |
|------|--------|
| 打开搜索 | `Ctrl/Cmd + Shift + F` |
| 搜索框 | 支持正则表达式 |
| 过滤器 | 文件类型、目录排除 |
| 搜索结果 | 按文件分组，高亮显示 |

#### 5.3.3 搜索结果高亮

```typescript
// Monaco 配置
editor.setModelMarkers(model, 'search', [
  {
    startLineNumber: line,
    endLineNumber: line,
    startColumn: startColumn,
    endColumn: endColumn,
    message: 'Search match',
    severity: MarkerSeverity.Hint,
  }
]);
```

### 5.4 快捷键系统

#### 5.4.1 核心快捷键

| 类别 | 操作 | 快捷键 |
|------|------|--------|
| **文件** |
| | 新建文件 | `Ctrl/Cmd + N` |
| | 打开文件 | `Ctrl/Cmd + O` |
| | 保存 | `Ctrl/Cmd + S` |
| | 全部保存 | `Ctrl/Cmd + Shift + S` |
| | 关闭 | `Ctrl/Cmd + W` |
| **编辑** |
| | 撤销 | `Ctrl/Cmd + Z` |
| | 重做 | `Ctrl/Cmd + Shift + Z` |
| | 剪切 | `Ctrl/Cmd + X` |
| | 复制 | `Ctrl/Cmd + C` |
| | 粘贴 | `Ctrl/Cmd + V` |
| | 全选 | `Ctrl/Cmd + A` |
| | 查找 | `Ctrl/Cmd + F` |
| | 替换 | `Ctrl/Cmd + H` |
| **视图** |
| | 切换侧栏 | `Ctrl/Cmd + B` |
| | 切换终端 | `` Ctrl/Cmd + ` `` |
| | 全屏 | `F11` |
| **导航** |
| | 快速打开 | `Ctrl/Cmd + P` |
| | 命令面板 | `Ctrl/Cmd + Shift + P` |
| | 跳转到行 | `Ctrl/Cmd + G` |

#### 5.4.2 自定义快捷键配置

```typescript
// 支持用户自定义
interface KeyboardShortcut {
  id: string;
  key: string;
  when?: string; // 上下文条件
  command: string;
}

const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  { id: 'file.save', key: 'cmd+s', command: 'file.save' },
  { id: 'file.new', key: 'cmd+n', command: 'file.new' },
];
```

### 5.5 Phase 2 交付清单

| 组件 | 文件 | 优先级 |
|------|------|--------|
| Monaco 完整编辑 | `ide/MonacoEditor.tsx` (增强) | P0 |
| Git Status View | `ide/GitStatusView.tsx` | P0 |
| Git Diff View | `ide/GitDiffView.tsx` | P0 |
| Git Commit Dialog | `ide/GitCommitDialog.tsx` | P1 |
| Git Branch Selector | `ide/GitBranchSelector.tsx` | P1 |
| Search Panel | `ide/SearchPanel.tsx` | P1 |
| Search Results | `ide/SearchResults.tsx` | P1 |
| Replace Dialog | `ide/ReplaceDialog.tsx` | P2 |
| Keyboard Shortcuts | `hooks/useKeyboardShortcuts.ts` | P1 |
| Quick Open | `ide/QuickOpen.tsx` | P2 |

---

## 6. Phase 3: 高级能力 (12-16人周)

### 6.1 调试器集成

#### 6.1.1 Chrome DevTools Protocol

```typescript
// 使用 Electron 内置 CDP
import { session } from 'electron';

// 为每个终端会话创建调试目标
const createDebugTarget = async (sessionId: string) => {
  const debugSession = session.fromPartition(`debug:${sessionId}`);
  return debugSession;
};
```

#### 6.1.2 断点管理

```typescript
interface Breakpoint {
  id: string;
  file: string;
  line: number;
  enabled: boolean;
  condition?: string;
  logMessage?: string;
}

// Monaco 断点集成
monaco.editor.setBreakpoints(breakpoints);
```

#### 6.1.3 变量监视

```
┌────────────────────────────────────────┐
│  WATCH                          [+]    │
├────────────────────────────────────────┤
│  ▶ data                          {...} │
│  ▶ df                            {...} │
│  ▶ result                        [1,2] │
└────────────────────────────────────────┘
```

#### 6.1.4 调用栈

```
┌────────────────────────────────────────┐
│  CALL STACK                            │
├────────────────────────────────────────┤
│  ▶ analyze_DE()        line 42         │
│    process_samples()   line 128        │
│    main()              line 5         │
└────────────────────────────────────────┘
```

### 6.2 AI 代码补全

#### 6.2.1 Inline Suggestion

```typescript
// Ghost Text 展示
interface InlineSuggestion {
  text: string;
  range: IRange;
  state: 'loading' | 'showing' | 'accepted' | 'dismissed';
}

// 使用 Copilot API
const getInlineSuggestion = async (context: string) => {
  const response = await copilotClient.getCompletion({
    prompt: context,
    maxTokens: 50,
    stream: true,
  });
  return response;
};
```

#### 6.2.2 交互模式

| 操作 | 行为 |
|------|------|
| `Tab` | 接受建议 |
| `Escape` | 关闭建议 |
| `Ctrl/Cmd + →` | 逐词接受 |
| 继续输入 | 自动关闭 |

### 6.3 LSP 支持

#### 6.3.1 语言服务器协议

```typescript
// LSP 客户端封装
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

const rLanguageServer = new LanguageClient(
  'r-language-server',
  'R Language Server',
  {
    run: { command: 'r-languageserver', args: [] },
    debug: { command: 'r-languageserver', args: [] }
  },
  {
    documentSelector: [{ scheme: 'file', language: 'r' }],
    synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.R') }
  }
);
```

#### 6.3.2 LSP 功能

| 功能 | 说明 |
|------|------|
| 跳转到定义 | `F12` 或 `Ctrl/Cmd + Click` |
| 查找引用 | `Shift + F12` |
| 重命名符号 | `F2` |
| 悬停文档 | `Ctrl/Cmd + K Ctrl/Cmd + I` |
| 代码补全 | 更智能的上下文感知补全 |
| 诊断信息 | 语法/语义错误显示 |

#### 6.3.3 支持的语言服务器

| 语言 | LSP 服务器 | 状态 |
|------|-----------|------|
| R | languageserver | 计划 |
| Python | Jedi/pylance | 计划 |
| JavaScript/TypeScript | 内置 Monaco | 已支持 |

---

## 7. 技术选型

### 7.1 核心依赖

| 组件 | 选型 | 版本 | 备选 | 理由 |
|------|------|------|------|------|
| **代码编辑器** |
| Monaco Editor | `@monaco-editor/react` | ^4.6.0 | CodeMirror 6 | Monaco 功能更完整，与 VS Code 一致，用户迁移成本低 |
| Monaco Workers | 内置 | - | - | 语法高亮、类型检查 Web Worker |
| **Git 操作** |
| Git CLI | `simple-git` | ^3.x | isomorphic-git | API 简洁，直接调用系统 Git，支持复杂操作 |
| Diff 展示 | `@monaco-editor/react` 内置 | - | diff2html | Monaco Diff Editor 功能完善 |
| **调试协议** |
| Chrome DevTools | Electron 内置 CDP | - | VSCode Debug Adapter | Electron 生态原生支持 |
| **文件树** |
| 虚拟化 | `@tanstack/react-virtual` | ^3.x | react-virtualized | 轻量、Tree 支持好 |
| 文件图标 | `vscode-icons` | ^4.x | file-icons | VSCode 同款，生态丰富 |

### 7.2 辅助工具

| 工具 | 用途 | 说明 |
|------|------|------|
| `glob` | 文件搜索 | 目录遍历 |
| `chokidar` | 文件监听 | 外部文件变更通知 |
| `electron-store` | 配置持久化 | 用户设置、快捷键配置 |
| `electron-log` | 日志系统 | 调试和问题排查 |

### 7.3 性能优化策略

```typescript
// 1. Monaco 按需加载
const MonacoEditor = lazy(() => import('@monaco-editor/react'));

// 2. 大文件延迟加载
const shouldLoadContent = (size: number) => size < 1 * 1024 * 1024; // 1MB

// 3. 文件树虚拟化
const virtualizer = useVirtualizer({
  count: fileNodes.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 24,
  overscan: 10,
});
```

---

## 8. 风险评估与缓解

### 8.1 风险矩阵

| 风险 | 等级 | 概率 | 影响 | 缓解方案 |
|------|------|------|------|----------|
| **Monaco 内存占用** | 🟡 中 | 高 | 中 | 按需加载、Web Worker、虚拟化渲染 |
| **Git 大仓库卡顿** | 🟡 中 | 中 | 中 | Web Worker 后台执行、增量加载、缓存 |
| **扩展 API 设计** | 🟡 中 | 中 | 中 | VSCode 兼容层、先固定后扩展 |
| **调试器集成复杂度** | 🔴 高 | 低 | 高 | Chrome DevTools 集成降低复杂度 |
| **多 Tab 内存泄漏** | 🟡 中 | 中 | 中 | Tab 懒加载、不活动时释放 |
| **Electron 版本升级** | 🟢 低 | 低 | 中 | 锁定版本、渐进升级 |
| **与现有布局冲突** | 🟡 中 | 中 | 中 | 共存模式逐步迁移 |

### 8.2 详细缓解措施

#### 风险 1: Monaco 内存占用

```typescript
// 缓解措施
const MONACO_CONFIG = {
  // 只加载需要的语言
  languages: ['javascript', 'typescript', 'python', 'r', 'json', 'markdown'],
  // 使用 Web Worker
  workerConfig: { 
    'editor.worker': true,
    'json.worker': true,
    'css.worker': true,
    'html.worker': true,
    'typescript.worker': true,
  },
  // 内存限制
  maxMemory: 512 * 1024 * 1024, // 512MB
};
```

#### 风险 2: Git 大仓库卡顿

```typescript
// 缓解措施
// 1. 限制显示的变更文件数
const MAX_STATUS_FILES = 1000;

// 2. 后台执行
const gitStatus = await runInBackground(() => simpleGit.cwd(dir).status());

// 3. 增量更新
const diff = await git.diff(['--stat', '-n', '100']);

// 4. 缓存
const gitStatusCache = new Map();
```

#### 风险 3: 调试器集成

```typescript
// 缓解：使用 Electron 内置 CDP
// 避免自己实现复杂的 Debug Adapter Protocol

// 终端调试使用已有 xterm.js
// R/Python 调试考虑集成 RStudio 的 radian 或 ipython --debug
```

---

## 9. 实施里程碑

### 9.1 总体时间线

```
Week 1-3  ┌──────────────────┐
          │    Phase 1       │
          │  快速见效增强     │
          │  Monaco 只读     │
          │  Tab 系统        │
          │  文件浏览器增强   │
          │  终端多 Tab      │
          └────────┬─────────┘
                   │
Week 4-12 ┌────────▼─────────┐
          │    Phase 2       │
          │  核心 IDE 功能    │
          │  完整编辑        │
          │  Git UI         │
          │  搜索系统        │
          │  快捷键系统      │
          └────────┬─────────┘
                   │
Week 13-24┌────────▼─────────┐
          │    Phase 3       │
          │  高级能力        │
          │  调试器          │
          │  AI 补全         │
          │  LSP 支持        │
          └──────────────────┘
```

### 9.2 Phase 1 详细计划

| 周 | 任务 | 交付物 | 责任人 |
|----|------|--------|--------|
| Week 1 | Monaco 集成 + 只读模式 | `MonacoEditor.tsx` | TBD |
| Week 1 | Tab 系统基础 | `EditorTabBar.tsx`, `useEditorTabs.ts` | TBD |
| Week 2 | 文件浏览器增强 | `FileExplorer.tsx`, `FileTree.tsx` | TBD |
| Week 2 | 右键菜单 + 文件操作 | `ContextMenu.tsx` | TBD |
| Week 3 | 终端多 Tab | `TerminalPanel.tsx`, `useTerminalTabs.ts` | TBD |
| Week 3 | 集成测试 + 验收 | Phase 1 可演示版本 | TBD |

### 9.3 Phase 2 详细计划

| 周 | 任务 | 交付物 |
|----|------|--------|
| Week 4-5 | Monaco 完整编辑 | 文件读写、自动保存 |
| Week 5-6 | Git Status + Diff | `GitStatusView.tsx`, `GitDiffView.tsx` |
| Week 7 | Git Commit + Branch | `GitCommitDialog.tsx`, `GitBranchSelector.tsx` |
| Week 8-9 | 搜索系统 | `SearchPanel.tsx`, `SearchResults.tsx` |
| Week 10-11 | 快捷键系统 | `useKeyboardShortcuts.ts`, 配置面板 |
| Week 12 | 集成测试 + 验收 | Phase 2 可演示版本 |

### 9.4 Phase 3 详细计划

| 周 | 任务 | 交付物 |
|----|------|--------|
| Week 13-15 | 调试器集成 | 断点、变量监视、调用栈 |
| Week 16-18 | AI 代码补全 | Ghost Text、Inline Suggestion |
| Week 19-21 | LSP 支持 | R/Python 语言服务器 |
| Week 22-24 | 性能优化 + 验收 | Phase 3 版本 |

---

## 10. 验收标准

### 10.1 Phase 1 验收标准

#### 功能验收

| 功能 | 验收条件 | 测试方法 |
|------|----------|----------|
| Monaco 只读显示 | R/Python/JS 文件正确高亮 | 手动测试 10+ 文件 |
| Tab 切换 | 点击/快捷键切换正确 | 交互测试 |
| Tab 关闭 | 关闭后自动切换相邻 Tab | 交互测试 |
| Tab 拖拽排序 | 拖拽后顺序正确 | 拖拽测试 |
| 文件树显示 | 目录结构正确 | 手动测试 |
| 文件树展开折叠 | 正确响应 | 交互测试 |
| 右键菜单 | 所有操作正确执行 | 交互测试 |
| 终端多 Tab | 可创建/切换/关闭 | 交互测试 |

#### 性能基准

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 页面加载 | < 3s | Chrome DevTools |
| Monaco 渲染 (1000行) | < 100ms | Performance API |
| Tab 切换响应 | < 50ms | Performance API |
| 文件树 (1000文件) | < 500ms | Performance API |

#### 用户体验标准

| 标准 | 描述 |
|------|------|
| 快捷键 | VSCode 风格，学习成本低 |
| 视觉一致性 | 与现有 UI 风格统一 |
| 错误处理 | 所有错误有友好提示 |

### 10.2 Phase 2 验收标准

#### 功能验收

| 功能 | 验收条件 |
|------|----------|
| 文件保存 | Ctrl+S 保存成功，< 500ms |
| 自动保存 | 停止输入 1s 后自动保存 |
| Git Status | 正确显示所有变更文件 |
| Git Diff | 正确显示行级差异 |
| Git Commit | 可提交变更，消息正确 |
| Git Branch | 可切换、创建、删除分支 |
| 搜索 | Ctrl+Shift+F 打开搜索 |
| 搜索结果 | 高亮显示，支持正则 |
| 快捷键 | 所有定义快捷键正确工作 |

#### 性能基准

| 指标 | 目标 |
|------|------|
| 大文件 (10MB) 打开 | < 2s |
| Git Status (1000 文件) | < 1s |
| 搜索 (100 文件) | < 500ms |
| 编辑器输入延迟 | < 16ms (60fps) |

### 10.3 Phase 3 验收标准

#### 功能验收

| 功能 | 验收条件 |
|------|----------|
| 断点设置 | 可在 Monaco 行号区域设置断点 |
| 断点命中 | 运行时代码停在断点处 |
| 变量监视 | 可查看和添加监视变量 |
| AI 补全 | 显示 inline suggestion |
| AI 接受 | Tab 接受 suggestion |
| LSP 跳转 | F12 跳转到定义 |

#### 性能基准

| 指标 | 目标 |
|------|------|
| 调试启动 | < 2s |
| AI 补全响应 | < 300ms |
| LSP 跳转 | < 200ms |

---

## 附录

### A. 文件变更清单

#### A.1 新增文件

```
frontend/src/components/ide/
├── IDELayout.tsx
├── IDELayout.module.css
├── ActivityBar.tsx
├── EditorGroup.tsx
├── EditorTabBar.tsx
├── EditorTab.tsx
├── MonacoEditor.tsx
├── FileExplorer.tsx
├── FileTree.tsx
├── FileTreeItem.tsx
├── TerminalPanel.tsx
├── TerminalTabBar.tsx
├── GitPanel.tsx
├── GitStatusView.tsx
├── GitDiffView.tsx
├── GitCommitDialog.tsx
├── GitBranchSelector.tsx
├── SearchPanel.tsx
├── SearchResults.tsx
├── ReplaceDialog.tsx
├── StatusBar.tsx
├── ContextMenu.tsx
├── QuickOpen.tsx
├── Minimap.tsx
└── Breadcrumb.tsx

frontend/src/hooks/
├── useEditorTabs.ts
├── useFileTree.ts
├── useMonaco.ts
├── useTerminalTabs.ts
├── useGitStatus.ts
├── useSearch.ts
├── useKeyboardShortcuts.ts
└── useEditorConfig.ts

frontend/src/context/
├── IDEContext.tsx
└── IDEContextProvider.tsx

frontend/src/components/ide/index.ts
```

#### A.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/App.tsx` | 添加 IDE 路由 |
| `frontend/src/pages/project-workspace.tsx` | 重构或共存模式 |
| `frontend/src/components/workspace-panels/LeftPanel.tsx` | 增强为可选文件浏览器 |
| `frontend/src/components/workspace-panels/BottomTerminal.tsx` | 支持多 Tab |
| `src/main.js` | 添加 IDE IPC handlers |
| `src/mcp-server.js` | 添加 IDE MCP tools |
| `frontend/package.json` | 添加 @monaco-editor/react 依赖 |

### B. API 扩展设计

#### B.1 Electron IPC (main.js)

```javascript
// 文件操作
ipcMain.handle('file:read', async (event, { path, encoding }) => {...})
ipcMain.handle('file:write', async (event, { path, content }) => {...})
ipcMain.handle('file:list', async (event, { dirPath }) => {...})
ipcMain.handle('file:stat', async (event, { path }) => {...})
ipcMain.handle('file:create', async (event, { path, isDirectory }) => {...})
ipcMain.handle('file:delete', async (event, { path }) => {...})
ipcMain.handle('file:rename', async (event, { oldPath, newPath }) => {...})
ipcMain.handle('file:move', async (event, { source, target }) => {...})

// Git 操作
ipcMain.handle('git:status', async (event, { repoPath }) => {...})
ipcMain.handle('git:diff', async (event, { repoPath, filePath }) => {...})
ipcMain.handle('git:commit', async (event, { repoPath, message }) => {...})
ipcMain.handle('git:log', async (event, { repoPath, count }) => {...})
ipcMain.handle('git:branch:list', async (event, { repoPath }) => {...})
ipcMain.handle('git:branch:create', async (event, { repoPath, name }) => {...})
ipcMain.handle('git:branch:delete', async (event, { repoPath, name }) => {...})
ipcMain.handle('git:checkout', async (event, { repoPath, ref }) => {...})

// 搜索
ipcMain.handle('search:files', async (event, { dirPath, pattern }) => {...})
ipcMain.handle('search:content', async (event, { dirPath, query, options }) => {...})
```

#### B.2 MCP 工具 (mcp-server.js)

```javascript
// IDE 相关工具
const IDE_TOOLS = [
  {
    name: 'ide_file_read',
    description: 'Read file content in IDE',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      }
    }
  },
  {
    name: 'ide_file_write',
    description: 'Write content to file in IDE',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      }
    }
  },
  {
    name: 'ide_search',
    description: 'Search in project files',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        options: { type: 'object' }
      }
    }
  },
  {
    name: 'ide_git_status',
    description: 'Get Git status in IDE',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string' }
      }
    }
  }
];
```

### C. 参考资料

#### C.1 Monaco Editor

- [Monaco Editor 官方文档](https://microsoft.github.io/monaco-editor/)
- [Monaco Editor React 封装](https://github.com/suren-atoyan/monaco-react)
- [Monaco Editor 主题配置](https://microsoft.github.io/monaco-editor/manual/theming.html)

#### C.2 VSCode 扩展开发

- [VSCode 扩展开发指南](https://code.visualstudio.com/api)
- [VSCode 快捷键绑定](https://code.visualstudio.com/api/references/keybindings)
- [VSCode Theme 制作](https://code.visualstudio.com/api/extension-guides/command#using-a-custom-when-clause-context)

#### C.3 Electron + React 最佳实践

- [Electron IPC 最佳实践](https://www.electronjs.org/docs/latest/ipc/)
- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
- [React + Electron 架构](https://www.electronjs.org/docs/latest/tutorial/process-model)

#### C.4 Git 操作

- [simple-git 文档](https://github.com/steveukx/git-js)
- [Git diff 格式规范](https://git-scm.com/docs/diff-format)

#### C.5 语言服务器协议

- [LSP 规范](https://microsoft.github.io/language-server-protocol/)
- [vscode-languageclient](https://www.npmjs.com/package/vscode-languageclient)

---

## 文档版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1.0 | 2026-08-14 | BioF3 Team | 初始版本 |
