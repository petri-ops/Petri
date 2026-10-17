# Petri Desktop（格物）文档入口
221. [`block-193-evals-capture-replay-plan.md`](./block-193-evals-capture-replay-plan.md) — 2026-10-17 整包 **completed（用户「可以呀 按上面这个定案开建 BLOCK-193」；closeout 十三门全绿；实机录制 real 3/3 PASS·measures=model → 离线零 API 回放 3/3 PASS·measures=recorded-replay）**：**评测 v2 第五切片·capture/replay 真实录制态**（定案三约束=写前过密钥扫描 + 只录合成任务 + replay 仍须过 189 `outbound_contains` 哨兵，三条全部机械兑现）。**P0 实码勘察更正上游转述两处**：①「real 模型响应零留存」不成立——BLOCK-37 `io-transcript` 就是生产级模型 I/O 记录器（`model-gateway.js:267` `chat()` 流式/非流式统一 `_emitTranscript` → `<PETRI_LOCAL_DATA_DIR>/llm-transcripts/<conversationId>.jsonl`，本机实文件已核 provider=deepseek），evals 隔离后端写到 tmpDir 后被 `fs.rmSync` 销毁 → 真实缺口=「留存随临时目录销毁、未入仓可重放」；②「replay 需放宽 188 快照条件」在本设计不成立（replay 复用 `startMockProvider`，mock 天然在场），但「报告/基线落点不分 provider 会互相覆盖」为真且是假绿通道，同批修。据此**不新建录制代理、不写第二套 SSE 解析**（给生产记录器做影子副本触治理红线）：录制态=收割现成台账 + 投影可重放回合；入库双闸 + replay `measures=recorded-replay` 且缺哨兵即红 + (suite,provider) 产物 namespace。红线=不冒充 model 质量/不改 PASS 语义/不撞 191 的 fixture 词汇/不录 smoke-golden/零密钥零用户数据入仓。**交付**=契约测 15/15（含「罐头回合 + 空出站必红」假绿反证）·邻域 58/58 零回归·`test:changed base=9e16b7ca` 94pass/0fail·smoke 9/9 与 golden 1/1 不回归·`evals:gate` real 与 real-replay 双回归 0·录制产物 `evals/recordings/real/` 共 10.2KB（体积一侧实测非问题）·回放单任务 0.5-1.1s vs 真模型 3-15s。**顺带修出 BLOCK-189 既有缺陷**（实机腿踩出）：`outbound_contains` 把 `JSON.stringify` 的单行 blob 喂给按「折到行尾」设计的 `<ENV>` 归一化规则，一路吞掉整条出站→真模型三例哨兵全 ×0 假红；改在读侧还原转义换行，归一化本体与快照 fp 零变更，并固化缺陷守卫测（如实登记：该哨兵此前只由旁路请求满足）。G0 开发期常态 · 不外推 packaged/Provider/GA。
220. [`block-192-evals-real-credentials-plan.md`](./block-192-evals-real-credentials-plan.md) — 2026-10-16 整包 **completed（用户「上」发令；closeout 门禁全绿·零手工注入实机验收 3/3 PASS measures=model）**：**评测 v2 provider 切片·real 模式凭据自给 + 入库脱敏 + real 基线棘轮**。前置纠错：先前判「provider 切片 blocked」是探针不健康误判（本机凭据库一直有 deepseek key，规范读法 `createCredentialStore`），真实缺口=harness 只认 env、隔离临时目录看不到桌面凭据库。交付=env 优先→仅 real 回落本机库（mock 绝不回落）·失败给分类 skipReason 不伪造·返回体只暴露 hasKey（明文不入日志/证据）·`sanitizeEvalTasksForStorage` 剥离 finalText 守「LLM 原文不入仓」·`evals/baselines/real.json` 建 real 回归棘轮。契约测 8/8、smoke/golden/real 三门回归 0。G0 开发期常态 · 不外推 packaged/Provider/GA。
219. [`block-191-formal-admission-plan.md`](./block-191-formal-admission-plan.md) — 2026-10-16 立项发令 **active（用户 AskUserQuestion 拍板门控口径「晋升=双齐+显式审计（推荐）」）**：**评测 v2 第四切片·formal-admission 门控棘轮**（§4.1 ZCode smoke→real 晋升需 case manifest+fixture 双齐·baseline 仅显式审计命令）。交付=deriveAdmissionManifest（现有字段派生 case manifest）+ evalAdmission（双齐判晋升）+ `scripts/evals-admission.mjs` 晋升清单台账+双齐违规 exit 非零+基线仅显式审计源码门 + 契约测四项。PASS 判定/gate/runGoldenTask/13 任务字段名不改；不跑真模型（provider 依赖切片 reopen·无凭据诚实 blocked）。G0 开发期常态 · 不外推 packaged/Provider/GA。
218. [`block-190-evals-catalog-plan.md`](./block-190-evals-catalog-plan.md) — 2026-10-16 立项发令 **active（用户「冲·搞完评测 v2 剩余·各独立立项」）**：**评测基线 v2 第三切片·catalog 五列化**（§5.1 阶段2 四件套之 catalog 五列；§4.1 ZCode ID/setup/action/assertion/evidence）——`deriveCatalogRow` 纯函数（evals 任务 JSON→五列派生）+ `scripts/evals-catalog.mjs` 生成 `evals/CATALOG.md` 五列索引（`npm run evals:catalog`）+ 契约棘轮测（每任务五列非空·CATALOG 与套件逐字节同步·无 volatile）。红线=additive 不改任务字段名/不动 runGoldenTask+gate 语义/不动门控（BLOCK-191 才碰含架构裁决）。G0 开发期常态 · 不外推 packaged/Provider/GA。
217. [`block-189-eval-outbound-anticheat-plan.md`](./block-189-eval-outbound-anticheat-plan.md) — 2026-10-16 立项发令 **active（用户「行！继续」，评测 v2 第二切片；承接「我不希望人参与」→ 全自动化）**：**出站请求归一化断言 + 哨兵防作弊 + 禁 sleep 门**——§5.1 阶段2 四件套之「判据三件套(禁 sleep)+mock capture/replay 防作弊」两腿。P0 勘察=三件套缺**出站归一化断言**一条腿（17 判据 kind 覆盖事件谓词+文件产物，无 kind 读 mock.captured 出站→伪造事件可假绿=防作弊缺口）。交付=P1 新 kind `outbound_contains`（复用 BLOCK-188 normalizeContextString 归一化·无 outbound fail-closed 红）；P2 per-run 哨兵+红绿对测证「有事件无出站→红」=ZCode replay 断出站含哨兵防作弊在 mock 层落地；P3 禁 sleep 机械门。红线=不碰判据门控口径/PASS-FAIL 晋升语义（formal-admission 架构裁决须用户拍板独立切片）/不做真实 provider 录制（reopen）/不引第二归一化真相。G0 开发期常态 · 不外推 packaged/Provider/GA。
216. [`block-188-eval-baseline-v2-context-snapshot-plan.md`](./block-188-eval-baseline-v2-context-snapshot-plan.md) — 2026-10-16 立项发令 **active（用户 AskUserQuestion 选定「评测基线 v2（推荐·最自动化）」为阶段2 首包方向）**：**评测基线 v2 首切片·context_snapshot 棘轮**——评估报告 §5.1 阶段2「证据自证期」出口判据（catalog 五列+判据三件套禁 sleep+mock capture/replay 防作弊+context_snapshot 棘轮）中**单项价值最高且完全确定性无 provider/无网络/无模型**的首切片：把 agent 出站请求组装形状（system prompt+工具 schema+上下文骨架，动态值九类归一化）指纹化+基线棘轮，prompt/工具 schema/上下文组装任何变更 diff 显形须显式 --update 重打，杜绝静默 prompt 回归；复用 evals harness 已 capture 出站请求（不建第二评测真相）。红线=不做判据门控口径裁决（formal-admission 切片报告明列架构裁决须用户拍板）/不接 LLM-as-judge real 模式/动态值不入基线。评测 v2 其余切片各自独立立项。G0 开发期常态 · 不外推 packaged/Provider/GA。
215. [`block-187-golden-path-onboarding-plan.md`](./block-187-golden-path-onboarding-plan.md) — 2026-10-16 立项发令 **active（用户「按照推荐的进行下去」，承接「我不希望人参与」→ 验收全自动化）**：**黄金路径脚本化与零断点验收批（TTFS 程序③收官批；①深链=BLOCK-185 ②遥测=BLOCK-186 均 completed）**——以既有 evals harness（spawnIsolatedBackend+startMockProvider+runGoldenTask 已跑 project→conversation→agent）为载体把 agent 驱动黄金路径（开应用→建项目→问 Agent→首任务成功→看结果 ≈7 步）脚本化为可机械重跑验收，断言「≤7 步零断点且 TTFS 可度量」=阶段 1 出口判据（消费 BLOCK-186 funnel_events+computeTTFS）。P1 脚本化 golden task；P2 零断点审计（welcome.tsx sendGuard 无项目拦发送定性 by-design 非断点）；P3 evals harness 增 funnel/ttfs 判据 kind；P4 supersede stale docs/first-success-path.md（指已删 tools.tsx 旧 DESeq2 路径）。红线=不建 onboarding 向导 UI（需人眼评审，另立 UI 包待发令）/不动 186 单写入器裁决（TTFS 口径=系统可用起算诚实标注）/不接 runtime_install+update_succeeded/不引第二路由或度量真相。G0 开发期常态 · 不外推 packaged/Provider/GA。
214. [`block-186-funnel-ledger-plan.md`](./block-186-funnel-ledger-plan.md) — 2026-10-16 立项发令 **active（用户授权自主推进+验收全自动化「我不希望人参与」）**：**本地漏斗事件台账批（TTFS 程序②）**——G0 定性变更：评估报告「遥测端点化」字面隐含远程端点属 G1+（AGENTS.md 禁 G0 启动），按 G0 唯一合法形态落地=本地 SQLite 漏斗台账（仿 decision_log 零外发，贴本地可审计魂）。P1 迁移 014_funnel_events + helpers/funnel-log.js best-effort（永不 throw/独立于 telemetry_enabled）→P2 5 个 G0 可触发事件接线（app_started/project_created/first_job_succeeded@markAgentTaskDone/runtime_install/report_generated；update_succeeded=packaged G1+ 诚实 N-A）→P3 TTFS 查询（first_job_succeeded−app_started）→P4 自动化实机（隔离后端真实链断言落库+TTFS 可算，无人眼）。红线=不建远程端点/不动隐私门控/不引第二度量真相。G0 开发期常态 · 不外推 packaged/Provider/GA。
213. [`block-185-cold-start-deeplink-plan.md`](./block-185-cold-start-deeplink-plan.md) — 2026-10-16 立项发令 **active（用户裁决「按照你的推荐来 冲」=批准 D1/D2/D3+整批预授权）**：**冷启动深链修复批（TTFS 程序拆三串行批第一批）**——评估报告 §5.1 阶段 1 ② TTFS 批按用户裁决拆三串行（①深链修复②遥测端点化③onboarding），本包=①。P0 勘察定位三处：Race A（useWorkspaceOpenEffects.ts 一次性消费不重试）/Race B（project-workspace.tsx 冷启动后端未就绪静默归零）/_window-create.js 恒 loadURL 根+无 last-url 持久化。P1 last-url 持久化（复用窗口位置记忆 store 加 lastUrl，白名单只恢复本地 SPA 路由拒外部 URL）→P2 SPA 两竞争红绿修（成功后置位+退避重试复用 welcome.tsx 姿势）→P3 CDP 双场景实机（reload ?job= 保持 / Electron 重启恢复）。红线=不碰遥测/不做 onboarding/不引第二路由真相。G0 开发期常态 · 不外推 packaged/Provider/GA。
212. [`full-stack-benchmark-blueprint-2026-10-15.md`](./full-stack-benchmark-blueprint-2026-10-15.md) — 2026-10-15 落档 **reference（用户指令「蓝图内容还是不够全面…后端 harness 和前端界面也要同类型比较…确定到每个细节点…规划优化升级计划」）**：**全层对标蓝图（后端 harness × 前端界面）**——六路只读清点（ZCode/Codex/Petri × 后端/前端各一）后统一比对：①三方架构分层对照（后端 12 层 + 前端 12 层）②逐层细颗粒缺口表（机制名+代码锚点+价值+方向判定）③四类筛子（学/借/不做/自强化）④缺口映射回五阶段队列。**三反转发现**：Petri 的 loop 工程四件套（哈希契约账本/控制器/validators/修复策略/检查点）与成果面（9 类 viewer+选择总线+血缘+changeset）和设计系统四棘轮**领先于两家**；真正落后在协议信封与事件目录、工具并行调度与暴露面、压缩/记忆参数化、审批保守交集、通用 hooks、context_snapshot prompt 棘轮、虚拟滚动与 turn navigator、renderer 注册表与三分组、testid 合同与快照回归、投递模式可信标记。模式借鉴零拷贝（两库 Apache-2.0）。G0 开发期常态 · 不外推 packaged/Provider/GA。
211. [`settings-capability-gap-analysis-2026-10-15.md`](./settings-capability-gap-analysis-2026-10-15.md) — 2026-10-15 落档 **reference（用户指令「全面梳理 zcode 和 codex 设置页全部配置项…与当前项目对比…按优先级给出建议与分阶段方案」）**：**设置体系能力对照与差距分析**——三方全量盘点（ZCode ≈150 项：3 层落点+zod schema+24 命令键位+AgentProfile 15 字段；Codex：103 顶层键/1402 字段路径/9 层优先级+profile+requirements 约束层+169 键位；Petri：8 分区 ≈60 项/六落点无 schema）+架构对比 +差距矩阵（🔴 缺失：快捷键面/全局审批档位/工具黑白名单/设置搜索重置导出/配置 schema 优先级/代理设置/推理档位/信任级别/数据目录可配；✅ Petri 更强：决策原语阈值台账/成本熔断/记忆审计）+优先级表（P0×5/P1×3/P2×6，⛔ i18n 阻塞待裁决）+三阶段落地方案（速赢层 4 项 → 结构层 3 项 → 治理层 5 项）。模式借鉴零拷贝（两库 Apache-2.0）。G0 开发期常态 · 不外推 packaged/Provider/GA。
210. [`Petri-Desktop-Evaluation-Report-2026-10-15.md`](./Petri-Desktop-Evaluation-Report-2026-10-15.md) — 2026-10-15 落档 **reference（用户裁决「这应该是个蓝图研判 有落档吗」）**：**全方位评估报告（蓝图研判）**——§0 进度追踪链（六级读序：AUDIT-LOG→roadmap→handoff→backlog→ui-audit→本报告路线表，回答「做到哪里了」）+11 棱镜合并评分卡（结果/投入/风险/外部标尺四族）+ZCode/Codex 参照库 evals v2 施工图（catalog 五列/判据七层/mock capture-replay 防作弊/判据三件套禁 sleep/context_snapshot 棘轮；Apache-2.0 模式借鉴零拷贝）+五步迭代路线（①BLOCK-184 planned→②TTFS/v2 二选一→③v2 含 attach→④8 维复测随包→⑤收尾族）+外部专家团能力映射。核心判词=「机制一流、可感二流」病因已从能力缺失转为确认与兑现缺失。G0 开发期常态 · 不外推 packaged/Provider/GA。
209. [`block-184-ui-review-clearing-plan.md`](./block-184-ui-review-clearing-plan.md) — 2026-10-15 立项 **planned（用户裁决「按照我们项目内部的规范 是不是应该建立plan」+「继续」；发令待显式确认）**：**UI 过目清偿批（代行评估+人眼最小集）**——台账 in_progress 存量（预估 12 条：UI-457/466/467/468/469/470/471/481/482/501/503/504；UI-487 复核已 verified 剔除）按「P1 代行 CDP 走查证据包（截图+断言 JSON+可复跑探针，借鉴 ZCode testid 合同/唯一去向不变量·模式借鉴零拷贝）+ P2 人眼最小集 4 条（UI-501 画布/UI-503 触发面/UI-504 双机分档/UI-457 表单）+ P3 抓真小修随批」分层收口；前置=dev 栈重拉（10-15 实测 3000/3001/9222 全不在听）。零产品码为默认；G0 开发期常态 · 不外推 packaged/Provider/GA。
208. [`block-183-data-bridge-ws-plan.md`](./block-183-data-bridge-ws-plan.md) — 2026-10-14 立项 **active（用户裁决「行 你启动我来测试看看」；竞争力总纲 CP-19 收官批转正）**：**数据桥 WS 化（本地主权魂面·传输层）**——/m/api/ws 扩 `data` 请求/响应信封（GET 七路径严格白名单 fail-closed+服务端 loopback 自调既有路由=形状单一真相）+前端 projectionWsData 共享单连接 WS-first+3 连传输失败 5min 冷却回退 HTTP（BLOCK-162 形态复用）；POST/写面/agent 流/终端流零触碰。G0 开发期常态 · 不外推 packaged/Provider/GA。
207. [`block-166-nav-guard-plan.md`](./block-166-nav-guard-plan.md) — 2026-10-14 立项当日收口 **completed（2026-10-12 用户裁决「可以排期修」的 knownGap 落地）**：**Gen UI 沙箱帧导航劫持收口**——拆除失实死码+主进程侦测推送（进程登记法+did-fail-load CSP 拦截路）+GenUiCard 帧匹配即时重置（恢复窗口 9-11s→亚秒）+30s×3 循环限幅挂起面。G0 开发期常态 · 不外推 packaged/Provider/GA。
206. [`block-182-memory-lifecycle-plan.md`](./block-182-memory-lifecycle-plan.md) — 2026-10-14 立项 **active（用户预授权四批次之 D；CP-6 评估结论承接）**：**记忆生命周期治理（可信透明魂面）**——user_facts 事实衰减/用户纠错流（免费直生效）/矛盾消解（等值合并）/全链审计四件+模型通道 .petri/MEMORY.md 写入过审批门（policy memory 维度走 BLOCK-180 审批卡全链）。G0 开发期常态 · 不外推 packaged/Provider/GA。
205. [`block-181-evals-harness-plan.md`](./block-181-evals-harness-plan.md) — 2026-10-13 立项 **active（用户裁决「可以的 开」）**：**Agent 质量评测基线（证据自证终局形态）**——黄金任务集×隔离后端运行器（mock/real 双模式）×确定性判据×基线回归门；prompt/工具/skill/模型变更的任务质量影响本地可测；v1 判据全确定性。G0 开发期常态 · 不外推 packaged/Provider/GA。
204. [`block-180-approval-resource-plan.md`](./block-180-approval-resource-plan.md) — 2026-10-13 立项 **active（研究池②转正出籍；用户裁决「② 审批二阶段（推荐）」）**：**执行审批二阶段一等资源化（治理透明魂面）**——审批请求一等资源（requestId/TTL/决策记录/指纹放行）+commandSpan 风险片段服务端分析+GuardAckCard 高亮+「总是放行」两步武装。增强 BLOCK-48/160/171/177 既有链不重建。G0 开发期常态 · 不外推 packaged/Provider/GA。
203. [`block-179-tool-call-repair-plan.md`](./block-179-tool-call-repair-plan.md) — 2026-10-13 立项 **active（研究池④转正出籍；用户裁决「行 开整吧」）**：**tool-call-repair 鲁棒性（通用能力主线）**——模型把工具调用写成正文的生产级修复：三形态解析（围栏 JSON/裸对象/tool_call 标签）+保护区间 fail-closed（可用名单校验/参数对象/上限/任一未知名整轮不修）+提升为真实调用（复用 runAgentToolCallBatch 同权审批门）+修复决策透明事件与原文诚实保留。G0 开发期常态 · 不外推 packaged/Provider/GA。
201. [`block-176-competitiveness-wave6-plan.md`](./block-176-competitiveness-wave6-plan.md) — 2026-10-12 立项发令 **active（用户 /goal 整波授权连续行使）**：**竞争力总纲 W6 波·协作与可靠性长尾**——CP-16 联邦委托事件流回传（对端任务 SSE 订阅替代 5s 轮询+断流回退轮询，跨机实测段分档登记）+CP-17 工作树 checkpoint 安全网（git stash create 快照+一键回滚 IPC+ReviewMode 入口）+CP-18 成本硬熔断（costCapCny 上限→finalization 停机+设置面输入）+CP-19 数据桥 WS-first 回退 HTTP。证据=acceptance/block-176/。G0 开发期常态 · 不外推 packaged/Provider/GA。
200. [`block-176-competitiveness-wave7-plan.md`](./block-176-competitiveness-wave7-plan.md) — 2026-10-12 扩纲立项 **planned（用户裁决「W7 先行（推荐）」；W5 在制收口后顶队列头发令，W6 顺延）**：**竞争力总纲 W7 波·Agent Skill 知识面**——CP-20 SKILL.md 常驻双格式注册+声明式依赖（os 门控+requires.bins+install 配方；KNW-4 导入通道扩展，候选池③转正出籍）+CP-21 依赖自检与安装治理（preflight 探测+审批留痕+Skills 页状态面）+CP-22 首批通用技能包迁移（Obsidian 九技能转写，可视化产出接 Gen UI 模板优先节）。证据=acceptance/block-176/。G0 开发期常态 · 不外推 packaged/Provider/GA。
201. [`block-177-skill-governance-plan.md`](./block-177-skill-governance-plan.md) — 2026-10-13 **completed（live 11/11）**：**技能治理面**——内置技能停用/启用（skill-prefs 单源、agent/执行双面过滤、Skills 页置灰管理视图）/已导入卸载（接既有单源+确认弹层）+installed sourceDir 一键重装（「再次获取」=启用开关/原目录重装，零网络）/治理动作本地审计 jsonl。证据=acceptance/block-177/。G0 开发期常态 · 不外推 packaged/Provider/GA。
202. [`block-178-composer-delivery-plan.md`](./block-178-composer-delivery-plan.md) — 2026-10-13 **completed（live 14/14）**：**消息队列与忙碌态投递一等化**（对照 ZCode v4 ConversationComposer/QueuePanel+Codex input_queue）——P0 发送/Stop 并存+投递模式显式化+用户消息编辑重发；P1 队列一等化；P2 队列持久化+完成桌面通知+prompt 历史持久化。G0 开发期常态 · 不外推 packaged/Provider/GA。
199. [`block-175-competitiveness-wave5-plan.md`](./block-175-competitiveness-wave5-plan.md) — 2026-10-12 立项发令 **active（用户 /goal 整波授权连续行使）**：**竞争力总纲 W5 波·数据资产面接线**——CP-14 选择总线跨 viewer（canSelect 只读族 ≥4 类接线+canCompare 表格族成对+选择→继续分析引用链）+CP-15 ArtifactPinPane 可拖拽比例（20-80 钳制+持久化）+renderer 清单对账。artifact-plane 切片 C/E 承接。证据=acceptance/block-175/。G0 开发期常态 · 不外推 packaged/Provider/GA。
198. [`block-174-competitiveness-wave4-plan.md`](./block-174-competitiveness-wave4-plan.md) — 2026-10-12 立项发令 **active（用户 /goal 整波授权连续行使）**：**竞争力总纲 W4 波·Gen UI 表达面双轨**——CP-13a accent 透传（沙箱主题跟随实例色）+CP-13b fragment 文件导出（原生另存）+CP-11 artifact/job 数据面只读绑定（petri.getData RPC 归属校验+prompt 注入可用源）+CP-12 场景模板库（bar/line/kpi/table+visualize 模板优先节）。双轨并轨=模板通用形+artifact 自有数据锚。证据=acceptance/block-174/。G0 开发期常态 · 不外推 packaged/Provider/GA。
197. [`block-173-competitiveness-wave3-plan.md`](./block-173-competitiveness-wave3-plan.md) — 2026-10-12 立项发令 **active（用户 /goal 整波授权连续行使；W1/W2 先例）**：**竞争力总纲 W3 波·编排与多智能体深化**——CP-8 并发与派生升级（PETRI_SPAWN_CONCURRENCY_LIMIT 1-8 缺省 3+PETRI_SPAWN_MAX_DEPTH 受控放开缺省 1=现状+汇报门评估落结论）→CP-10 工具路由转正（tool-route 默认开+精度校准门+决策可观测确认）→CP-9 编排 DAG 可视化（spawn 树 @xyflow 只读投影，AgentRunPanel 编排图形态，数据源=既有 tasks 零第二真相）。证据=acceptance/block-173/。G0 开发期常态 · 不外推 packaged/Provider/GA。
196. [`block-172-cp6-memory-evaluation.md`](./block-172-cp6-memory-evaluation.md) — 2026-10-12 落档 **reference（BLOCK-172 CP-6）**：**记忆分层评估与项目记忆文件**——项目记忆（.petri/MEMORY.md 读侧有界注入+写侧 workspace_write 治理门继承）已实施；评估结论=事实生命周期治理优先/ANN 触发条件（>50k 向量或 p95>200ms）登记不预做/召回基线 30 问 top3 命中率法。G0 开发期常态 · 不外推 packaged/Provider/GA。
195. [`block-172-competitiveness-wave2-plan.md`](./block-172-competitiveness-wave2-plan.md) — 2026-10-12 立项发令 **active（用户 /goal 整波授权连续行使；W1 同款波内零停顿）**：**竞争力总纲 W2 波·长程上下文与记忆**——CP-7 计量可感化（预算环真实水位 SSE 投影+/compact 等价手动压缩+temperature/max_tokens 可配，DAG 建议先行=压缩与熔断地基）→CP-5 loop 摘要式 auto-compact（0.85 断路丢前摘要进 transcript 留证+compaction 接入 agent loop fullMessages）→CP-6 记忆分层评估+项目记忆文件（AGENTS.md 等价，写入走治理门）+向量召回基线。证据=acceptance/block-172/。G0 开发期常态 · 不外推 packaged/Provider/GA。

