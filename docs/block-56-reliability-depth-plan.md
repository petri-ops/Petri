# BLOCK-56 — 可靠性纵深：模型降级 + 沙箱中间档 + 上下文保鲜

> 状态：`active`（2026-09-04 用户裁决启动，当前唯一 active 工作包；P1→P2→P3 串行实施）
> 立项日期：2026-09-03（用户裁决「四个新发现单独开一个 block」）
> truthDomain: `block-56-reliability-depth`
> 来源：codex 第四轮调研（compact\_model\_fallback / sandbox\_tags / context\_manager / memories）+ BioF3 上下文审计遗留观察项

## 1. 背景

codex 第四轮调研新发现四项机制，共同主题是**可靠性纵深**——坏情况发生时任务不报废：

| # | 发现                  | codex 实现                                                                                                                                                                                                                           | BioF3 现状                                                                              | 价值        |
| - | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- |
| ① | **模型降级链路**          | 双层：模型级（InvalidRequest/ContextWindowExceeded/ServerOverloaded/UsageLimitReached 等错误触发当前→备用模型切换，`compact_model_fallback.rs` L8-64，遥测 `codex.compaction.model_fallback` 打 tag）+ 传输级（WebSocket 耗尽重试预算→强制切 HTTP，`client.rs` L2071-2085） | DeepSeek 单 provider，模型挂任务挂（BLOCK-38 只能中断续跑，不能换模型续命）；retry\_pending 已有链路，缺 fallback 维度 | ⭐⭐⭐       |
| ② | **沙箱中间档**           | 显式策略等级 `read-only / workspace-write / danger-full-access`（`sandbox_tags.rs` L58-105，按 PermissionProfile/filesystem/network policy 输出标签）                                                                                            | read/full 二档 + commandVerdict 黑名单——full 是全开，缺 `workspace-write`（允许写项目目录、禁系统其余）        | ⭐⭐        |
| ③ | **上下文保鲜（stale 检测）** | rollback 混合上下文时 fallback full reinjection 而非 diff stale baseline（`context_manager/history.rs` L451-455）                                                                                                                            | 双方均无 stale 文件检测（上下文审计已确认为行业共性盲区）——工具结果里的旧文件内容，磁盘改了模型仍信旧                               | ⭐⭐        |
| ④ | **跨 session 记忆**    | memories 双阶段：rollout 提取结构化记忆 + 全局合并（`memories/README.md` Phase 1/2，lease/claim 防重复）                                                                                                                                                | 半成品：`helpers/memory-vectors.js`（向量检索形态）+ `ai-memory.js` 路由——缺「经验积累」语义层                | ⭐⭐（登记不实施） |

**生信场景的降级价值特别突出**：30 分钟 R 分析跑完，最后总结阶段模型挂了——降级到备用模型保存成果，远好于整任务报废重跑。

## 2. 方案（三项实施 + 一项登记）

### 2.1 P1 — 模型降级链路（F1）

- **触发面**：模型调用失败分类（复用/扩展 `ai-chat` 与 agent loop 的错误归类）：可降级类 = 超限（ContextWindowExceeded）/ 服务端（ServerOverloaded/5xx 持续）/ 配额（UsageLimitReached）；不可降级类 = 参数错误（InvalidRequest，多半是请求本身问题，换模型没用）

- **降级语义**：任务级 fallback 标记——失败时可降级错误 + 用户配置了备用模型（ai-settings 已有多 profile 能力）→ 当前 task 切换 profile 续跑（复用 BLOCK-38 resume 链路：resume 时带 `fallbackFromProfile` 标记，切换 profile 而非同 profile 重试）

- **诚实纪律**：降级发生时事件通知用户（`model_fallback` 事件进 task\_events，前端任务条显示「已降级到 X 模型」）；agent 最终回答附降级说明。对齐 codex 遥测 tag（reason/previous/current/outcome）

- **边界**：不做自动多级连环降级（A→B→C 链）——单级即可，连环降级掩盖真实故障

- **provider 层不动**：传输级 fallback（WS→HTTP）不适用（BioF3 走 HTTP SSE，无 WS 主传输）

### 2.2 P2 — 沙箱中间档 workspace-write（F2）

- accessMode 三档：`read / workspace-write / full`（additive：既有 'read'|'full' 字符串不变，新增 'workspace-write'）

- 语义：允许 workspace\_\* 写工具限定项目目录（resolveWorkspaceTarget 沙箱已保证），**禁止**系统其余写面（workspace\_exec 白名单收紧到项目 cwd + 命令黑名单维持）+ 进程/网络面维持 full 的收紧版

- 前端 accessModeValidator 同步三档（拦截清单按档位矩阵化）

- 默认档位不变（保持现状 full 默认，workspace-write 为用户/计划模式可选——与 BLOCK-55 P1 的 plan 模式天然衔接：plan 批准后可给 workspace-write 而非直接 full）

