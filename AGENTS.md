# BioF3 Desktop 项目指令

本文件指导 AI Agent 理解和处理 BioF3 桌面版项目。

## 项目定位

BioF3 Desktop = Electron 桌面应用 + Vite SPA 前端 + MCP Server
本地化 AI 陪伴的全组学学习与实战平台

## 技术栈

| 层级 | 技术 | 入口文件 |
|------|------|----------|
| 桌面壳 | Electron | `src/main.js` |
| 前端 | React 18 + Vite + TypeScript | `frontend/src/` |
| 工具 | MCP Server | `src/mcp-server.js` |
| 数据库 | better-sqlite3 | `src/` |

## 开发命令

```bash
# Electron 开发
npm run dev          # 启动 Electron (npm run dev:electron)
npm run dev:electron # 带 --dev 标志

# 前端开发
cd frontend && npm run dev   # Vite dev server (:3000)
cd frontend && npm run build # 构建 SPA

# 全量构建
npm run build:all    # SPA + 站点
npm run build:mac    # macOS 构建
npm run build:win    # Windows 构建

# 检查
npm run check        # 静态检查 + 依赖同步
npm run test         # Node 测试
npm run test --prefix frontend  # 前端测试
```

## 架构要点

### 目录结构

```
desktop/
├── src/                    # Electron 主进程
│   ├── main.js            # 主进程入口 (61KB)
│   ├── preload.js         # 预加载脚本
│   ├── plugin-manager.js  # 插件管理器 (47KB)
│   └── mcp-server.js      # MCP 服务端
├── frontend/src/           # 渲染进程
│   ├── pages/            # 路由页面
│   │   ├── single-cell/  # 单细胞分析
│   │   ├── spatial/       # 空间转录组
│   │   ├── figcode/       # 可交互图表
│   │   └── admin/         # 管理面板
│   ├── components/       # React 组件
│   │   ├── copilot/       # AI Copilot
│   │   ├── desktop/       # 桌面特有
│   │   └── ui/            # 通用 UI
│   ├── hooks/             # React Hooks
│   ├── lib/               # 工具函数
│   │   └── desktopBridge.ts  # IPC 桥接
│   └── themes/            # 主题系统
├── test/                   # Electron 测试
└── core/                   # 核心后端（仓库内，已内联；r-server/py-server/shared-backend）
```

> 架构去耦（2026-07）：core 已从 vendor submodule 内联；OSS/PostgreSQL/docker 双模式已移除，
> 现为「本地文件存储 + SQLite + 内嵌运行时本地执行」。详见 `docs/dependency-decoupling-checkpoint.md`。

### 关键规范

1. **前端使用 TypeScript strict 模式**
2. **Electron IPC 调用必须通过 `lib/desktopBridge.ts`**
3. **MCP 工具在 `src/mcp-server.js` 注册**
4. **状态管理：React useState + 自定义 hooks，禁止使用 zustand**
5. **路由页面在 `pages/` 下，非页面组件用 `_` 前缀**

## AI 行为指引

### 修改大型文件前

- `main.js` (61KB) — 先理解 Electron 进程模型和 window 管理
- `plugin-manager.js` (47KB) — 理解插件生命周期

### 新增功能检查清单

- [ ] 前端路由/页面 → 在 `frontend/src/pages/` 下创建
- [ ] Electron IPC → 通过 `preload.js` 暴露接口
- [ ] MCP 工具 → 更新 `src/mcp-server.js` 的 tool definitions
- [ ] 类型定义 → 在 `frontend/src/` 下创建 `*.types.ts`
- [ ] 测试 → 在 `frontend/src/` 同目录创建 `*.test.ts`

### 代码风格

- 组件：函数式 + 命名导出
- 样式：CSS Modules 或 `*.module.css`
- 工具函数：`lib/` 下按功能分组

## 相关文档

- `frontend/src/lib/desktopBridge.ts` — IPC 通信封装
- `src/mcp-server.js` — MCP 工具定义
- `frontend/src/App.tsx` — 应用入口
