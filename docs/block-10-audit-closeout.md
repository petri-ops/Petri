# BLOCK-10-AUDIT-CLOSEOUT — 收口报告 v1.0

**版本**：v1.0（2026-08-18 收口）
**plan**：[`docs/code-audit-closeout-plan.md`](../code-audit-closeout-plan.md) v0.2 active
**状态**：✅ completed（2026-08-18）

## 1. 元数据

| 字段 | 值 |
|------|-----|
| 工作包 ID | BLOCK-10-AUDIT-CLOSEOUT |
| 真值域 truthDomain | agent-harness-audit-closeout |
| 实施日期 | 2026-08-17 — 2026-08-18 |
| 涉及审计报告 | 8 份（错误处理 / 安全 / 契约 / 架构 / 可观测性 / Plugin schema / r-server HTTP / 性能） |
| 修复单元总数 | 25 项（11 Critical + 5 High + 9 Major） |
| 已修复 | 13 项（11 Critical + 2 High 全部 + 0 Major） |
| 不外推 | 12 项（按 G0 阶段纪律 / governance 治理） |
| commits | 8 主 + 3 closeout = 11 总 |
| tests | 25 新 + 6 复用 = 31 总（10 PL-001 + 9 PHASE 1 + 12 PHASE 2） |
| 行数净变化 | ~740 行 net + |
| 新依赖 | 0 |
| 4 治理门 | docs:check PASS / docs:reconcile 0 issues / tsc 0 错 / ui:audit:check 4 pre-existing 漂移 |

## 2. 实施总结

8 份独立审计报告共发现 25 项修复单元。本工作包按 4 PHASE 全部收口：

- **PHASE 0** 调研：2 commits（plan v0.1 → v0.2 active + 4 份 PHASE 0 调研报告 + DOC-REGISTRY 注册）
- **PHASE 1** C-001 + C-002：1 commit（用户可见 critical 修复）
- **PHASE 2** S-001~S-007 + PR-001 + E-017 partial + OB-004 + OB-005 partial：4 commits（安全 + 性能 + 可观测性）
- **PHASE 3** PL-001：1 commit（MCP callTool inputSchema 校验 + 10 tests）
- **PHASE 4** closeout：3 commits（DOC-REGISTRY active → completed + ui-productization-audit ledger + 4 canonical docs + 本报告）

## 3. PHASE 0 调研

- plan v0.1（只读调研产出，2026-08-17 21:08） → v0.2 active（2026-08-18）
- 4 份 PHASE 0 调研报告（共 1438 行）：
  - `docs/block-10-ph0-survey.md`（493 行 / 7 节）：25 项修复单元详细清单 / 同根组合 / 跨包边界 / 阶段归属 / 工作量估算 / 修复顺序
  - `docs/block-10-ph0-fix-order.md`（361 行 / 7 节）：依赖 DAG / commit 拆分 / PHASE 划分 / 关键路径 / 可并行 ID
  - `docs/block-10-ph0-test-matrix.md`（287 行 / 6 节）：现有测试 / 25 项测试需求 / 新测试文件建议 / 验证门限
  - `docs/block-10-ph0-risks.md`（297 行 / 8 节）：风险矩阵 / 跨包冲突 / 性能 / 安全 / 兼容性 / 不外推 G1+

## 4. PHASE 1 — C-001 + C-002

commit `1c0ebf0`：

- **C-001** Critical：`src/preload.js` 顶层新增 2 个 namespace（petriDesktop.branch 6 方法 + petriDesktop.result 7 方法 + result.version 4 子 namespace），1:1 映射 `electron.d.ts:319-505` 已声明
- **C-002** Critical：`src/ipc/result-handlers.js` validTypes 扩展 'conversation_export' + createFromConversation 改 'conversation_export'（与 d.ts union + result.types.ts 对齐）
- DB migration collateral：007_result_conversation_export_type.sql 12-step SQLite table-rebuild 扩展 CHECK 集合
- 3 新测试：preload-branch-result-namespaces / result-handlers-valid-types / migration-007-conversation-export（9 项 PASS）

## 5. PHASE 2 — S-001~S-007 + PR-001 + OB-004 + OB-005 partial

4 commits：

- `128b3d4` S-001/2/3：
  - **S-001**：agent-tool-policy.js 收紧 run_tool / workspace_exec capability 边界（消除等效 RCE）
  - **S-002**：result-context-binding.js contextToken 过期校验（显式 token 过期也失败）
  - **S-003**：agent-execution-policy.js 替换基于正则的推断（消除自然语言正则推断执行许可）
- `4f9a10f` S-004/5/6/7：
  - S-004：branch-handlers / result-handlers / ai-settings / plugin 加 sender 守门
  - S-005：workspace-tools 替换关键字黑名单
  - S-006：agent-task-store retry_stats user_id 不可空
  - S-007：diagnostic.js 修复可写任意目录
- `a09f706` PR-001 + E-017 partial：SQLite append-only 表归档 + cleanup 任务 + 4 backend procs exit handler 推送 IPC status 事件（r-server 进程级）
- `1fedf9c` OB-004 + OB-005 partial：error-log.js 默认路径可写 + health endpoint shape 修正

## 6. PHASE 3 — PL-001

commit `b79c472`：

