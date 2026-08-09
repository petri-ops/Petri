# 依赖去耦与 Web 冗余清理 — 检查点

最后更新：2026-07-16

## 目标

把 BioF3 Desktop 从「共享外部 submodule + web/ECS 双模式」彻底改造为**完全独立、纯本地**的桌面应用：核心后端内联仓库、去除外部依赖、剥离所有只服务于 web 版的双模式分支，为后续「规范化」打基础。

约束（全程遵守）：
- 不破坏可运行的桌面应用；每个增量都过 `r-server + py-server 启动` + 全量测试 + 前端构建。
- 保留用户未提交的 WIP（`docs/README.md`、`docs/project-workspace-handoff.md`、`docs/ui-productization-audit.md` 及 frontend/src 改动从未被暂存）。
- 全量测试基线 = 268 tests，5 个既有 `qa-smoke` 失败（预先存在，非回归）。任何其它失败都视为回归。

## 已完成

### Phase A — 去 vendor 化（`9ab94f3`）

- 把 `vendor/biof3-core` git submodule 的工作树（`r-server` / `py-server` / `shared-backend` / `packages` / `test`）逐字内联到仓库根的 `core/`。
- 修正外延路径（vendor 深 2 层 → core 深 1 层）：registry、content-plugins、harness。
- 重写 `src/main.js` / `plugin-manager.js` / `mcp-server.js` 的 dev 路径解析；electron-builder / vite / tsconfig / package.json / CI 全部指向 `core/`。
- 移除 submodule 机制：`.gitmodules`、`.vendor-lock`、`scripts/sync-vendor.sh`、gitlink。
- 结论：桌面版**不再依赖任何外部模块**，零行为变化。

### Phase B — 初步剪裁 web 时代死代码

- 移除单细胞异步计算引擎（`fd2cff5`）、web-only 路由 + 加 core-deps postinstall（`6493dd3`）、失效配置与死模块（`5825b1b`）、文档路径同步（`0b3c507`）、孤立 web 时代模块（`268e506`）、死前端源码（`296fcd2`）。

### #1 — 前端类型解析修复（`4c409a6`）

- Phase A 移动后 shared-copilot 的 react 类型解析失败（14 个 tsc 错误）。在桌面根 devDependencies 加 `react`/`react-dom`/`@types/*`（与 frontend 版本一致），使向上 node 解析成功。react 仅 devDep，不进 Electron 包。

### #3a — 移除 Dell/platform 代理（`93971fd`）

- 删除 `tools-dell-proxy.js` 及 `proxyDell*` 接线；桌面 `runMode` 恒为 `all`，从不为 `platform`。

### #3b — 移除 OSS 存储（`22f58eb`，约 -2859 行）

- 删除 `OSSStorage` 适配器、`backup-manager.js`、`oss-list-worker.js` 及 3 个 ECS 运维脚本（`backup.sh`/`recover.sh`/`deploy-demo-full.sh`）。
- 报告 PDF 导出、r-compute/py 图片收集、上传、py task 结果全部改走本地 `StorageAdapter`。
- 删除 `/api/oss/sign`、`/api/proxy-file`；`cache-manager.js` 重写为纯本地（保留本地临时/缓存清理 + 磁盘统计）。
- 从两个 server 的 `package.json` 移除 `ali-oss` 并重生成 lockfile。
- **刻意保留**：根级 `ali-oss` devDep —— 被 `scripts/publish-macos-oss.mjs`（macOS 自动更新发布）使用，其测试仍通过。

### #3c — 移除 PostgreSQL 驱动（`cbcdb2d`，约 -3553 行）

- 桌面纯 SQLite；PG 双模式由 `DATABASE_URL` 门控（桌面从不设置）。
- 把 `db.js` / `task-store.js`（r）+ `r-server-db.js` / `task-store.js`（py）重写为纯 SQLite；`methods-export._gatherAnalysisContextForMethods` 改为纯同步（去掉 `_pgOne/_pgAll` + deasync）。
- 删除 `db-pg` / `db-core-pg` / `db-auth-pg` / `db-p2` / `db-p2-pg-shim` / `task-store-pg` / `r-server-db-pg` / `conversations-async` / `migrations/pg` / `db-pg-*` 测试。
- 从两个 server 的 `package.json` 移除 `pg` + `deasync` 并重生成 lockfile。
- **刻意保留**：`getSqliteForLegacyModules` / `getAsyncDbForLegacyModules`（带 `$N→?` 占位符转换，被 chat-summary/plans/user-facts 使用）与 `isPg()/isPgUsers() → false`（被 ai-admin/api-data/memory-privacy/permissions/tools-executor/feedback 使用，恒走 SQLite 分支）。

### #3d — 移除 docker 执行分支（`c464ea8`，约 -483 行）

- 桌面直接调内嵌 R/Python；docker exec 是 web/ECS 遗留。
- r/py executor 改为纯本地；`tools-executor.js` / `r-compute.js` / `py-pool.js` / `py-server/server.js` / `task-queue.js` / `tools-router.js` 全部剥离 docker 分支。
- 该增量先把 `execMode` 默认改为 `local`，并删除 `dockerExecArgs`/`rContainer`/`rExecUser`/`pyContainer` 及失效 getter；后续 #3g 已把模式字段与 container 命名彻底移除。

### #3e — A 档低风险残留清理（`065a628` / `e190935` / `66a0f31` / `7492583`）

