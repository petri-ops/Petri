# BLOCK-51 — 审计修复包：并发槽 isPrimary 修复 + 上下文熔断接线 + plumber 空壳清理

> 状态：`completed`（2026-09-03 收口：P1/P2/P3/P4 全部实施，P5 定向门禁全绿，P7 收口提交；P6 并发/修剪场景按 §3 留待日常使用观察，终端部分已实机验证）
> 立项日期：2026-09-03（用户裁决「先按建议打包 BLOCK-51」）；2026-09-03 追加 P3 plumber 空壳清理（用户裁决）
> 收口日期：2026-09-03
> truthDomain: `block-51-audit-fixes`
> 依据：AUDIT-51 四域审计（M1）+ 上下文管理专项审计（design-review-2026-09.md §10）+ R/Python 环境审计第三轮（plumber 空壳）

## 1. 背景与范围

三项审计实锤问题打包修复，均为**小改动大收益**：

### 1.1 M1 — 并发槽 isPrimary 从未传入（主 agent 预留槽机制生产失效）

- **设计意图**：`helpers/runtime.js` L57 `aiTaskConcurrencyAcquire(userId, taskId, {isPrimary})`——AGENT-CONCURRENCY 核心承诺「主 agent 永远预留 1 槽不被 subagent 挤占」。

- **实锤**：全部生产调用点未传第三参——`routes/ai-agent/chat.js` L229、`routes/ai-agent/resume.js` L218。主 agent 一律按 `isPrimary=false` 计数。

- **用户可感知后果**：4 个 agent 任务占满时新主对话被拒，且错误文案误导（「子任务并发已达上限」）。

- **测试盲区根因**：`test/agent-concurrency.test.mjs` L105-130 直接调 runtime 层且自传 `{isPrimary:true}`，路由层真实调用形状从未被测。

### 1.2 上下文熔断 — 修剪器零生产接线（「有仪表盘，没刹车」）

- **实锤**：BLOCK-20 建的 `helpers/message-trimmer.js`（`trimMessagesToBudget` L123-211，分层设计完备：保近期+工具结果/压缩历史/摘要提示）**没有任何主链路消费**（全仓 grep 仅其自身 require token-estimator）。

- **用户可感知后果**：长 agent 任务 30+ 轮工具循环时 `messages` 无限增长（loop-orchestrator.js L539/663/712/786 持续 push），每轮全量重发，直到 API 400（context length exceeded）撞墙失败。ContextBudgetBar 只显示不动作。

- **优先级倒挂佐证**：非 agent 老路径 `/ai/chat`（routes/ai-chat.js L261-264）反而有 `SUMMARY_KEEP_RECENT` 滑动窗口——agent 主链路（高风险）裸奔。

### 1.3 plumber 空壳 — R 单轨化拓扑落地（死代码清理）

- **实锤**：`replot.R` 从未存在于 git 历史（`git log --all` 零命中）；`backend-proc-manager.js` L275-280 脚本缺失即 `"replot disabled"` 跳过 spawn——**plumber 进程从未启动**，`r-compute.js` 代理路由指向永无人监听的 :8787。

- **R 事实上已单轨**：唯一活路径 = tools-executor 每任务独立 Rscript 子进程（超时/僵尸恢复/provenance 全在此链）。BLOCK-30 拓扑声明的「petri-server + plumber」与现实不符。

- **语义替代已存在**：Replot 用途已被 Result Studio 版本化编辑取代（改参数→新 Revision→重跑，走 Artifact Truth 而非内存缓存）。清理无功能损失。

- 详见 §2.3 清理清单。

## 2. 方案

### 2.1 P1 — M1 修复（\~4 行 + 测试）

- `routes/ai-agent/chat.js` L229：`aiTaskConcurrencyAcquire(userId, taskId)` → `aiTaskConcurrencyAcquire(userId, taskId, { isPrimary: wantKind === 'primary' })`

- `routes/ai-agent/resume.js` L218：resume 均为 primary → `{ isPrimary: true }`

