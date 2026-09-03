# BLOCK-54 — 终端升级：yield 中间档 + 多 Tab 用户终端

> 状态：`planned`（候选，待用户裁决启动；当前 active 为 NONE，排队 BLOCK-51 之后）
> 立项日期：2026-09-03（用户裁决「按这个方案立项并固化成 plan 文档」）
> truthDomain: `block-54-terminal-upgrade`
> 来源：codex unified exec 终端架构调研（本会话）；前置：BLOCK-51 P4 已修复终端崩溃（mainWindow 形态错配），本包不重复该修复

## 1. 背景

### 1.1 调研结论（codex unified exec 设计）

| 设计点                   | codex 做法                                                                                                      | 证据                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 会话模型                  | `exec_command`（默认 Interactive）+ `write_stdin`（按 session\_id 续聊/空写=后台轮询）                                       | `core/src/tools/handlers/unified_exec/exec_command.rs` / `write_stdin.rs`  |
| **yield\_time\_ms** ⭐ | 等到产出或超时（默认 10s，范围 250ms-30s）即交还控制权 + 返回 session ID——长命令不傻等不阻塞                                                 | `shell_spec.rs` L28-54；`MAX_YIELD_TIME_MS = 30_000`                        |
| 多会话                   | 进程表 HashMap + **上限 64**（`MAX_UNIFIED_EXEC_PROCESSES`），超限 `over_limit` 诚实拒绝；退出时 `terminate_all_processes` 全量收割 | `unified_exec/mod.rs` L82 / `process_manager.rs` / `tasks/mod.rs` L884-897 |
| 输出预算                  | `max_output_tokens` 默认 10000 + policy 封顶（token 级而非字节级）                                                        | `shell_spec.rs` L59-63                                                     |
| 审批                    | ExecCommand/WriteStdin 独立审批语义（命令/cwd/sandbox/pid）                                                             | `tools/approvals.rs` L65-89                                                |

### 1.2 BioF3 现状差距

**模型侧**（`workspace_exec`，BLOCK-33 建）：一次性命令 + 后台变体（exec\_background + 进程表 + process\_status/stop）——后台化领先 codex，但缺「yield 中间档」：同步等到完 vs 转后台的二元选择中间没有「等 10 秒没完就交还控制权」；输出为字节级截断（8KB cap）而非 token 预算。

**用户侧**（底部面板终端，刚修崩溃的那个）：`terminal.js` 单例 `let shellProc = null`——`session-start` 已有会话直接 `reused: true` 返回，结构上写死只能一个；前端 xterm 单实例。多项目工作台的真实需求（一个终端跑 dev server、一个进 R 环境）无法满足。

## 2. 方案

### 2.1 P1 — 模型侧：workspace\_exec yield 中间档（对齐 codex yield\_time\_ms）

- `workspace_exec` 工具参数新增 `yield_ms`（默认 10000，范围 250-30000，超范围钳制）：命令启动后等到产出或超时——完成则返回完整结果；超时则返回 `{ yielded: true, processId }`（挂入既有后台进程表），模型可用既有 `process_status` 轮询收尾

- **与 exec\_background 正交**：background 是「一开始就不要等」，yield 是「等了但没等到」——两者共用进程表与 process\_status/process\_stop，0 重复设施

- 输出截断升级：保留字节硬顶防 UI 爆炸，新增 `max_output_tokens`（默认 10000，policy 封顶）token 级预算截断（复用 BLOCK-20 token-estimator 估算），截断时诚实标记

- tool-defs / registry 工具描述同步（模型须知道新语义）；agent-tool-policy 审批链不变

### 2.2 P2 — 用户侧：底部终端多 Tab（上限 4）

- `terminal.js` 单例 `shellProc` → `Map<sessionId, proc>`；IPC 通道全量带 `sessionId` 参数（additive：旧调用不带 sessionId = 默认 tab，向后兼容）

- 新增 IPC：`terminal:session-list`（tab 清单：id/cwd/pid/活跃状态）

- 前端底部面板：xterm 多实例 tab 条（+ 新建 / × 关闭 / 点击切换；每 tab 独立 cwd，新建时默认当前项目 workspace）

- **上限 4**（对齐 codex 64 上限的哲学但 GUI 取小值）：第 5 个 tab 诚实拒绝并提示

- 退出清理：`before-quit` 遍历 Map 全量 kill（对齐 codex `terminate_all_processes`）

- resize/write/data/exit 事件按 sessionId 路由（renderer 侧同 tab 对齐）

### 2.3 非范围

- write\_stdin 式「模型续聊已 yield 会话」（yield 后走既有 process\_status，够用；统一 write\_stdin 留候选）

- 终端分屏（split pane）

- 终端会话跨应用重启持久恢复

- 0 新 npm 依赖（xterm 多实例能力已有）

- 不动 BLOCK-51 范围文件（main.js mainWindow 兼容对象已由其 P4 修复）

## 3. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + roadmap/README + AUDIT-LOG 登记。

- **P1 模型侧 yield**：workspace\_exec yield\_ms 参数 + 进程表挂入 + token 预算截断 + tool-defs 同步；后端定向 node --test（yield 短命令完整返回 / 长命令 yielded+processId / process\_status 收尾 / 超范围钳制 / token 截断标记）。

- **P2 用户侧多 Tab**：terminal.js Map 化 + IPC additive + 前端 tab 条；定向测试（多会话并存/上限拒绝/退出全量 kill/事件路由）。

- **P3 门禁**：定向 vitest + tsc + `docs:check` + `ui:audit:check`；新 UI 编号同提交登记台账。

- **P4 dev Electron 实机**：模型侧真实长命令 yield→轮询收尾；用户侧开 3 个 tab 各跑命令、独立 cwd、关闭 tab 进程回收、退出无孤儿 pty；证据 `acceptance/block-54/`。

- **P5 收口**：台账回写 + registry completed。

## 4. 验收门

- P1：短命令（<1s）完整结果无 yielded 标记；长命令（>10s）10s 处返回 yielded+processId；process\_status 可收尾；yield\_ms 超范围被钳制不报错；输出超 token 预算时截断+标记。

- P2：4 tab 并存各自独立进程；第 5 个拒绝；关 tab 进程即回收；退出应用 0 孤儿；旧调用形态（不带 sessionId）不回归。

- 治理：`docs:check` + `docs:reconcile` 收口必跑。

- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 风险与对策

| 风险                               | 对策                                                             |
| -------------------------------- | -------------------------------------------------------------- |
| pty 多实例 fd 泄漏（关 tab 未 dispose）   | P2 关闭路径走 disposeShellData/Exit 同款清理 + 实机验证 0 孤儿                |
| yield 会话与 exec\_background 进程表冲突 | 共用同一进程表（键生成规则统一），P1 实施时对齐 agent-workspace-exec-background 既有测试 |
| 前端 xterm 多实例内存                   | tab 上限 4 + 关闭即 dispose（terminal.dispose()）                     |
| IPC additive 兼容                  | 旧调用不带 sessionId 走默认 tab（既有单会话语义不变），回归测试锁定                      |

## 6. 进度记录

- 2026-09-03 P0（planned 登记）：用户裁决立项；方案源自 codex unified exec 调研（yield\_time\_ms 中间档 / 64 会话上限哲学 / token 预算输出）对比 BioF3 差距（模型侧缺 yield、用户侧终端单例）；本计划落盘并注册 DOC-REGISTRY；排队 BLOCK-51 之后。

