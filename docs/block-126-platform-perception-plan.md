---
capability: platform-perception
goal: 分析任务终态秒级可见 + 运行期日志流——消除「跑完没？卡在哪？」的感知盲区
acceptance:
  - block126 契约测试全绿（终态事件三原语 + live-log 环 + 源码扫描守卫）
  - 既有 ck03-events-bus / tools-executor 相关定向回归零红
  - 实机（dev 栈可用时）：作业终态后前端 ≤ 秒级收到 jobs 失效；运行中日志端点返回实时尾部
reopen: 实机不可用时组件/契约级收口为 in_progress，dev 栈可用后补实机翻 verified
status: active
---

# BLOCK-126 — 感知实时性：终态失效事件 + 运行期日志流（G0-PLATFORM PL-2）

> 立项：2026-09-28。用户裁决「可以的 开干！」= G0 Goal 交织序第 2 项启动（第 1 项 BIO-1/UI-452 已交付，实机待补）。
> 形态：BLOCK（单会话目标）。上游：G0-PLATFORM plan §3 PL-2 种子 + CK-03 已建 SSE 失效通道（`/api/events` + `useInvalidationStream` + 两消费方）。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话目标

把「任务跑完没、卡在哪」从 60s 兜底轮询 + `no_log_yet` 收敛到秒级事件推送 + 运行中实时日志尾部。

## 2. 差距（评估证据）

- tools-executor 终态转换**不发 jobs 失效事件**：全仓仅 agent-task-store 调 `publishInvalidation('jobs')`（4 处）→ 非对话内完成的 job 前端靠 60s 兜底轮询感知（`useConversationJobs.ts:71-92`）。
- 本地作业**零运行期日志流**：execFile 回调收尾才拿 stdout；run.log 在 finalize 时统一落盘（`tools-executor.js:971-974`）；日志端点运行中诚实返回 `no_log_yet`（`tools-metadata.js` log 端点）。
- 前端为轮询陈旧态付出的防御成本（`ResultArtifactShell.tsx:284-298`）是底层推送缺失的下游症状。

## 3. 范围

**P1 终态失效事件**（单点接线，覆盖全部终态路径）：
- 新 `core/biof3-server/helpers/job-events.js`：`publishJobTerminalState(jobId, state, extra)` → `eventBus.publishInvalidation('jobs', { toolJobId, state, ... })`，永不 throw。
- **executor 侧收敛在状态机 CAS 原语层**（`tools-executor/active-job.js`）：`transitionToolJobToFailed` / `transitionToolJobToCompleted` / `settleConfirmedToolCancellation` 三原语 CAS 成功（changes≥1）才发——覆盖本地执行、超时、取消收敛、失败、成功、僵尸恢复全部路径，且天然不重发。
- durable-cancel 抑制启动的直写收敛（`tools-executor.js` canLaunchOwnedToolJob 分支）补发 cancelled。
- **MCP 路径**（`run-plugin-script.js`）各 `db.updateToolJob` 终态直写后补发（该路径不走 CAS 原语）。
- 前端零改动：`useInvalidationStream('jobs')` 消费方（CK-03 已接两处）自动受益；轮询兜底保留（断线自愈语义不变）。

**P2 运行期日志流**（HTTP 异步主路径 executeJob）：
- 新 `core/biof3-server/helpers/job-live-log.js`：按 jobId 的有界行缓冲（StringDecoder 多字节安全、尾部 600 行/96KB、丢弃计数诚实标注、终态 clear）。
- `executeJob` 的 `execFile` 改 `spawn`：stdout/stderr 双收集（全量字符串供 finalize 原 API + 逐块喂 live-log）；**行为等价钉住**：maxBuffer 10MB 超限同语义失败、err.killed/err.code 契约保持、owner.process/child.pid/生命周期链零适配（ChildProcess 同接口）；`windowsHide: true`（子进程无窗口闪现，改善项登记）。
- 日志端点：本地作业运行中且 run.log 未落 → 返回 live 尾部（`source: 'live', live: true`，note 诚实标注滚动丢弃/结束写全量）；结束后走既有 run.log 文件链零变化；SSH 分支（remote-runner.log）不动。
- 前端 Jobs Wall 零改动受益（轮询日志端点自动拿到运行中增量）。

## 4. 非范围（exclusions）

- **MCP 路径（run-plugin-script）的日志流不做**：该路径将在 PL-1 执行语义统一时并入 executeJob 语义，届时自然获得；本轮只补它的终态事件。
- 不改 SSE 协议/心跳/前端订阅链（CK-03 契约零改动）；不推数据本体（维持 invalidate-then-refresh 模式）。
- 不做进度百分比/阶段流（PL-2 出口判据之外，留后续）；不动 SSH 远程日志镜像（已有增量链）。
- 不新增 npm 依赖（node 内建 child_process/StringDecoder）。

## 5. 验收门禁

- 新契约测试 `test/block126-job-terminal-events.test.mjs`：job-events 单元（domain/payload/永不 throw）+ 三原语 CAS 成功才发 + 源码扫描守卫（executor durable-cancel 处 / MCP completed+failed / 日志端点 live 接线在位，防回归漏接线）。
- 新契约测试 `test/block126-job-live-log.test.mjs`：行缓冲/前缀/UTF-8 跨 chunk/有界滚动+丢弃计数/按字节尾读/clear。
- 既有回归：ck03-events-bus、tools-executor-job-context、tool-job-conversation 等定向零红。
- `npm run test:changed` + docs:check；impact-map 补登记（若新文件未被通配覆盖）。
- 实机（dev 栈可用时）：真实 job 终态→SSE 秒级失效；运行中日志端点 live 尾部。

## 5.1 实机进展（2026-09-28，`acceptance/block-126/perception-live.json`）

- **P1 终态失效事件实机两轮实证**：SSE `/api/events` 收到 `invalidate(jobs, {toolJobId, state})`，**落库→事件到达延迟 1ms**（两轮同值；脚本 `scripts/block126-perception-live.mjs` 可复跑）。
- **P2 live 日志实机被环境阻塞**：验收时 dev 栈无 `BIOF3_R_HOME`（Rscript preflight 失败于 spawn 前=既有语义非本包回归；含本包代码的栈当日 15:29 曾成功跑 deseq2 五例）。**重开条件=带数据根 `runtimes/R` env 的 dev 栈在跑后复跑本脚本**，期望 live_log/final_runlog 两项翻绿后整包收口。
- 验收临时项目已清理；两条快速失败 job（preflight 路径）反证了失败终态同样发事件。

## 6. 台账关系

- G0-PLATFORM plan §3 PL-2 阶段种子 ← 本包；backlog G0 Goal 系列区状态同步；收口回写两处。
- UI 面：本包零 UI 改动（前端自动受益），不新增 UI-### 条目。