- **路由层调用形状回归测试**（堵方法论盲区）：不直接调 runtime，而是验证「chat.js 以 primary kind 建任务后，再开 4 个 subagent，第 5 个拒绝但 primary 仍可通过」——或以最小 mock 形式断言调用形状传参正确。

- 同步补 `test/agent-concurrency.test.mjs` 用例：模拟路由层调用形状（不传 isPrimary 的旧形状应视为缺陷被测试暴露——本次修复后测试断言新形状）。

### 2.2 P2 — 上下文熔断接线（\~40 行）

在 `loop-orchestrator.js` 每轮 LLM 请求构造前（L547 `reqBody` 之前）：

1. **估算**：调用既有 `estimateRequestTokens`（需从 agent-runner 传入或 loop 内 require token-estimator）计算当前 `messages` 的 total。
2. **触发**：`total > ctxWindow * 0.85` 时调用既有 `trimMessagesToBudget(messages, {...})`（ctxWindow 经 props/config 传入，获取方式复用 agent-runner L559-568 的 getContextWindow 链）。
3. **防抖**：`trimmedOnce` 标记——同一任务同一次超窗只 trim 一次；修剪后若仍超窗（理论不应发生），不再反复 trim，交给 API 自然失败（诚实）。
4. **事件**：修剪后重发 `token_budget` 事件（`trimmed: true` + 修剪后新 total），ContextBudgetBar 如实反映；**现有 token\_budget 事件发射位（agent-runner L546-576，首轮前）不动**。
5. **不变量**：system prompt 不参与 trim（trimMessagesToBudget 语义本就如此）；本轮 messages 数组引用被替换，后续 push 作用于新数组（确认 trimmer 返回新数组语义）。

### 2.3 P3 — plumber 空壳清理（\~160 行死代码，R 单轨化拓扑落地）

**审计发现（2026-09-03 R/Python 环境审计第三轮）**：`replot.R` **从未存在于 git 历史**（`git log --all` 零命中）——plumber 进程从未真正启动（[backend-proc-manager.js L275-280](../src/main/backend-proc-manager.js) 脚本缺失 → `"replot disabled"` fail-safe 跳过 spawn），所有 R 执行实际走 tools-executor 每任务独立 Rscript 子进程单轨。**R 单轨化事实上已完成，只剩死代码清理**。

清理清单：

| 位置                                      | 内容                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `src/main/backend-proc-manager.js`      | `startPlumber` 整段 + `plumberProc` 状态 + plumber idle timer（\~60 行）          |
| `core/petri-server/routes/r-compute.js` | 代理路由整文件（\~100 行，代理到永无人监听的 :8787）                                           |
| `core/petri-server/routes/index.js`     | L46 挂载行移除                                                                  |
| `src/backend-health.js`                 | `plumberUp` 探测字段移除（恒 false 的死指标）                                           |
| `core/petri-server/ARCHITECTURE.md`     | 拓扑描述 "petri-server + plumber" → "petri-server 单轨"（与现实对齐）                   |
| 前端 `scOpenReplotForAnalysis`            | `copilotClient.ts` L183/L301（URL context 参数）——实施时确认其消费终点；若指向 replot 端点则一并清 |

**语义替代已存在**：Replot 的设计用途（驻留 R 进程交互式重绘）已被 Result Studio 版本化编辑取代（改参数 → 新 Revision → 重跑，走 Artifact Truth 链而非内存缓存），清理无功能损失。

**验收**：全仓 grep `plumber/replot` 仅剩历史文档引用；既有测试零回归；`docs:check` PASS。

### 2.4 P4 — mainWindow 兼容对象形态错配修复（终端崩溃，用户报障 2026-09-03）

- **报障**：`Uncaught Exception: TypeError: mainWindow.isDestroyed is not a function`（terminal.js:45，pty onData 异步回调中无 catch → 主进程崩溃）。

- **根因**：`src/main.js` L138 的 mainWindow 兼容别名对象 `isDestroyed` 为 **getter**（求值返回 boolean），而 terminal.js L45 / skills-window\.js L13 / working-tree-review\.js L858 等全部按 Electron 真窗口**方法**形式调用 `isDestroyed()` → boolean 被当函数调用即炸。

