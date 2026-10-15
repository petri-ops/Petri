# 全层对标蓝图：后端 harness × 前端界面（ZCode / Codex / Petri）· 2026-10-15

> **性质**：reference 态细粒度对标（承接 [评估报告](./Petri-Desktop-Evaluation-Report-2026-10-15.md) 的方向层；本文件是**执行层的施工图**）。执行仍按评估报告 §5 五阶段队列推进，本文件不新开工作包、不改队列。
> **方法**：六路只读清点（ZCode 后端/ZCode 前端/Codex 后端/Codex 前端/Petri 后端/Petri 前端），每格产出机制级清单 + 代码锚点；本文件的对照与判定由主代理统一完成。
> **纪律**：G0 开发期 · 不外推 packaged/Provider/GA；模式借鉴零代码拷贝（两参照库 Apache-2.0）；不把「对照差异」直接等同于「应补」（§5 有筛选判据）。

---

## 0. 三个反转性发现（先纠正既有认知）

| # | 发现 | 证据 | 含义 |
|---|---|---|---|
| R1 | **Petri 的 loop 工程化领先于两家** | `loop-contract.js`（SHA-256 稳定哈希账本 + actionKey 幂等 + 落库前强制脱敏）、`loop-controller.js`（observe→decide→validate→record→evaluate 纯函数链）、`loop-validators.js`（四态 valid/degraded/blocked/unavailable）、`loop-repair-strategy.js`（10 fault × 12 repair 策略 + 严格修复边界）、`loop-checkpoint.js`（IterationCheckpoint + ContextEnvelope）、七张 loop_* 账本表 | ZCode 有 turn 状态机、Codex 有 rollout，但**「loop 契约+控制器+修复策略+检查点」四件套两家都没有**。这是「可审计的 agent 魂面」核心资产，方向应是**接线与产品化**（detectOscillation/detectNoProgress 未接主链、汇报门默认关）而非重建 |
| R2 | **Petri 的成果面 + 设计系统棘轮领先** | viewer 注册表 9 类 + 能力位 + 选择总线 + 血缘三态 + changeset 审阅 + 分屏（ZCode 无同等成果面，Codex 无）；design charter 四棘轮（字号/色彩/border/motion）+ 契约测试门禁（ZCode 只有 DESIGN.md 约定无门禁） | 差距不在「有没有」，在**发现率与入口**——评估报告「功能发现率 2.5~3/5」判词成立 |
| R3 | **Petri 的传输面已接近两家水平** | `/m/api/ws` 信封族（sub/ev/done/data/data-res/data-err/ping）+ afterSeq 水位 + 2s 兜底轮询 + 事件总线即时推送（500ms→0）+ 数据桥 WS-first 逐请求回退 | 缺口只剩两项小的：**投递模式可信标记**（ZCode clientMode/deliveryProfile 强校验）与**帧间隙检测**（ZCode relay frame gap） |

---

## 1. 三方架构总览

### 1.1 后端 harness 分层

