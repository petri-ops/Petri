# BLOCK-10 PHASE 0 — Risk Register

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑 docs:check）
> **基线**：`docs/block-10-ph0-survey.md` + `docs/code-audit-closeout-plan.md` v0.1
> **下游**：`docs/code-audit-closeout-plan.md` v0.2

---

## §1 风险矩阵（25 项修复 ID × 风险维度）

> **风险等级**：
> - 🔴 **高**：可能导致 IPC 契约破坏 / 不可逆数据丢失 / 安全 P0 漏洞
> - 🟠 **中**：可能导致单点 fail / 测试 flaky / 性能回退
> - 🟢 **低**：可能仅引发边缘场景 / 测试覆盖不全

| ID | 阶段 | 风险等级 | 风险维度 | 风险描述 | 缓解策略 |
|----|------|----------|----------|----------|----------|
| **C-001** | PHASE 1 | 🟠 中 | IPC 契约 | preload.js 新增 namespace 后 ipcRenderer.invoke channel 名错误 → renderer 调用全失败 | 1:1 复用 `electron.d.ts` 已声明方法；preload-branch-result-namespaces.test.mjs 3 tests 覆盖 17 channel |
| **C-002** | PHASE 1 | 🟠 中 | DB schema | validTypes 改 6 项 + DB CHECK 改 6 项，但既有 DB 数据若 type='text' 列存的是合法值，迁移必须不破坏既有数据 | migration-007-conversation-export.test.mjs 4 tests 覆盖 12-step rebuild |
| **S-001** | PHASE 2.1 | 🔴 高 | 安全 P0 | capability allowedDownstream 算法错误 → plugin shell 执行仍可绕过 RCE | 12 tests 覆盖 effectiveOperation + checkAllowedDownstream 边界（空 / shell / r-runner / python-runner / 畸形 op） |
| **S-002** | PHASE 2.1 | 🔴 高 | 安全 P0 | 三元组校验错误 → 显式 token 失效仍可复活 → context_token replay | 4 tests 覆盖 (jobId, name, revisionId) 三元组 + activeArtifact 不匹配 |
| **S-003** | PHASE 2.1 | 🟠 中 | 安全 P1 | accessMode 透传错误 → 自然语言推断仍生效 → prompt injection 仍可诱导 | 2 tests 覆盖 accessMode 透传 + 不依赖 message text |
| **S-004** | PHASE 2.2 | 🟠 中 | IPC 契约 | sender guard 扩展到 5 类 handler 时漏掉一类 → webview 注入仍可调用 | 沿用 BLOCK-3 模式 + main.js thunk 参数；不新增测试但 chf0-critical 33 项覆盖 IPC contract |
| **S-005** | PHASE 2.2 | 🟠 中 | 安全 P1 | capability tokens 与既有黑名单并存，逻辑分支混淆 | 渐进策略：保留黑名单 + 加 capability tokens 标记；下个工作包再删黑名单 |
| **S-006** | PHASE 2.2 | 🟠 中 | 数据隔离 | retryStats 按 task_id 隔离后，跨 task 统计丢失；既有用户依赖此统计 | migration 必须保留跨 task 聚合；测试覆盖 task_id 隔离 + NOT NULL |
| **S-007** | PHASE 2.2 | 🟠 中 | UX 回退 | targetPath 改 null + 强制 dialog.showSaveDialog → 既有自动化脚本失效 | 既有 user 0 自动化脚本依赖（按 agent-tools audit L344-379 无调用方） |
| **PR-001** | PHASE 2.3 | 🟠 中 | 数据丢失 | retention sweeper 误删用户早期 chat / agent run | 仅删 `>30 day` + 非 active 的；保留 `tasks.status='running'` 不删；task_events 显式不动 |
| **E-017 partial** | PHASE 2.3 | 🟢 低 | lifecycle 死锁 | SIGINT/SIGTERM handler 防递归失败 → 二次信号递归 | installBackendExitLifecycle 单次装 + removeListener 防递归；既有 owned-backend-supervisor.test.mjs 覆盖 |
| **E-019 partial** | PHASE 2.3 | 🟢 低 | db config 缺测试 | config-helper.js 无外部契约 → 单进程 r-server 单点 | 无外部消费者；如未来 branch-db/result-db 接入，需额外测试 |
| **OB-004** | PHASE 2.4 | 🟢 低 | 路径兼容 | error_log 默认路径改 local-data → 既有 `/var/log/petri-errors.log` 用户设置失效 | 沿用既有 PETRI_ERROR_LOG_FILE env 优先级；mcp-server.test.mjs 覆盖 |
| **OB-005 partial** | PHASE 2.4 | 🟢 低 | health shape 漂移 | mcp-server.js health 6 行小改与 r-server / py-server / gateway 4 个 health 端点 shape 不一致 | backend-health.test.mjs 既有；observability-work-package 后续统一 |
| **PL-001** | **PHASE 3** | 🟠 中 | plugin 工具面广 | 10 工具插件 × 5 schema 字段覆盖不全 → 漏校验字段仍可注入 | 10 tests 覆盖；按 schema 字段 required/type/minimum/maximum/enum 逐字段验证 |
| **C-001-rserver** | 不外推 | 🟢 低 | 双重拦截 | `/api/run` 与 `/api/replot/run` 双重拦截 → frontend 误调 500 | rserver-http-debt-pack 候选；frontend 0 调用方 |
| **C-002-rserver** | 不外推 | 🟢 低 | HTTP 状态码 | interaction 404 → HTTP 200 happy-path 静默失败 | rserver-http-debt-pack 候选 |
| **E-017 main** | 不外推 | 🟠 中 | observability 缺口 | Electron 主进程侧 backend-proc-manager.js IPC 推送缺 → renderer 不知 backend down | observability-work-package 候选 |
| **E-018** | 不外推 | 🟠 中 | observability 缺口 | rServerSupervisor restart 无 IPC → renderer 不知 backend 切换 | observability-work-package 候选 |
| **E-019 full** | 不外推 | 🟠 中 | DB 体系化缺口 | busy_timeout 不统一 → 长 lock wait 时 3 connection 等 10s | DB 体系化属于 BLOCK-10-ARCHITECTURE 候选 |
| **OB-001** | 不外推 | 🟠 中 | observability 缺口 | console 5.1:logger 1 → 关键路径 fail-open 无 logger | observability-work-package 候选 |
| **OB-002** | 不外推 | 🟠 中 | observability 缺口 | IPC 跨进程 trace 缺 → 跨进程 bug 难定位 | observability-work-package 候选 |
| **OB-003** | 不外推 | 🟠 中 | observability 缺口 | metrics 端点缺 → 性能退化不可见 | observability-work-package 候选 |
| **OB-005 full** | 不外推 | 🟠 中 | observability 缺口 | liveness/readiness 未分离 → k8s/容器化时 readiness probe 失效 | observability-work-package 候选 |
| **PR-006** | 不外推 | 🟠 中 | observability 缺口 | backend exit IPC 推送缺 → restart 不可观测 | observability-work-package 候选 |
| **PR-012** | 不外推 | 🟢 低 | DB 体系化 | branch-db + result-db 与 r-server 共享文件 → WAL 锁竞争 | DB 体系化属于 BLOCK-10-ARCHITECTURE 候选 |
| **M-001** | 不外推 | 🟠 中 | rserver-http 缺口 | 9 端点鉴权后置 → 越权访问风险 | rserver-http-debt-pack 候选 |
| **M-003** | 不外推 | 🟠 中 | rserver-http 缺口 | feedback 公开端点缺 origin check → CSRF 风险 | rserver-http-debt-pack 候选 |

