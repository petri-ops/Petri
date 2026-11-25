# A1 静默吞错分级治理 · 证据（2026-11-26）

> Petri harness 隐形体验优化队列 1。首批只覆盖用户可感知路径四文件；扩面（其余存量）未发令，不动。
> G0 开发期常态 · 不外推 packaged / Provider / GA。owner dev 实例零触碰（全程只跑文件级测试/门禁，未启 dev 栈）。

## §1 分级判据（先核真源，不无脑全改）

对 `catch {}` / `.catch(() => {})` 逐个读上下文后分两类：

| 类 | 判据 | 处置 |
|---|---|---|
| **A · fail-soft** | 清理 / 内部增强 / 通知降级 / 重试兜底 / 事件回调防护 / fire-and-forget 后台任务；失败不改变给用户的结果，或错误已由邻近分支抛出 | **保留吞**，在 catch 内写明「为何可吞」的一行理由（注释即离开 silent-catch 债务口径） |
| **B · 用户可见失败** | 失败让用户点了没反应、或把用户可追溯的产物/证据静默变成空，且别处无信号 | **改留痕**：`logError(source, err, { reasonCode, ...context })`，fail-soft 行为本身不变 |

- B 类后端统一走既有 `core/shared-backend/error-log.js`（BLOCK-520 OB-004 已修写盘静默吞 + dedupe + console.error 桥接），`reasonCode` 进 JSONL entry 的 meta，零新依赖、不重造日志系统。
- 前端无 error-log 模块（Node-only），`ackRunTool` 复用既有 renderer console 链带 `reasonCode` 留痕（主窗 `src/main/_window-create.js:366` console-message 捕获），同样零新依赖；已在 UI-726 台账登记为 in_progress。

## §2 改动文件清单与逐处判定

| 文件 | 裸 catch 清零 | A 类（注释留因） | B 类（reasonCode 留痕） |
|---|---|---|---|
| `frontend/src/components/copilot/copilotClient/agentTaskApi.ts` | 4 → 0 | 4 处响应体解析降级（预览只读降级 / 续跑与重试摘要解析失败由 `!taskId` / `!content` 分支抛 HTTP 错误 / 取消失败取详细文案失败保留 `HTTP <status>`） | `ackRunTool` 网络失败 → `A1_ACK_SUBMIT_FAILED`（renderer console） |
| `core/petri-server/helpers/tools-executor.js` | 14 → 0 | 12 处：临时目录清理、zombie 通知、用户名查询、日志镜像、心跳更新、作业行读取、取消 provenance、retry_count 读取、插件定义读取、三处上传校验清理；2 处 `.catch(() => {})` 取消信号补注 | 2 处：`A1_TOOL_RUN_LOG_WRITE_FAILED`（run.log 用户产物写盘失败）、`A1_TOOL_RESULT_MANIFEST_PARSE_FAILED`（manifest 解析失败会让结果静默变空） |
| `core/petri-server/agent-runner.js` | 14 → 0 | 13 处：插件教程注入、路由观测/日志防护、steer/reactive 日志防护、后台抽取与摘要、filesChanged 聚合、任务级降级续跑、delta 合并、终态对账、并发释放 | 1 处：`A1_AGENT_EVENT_EMIT_FAILED`（消费端回调抛错会静默丢掉用户可见事件流） |
| `core/petri-server/conversation-adapter.js` | 8 → 0 | 7 处：自动标题、topic_shift emit、消息落失败上报的 emit 防护、向量记忆写入、后台抽取/摘要触发与 fire-and-forget、会话广播；3 处 `.catch(() => {})` 补注 | 1 处：`A1_CHAT_AUDIT_WRITE_FAILED`（审计台账自身写失败不会再有第二条证据） |

同步文件：`test/a1-silent-error-grading.test.mjs`（新）、`test/silent-catch-baseline.json`（402→362）、`test/impact-map.json`（A1 规则）、`docs/ui-productization-audit.md`（UI-726 in_progress）。

## §3 HK-01 红绿先行

`test/a1-silent-error-grading.test.mjs`，5 条契约：

1. 四文件零裸 `catch {}` / 零空 `.catch(() => {})`（复用 ratchet 的 `countBareCatches` 同口径）；
2. fail-soft 注释抽样可追（清理 / delta 合并 / 向量记忆 / 前端解析降级）；
3. B 类路径带 reasonCode 且后端确实 require error-log；
4. 零新依赖（无 winston/pino/bunyan/loglevel，error-log 为既有单源）；
5. 行为探针：子进程设 `PETRI_ERROR_LOG_FILE` → `logError(..., { reasonCode, jobId })` → `readRecentErrors()` 读到 reasonCode 与上下文落盘。