| 层 | ZCode | Codex | Petri |
|---|---|---|---|
| 协议/事件 | `contracts/session.events.ts` 约 **90 类** SessionEvent + 统一信封（id/sessionId/turnId/traceId/sequenceNumber/payload）；V3/V4 双线协议 | `Op`(30) ⇄ `EventMsg`(84) + `ResponseItem`(17) + `ResponseEvent`(17)；app-server JSON-RPC v1/v2 + TS SDK | `task_events`(task_id, seq, event_type, payload) 单调 seq + 终态机 5 态 + 7 张 loop_* 账本；**无统一信封（缺 traceId/turnId）、无事件目录表** |
| 编排 | turn 状态机 10 phase + 非法迁移可诊断错误 + 120 runtime methods | ThreadManager → CodexThread → Session；Submission(Op) 队列 + 4 类 Task + AgentControl 30 模块 | loop-orchestrator 5 闭包状态机；**无 Op/Submission 抽象**（前端直连 HTTP 路由）；spawn 进程内复用 |
| 推理 | turn-loop/turn-model-step + compact 策略对象 + 退避重试 | run_turn → stream → loop；CancellationToken + preempt 双层取消 | loop-orchestrator + 网络瞬断重试 ×2 + finalization 预算（无上界迭代，刻意） |
| 工具 | registry 别名治理 + 执行管线 8 步 + **拓扑排序并行组 + 环检测 + maxConcurrency=10** + 结果落盘截断 | Registry→Router(**暴露面 6 档**)→Orchestrator + 并行能力声明 + schema 压缩 5000B + 输出头尾截断 | 80 工具 + 契约元数据(category/sideEffect/riskTier/cancellable) + **两套元数据并存未接线**（tool-metadata 的 concurrentSafe/timeoutMs/estimatedDurationMs 未被消费） |
| 治理 | permission 6 档 + 12 级优先链 + **alwaysAsk 结构化不可抹掉** + broker 双实现 + hooks 信任 | approval 5 档 + **Granular 布尔矩阵(false=自动拒绝)** + Guardian 隔离子会话二审 + execpolicy 三态 + 逐工具 approval_mode | 四档 × sideEffect × riskTier + 动态三维(cmd/path/memory) + 用户规则 + **审批请求资源化(requestId/指纹放行/TTL)** + commandSpan 单源 |
| 上下文/记忆 | AutoCompactDecision(reason 枚举 + 双 token 源 + 熔断) + microcompact + memory v4（索引截断告警/语义召回/后台提取/dream 锁） | auto_compact 阈值 + scope + post-turn% + prompt 覆盖 + 遥测；AGENTS.md 逐级收集 + 字节预算；memories 两阶段 + 四门控 + claim | microcompact(0.9) + 摘要式 9 章节 + 熔断 10min + rolling(12000/24) + **三层记忆 + 生命周期治理（衰减/纠错/矛盾消解/审计）=治理面领先**；阈值全硬编码；提取/整合无并发仲裁 |
| 持久化 | SQLite 20+ repository + afterSeq 水位 + 背压合并(1500ms/96 条) | ThreadStore 45 方法 + **supports_* 能力协商** + rollout ordinal + reverse scanner + 压缩 + history 软帽 0.8 | task_events 水位续传 + 30 天清扫 + loop 七表；**无能力协商式存储抽象、无归档压缩** |
| 执行 | processTreeTerminator + Job Object + 后台生命周期(auto_on_timeout) + MCP 进程树 | unified_exec PTY + exec-server + 环境五步过滤(默认排敏感变量) + 退出 50ms 关闭帽 | process-lifecycle(TERM 5s→KILL 2s→硬超时 30min→僵尸 10min) + 心跳 30s + 兜底对账器 + R/Python executors + capability 下载 Host 白名单 |
| 计量 | model_usage 表 + 异常守卫（**每 turn 告警封顶 3**） | TokenBudgetConfig 多来源合并 + rollout_budget + get_context_remaining 工具 | ai_usage 18 列 + 每轮 token_budget 事件 + **costCapCny 熔断** + CJK 校准 EWMA；无预算预算/告警封顶 |
| 传输 | Channel RPC + RemoteAuthority + WS/MessagePort + relay frame gap + **clientMode 强校验** | app-server + ClientRequestSerializationScope（缓存键）+ realtime webrtc + code_mode host | mobile-gateway WS 信封族 + SSE 对齐 + 投影桥 + 联邦委托；**缺投递模式标记/帧间隙检测** |
| 扩展 | MCP(stdio/http/sse + OAuth lease + 官方鉴权 wrapper) + 命名规范化 + fail-closed + zod 归一化 + hooks 7 事件 + 插件引用限量 | MCP 24 字段 + 审批四档 + restrict_to 保守交集 + readiness + OAuth + 企业 IdP + hooks 12 事件 + trusted_hash + skills/plugins/apps | MCP v1 stdio(+P3 HTTP) + mcp_ 投影(上限 40) + 执行语义四档 + SKILL.md 双格式 + preflight 三态 + 插件/领域包 + **hooks 仅 task-confirmation 一处（无通用生命周期 hook）** |
| 评测 | case catalog 1500 行 + 七层判据矩阵 + **formal admission 棘轮** + replay/capture fixtures + 残留审计 ratchet | mock SSE server + fixture 工作区 + **context_snapshot Normalizer** + 926 TUI 快照 + blocking-ci | evals-harness(mock/real + 9+3 任务 + 8 判据) + gate 棘轮 + harness-loop 8 脚本 + test:changed impact-map + acceptance 268 证据 |
| 安全 | 凭据 AES-256-GCM(enc:v1) + 递归脱敏 + **peer 不得授权洗白（写进系统提醒）** + gen-ui 转义 | keyring/file/auto/ephemeral + 沙箱模式×后端双层 + writable_roots + **可写根内只读子路径** + trust_level + credential masking | Keychain/0600 文件 + 四路脱敏 + 落库前强制脱敏 + 路径/Host 白名单 + CSP + 权限默认拒绝 + contextIsolation |

