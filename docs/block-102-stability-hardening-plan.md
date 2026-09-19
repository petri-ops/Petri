# BLOCK-102-STABILITY-HARDENING — 稳定性加固：系统性风险扫描修复

**状态**：`active（2026-09-19 用户裁决「是不是要做个 block呢 一次性修复完成」立项即启动；上下文=用户「我们需要优化这个项目 变得稳定好用」+ 四路系统性扫描产出）`
**立项**：2026-09-19（四路只读深扫：静默失败/资源泄漏/前端竞态/安全边界 + npm run check 全绿 + 运行时证据）
**扫描证据**：本 plan §2 汇总（agent 报告原文要点内嵌，file:line 可溯）

## 0. 心智模型与边界

四路扫描共 ~40 条发现，按「一次会话修完」约束收敛为四个工作面（P1-P4），只修**扫描确认的真实缺陷**，不做扫描未覆盖的重构。单一红线：**零行为变化除修复目标本身**——每处修复必须能指认对应的扫描发现；顺手改动一律不做。

## 1. 非范围（exclusions）

- 架构级重构（loop-orchestrator/tools-executor 拆分、db 连接池/语句缓存——记录为后续候选）；
- G1+ 项（签名/Provider/GA）；14 插件封存维持；Mac 侧平台债（fs verbs/sys_resource/P6 重打）；
- 轮询架构重设计（只做减频与 hidden 检查，不做全局轮询总线）；token 体系重设计（只做加固不动语义）。

## 2. 扫描发现汇总（修复对象）

### P0（4）
1. `conversation-adapter.js:201,233` 对话落库整体空 catch + `persisted` 标志无人消费 → 聊天记录静默丢失
2. `useChatStream.ts:388` queuedPrompts 无会话归属 + completedAt 门失效 → 排队追问跨会话注入
3. `useConversationResume.ts:120` loadOlder 在途切会话 → 跨会话消息前插+游标串话
4. `src/ipc/terminal.js:136-161` spawn 无 error 监听+假 ok:true → 终端打不开报成功+uncaughtException 风险

### P1（8）
5. `agent-runner.js:420-442` 记忆/事实/计划注入整体 catch{} 静默失忆
6. `agent-runner.js:631` + `routes/ai-chat.js:284` 上下文窗口探测失败静默 64k 兜底（熔断失真）
7. `bootstrap.js:60-65` 服务端权限门 fail-open
8. `src/main.js:421-425` Electron 权限策略装配失败 fail-open
9. `server.js:40/52/100/357` 初始化失败仅 warn 整片静默降级（warn→error 级+摘要可见）
10. `mobile-gateway/index.js:160` 会话 token 走 URL query 进中转日志（一年期权限）
11. `bootstrap.js:51-58` :3001 无 Host 校验（DNS rebinding→未鉴权 API 客户端）
12. `project-workspace.tsx:521` + `useRuntimeResourceSnapshot.ts:36` 切项目 fetch 竞态无序号守卫

### P2 修复批（选入本包）
13. inflight 失败永久滞留 ×3（useConversations:62 / useBranchStore:46 / useResultStore:51）+ resultsById 每 render 新 Map
14. `model-context-windows.js:68` + `methods-export.js:513` 无超时 fetch
15. `error-log.js:10,35` /var/log 路径桌面必然失败且失败被吞 → 换 dataDir 可写路径
16. task_events 无 retention（新增 sweeper，保守阈值）+ 失败 SSE 全量回读加 cap
17. 轮询减频与 hidden 检查：useTerminalSubAgentResults（document.hidden 跳过）、useHarnessWorkflowStatus（null workflow 降频）、ToolActivityDock 1s×2 合并、useResultStore resultsById useMemo
18. Cookie Secure + sessions/peers/grants.json 0600 + tunnel localPort 白名单锁 3005

## 3. 阶段与门禁

| 阶段 | 内容 | 门禁 |
| --- | --- | --- |
| P1 后端吞错治理 | 发现 1/4/5/6/7/8/9/15：catch 补结构化 warn（error 级入后端日志流）+ persisted 上抛为 SSE 事件 + spawn error 监听 + error-log 换 dataDir | 定向契约（新增 catch 路径断言）+ tsc 0 + 后端重启实机无回归 |
| P2 前端竞态治理 | 发现 2/3/12/13/17 部分：queuedPrompts 会话归属、loadOlder cancelled 守卫、切项目 requestSequence ×2、inflight finally 删 ×3、resultsById useMemo、copilotAsk 闭包修复 | 定向组件测试（竞态用例：切会话在途请求）+ copilot 套件全绿 + tsc 0 |
| P3 安全加固 | 发现 10/11/18：SSE 一次性流 token、:3001 Host 白名单中间件、Cookie Secure、0600 落盘、tunnel 白名单 | 网关契约测试 + 实机（公网门 401/投影可用性不回归） |
| P4 观测与性能 | 发现 14/16/17 剩余：fetch 超时 ×2、task_events sweeper、SSE 回读 cap、轮询减频 | 定向测试 + 启动日志零新增阻塞告警 |
| P5 收口 | 全量 workspace 测试绿（基线对账）+ closeout 五门 + canonical 五件套回写 | closeout 5/5 + docs/ui 双绿 |

**基线**：2026-09-19 全量 workspace 测试（本立项当日后台运行，结果落 §5 补记）为拆前基线；修复后同口径全绿。

## 4. 证据位置

`acceptance/block-102/`（各阶段定向契约/实机 JSON）+ 本 plan §5 运行记录。

## 5. 运行记录

- 2026-09-19 立项即启动：四路扫描完成（详见 §2），全量测试后台补跑中（基线）。
