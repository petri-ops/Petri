# BLOCK-10-ARCHITECTURE PHASE 0 — Risks Matrix

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑 docs:check）
> **基线**：`docs/block-10-arch-ph0-survey.md` + `docs/block-10-architecture-plan.md` v0.1
> **下游**：PHASE 1+2+3+4 active 工作包

---

## §1 风险矩阵（19 项 ID × 风险维度）

| ID | 阶段 | 严重度 | 类别 | 描述 | 缓解 |
|----|------|--------|------|------|------|
| **A-007** | PHASE 1.1 | 🟠 中 | DB 体系化 | 抽 `_db-singleton.js` 后 desktop main + r-server 进程同时打开 petri.db | 进程边界不破坏；既有 chf0-critical IPC contract 33 项覆盖 |
| **PR-012** | PHASE 1.1 | 🟢 低 | DB 体系化 | branch-db + result-db 与 r-server 共享文件 → WAL 锁竞争 | 与 A-007 同 commit 解决 |
| **E-019 full** | PHASE 1.1 | 🟠 中 | DB 体系化 | SQLite busy_timeout 不一致（r-server 10000ms / agent-task-store / branch-db / result-db 各自保留） | 扩 `core/shared-backend/config-helper.js` 暴露 `getConfig().busyTimeout` |
| **A-009** | PHASE 1.2 | 🟢 低 | 配置 | dev 模式手动启动 r-server 不带 env，端口 fallback 在 3003 / 3001 之间漂移 | 统一到 env-coordinator.js `backendPorts.r` 默认；其他文件 fallback 全部删掉 |
| **A-010（仅 jspdf）** | PHASE 1.2 | 🟢 低 | Dead dep | frontend/package.json 装 jspdf 但 0 import | 移除 jspdf；安装体积 -~2MB |
| **A-010（6 env）** | PHASE 1.2 | 🟢 低 | 隐式依赖 | 214 处 process.env.* 散落（仅 6 处核心路径集中） | 集中到 `shared-backend/config-helper.js` |
| **A-002** | PHASE 2.1 | 🔴 高 | r-server 大文件 | routes/result-studio.js 1800 行 26+ 端点 http 契约漂移 | 既有 chf0-http + result-studio + result-handlers-valid-types 测试 0 退化是契约边界证据 |
| **A-005** | PHASE 2.2 | 🔴 高 | r-server 大文件 | routes/harness.js 1366 + routes/ai-agent.js 1222 http 契约漂移 | 同 A-002；既有 harness + ai-agent 测试 0 退化 |
| **A-001** | PHASE 3.1 | 🔴 高 | agent-runner 拆分 | 4 大类 require（system-prompt / llm-client / plans / conversations / memory-vectors / runtime / loop-contract / loop-controller / loop-checkpoint）跨域耦合 | 抽 LoopOrchestrator + ConversationAdapter；既有 chf0-critical + agent-runner 测试 0 退化是契约边界证据 |
| **A-003** | PHASE 3.2 | 🟠 中 | 跨层反向 | shared-backend 跨层反向 require 修复（configure 注入）破坏既有调用链 | agent-workflow.js 顶部 try/catch 是已存在的"安全网"；改 configure 注入后默认 null 不破坏既有 |
| **A-008** | PHASE 3.2 | 🟠 中 | 循环解环 | act-tools ↔ plan-ui-tools 解环（拆 act-tool-core + act-tool-ui 单向依赖） | partial-export 雷区；plan-ui-tools.js 顶层 require act-tools 作者已知；拆解要保留既有 lazy plan-ui-tools 解构工作模式 |
| **A-006 部分** | PHASE 3.3（可选） | 🟠 中 | singleton 收敛 | 5+ 处 module-level singleton 迁 SQLite 写入者竞争 + restart 恢复时间 | 既有 `agent_task_events` 表写入者不与新表冲突；既有 agent-task-cancellation 测试 0 退化 |
| **A-004** | 不启动 | 🟠 中 | observability | console.* vs logger 比例 5.1:1，关键路径全 console-only | observability-work-package 候选 |
| **E-017 main** | 不启动 | 🟠 中 | observability | Backend procs exit handler 主进程侧不推送 IPC status 事件 | observability-work-package 候选；BLOCK-9.1 已收口 backend-proc-manager.js |
| **E-018** | 不启动 | 🟠 中 | observability | rServerSupervisor 自动重启无 IPC 通知 | observability-work-package 候选 |
| **PR-006** | 不启动 | 🟠 中 | observability | 4 个 backend 子进程 exit handler 仅 console.log | observability-work-package 候选 |
| **C-001-rserver** | 不启动 | 🟢 低 | rserver-http | /api/run 与 /api/replot/run 双重拦截 | rserver-http-debt-pack 候选 |
| **C-002-rserver** | 不启动 | 🟢 低 | rserver-http | /api/result-studio/interaction Revision 不匹配返 HTTP 200 | rserver-http-debt-pack 候选；与 A-002 同文件不联动修 |
| **M-001** | 不启动 | 🟠 中 | rserver-http | /api/ai/admin/* 9 端点鉴权后置 | rserver-http-debt-pack 候选 |
| **M-003** | 不启动 | 🟠 中 | rserver-http | /api/feedback 公开端点缺 origin check | rserver-http-debt-pack 候选 |
| **A-011** | 不启动 | 🟢 低 | type drift | IPC handler `any` 与 desktopBridge.ts 强类型不对称 | type-drift-pack 候选 |
| **A-012** | 不启动 | 🟢 低 | fixture manifest | 5 个子目录 fixture 无 manifest.json | fixture-manifest-pack 候选 |

---

## §2 跨包冲突风险（BLOCK-3/4/5/9/9.1/9.2/10 边界）

### §2.1 BLOCK-3/4/5（IPC bridge）冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| sender guard helper 重写 | 🟢 低 | BLOCK-3 `src/main.js:604/1586` 既有 `assertTrustedWindowIpcSender` 与本工作包新 sender guard 无冲突 | 不重写 BLOCK-3 sender helper；仅在 PHASE 1.2 范围内对齐端口 fallback |
| poller 9→4 状态映射冲突 | 🟢 低 | BLOCK-4 抽 `src/_mapSkillRuntimeStatus.js` 与本工作包 A-005 不冲突 | 不动 skills IPC / poller 逻辑 |
| IPC channel 字面量统一 | 🟢 低 | BLOCK-5 已统一 IPC channel 字面量；本工作包 A-002 + A-005 routes 拆分不动 channel 字面量 | 不动既有 channel 字面量 |

### §2.2 BLOCK-9/9.1/9.2 冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| main.js 改 8 行 | 🟠 中 | BLOCK-9.1 PHASE 2 已收口 main.js；本工作包 A-009 必读 `env-coordinator.js` 但**不重写**仅对齐 fallback | PHASE 1.2 additive（不改函数签名，仅多传一个参数或对齐 fallback）；记录在 v0.1 偏离声明 |
| SimpleChat.tsx 已抽 6 模块 | 🟢 低 | BLOCK-9.2 PHASE 4 已抽 SimpleChat 6 模块 + 1 hook；本工作包不动 | 不动 SimpleChat/* |
| plugin-manager.js 已抽 8 lib | 🟢 低 | BLOCK-9.2 PHASE 3 已抽 plugin-manager 8 lib；本工作包 A-007 不动 | 不动 plugin/* |
| ResultView / DesktopSettingsPanel 已抽 | 🟢 低 | BLOCK-9.2 PHASE 1/2 已拆；本工作包不动 | 不动 |
| useSkillStore.ts 已决议不拆 | 🟢 低 | BLOCK-9.2 PHASE 5 决议保留不拆；本工作包 A-006 部分仅 ≥5 处 singleton 迁 SQLite，**不涉及 useSkillStore** | 不动 useSkillStore.ts |

### §2.3 BLOCK-10-AUDIT-CLOSEOUT 冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| PHASE 1+2 已落地 commit 重写 | 🟢 低 | BLOCK-10 PHASE 1+2 已落地 11 commits；本工作包不重写 | 仅在 PHASE 1 范围内"自然补全"A-007 / A-009 / A-010 / E-019 full（不重写既有 r-server `core/shared-backend/config-helper.js`，仅扩使用范围）|
| retention sweeper 重叠 | 🟢 低 | BLOCK-10 PHASE 2 commit 3 `a09f706` 落地 retention-sweeper.js 229 行；本工作包 A-006 部分不动 retention | 不动 retention-sweeper.js |
| r-server 进程级 lifecycle 重叠 | 🟢 低 | BLOCK-10 PHASE 2 commit 3 已落地 r-server `installBackendExitLifecycle` + `db.close()`；本工作包 A-007 + E-019 full 复用既有 | 不重写既有 installBackendExitLifecycle |

---

## §3 性能风险（PR-* 修复可能影响性能）

### §3.1 A-007 + PR-012 + E-019 full DB 体系化性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 抽 `_db-singleton.js` 后 SQLite handle 共享 | 🟢 低 | 既有 chf0-critical IPC contract 33 项 0 退化 | `_db-singleton.js` 仅代码层共享，进程边界不破坏；既有 better-sqlite3 WAL 模式可容忍多读 |
| busy_timeout 10000ms 全量统一 | 🟢 低 | 既有 busy_timeout 各自保留不破坏 | 扩 `config-helper.js` 暴露 `getConfig().busyTimeout` |
| 写入者竞争 | 🟢 低 | desktop main + r-server 同时打开 petri.db | 既有 chf0-critical IPC contract 33 项覆盖；WAL 模式容忍多读 |

### §3.2 A-002 + A-005 r-server 大文件拆分性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 拆分后端点路由匹配路径不变 | 🟢 低 | require 顺序 + register 顺序保持原状 | 既有 chf0-http + result-studio + harness + ai-agent 测试 0 退化 |
| 子域文件加载开销 | 🟢 低 | 9 个子文件 vs 单文件，require 链增加 | 既有 express 路由匹配性能不变；模块加载一次性开销可忽略 |
| 端点合并 / 拆分误判 | 🟠 中 | 26+ 端点按 domain 拆 9 个子域文件，边界判定需 review | PHASE 2.1 拆分前先列端点 → domain 映射表，PHASE 0.5 worker 调研落地验证 |

### §3.3 A-001 agent-runner 拆分性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| LoopOrchestrator + ConversationAdapter 拆分后事件总线开销 | 🟢 低 | 4 大类 require 跨域耦合但运行时为同步调用 | 拆分后跨模块调用改为函数引用注入；运行时路径不变 |
| agent loop 状态机行为不变 | 🔴 高 | 拆分后必须确保所有状态转移完全一致 | 既有 chf0-critical + agent-runner 测试 0 退化是契约边界证据 |

### §3.4 A-003 + A-008 跨层反向 + 循环解环性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| configure 注入 vs try/catch 包裹 require 性能 | 🟢 低 | configure 注入启动时一次性；try/catch 每次调用都跑 | configure 注入后 0 运行时开销 |
| act-tools ↔ plan-ui-tools 解环后加载顺序 | 🟠 中 | plan-ui-tools.js 顶层 require act-tools 解环后改为 lazy require | 拆 act-tool-core.js + act-tool-ui.js 单向依赖；既有 lazy plan-ui-tools 解构工作模式保留 |

### §3.5 A-006 部分 singleton 迁 SQLite 性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 5+ 处 singleton 迁 SQLite 后写入开销 | 🟠 中 | SQLite 写比内存 Map 慢 | 既有 `agent_task_events` 表写入者不与新表冲突；既有 agent-task-cancellation 测试 0 退化 |
| restart 恢复时间 | 🟠 中 | 迁 SQLite 后 restart 需从 DB 恢复 | 启动时一次性 load；既有 chf0-critical IPC contract 33 项覆盖 |

---

## §4 兼容性风险（不动已存在契约：preload.js / electron.d.ts / desktopBridge.ts）

### §4.1 preload.js 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 既有 18 namespace key 名修改 | 🟢 低 | 本工作包不动 preload.js | 0 diff |
| `petri` world 既有 `agentWorkbenchFlags` | 🟢 低 | 不动第一份 `petri` world | 0 diff |

### §4.2 electron.d.ts 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 既有声明修改 | 🟢 低 | 本工作包不动 electron.d.ts | 0 diff |

### §4.3 desktopBridge.ts 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 既有导出修改 | 🟢 低 | 本工作包不动 desktopBridge.ts | 0 diff |

### §4.4 4 page consumer 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| BranchTabs / ResultStudio 调用失败 | 🟢 低 | 本工作包不动 4 page | 0 diff |

### §4.5 core/shared-backend/* 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| workflow-engine.js / skills-sdk.js / agent-workflow.js | 🟠 中 | PHASE 3.2 范围内 expose `configure({projectHarnessWorkflowJob})` 是 ADDITIVE 不破坏既有 | 改 default null + 既有调用方 0 diff |

### §4.6 agent-tools/* + agent-transcripts/* 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 历史抹底产物 | 🟢 低 | 本工作包不动 agent-tools/* + agent-transcripts/* | 0 diff |

---

## §5 r-server 大文件 26+ 端点拆分（A-002 / A-005）特别风险

### §5.1 routes/result-studio.js 26+ 端点拆分特别风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| http 契约漂移 | 🔴 高 | 拆分后端点 channel 名 / payload shape 必须 100% 一致 | 既有 chf0-http + result-studio + result-handlers-valid-types 测试 0 退化是契约边界证据 |
| 路由注册顺序错位 | 🟠 中 | routes/index.js 注册顺序与 import 顺序耦合 | 抽 routes/result-studio/index.js 注册中心 + 子模块 `register(app, options)` 函数汇总 |
| partial-export 雷区 | 🟠 中 | 与 A-008 act-tools 循环同源；CommonJS partial-export 现象 | 优先用提取独立模块策略（参考 BLOCK-3 `_mapSkillRuntimeStatus.js` 范式） |
| 既有 5+ 测试文件 0 改动 | 🟠 中 | 拆分后 import 路径保持原状（re-export 兼容） | 主文件 + 子文件双向 re-export；既有 test 0 diff |
| 端点合并 / 拆分误判 | 🟠 中 | 26+ 端点按 domain 拆 9 个子域文件，边界判定需 review | PHASE 2.1 拆分前先列端点 → domain 映射表，PHASE 0.5 worker 调研落地验证 |
| interaction / changesets / revisions 端点依赖关系 | 🟠 中 | 跨子域调用（如 interaction 需要 changesets 数据） | 抽 `_state.js` 模块共享依赖；既有可能引入循环 |
| preview-budget 边界 | 🟢 低 | preview-budget 是 Result Studio 内部限流策略 | 单独子文件 `preview-budget.js` |

### §5.2 routes/harness.js 1366 行 + routes/ai-agent.js 1222 行拆分特别风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| http 契约漂移 | 🔴 高 | 同 routes/result-studio.js 拆分；harness + ai-agent 端点契约 100% 不变 | 既有 harness + ai-agent 测试 0 退化是契约边界证据 |
| SSE endpoint 拆分 | 🟠 中 | ai-agent.js 集成 SSE；拆分后 keepalive + chunk 格式 100% 不变 | SSE endpoint 单独子文件 `ai-agent/sse.js`；既有 SSE 测试覆盖 |
| Loop + Tool Call + Conversation 集成 | 🟠 中 | ai-agent.js 集成 3 套子系统；拆分后集成路径不变 | 抽 `_ai-loop-bridge.js` 共享依赖；既有可能引入循环 |
| harness-workflow-state 依赖 | 🟠 中 | A-003 修复后 agent-workflow.js 不再反向 require harness-workflow-state；harness 子文件仍可 require | PHASE 3.2 先于 PHASE 2.2 执行（实际 PHASE 2 先于 PHASE 3，**harness 子文件 require 不破坏**） |

### §5.3 r-server 大文件拆分范式（参考 BLOCK-9.1 / BLOCK-9.2）

参考：
- BLOCK-9.2 PHASE 3 plugin-manager.js 1457 → 586 -871 commit `49652f3`（后端 Node.js 范式：生命周期分层 + lib/ 自包含 + 主文件反向 require）
- BLOCK-9.1 PHASE 3 setupDesktopEnv 716 → 178 -178 commit `aed7498`（提取独立模块策略 + 反向 import 解决 ReferenceError）

**应用范式**：
- 抽 routes/result-studio/index.js + 9 子域文件（`register(app, options)` 函数汇总）
- 主文件 routes/result-studio.js 保留 thin facade 反向 require 9 子文件
- 子文件 self-contained + 自包含

---

## §6 不外推 G1+ 清单（红旗：候选不该启动 / 该候选不该外推）

### §6.1 G1+ 阶段事项（按 AGENTS.md 当前阶段纪律）

> **纪律原文**：「`v0.0.1-rc.7` 是当前 OSS 线上工程候选版，**不是 GA / 正式发布版**；`qualificationEligible: false` 是 G0 开发期的**常态事实**，不是缺陷、不是待办、不是下次校验需推动的事」

| G1+ 事项 | 是否不外推 | 红旗信号 |
|----------|-----------|----------|
| **packaged Electron 公证** | ✅ 不外推 | 不要在 closeout 报告写「待公证」 |
| **Provider 矩阵（真实 Provider）** | ✅ 不外推 | 不要在 closeout 报告写「未做 Provider」 |
| **GA / release-pipeline** | ✅ 不外推 | 不要在 closeout 报告写「未做 GA」 |
| **P7 Honest Product Requalification** | ✅ 不外推 | 不要在 closeout 报告写「P7 deferred」 |
| **dist staleness** | ✅ 不外推 | 不要在 closeout 报告写「dist 需刷新」 |
| **notarization** | ✅ 不外推 | 不要在 closeout 报告写「待 notarization」 |
| **UI-P7-RS** | ✅ 不外推 | 不要在 closeout 报告写「UI-P7-RS deferred」 |

### §6.2 收口笔录用语纪律

> **纪律原文**：「按 G0 阶段纪律是**不外推**而不是"待办"；收口笔录用语：直接写"G0 开发期常态 · 不外推 packaged/Provider/GA"一句即可，**不**列举未做项」

| 错误表述 | 正确表述 |
|----------|----------|
| ❌「`qualificationEligible` 维持 false」 | ✅「`qualificationEligible` 为 G0 开发期常态 · 不外推 packaged/Provider/GA」 |
| ❌「未做 Provider」 | ✅（删除整句） |
| ❌「未做 GA」 | ✅（删除整句） |
| ❌「`dev Electron / packaged Electron 三轴对齐` 待完成」 | ✅「`dev Electron 边界内 verified` / `packaged 边界内 verified` 即为当前阶段最高证据等级」 |

### §6.3 红旗（closeout 报告必须不出现）

| 红旗表述 | 触发原因 |
|----------|----------|
| ❌「PHASE 4 收口后还需 packaged Electron 公证」 | 把 G1+ 当成待办 |
| ❌「A-001 / A-002 / A-005 待启动需 dev Electron 实机验证」 | 把 G0 边界内 verified 视为不充分 |
| ❌「E-017 / E-018 / OB-001 / OB-002 / OB-003 推迟到下一工作包」 | 把 observability 体系化当成 G0 必做 |
| ❌「Provider 矩阵是 G1+ 阶段事项，本次工作包不外推」 | 列举未做项 |
| ❌「A-006 56+ singleton 全部收敛待启动」 | 把 singleton 整体收敛当成 G0 必做 |
| ❌「C-001-rserver / M-001 / M-003 rserver-http 待启动」 | 把 rserver-http debt 当成 G0 必做 |

---

## §7 综合风险等级（19 项 ID 风险热力图）

### §7.1 风险分布

| 等级 | 本工作包主范围 ID | 不启动 ID |
|------|------------------|----------|
| 🔴 高 | A-001 + A-002 + A-005 | E-017 main + E-018 + M-001 + M-003 |
| 🟠 中 | A-003 + A-006 部分 + A-007 + A-008 + A-010 部分 + E-019 full | A-004 + PR-006 + C-001-rserver + C-002-rserver |
| 🟢 低 | A-009 + A-010（jspdf）+ PR-012 | A-011 + A-012 |

### §7.2 风险集中点

- 🔴 高风险集中在 PHASE 2（A-002 + A-005 r-server 大文件拆分）和 PHASE 3.1（A-001 agent-runner 拆分）
- 🟠 中风险集中在 PHASE 1.1（A-007 + E-019 full DB 体系化）和 PHASE 3.2（A-003 + A-008 跨层反向 + 循环解环）
- 🟢 低风险集中在 PHASE 1.2（A-009 + A-010 jspdf）

### §7.3 缓解策略总览

1. **每个 🔴 高风险 ID 都有 ≥5 tests 覆盖**（A-002 5+ + A-005 10+ + A-001 13+）
2. **每个 🟠 中风险 ID 都有 ≥3 tests 覆盖 或 沿用既有**（A-007 5+ + E-019 0 同 A-007 + A-003 4+ + A-008 4+）
3. **🟢 低风险 ID 仅在 PHASE 4 closeout 报告标注「精度有限」**

---

## §8 PHASE 1 启动前必看（红旗：候选不该启动）

### §8.1 启动前必查

- [ ] 主 agent 已读 AUDIT-LOG 最近 5 条
- [ ] 主 agent 已确认 BLOCK-10-AUDIT-CLOSEOUT 11 个 commits 全部存在且未 revert
- [ ] 主 agent 已读 v0.1 active 计划 + 4 份 PHASE 0 调研报告
- [ ] 用户已显式裁决启动 PHASE 1（不是「按你的节奏来」，是显式「开始 PHASE 1」）

### §8.2 启动后必跑

- [ ] `npm run docs:check` 0 error
- [ ] `npm run ui:audit:check` PASS
- [ ] `cd frontend && npx tsc --noEmit` 0 error
- [ ] `npm run docs:reconcile` 0 drift
- [ ] `node --test test/db-singleton.test.mjs test/env-coordinator-port.test.mjs test/config-helper-centralized.test.mjs` 11+/11+ PASS
- [ ] `node --test test/block-10-phase2-policy.test.mjs test/backend-health.test.mjs test/db.test.mjs test/agent-task-store.test.mjs` 既有 0 退化
- [ ] `node scripts/g0-chf0-acceptance.mjs` 33/33 PASS

### §8.3 启动后禁止做

- ❌ 不动 preload.js 既有 18 namespace 任何 key 名
- ❌ 不修改 electron.d.ts 任何已有声明
- ❌ 不修改 desktopBridge.ts 任何已有导出
- ❌ 不修改 5 audit 报告
- ❌ 不修改 agent-tools/* + agent-transcripts/*
- ❌ 不修改 BLOCK-3/4/5/9/9.1/9.2 已收口 commit
- ❌ 不修改 BLOCK-10-AUDIT-CLOSEOUT 已落地 11 commits
- ❌ 不引入 ajv / zod / joi / prom-client / opentelemetry / lru-cache / simple-git
- ❌ 不启动 Provider 矩阵 / packaged 公证 / GA / P7

---

## §9 PHASE 2+ 启动前必看（r-server 大文件拆分特别风险）

### §9.1 PHASE 2 启动前必查

- [ ] 用户已显式裁决启动 PHASE 2
- [ ] 已委派 worker 架构调研（参考 BLOCK-9.2 PHASE 0 worker v2 模式）输出 `routes-endpoint-domain-mapping.md`
- [ ] 主 agent 已基于 worker 调研修订 plan v0.1 → v0.2
- [ ] PHASE 1 已收口（commit PHASE-1.1 + PHASE-1.2 全部 PASS）

### §9.2 PHASE 2 启动后必跑

- [ ] `node --test test/routes-result-studio-split.test.mjs test/routes-harness-split.test.mjs test/routes-ai-agent-split.test.mjs` 15+/15+ PASS
- [ ] `node --test test/g0-chf0-acceptance.mjs test/g0-chf0-http.test.mjs test/result-studio-context.test.mjs test/result-handlers-valid-types.test.mjs test/harness.test.mjs test/ai-agent.test.mjs` 既有 0 退化
- [ ] http 契约 100% 不变验证（手动 grep + git diff --stat）

### §9.3 PHASE 2 启动后禁止做

- ❌ 不修改既有 IPC channel 字面量（BLOCK-5 已统一）
- ❌ 不修改既有 result-studio / harness / ai-agent 端点契约
- ❌ 不联动修 C-001-rserver / C-002-rserver（rserver-http-debt-pack 候选）
- ❌ 不联动修 E-017 main / E-018 / PR-006（observability-work-package 候选）

---

## §10 PHASE 3 启动前必看（agent-runner 拆分特别风险）

### §10.1 PHASE 3 启动前必查

- [ ] 用户已显式裁决启动 PHASE 3
- [ ] PHASE 2 已收口（commit PHASE-2.1 + PHASE-2.2 全部 PASS）
- [ ] 主 agent 已读 agent-runner.js 1799 行全貌（4 大类 require 跨域耦合 + 5 类函数族）

### §10.2 PHASE 3 启动后必跑

- [ ] `node --test test/loop-orchestrator.test.mjs test/conversation-adapter.test.mjs test/agent-workflow-configure.test.mjs test/act-tools-decycle.test.mjs test/singleton-migration.test.mjs` 26+/26+ PASS
- [ ] `node --test test/agent-workflow.test.mjs test/agent-tool-policy.test.mjs test/agent-task-cancellation.test.mjs test/agent-runner.test.mjs` 既有 0 退化
- [ ] agent loop 状态机行为不变验证（手动 e2e + chf0-critical 33 项 0 退化）

### §10.3 PHASE 3 启动后禁止做

- ❌ 不修改 agent loop 状态机（行为不变硬约束）
- ❌ 不修改 shared-backend 公共接口（仅 ADDITIVE expose `configure({projectHarnessWorkflowJob})`）
- ❌ 不联动修 A-006 整体收敛（仅 ≥5 处迁 SQLite，剩余保留）
- ❌ 不联动修 A-004 / E-017 main / E-018 / PR-006（observability-work-package 候选）

---

**不变量**：本风险登记报告 0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check 或 ui:audit:check。下游 v0.1 active 计划基于本报告。