### 1.2 前端界面分层

| 层 | ZCode | Codex(TUI) | Petri |
|---|---|---|---|
| 壳与布局 | WorkspaceShellLayout 2948 行 + Sidebar 264px + 独立面板框（会话/终端/SidePane 各自圆角卡片 + 4px resize handle）+ 多窗 tabStore | BottomPane 栈 + 布局降级链（宽度不足逐级丢 hint）+ alternate screen | AppShell（AppRail + main；**无 StatusBar**）+ 列容器路由地基 + /window/* 独立窗（WindowShell 降格×） |
| 工作区组织 | **workspaceKey=identity||path 双轴隔离 + 二叉分屏树（≤4 pane 跨 workspace）+ SidePane 11 种 tab 类型注册表 + 编程/办公双模式** | thread 列表 + worktree stack + side 会话 | AppRail+LeftPanel+CenterPanel+RightPanel（**8 tab 固定**）+ ArtifactPinPane 单分割(20-80%)；无分屏树、无 tab 注册表 |
| 会话时间线 | **以「一轮」为虚拟滚动单位**(@tanstack/react-virtual) + turn navigator + 容器查询(≥1280px) 决定状态面板形态 + 思考块流式自动收起 | stable/tail 双区 + 不变量 + 表格 holdback + fullscreen transcript + auto_recap | 段模型(progress/tools/reasoning/narrative) + collapseWhenSettled + **无虚拟滚动/无 turn navigator/无「还有 N 行」告知** |
| 工具呈现 | **60+ kind renderer 注册表 + Explore/Execute/Changes 三分组**（父组仅展示节点，子工具生命周期独立）+ 输出折叠规则表(≤160 字符/JSON 分支/图片单列) + ModelTrajectory 轨迹查看器 | exec_cell 三档（摘要/实时/完整）+ activity_preview 三行 + 「还有 N 行」 | groupToolActivities（同迭代连续只读合并）+ ToolActivityDock + OrchestrationGraph(xyflow)；**无 kind 注册表/无三分组/无统一折叠规则** |
| 审批交互 | allow_once/allow_project/deny + **deny with feedback** + elicitation 表单 + hook 信任行内按钮 | approve/approve_for_session/approve_for_prefix + ReviewDecision 留痕 + 全屏审批 + 延迟审批队列 + 权限模式循环键 | GuardAckCard 三动作 + requestId 徽标 + commandSpan 高亮 + 两步武装 + 审批记录三态面板；**缺拒绝附反馈/延迟队列** |
| 输入与编辑 | composer + followup 双模 + quickpick 三前缀(`>`/`#`/`@`) + IME 协调 + ControlHintTooltip | composer/editor/chat 三层键位 + prompt 栈 + 历史搜索 + paste burst 协调 + 输入所有权测试 | composer + deliveryMode 双模 + 斜杠三源 + 排队 chips；**无键位设置面/无 IME 协调层/无提示词栈** |
| 设置与命令 | 19 分区 3 组 + 快捷键录制(冲突标红/抢绑确认) + 命令中心(range tabs All/Actions/Tasks/Files) + 六步 onboarding + 外部 Agent 导入向导 | 配置面板(主题/状态栏项/快捷键总览/hooks 浏览器/memories 设置) | 8 分区 + CommandPalette 五源 + 斜杠三源 + ?section/?tab 深链；**无快捷键面/无设置搜索/无引导流程/无外部导入** |
| 设计系统 | DESIGN.md 强约束（text-ui-* 全仓条款/圆角层级/4px 基数/快而低戏剧）+ 语义 token(git 7 态等) + 代码双主题 + 终端 token 组 | effects 六项 + animations 主开关 + MotionMode 降级 + rendering 四开关 + 主题感知 diff | **design charter 四棘轮 + 契约测试门禁（领先）** + accent 5 档 + theme 3 档 + 字号 6 档；缺密度档/对比度档/代码预览专项/动效用户开关 |
| 可观测/可测 | **testid 单一来源 376 常量 + testid 合同（明令「截图不是通过判定」只接受 data-* 确定性信号）+ DOM 状态协议(data-row-kind/data-status)** + 996 testid/678 aria | 926 快照 + VT100 后端 + **键位冲突校验顺序确定化** | 373 testid + 344 aria + 族前缀；**无单一来源常量表、无合同文档、无快照回归** |
| 通知与桌面 | 3s 去重 + requestId 去重 + 并发 100 + 通知音 + 未读 badge(setBadgeCount) + 托盘(win/linux 分平台图标) + 窗口状态 250ms 防抖持久化 + 独立窗口(Resource Manager/About) | notifications(method auto/osc9/bel + **condition unfocused 默认**) + notify 外部命令 + 启动更新检查(20h 节流) | 任务完成单条通知 + updater 四态 + WindowShell 降格/收回；**缺托盘/未读 badge/离焦策略/通知方式/窗口状态持久化** |
| 远程/移动 | Web 远控 + 窄屏两页 shell + **双交付语义强校验(desktop-continuous vs web-remote-replayable)** + Android 原生壳(扫码/前台服务) + relay frame gap 检测 | remote_connection 状态 + app-server 三客户端形态 + IDE 上下文注入 | MobileSync(二维码/设备列表/撤销) + 隧道徽标 + Federation + Jobs Wall + 投影横幅 + 边缘轨道 RailPage；**缺交付模式标记/帧间隙检测** |
| 成果/产物 | PreviewPane 8 类(file/text/patch/image/media/pdf/office/pptx) + diff viewer(@pierre/diffs) + mermaid 串行队列 + 预览卡投影 + 沙箱 UI(inline 240→10000px) | diff 渲染 + transcript | **viewer 9 类 + 能力位 + 选择总线 + 血缘三态 + changeset 审阅 + Gen UI 沙箱(自愈/数据绑定/导出) = 领先**；缺 PreviewPane 统一路由/预览类型惰性升级 |
| 可访问/i18n | 键盘全局生效(cmdk) + IME 防误触 + zh-CN/en-US 7000 行资源 + 16px 移动输入防缩放 | keymap 上下文栈 + screen reader 测试套件 | aria/焦点/role=alertdialog 三层播报 + slider 语义完整；**i18n 全缺（deferred）** |

---

## 2. 后端 harness 逐层差距与升级方向（细颗粒）

| 层 | Petri 现状 | 缺口（细到机制） | 参照锚点 | 价值 | 方向判定 |
|---|---|---|---|---|---|
| 协议/事件 | task_events 单调 seq + 5 态终态 | ①**无统一事件信封**（traceId/turnId/parentTaskId/traceparent 缺）；②**无事件目录表**（类型不可枚举，测试与 UI 靠约定）；③无 delta/快照分层协议 | ZCode `session.events.ts:73`；Codex `protocol.rs:650/1464` | ★★★★ 可观测与可回放的地基 | **学**：加信封字段 + 事件目录（`EVT_*` 常量）+ 契约测试 |
| 编排/推理 | loop-orchestrator 5 闭包；无上界迭代 | ①无 Op/Submission 抽象（前端直连 HTTP，扩展性受限）；②无 Turn 类型化 task（compact/review/user_shell 不共享生命周期）；③**振荡/无进展检测能力存在但未接主链** | Codex `tasks/{regular,compact,review,user_shell}`；`loop-controller.js:26-30` 自述 NOT in scope | ★★★★★ 已有资产未接线 | **自强化**：接线 detectOscillation/detectNoProgress/evaluateExit + Task 类型化 |
| 工具 | 80 工具 + 契约元数据 | ①**两套元数据并存未消费**（tool-metadata vs CONTRACTS）；②**无并行调度**（无拓扑/分组/并发上限/环检测）；③无暴露面分级（direct/deferred/code_mode/hidden）；④结果无落盘截断与持久化预览 | ZCode `tool/scheduler.ts:60,154,204`；Codex `tools/router.rs:40-45` | ★★★★★ 80 工具规模下并发与暴露面是刚需 | **学**：统一元数据单源 + 并行调度器 + 暴露面分级 + 结果预算 |
| 治理/审批 | 四档×三维动态 + 规则 + 审批资源 | ①**无全局档位选择器**（逐条规则）；②无工具黑白名单；③**多来源策略无保守交集合并**（ZCode 12 级优先链/Codex restrict_to）；④无高危二审模型；⑤审批不跨会话（已知取舍） | ZCode `permission/service.ts:101-262`；Codex `mcp_types.rs:28-43`；`core/src/guardian/` | ★★★★ 治理透明魂面延伸 | **借**：全局档位 + 黑白名单 + restrict_to 式交集 + 二审（本地模型） |
| 上下文/记忆 | microcompact+摘要+熔断+三层记忆+生命周期 | ①**阈值全硬编码**（0.9/12000/24/10min）；②压缩**无 reason 枚举与事件带因**；③记忆**提取/整合无 claim 仲裁与并发锁**；④无索引超限告警机制 | ZCode `compact/policy.ts:41,67`；Codex `memories/README.md` + `agent-resilience.js:145` | ★★★★★ 直接影响长任务稳定性与成本 | **借**：参数化 + reason 枚举 + 提取 claim/锁 + 索引告警 |
| 持久化 | task_events + 七表 loop 账本 | ①无存储抽象/能力协商（无法换存储后端）；②无归档/压缩（30 天硬删）；③无 fork/快照复用 | Codex `thread-store/src/store.rs:97-457`；`rollout/` | ★★★ | **学**：能力协商式 store trait + 归档压缩 |
| 执行/进程 | 生命周期四段 + 心跳 + 兜底对账 | ①无环境变量过滤策略（继承全量，含敏感变量风险）；②无 stdin 审批/交互会话；③后台任务无统一类型注册表（取消分派靠 if） | Codex `config_types.rs:232-247`（五步过滤）；ZCode `runtime-task/registry.ts:13` | ★★★★ | **借**：环境继承白/黑名单 + 作业类型注册表 |
| 计量 | ai_usage 18 列 + 熔断 + 校准 | ①无 per-turn 预算/告警封顶（ZCode 3 次封顶）；②无模型可见的剩余预算工具；③无 rollout 级预算提醒 | ZCode `model-anomaly.ts:64`；Codex `token_budget.rs:81` | ★★★ | **借**：告警封顶 + 剩余预算查询 |
| 传输 | WS 信封族 + 水位 + 兜底 | ①**无投递模式可信标记**（桌面连续流 vs 投影可回放流混用风险）；②无帧间隙检测；③WS 无背压合并（1500ms/96 条） | ZCode `zcode-protocol-v4/transport.ts:47,58`；`webRemoteControlRelayProtocol.ts:11`；`zcodeSessionEventCoalescer.ts` | ★★★★ | **学**：clientMode/deliveryProfile + frame gap + 背压合并 |
| 扩展/治理 | MCP 四档语义 + 技能双格式 + preflight | ①**无通用生命周期 hooks**（仅 task-confirmation 一处）；②MCP 无逐工具策略/超时/readiness/OAuth；③投影上限 40 硬编码无分档 | ZCode hooks 7 事件 + OAuth lease；Codex hooks 12 事件 + trusted_hash + MCP 24 字段 | ★★★★ hooks 是生态扩展前提（但产品化定性曾判否） | **借**：hooks（需用户改判）+ MCP 逐工具策略；投影上限做设置 |
| 评测 | evals-harness + gate + 8 判据 | ①**无 context_snapshot 式 prompt/工具 schema 回归**（prompt 一改无从察觉）；②无 fixture replay（capture/replay）；③判据缺 Protocol 层与「无错误横幅」负向 | ZCode formal admission + 七层矩阵；Codex `context_snapshot.rs` Normalizer | ★★★★★ prompt 漂移是隐形质量杀手 | **学**：context_snapshot + replay fixtures + Protocol 判据 + admission 棘轮 |
| 安全 | 脱敏四路 + 落库前强制 + 路径白名单 | ①无信任级别（项目/工作区不信任降级）；②无可写根概念；③无 peer 授权洗白禁令（联邦场景相关） | Codex `project_trust.rs` + `writable_roots` + 可写根内只读子路径；ZCode `system-reminder/incoming-message.ts:6` | ★★★★（联邦+执行面） | **借**：信任级别 + 可写根（应用层，不做 OS 沙箱）+ peer 禁令 |

## 3. 前端界面逐层差距与升级方向（细颗粒）

| 层 | Petri 现状 | 缺口（细到组件） | 参照锚点 | 价值 | 方向判定 |
|---|---|---|---|---|---|
| 壳/布局 | AppShell 两区（无 StatusBar） | ①**无状态栏**（ZCode status_line 项可配 + Codex terminal_title 项可配）；②面板框未独立卡片化（会话/终端/右栏各自圆角边框 + resize handle） | ZCode `docs/design/workspace-independent-panels.md`；Codex `status_line_setup.rs:60` | ★★★ | **学**：状态栏 + 面板框卡片化 |
| 工作区组织 | 固定三栏 + RightPanel 8 tab | ①**RightPanel tab 非注册表**（新增视图要改多处）；②**无二叉分屏树**（ArtifactPinPane 仅单分割）；③无 workspaceIdentity 双轴（路径=身份） | ZCode `paneLayoutTree.ts` + `workspaceSidePane.ts:11-130` | ★★★★ | **借**：tab 注册表 + 双轴身份；分屏树按需（ArtifactPinPane 扩） |
| 会话时间线 | 段模型 + 折叠已到位 | ①**无虚拟滚动**（长会话性能与滚动锚点）；②无 turn navigator（跳转定位）；③无「还有 N 行」渐进披露告知；④表格/流式块无 holdback（宽表重排抖动） | ZCode `ConversationTimeline.tsx`（一轮一单位）+ `v4/ConversationTurnNavigator.tsx`；Codex `table_holdback.rs` + `activity_preview.rs` | ★★★★★ 长会话体验与性能 | **学**：虚拟滚动 + navigator + 三档折叠 + 剩余行数告知 |
| 工具呈现 | 分组折叠 + Dock + DAG | ①**无 kind renderer 注册表**（新增工具特判散落）；②**无 Explore/Execute/Changes 三分组语义**；③输出折叠无统一规则（≤160/JSON/图片分支）；④无轨迹查看器（model-io JSONL） | ZCode `ToolCallBlocks/renderers/`（60+）+ `ModelTrajectoryPane.tsx` | ★★★★ | **学**：renderer 注册表 + 三分组 + 折叠规则表；轨迹查看器=证据自证 |
| 审批 | 三动作 + spans + 两步武装 | ①拒绝**无附反馈**；②无延迟审批队列（权限更新后才展示）；③审批历史无筛选/导出 | ZCode `MAX_PERMISSION_FEEDBACK_CHARS`；Codex `delayed_approval_requests` | ★★★ | **借**：拒绝反馈 + 延迟队列 |
| 输入/编辑 | composer + 双模 + 斜杠三源 | ①**快捷键全硬编码**（无设置面/冲突检测）；②无 IME/paste 协调层；③无提示词栈回退；④quickpick 无前缀模式（`>`/`#`/`@`） | ZCode `useShortcutRecording.ts`+`shortcuts/conflicts.ts`；Codex `prompt_stack_back`+`paste_burst.rs` | ★★★★★ 办公场景刚需 | **学**：快捷键面（含冲突）+ 提示词栈 + paste 协调 |
| 设置/命令 | 8 分区 + 五源命令 | ①**无设置搜索/过滤**；②无全景导出/按区重置；③无 onboarding 引导；④无外部 Agent 配置导入；⑤无状态栏项配置 | 见评估报告 §6 P0-3/P0-4；ZCode onboarding 六步 + 17 种导入 | ★★★★★ | **学**（详见评估报告阶段 A/B） |
| 设计系统 | 四棘轮 + 契约门禁（领先） | ①无密度档/对比度档；②无代码预览专项（行号/换行/字号）；③无动效用户开关（reduced-motion 仅 token 化）④无界面模式（编程/办公） | ZCode `codePreviewSettings` + interfaceMode；Codex effects 六项 + MotionMode | ★★★ | **借**：预览专项 + 动效开关；不动棘轮 |
| 可观测/可测 | 373 testid 散写 | ①**无 testid 单一来源常量表**；②**无 testid 合同文档**（截图不算通过）；③无快照回归；④无键位冲突校验 | ZCode `test-ids.ts` 376 + `conversation-session-ui-testid-contract.md`；Codex 926 快照 + 冲突顺序校验 | ★★★★★ 与 EAR≈10% 直接相关 | **学**：注册表 + 合同 + 快照（同时抬证据资产化率） |
| 通知/桌面 | 单条完成通知 + updater | ①无托盘；②无未读 badge；③**无离焦通知策略**（Codex 默认仅失焦）；④无通知方式/声音；⑤窗口状态未持久化 | ZCode `desktopNotifications.ts`+`setBadgeCount`+`desktopWindowSize.ts`；Codex `NotificationCondition::Unfocused` | ★★★★ | **借**：离焦策略 + badge + 托盘 + 窗口持久化 |
| 远程/移动 | 配对/隧道/联邦/投影齐备 | ①**无投递模式标记**（投影可回放 vs 桌面连续）；②无帧间隙检测；③无窄屏专用两页 shell | ZCode `WebRemoteControlMobileShell` + `transport.ts:47,58` | ★★★★ | **学**：交付模式标记 + frame gap |
| 成果面 | 9 类 viewer + 总线 + 沙箱（领先） | ①PreviewPane 无统一路由与类型惰性升级；②无 pptx/office 预览；③mermaid 无串行队列 | ZCode `previewPaneContent.tsx`（8 类）+ `mermaid-block.tsx` | ★★★ | **借**：预览路由统一 + 渲染队列；**自强化**：成果面继续当差异化 |
| 可访问/i18n | aria/焦点/alertdialog 齐 | i18n 全缺（deferred，待产品决策）；无 screen reader 测试套件；无 RTL 方案 | ZCode zh-CN/en-US 资源；Codex `screen_reader` 测试套件 | ⛔/★ | **⛔ 不并入**（i18n 待裁决）；screen reader 套件可随快照一起做 |

---

## 4. 升级方向总判定（四类筛子）

| 类别 | 判据 | 命中项 |
|---|---|---|
| **学（机制直译）** | 与终端无关、可在本仓落为纯函数/组件、无语义冲突 | 事件信封+目录、并行调度器+暴露面、压缩参数化+reason、审批全局档位+保守交集、hooks（待改判）、context_snapshot+replay、投递模式标记+帧间隙、虚拟滚动+三档折叠+turn navigator、renderer 注册表+三分组、快捷键面+冲突校验、testid 注册表+合同+快照、记忆提取 claim 锁、环境变量过滤、作业类型注册表 |
| **借（形，长自有形态）** | 竞品形态可抄，但须换成本地优先/治理透明的实现 | 沙箱模式×后端 → 应用层信任级别+可写根；Guardian 二审 → 本地模型二审；rollout 压缩 → 本地归档；approval 前缀作用域 → 指纹+维度+项目规则三档；技能市场 → 领域包+本地目录导入 |
| **不做（不适配）** | 强终端/云/容器绑定 | TUI/PTY/alternate screen/OSC9/ANSI 调色板/星域动效/vim 三层键位/OS 容器沙箱/CLI 子进程模型/云配置层/MDM 层/远程压缩与 realtime webrtc |
| **自强化（Petri 独有，继续投）** | 两家没有或更弱，是魂面 | loop 工程四件套接线（振荡/无进展/评估出口 + 汇报门转正 + validators 参与主链）、审批请求资源化、决策原语阈值台账、成本熔断、记忆生命周期审计、成果面（viewer/总线/血缘/changeset）、Gen UI 自愈与数据绑定、设计系统四棘轮、证据链（acceptance+探针） |

## 5. 缺口 → 五阶段队列映射（增量插桩）

| 阶段 | 原队列 | 本蓝图新增（并入同阶段，不新开阶段） |
|---|---|---|
| 阶段 0 兑现清账 | ①BLOCK-184 | —（保持轻量） |
| 阶段 1 可感度扩容 | ②TTFS、③b-A 设置速赢 | 快捷键面与设置搜索升级为**含 testid 注册表前置**；追加**虚拟滚动 + 三档折叠 + turn navigator**（会话体验是「可感」第一梯队） |
| 阶段 2 证据自证 | ③评测基线 v2 | 追加 **context_snapshot prompt 棘轮**（v2 核心）、replay fixtures、Protocol 层判据；快照回归与 testid 合同同批 |
| 阶段 3 结构地基 | ③b-B1 配置 schema、B2 MCP/记忆设置面 | 追加 **事件信封+目录**、**工具元数据单源+并行调度+暴露面**、**存储能力协商**（这三件是 harness 的地基，越晚做越贵） |
| 阶段 4 治理纵深 | ③b-C 五项 + ⑤收尾族 | 追加 **审批全局档位+保守交集+信任级别+子 agent profile+环境过滤**；hooks 产品化与 i18n 仍 ⛔ 待裁决 |

## 6. 推进纪律（本蓝图不改变既有纪律）

- 单 active 工作包串行；每包三件套；注记制（评估报告 §5.3 为进度真值）；
- 每包立项自检问句必须回答「形态差别/本地可审计/治理透明/证据自证」；
- 本蓝图与设置差距分析同属 reference：不承载运行时证据，落地以各包 plan/acceptance 为准；
- G0 纪律：不外推 Provider/公证/GA；签名与资格类事项不因本蓝图进队列。

---
*G0 开发期常态 · 不外推 packaged/Provider/GA。参照库 ZCode/Codex 均 Apache-2.0，本文件为模式对照，全文零源码拷贝。*