194. [`block-171-competitiveness-wave1-plan.md`](./block-171-competitiveness-wave1-plan.md) — 2026-10-12 立项发令 **active（用户 /goal 整波授权「按照波次 逐个推进 能自己判断就自己判断」=波内零停顿条款行使）**：**竞争力总纲 W1 波·交互主权与信任可见化**——CP-1 停止与取消全线贯通（主聊天 Stop 复出〔推翻 BLOCK-28.8〕+spawn_wait/run_tool job/文件搜索三族工具可取消+取消事件入 task_events 留痕）→CP-2 dynamicGuardAck 确认弹卡（放行/拒绝/总是）+审批复审面板→CP-3 CommandPalette 真命令源（五类 ≥15 条+recentConversations 接线）→CP-4 排队可视化可撤销+steer 状态持续可见。出口断言逐包见 plan §1；波报集中复认随收口。证据=acceptance/block-171/。G0 开发期常态 · 不外推 packaged/Provider/GA。
193. [`agent-competitiveness-program.md`](./agent-competitiveness-program.md) — 2026-10-12 落档 **planned（用户裁决三连：反克隆借形不改魂 + agent 通用能力为主线核心 + 方案要更全面；方向采纳未发令）**：**Agent 竞争力总纲**——行业竞争力标尺（ZCode/Codex 桌面 agent 形态）取代 G0 内部天花板为新量尺：双口径评分卡（8 维，内部 4★ 级换行业标尺多为 2.5-3.5）+ 差距矩阵 18 项（双路只读探查 60+ 锚点：丢弃式压缩/记忆单层/并发 3 上限/确认弹卡缺/主聊天无 Stop/Cmd+K 空壳/Gen UI 无数据绑定/viewer 能力位占位/联邦轮询黑盒等）+ 六波 19 候选包（W1 交互主权与信任可见化 CP-1~4/W2 长程上下文与记忆 CP-5~7/W3 编排多智能体 CP-8~10/W4 Gen UI 双轨 CP-11~13/W5 数据资产面接线 CP-14~15/W6 协作可靠性长尾 CP-16~19）+ 总对账表 15 指标 + 依赖 DAG。蓝图 G1+ 残余三件（确认弹卡/chip v2/DAG 化）经用户裁决拉回 G0 由 CP-2/3/9 承载。排队序唯一在 pending-work-backlog，波次发令时入队列。G0 开发期常态 · 不外推 packaged/Provider/GA。
192. [`block-168-oopif-hijack-hardening-plan.md`](./block-168-oopif-hijack-hardening-plan.md) — 2026-10-12 立项发令 **active（用户裁决「下一个工作包开整」，队列头唯一 planned；前裁决「可以排期修」）**：**Gen UI OOPIF 导航劫持加固**——P0 Electron 41.10.7→44.7.0 升级复测事件矩阵（will-frame-navigate/WebFrameMain/webRequest 三路实证）→P1 按结论落事件守卫（preventDefault+telemetry）或自愈守护（iframe load 守卫重置恢复，DoS 降为瞬闪+自愈）→P2 升级去留（回归全绿留 44，任一红回退 41 只落解耦守护）。closeout BLOCK-167 十二门 PASS 后队列头接棒。证据=acceptance/block-168/。G0 开发期常态 · 不外推 packaged/Provider/GA。
190. [`block-167-product-quality-program-plan.md`](./block-167-product-quality-program-plan.md) — 2026-10-12 立项发令 **active（用户裁决「按波次逐个推进完成」=整包授权波内零停顿，BLOCK-157/160 先例）**：**产品质感提升计划五波**——三轮评估证据（截图量化+ZCode app.asar 解包对照+Codex style.rs 源码对照，output:judge 3.78/3.85 两次 PASS）：W0 设计宪章+theme-token-contract 用法门禁（字号 6 档/色彩预算/border 三语义/motion 档红→绿）→W1 静态重校（14px 基准占比 3%→≥40%、10/11px 328→≤80、字号 11→8 档、中性:强调 2.3:1→≥6:1、无语义细线 374→≤200；聊天→项目/扩展→设置/知识库三域前后同屏截图）→W2 控件收敛（36 套按钮→单源变体+grep 守卫）→W3 动效 token（duration 150/200/300+ease 2 档+::selection）→W4 空/载/错三件套+语气 pass。量化对账表与 D1-D6 预裁决在 plan §3/§5；非范围=密度不降/不换色相字体栈/不动信息架构/G1+ 不外推。证据=acceptance/block-167/。G0 开发期常态 · 不外推 packaged/Provider/GA。

