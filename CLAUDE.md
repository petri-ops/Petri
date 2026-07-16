# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

BioF3 Desktop 是一个 Electron 桌面应用，结合了 AI 陪伴的全组学学习与实战平台。技术栈包括：
- **桌面壳**: Electron 30.5.1
- **前端**: React 18 + Vite + TypeScript (严格模式)
- **后端**: Node.js + better-sqlite3（纯本地：本地文件存储 + SQLite + 内嵌 R/Python 本地执行）
- **核心库**: `core/`（仓库内，已内联；不再是 git submodule）

> **架构去耦（2026-07）**：核心后端已从 `vendor/biof3-core` submodule 内联为 `core/`；OSS 存储、PostgreSQL、docker 执行三条 web/ECS 双模式分支已全部移除。详见 `docs/dependency-decoupling-checkpoint.md`。凡本文与该检查点冲突，以检查点为准。

## 当前开发阶段

当前处于 **Stage 1: UI 产品化验收与收口阶段**。已有 UI 实现不得重新从头审查；先用 Git 提交证据与 `docs/ui-productization-audit.md` 对账，只补缺失的定向实机验收。

固定执行顺序：
1. Stage 1: 桌面 UI 产品化（当前）
2. Stage 2: 模型层与多 Provider（等待 Stage 1 验收）
3. Stage 3: Harness 与标准流程扩展（等待 Stage 2 验收）
4. Stage 4: 首个稳定产品版本

**重要限制**：
- Stage 1 验收前不实现新模型 Provider
- Stage 2 验收前不扩充 Harness 内容
- 当前只做 UI 产品化和视觉一致性修复

### UI 台账同步铁律

- `docs/ui-productization-audit.md` 是验收状态的唯一事实源；Git 提交是实现证据，二者必须在同一个 UI 增量中同步。
- 修改 UI 表面（`frontend/src/components/`、`pages/`、`styles/`、`themes/` 等）时，同一提交必须更新 UI 台账，并在提交标题或正文写明对应的 `UI-###`。
- 代码完成只能把问题推进到 `in_progress`；只有附有实机主题、窗口和交互证据后才能标为 `verified`。
- 开始新一轮 UI 工作前先运行 `npm run ui:audit:check`，优先复用已有提交证据，不重复审查已经实现或验证的项目。
- 根 `npm run check` 已包含 UI 台账同步门禁；遗漏台账或问题编号会直接失败。

## 必读文档顺序

开始任何任务前，按顺序阅读：
1. `docs/v1-productization-roadmap.md` — 唯一阶段路线图
2. `docs/project-workspace-handoff.md` — 当前工程检查点
3. `docs/ui-productization-audit.md` — Stage 1 执行台账
4. `docs/development-module-map.md` — 模块责任边界 (W/P/C)
5. `docs/codex-style-workbench-direction.md` — UI 产品方向
6. `docs/dependency-decoupling-checkpoint.md` — 去 vendor 化 + web 冗余清理检查点（架构现状 + 下阶段清理建议）

`docs/archive/` 只用于追溯历史，不决定当前优先级。

## 常用命令

### 开发

```bash
# 前端开发
cd frontend && npm run dev              # Vite dev server (:3000)
cd frontend && npm run build            # 构建 SPA

# Electron 开发
npm run dev                             # 启动 Vite(:3000) + Electron + 自动重载
npm run dev:electron                    # 带 --dev 标志的 Electron

# 检查
npm run check                           # 静态语法 + Harness manifest + UI 台账同步校验
npm run ui:audit:check                  # 单独检查 UI 实现/台账是否同步
npm --prefix frontend run check         # TypeScript 类型检查
npm test                                # 根项目测试
npm test --prefix frontend              # 前端测试
```

### 构建与发布

```bash
# macOS 构建（当前唯一支持平台）
npm run build:mac                       # 完整构建 (arm64 + x64)
npm run build:mac-arm64                 # arm64 only
npm run build:mac-x64                   # x64 only

# Windows 构建（已配置但非当前发布目标）
npm run build:win                       # Windows x64

# Harness 相关
npm run harness:check                   # 校验 manifest 结构
npm run harness:phase6                  # Harness Phase 6 回归测试
npm run harness:agent-evaluate          # Agent workflow 完整测试
```

### 发布流程

```bash
npm run release:mac:prepare             # 准备 macOS 发布（不上传）
npm run release:mac:oss                 # 发布到阿里云 OSS
npm run release:mac:oss:dry-run         # 干运行，不实际上传
```

## 核心架构

### 目录结构

