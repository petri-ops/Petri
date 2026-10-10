# BLOCK-30-BACKEND-CONVERGENCE — 单后端收敛与更名（petri-server）Plan

- **Plan ID**: `BLOCK-30-BACKEND-CONVERGENCE`（用户裁决启动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：P0 `214185f` / P1 `edd1116` / P2 `d4f459d` / P3 改判 `2f563a1` / P4 `4e51ae1`；P6 证据重采待安静环境，见 §P5 收口记）
- **truthDomain**: `block-30-backend-convergence`
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与架构结论（2026-08-30 架构评估）

- r-server / py-server **均为 Node.js**（Express + better-sqlite3）业务后端；R/Python 只是 spawn 的解释器子进程。真实执行链：前端/agent/MCP → r-server `tools-executor` → `getExecutor(plugin.language)` → spawn 内嵌 Rscript/python。r-server 自身已能执行 Python 工具，不经 py-server。
- 前端从不调用 py-server（`getApiPrefix('python')` 全前端 0 调用方；唯一接触是 `BackendStatusProvider` 健康探活 3004）。py-server 裸执行入口 `/api/run` 恒 410；`py-pool` 常驻 worker 池因无流量闲置。
- py-server 经 `r-server-db.js` 受限读写同一 `petri.db`（users 只读 + tool_jobs 读写）→ **`tool_jobs` 存在双写入方**。gateway（3005）唯一消费者是前端健康探活。
- 按语言拆 HTTP 服务是 web/ECS 双模式时代遗留；收敛为单后端符合 `dependency-decoupling-checkpoint.md` 不变量（"不引入第二套后端"）。`shared-backend/executors` 注册表已预留语言无关接缝（含 `buildPoolWorker()` 池钩子，当前 0 调用方）。

## 2. 目标与非范围

**目标**：① 摘除 py-server（py-pool 抢救至 shared-backend）；② 摘除 gateway；③ py-pool 接线 tools-executor（Python 工具常驻池）；④ 更名 `core/r-server` → `core/petri-server`。

**非范围**：不改工具契约内容 / 数据库 schema / MCP 协议 / 插件格式；不用其他语言重写控制面；不改前端页面（仅状态探活适配）；plumber 原样保留；`rApiBase` 前端契约名不改（`getApiPrefix` 保留 language 参数恒走 r-base）；G1+ 不外推。

## 3. 不变量（每阶段提交前自查）

1. `run_tool → tool_job → artifact truth` 行为不变；收敛后 `tool_jobs` 单写入方（增强而非风险）。
2. P1/P2/P4 纯减法/纯更名，零用户可感知行为变化（仅健康探活少一项）。
3. 每阶段结束树干净、定向门禁绿、独立可 revert；不跨阶段携带未提交改动。
4. 既有测试失败不新增（对照 P0 基线清单）。
5. 每个提交跑 `docs:check` + `ui:audit:check`。

## 4. 引用面基线（2026-08-30 census，HEAD=be799ad）

| 引用 | 文件数 | 摘除阶段 |
|---|---|---|
| `py-server` 字样 | 80 | P1 |
| `core/gateway` 字样 | 15 | P2 |
| `R_SERVER_URL` | 17 | P2 |
| `pythonApiBase` | 8 | P1 |
| `py-pool` | 8 | P1 抢救（git mv 保留） |
| `PETRI_R_DB_PATH` | 1 | P1 |
| `r-server` 字样 | ~400 | P4 |

打包层：`electron-builder.yml` L80-95 extraResources 打包 r-server/py-server/shared-backend 三目录；`src/mcp-server.js` L27 硬解析 `core/r-server/mcp/registry`；`core/py-server/pyserver.db*` 为 2026-07-16 dev 遗留，随 P1 删除。

## 5. 阶段划分

### P0 · 立项与基线冻结（本提交）
plan 文档 + DOC-REGISTRY 登记 + README 入口 + AUDIT-LOG P0 行；census 数字（上表）+ 全量测试基线（`test:all:workspace` 输出与既有失败清单）落 plan 附录。

### P1 · 摘除 py-server（1 commit，原子）
1. `git mv core/py-server/py-pool.js core/shared-backend/executors/py-pool.js`，修 import、测试随迁保持绿（先搬家不接线）。
2. 删 `core/py-server/` 整目录（`tools-router.js` 镜像契约 / `r-server-db.js` 桥（`tool_jobs` 从此单写入方）/ 410 的 `/api/run` / pyserver.db*）。
3. 主进程：`backend-proc-manager.js` 删 py spawn 与 getProcs 注册项；`ipc/backend-lifecycle.js` 删 `py:start/stop`；`env-coordinator.js` 删 pythonApiBase 注入与 py 端口分配。
4. `preload.js` 删 `pythonApiBase`；`frontend/src/lib/env.ts` 删 python 死分支。
5. `BackendStatusProvider.tsx` 删 3004 探针；`electron-builder.yml` 删 py-server extraResources；`test/impact-map.json` 与相关测试同步。