- **修复（2 处）**：① main.js 兼容对象 `isDestroyed`/`isMinimized`/`isFocused` getter → 方法（对齐 BrowserWindow API 形态）；② main.js `setupWorkingTreeReviewIpc({ mainWindow: () => mainWindow })` → 传对象（模块内部按对象用法，此前传 thunk 致 L858 同款炸点；sender-guard 双形态兼容不受影响）。

- **回归测试**：新增 `test/main-window-compat.test.mjs`（5 用例：静态形态契约防回退 + guard/skills-window 在方法形态对象下行为）。

- **连带排查结论**：file-dialog.js 的 `dialog.showOpenDialog(兼容对象)` 形态问题登记为观察项（无实锤报障，不在本包修）。

### 2.5 非范围

- compaction（codex 式摘要替换）——留二期候选（design-review §10.6 P2）。

- agent 链路与老 chat 路径截断策略统一——仅登记，不在本包做。

- tiktoken 精确 tokenizer 引入（G1+，维持估算）。

- BLOCK-51 之外的四域审计遗留疑点（main.js 窗口竞态 / 前端 store 锚点）。

- 0 新 npm 依赖（全部复用既有组件）。

- 不动 BLOCK-50 WIP 文件（src/ipc/working-tree-review\.js / 审阅前端组件）。

## 3. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + roadmap/README + AUDIT-LOG 登记（planned）。

- **P1 M1 修复**：chat.js / resume.js 传参 + 路由层形状回归测试。

- **P2 熔断接线**：loop-orchestrator 每轮预算检查 + trim 接线 + 防抖 + token\_budget 事件。

- **P3 plumber 空壳清理**：§2.3 清单落地（\~160 行死代码，R 单轨拓扑与现实对齐）。

- **P4 mainWindow 形态错配**：§2.4（已实施 2026-09-03，用户报障触发：main.js 兼容对象 getter→方法 + WTR 传参修正 + 回归测试 5/5）。

- **P5 定向门禁**：`node --test test/agent-concurrency.test.mjs` + 新增 trim 接线测试（loop 层：构造超长 messages 断言被修剪+事件发射+防抖）+ plumber 清理后全仓 grep 验证 + mainWindow 形态契约测试（已有）+ 相关既有测试回归（agent-runner-facade / loop-orchestrator-subdomains / backend-health 相关）+ tsc（如动前端类型则跑）+ `docs:check` + `ui:audit:check`。

- **P6 dev Electron 实机（可选，按需）**：构造长任务场景验证不撞 400；并发场景验证主对话不被拒；应用启动无 plumber 相关报错；底部终端会话打开后不再抛 isDestroyed 崩溃。证据 `acceptance/block-51/`。

- **P7 收口**：AUDIT-LOG 待处理项 M1/熔断两条改 ✅ + 台账回写 + registry completed。

## 4. 验收门

- M1：路由层调用形状测试通过（primary 传 `{isPrimary:true}` 可断言）；既有 `test/agent-concurrency.test.mjs` 全绿。

- 熔断：超长 messages 构造下 loop 请求前被修剪、token\_budget 事件 `trimmed:true`、防抖单次、修剪后消息数组后续 push 正常。

- plumber 清理：全仓 grep `plumber/replot` 仅剩历史文档与归档引用；应用启动日志无 plumber 报错；`backend-health` 契约同步（plumberUp 消费方若有）。

- 回归：BLOCK-38/39/40 相关既有测试（task resume / 断线重连 / 会话水合）不退化。

- 治理：`docs:check` + `docs:reconcile` 收口必跑。

- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 风险与对策

| 风险                                          | 对策                                              |
| ------------------------------------------- | ----------------------------------------------- |
| trim 后消息数组引用替换，loop 后续代码持有旧引用               | P2 实施时确认 trimmer 返回语义，loop 内统一用返回值重新赋值局部变量      |
| 估算误差导致过早/过晚触发                               | 0.85 阈值 + 防抖；estimator 本就是既有 UI 数据源，误差可接受       |
| subagent loop 误触发 trim                      | trim 触发对 primary/subagent 一致（都是长循环风险），无需区分      |
| 测试环境 ctxWindow 获取（getContextWindow 可能异步/失败） | 复用 agent-runner 同款 fallback（ctxWindow>0?:64000） |
| plumberUp 字段有前端/测试消费方未排查                    | P3 实施前 grep 消费方逐一确认；若有依赖则该字段保留但注明恒 false 的语义    |
| `scOpenReplotForAnalysis` 有活消费链             | P3 实施时先追终点再决定删留；指向死端点则清，指向活功能则只清端点侧             |