```
desktop/
├── src/                           # Electron 主进程
│   ├── main.js                   # 主进程入口 (61KB)
│   ├── preload.js                # 预加载脚本 + IPC 暴露
│   ├── plugin-manager.js         # 插件管理器 (55KB)
│   ├── mcp-server.js             # MCP 服务端
│   └── macos-oss-updater.js      # macOS 自动更新
├── frontend/src/                  # React 前端
│   ├── App.tsx                   # 应用入口
│   ├── components/
│   │   ├── desktop/              # 桌面特有组件（TitleBar, Toolbar）
│   │   ├── workspace-panels/     # 工作台面板（Left/Right/Bottom）
│   │   ├── copilot/              # AI Copilot 组件
│   │   └── ui/                   # 通用 UI 组件
│   ├── pages/
│   │   ├── project-workspace.tsx # 项目工作台（三栏布局）
│   │   ├── _desktop-dashboard.tsx # 桌面首页
│   │   ├── single-cell/          # 单细胞分析
│   │   ├── spatial/              # 空间转录组
│   │   └── figcode/              # 可交互图表
│   ├── hooks/                    # React Hooks
│   ├── lib/
│   │   └── desktopBridge.ts      # IPC 通信桥接（必经）
│   ├── themes/                   # 主题系统
│   └── styles/                   # 全局样式
├── core/                          # 核心后端库（仓库内，已内联）
│   ├── r-server/                 # R 分析服务 + 路由 + Copilot/Agent
│   ├── py-server/                # Python 分析服务
│   ├── shared-backend/           # 共享后端逻辑（executors, storage, execution-context）
│   ├── packages/                 # shared-copilot 等共享包
│   └── test/                     # Core 测试
├── resources/
│   └── built-in-plugins/         # 内置插件
├── scripts/                       # 构建和工具脚本
│   ├── harness-file-index.mjs    # Harness 文件索引
│   ├── scaffold-harness-tool.mjs # 插件脚手架
│   └── publish-macos-oss.mjs     # macOS 更新发布（唯一用 ali-oss 的地方）
└── test/                         # Electron 和集成测试
```

### 模块地图 (W/P/C)

#### 产品工作台模块 (W)

- **W-01 桌面壳层**: TitleBar, DesktopToolbar, 窗口控制, Electron 桥接
- **W-02 工作台布局**: 三栏面板、拖拽调宽、折叠、全高布局
- **W-03 Agent 会话**: 消息气泡、流式回复、工具确认卡、会话切换
- **W-04 结果与报告**: Artifact 导航、图表/表格预览、报告生成
- **W-05 内置浏览器**: 地址栏、前进/后退、WebView 生命周期
- **W-06 项目资源与文件**: 文件树、文本/图片/CSV/PDF 预览
- **W-07 集成终端**: 终端会话、xterm 渲染、shell 选择
- **W-08 专业功能页面**: `/tools`, `/single-cell`, `/spatial`, `/figcode`, `/admin`

#### 平台与分析模块 (P)

- **P-01 项目与上下文**: project, conversation, dataset, workspace scope
- **P-02 执行真相**: `run_tool → tool_job → artifact truth` 唯一执行链
- **P-03 Harness 工作流**: `inspect → infer → select → repair → confirm → run → verify → report`
- **P-04 Plugin SDK**: plugin.json, tool-definition.json, 输入/输出 schema
- **P-05 Runtime 适配**: R/Python/Node 内嵌 runtime，只有本地执行且无模式开关；canonical context 抽象保留
- **P-06 桌面集成**: Electron 主进程、IPC、构建、macOS 打包、OSS 更新
- **P-07 模型网关**: Model Profile, Provider 注册, 流式响应, tool calling

#### 跨模块关注点 (C)

- **C-01 主题与视觉**: 明/暗主题、颜色、边框、圆角统一
- **C-02 布局与响应式**: 全高、宽度、拖拽、折叠、overflow
- **C-03 安全与确认**: 重计算、删除、恢复动作确认
- **C-04 状态同步**: 聊天、结果、浏览器跨面板联动
- **C-05 测试与质量**: 类型检查、构建、单元测试、Harness fixture
- **C-06 性能与交互**: 拖拽丝滑、流式渲染、避免阻塞主线程

### 任务标注格式

每个任务必须标注主模块和跨模块关注点：

```
[W-05 内置浏览器] WebView 在右栏只能显示上半段
关注点：C-02 布局与响应式、C-01 主题与视觉系统
影响模块：W-02 工作台布局
验收：展开/收起、明/暗主题、不同右栏宽度下均全高显示
```

## 工作台信息架构

遵循 Codex 式三栏布局原则（学习交互，不做像素级复制）：

- **左侧**: 项目列表、当前项目信息、数据集、文件入口、项目切换
- **中间**: Agent 主舞台，用户输入、理解计划、参数确认、执行进度、结果卡片
- **右侧**: Artifacts 查看器，文件树、分析结果图、表格预览、日志、下载

右侧与聊天强联动：点击聊天结果卡片打开右侧对应 artifact；右侧当前结果反向注入 Agent 上下文。

## 核心不变量

1. **唯一执行事实链**: `run_tool → tool_job → artifact truth`
   - 禁止建立第二套 executor、job 状态表或结果真相系统
   - UI 不得制造第二套状态真相

2. **Harness Phase 1–6 已完成**: Stage 1–2 只保持回归，不扩充内容