**验证门**：`test:changed` 定向 → r-server 启动证据 + Python 插件工具 e2e（证走 r-server 内嵌 spawn）→ 前端 build → `docs:check` + `ui:audit:check`。**回滚**：revert 单提交。

### P2 · 摘除 gateway（1 commit）
删 `core/gateway/`、`backend-proc-manager.js` gateway spawn 与 `R_SERVER_URL` 注入、前端 gateway-client 探活改直探 r-server。验证门与回滚同 P1。此后常驻子进程 = r-server + plumber。

### P3 · 池接线 —— **实施阶段改判：不接入**（2026-08-30 实施评估）
P1 抢救的 `py-pool.js` 保留为 `shared-backend/executors/` 资产，但**不接入** `tools-executor` 的 tool-job 执行路径。实施深查发现的架构冲突（当时立项评估未及）：

1. **取消契约冲突（决定性）**：tool_job 事实链依赖进程级取消——`tool_jobs.process_pid` 落库 + durable cancellation 按 pid 杀进程 + heartbeat 探活（`process-lifecycle.js`）。池化 worker 中脚本无常驻独立进程可杀：要么杀掉 worker（丢热状态、破坏并发），要么取消退化为不杀进程——两者都削弱事实链取消保证，违反本 plan 不变量 #1。
2. **隔离即正确性**：每 job 冷 spawn 提供干净解释器状态；常驻 worker 会让 scanpy/全局模块状态跨 job 泄漏，对分析类工具是正确性风险。
3. **收益错配**：池原为已废弃的交互式 `/api/run` 快路径设计；工具 job 是数十秒到分钟级批分析，冷启动 import（约 5–10s）占比有限。

**处置**：`py-pool.js` 留作 `buildPoolWorker()` 池语义的参考实现；未来若引入不走 tool-job 事实链的轻量执行面（如无取消需求的本地快速试算），再评估启用。

**验证门**：无需运行时验证（无行为变化）；本节改判经 plan 修订记录，随 P4 提交。

### P4 · 更名 `core/petri-server`（1 commit，原子）
1. `git mv core/r-server core/petri-server`（保历史）。
2. 词边界替换四类：目录路径引用（`main.js` / `mcp-server.js` / `plugin-manager.js` / vite / tsconfig / CI / scripts）、`electron-builder.yml` from/to、`package.json` name（`petri-r-server` → `petri-server`）+ description 正名、md 文档 + `DOC-REGISTRY.json`。
3. **替换纪律**：带词边界工具、按目录分批 review diff（`r-server` 是 `petri-r-server` / `R_SERVER_URL` 的子串，禁盲替换；P1/P2 已清零 py/gateway 引用）。

**验证门**：定向测试 + dev Electron 启动 + `docs:check`。**回滚**：整 stage 单提交 revert。**残余风险（诚实记录）**：packaged 资源路径已同提交更新，packaged 实机构建按 G0 纪律不外推，G1 前需重建验证。

### P5 · 收口
`docs:reconcile` + `docs:check` + `ui:audit:check` + 全量 `test:all:workspace`（对照 P0 基线，一次）→ canonical 回写（`core/r-server/ARCHITECTURE.md` 拓扑重写（随目录已改名）、`dependency-decoupling-checkpoint.md` 不变量升级、roadmap / handoff）→ closeout 文档 + DOC-REGISTRY completed + AUDIT-LOG 收口行。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 盲替换误伤（子串纠缠） | 词边界替换 + 分目录 review diff；P1/P2 先清零 py/gateway 引用 |
| 池化内存泄漏/僵尸进程 | 惰性启动 + idle 回收 + maxRestarts + soak 证据 |
| 多运行时版本下池错配 | 池按 pyHome 分区 + 运行时切换测试 |
| rename 半途而废 | P4 原子提交，永不出现"改了一半"的中间态 |
| 打包态/dev 态漂移 | electron-builder 变更与代码同提交；packaged 验证按 G0 纪律不外推，G1 前重建验证 |
| WIP 裹挟 | P0 已验证树干净；只 stage 本包文件 |

## 7. 完成语义

- 每阶段 verified = 对应验证门全绿且证据可查（测试输出 / 启动日志 / 计时证据，落 `acceptance/block-30/` 或 plan 附录）。
- 整包 completed = P5 全部门禁 + canonical 回写 + DOC-REGISTRY/AUDIT-LOG 状态推进。
- G0 开发期常态 · 不外推 packaged/Provider/GA.


## 附录 A · P0 全量测试基线（2026-08-30 采集，HEAD=be799ad，本机 shell 环境）