### 2.3 P3 — 上下文保鲜（F3，轻量版）

- `workspace_read` 工具结果附内容指纹（sha256 前 8 位，计算成本毫秒级）

- agent loop 内存 map：`path → {hash, readAt, iteration}`；再次读同文件时：hash 相同 → 结果附 `unchanged: true` 提示模型免重述；hash 变 → 结果附 `changedSinceLastRead: true`（模型自判是否重读）

- **不做**：自动重读/自动失效旧内容（模型裁决权保留，对齐「不硬冲」纪律）；rollback reinjection（BioF3 无 rollback 语义，不引入）

### 2.4 F4 — 记忆系统（仅登记，不实施）

- 半成品资产在（memory-vectors + ai-memory 路由）；「经验积累」语义层设计留候选（与 BLOCK-49 二期 agent\_type 专长模板有天然衔接，届时一并评估）；本包只在 plan 记录，不动代码

## 3. 非范围

- 传输级 fallback（WS→HTTP）——无 WS 主传输，不适用

- 多级连环降级链

- 记忆系统实施（F4 仅登记）

- 自动重读/上下文自动失效（P3 只标记不决策）

- 0 新 npm 依赖

## 4. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + roadmap/README + AUDIT-LOG 登记。

- **P1 模型降级**：错误分类 + 任务级 fallback 续跑 + 事件通知 + 前端任务条显示；定向测试（可降级类触发/不可降级类不触发/无备用模型诚实失败/降级标记进 task\_events）。

- **P2 沙箱中间档**：三档 accessMode + validator 矩阵 + exec 收紧；定向测试（三档工具拦截矩阵/既有 read·full 零回归）。

- **P3 上下文保鲜**：read 指纹 + loop 内存 map + 标记语义；定向测试（同文件未变/已变/新文件三态）。

- **门禁**：各阶段定向测试 + tsc（前端动）+ `docs:check` + `ui:audit:check`。

- **实机**：P1 造一次 provider 故障验证降级链路（可用假 profile 指向不可用端点）；证据 `acceptance/block-56/`。

- **收口**：台账回写 + registry completed。

## 5. 验收门

- P1：可降级错误 + 有备用 → 自动切 profile 续跑且用户可见降级标记；无备用 → 诚实失败（现行为）；不可降级错误 → 走既有重试/失败链（零回归）。

- P2：三档矩阵测试全绿；既有 read/full 行为零变化。

- P3：三态标记正确；性能（大文件 hash）不显著增加工具延迟。

- 治理：`docs:check` + `docs:reconcile` 收口必跑。

- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 风险与对策

| 风险                                | 对策                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------- |
| 降级掩盖 provider 真实故障                | 单级降级上限 + 降级后仍失败则诚实报错（不循环）；降级事件必达用户                                              |
| workspace-write 档位语义模糊（什么算"系统写面"） | P2 实施时列显式矩阵表进 plan 附录（哪些工具哪个档位放行），不靠模糊判断                                        |
| read 指纹对二进制/大文件成本                 | sha256 流式计算 + 大小上限（超限跳过指纹只标记 size）                                              |
| 与 BLOCK-55 plan 模式档位交叉            | P2 的 workspace-write 是 BLOCK-55 P1 批准后可选档——两者衔接关系写入各自 plan，实施时对齐顺序（建议 55 在前或同期） |

## 7. 进度记录

- 2026-09-03 P0（planned 登记）：用户裁决「四个新发现单独开一个 block」；三项实施（模型降级/沙箱中间档/上下文保鲜）+ 一项登记（记忆系统）；主题=可靠性纵深（坏情况任务不报废）；本计划落盘并注册 DOC-REGISTRY；排队 BLOCK-51 之后。

- 2026-09-04 P0（启动登记）：用户裁决「启动 BLOCK-56 可靠性纵深」；当前唯一 active 工作包，P1→P2→P3 串行。

- 2026-09-04 P1（实施收口）：纯策略 `helpers/model-fallback-policy.js`（三可降级类/不可降级类/resume 消息合成）+ 编排 `helpers/agent-fallback.js`（三重闸单级不连环 + BLOCK-38 resume 形态续跑 + 并发槽对齐）+ gateway `disableFallback` 参数 + agent-runner 失败链触发点 + 前端 `conversationRunStore`（请求级 notice / 任务级无缝切订阅）。定向测试：`test/block56-model-fallback.test.mjs`（14 it）+ `test/model-gateway.test.mjs` 增 disableFallback 用例（27/27）+ 前端 `conversationRunStore.test.ts` 增 2 用例（35/35）+ tsc 通过。