191. [`design-charter.md`](./design-charter.md) — 2026-10-12 落档 **active（BLOCK-167 W0）**：设计宪章=设计默认值唯一规范真值（字号 6 档/色彩预算 10:1/border 三语义/motion 3+2 档/渲染细节/控件单源纪律）；机械守护=theme-token-contract BLOCK-167 断言组；档位/预算调整须证据批+用户裁决。
189. [`block-161-ui-design-system-governance-plan.md`](./block-161-ui-design-system-governance-plan.md) — 2026-10-11 翻正 **active 发令开工 W1（BLOCK-166 收口腾出唯一 active 槽位，用户裁决「继续 搞完下一个候选」按队列头发令）**：**UI 设计体系治理**（视觉/布局/字体/配色/性能五维；承接 2026-10-10 UI/UX 全面审计 51 条可定位问题）四波——W1 速赢（CommandPalette 删 simple-chat.css 误引入+对比度改色 ×4+键盘可达性+死 CSS 375 行）→W2 档位体系+门禁棘轮（间距/圆角/z-index/阴影 token 化+契约测试 4 条补断言）→W3 缩放闭环+可读性（裸 font-size 清零/明暗未配对 token 补齐/accent 接回 ifm）→W4 性能（WorkspaceSummaryCard 止血/长列表虚拟化/首屏骨架）。审计基线=acceptance/ui-ux-audit-2026-10-10。G0 开发期常态 · 不外推 packaged/Provider/GA。