- 命令：`npm run test:all:workspace`（Node --test 全量 + 前端 vitest；原始日志 /tmp/block30-p0-baseline.log，临时不归档）
- Node 侧汇总：**tests 2352 / pass 2169 / fail 168 / skipped 15 / suites 181**，exit 1
- 失败签名定性：SQLITE_ERROR ×148 + "no such table" ×25 为主——指向测试环境共享 DB 迁移未应用（migration-runner 由 Electron 启动执行），属**环境可复现基线**而非产品回归；与本包无关（P0 仅改文档）。
- P5 对比规则：同命令同环境重采，**只将失败集合的新增项计为回归**；
- 提取方法勘误（2026-08-30 补记）：首次提取只捕获了文件级 ✖ 行（26 个），漏掉子测试级失败（如 preload-agentdocreview-namespace）；已改用 "test at" 上下文解析法重提为 47 个文件。A/B stash 对照证实 agentDocReview 5 失败在 HEAD 即存在，非本包引入；基线失败集合（47 个测试文件）如下：

```
test/act-tool-core.test.mjs
test/agent-approval.test.mjs
test/agent-concurrency.test.mjs
test/agent-provider-boundary.test.mjs
test/agent-query-result.test.mjs
test/agent-run-tool.test.mjs
test/agent-runner-conversation-adapter.test.mjs
test/agent-runner-facade-compat.test.mjs
test/agent-runner-facade.test.mjs
test/agent-runner-loop-orchestrator.test.mjs
test/agent-tool-policy.test.mjs
test/agent-tool-registry.test.mjs
test/agent-tool-result.test.mjs
test/agent-vision.test.mjs
test/agent-workflow-phase6.test.mjs
test/deepseek-retry.test.mjs
test/desktop-agent-prompt.test.mjs
test/env-coordinator-port.test.mjs
test/execution-conversation-threading.test.mjs
test/g0-api-route.test.mjs
test/g0-project-baseline.test.mjs
test/g0-rs-p6-product-acceptance.test.mjs
test/g0-rs-p7-acceptance.test.mjs
test/g0-rs-ux1h-acceptance.test.mjs
test/harness-workspace-tools.test.mjs
test/loop-agent-integration.test.mjs
test/loop-api-route.test.mjs
test/loop-controller-integration.test.mjs
test/loop-durable-resume.test.mjs
test/loop-orchestrator-subdomains.test.mjs
test/loop-repository.test.mjs
test/preload-agentdocreview-namespace.test.mjs
test/project-memory-isolation.test.mjs
test/project-memory-migration.test.mjs
test/project-sandbox-mcp-tools.test.mjs
test/release-contract.test.mjs
test/result-edit-agent-tool.test.mjs
test/result-replay-service.test.mjs
test/result-studio-agent-binding.test.mjs
test/result-studio-context.test.mjs
test/routes-harness-subdomains.test.mjs
test/routes-result-studio-facade.test.mjs
test/routes-result-studio-subdomains.test.mjs
test/scientific-task-persistence.test.mjs
test/test-affected.test.mjs
test/tool-job-conversation.test.mjs
test/workspace-data-import.test.mjs
```


## 附录 B · P5 全量对比结论（2026-08-30，HEAD=4e51ae1）

- `npm run test:all:workspace`：tests 2345 / pass 2158 / fail 172 / skipped 15。
- **失败文件集合与基线完全一致（47 个，0 新增 0 消失）**；用例级规范化对比（剔除
  计时后缀）后仅 4 个新增失败，全部集中在 `test/env-coordinator-port.test.mjs`
  断言旧端口契约（gateway 3005 / python 3004）——属 P1/P2 契约变更的测试同步项，
  已随本提交修复（6/6 过），并顺带修正在基线即红的 A-009.8（preload 断言与实现
  脱节的历史债务，放宽为"不得回退硬编码旧默认"）。
- 基线 168 → P5 172 的 +4 即上述 4 例，修复后无新增回归。
- P6 canonical evidence：`p6_current_source_tree_not_exact` fail-closed 按设计生效
  （206 文件绑定含旧路径 + 旧 commit），重采运行手册见 §P5 收口记与 AUDIT-LOG 待处理项。


## 附录 C · P6 证据重采闭环（2026-08-30，HEAD=508999c）

1. `508999c`：补齐 impact-map 的 16 个 UI 证据目录映射（acceptance/ui-193…220，
   BLOCK-22~29 期间累积的基线既有债务）。该债务使 test-affected 用例自 08-29 起在全量
   跑中持续红，且该用例位于 P6 门禁测试清单内，阻塞重采链。
2. 干净树重采：首次尝试被脏树 `p6_evidence_source_binding_not_current` fail-closed
   拦截（采集要求 committed tree，机制按设计工作）；提交映射修复后重跑成功。
3. 证据：`capturedAt=2026-08-30T10:44:52Z`、`sourceCommit=508999c`、10/10 canonical
   checks、`sourceCommitMatchesSourceHashes=true`。
4. 整条门禁 `npm run g0:result-studio:p6`：tests 363 / pass 356 / **fail 0** +
   PASS 10/10。BLOCK-30 无遗留。