- 2026-09-04 P2（实施收口）：三档 accessMode additive 落地。`scientific-task-spec.js` ACCESS_MODES 增 `workspace-write`；`agent-runner.js`/`routes/ai-agent/chat.js` 档位透传（未知值维持塌缩 full）；`agent-execution-policy.js` allowExecution 按 §A 矩阵；`agent-tool-policy.js` workspace-write 白名单（项目写 + 前台命令，其余 execution/state-write 面拒绝为新错误码 `access_mode_workspace_write`）；`workspace-tools.js` preflight/handler 前台命令放行（黑名单 + cwd 限项目根维持），后台进程/进程停止维持 full 专属；前端 `copilotContext.ts`/`useChatStream.ts` 类型、`accessModeValidator.ts` 三档矩阵、`SimpleChat.tsx` 档位菜单（完全访问/项目写/只读）。定向测试：`test/accessmode-validation.test.mjs` 增三档矩阵（14/14）+ 前端 `accessModeValidator.test.ts` 新建（4/4）+ 沙箱回归 37/37 + exec 回归 56/57（唯一失败 `agent-tool-result` 为预存环境问题：测试用未迁移 tmp DB 直载 db.js，HEAD 基线同失败，与本包无关）+ tsc 通过。

- 2026-09-04 P3（实施收口）：`helpers/context-freshness.js`（纯函数：fingerprintOf 前 8 位切片 + createFreshnessTracker 内存 map 三态 + applyFreshnessMark 零副作用增强）+ `loop-orchestrator.js` execute 接缝（workspace_read 结果增强，事件与模型消息共用）。成本边界：readFile 只对 ≤MAX_TEXT_FILE_BYTES 文本文件返回 sha256，指纹为切片零额外哈希成本（二进制/超大文件走既有错误路径天然无需指纹）。不做自动重读（模型裁决权保留）。定向测试：`test/block56-context-freshness.test.mjs` 三态 + 边界 + 真实 workspace_read 集成（7/7）；loop-orchestrator 回归 46/46。

- 2026-09-04 实机（P1 降级链路真链路验证）：`scripts/block56-live.cjs`——本地双 mock OpenAI-compatible 端点（deepseek 真协议，primary 可注入 500/400/401 故障，backup 正常 SSE），真设置落盘（临时 BIOF3_LOCAL_DATA_DIR）+ 真 DB（BIOF3_DB_PATH）+ 真分类 + 真配置解析。14/14 断言全 PASS，证据 `acceptance/block-56/model-fallback-live.json`：A 请求级（500 → gateway 内切备用 + model_fallback 事件 + fallbackFrom 溯源）；B 任务级（400 context 超限 → 请求级不动（isRetryable=false 分工正确）→ 任务失败 → 真分类 context_window → 真建续跑任务（fallbackOfTaskId 溯源）→ 备用端点真完成 + disableProviderFallback=true + 恢复指令注入（系统注入/原消息/进度摘要/降级注明）→ 单级不连环闸 already_resumed）；C 不可降级（401 → not_degradable 诚实失败零回归）；D 未启用配置 → no_fallback_profile 诚实失败。UI 台账同步：UI-287（降级任务条显示）/ UI-288（档位三选菜单）in_progress 待 dev Electron 实机。

## 附录 A — workspace-write 三档工具矩阵（P2 权威语义）

| 面 | read | workspace-write | full | 裁决层 |
| --- | --- | --- | --- | --- |
| 只读工具（workspace_read/list/find/search、process_status、system_info 等 sideEffect none） | ✅ | ✅ | ✅ | 无需 gate |
| 项目内写（workspace_write / workspace_replace；resolveWorkspaceTarget 沙箱限定项目根 + 源数据不可变 + sha256 覆写纪律维持） | ❌ `access_mode_read_only` | ✅ | ✅ | policy L136/L148 |
| 前台命令（workspace_exec；commandVerdict 黑名单维持 + cwd 限项目根） | ❌ | ✅ | ✅ | policy L183 + preflight + handler |
| 后台进程（workspace_exec_background / process_stop） | ❌ | ❌ `access_mode_workspace_write` | ✅ | policy L148 + preflight + handler（`!== 'full'` 原样） |
| 插件执行委托（run_tool op=run，delegatedApproval） | ❌ | ❌ | ✅ | policy L148 |
| 系统写面（act、plan 落库、result_changeset_adopt/revert/restore 等 state-write/execution） | ❌ | ❌ | ✅ | policy L148 |
| 只读 op 白名单（run_tool list/plan/status/next/bind_artifact、plan list/get） | ✅ | ✅ | ✅ | effectiveOperation 原样 |
| ctx.allowExecution=false（用户明确"只检查/只规划"） | ❌ | ❌（覆盖中间档） | ❌ | policy L128 原样（最高优先） |

- 默认档位不变：accessMode 缺省/未知值 → full（既有二档行为零变化）。
- 与 BLOCK-55 衔接：plan 模式批准后可授予 workspace-write 而非直接 full（衔接语义记录于各自 plan，实施时对齐）。