188. [`block-166-gen-ui-sandbox-plan.md`](./block-166-gen-ui-sandbox-plan.md) — 2026-10-10 立项发令 **P0-LAUNCH active（2026-10-11 翻正开工——165 收口腾出槽位，用户裁决「行！按照你的推荐啦」按队列头发令；D1-D6 概括授权在册）**：**Gen UI 沙箱可视化页面**——模型在聊天回复输出 `::visualize` 指令，客户端把模型事先写入会话专属目录（`<workspace>/.petri/gen-ui/<conversationId>/`，D1）的 HTML fragment 渲染为聊天流内嵌沙箱交互页。规格真值=[`gen-ui-migration-prompt.md`](./gen-ui-migration-prompt.md)（GEN-UI-MIGRATION-SPEC，ZCode 参考实现迁移任务书：六层架构/解析器/沙箱宿主/guest 桥/持久化/十一坑/验收清单）。选型 D1-D6=输出根 workspace 内（agent 文件工具沙箱零改动）/ `petri-genui://` 独立 origin 自定义协议 + CSP `default-src 'none'`（D2）/ 命名 petri 化 `window.petri` + `petri/gen-ui/*`（D3）/ widgetState 桌面侧 SQLite 迁移（D4）/ 每卡片一页、池化候选（D5）/ 简化 postMessage 桥传输（D6）。P0 可看（解析器+schema+协议宿主+输出根系统提示注入+`resources/skills/visualize`）→P1 可交互（完整桥+主题 CSS 工具类+vendor 三库离线映射 sha256）→P2 完整体验（持久化恢复+follow-up+放大预览锚点迁移+复制图+导出脚本）→P3 加固（注入渗透测试三路+§12 验收清单对账）。零新增 npm 依赖；非范围=PUA 旧标记形态/MCP 页共池/Tweak stretch/无 workspace 会话；并行隔离=BLOCK-165 active 收尾代码面零交叠。test:suggest/doc:suggest 供给不可用降级（如实）。G0 开发期常态 · 不外推 packaged/Provider/GA。
187. [`block-165-petri-oss-rename-plan.md`](./block-165-petri-oss-rename-plan.md) — 2026-10-10 立项发令 **active（P0-LAUNCH，用户裁决「D0-D7 全按推荐 一次搞完」= 全按推荐 + 豁免 dry-run 中途过目门，P0→P7 连续执行；BLOCK-161 串行让位在后）**（原始裁决「要立一个独立的工作包 统统修改完成 再上传」+ 定名 **Petri**）：**换库开源改名**——全仓 gewu/biof3→petri case-aware 机械替换（内容 1680 文件 + 27912 处命中 + 路径 git mv〔目录 21+文件 14〕，`scripts/block165-rename-codemod.mjs`；行级 BLOCK-165 标记豁免保护台账条目）+ 行为锚八项红绿（biof3.db→petri.db 双侧不变式 / BIOF3_* env 族 / gewuevents 事件桥 / --gewu-* CSS token 契约 / MCP serverInfo / ci-release.yml / electron-builder appId=com.petriops.local·productName=Petri / IPC 通道复核）+ 四基线重锚（impact-map / knip-baseline / eslint-suppressions / code-size）+ 4 个 gewu-* 技能改名与 .claude/.codebuddy 发现桥重建 + AGENTS/CLAUDE 入口 + OSS 三件套（LICENSE=MIT〔D4〕/ 根 README〔新建 EN 主+中文副标〕/ release-contract tagline=定稿英文描述）+ OSS 卫生（secret 复扫 + petri-ops 等个人标识扫描）+ 新仓 github.com/petri-ops/Petri 推送（全历史，D1）与旧 origin 改名 origin-biof3 保留（D6）。doc:suggest 零建议（如实）。G0 开发期常态 · 不外推 packaged/Provider/GA。
184. [`block-163-maturity-wave3-plan.md`](./block-163-maturity-wave3-plan.md) — 2026-10-10 立项发令 **active**（用户发令「开冲到W3波末」+ 波内零停顿；编号顺延=160/161/162 被占用）：**成熟度蓝图 W3 波整波承载（天花板收尾 12 单元）**——ORC-3 子Agent事件驱动聚合/ORC-4 编排查询门面统一第一刀/CAP-3 MCP streamable HTTP 传输+健康面/MDL-1 窗口零盲区/MDL-2 计数校准系数/DIST-3⇄CAP-5 插件权限六词表/DIST-5 领域包更新/MDL-3 anthropic vision 轨（真机依赖渠道=边界）/MDL-4 成本面板/KNW-5 记忆治理面/KNW-6 检索→技能建议/DIST-4 打包卫生债；波末蓝图五层画像对账。
186. [`block-164-federation-ux-closeout-plan.md`](./block-164-federation-ux-closeout-plan.md) — 2026-10-10 立项 → 同日 **三波全交付 completed**（并行插队批 planned→completed；用户裁决「需要立包」+「继续」）：**联邦协作体验收口**——W1 federation_list_peers 只读工具（委托入口可自足，解「模型拿不到 peerId」高断点；静态工具宇宙 78→79 四钉同步+动词图标三面登记）/W2 委托历史聚合端点+联邦面板「委托记录」卡（实机聚合出 BLOCK-85 真实历史记录）/W3 节点 60s 定时探活（实机 lastProbe 三周陈旧→自动刷新 ok）；对标查证无同类 P2P 形态（Codex Cloud/Copilot coding agent=中心化云委托，ZCode=SSH attach）；链路本体双真机 60 断言全绿不动；lint 顺手清偿 Federation.tsx 两处 set-state-in-effect；fed: 友名查证后无渲染点维持候选；D5/跨端深链维持不在范围；riders=双真机委托全链走查；收口笔录 plan §6。