- **红（实现前）**：5 tests / 2 pass / 3 fail（裸 catch 仍在、B 类无 reasonCode、注释缺失）。
- **绿（实现后）**：5 tests / 5 pass / 0 fail。

## §4 验证结果

- `gate:silent-catch`：PASS，97 文件 / 362 处，基线已下调 402→362（本批清零 40 处）。
- `quality:secret`：PASS；`quality:arch`：PASS（R1–R5 无违规）。
- `docs:check`：PASS（673 registered documents）；`ui:audit:check`：PASS（UI-726 已登记）。
- `quality:types` / `quality:lint`：**环境阻塞，非本包红**——本机缺 `frontend/node_modules`，tsc 报全仓 `TS2307 Cannot find module 'vitest' / '@testing-library/react'`，eslint 全仓 54820 errors（type-aware 规则无法解析前端依赖）。已核对本包四个改动文件：ESLint 0 error。未安装依赖（零新依赖纪律），未把环境红冒充本包绿。
- `test:changed:list`：**预存阻塞，非本包红**——`test/impact-map.json` 的 `closed-batch-evidence-dirs` 规则引用了不存在的 `test/c56-user-manuscript-fidelity.test.mjs`（HEAD 即如此，与本包无关）。本包新增 A1 规则引用的三个测试文件均存在。
- 定向回归：见 §5。根 `npm run check` / 全量 `test:all:workspace` 默认不跑（纪律），未验证范围如实说明。

## §5 定向回归

`node --test` 六文件合跑：**45 tests / 45 pass / 0 fail**——
`a1-silent-error-grading` + `block520-p0-observability` + `block387-silent-catch-ratchet` +
`agent-runner-conversation-adapter` + `agent-runner-facade-compat` + `block133-r-deparse`。
（早期 13 文件合跑因个别存量测试长时间挂起未产出，收窄为本组可复现绿；tools-executor 邻域另见下一行。）

tools-executor 邻域五文件合跑：**43 tests / 43 pass / 0 fail**——
`block144-tool-jobs-behavior` / `block135-retry-policy` / `block131-domain-validation` /
`block34-tool-activities-persist` / `block49-phase2-tools`。

## §6 剩余未改 catch 分布（核真口径）

本仓 `core` + `src` + `frontend/src` 共 1722 文件；本批后：

- 裸 `catch {}`：**362**（ratchet 基线同数；BLOCK-387 棘轮只减不增）。
- `.catch(() => {})`：**34**（本批清 5）。
- 严格两口径合计 **396**；任务书所述 493 为更宽口径（含带参空 catch 与 `.catch(() => null)` 等），本批按可机械判定的严格口径治理，未逐一对齐宽口径计数。

Top 存量（裸 / 空 then）：

```
core/petri-server/db/schema.js                          51 / 0
core/petri-server/ai-bridge.js                          18 / 0
src/ipc/window-manager.js                               14 / 0
core/petri-server/agent-tools/workspace-tools.js         5 / 8
core/petri-server/helpers/conversations.js              13 / 0
core/petri-server/helpers/agent-fallback.js             10 / 0
core/petri-server/loop-orchestrator.js                  10 / 0
core/petri-server/routes/ai-chat.js                      7 / 3
src/plugin-manager.js                                    9 / 0
core/petri-server/agent-tools/spawn-agent-tools.js       8 / 0
core/petri-server/mcp/registry/run-plugin-script.js      8 / 0
core/petri-server/routes/ai-agent/chat.js                8 / 0
core/petri-server/routes/ai-agent/resume.js              7 / 0
src/main/env-coordinator.js                             7 / 0
```

任务书点名的其余重点文件（`helpers/conversations.js` / `agent-tools/workspace-tools.js` / `routes/ai-chat.js` / `routes/ai-agent/chat.js` / `helpers/agent-fallback.js`）**本批零触碰**，留待扩面发令。

## §7 边界

- 提交留本地，`origin/main` 不动；push 等主人逐批口令。
- 未推 packaged / Provider / GA；未开 dev 栈、未碰 owner 实例；观感零代签（无视觉改动）。
- 扩面判断：首批四个文件已做到「用户路径留痕可追 + fail-soft 注释清晰」；剩余 396 处跨 97 文件，分布广且多数为 DB schema / 清理 / 通知类 fail-soft，建议按文件族逐批扩面，**扩面前回报**，不自动外推。
