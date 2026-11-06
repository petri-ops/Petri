---
capability: block-360-nso-w2-security-admission
status: completed
goal: NSO-W2 安全准入、IPC 与数据真值——在保持 workspace_exec 默认放行裁决的前提下，把「策略判定」与「真正执行」焊成可审计闭环：IPC sender guard 全局强制、审批令牌在执行边界校验消耗、exec token 收窄为 per-call、DB 连接与迁移单源化并补退出 checkpoint、产物链哈希、MCP health 降级可见。
acceptance:
  - 所有 ipcMain.handle 经统一包装器强制 sender 校验（webview guest / 未知 origin 即拒），file-dialog workspace:write-text-file 的 root 改由主进程反查
  - IPC 双向集合相等门禁（preload 字面量正则抽取 vs channels.js，glob 枚举 CONSUMERS）
  - 一次性 capability token 在执行边界（tools-executor / run-plugin-script / SSH runner）校验并消耗；参数改写、过期、跨 task 重放拒绝
  - PETRI_WORKSPACE_EXEC_TOKEN 改 per-call handlerOptions 注入，不下沉子进程 env；默认放行裁决不变，风险提示/审计/严格模式可发现性有测试
  - DB pathResolver/pragma 语义单源 + 桌面/核心两侧 parity 契约测试（R3/R5 架构墙内的单源化形态）；迁移文件名数值排序+重号 fail-fast；will-quit closeAll + WAL checkpoint
  - revision 链哈希与 deliver manifest 产物重算可由独立校验器复算（范围允许时落地，否则显式移交）
  - MCP registry 初始化失败汇总 health{degraded,reasons}，listTools/callTool 不再宣称完整可用
  - 每项含负测（无 guard 拒绝 / token 重放拒绝 / 参数改写拒绝 / 篡改 manifest fail-closed）
reopen: 波次范围变化或 capability token 设计裁决点出现时由用户重新发令
---

# BLOCK-360 · NSO-W2 安全准入、IPC 与数据真值

> 蓝图依据：[`next-stage-optimization-blueprint-2026-11-06.md`](./next-stage-optimization-blueprint-2026-11-06.md) §5。前置：W0 交付已提交（`699a4ea8`）；W1 因在制批处置待裁决而挂起，本波按文件面零交集先行（仍串行，不并行）。

## 1. 关键设计裁决（本包自决，留痕）

- **D1 sender 信任谓词（全局拦截器）**：`origin ∈ PETRI_TRUSTED_DESKTOP_ORIGINS`（env-coordinator 已覆盖 dev Vite 双变体 + packaged rendererPort 双变体）∪ 自家 `file:` 协议窗（computer-use PiP）。webview guest（persist:petri-browser 远程页）origin 不在集合 → 拒。env 惰性读取（每事件现读），空集合 fail-closed。实现于 `src/ipc/_ipc-registry.js` 纯函数 + `guardedHandle` 包装器。
- **D2 DB 单源化形态**：R3/R5 架构墙（src 禁 require core、core 禁 require src）使字面单文件不可行；采用「同一语义 + parity 契约测试」——`src/database/db-connection.js`（桌面）与 `core/petri-server/db/connection.js`（核心）各自实现同一 precedence（PETRI_DB_PATH > PETRI_LOCAL_DATA_DIR/petri.db）与同一 pragma 集，`test/nso-w2-db-parity.test.mjs` 对同一 env 矩阵断言两侧产物一致（漂移即红）。
- **D3 exec token**：`PETRI_WORKSPACE_EXEC_TOKEN` 从进程级 env 门槛改为 per-call `handlerOptions.execToken` 注入；不下沉子进程 env；**默认放行裁决不变**——token 仅是「命中即跳过风险正则」的合法出示通道收窄，缺 token 走既有默认放行+风险提示路径。
- **D4 capability token**：复用 approval-request-store 的 once/task 决策面（不建第二审批链）；批准时签发一次性 token（fingerprint/ctxSnapshot/TTL），执行边界校验并**消耗**（重放即拒）。

## 2. 非范围

- workspace_exec 黑名单默认放行裁决不回退（只补 per-call token、审计、严格模式可发现性）
- 在制批文件面（loop-orchestrator/model-gateway 等 22M+10??）零触碰
- 不新增依赖；不建第二审批链（approval-request-store 是唯一决策面）

