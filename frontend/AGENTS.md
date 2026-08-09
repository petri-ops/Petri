# 前端专项指令

本目录下的文件结构、约定和开发规范。

## 目录结构

```
frontend/src/
├── pages/                    # 路由页面（每个 .tsx 是路由）
│   ├── single-cell/         # 单细胞分析模块
│   ├── spatial/             # 空间转录组模块
│   ├── figcode/             # 可交互图表模块
│   ├── admin/               # 管理面板
│   └── home.tsx            # 首页
├── components/              # React 组件
│   ├── copilot/            # AI Copilot 组件
│   ├── desktop/             # 桌面特有组件
│   ├── ui/                  # 通用 UI 组件
│   └── mdx/                 # MDX 组件
├── hooks/                   # 自定义 Hooks
├── lib/                     # 工具函数
│   ├── desktopBridge.ts    # IPC 通信桥接
│   ├── copilotContext.tsx  # Copilot Context
│   └── *.ts
├── styles/                  # 全局样式
└── themes/                  # 主题系统
```

## 路由约定

- `pages/*.tsx` — 路由页面（无需 `export default`）
- `pages/*/*.tsx` — 子路由模块
- 非路由组件放 `components/`

## 状态管理

### 允许的方式

- React `useState` + `useCallback`
- React Context（参考 `lib/copilotContext.tsx`）
- 自定义 store（如 `pages/single-cell/_store.ts`）

### 禁止的方式

- ❌ zustand
- ❌ jotai
- ❌ redux
- ❌ recoil
- ❌ mobx

## 常用 Hooks

| Hook | 用途 |
|------|------|
| `useBackendStatus` | 后端服务状态 |
| `useConversations` | 对话管理 |
| `useWorkspacePanels` | 工作区面板 |
| `useHarnessWorkflowStatus` | 工作流状态 |
| `useAiSettings` | AI 设置 |
| `useAutoUpdate` | 自动更新 |

## API 调用

- 使用 `lib/desktopBridge.ts` 进行 Electron IPC 调用
- 工具函数：`lib/authClient.ts` 处理认证

## 主题

- 主题系统：`themes/ThemeProvider.tsx`
- 终端主题：`themes/terminal-themes.ts`
- CSS 变量定义在 `styles/` 下

## 测试

- 框架：Vitest + @testing-library/react
- 测试文件：`*.test.ts` 或 `*.test.tsx`
- 默认**定向运行**改动相关的测试：`npm test --prefix frontend -- <文件名...>`
- 全量 `npm run test`（frontend 目录下）默认不跑，留给发布前或 CI
- strict build 门禁：`npm run build:check --prefix frontend`，涉及类型或组件改动时必跑
