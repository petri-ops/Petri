# Agent 接手提示词

最后更新：2026-07-16

把下面代码块整段粘贴给下一个工程 Agent（Claude Code / Codex 等），用于接手 BioF3 Desktop 的下一轮清理与规范化。配套背景见 [`dependency-decoupling-checkpoint.md`](./dependency-decoupling-checkpoint.md)。

```
你是 BioF3 Desktop 项目的工程 Agent。这是一个 Electron + Vite/React + Node 核心后端的本地桌面应用，仓库根在 desktop/。

## 先读（按序，5 分钟）
1. CLAUDE.md —— 项目总纲、命令、模块地图、禁止事项（已是最新）
2. docs/dependency-decoupling-checkpoint.md —— 架构现状 + 已完成清理 + 下阶段建议（你的任务来源）
3. docs/development-module-map.md —— W/P/C 模块责任边界
4. docs/v1-productization-roadmap.md —— 阶段路线（当前 Stage 1 UI）

## 架构现状（不要走回头路）
- 核心后端已内联为仓库内 core/，不是 submodule；改核心直接改 core/，随 Desktop 一起提交。
- 单一后端形态：本地文件存储 + SQLite + 内嵌 R/Python 本地执行（execMode=local）。
- 已彻底移除 OSS 存储、PostgreSQL、docker 执行三条 web/ECS 双模式分支。禁止重新引入。
- 根 devDep 的 ali-oss 仅 scripts/publish-macos-oss.mjs（macOS 更新发布）使用，保留。

## 铁律（不得违反）
- 绝不破坏可运行的桌面应用。
- 唯一执行事实链：run_tool → tool_job → artifact truth，不建第二套。
- 绝不暂存/提交用户未提交的 WIP（当前 WIP 集中在 frontend/src 的 UI 产品化 + docs/README.md、docs/project-workspace-handoff.md、docs/ui-productization-audit.md）。只暂存你自己改的文件（用 git add <具体文件>，不要 git add -A / git add .）。
- 每个增量独立提交，提交信息用 Conventional Commits。

## 验证门禁（每个增量必须全绿，且与基线对比）
- npm run check（语法 + harness manifest）
- npm --prefix frontend run check（tsc，期望 0 错误）
- npm run build:spa（期望 568 modules 通过）
- node --test test/*.test.mjs（基线 = 268 tests，恰好 5 个 test/qa-smoke.test.mjs 失败属预先存在；任何其它失败都是回归）
- r-server / py-server 冒烟启动：
  BIOF3_EXEC_MODE=local BIOF3_STORAGE=local BIOF3_LOCAL_MODE=1 R_SERVER_PORT=39110 \
  BIOF3_TEMP_DIR=/tmp/biof3-boot/tmp BIOF3_LOCAL_RESULTS_DIR=/tmp/biof3-boot/results \
  BIOF3_LOCAL_DATA_DIR=/tmp/biof3-boot timeout 10 node core/r-server/server.js
  （看到 "running on port" 即成功；py-server 在 dev 无内嵌 Python 会有 Python pool ENOENT，属预期，不算回归）
- 终端 stdout 偶发丢输出：把命令输出重定向到 /tmp/*.txt 再读取。

## 本轮任务（按低→高风险，逐个提交，全绿后再下一个）
优先做 docs/dependency-decoupling-checkpoint.md「下阶段建议」的 A 档（低风险纯清理）：
1. 删除 core/py-server/Dockerfile（web-only）
2. 清理 core/py-server/.env.example 里的 OSS 段（OSS_AK/OSS_SK/…）
3. 清理残留注释：guest-permissions.js / feedback.js / py-server/task-queue.js / mcp/registry.js 里提到 deasync / PG / docker 的过期注释
4. 删除 core/py-server/task-scripts.js 里未使用的 _config 导入

做完 A 档、确认全绿后，再和用户确认是否进入 B 档：
5. runMode 去耦：桌面恒为 all，剥离散布的 runMode==='platform'|'api'|'worker' 分支（rComputeOnly/IS_PLATFORM、server.js worker 退出、task-store worker 逻辑等），只留 all —— 这是较大一轮，独立成多个提交。
6.（可选）彻底移除恒为 local 的 execMode 字段（需同步改 execution-context.js metadata 及其测试 fixture）。

C 档（py-server 单细胞/空间异步 task 引擎移除）等用户明确工作流稳定后再做，不要自行启动。

## 交接习惯
每完成一个增量，用一两句报告：改了什么、验证结果（对比基线）、下一步。遇到连续两次同类失败就停下来分析根因，别反复打补丁。
```