## 6. 进度记录

- 2026-09-03 P0（planned 登记）：用户裁决打包立项；审计依据 AUDIT-51（M1）+ design-review §10（熔断）；本计划落盘并注册 DOC-REGISTRY；待 BLOCK-50 收口后启动。

- 2026-09-03 追加 P3（用户裁决）：R/Python 环境审计第三轮发现 plumber 空壳（replot.R 从未存在，plumber 从未启动）——追加死代码清理为 P3 阶段（§2.3）；同步登记 R 脚本内联 install.packages 隐患（7 个 tool-scripts 运行时装 CRAN 包，破坏可复现性）为 AUDIT-LOG 待处理项（不在本包修，独立候选）。

- 2026-09-03 P4 已实施（用户报障触发）：终端崩溃 `mainWindow.isDestroyed is not a function`——main.js L138 兼容对象 getter→方法 + L461 WTR 传参修正（thunk→对象）+ `test/main-window-compat.test.mjs` 5/5；连带排查确认 skills-window/diagnostic/sender-guard 全部修复面覆盖，file-dialog dialog 形态登记观察项。**生效须重启 dev Electron（主进程代码）**；未提交，随本包收口一并 commit。

- 2026-09-03 P1 实施完成：chat.js/resume.js 路由层显式传 `{isPrimary}`（chat 按 `wantKind==='primary'`，resume 恒 `true`）；`test/agent-concurrency.test.mjs` 扩为路由层调用形状契约测试 10/10；顺带修复既有测试基建缺陷（conversation-adapter/facade 依赖链测试缺 migration，统一改为测试初始化跑 `migration-runner`）。

- 2026-09-03 P2 实施完成：loop-orchestrator.js 每轮请求前 `estimateRequestTokens` 预算检查，total > ctxWindow×0.85 触发 `trimMessagesToBudget`（防抖单次，就地替换 messages）+ `token_budget(trimmed)` 事件；新增 `test/context-breaker.test.mjs` 3/3（超窗触发一次性修剪 / 正常不触发 / finish_reason=length 多轮续写）。

- 2026-09-03 P3 实施完成：`startPlumber`/`stopPlumber` 及 plumber 状态整段（backend-proc-manager.js）、`routes/r-compute.js` 整文件、routes/index.js 挂载行、backend-health.js `plumberUp` 死指标、preload/env-coordinator/_backend-ports plumber 端口残留、前端 replot 消费链（electron.d.ts/BackendStatusProvider/project-workspace）、相关测试断言全部移除；ARCHITECTURE.md 拓扑改「petri-server 单轨」；全仓 grep `plumber|replot` 仅剩历史文档与 plan 引用。

- 2026-09-03 P5 定向门禁全绿：定向测试 22/22（concurrency 10 + context-breaker 3 + main-window-compat 5 + 相关 4）+ 回归 57/57（agent-runner-facade/facade-compat/loop-orchestrator-subdomains/conversation-adapter/backend-health/env-coordinator-port/preload-branch 等）+ 前端 tsc 0 + `docs:check` PASS + `ui:audit:check` PASS（UI-279 补登 + ce430483 豁免登记）。

- 2026-09-03 P7 收口：AUDIT-LOG M1/熔断两条 🟠 → ✅ 已收口（BLOCK-51）+ 顶部收口广播条目；本 plan 状态 planned → completed；DOC-REGISTRY #BLOCK-51-AUDIT-FIXES completed/COMPLETED；roadmap planned 行改已完成。P6 并发/修剪实机场景按 §3 留待日常使用观察（P4 终端部分已实机验证），未验证范围如实声明。

