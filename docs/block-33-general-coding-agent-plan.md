# BLOCK-33-GENERAL-CODING-AGENT — 通用跨平台编码 Agent 能力 Plan

- **Plan ID**: `BLOCK-33-GENERAL-CODING-AGENT`（2026-09-01；用户裁决「现在需要做通用跨平台编码 Agent 了，你看情况逐步推进，要完美解决」）
- **状态**: `active`（P0 登记 → P1 环境自省 → P2 命令策略化 → P3 流式输出 → P4 后台进程 → P5 平台指导 → P6 实机收口）
- **truthDomain**: `block-33-general-coding-agent`
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与问题

BLOCK-31/32 收口后用户评估：当前 33 个工具对「生信分析 + 工作区」场景完整，但离**通用跨平台编码 Agent**（对标 Codex：跨平台改代码、跑构建、起服务）有 5 个缺口：

1. **无环境自省**：无 `system_info` 工具，模型不知道 OS/shell/工具链版本，只能靠猜或试探性跑 `uname`（Windows 上必错，浪费轮次）
2. **命令无流式输出**：`workspace_exec` 走 `execFile`，命令结束才返回、输出 1MB 截断且截断虽标记但模型/UI 均无实时可见性；长驻进程（dev server / 构建 watch）挂到超时（默认 120s / 上限 30min）才回来
3. **无后台进程**：无 detached 启动 / 查询 / 停止工具，长任务不可行，孤儿进程无清理手段
4. **无跨调用状态**：每条命令独立 shell，`cd` / venv 激活 / 环境变量不持久；无 `cwd` 参数，模型被迫拼 `cd x && y`
5. **Windows 方言陷阱**：模型高频把 POSIX 语法写进 `cmd.exe`（`rm -rf`/`grep`/引号规则），失败率高；shell 不可选

**安全边界不动**：`commandVerdict` 黑名单（sudo/rm/git push/curl|sh）对全部新能力同样生效；workspace 沙箱校验对 `cwd` 参数同样生效；`accessMode === 'full'` 门槛不变。

## 2. 方案（P1–P6 串行，每阶段独立提交 + 定向测试）

- **P1 环境自省**：新工具 `system_info`（只读零风险）——返回 `os.platform/arch/release`、`shell`（shellInvocation 实际将用的解释器）、`cwd`（工作区根）、node/npm/python 版本（execFile 快查，失败诚实标注 unavailable）、`pid`、平台路径分隔符；同时 system prompt 追加一行环境摘要（`darwin/arm64 · /bin/zsh`），省一次工具轮次。
- **P2 命令策略化**：`workspace_exec` args 增加 `cwd`（工作区相对路径，过 `resolveWorkspaceTarget` 沙箱校验）与 `shell`（`auto` 默认 | `posix` | `powershell` | `cmd`，Windows 下可选 PowerShell 获得现代语法）；结果增强——`exitCode`、`durationMs`、`pid`、输出截断标记透传给模型与 UI（`truncated` 已有，补 exitCode/duration）。
- **P3 流式输出**：executor 链路增加 `onOutput` 回调（`spawn` 替代 `execFile` 采集增量 stdout/stderr）；agent-runner 把回调接到 SSE 新事件 `tool_output`（callId 关联、增量节流 ~200ms、上限封顶）；UI `ToolActivityList` 工具活动条内实时追加等宽输出区（tail 显示 + 截断标记）。
- **P4 后台进程**：新工具 `workspace_exec_background`（`spawn` detached，输出重定向到工作区 tmp 日志文件，返回 `pid` + 日志路径；黑名单同样先过 `commandVerdict`）、`process_status`（按本会话 pid 集合查存活 + 日志 tail）、`process_stop`（SIGTERM→宽限→SIGKILL）；进程表内存态 per conversationId，应用重启自然失效（诚实边界）。
- **P5 平台指导**：`desktop-agent-prompt` 注入平台命令指导——当前平台与 shell 说明、`cd` 不跨调用持久（用 `cwd` 参数）、Windows 优先 PowerShell、长任务用 background 工具、输出截断时如何分段读取。
- **P6 实机收口**：dev Electron + CDP——macOS 实机全链验证（system_info / cwd / 流式输出实时追加 / background 起停）；Windows 路径靠代码审查 + 单测覆盖（shellInvocation/powershell 分支），实机 Windows 属 G1+ 不外推；UI-265 台账 + 门禁 + 收口。

## 3. 非范围

- 持久交互式 shell（pty/REPL 会话）
- 提权（sudo）与黑名单任何放宽
- 远程执行 / SSH 目标
- 后台进程跨应用重启恢复（内存态进程表，重启即失联——日志文件仍在可手工查）
- macOS 之外的实机验收（G1+）
- 0 新 npm 依赖

## 4. 依赖

- BLOCK-31（P1 权威清单依赖 task_events，`workspace_exec` 仍为 unattributed 诚实边界，不变）
- BLOCK-32（工作区按 projectId 解析，与 workspace 沙箱一致）
- BLOCK-10 S-003（accessMode 决策源，全链已修复）

## 5. 门禁与证据

- 后端：`node --check`；定向 node --test（system_info 形状 / cwd 沙箱拒绝逃逸 / shell 选择 / 黑名单对 background 生效 / process_stop 信号链）
- 前端：`tsc --noEmit` 0；SimpleChat 定向 vitest（tool_output 流式追加、截断标记）
- 治理：`docs:check` / `ui:audit:check` / `docs:reconcile`
- 实机（P6）：dev Electron + 真实 DeepSeek task——模型调 system_info 正确识别环境；带 cwd 的多命令任务成功；流式任务（如长 echo + sleep 序列）UI 实时追加输出；background 起 node http server → process_status 查活 → process_stop 停止；截图 `acceptance/ui-265/` + evidence.json

G0 开发期常态 · 不外推 packaged / Provider / GA.