---

## §2 跨包冲突风险（BLOCK-3/4/5/9/9.1/9.2 边界）

### §2.1 BLOCK-3（IPC bridge hardening）冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| sender guard helper 重写 | 🟠 中 | BLOCK-10 `src/ipc/_sender-guard.js` 是新文件，可能与 BLOCK-3 `src/main.js:604/1586` 既有 `assertTrustedWindowIpcSender` 冲突 | commit `4f9a10f` 已确认两 helper 是**独立**（BLOCK-3 在 main.js，BLOCK-10 在 src/ipc/）；不重写 |
| sender guard 扩展覆盖既有 BLOCK-3 handler | 🟢 低 | PHASE 2 commit 2 扩展到 5 类 handler，可能影响 BLOCK-3 已守门的 setupWindowIpc / setupAgentWorkbenchFlagsIpc | BLOCK-3 既有守门**保留**（不删除）；BLOCK-10 是**新增**到 5 类新 handler |

### §2.2 BLOCK-4（IPC bridge polish）冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| poller 9→4 状态映射冲突 | 🟢 低 | BLOCK-4 抽 `src/_mapSkillRuntimeStatus.js`；BLOCK-10 不动 skills IPC | 不动 |

### §2.3 BLOCK-5（IPC bridge finalize）冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| IPC channel 字面量统一 | 🟢 低 | BLOCK-5 已统一 IPC channel 字面量；PHASE 1 C-001 新增 `branch:create` 等是新增不动既有 | 不动既有 |