3. **核心后端在仓库内 `core/`**:
   - 已去 vendor 化，无 git submodule / `.vendor-lock` / `sync-vendor.sh`
   - 改核心后端直接改 `core/`，随 Desktop 一起提交
   - 单一后端形态：本地文件存储 + SQLite + 内嵌运行时本地执行；不要重新引入 OSS / PostgreSQL / docker 双模式

4. **macOS-only 发布**: 当前版本 `v0.0.1-rc.4` 只支持 macOS arm64/x64

## 关键代码规范

### TypeScript 和 React

- 前端使用 TypeScript strict 模式
- 组件: 函数式 + 命名导出
- 样式: CSS Modules (`*.module.css`)
- 状态管理: React useState + 自定义 hooks，**禁止使用 zustand**
- 路由页面在 `pages/` 下，非页面组件用 `_` 前缀

### Electron IPC

- **所有 IPC 调用必须通过 `frontend/src/lib/desktopBridge.ts`**
- `preload.js` 暴露的接口必须在 `desktopBridge.ts` 中定义类型
- 不得在组件中直接使用 `window.electron`

### 插件系统

- 新插件使用 `npm run harness:scaffold` 生成脚手架
- 插件 manifest: `plugin.json` + `tool-definition.json`
- 内置插件在 `resources/built-in-plugins/`
- 插件必须声明: id, name, version, input/output schema, failureModes

### 核心后端（core/）

- 核心后端逻辑在仓库内 `core/`（`r-server` / `py-server` / `shared-backend` / `packages`）。
- 已内联，无 submodule；改核心直接改 `core/`，随 Desktop 一起提交，无需 vendor 同步。

## 验证门禁

根据改动风险选择：

```bash
# 类型检查（前端改动必须）
npm --prefix frontend run check

# 前端测试
npm test --prefix frontend

# 前端构建（UI 改动建议）
npm --prefix frontend run build

# 根项目检查（Electron/Core 改动必须）
npm run check

# 根项目测试
npm test

# Harness 回归（P-03/P-04 改动必须）
npm run harness:phase6
npm run harness:agent-evaluate
```

## 调试和诊断

### 开发模式

- 前端开发服务器: `http://localhost:3000`
- R 服务健康检查: `:3001/api/health`
- Python 服务健康检查: `:3004/api/health`
- 静态资源服务: `:3002`

### 日志位置

- Electron 主进程日志: Console (npm run dev 输出)
- 渲染进程日志: DevTools Console (Cmd+Option+I)
- R 服务日志: `~/Library/Application Support/BioF3/logs/`
- Python 服务日志: `~/Library/Application Support/BioF3/logs/`

### 常见问题

- **前端类型错误**: 运行 `npm --prefix frontend run check`
- **Harness manifest 无效**: 运行 `npm run harness:check`
- **Electron 窗口无法打开**: 检查 `src/main.js` 和 DevTools Console

## macOS 发布流程

当前版本使用 OSS 托管 DMG 和 `latest-mac.yml`，不使用 Apple Developer ID 签名。

### 发布准备

1. 确保 `.biof3-secrets` 存在且权限为 `600`（包含 OSS 凭据）
2. 更新 `package.json` 版本号
3. 提交并打标签: `git tag v0.0.1-rc.X`

### 发布执行

```bash
# 准备构建（不上传）
npm run release:mac:prepare

# 上传到 OSS（实际发布）
npm run release:mac:oss

# 干运行（测试流程）
npm run release:mac:oss:dry-run
```

### 更新流程

- 检查 OSS `latest-mac.yml` 获取最新版本
- 下载匹配架构 DMG
- 校验大小和 SHA-512
- 打开 DMG，手动拖入 Applications

详见 `docs/macos-oss-auto-update.md`。

## 禁止事项

- **不要**在 Stage 1 实现新模型 Provider
- **不要**在 Stage 2 前扩充 Harness 内容
- **不要**建立第二套 executor、job 状态表或结果真相系统
- **不要**在前端发明新流程状态（消费现有 Agent/job 状态）
- **不要**把 `docs/archive/` 中的历史任务当成当前优先级
- **不要**覆盖用户未提交改动或随手 reset 子模块
- **不要**在组件中直接使用 `window.electron`（必须通过 `desktopBridge.ts`）
- **不要**使用 zustand 进行状态管理

## 提交信息规范

使用 Conventional Commits 格式，可以使用中文或英文：

```
feat(browser): add forward/back navigation
fix(workspace): fill right panel height
docs(modules): define stable development boundaries
refactor(copilot): extract message components
```

模块前缀建议：
- `browser`: W-05 内置浏览器
- `workspace`: W-02 工作台布局
- `copilot`: W-03 Agent 会话
- `results`: W-04 结果与报告
- `terminal`: W-07 集成终端
- `plugin`: P-04 Plugin SDK
- `harness`: P-03 Harness 工作流
- `electron`: P-06 桌面集成

## 相关资源

- Electron 文档: https://www.electronjs.org/docs
- Vite 文档: https://vitejs.dev
- React 文档: https://react.dev
- Model Context Protocol: https://modelcontextprotocol.io