## 3. 验收门禁清单

见 front-matter acceptance。证据落 `acceptance/nso-2026-11-06/wave-2/`。

## 4. 交付与移交（2026-11-06 收口）

| 项 | 状态 | 证据 / 提交 |
| --- | --- | --- |
| W2-1 全局 IPC sender 信任门 + workspace 根反查 | ✅ | `src/ipc/_ipc-trust.js`、`src/ipc/_workspace-roots.js`；契约 7/7 + 4/4；`2d5bce4f` |
| W2-2 IPC 双向集合相等门 | ✅ | `test/ipc-channels-registry.test.mjs` 8/8；glob 首扫抓到 `desktop-shell.js` 两处手写已登记通道并修正；`2d5bce4f` |
| W2-3 exec 令牌收窄（F-04 红测实证：env 令牌下沉子进程 + 严格模式绕过） | ✅ | `commandVerdict` 迁 internals 单源；per-call 令牌；子进程 env 剥除；风险进工具结果；4/4 + 相邻 62/62；`2d5bce4f` |
| W2-4 DB 策略单源 + 迁移定序 + 退出 WAL 收敛 | ✅ | `core/shared-backend/db-connection-policy.js` 三处消费；重号/非法名 fail-fast；will-quit `closeAll({checkpoint:true})`；8/8；`741d095e` |
| W2-6 MCP registry 降级可见 | ✅ | `getRegistryHealth()` + listTools 逐工具 health；3/3 + MCP 26 套件 184/0；`64a6c99f` |
| W2-5 执行边界一次性 capability token | ⏸ **显式移交（撞未决设计点）** | 见 §4.1 |
| W2-7 revision/manifest 链哈希 + 独立校验器 | ⏸ **显式移交（数据模型变更）** | 见 §4.2 |

### 4.1 W2-5 移交设计（触发条件 = 用户裁决「外部 MCP 主体档位协商方案」）

- **阻断原因**：执行边界（tools-executor / run-plugin-script / SSH runner）强制出示 token 时，外部 MCP 调用方（Cursor/VSCode 经 stdio）没有 Petri `accessMode` 会话、也不经 agent 拦截器——不先定档位协商就会造「外部 IDE 永远被拒」假门。BLOCK-346 T5 已把同一问题登记 reopen（协议层改造）；本批同时更正 W0 对该票的过度核销（AUDIT-LOG 🟡 已恢复）。
- **既有闭环（不重复建）**：agent 路径已由 `agent-tool-interceptor` 在执行前消耗 once 指纹（`consumeFingerprint`），参数改写走 `overrides`（原始/生效双指纹审计）——不建第二审批链。
- **建议形态（待裁决后实施）**：拦截器放行时签发 `{ token, toolName, effectiveFingerprint, ctxSnapshot, expiresAt }` 经 handlerOptions 下传；三执行入口校验 + 消耗；主体分类 `agent`（必须 token）/ `human-ui`（路由层会话即授权）/ `external-mcp`（握手期协商档位后按档位映射）；负测=重放、参数改写、过期、跨 task。

### 4.2 W2-7 移交设计（触发条件 = 排期到数据模型批；迁移需单独评审）

- revision 增 `prev_chain_hash` / `chain_hash = sha256(prev + canonical(revision))` 需新迁移 + 存量回填（回填对历史 revision 只能证明「回填时刻起」的链完整）；deliver manifest 改为重算产物字节 sha256 + `prevManifestHash`；独立校验器 `scripts/verify-artifact-chain.mjs`（只读复算，篡改 fail-closed）。
- 不在本批做的理由：迁移 + 回填 + 导出格式变更属数据模型面，需与 Result Studio（implemented_unverified）证据重打节奏对齐，单独成批更安全。

### 4.3 收口判定

- **completed（带例外）**：交付 5/7 项；W2-5 / W2-7 显式移交且写明触发条件，不宣称完成；蓝图 §5.3 出口中「三执行入口出示并消耗 capability token」「全链哈希可复算」两条**未达成**。
- closeout 在当前树的红项全部归因：在制批绑定（model-surface / P6）、C-46（p4r）、并发写入者的 UI 台账改动（BLOCK-332 两项）、存量环境项（NEXT-03）。