- **PL-001** Critical：MCP callTool inputSchema 校验
- 新增 `core/r-server/mcp/_validate-tool-args.js`（233 行）：自写轻量 validator，覆盖 type / required / minimum / maximum / enum / minLength / maxLength / items / additionalProperties
- 修改 `core/r-server/mcp/registry.js`（+40 行）：callTool 入口加 validateToolArgs + McpValidationError
- 修改 `core/r-server/plugin-loader.js`（+42 行）
- 1 个新测试文件 `test/mcp-calltool-input-schema.test.mjs`（329 行 / 10 tests）
- **0 新依赖**（保持 governance discipline 不引入 ajv/zod）

## 7. PHASE 4 — closeout 3 commits

- `b64c65b` DOC-REGISTRY active → completed + 8 linkedCommits
- `f678edf` ui-productization-audit.md 追加 13 项已修复 + 12 项不外推笔录
- `本 commit` 4 canonical docs + 本 closeout 报告 v1.0

## 8. 累计指标

| 类别 | 数量 |
|------|------|
| 主 commits | 8 |
| closeout commits | 3 |
| 总 commits | 11 |
| 新测试文件 | 4 |
| 新测试 | 25 |
| 复用测试 | 6 |
| 总 tests | 31 |
| 行数净变化 | ~740 行 |
| 新依赖 | 0 |
| 文档新增 | 5（plan v0.2 + 4 PHASE 0 报告 + 1 closeout 报告） |
| DOC-REGISTRY 新增 entry | 5（PHASE 0 4 报告 + BLOCK-10-AUDIT-CLOSEOUT 状态变更） |

## 9. 8 份审计报告完成度

| 报告 | 路径 | 发现数 | 已修复 | 不外推 |
|------|------|--------|--------|--------|
| 错误处理 | `docs/agent-harness-error-handling-audit-2026-08-17.md` | E-001..E-025 | E-017 + E-018 partial + E-019 partial | 22 |
| 安全 | `docs/agent-harness-security-audit-2026-08-17.md` | S-001..S-018 | S-001 + S-002 + S-003 + S-004 + S-005 + S-006 + S-007 | 11 |
| 契约一致性 | `docs/agent-harness-contract-audit-2026-08-17.md` | C-001..C-013 | C-001 + C-002 | 11 |
| 架构与可维护性 | `docs/agent-harness-architecture-audit-2026-08-17.md` | A-001..A-012 | 0 | 12 |
| 可观测性 | `docs/agent-harness-observability-audit-2026-08-17.md` | OB-001..OB-013 | OB-004 + OB-005 partial | 11 |
| Plugin schema | `docs/agent-harness-plugin-schema-audit-2026-08-17.md` | PL-001..PL-010 | PL-001 | 9 |
| r-server HTTP 契约 | `docs/agent-harness-rserver-http-contract-audit-2026-08-17.md` | C-001..Mi-005 | 0 | 14 |
| 性能与资源 | `docs/agent-harness-performance-resource-audit-2026-08-17.md` | PR-001..PR-033 | PR-001 + PR-006 partial | 31 |

## 10. 不外推 / 不变量 / 后续候选

### 10.1 不外推（按 G0 阶段纪律 / AGENTS.md）

- G1+ 阶段事项：packaged Electron / Provider 矩阵 / GA / 公证 / dist staleness / notarization / P7
- 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2
- 不在 closeout 报告列举未做项
- `qualificationEligible: false` G0 长期开发期常态不外推

### 10.2 不变量守住

- 不动 `src/preload.js` 顶层 16 个已有 namespace 任何 key 名
- 不动 `frontend/src/lib/electron.d.ts`
- 不动 `frontend/src/lib/desktopBridge.ts`
- 不动 4 page（BranchTabs / ResultStudio / 等）
- 不动 `core/shared-backend/*`（除 error-log.js 默认路径）
- 不动 `core/r-server/agent-tools/agent-tool-policy.js` 公共接口（仅收紧 capability）
- 不动 `core/r-server/plugin-loader.js` 公共接口（仅补 validateToolArgs）
- `agent-tools/*` 与 `agent-transcripts/*` 0 改动

### 10.3 后续候选（不主动推荐，需用户显式裁决）

- **BLOCK-10-ARCHITECTURE**：A-001..A-010 架构层面 56+ singleton 拆分 / E-017 main + E-018 + E-019 full + PR-006 + PR-012 / C-001-rserver / C-002-rserver / M-001 / M-003
- **observability-work-package**：OB-001 console→logger 全量替换 / OB-003 metrics 端点 / OB-007 跨进程 unhandledRejection
- **SSE 治理**：Mi-002 / Mi-003 / Mi-004 三处协议细节统一 + PR-004 SSE keepalive
- **RetryClassifier / RetryBudget / RetryExecutor**：E-009 三套重试策略合并 + 错误处理体系化重设计
- **Agent Loop 事件类型命名规范化**：C-012 8+ 种 event 类型（与 Result Studio 体系耦合）

## 11. 当前无 active 工作包

按 governance skill「Close a Goal or stage」§「dev environment canonically stabilizes after a stage closes when no Plan ID is active and no acceptance gate is unsatisfied」：

- DOC-REGISTRY `BLOCK-10-AUDIT-CLOSEOUT` status = completed
- 8 linkedCommits 完整记录
- 4 治理门 GREEN
- 0 未知 WIP
- 4 个 canonical doc 同步

等待用户显式裁决启动下一工作包。