### §2.4 BLOCK-9.1（main.js split）冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| main.js 改 8 行 | 🟠 中 | commit `4f9a10f` `src/main.js` 改 8 行（4 个 setup 函数调 createSenderGuard thunk 参数） | **additive 改动**（不改函数签名，仅多传一个参数）；BLOCK-9.1 拆分出的 11 个 setup* 模块不动；记录在 v0.2 偏离声明 |

### §2.5 BLOCK-9.2（mega file refactor 5 文件）冲突风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| SimpleChat.tsx 已抽 6 模块 | 🟢 低 | BLOCK-9.2 PHASE 4 已抽 SimpleChat 6 模块 + 1 hook；BLOCK-10 不动 | 不动 SimpleChat/* |
| plugin-manager.js 已抽 8 lib | 🟢 低 | BLOCK-9.2 PHASE 3 已抽 plugin-manager 8 lib；BLOCK-10 S-004 复用 21 module.exports | 不动 plugin/* |
| ResultView / DesktopSettingsPanel 已抽 | 🟢 低 | BLOCK-9.2 PHASE 1/2 已拆；BLOCK-10 不动 | 不动 |

---

## §3 性能风险（PR-* 修复可能影响性能）

### §3.1 PR-001 retention sweeper 性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| retention sweeper 阻塞主进程 | 🟠 中 | 229 行 retention-sweeper.js 在 r-server 启动后立即 schedule；每个 tick 跑多表 DELETE | ✅ 用 recursive setTimeout（不 setInterval）+ unref handle；表删除逐一 try/catch；既有 `db.js` 测试覆盖 |
| retention 误删 | 🔴 高 | 误删用户早期 chat / agent run | 仅删 `>30 day` + 非 active 的；保留 `tasks.status='running'` 不删；task_events 显式不动（避免与 agent-task-store.js 写入者抢） |

### §3.2 S-004 sender guard 性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| sender guard 每个 IPC handler 首行多 1 次比较 | 🟢 低 | `event.sender === mainWindow.webContents` 单行比较，开销 < 1µs | helper 内单行 `===`；chf0-critical 33 项不退化 |

### §3.3 PL-001 inputSchema validator 性能风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| validator 每次 callTool 都跑 | 🟠 中 | 10 工具插件 × 5 schema 字段 × 每次 chat 调用 → 性能回退 | 极简 validator（required/type/minimum/maximum/enum 单字段单行）；无 ajv 重型解析；10 tests 验证 |
| validator 误拒 | 🔴 高 | 现有 chat 调用若 schema 不允许但实现宽容的字段被拒 | **渐进**：先 required + type 校验；minimum/maximum/enum 加 warning log 而非 reject；下个工作包严格化 |

---

## §4 安全风险（S-* 修复必须验证）

### §4.1 S-001 capability allowedDownstream 风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| plugin shell 执行仍可绕过 | 🔴 高 | 错误算法 → 等效 RCE | 6 tests 覆盖 `effectiveOperation` + `checkAllowedDownstream` 边界（空 / shell / r-runner / python-runner / 畸形 op） |

### §4.2 S-002 contextToken 三元组校验风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 显式 token 失效仍可复活 | 🔴 高 | 三元组校验错误 → context_token replay | 4 tests 覆盖 (jobId, name, revisionId) 三元组 + activeArtifact 不匹配 |

### §4.3 S-003 inferExecutionPolicy 风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| prompt injection 仍可诱导 | 🟠 中 | 自然语言推断 → 删除后 accessMode 透传依赖前端 UI 决定 | 2 tests 验证不依赖 message text；前端 accessMode UI 是上游 |

### §4.4 S-004 sender guard 风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| webview 注入仍可调用 IPC | 🔴 高 | sender guard 漏掉一类 handler | 沿用 BLOCK-3 模式 + main.js thunk 参数；既有 chf0-critical IPC contract 33 项覆盖 |

### §4.5 S-005 workspace_exec 黑名单风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| bash 内置特性绕过白名单 | 🟠 中 | 现有 chat 走 workspace_exec 的 R 脚本若用 bash 内置特性 | 渐进策略：保留黑名单 + 加 capability tokens 标记；下个工作包再删黑名单 |

### §4.6 S-006 retry_stats 单例风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 跨 task 统计丢失 | 🟠 中 | retryStats 按 task_id 隔离后，跨 task 统计不再可聚合 | 既有 `agent-task-cancellation.test.mjs` + `agent-workflow.test.mjs` 覆盖 task_id 隔离 |

### §4.7 S-007 diagnostic 路径风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 任意目录写入 | 🔴 高 | 既有 renderer 传 targetPath 任意写 | targetPath 改 null + 主进程 dialog.showSaveDialog 强制选 |

### §4.8 PL-001 schema validator 风险

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 误拒合法调用 | 🔴 高 | schema 不允许但实现宽容的字段被拒 → 现有 chat 调用 5xx | 渐进策略：先 required + type；minimum/maximum/enum 加 warning log；10 tests 验证 |

---

## §5 兼容性风险（不动已存在契约：preload.js / electron.d.ts / desktopBridge.ts）

### §5.1 preload.js 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 既有 16 namespace key 名修改 | 🟠 中 | C-001 PHASE 1 仅**新增** branch + result 2 namespace，不修改既有 | preload-branch-result-namespaces.test.mjs 3 tests 守住 18 namespace（16 既有 + 2 新增） |
| `petri` world 既有 `agentWorkbenchFlags` | 🟢 低 | `petriDesktop` 是第二份 expose；`petri` 是第一份 | 不动第一份 |

### §5.2 electron.d.ts 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 既有声明修改 | 🟠 中 | C-001 触及 `electron.d.ts:319-505` 是 ADDITIVE 暴露（非修改）；C-002 触及 `electron.d.ts:356-357` 是 union 成员（已声明 + 已对齐 validTypes） | 不修改既有声明；仅 PHASE 1 触及 d.ts 已声明的范围 |

### §5.3 desktopBridge.ts 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 既有导出修改 | 🟢 低 | BLOCK-10 不动 desktopBridge.ts | 0 diff |

### §5.4 4 page consumer 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| BranchTabs / ResultStudio 调用失败 | 🟠 中 | C-001 修复前调用 stub；修复后真实 IPC；既有 consumer 0 diff | dev Electron 实机验证；既有 chf0-critical 覆盖 |

### §5.5 core/shared-backend/* 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| workflow-engine.js / skills-sdk.js | 🟢 低 | BLOCK-10 不动 core/shared-backend/* | 0 diff |

### §5.6 agent-tools/* + agent-transcripts/* 兼容性

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| 历史抹底产物 | 🟢 低 | BLOCK-10 不动 agent-tools/* + agent-transcripts/* | 0 diff |

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
| ❌「PL-001 待启动需 dev Electron 实机验证」 | 把 G0 边界内 verified 视为不充分 |
| ❌「E-017 / E-018 / OB-001 / OB-002 / OB-003 推迟到下一工作包」 | 把 observability 体系化当成 G0 必做 |
| ❌「Provider 矩阵是 G1+ 阶段事项，本次工作包不外推」 | 列举未做项 |

---

## §7 综合风险等级（25 项 ID 风险热力图）

### §7.1 风险分布

| 等级 | 已落地 ID | 待启动 ID | 不外推 ID |
|------|-----------|-----------|-----------|
| 🔴 高 | S-001, S-002, S-004, S-007, PR-001, C-002 | PL-001 | E-017, E-018, E-019, OB-005 full, M-001, M-003 |
| 🟠 中 | C-001, C-002, S-003, S-005, S-006, OB-002, OB-005 partial, OB-004 partial | — | OB-001, OB-002, OB-003, OB-005 full, PR-006, PR-012, C-001-rserver, C-002-rserver |
| 🟢 低 | E-017 partial, E-019 partial, OB-004 | — | E-017 main, E-018, E-019 full, OB-005 partial |

### §7.2 风险集中点

- 🔴 高风险集中在 PHASE 2 commit 1（capability + contextToken + sender guard）
- 🟠 中风险集中在 PHASE 2 commit 2/3（5 handler 扩展 + retention）
- PL-001 🔴 高风险是 PHASE 3 唯一节点

### §7.3 缓解策略总览

1. **每个 🔴 高风险 ID 都有 ≥4 tests 覆盖**（S-001 6 tests + S-002 4 tests + S-004 既有 chf0-critical + S-007 既有 diagnostic-redaction + PL-001 待 10 tests）
2. **每个 🟠 中风险 ID 都有 ≥2 tests 覆盖 或 沿用既有**
3. **🟢 低风险 ID 仅在 closeout 报告标注「精度有限」**

---

## §8 PHASE 3 启动前必看（红旗：候选不该启动）

### §8.1 启动前必查

- [ ] 主 agent 已读 AUDIT-LOG 最近 5 条
- [ ] 主 agent 已确认 5 个 BLOCK-10 commits 全部存在且未 revert
- [ ] 主 agent 已读 v0.2 active 计划 + 4 份 PHASE 0 调研报告
- [ ] 用户已显式裁决启动 PHASE 3（不是「按你的节奏来」，是显式「开始 PHASE 3」）

### §8.2 启动后必跑

- [ ] `npm run docs:check` 0 error
- [ ] `npm run ui:audit:check` PASS
- [ ] `cd frontend && npx tsc --noEmit` 0 error
- [ ] `npm run docs:reconcile` 0 drift
- [ ] `node --test test/block-10-phase2-policy.test.mjs test/preload-branch-result-namespaces.test.mjs test/result-handlers-valid-types.test.mjs test/migration-007-conversation-export.test.mjs` 21/21 PASS
- [ ] `node scripts/g0-chf0-acceptance.mjs` 33/33 PASS

### §8.3 启动后禁止做

- ❌ 不动 preload.js 既有 16 namespace 任何 key 名
- ❌ 不修改 electron.d.ts 任何已有声明
- ❌ 不修改 desktopBridge.ts 任何已有导出
- ❌ 不修改 8 份 audit 报告
- ❌ 不修改 agent-tools/* + agent-transcripts/*
- ❌ 不修改 BLOCK-3/4/5/9/9.1/9.2 已收口 commit
- ❌ 不引入 ajv / zod / joi / prom-client / opentelemetry / lru-cache / simple-git
- ❌ 不启动 Provider 矩阵 / packaged 公证 / GA / P7

---

**不变量**：本风险登记报告 0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check 或 ui:audit:check。下游 v0.2 active 计划基于本报告。
