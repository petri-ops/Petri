# BioF3 Desktop Core 架构

> 最后更新：2026-09-03（BLOCK-51 P3：plumber 空壳路由摘除，R 单轨拓扑与现实对齐）

`core/biof3-server` 是 BioF3 Desktop 唯一的本地 Node 业务后端。它不部署到
Web/ECS，不连接 PostgreSQL、OSS 或容器运行时；R/Python 分析由它经
shared-backend 执行器注册表直接 spawn 内嵌解释器执行。

## 运行拓扑

```text
Electron main
├── Vite/React renderer
└── core/biof3-server/server.js (local HTTP, 唯一业务后端)
    ├── SQLite (biof3.db，单写入方)
    ├── local filesystem
    ├── embedded/system R        （spawn Rscript）
    ├── embedded/system Python   （spawn python，经执行器注册表）
    └── AI agent + MCP registry
```

Electron 主进程分配本机端口并注入本地数据、结果和运行时路径。biof3-server 只在
桌面生命周期内运行，文件落在用户的 BioF3 本地目录或项目 workspace。
（BLOCK-30 P1/P2：原 core/py-server 与 core/gateway 已摘除——前端此前对
py-server 为 0 直连、裸执行入口恒 410、`tool_jobs` 双写入方收敛为单写入方；
gateway 仅剩健康探活消费者。BLOCK-51 P3：原 `/api/replot/*` plumber 代理路由
已摘除——replot.R 从未存在于 git 历史，plumber 进程从未启动；R 事实上单轨 =
tools-executor 每任务独立 Rscript 子进程，交互式重绘由 Result Studio 版本化
编辑取代。）

## 唯一分析事实链

```text
run_tool → registered tool → tool_job → artifact truth
```

- `core/biof3-server/mcp/registry.js` 只暴露当前插件注册表中的工具。
- 重操作的确认发生在正式执行前；未知工具不得预建 `tool_job`。
- R/Python 执行器写入同一 `tool_jobs` SQLite 表。
- 下游步骤只能绑定真实 job 中通过校验的 artifact。
- 不允许新增并行任务库、第二套 workflow DB 或绕过 artifact truth 的结果链。

## 主要模块

```text
core/biof3-server/
├── server.js                 Express 服务装配与生命周期
├── bootstrap.js              本地中间件、request id、权限装配
├── db.js                     SQLite 唯一数据库入口
├── agent-runner.js           Agent 对话与工具循环
├── agent-task-store.js       Agent 后台对话任务持久化
├── agent-tools/              Agent 工具定义与 dispatch
├── mcp/registry.js           插件工具发现与统一执行入口
├── routes/
│   ├── tools.js              工具 job、状态与结果路由装配
│   ├── tools-platform.js     桌面公开工具 API
│   ├── tools-internal.js     同进程内部辅助路由
│   ├── tools-metadata.js     tool_job 元数据 API
│   ├── harness.js            Harness 状态与诊断
│   └── ai-*.js               Copilot/Agent 本地 API
├── helpers/
│   ├── tools-executor.js     本地 R/Python 工具执行
│   ├── artifact-truth.js     结果事实校验
│   ├── plans.js              Plan 与 tool_job 状态同步
│   └── project-run-layout.js 项目结果沙盒布局
├── tool-registry.js          内置分析工具元数据
└── tool-scripts/             R/Python 脚本与报告模板
```

`core/shared-backend` 提供本地存储适配器、执行器注册表（R/Python/未来语言共用
同一 `LanguageExecutor` 接口与 `buildPoolWorker` 池钩子）、execution context、
项目运行目录等纯逻辑，被 biof3-server 与 Electron 主进程共同复用。
（BLOCK-30 P1：原 `core/py-server` 已摘除，其 `py-pool.js` 常驻 Python worker
池抢救至 `shared-backend/executors/`，接线见 BLOCK-30 P3。）

## 存储与路径

- 数据库：`better-sqlite3`，不接受数据库后端模式选择。
- 文件：`LocalFileStorage`，不接受存储后端模式选择。
- 执行：直接 spawn 本地内嵌或开发机运行时，不接受执行模式选择。
- 稳定引用：artifact metadata 使用 canonical path；真正读写仍落本机路径。

历史字段名如数据库列 `oss_url` 只可作为旧数据/API 兼容层存在，不代表 OSS
能力，也不得据此恢复远程存储分支。

## 开发与验证

从 Desktop 仓库根执行：

```bash
npm run check
npm --prefix frontend run check
npm run build:spa
node --test test/*.test.mjs
npm run harness:agent-evaluate
```

本地启动使用 `npm run dev`。核心修改直接提交 `core/`，不存在 submodule 同步或
远程服务器发布步骤。