185. [`block-162-mobile-ws-transport-plan.md`](./block-162-mobile-ws-transport-plan.md) — 2026-10-10 立项发令 → 同日 **completed**（并行插队批，注册态 planned→completed；用户裁决「WS 化 是什么意思 能搞咱就 搞起来」，承接 BLOCK-159 收口报告可选优化项）：**手机面传输 WS 化（agent 任务流单连接+即时推送）**——P0 零依赖 RFC6455 最小 WS 服务端（ws 包不可解析→自写；握手/掩码/ping-pong/背压，分片帧显式拒绝边界如实）/P1 agent-task-store 进程内事件总线（appendAgentTaskEvent 落库后 emit，推送延迟地板 500ms→0，同进程零跨进问题）/P2 网关 /m/api/ws（upgrade 三源会话门/afterSeq 水位回放/即时推送+2s 兜底轮询双轨/终态帧对齐 SSE 语义/15s ping 判死）/P3 前端投影 WS-first 三连失败 5min 回退 SSE（水位无限重连/30s 封顶抖动全复用 BLOCK-159）；非范围=终端流/数据桥 WS 化、桌面端切 WS（另裁）；实机核查 aliyun nginx 8442 Upgrade 头已在；**门禁=后端 13+前端 3+邻域 58 全绿 + 实机 WS 四探（401/101/ping-pong/err）**；测试基建两课随包清偿（pong 漏 FIN 位/Windows RST 丢弃改服务端断言+force-exit 按 BLOCK-102 先例）；非范围=终端流/数据桥 WS 化、桌面端切 WS；收口笔录 plan §6；编号 162=160/161 被并行会话占用顺延。
184. [`block-161-ui-design-system-governance-plan.md`](./block-161-ui-design-system-governance-plan.md) — 2026-10-10 立项登记 **planned（排队中，未启动）**（用户裁决「是否根据这个立项 block？」→ 三选一 **B**=等 BLOCK-160 收口后立项，不并行；编号顺延=160 已由成熟度W2 波占用）：**UI 设计体系治理四波序列**——承接同日 UI/UX 全面审计（51 条问题，全部实测定位）分四波：**W1 速赢（P0）** CommandPalette 误引入 simple-chat.css 删除（首屏 CSS 391KB→约150KB）+ 4 处对比度改色（muted 亮 2.56→4.83 / 暗 3.78→5.94、drawerError 亮色 1.45→≥4.5）+ projectTreeAddBtn `focus-within` 显形（实机 Tab 连按 50 步困在左栏 → 焦点可进主区）+ 375 行死 CSS 清理（四项零 tsx 消费者已逐个核实）；**W2 档位体系+门禁棘轮** 间距 8 档 + 圆角 4 档（现 26 种裸值）+ z-index 7 档（现 20+ 处散落、Toast 9999 被 TitleBar 10001 压住）+ 阴影收敛（84 种唯一值）+ 契约测试补 4 条断言；**W3 缩放闭环** 112 处裸 font-size 清零（设置面板「界面字号」当前对自身文字/徽标**真失效**）+ 24 个明暗未配对 token 补齐 + accent 接回 62 处 ifm-primary（切主题色对全局链接色当前完全失效）；**W4 性能** WorkspaceSummaryCard 止血（1014 行、0 useMemo + 6 interval）+ 长列表虚拟化（react-window 0 处）+ 首屏骨架。形态判定=**BLOCK 非 UI 增量**（文件面四区 + 四波多裁决项 + 跨会话，taxonomy §2 判据自检 plan §1）；四波序列形态对标 BLOCK-154-OPTIMIZATION-SERIES。**启动前置=BLOCK-160 收口腾出唯一 active 槽位**；W4 虚拟化依赖须先评估自研 spacer 免新增 npm 依赖。证据=acceptance/ui-ux-audit-2026-10-10/。G0 开发期常态 · 不外推 packaged/Provider/GA。
183. [`block-160-maturity-wave2-plan.md`](./block-160-maturity-wave2-plan.md) — 2026-10-10 立项发令 → 同日 **整波 completed**（用户发令「开冲到W2波末」+ 波内零停顿条款；编号顺延=159 已由并行会话占用）：**成熟度蓝图 W2 波整波承载**——P1 ORC-2 动态审批两维（系统破坏命令首 token+敏感路径模式，deny+guardKey，ctx.dynamicGuardAcks 统一确认通道）/P2 ORC-1 用户规则层（rules.json 三字段+REST CRUD+设置面）/P3 KNW-3 composer 斜杠命令（Skills+模板双来源）/P4 CAP-2 mcp env 加密落盘/P5 KNW-4⇄DIST-2 共轨（SKILL.md 兼容导入+MCP 配置导入）；设计裁决五条 plan §2（ORC-2 不含 rm/del 常规命令/CAP-2 机制偏离=safeStorage→core 侧 aes-256-gcm/KNW-3 v1 文本模板注入/插件导入不随批=MCP+SKILL.md 收敛）；波末五出口断言。
182. [`block-159-mobile-remote-transport-plan.md`](./block-159-mobile-remote-transport-plan.md) — 2026-10-10 立项发令 → 同日 **整包 completed**（用户裁决「立项 马上解决这个 注意 其它agent看是否存在冲突 尽可能不要冲突 P0-P2 都要整完…手机投影首屏瘦身 这个没必要吧？」）：**手机远程传输层优化（mobile-gateway 慢/易断根因修复）**——P0×5 生产投影 gzip（零依赖 zlib，静态 assets 请求时压缩+有界缓存）/隧道探活连败 2 次自愈重连+ServerAlive 15→10（判死 45s→30s）/agent SSE 15s 心跳/审计异步写/重连清场并行+退避抖动；P1×4 agent 流水位续传（删 90s 硬预算，afterSeq+DB 回放+单调守卫已在，1s→30s 封顶+抖动）/限流按会话 token 分桶（隧道下全设备不再共享 127.0.0.1 桶）/projectionLink 回前台 resync+终端桥重挂/数据桥断连显式态横幅 UI-482（in_progress 待真机过目）；P2 收敛=崩溃恢复快照不做（SQLite task_events 水位重连天然覆盖）+首屏瘦身不做（用户裁决，与 UI-357 桌面原封投影一致）；参考系 ZCode web 模式+Codex remote-control「会话与连接解耦+水位续传」范式；门禁=后端 13+前端 23+邻域 32 全绿+tsc 0+docs/ui-audit/lint/secret/arch/knip 绿；test:changed/code-size 两门被 BLOCK-158 并行在途产物阻塞归因留痕（等价证据=点名直跑全绿）；projectionDataBridges.ts getJson hunks 随 36be342b 入库归属注记；收口笔录 plan §7。
181. [`block-157-maturity-wave1-plan.md`](./block-157-maturity-wave1-plan.md) — 2026-10-10 立项发令 → 同日 **整波 completed**（用户发令「开冲到W1波末」+ 波内零停顿条款首次行使）：**成熟度蓝图 W1 波整波承载**——P1 KNW-1 Skills 可见性投影（a3969190，静态 76→78 全档可用）/P2 KNW-2 渐进披露（23ad1154，索引有界注入+触发加载）/P3 CAP-1 MCP annotations 粒度审批（5cd195d7，readOnlyHint→retrieval/none，默认 D4 零漂移）/P4 DIST-1 插件启停粒度（4ef6d666，enabled 标志+加载器尊重+货架开关 UI-481）；**实机抓真修复插件目录拓扑脑裂（cd7c58ac，BLOCK-125 家族）**；波末三出口断言 ALL PASS（真实模型自主引 skill/低档 readOnly MCP 回流/插件三态重启，acceptance/block-157/wave1-live.json）；closeout 十一门 PASS（D7 棘轮+code-size+lint 抓真清偿随包）；riders=UI-481 待过目；蓝图四种子翻 completed；收口笔录 plan §6。
180. [`g0-agent-maturity-blueprint.md`](./g0-agent-maturity-blueprint.md) — 2026-10-10 立项 **reference**（用户裁决「落档+全方位推进方案+依赖链递进」，长期 G0 阶段按蓝图逐波推进）：**G0 五层成熟度蓝图**——满级 = G0 天花板（①模型计量可信 3.5→4★ / ②编排策略可配置 4→4.5★ / ③能力可信任扩展工具面 4→4.5★ / ④知识 Skills 在场 3→4.5★ / ⑤分发本地全生命周期 2.5→3.5★，残余差距 = G1+ 画线不越界）；25 种子（MDL×4/ORC×5/CAP×5/KNW×6/DIST×5）；依赖 DAG（硬链 CAP-1→ORC-2、KNW-1→KNW-2→KNW-4⇄DIST-2、MDL-1→MDL-2）+ 三波推进序（W1 补最痛短板 KNW-1 起 / W2 长板加固 / W3 天花板收尾）+ 波次出口判据 + 插队规则；C-EXT-1~4 归并注记入 pending-work-backlog 候选池（C-EXT-2 维持 deferred）；排队序唯一台账 backlog（队列头 = KNW-1 待发令，启动前置 = skill-registry.js 在制 WIP 收口）。
179. [`block-156-ext-hub-mcp-client-plan.md`](./block-156-ext-hub-mcp-client-plan.md) — 2026-10-10 立项发令 active → 同日 **completed**（用户裁决「全按推荐 搞完」，三阶段一次会话连打）（用户方向裁决「目前的 插件和skills都属于生信垂直领域 应该合并归到领域中 新增 skills和mcp服务 对应通用agent」+ 节奏授权「行！按照你的节奏整」）：**扩展中心重组与 MCP 客户端**——P1 插件+技能归并「领域扩展」货架（/extensions 四货签+旧路由重定向+入口三处收敛+category 前缀归类+marketplace 残迹清理）；P2 MCP 客户端基座（mcp:* 通道族+stdio 连接管理器+mcp-servers.json 持久化+配置 UI）；P3 工具投影与审批策略（mcp_<server>_<tool> 命名空间投影 agent-tools+复用 agent-tool-policy 档位闸）。实机 8+9+12 断言 ALL PASS（货架/回环/agent 全链，acceptance/block-156/）；设计偏差四条登记 plan §8.2（连接归后端进程+HTTP 路由/D4 落地=execution+R2/投影为动态层非静态域）；零新增依赖；候选池 C-EXT-1/2/3 + 新增 C-EXT-4（第三方技能本地导入）。收口笔录 plan §8。
178. [`block-152-refactor-candidates-plan.md`](./block-152-refactor-candidates-plan.md) — 2026-10-09 立项发令 active → 同日 **completed**（重构候选批·内功）：平台映射三副本收敛单源（锚升级+WoA 统一登记）/hunk 级后端 stage 根修复（隔离 index+评审两轮 10 场临时仓亲验）/隧道 publicUrl 60s 自探活喂徽标；预算例外登记 2026-11-30；closeout 十一门 PASS；UI-471 in_progress 待实机；H 边缘 P2 三条归下波。收口笔录 plan §8，证据 acceptance/block-152/。
177. [](./block-152-refactor-candidates-plan.md) — 2026-10-09 立项发令 **active**（重构候选批·内功；「继续 按顺序都搞完」批量授权）：平台映射三副本收敛单源 / hunk 级后端 stage（147 根改造，前端拦截保留双防线）/ 隧道 publicUrl 周期自探活喂徽标。三轨红绿先行。
176. [`block-151-review-absorb-wave2-plan.md`](./block-151-review-absorb-wave2-plan.md) — 2026-10-09 立项发令 active → 同日 **completed**（审视吸收批·第二波）：20 条清点 15/1/4/0 三轨（A1 会话守卫从紧核心未动+/m 竞态/A4 成果面四件/B7 统计语义 title/A3 act 对齐+30 秒钉住）；评审 P1=0，P2 携带集成修掉；closeout 十一门 PASS；UI-470 in_progress 待实机。收口笔录 plan §8，证据 acceptance/block-151/。
175. [](./block-151-review-absorb-wave2-plan.md) — 2026-10-09 立项发令 **active**（审视吸收批·第二波；「继续 按顺序都搞完」批量授权 151→152→153）：A1 深水区守卫（从紧不动核心语义）+/m 竞态 / A4 成果面七条 / B7+A3 解读层与工具描述；三轨有界重审视 ≤7 条/轨双态清账。
174. [`block-150-review-batch-absorb-wave1-plan.md`](./block-150-review-batch-absorb-wave1-plan.md) — 2026-10-09 立项发令 active → 同日 **completed**（审视吸收批·第一波；用户「继续」）：13/13 清账三轨（平台消费链 6/生信品质 5/内核盲性 2；⑫ 经评审 P1 补做复核）；P2 携带两条登记；closeout 十一门 PASS；UI-469 in_progress 待实机；pack 6a5ef8a 本地不推送。收口笔录 plan §8，证据 acceptance/block-150/。
173. [](./block-150-review-batch-absorb-wave1-plan.md) — 2026-10-09 立项发令 **active**（审视吸收批·第一波；用户「继续」）：审视报告中低影响第一波 13 条三轨（平台消费链/生信品质/内核盲性），逐项先验证现状再红绿实现。明细全量在审视报告卡片续波。
172. [`block-149-tunnel-honesty-platform-patch-plan.md`](./block-149-tunnel-honesty-platform-patch-plan.md) — 2026-10-08 立项发令 active → 同日 **completed**（审视批序列第 4 批·收官；「按顺序直接推进」批量发令）：**隧道徽标诚实化（stateSinceTs 三态）+ 平台域修补（PL-D2=30 天/nul 根修留痕/映射锚）**。评审 P2 四条集成处置，closeout 十一门 PASS；UI-468 in_progress 待实机。至此审视批四批序列全部收口。收口笔录 plan §8，证据 acceptance/block-149/。
171. [`block-148-analysis-input-reachability-plan.md`](./block-148-analysis-input-reachability-plan.md) — 2026-10-08 立项发令 active → 同日 **completed**（审视批序列第 3 批·B9；「按顺序直接推进」批量发令）：**传了就能选到+新手一键试跑**——#11 白名单单源投影+有界递归+path 消歧 / #12 demo 一键载入（409 自愈）；评审 P2 三条集成批修掉，closeout 十一门 PASS；UI-467 in_progress 待实机、UI-457 待用户过目。收口笔录 plan §8，证据 acceptance/block-148/。
170. [`block-147-review-correctness-plan.md`](./block-147-review-correctness-plan.md) — 2026-10-08 立项发令 active → 同日 **completed**（审视批序列第 2 批·A2 审阅正确性；用户「按顺序直接推进 尽可能的走远」）：**审阅面正确性三连**——#1 hunk 决策键内容寻址（refresh 错位根治）/ #2 未决计数激活+提交拦截（含 staged 框同款）/ #3 焦点滚动+token 高亮（nearest 防抖动）。评审 P1=0、P2 三条集成批修掉、定向 52/52、closeout 十一门 PASS；UI-466 in_progress 待实机过目。收口笔录 plan §8，证据 acceptance/block-147/。
169. [`block-146-analysis-chain-correctness-plan.md`](./block-146-analysis-chain-correctness-plan.md) — 2026-10-08 立项发令 active → 同日 **completed**（审视批裁决首批；用户经 /workflow 裁决「开」，源=双视角全面审视 dwfrun-6724f75c 裁决 6 批优化序列之首）：**分析执行链正确性与 pack 对账**——A 平台解析根修+失败归因+required-file fail-fast（#8/#9/#4）/ B 域校验主路径化（#7，multipart 零改动）/ C pack 指纹锚+本机 D2/D3 同步（#6/#10，pack 本地 70e37fe+8e6055e 不推送）。红绿全留痕、独立评审 P1=0、closeout 十一门 PASS；R 侧零机器执行边界如实登记（待 Mac/装 R 复验）。收口笔录见 plan §8，证据 acceptance/block-146/。
168. [`block-142-artifact-plane-renderers-plan.md`](./block-142-artifact-plane-renderers-plan.md) — 2026-10-05 立项发令 **active（P0-LAUNCH）**（成果面切片 E；用户裁决「开启新的工作继续 搞完」+依赖裁决「全批 md+xlsx+pdf」）：**renderer 补课**——md=react-markdown ^9+remark-gfm ^4（默认禁 raw HTML 防 XSS）/xlsx=exceljs ^4（有界网格+截断如实）/pdf=pdfjs-dist 复用（WorkspacePdfPreview 已在，零新增）；viewerRegistry 三条新规则正确优先级位+Shell renderPreview 接线（切片 A 扩展性判据验收）；bundle 增量按 R-2 机制重锚。非范围：xlsx 写回、raw HTML、selection 接线。实现=dynamic workflow，主代理终审集成。
167. [`block-141-riders-clearing-plan.md`](./block-141-riders-clearing-plan.md) — 2026-10-05 立项发令 **active（P0-LAUNCH）**（清尾批；用户裁决「开启新的工作继续 搞完」）：**四项在册残项一次闭环**——R-2 bundle 体积基线机制+锚定（@xyflow/react 增量入册）/R-5 D2 注入归属校验（竞窗不注入+自愈）/R-6 matrix 行选 idField 加固/BLOCK-128-①取消终态竞窗分类修复（+③ process_pid 核实）。非范围：②墙面板跨后端（结构性）/BK-08/adopt 流 UI。实现=dynamic workflow 三并行实现员（文件面互斥），主代理终审集成。
166. [`block-140-artifact-plane-split-plan.md`](./block-140-artifact-plane-split-plan.md) — 2026-10-05 立项发令 **active（P0-LAUNCH）**（成果面切片 C；用户裁决「整下一个工作包」接受主代理推荐，BLOCK-139 收口后接棒）：**多 artifact 分屏 + R-1 空态切换器顺带**——P0=产物工具栏「钉住」副栏（renderPreview 同路径无二次取数）+主区自由切换/解除钉住/mode 投影清理；R-1=LineageViewSwitch 自取 /lineage 判空（null/chain<2 整组不渲染，自 BLOCK-138 台账迁入两账注记）；P1=lineage 节点钉住入口+selectionBus last-write-wins。非范围：拖拽分隔条、推翻 isSingleActiveMode、新依赖、后端改动。实现=dynamic workflow，主代理终审集成。
165. [`block-139-selection-loop-plan.md`](./block-139-selection-loop-plan.md) — 2026-10-03 立项当日发令启动 **active（P0-LAUNCH）**（成果面切片 D；BLOCK-138 收口当日主代理建议「选择回路承接 pending 信任层闭环衔接性最好」+ 用户裁决「你看看呢 可以的 开冲」；切片编号按方向文档 §3 勘正=选择回路为切片 D）：**选择回路**——P0=选择总线单选择真相（自定义 store hook+petriEvents 既有模式延伸）+composer 结构化注入（copilotContext 组装链扩展，实体坐标/样本≤12/计数≤2000 恒定有界）+ScientificInteractionViewer 零行为平迁接总线；P1=mark-to-entity（entityType+idField）+「继续分析」真实实体列表驱动（与 BIO-3 P2 下游工具白名单互补不重叠）。收 G0-RS §22.2 #1/#2/#3 三条老账。后端零改动、零新依赖、不引状态库；实现=dynamic workflow（串行红绿+world.run 门禁+独立评审），工作流内不提交。非范围：切片 C/E、pending adopt 审阅流 UI、多 artifact 分屏。
164. [`block-138-artifact-plane-kernel-plan.md`](./block-138-artifact-plane-kernel-plan.md) — 2026-10-01 立项当日启动 **active（P0-LAUNCH）**（成果面系列首包；用户裁决「可以 接下来你就开始吧 定下来 plan完全定之后 我们再开始干活」立项 +「按照计划有序推进」发令；BLOCK-128 实机 rider 零代码面并行零触碰）：**成果面内核 + 血缘 DAG 画布**——P0=切片A viewer registry 契约固化（kind→viewer 注册表+能力声明位）与六类 adapter 零行为平迁；P1=切片B @xyflow/react 只读 DAG 投影 `result_workflow_graphs`（复用 UI-456 GET /lineage 端点）节点点击打开 artifact。唯一新依赖 @xyflow/react ^12.12.0（MIT，四问+裁决留痕 plan §4）。非范围：切片 C/D/E、编辑型 DAG、插件 viewer 运行时接线。
163. [`artifact-plane-direction.md`](./artifact-plane-direction.md) — 2026-10-01 立项 **reference**（成果面方向 canonical；用户方向裁决「灵活+有效」三判据）：**Result Studio → 领域无关 Agent 成果操作面（artifact plane）**——三层契约（对象层/渲染层 viewer 注册表/回路层选择总线+画布视图）+ 切片 A-E + 领域入驻配方（工具包+skill 包+viewer 包，内核零改动判据）+ 反目标六条；与 G0-BIO/G0-PLATFORM/G0-RS 既有资产映射防重复开发（BIO-3 条带已满足出口判据，DAG 升级归 BLOCK-138）。

