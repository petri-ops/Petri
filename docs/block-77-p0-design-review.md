# BLOCK-77 P0 设计评审 —— 长任务驻留与回访通知（评审稿 v1）

> 状态：`评审中`（2026-09-10 落盘；用户确认裁决后进 P1）
> 归属工作包：`docs/block-77-resident-tasks-plan.md`（§5 D1–D5 的细化与确认）

## 1. 现状代码事实

- **后台执行**：`workspace-ssh-surface.js` 的 `exec_bg/process_status/process_stop`（BLOCK-67 P2）——exec_bg 返回 pid，日志留服务器；`process_status` 以 ps_pid 实探单查，列表不逐 pid 探测。
- **应用内通知**：`notify.custom({title, template, dedupeKey, lines})` 通道已在 tools-executor 使用（zombie 扫描先例）。
- **proactive 投影**：agent-runner.js:809-826（BLOCK-49 二期）——子 agent 终态主动投递父任务事件流。
- **会话恢复**：SimpleChat `restoreSimpleMessage`（messages 表持久化）；系统级上下文注入无现成机制（交接班的挂载点需 P2 定）。
- **项目内文件写入**：ssh 项目走 Gateway（fs_write 64KB 分块，BLOCK-76 P2 修正后）；本地项目走 workspace IPC——意图卡双栈写入都有现成通道。

## 2. 评审裁决（R1–R5，⏳ 待用户确认）

- **R1 意图卡 = 项目内文件** ✅ 技术面无分歧：`.gewu/resident/<taskId>.json`（task/成功标准/backing pid/日志路径/创建时间/状态机）。执行真相仍在 process/job 状态机，意图卡只描述「意图与归属」（单一真值红线不破）。文件随项目走：ssh 项目落服务器（远程真值），本地项目落本地。
- **R2 回访循环** ✅：后端 setInterval 60s（可配 `BIOF3_RESIDENT_INTERVAL_MS`），仅软件运行期；每轮对 running 驻留任务做 ps_pid 存活 + 日志 mtime 增长两项检查；异常判据 = 进程死且 .exit 非零 / 日志 N 轮无增长。
- **R3 通知分层** ✅：异常与完成 → `notify.custom` 应用内通知（dedupeKey 防重复）；进行中不推。移动推送接口预留（函数签名占位，BLOCK-70 联动）。
- **R4 生命周期** ✅：created → running → completed | failed | abandoned；abandoned（连续 3 轮无进展且进程死）需用户确认后清理，不自动删除。
- **R5 安全边界** ✅：回访只读状态 + 通知，不自动重启失败任务；kill/重跑必须用户确认。

## 3. 风险与实测项

- 回访轮询经 mux 复用连接（~1 RTT/任务），60s 节奏下开销可忽略；BIOF3_SSH_MUX=0 时退化为 thin per-call（每任务每轮一次握手，登记实测项）。
- 交接班挂载点（P2 定）：候选 = 会话打开时 system 注入 vs proactive 任务条；评审倾向后者（复用 BLOCK-49 投影，零 prompt 污染）。

## 4. 确认记录

- 2026-09-10 落盘评审稿 v1。