- 删除 py-server 的 web-only Dockerfile 与 `.env.example` OSS 凭据示例。
- 清理 guest permissions、feedback、Python task queue、MCP registry 中的 PG/deasync/docker 过期注释。
- 删除 `task-scripts.js` 未使用的 `_config` 导入。

### #3f — runMode 去耦（`1900b0f` / `be4d42f` / `b833590`）

- r-server / py-server 先把 `runMode` 固定为 `all` 并删除 `BIOF3_RUN_MODE` 配置入口；后续 #3g 已删除无人读取的固定字段。
- 删除 platform/api/worker 启动、路由、Agent prompt、zombie recovery 与 Python queue drain 分支，桌面恒走本地单进程路径。
- `task-store` 在此前 SQLite 化后已无 worker 模式分支，无需额外修改。

### #3g — 执行模式与 canonical 路径彻底收口（`44830b5` / `be0c46d` / `ba65aec` / `8feca10`）

- 删除主进程 `BIOF3_EXEC_MODE` 注入、两端 config 与 config-helper 的 `execMode`，并展开所有恒真本地分支。
- execution-context 升级到 v2：删除 local/container/remote 归一化器及 `execMode`/`runMode`/重复 `mode` metadata，adapter 恒为 local；保留 canonical path 与 artifact metadata 能力。
- 删除最终无人读取的 `runMode` 固定字段；生产代码不再存在运行模式开关。
- `containerTempDir` 正名为 `canonicalTaskRoot=/work/biof3/tasks`；删除 `containerCacheDir`，Python 父缓存复用改用真实本地文件路径。
- R/Python 默认临时目录回归 `/tmp` 本地路径，Python cache 默认跟随 `BIOF3_PY_TEMP_DIR`。

### #3h — C 档旧异步引擎与执行残留移除

- 删除 py-server 的 `/api/task` 队列、task store、旧脚本生成入口与配置；保留当前
  Python 工具路由，并把脚本生成器限定为本地输入和仓库模板。
- Agent 删除旧 `createTask`、`start_analysis`、`recluster` 提交路径；后台对话任务
  单独落在 `agent-task-store`，不再借用分析 task 语义。
- 删除旧容器 runtime 语义、无实现的 Python 工具注册、旧执行提示、不可达 PG
  分支，并把数据库访问器正名为 SQLite-only 接口。
- MCP registry 只暴露注册插件；未知或已删除工具在创建 `tool_job` 前拒绝，旧
  `single-cell-core` 工作流、fixture 与弱模型 task pack 已清理。
- 删除 `BIOF3_STORAGE` / `storageMode` 假选择器；本地存储是唯一实现。
- 主要提交：`a17fffb`、`8332602`、`744491a`、`fef97ac`、`63475df`、
  `d6b6eaf`、`cbaac59`、`5141fac`、`a469bcf`、`db2e357`、`d29588b`、
  `1940b42`、`45f7f26`、`c577c21`。

### #3i — 桌面身份与本地 API 最终收口

- 删除 R/Python 的 `localMode`、JWT、API token、internal token 分支及仅被这些
  分支使用的依赖；两个后端恒使用固定 `local-user` 身份。
- R/Python HTTP 服务改为只监听 `127.0.0.1`，不再暴露到所有网卡。
- 删除重复的 `/api/internal/tools/*` Web/ECS 路由；工具只保留桌面本地 API，
  继续复用唯一 `tool_job` 与 artifact truth 链。
- 修复 docs index 调用已删除 `_isLocalMode()` 的运行时错误；本地索引恒优先。
- 主要提交：`f43a6d8`、`ceb3269`、`aee3100`。

### 实机验证

`npm run dev` 实测：Vite:3000 + r-server:3001 + py-server:3004 全部起来；`storage active: local`（OSS 移除生效）、SQLite migrations applied（PG 移除生效）、PyWorker 用内嵌 Python 直接 spawn 就绪（docker 移除生效）；渲染进程加载完成。

## 当前架构（去耦后）

| 维度 | 现状 |
|------|------|
| 核心后端 | 仓库内 `core/`，无 submodule |
| 存储 | 本地文件（`LocalFileStorage`，无模式开关） |
| 数据库 | SQLite（`better-sqlite3`） |
| 执行 | 内嵌 R/Python 本地执行，无模式开关 |
| 运行形态 | 单进程本地全能，后端只监听 loopback，无 platform/api/worker 分支 |
| 依赖 | server 端不再有 `ali-oss`/`pg`/`deasync`；根 `ali-oss` 仅发布脚本用 |

## 下阶段建议

> 当时使用的 Agent 接手提示词已失效并归档于 [`agent-handoff-prompt.md`](./archive/checkpoints/agent-handoff-prompt.md)；当前 Agent 必须从 `AGENTS.md` 和文档入口恢复状态。

架构去耦与 C 档执行引擎清理已经完成。后续回到 v1 Stage 1 UI 产品化主线；
以下只剩非阻塞文档/模块归档事项：

1. **早期 flagged 但保留的模块**：`sanitizer.js`（有测试）、`mcp/server.js`（独立可用）、`dashscope.js`（`getEmbedProvider` 默认）—— 等 P-07 模型网关落地时统一收编。

## 不变量（清理时不得破坏）

- `run_tool → tool_job → artifact truth` 唯一执行事实链。
- 本地存储 / SQLite / 本地执行三条单一路径不再引入第二套后端。
- 每个清理增量必须过：`npm run check` + 全量测试（基线 5 qa-smoke）+ r-server/py-server 启动 + 前端构建。
- 只暂存自己改动的文件，绝不暂存用户 WIP。