最后更新：2026-08-18（BLOCK-10-AUDIT-CLOSEOUT COMPLETED · BLOCK-10-ARCHITECTURE COMPLETED · **BLOCK-11-BIOSKILLS-INTEGRATION 启动**：用户裁决 "block-11-bioSkills" 启动 v1.0 plan（active）；Top 5 priority categories：single-cell (P0) / variant-calling (P0) / pathway-analysis (P1) / methylation-analysis (P1) / read-qc (P2)；GPTomics/bioSkills.git → Petri plugin/skill 映射；6 PHASE：PHASE 0 调研 + PHASE 1 single-cell + PHASE 2 variant-calling + PHASE 3 pathway+methylation + PHASE 4 read-qc + PHASE 5 收口；不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+）

## 项目治理入口

1. [`document-governance.md`](./document-governance.md) — 计划、Goal、Handoff、证据、状态与归档的生命周期规范。
2. [`worktree-governance.md`](./worktree-governance.md) — Worktree 启动门、所有权、环境隔离、合并与清理纪律。
3. [`COLLABORATION.md`](./COLLABORATION.md) — 团队协作约定：分支策略、合并前门禁、禁止对 main 强制推送、双机并行协调。
4. [`DOC-REGISTRY.json`](./DOC-REGISTRY.json) — 非归档 Markdown 的机器可读目录与 canonical truth 注册表。
5. [`AUDIT-LOG.md`](./AUDIT-LOG.md) — 每次 Agent 会话优先处理的审计广播台。
6. [`parallel-development-guide.md`](./parallel-development-guide.md) — 多模块并行开发的冲突风险管控策略；独立模块大胆并行，跨层接口变更必须串行。
7. [`architecture/gateway-design.md`](./architecture/gateway-design.md) — Backend Gateway 架构设计；统一入口、路由分发与断路器。

## 长期核心指引

1. [`scientific-intelligence-os-vision.md`](./scientific-intelligence-os-vision.md) — Petri 长期产品愿景、当前定位、阶段跃迁条件与禁止跨阶段建设规则。它约束方向，但不替代当前工作包。
8. [`block-6-ui-158-ui-159-verification-plan.md`](./block-6-ui-158-ui-159-verification-plan.md)
9. [`block-7-ui-161-verification-plan.md`](./block-7-ui-161-verification-plan.md)
10. [`block-8-ui-132-verification-plan.md`](./block-8-ui-132-verification-plan.md)
76. [`g0-living-foundation-plan.md`](./g0-living-foundation-plan.md) — 当前永久 G0 可信基础层主线；LF12 原始核心资格保持 maintained，Result Studio 产品支持声明暂停，P7 deferred。
77. [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md) — 已完成的 G0 Baseline v1 资格认证、证据边界与永久维护契约。
78. [`g0-scientific-data-contract-plan.md`](./g0-scientific-data-contract-plan.md) — SDC-0 / SDC-1-A / SDC-1 / SDC-2 已完成；SDC-3～SDC-7 deferred。
79. [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) — UX1A～UX1G-2 结果体验短闭环已完成；P4R-0～P6 已按非资格边界收口，发布级 P7 deferred。
80. [`g0-critical-crosscut-hardening-plan.md`](./g0-critical-crosscut-hardening-plan.md) — 已重新真实收口的横切修复工作包；保留科学、进程、HTTP 与逐契约 Acceptance 证据。
81. [`g0-rs0-result-studio-audit.md`](./g0-rs0-result-studio-audit.md) — G0-RS0 现状审计与架构 ADR；Result Studio 的复用/新增边界、契约缺陷与 Git 风险矩阵的唯一裁决记录。

    - [`block-9-1-main-js-split-closeout.md`](./block-9-1-main-js-split-closeout.md) — 2026-08-17 BLOCK-9.1 main.js 拆分 5 PHASE 全部落地（2450 → 1066 行 = -1384 行 / -56.5%）；12 个 src/ipc/ + 2 个 src/main/ 共享层；4 治理门 GREEN；不外推
85. [`agent-workbench-enhancement-plan.md`](./agent-workbench-enhancement-plan.md) — Agent Workbench 增强计划（参考文档，已登记）。
86. [`agent-workbench-p1-a5-verification-2026-08-15.md`](./agent-workbench-p1-a5-verification-2026-08-15.md)

    - [`block-10-audit-closeout.md`](./block-10-audit-closeout.md) — 2026-08-18 BLOCK-10-AUDIT-CLOSEOUT 收口报告 v1.0 / 11 节；8 主 commits + 3 PHASE 4 closeout commits；13 项已修复（C-001/C-002/S-001\~S-007/PR-001/OB-004/OB-005 partial/PL-001）+ 12 项不外推；4 治理门 GREEN / 31 tests / 0 新依赖；DOC-REGISTRY `active → completed` + 8 linkedCommits

    - [`block-10-architecture-closeout.md`](./block-10-architecture-closeout.md) — 2026-08-18 BLOCK-10-ARCHITECTURE PHASE 4 closeout 报告 v1.0 / 11 节；12 主范围全部落地（A-001/2/3/5/7/8/9/10 + PR-012 + E-019 full + A-006 部分）；7 关联候选不外推；chf0 5/5 + 106+ tests PASS + 0 regression + 4 治理门 GREEN









120. [`mobile-tunnel-aliyun-setup.md`](./guides/mobile-tunnel-aliyun-setup.md) — BLOCK-70 P3 aliyun 反向隧道一次性配置指引（无域名/IP 版：自签证书 + nginx 443 反代 SSE 关缓冲 + 安全组 + 面板配置 + 排障 + ZeroSSL IP 证书升级路径）。

## Branch Conversation 架构

- [branch-data-model.md](./branch-data-model.md) — 分支对话架构后端核心：SQLite 持久化 + IPC handlers + MCP 工具定义。

## 当前开发必读

默认只按顺序读取三项；若其中声明 active 工作包，再读取对应 canonical 计划：

1. [`AUDIT-LOG.md`](./AUDIT-LOG.md) — 活跃阻塞、待合并和当前进行中阶段。
2. [`next-steps-roadmap.md`](./next-steps-roadmap.md) — 当前立即任务。
3. [`project-workspace-handoff.md`](./project-workspace-handoff.md) — 当前可恢复 Git/工程检查点。
   只有任务实际涉及阶段顺序、UI 或模块边界时，才读取 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)、[`ui-productization-audit.md`](./ui-productization-audit.md) 或 [`development-module-map.md`](./development-module-map.md)。其他 G0 资格、插件、发布和历史材料从上方核心指引、下方专项规范或 `DOC-REGISTRY.json` 按需定位；已完成工作包和 Acceptance 不属于默认启动上下文。

## 当前有效专项规范

- [`codex-style-workbench-direction.md`](./codex-style-workbench-direction.md) — UI 产品方向。

- [`ck05-sqlite-evaluation.md`](./ck05-sqlite-evaluation.md) — CK-05 SQLite 评估报告（mmap64 已实施；node:sqlite 迁移与三契约单源化=不采纳，重开条件在案）。

- [`hk03-symbol-graph-selection.md`](./hk03-symbol-graph-selection.md) — HK-03 P0 符号图勘察选型（结论=方案 A 既有 typescript Compiler API 零新增依赖；P1 开工待裁决，回放校验判据在案）。

- [`hk04-spec-layer-design.md`](./hk04-spec-layer-design.md) — HK-04 能力级规格层设计稿（四键 front-matter+registry 增量+docs:check 增量校验；P1 试点三份选样在案，裁决在用户）。

- **Skills 子文档入口图**（2026-08-16 GATES-4 batch 2 增补）：

  - **入口** [`skills-architecture.md`](./architecture/skills-architecture.md) — Skills 层四层架构设计（Skills → Workflows → Plugins → Capabilities），唯一 canonical=true。

  - 设计稿 [`skills-schema.md`](./skills-schema.md) — Skill Manifest Schema 标准定义（canonical=false，待 supersede）。

  - 设计稿 [`skills-registry.md`](./skills-registry.md) — Skills 注册与发现机制（canonical=false，待 supersede）。

  - 设计稿 [`skills-workflow-integration.md`](./skills-workflow-integration.md) — Skills 与现有 Plugin/Workflow 系统的集成（canonical=false，待 supersede）。

  - 三份设计稿由 `skills-architecture.md` §3 引用；阅读时以架构入口为锚点。

- [`macos-oss-auto-update.md`](./macos-oss-auto-update.md) — macOS 构建、OSS 发布与更新。

- [`plugin-artifact-schema.md`](./plugin-artifact-schema.md) — Plugin/Artifact 兼容契约。

- [`runtime-version-baseline.md`](./runtime-version-baseline.md) — R/Python 运行时精确版本契约（双端一致，约束所有插件 ABI 与 builtAgainst）。

- [`third-party-plugin-guide.md`](./third-party-plugin-guide.md) — 第三方插件结构、环境、验收与发布规范。

- [`harness-engine-spec.md`](./harness-engine-spec.md) — 已完成 Harness 基础技术规范，Stage 3 继续复用。

- [`harness-roadmap.md`](./harness-roadmap.md) — Harness Phase 1–6 完成记录与 Stage 3 技术参考。

- 已完成的 Harness Phase 7、Scientific Task Contract 与 Loop 工程计划保留在注册表中，只在回归对应契约或追溯验收时读取。

- [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md) — 当前稳定版本收口台账、出口矩阵与实机证据。

- [`releases/v0.0.1-rc.6.md`](./releases/v0.0.1-rc.6.md) — Stage 4 macOS 候选版发布说明与已知边界。

- [`releases/v0.0.1-rc.7.md`](./releases/v0.0.1-rc.7.md) — Phase 7、模型 UX 与 ToolResult 实机收口发布版。

- [`harness-tool-template.md`](./harness-tool-template.md) — Harness 工具模板。

- [`first-success-path.md`](./first-success-path.md) — demo/golden-path 回归说明，不是当前产品路线图。

- [`project-wide-audit-2026-07.md`](./project-wide-audit-2026-07.md) - 2026-07-27 六维度横切审计（科学正确性/安全/用户旅程/后端/前端/治理）的范围依据；`qualificationEligible:false`，不升级任何资格声明，优先级与是否启动独立工作包属用户决定。

## 发布记录

- [`releases/v0.0.1-rc.2.md`](./releases/v0.0.1-rc.2.md) — OSS 迁移前历史发布记录。

- `rc.3`、`rc.4` 发布状态与 `rc.5`/`rc.6` 检查点集中记录在 handoff、next steps 与 OSS 更新说明中。

## 历史归档

**工作包条目按月索引（历史段，按需读取，不入默认启动上下文）**

- [`doc-index-2026-09.md`](./doc-index-2026-09.md) — 2026-09 工作包条目索引（108 条，搬移不改写）。
- [`doc-index-2026-08.md`](./doc-index-2026-08.md) — 2026-08 工作包条目索引（56 条，搬移不改写）。

[`archive/`](./archive/README.md) 只保存已完成或已失效的阶段审计、验证报告和旧发布计划。除非追溯问题来源，否则 Agent 不应读取归档来决定当前工作。

## 维护规则

- 创建计划、阶段收口、Handoff、归档或 Worktree 操作时使用 `$petri-project-governance`。

- 默认启动上下文只使用“当前开发必读”四项；不要扫描全部 `docs/` 或 `acceptance/` 猜测当前状态。

- 新建非归档 Markdown 必须同步登记 `DOC-REGISTRY.json` 并通过 `npm run docs:check`。

- 工作包完成前运行 `npm run docs:reconcile`，逐项判断保留、替代或归档，不自动批量搬迁。

- 当前状态只写 handoff/next steps，不继续向其中追加长篇历史。

- 阶段顺序只写 v1 roadmap。

- UI 问题只写 UI audit。

- 历史证据完成后移入 archive；纯重复临时提示直接删除。

- 编号条目按月滚动：每月收口时把上月条目迁入对应 `doc-index-YYYY-MM.md` 索引（搬移不改写），并把迁出文档的 DOC-REGISTRY `entrypoint` 同步改指所在索引。
- 新文档必须从本入口或专项规范中至少有一个明确入口，避免孤立文档。

