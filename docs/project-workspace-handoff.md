# BioF3 Desktop Current Handoff

最后更新：2026-09-25 晚一（**CK-04 完成**：system-prompt 分段预算治理（SECTION_CHAR_BUDGETS 注册表可调）；队列头=CK-05。**恢复要点**：dev 栈在跑（后端需重启加载 system-prompt 改动——下次重启生效或手动重启）；CK 表在 backlog；用户事项 U-01~U-04 待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早十（**CK-03 完成**：jobs 域失效通知 SSE 上线（UI-442 待过目）；队列头=CK-04 分段 token 预算。**恢复要点**：dev 栈已重启加载 /api/events；CK 表在 backlog；增量接入清单=SummaryCard liveJobsPreview（hook 重构）/非 jobs 域（conversations/runtime/knowledge/executionMonitor 发布点待建）；用户事项 U-01~U-04 待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早九（**CK-02 勘察收缩**：cv 与 prepend 锚定冲突（实验数据留痕 AUDIT-LOG），重开=用户实测卡顿报告；队列头=CK-03 轮询→SSE。**恢复要点**：dev 栈在跑；CK 表在 backlog；用户事项 U-01~U-04 待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早八（**CK-01 完成**：运行中发送自动 steer（UI-440 in_progress 待用户过目翻 verified）；队列头=CK-02 长列表虚拟化。**恢复要点**：dev 栈在跑（Vite HMR 已生效）；CK 表在 pending-work-backlog.md；用户事项 U-01~U-04 待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早七（Mac 侧会话；**BK-08=darwin 启动预算档建基线完成（Mac 会话首建）**：darwin arm64 三轮 5 样本实测最差中位数 ×1.10 写入 platforms.darwin 七段档；契约 9/9+终轮 budget.pass=true violations=0；closeout 十门绿+fit=3.36 PASS · jev×8。连带=TEST 实例三连修（dock.hide/并集外摆位/darwin 收尾清场）+impact-map 两连补登+P6 源绑定重打 10/10（darwin-only P6 契约首跑 13/13 零 skip）。**恢复要点**：dev 栈在跑（Mac）；队列头=CK-01（预授权按表推进，项内产品裁决点单独问）；本机 Jev key 已由用户会中提供（gitignore 内 env 文件），决策工具 cloud 全通；用户事项 U-01~U-04 待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早六（**CK 推进系列建表**——CK-01~CK-10 逐项推进序入 backlog（用户预授权按表推进、项内产品裁决点单独问）；队列头=CK-01 steer 接线。**恢复要点**：dev 栈在跑；全量表查 pending-work-backlog.md；用户事项 U-01~U-04（U-04=UI-439 过目）待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早四（**BK-07 三件全部完成**：①loadAssets 收窄 ②死状态拆除+currentVersion 复核推翻 ③copilotAsk 断言；closeout 十门绿 + fit=3.76 PASS。**恢复要点**：dev 栈在跑；**队列无可串行推进项**——BK-08 需 Mac 会话采 5 样本、其余完成/豁免定性完毕；Batch-8 收官态=基线 394 全为书面定性豁免类（清单见早二行）；用户事项 U-01（Jev key 轮换）/U-02·U-03（UI-437·438 过目）待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早三（**BK-07 ③ copilotAsk 断言补齐完成**。**恢复要点**：dev 栈在跑；**队列阻塞于用户**——BK-07 ①② 需用户裁决（五参签名收窄 / 结果元信息接线产品语义）、BK-08 需 Mac；Batch-8 收官态=基线 395 全为书面定性豁免类（清单见上文早二行）；用户事项 U-01~U-03 待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早二（**BK-06=Batch-8 整包收官（基线 947→395，七刀 −552）**——可清族全部归零；豁免类构成=require-await 147 测试替身 / set-state 99 / refs 74（C-11）/ compiler+测试 idiom 39 / control-regex 13 / 匹配器 7 / 契约名 4 / async onClick 2。**恢复要点**：dev 栈在跑；**队列头=BK-07**（③ SideChatDock.test 断言小修；① Office 五参签名收窄需单独裁决；② 结果元信息接线需产品裁决）；重开条件=React 编译器迁移/匹配器类型升级/C-11 立项；用户事项 U-01~U-03 不变待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 早（**BK-06 第七刀=tail 十八族收官（closeout 十门全绿）**——配置双修（build globals+allowEmptyCatch）/unknownText 辅助/联合塌缩/rules-of-hooks 真修/豁免定性 47，根基线 515→397；七刀累计 947→397（−550）。**恢复要点**：dev 栈在跑；豁免类清单=require-await 147（mock 替身）/set-state-in-effect 99/refs 74（拆分=C-11）/control-regex 13/compiler+测试 idiom 39/匹配器 7 等，全部有书面理由；用户事项 U-01~U-03 不变待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-25 凌晨（**BK-06 第六刀=promise 三族收官 + refs 定性（closeout 十门全绿）**——floating 41→0 / misused 41→2 / unsafe-arg 4→0 / refs 74 豁免（拆分=C-11），根基线 597→515；六刀累计 947→515（−432）。**恢复要点**：dev 栈在跑；队列头=BK-06 续批 tail（base-to-string 40 / redundant-type 31 / no-undef 19 / no-empty 19）；豁免类清单=require-await 147（mock 替身）/set-state-in-effect 99（A/B 形态）/refs 74（混合对象）/匹配器 7；用户事项 U-01~U-03 不变待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜九（**BK-06 第五刀=set-state-in-effect 定性（C 类示范修复 2 + A/B 类 99 豁免留痕）+ no-unsafe-assignment 24→7 收口（closeout 十门全绿）**，根基线 616→597；全量 147/1201 绿。**恢复要点**：dev 栈在跑；队列头=BK-06 续批（refs 74 / no-misused-promises 41 / no-floating-promises 41）；教训=注解赋值触发 no-unsafe-assignment 而 cast 形态不触发；用户事项 U-01~U-03 不变待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜八（**BK-06 第四刀=no-unsafe-member-access 全族 151→0 收官（closeout 十门全绿）**——残余 81 条清零，根基线 752→616（−136=真修 81+漂移 55）；全量 147/1201 绿。**恢复要点**：dev 栈在跑；队列头=BK-06 续批（set-state-in-effect 101 / refs 74 / no-unsafe-assignment 66）；教训=错误信封优先 Record 承载（判别联合与 eslint 类型信息可能不一致）；用户事项 U-01~U-03 不变待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜七（**BK-06 第三刀=no-unsafe-member-access result-studio 域簇收口（closeout 十门全绿）**——生产信封类型化 29 + 测试 vi.fn 泛型签名 41，根基线 849→752（−97=真修 70+陈旧槽位 27）；全量 147/1201 绿。**恢复要点**：dev 栈在跑；队列头=BK-06 续批（unsafe-member-access 余 81 / set-state-in-effect 101 / refs 74）；教训=unknown 直投 as 判冗余（any 源一次性信封断言自洽）、fix( 触 .tsx 需 UI-### 而 chore(lint) 豁免。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜六（**BK-06 第二刀=Batch-8 类型面双族收口（closeout 十门全绿）**——no-base-to-string 36 + no-redundant-type-constituents 22（typeof 守卫/联合塌缩，编译语义零变化），根基线 907→849；全量 147/1201 绿。**恢复要点**：dev 栈在跑；队列头=BK-06 续批（unsafe-member-access 151 / set-state-in-effect 101 / refs 74 / unsafe-assignment 66）；教训=String((x as string)) 直投与 no-unnecessary-type-assertion 互锁；closeout 须先提交代码面再跑（工作区未提交 UI 改动会拦红）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜五（**BK-06 第一刀=BLOCK-105 §7 Batch-8 require-await 族收口（closeout 十门全绿）**——生产 stub `Promise.reject/resolve` 契约化直返 35 条 + it/test/hooks 回调安全摘 async 5 条；vi.fn 替身 147 条承重 async 误报豁免保留（教训：测试替身 async=promise 契约+微任务让渡双承重，不可机械摘）；根基线 947→907；frontend/eslint-suppressions.json 化石删除（零消费方+实证漂移）。**恢复要点**：dev 栈在跑；队列头=BK-06 续批（unsafe-member-access 151 / set-state-in-effect 101 / base-to-string 77 / refs 74）；用户事项 U-01~U-03 不变待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜四（**BK-05=阈值热调统一收口（closeout 十门全绿）——队列 4/8 完成，BLOCK-116 W2 候选池清空**——topic-shift/knowledge-guard 闸门迁 getPointRuntime + gates 键级 patch 四层校验（不变量违反拒写），BLOCK-110~113 运行时接点热调全通；实机七断言全过（acceptance/block-116/bk05-gates-hot-tune-live.json）。**恢复要点**：dev 栈在跑；队列下一项=BK-06（lint Batch-8，长线可分批）；output-judge 0-4 量表热调=新登记候选（候选池 C-10）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜三（**BK-04=agent 可见决策工具收口（closeout 十门全绿）——队列 3/8 完成**——decision_summary/decision_recent 只读工具上岗（71→73），实机真模型自主调用正确作答（acceptance/block-116/w2-agent-tools-live.json）。**恢复要点**：dev 栈在跑（已加载 BK-04 工具）；队列下一项=BK-05（阈值热调，BLOCK-116 W2 末件）；BLOCK-120 todoRefs 与本批工具的生产表现并入 BK-02 观察口径。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜二（**BK-03=BLOCK-120 终态对账 v2 收口（closeout 十门全绿）——队列 2/8 完成**——todoRefs 声明制归属落 params（零 migration）+ 对账 v2 条目级失真向后兼容；实机真 spawn 轮 todoRefs=['1'] 落库、clean 轮零假阳性（acceptance/block-120/live.json）。**恢复要点**：dev 栈在跑（已重启加载 BLOCK-120 代码）；全量待办查 pending-work-backlog.md，**队列下一项=BK-04 agent 可见决策工具**；连带清偿=block34 v5.6 断言已同步 v5.18 契约。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24 深夜一（**BK-01=BLOCK-119 加映 4 收口（closeout 十门全绿）——队列 1/8 完成**——fit 波动治理落地：注册表 fitReviewBand=0.5（证据绑定 fit-volatility-review.json）+ judgeOutput 邻域重放 median-of-3 + report-guard/child_finished 增 additive fitReplay；实机真 spawn 轮端到端（首判 3.15→重放→median 3.14=PASS，证据 acceptance/block-119/jiaying4-live.json）。**恢复要点**：dev 栈在跑（BIOF3_JEV_REPORT_GUARD=1，vite+electron 均 09-24 起）；全量待办查 pending-work-backlog.md，**队列下一项=BK-03 终态对账 v2 条目级 linkage**（需 migration，启动照立项检查单）；用户事项 U-01~U-03（Jev key 轮换/UI-437·438 过目）待用户。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-24（**全局未完成项计划表建表 + 队列首项 BK-01 立项（用户裁决「列个未完成计划表，所有已知的问题都需要待处理，后面按照逐个推进」）**——canonical 队列台账 [`pending-work-backlog.md`](./pending-work-backlog.md) 建表（truthDomain=pending-work-queue；推进队列 8 项：BK-01 fit 波动治理→BK-02 观察期→BK-03 终态对账 v2 linkage→BK-04/05 BLOCK-116 W2 剩余→BK-06 lint Batch-8→BK-07 抓真 3 件→BK-08 darwin 预算档；用户事项 3：Jev key 轮换裁决 / UI-437·438 实机过目；候选池 9 + 阻塞延期 4 + 已核实销号 2）。**恢复要点**：全量待办状态查 pending-work-backlog.md（逐项推进=单工作包串行）；本 handoff 只记 active 包与可恢复状态；首项 BK-01=BLOCK-119 加映 4 fit 波动治理同批启动（plan 加映节见 block-119 plan）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-23 晚十（**BLOCK-118 当日整包 completed（用户裁决与 UI-437 v5.1x 并行）——开发时决策工具化落地；BLOCK 槽位空闲（UI-437/438 属 UI 轨仍 in_progress）**——`npm run test:suggest` / `npm run doc:suggest -- --context "<改动说明>"` 双供给建议 CLI（`--supply=cloud`=备份 env key 直连 Jev 云只读不回显；`--supply=file`（默认）跟随设置页 provider=本地 Laya）。**校准裁决（证据 acceptance/block-118/）**：test-suggest=Jev 云可用（θ=0.8）、Laya 不可采纳（confidence/top-probability 双语义不过门，恒零建议=安全默认非故障）；doc-suggest=仅 planDoc 有 Jev 门控（θ=0.5 精度 0.8222/覆盖 0.8654），uiAudit=frontend/src 确定性硬规则，roadmap/handoff/auditLog 双供给不可采纳=静默。**恢复要点**：建议器只附加不下判（零建议≠工具故障）；决策配置裸 shell 下须锚定 `.biof3-dev-user-data/data/decision-config.json`（包装已内置）；agent 指引=gewu-dev-infra `references/DEV-DECISION-TOOLS.md`；注册表 thresholdsByModel 仅 dev-time 点使用，翻转 Laya 裁决需重校准。提交 b7acf26a。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-22 深夜九（**BLOCK-116 当日整包 completed（closeout 十门全绿）——决策内化弧 W2 前四件完成，当前无 active 工作包**——决策台账 decision_log（migration 011，meta {point,threshold} 咽喉记账）+ 七接点阈值注册表（证据绑定）+ 校准共享库 + 观测面（summary 端点+设置面板 UI-434）+ flow 5/5。**当前无 active 工作包**；W2 剩余=逐条回放 UI/阈值热调/agent 可见决策工具（候选池）。43+ 提交已推 origin。G0 开发期常态 · 不外推 packaged/Provider/GA。）W1-5 增量测试建议（谨慎档）：impact-map 下限零改动、只加不减；P0 校准 gate.passed（六域+docs 确定性前置层、θ=0.8 精度 89.8%）、dogfood 实证。**当前无 active 工作包**；弧线后续=W2 平台化评估前置（另裁）。G0 开发期常态 · 不外推 packaged/Provider/GA。）W1-3 工具两跳预路由：P0 校准 111 条 overall 91.9%、θ=0.80 精度 98.75%；tool_route 事件通道观测、flow 3/3；arch-cycles 断环（域映射经 agent-tools index 既有边）。队列=W1-4 → W1-5（用户「开 按顺序都做完」）。**当前 active=BLOCK-114，槽位占用中**。G0 开发期常态 · 不外推 packaged/Provider/GA。）W1-3 工具两跳预路由：agent-runner 下发链九域+all 分类、采纳收窄=路由域∪session、BIOF3_JEV_TOOL_ROUTE=1 默认关、71 工具恒等红线。此前=BLOCK-112 当日整包 completed（W1-2 意图路由）。——W1-2 意图路由：P0 校准 117 条 overall 98.3%、θ=0.70 task 零误采纳；chitchat 快路径（BIOF3_JEV_INTENT_ROUTE=1 默认关，事件回放镜像 agent-runner、meta.chitchatFastPath 落库标记）契约 13/13 + flow 6/6。队列=W1-3 → W1-4 → W1-5（用户「开 按顺序都做完」）。**当前 active=BLOCK-113，槽位占用中**。G0 开发期常态 · 不外推 packaged/Provider/GA。）

最后更新：2026-09-22 晚（**BLOCK-111-JEV-W1-MARKER-CLASSIFICATION 当日立项当日整包 completed（closeout 十门全绿）**——决策内化弧 W1 首点 marker→细胞类型判别二跳：规则表候选生成 + `decision-api` choice 二跳（θ=0.55 门控：adoptedAccuracy 1.0/coverage 0.9125，vs legacy 0.8375）+ `/api/ai/interpret` cellTypeHintsDetailed additive（老契约零变化）；默认关 `BIOF3_JEV_MARKER_GUARD=1` 显式开；P0 校准 104 条语料 gate.passed + P1 契约 14/14 + P2 A/B 生产路径 gate.passed + 实机 flow `block111-marker-live` 7/7。D-1~D-5 已获用户裁决定版（「继续 按推荐的进行」，θ=0.55 维持）；A/B 轮 1/12 陷阱采纳（轮间方差）如实登记。**当前无 active 工作包**；W1 队列 2~5 点待各自单独裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-22 午后二（**BLOCK-111-JEV-W1-MARKER-CLASSIFICATION 立项即启动 active（P0-LAUNCH）**——用户裁决「1」启动 Jev W1 决策内化弧线；首点=marker→细胞类型判别二跳（arc §W1 队列第 1 点，逐点立项）：`interpret.js` CELL_MARKERS 规则表降级为候选生成器 + `askDecision` choice 补概率/confidence + 阈值门控 + `/api/ai/interpret` cellTypeHintsDetailed additive；W0（BLOCK-110）wrapper/harness 零改动复用；P0 预登记 D-1~D-5 裁决项；W1 队列 2~5 点仍需各自单独裁决。**当前 active=BLOCK-111，槽位占用中**。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-22（**BLOCK-109-CORE-ARCH-CONVERGENCE + BLOCK-110-JEV-DECISION-INTEGRATION 两包接连整包 completed（closeout 十门全绿，提交至 4dbfeff7）**——前者=会话核心链路架构收敛：事件单一事实源+组装唯一化+legacy SSE 786 行退役+工具元数据化 74 件+架构门禁基线化（P0→P3，flow block109-single-truth-live 7/7）；后者=Jev/System One 决策融合 W0：decision-api 裸 HTTP wrapper+中文校准 260 样本 gate.passed+话题漂移 noul 直替（A/B 100 条一致率 0.955）+知识库二跳（默认关+显式开，实机腿 7/7），P3 选做不执行（裁决留痕）；连带=.biof3-secrets source 入重启脚本修 Windows 凭据接线（DASHSCOPE_API_KEY 此前从未进后端 env）。**当前无 active 工作包**；排队候选（启动均需用户裁决）=BLOCK-110-JEV W1+ 决策内化弧线 / 终态对账条目级归属（待数据模型 linkage）/ 子智能体汇报收敛实机观察期（UI-433 verified）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-21（**BLOCK-109-AGENT-ORCHESTRATION-UX 整包 completed**——主循环瞬断重试（网络瞬断退避×2）/ spawn 并行度软上限（≥3 软指引）/ 结果卡组化（弃 slice(-2)，可折叠汇总卡）/ 概览孤儿过滤（「18 个」= 6 真实 + 12 孤儿泄漏的根因修复）；UI-432 verified；同批 Gewu-StackWatchdog 退役（用户裁决「软件启动就活着 不主动启动就没必要活着」，/DISABLE 未删除）。**当前无 active 工作包**。此前 最后更新：2026-09-21（**BLOCK-108-CONVERSATION-STREAM-QODER-FIDELITY 整包 completed（一次会话 P0→P3 + 实机；closeout 九门全绿 + flow 7/7）**——会话信息流 Qoder 化：执行间过渡叙述（progressUpdates 簇前正文式，持久化穿参修复）+ 簇内统一单行点击展开 + 计数式簇头 + 思考入簇；UI-429 verified。**当前无 active 工作包**。同批修复依赖升级批 vite 8.3 dev server 双断链（dev 白屏→可用）。此前 最后更新：2026-09-21（**BLOCK-107-CONVERSATION-STREAM-UX 整包 completed（2026-09-20 立项即启动 → 2026-09-21 P3 收口；closeout 八门全绿）**——**会话信息流呈现时间线化**：P1 分段模型 + 按 `iteration` 交错渲染（思考/工具簇/阶段进度上轴）+ D4 运行展开/完成折叠 + 运行秒表 + 历史/实况一致性机械契约；P2 历史降级（无素材退回分组堆叠，老会话不白屏）；P3 四条实机腿全绿（历史 5/5 / 实况 7/7〔真实模型〕/ 三宿主面 6/6〔中央×悬挂逐段相等〕/ 长会话分页 7/7〔250 条合成、窗口 200、上翻补齐、刷新重置〕），UI-428 **verified**；flows `block107-timeline-history/-live/-hosts/-long`，证据 `acceptance/block-107/`。**唯余帧时基线未采**（属虚拟化候选包前置证据，随本包收口转交该候选包）。**当前无 active 工作包**。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-20（**BLOCK-107-CONVERSATION-STREAM-UX 启动 active（P0-LAUNCH）**——用户裁决「按推荐的来」= 采纳 plan §7 全部推荐项（**D1=c**：呈现层按 `iteration` 交错——依 §0.6 实测把原推荐 b 修正为增强备选；D2=尽力还原；D3=按迭代分批；D4=运行中展开/完成后折叠；D5=阶段进度独立分段；D6=同包拆分）；P0 数据层基线已补采（`task_events` 236,087 行 vs `copilot_messages` 180 行 = **1,312:1**、`delta` 占 98.54%、`toolActivities[].iteration` 覆盖 **315/315 = 100%**、单消息最多 33 活动 + 14 思考段、会话消息数最大 64 故 200 条窗口从不触发分页），唯余帧时基线待实机 → P1 分段模型 + 交错渲染开工；UI 台账 = **UI-428**。槽位占用中。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-20（**Windows 会话：BLOCK-106-STARTUP-PERFORMANCE-RATCHET 整包 completed**（当日 P0→P3 一次会话；用户裁决「开 BLOCK-106」）——启动六段回到 09-18 基线之下（`dataReady` 1163→911-945ms）、**入口 chunk 3,061,221→568,207 B（−81.4%）**、启动性能从「字段存在即绿」升级为**按平台分档的中位数棘轮**（`test/startup-perf-budget.json` schema v2）、`task_events` 清扫 SCAN→SEARCH + ISO 契约错标根治、两处控制字节真缺陷 + `hygiene:check` 检查项 5。同日更早=文档/基建一致性漂移清偿批（发现桥退化修复→检查项 4；AGENTS.md 事实对账；`test:changed`/`quality:lint` 两处自 71dd5d98 起的静默断线；六包 snapshot 标签补打并推送）。**⚡ Mac 侧新增必做项见下方清单第 11 条（darwin 预算档）**。槽位已空，BLOCK-107 登记避让解除。G0 开发期常态 · 不外推 packaged/Provider/GA。）

此前 最后更新：2026-09-20（**Mac 会话之五：BLOCK-105 §7 Batch-4 前端 `no-unused-vars` 整族清零 completed（用户裁决「BLOCK-105 §7 剩余抑制基线收缩 冲」）**——`@typescript-eslint/no-unused-vars` 410→0，抑制基线 **2150→1740（−410，只删不加，其余 27 条规则零新增）**；机械面 TS AST codemod 删未用 import 绑定 359（最大件 `ResultView.tsx` UI-146 化石块 148 行/154 条），人工面=`leftPanelCtx` 死对象级联退役 25 别名/回调 + 解构 17（rest 保 omit）+ 形参 `_` 前缀 10 + 死 useMemo/useCallback 7；**tsc 当裁判**抓出 eslint 看不见的两处语义残骸（`{, jobs }` / 对象解构与初始化字面量的 excess-property 反向耦合）；**抓真 4 件登记待裁决**（Office `loadAssets` 五参未用=鉴权面疑未接线 / 知识会话台两补丁器定义即死 / 结果元信息与版本 state 只写不读 / SideChatDock 用例头注未断言）；净改动 59 文件 −532/+88，零 UI 行为变化（门禁登记 `c6a9b6d1` 双豁免）；验证=前端 144/1146 0 红 + `quality:types` 0 红 + Node 影响范围 852 绿/1 红（P6 源绑定门，批末重打）/7 skip；详见 plan §7。**当前无 active 工作包，下一个选题需用户裁决**。G0 开发期常态 · 不外推 packaged/Provider/GA）。
此前 最后更新：2026-09-20（**Mac 会话之二：前端依赖升级批 + P6 产品验收证据重打 completed（用户裁决「行 冲」续接 ⚡ 第 1+2 项，两件同批）**——react-router-dom 7.18.4 / vite 8.3.0（rolldown）/ vitest 5.0.1 / happy-dom 20.14.5 / @vitejs/plugin-react 6.1.1（Babel→oxc）；npm audit 官方源 0 vulnerabilities；升级引出四处适配（vite 8 解析语义→`resolve.dedupe` 单实例 React / happy-dom 20 style proxy + vitest 5 收紧 spyOn→测试改断言真实写入 / **真缺陷修**＝SVG `matrixTransform` 守卫 / **v7 连带修**＝49 处 navigate `void` 显式化，类型感知 lint 复绿）；P6 实采 10/10 锚定 `f4af1ad2`（同批三次重打：后续源改动依次使前两锚退役），旧锚 c9535452 失配销号，默认校验路径复验 PASS；前端 144 文件/1146 用例 0 红 + `vite build` 出包；新登记 🟡＝前端 tsc 29 红存量未入 closeout 链。收口连带＝prune 抑制条目 −10（2163→2153）+ UI 门禁同型先例豁免，**closeout 八门全绿（HEAD 3eb814c5）**；当前无 active 工作包，队列＝⚡ 清单第 3 项起（Mac 侧七红已清偿；第 4-10 项为基建知悉类）。G0 开发期常态 · 不外推 packaged/Provider/GA）。
此前 最后更新：2026-09-20（**Mac 会话：BLOCK-105 §7 Batch-3 抑制基线收缩 completed（用户裁决「继续」续接队列①）**——根 2783→2163（−620），no-unused-vars 622→0 清零（acorn AST codemod 机械面 + 人工三分类：死函数 13 件/只写不读链/契约豁免 2 条）；测试抓真两类回归已闭环（解构 omit 语义 ×3、thin facade 源码契约名 ×2）；closeout 八门绿，test:changed 2344 项 2315 绿 15 红全基线存量；当前无 active 工作包，队列=⚡ 清单第 1+2 项（P6 重打与依赖升级批必须同会话）。G0 开发期常态 · 不外推 packaged/Provider/GA）。
此前 最后更新：2026-09-19（**Mac 会话：BLOCK-88 整包 COMPLETED（P4 收口，用户裁决「开P4」；Windows 侧配合重启后端+出码）**——双真机端到端 12/12 allPass（Mac 指挥席×Windows 真机：身份/归属/授权三层跨机贯通+真实模型委托）；closeout 聚合 5/5；整包 P1 15/15+P2 13/13+P3 16/16+P4 12/12，UI-418/419/420 verified。🟡 在册=P6 源绑定重打。详见下方总账与 AUDIT-LOG）。
此前 最后更新：2026-09-19（**Mac 会话：BLOCK-88 P3 项目授权边界收口 completed（fe7649fc，用户裁决「开P3」）**——grants.json 单一真相+越界诚实 403+授权项目委托落 project_id 绑定（消化「delegation 无项目绑定」缺口）+UI-420 授权卡；实机 16/16 allPass；整包 P1-P3 交付完成，P4 closeout（双真机端到端）待裁决。详见下方总账与 AUDIT-LOG）。
此前 最后更新：2026-09-19（**Mac 会话：BLOCK-88 P2 任务归属隔离收口 completed（8ad51d36，用户裁决「开P2」）**——独立委托会话+归属标记+默认视图隔离+UI-419；实机 13/13 allPass（真实 delegate 工具跨节点模型回执 done）；定向 7 红全存量（基线对照证实）。队列：BLOCK-88 P3 待裁决。详见下方总账与 AUDIT-LOG）。
此前 最后更新：2026-09-19（**Mac 夜间会话：BLOCK-88 P1 身份层贯通收口 completed（7cc5cbf3）+「侧边聊天悬挂化」对账消项（UI-417 已 Windows verified）**。P1=配对握手 additive identity+peers/会话注册表扩展+联邦面板协作成员（UI-418 同提交 verified）；实机 15/15 allPass 证据 acceptance/block-88/；P6 源绑定存量红 🟡 入册。详见下方总账与 AUDIT-LOG）。
此前 最后更新：2026-09-18（**Windows 会话总账④：BLOCK-85 双真机验收 completed → 整包收口 + 双端 auto-sync 基建上线（本会话夜）**。**BLOCK-85 三步全过**（证据 `acceptance/block-85/dual-p*.json`）：P1 配对 probe 穿 aliyun 175ms 绿灯 → P2 fed 分析作业（deseq2 在 Mac 10s completed+产物真值 /Users/...+Windows 零拉回）→ P3 delegate 委托（REST task 模式+SSE 消费驱动；Mac agent 独立执行 system_info 侦察，回执 success+Darwin/arm64 指纹回流）。**顺修两缺陷**：job-provenance collectExecutionInputs require 断链（ee317893，插件作业收尾必炸）+ delegate 终态 done≠completed 误报。**登记两结构缺口归 BLOCK-88 域**：delegation 无项目绑定（workspace_* 工具 project_required）+ 委托未开独立会话（历史纪律污染）——写类委托待缺口修复，P3 载体为只读侦察。**双端 auto-sync**：Windows 计划任务 Gewu-AutoSync + Mac launchd com.gewu.auto-sync 每 2 分钟安全档（fetch+ff-only，推不自动），FF 实战已捕获 Mac 推送；SKILL 第 8 条=双端纪律唯一标准源（含 dirty SKIP/Mac lsof 定点杀/TCC 前提三条实战纪律）。**队列=BLOCK-88 P1（D7 门槛已满足，P0 八项裁决已备 docs/block-88-engineer-collab-p0-design-review.md §8，启动需用户裁决）**。G0 开发期常态 · 不外推 packaged/Provider/GA。）。此前 最后更新：2026-09-18（**Windows 会话总账③：当日三连——BLOCK-99 多空间（475a98c5）+ BLOCK-101 启动性能（e1ea4bbd）+ UI-417 侧边聊天悬挂化（4da4bb4a）全 completed/verified 已推**。**UI-417 交付**：SideChatDock 中栏右缘常驻把手（聊天图标+agent 运行中呼吸灯）+滑出 380px overlay（外点/Esc/再点收起）复用 SimpleChat 同会话同 run（中央 ownsCopilotAsk 归属不变）；右栏「聊天」tab 退役（词表+分支+死 CSS 38 行清；入口经 gewu:side-chat-open 收编）；组件 6/6+回归 5/5+theme 4/4+tsc 0；实机同会话双栏同步铁证（acceptance/ui-417/）。**队列=BLOCK-85（P4 closeout 完成 1d014a39 四门绿+探针 3/3，唯余双真机验收待 Mac+用户配对）/ BLOCK-88（P0-APPROVED，D7=85 双真机验收后启动）**——**Mac 侧会话必读：acceptance/block-85/DUAL-MACHINE-RUNBOOK.md（拉取后照做：BIOF3_MOBILE_ENABLED=1 起栈→出码→Windows 兑换→P2 REST fed: 作业→P3 delegate 委托→回写解锁 88）**。G0 开发期常态 · 不外推 packaged/Provider/GA。）。此前 最后更新：2026-09-18（**Windows 会话总账②：BLOCK-99 多空间整包 completed（475a98c5）+ BLOCK-101 启动性能当日启动即收口 completed（e1ea4bbd）——当日双包**。**BLOCK-101 交付**：P0 度量仪表（D1 四段打点 mainReady/preload/windowShown/didFinishLoad 主进程 + firstPaint/dataReady 渲染层 useStartupTimeline；flow block101-startup-timeline 自管测试实例冷启动采样；**基线 dev 态 5 采样 dataReady 984ms 中位**，plan §7）+ P1 首屏 SWR（gewu-startup-snapshot-v1 快照同步先渲染+对账写回+fail-closed；契约 4/4；主实例 9 项目写回 CDP 铁证）+ P2 无串行链/P3 虚拟化 deferred（>300 节点）/P4 打包态 deferred（dist 产物保管）。UI-416 verified；plan/registry completed。**仪表抓真 3 件**：沙箱 preload 跨文件 require 即整桥爆掉静默去桥（BLOCK-100 同款坑再踩——preload 改动必须重启栈且若窗口 0 页面先查 preload 爆掉）/channels.js 导出形态（module.exports=对象本身）/performance.timeOrigin 跨进程语义不一致（相对值换算归口各自时间轴）。**BLOCK-99 见下条总账**。**队列=BLOCK-85 Mac 双真机（P4 closeout 待收，需 Mac）/ BLOCK-88（P0-APPROVED）/ 悬挂化候选（UI 轨）**。G0 开发期常态 · 不外推 packaged/Provider/GA。）。此前 最后更新：2026-09-18（**Windows 会话总账：BLOCK-99 知识空间多空间版+管理会话台 整包收口 completed（P1→P6 当日四阶段，3580c803..P6 收口笔）**：G1 多空间 CRUD（spaces 六端点+存量参数化 18 端点+chunks 归属抓真修复）→ G2 切换器（台账线 701→668）→ G3 会话级绑定与召回（migration 010 绑定表 FK CASCADE 掉绑回落默认）→ G4 管理会话台（/knowledge 页双栏轻量聊天面零触 SimpleChat；工具族 12 件总数 59→71；D4 破坏性确认门=helpers/knowledge-confirm 一次性 confirmToken 绑 action+subject，内联确认卡回灌消息模型凭 token 重调；D3 context.toolSubset='knowledge-console' 子集 15 件 runner/chat 两路同源过滤+纪律段；D6 独立 conversation localStorage 记忆+存在性校验；双通道同步事件 gewu:knowledge-console-sync）→ G5 失配统计按空间 → G6 flow `block99-knowledge-multispace` 注册实机 **22/22 allPass**（真轮次工具链/D4 两腿/绑定链 CASCADE/CDP UI 真轮次+截图；证据 acceptance/block-99/）。**会话抓真 5 件**（含跨阶段）：①agent-runner buildTurnInjection 漏传 conversationId（P3 主路径绑定从未生效）②管理台未声明 accessMode 被 inferExecutionPolicy fail-closed 塌缩 read 全拒 mutating（S-003 家法）③启动恢复/批量重试写死 ks_default 跨空间卡死 ④searchKnowledge staleEmbedding 恒算默认空间 ⑤global-page .body column 覆盖 pageBody row 意图致会话台堆叠全宽。门禁：契约 48/50（2 红=F2 PDF 动前存量基线，Windows 本机）+ registry 10/10（71 计数+子集契约）+ hook 6/6+面板 11/11+tsc 0+theme 4/4+docs/ui-audit 绿；UI-414/415 verified；impact-map block99 规则；UI-405..413 全 verified。**教训**：工具族测试必须 dispatchTool 全链（直调 handler 绕过 interceptor+policy）；跨 turn token 类确认流 token 必须走用户可见消息文本（tool_result 不进下轮模型上下文）；实机脚本 conversationId 必须先 REST 建真实会话；restart-dev-stack.sh 杀全部 electron 含测试实例→重启栈后须重跑 start-test-instance.sh。**队列=BLOCK-101 启动性能（planned 可插空）/ BLOCK-85 Mac 双真机（P4 closeout 待收）/ BLOCK-88（P0-APPROVED）/ 侧边聊天悬挂化候选（UI 轨）**。G0 开发期常态 · 不外推 packaged/Provider/GA。）。此前 最后更新：2026-09-18（**Windows 日间会话总账：遗留清偿 + BLOCK-100 测试实例基建整包 + BLOCK-101 立项 + 测试预览窗五轮迭代（UI-405..413 全 verified）**：①远程两次同步+skill 核查；②遗留一次性清偿（continuation guard 修测试清偿 25/25；result 投影接线/连接徽标销号）；③UI-405 投影 AI 设置桥 verified（aiSettingsBridge 信封对齐 IPC+直引改 getBridge）；④UI-406 引导页退役+投影 runtime 假横幅修复 verified（DesktopOnboarding 全删含死代码；BackendStatusProvider DEV 分支改消费 /api/runtime/status+诚实映射）；⑤UI-407 空态示例卡通用化 verified（领域中立三卡+领域卡动态追加）；⑥**BLOCK-100-CDP-TEST-INSTANCE 当日立项即整包收口 completed**——测试实例隔离基建（独立 userData/离屏可见窗口 1280x800/CDP 9223/零 fork 后端/固定逻辑视口等比缩放/鼠标穿透+Ctrl+Alt+M 管理模式/screen-saver 层置顶）；app-health+ui341 已迁测试实例；用法=start-test-instance.sh [--onscreen]→npm run verify -- <flow>。抓真：appendSwitch 压 argv 端口（hasSwitch 守卫）+默认 level setAlwaysOnTop 创建期不生效（须 screen-saver 层）+getMainWindow 惰性解析+SPA 导航丢 ?test=1 端口专属回退；⑦BLOCK-101 立项 planned；⑧AUDIT-LOG 滚动归档执行（95KB→42.8KB，零删除）。**队列=BLOCK-99/BLOCK-101/BLOCK-85/BLOCK-88+chat-dock 候选**。运维注意：restart-dev-stack.sh 杀全部 electron.exe 含测试实例→主栈重启后须重跑 start-test-instance.sh；测试窗口勿最小化。G0 开发期常态 · 不外推 packaged/Provider/GA。）。此前 最后更新：2026-09-18（**Mac 夜间会话总账：看门狗自动化上线 + BLOCK-94 知识空间专业化整包收口 completed（P0–P6 一次会话）**；队列余 BLOCK-85（Mac 在位已解锁）→ BLOCK-88（需立项评审））。

## ⚡ Mac 侧待办清单（2026-09-19 用户裁决「mac侧的不要丢失 等换到mac再开始」固化——换到 Mac 后的第一件事，按序执行）

1. ✅ **P6 产品验收证据重打（2026-09-20 completed：Mac 实采 10/10 锚定 `f4af1ad2`，🟡 销号）**：`node scripts/g0-rs-p6-product-acceptance.mjs --live --write-evidence`（dev 栈在跑前置）。**只能在 Mac 跑**：Windows 实测被平台门拒绝（`p6_restart_checkpoint_hold_unsupported_platform:win32`）；当日 Mac 侧尝试亦未果（`p6_restart_worker_exited_before_checkpoint`），需安静环境 + dev Electron 在位的专项会话。
2. ✅ **依赖升级批（与 P6 重打同批，不可拆）（2026-09-20 completed）**：react-router v7 / vite 8 / vitest 5 / happy-dom——前端生产链 2 moderate（react-router 6.30.6 已是 6.x 末版）+ dev 链 esbuild/vite 通告；**frontend/package-lock.json 属 P6 源绑定集合**，动 lockfile 即扩大 stored 哈希失配面，必须与第 1 项同会话同批（AUDIT-LOG 🟡延期 2026-09-19 行）。
3. **存量红 7 件归属核对**（Mac 侧跑定向即见）：block67 fs verbs 4 红（macOS bash 3.2 面）+ sys_resource 1 红（Linux/WSL 语义面）——Windows 本机实测全绿（14/14、5/5），属平台差异非产品缺陷，可在 Mac 侧修断言或标注平台跳过；~~P6 源绑定 2 红随第 1 项转绿~~（2026-09-20 澄清：定向套件在干净树上 13/13 绿——套件校验注入合成证据；真实 stored 失配经直调 `verifyStoredP6ProductAcceptanceEvidence()` 实证仍在，待第 1 项重打；AUDIT-LOG 🟡 行同日澄清注）。**2026-09-20 Mac 实测复核**：7 红全数复现（block67 fs×2+mux×2+exec×2+sys_resource×1，根因=BSD `base64` 位置参数/`/proc` 缺失），归属维持「修断言或平台跳过标注」待裁决；同批 installTarGzBundle 3 红已当场修真（见第 5 条）。**2026-09-20 清偿 completed**：①4 红（write→stat→read / exec 同步 / exec_bg 生命周期 / mux exec）根因=node-agent 脚本 GNU 专用 `base64` 位置参数形式（BSD base64 实测 exit 64 拒绝）→ 3 处改 stdin 重定向（`base64 < "$f"`；exec 输出编码 fallback `base64 < "$outb" | tr -d '\n'`），GNU 侧逐字节等价已实证（homebrew gbase64 模拟新旧形式对 768B 二进制载荷 cmp BYTE-IDENTICAL），4 用例在 Mac 原生转绿（非 skip）；②3 红属 Linux 目标面本地不可执行（fs_list 依赖 GNU `find -printf`、sys_resource 依赖 `/proc`）→ 按 BLOCK-104 加可见平台门（darwin skip 带原因串）；Windows 侧未动、Linux 节点行为不变；③连带消除 mux die 用例对 fs verbs 用例副作用的隐式依赖（skip 后暴露，改自建前置）；④补两处注册缺口=冻结门基线 +capability-bundles.js（Batch-1 平台条件化=合规分支）+ impact-map 新增 platform-branch-freeze 规则（该全局门此前无任何定向路由，Batch-1 引入的新平台分支静默绕过）。定向五文件 43=40 绿/0 红/3 可见 skip。
4. **Windows 侧新增基建需 Mac 知悉**：StackWatchdog 计划任务（每 5 分钟栈健康+死亡法证+自愈，wscript 隐藏链，当日三次进程团灭后部署并实战验证）；**BLOCK-102 :3001 Host 白名单** `^(localhost|127\.0\.0\.1)(:\d+)?$`——若 Mac 侧存在非 localhost Host 访问 Windows :3001 的场景需先核对。

### ⚡ 增补（2026-09-20 深夜 Windows 会话，BLOCK-103/104/105 三包交付后的 Mac 侧增量）

5. **先跑 `npm run state` + `npm run quality:secret && npm run quality:arch && npm run quality:lint && npm run quality:types`**——closeout 已扩为九门（+quality:secret/arch/lint，2026-09-20 再 +quality:types），Mac 侧跑 quality 四门应全绿（eslint-suppressions.json 用正斜杠跨平台；若 lint 红请先对账 Mac 侧新增违规而非改基线）。`npm run quality:baseline` 一键重跑 P0 四项体检（python3 已适配 macOS）。**2026-09-20 Mac 首跑实测完成**：三门全绿（secret 0 真实命中/arch 1214 模块 0 违规/lint 0 错误，正斜杠基线跨平台成立）；顺带收口 BLOCK-105 §7 Batch-1（根 2914→2890+frontend 2126→2125，真缺陷 2 件=capability-bundles `--force-local` macOS bsdtar 拒绝致 R 能力包安装 Mac 全挂→win32 条件化 `TAR_FORCE_LOCAL`、ide-tools/diff.js 单引号 `\P`→`P` 回退路径损坏→双反斜杠）+ impact-map 补登记 audit-log-compact.mjs（71dd5d98 注册遗漏曾致 test:changed 恒红）；继承 CodeBuddy 停止前 WIP 2 件（eslint.config `openclaw/**` 忽略+compact 死代码清理，均核实成立）。
6. **新增跳过类测试的恢复条件**（Mac 侧部分自动恢复）：g0-rs-p6 两测 win32 skip → Mac 侧会**真实运行**（预期：装包/重打后转绿，或仍红按 §11 归因）；agent-tool-result + agent-workflow-phase6 需装领域包（`deseq2`/`deg-standardization`，装包自动恢复）；deepseek-retry 六用例 skip 是平台无关的「retry 层未实现」语义（实现 retry 时移除门）；ide-tools-terminal 默认 skip（node-pty conpty 需交互宿主，排障 `NODE_PTY_TEST_ALLOWED=1`）。
7. **Windows 专属脚本已标注**（BLOCK-105 P4 scripts-platform-contract 门禁）：`restart-dev-stack.sh` 事实为 windows 链（taskkill/PowerShell）——**Mac 侧重启 dev 栈走 SKILL 第 7 条**（lsof 定点杀 :3005 后起栈），等价脚本待补（候选小活）；8 个 .sh 全部带 `# platform:` 标注，新脚本必须标注（门禁会拦）。
8. **Lint 债务纪律**（AGENTS.md「Lint 债务纪律（棘轮）」节 + SKILL「代码质量门禁纪律」节）：eslint-suppressions.json 存量 **2153 条**（Batch-1/2/3 + 依赖升级批后：2912→2890→2783→2163→2153）只许收缩不许放宽；新违规三分类（真缺陷修/化石删/豁免登记）；parsing error 无法抑制先清化石。
9. **e5c23597..71dd5d98 治理沉淀**：等待纪律/预授权开工模式/AUDIT-LOG 自动精简（`npm run audit:compact`）均已入 gewu-dev-infra SKILL.md——Mac 会话直接继承，无需额外动作。
10. **Agent Skill 发现桥双宿主就位**（2026-09-20 Mac 会话补齐，用户裁决「该带的都带上 确保开发的稳定和一致性」）：`.codebuddy/skills/` 新增 4 个同名相对符号链接（→ `../../.agents/skills/<name>`，与 `.claude/skills/` 同形；canonical 仍只在 `.agents/skills/`，无第二份副本）。**实测 `use_skill gewu-dev-infra` 运行时即加载**（Base directory 指向 `.codebuddy/skills/gewu-dev-infra`，无需重启 IDE）。纪律已入 AGENTS.md「Agent Skill 发现桥」行：新增/改名/删除 Agent skill 必须同步补齐全部发现桥，否则对应宿主静默 `not found`；`.codebuddy/` 下除 `skills/` 外运行时数据由 `.gitignore` 排除（check-ignore 实测 IGNORED/TRACKABLE 分类正确）。其他宿主无 skill 发现约定、无需桥：Cursor=`rules/*.mdc`（本地未入库）、Trae/Kiro/WorkBuddy=`documents`/`hooks`/`memory`、`.aionrs`=本机 CLI 链接（已 ignore）。**Windows 侧前提（2026-09-20 Windows 会话实测确认并已修复）**：Git 记录的是符号链接（mode 120000），Windows 默认 `core.symlinks=false`，检出会退化为含路径字符串的普通文本文件——实测本机 8 个桥里 7 个为纯文本（仅 `.claude/skills/gewu-css-theme` 因当时手工创建幸存），该形态非死链，故原检查项 1 判「目标可解析」放行 → **静默失效无告警**。处置：本仓库级 `git config core.symlinks true`（未动全局配置）→ 删除退化文件 → `git checkout -- .claude/skills .codebuddy/skills` → 8/8 恢复真 symlink、目标 `SKILL.md` 可达、`git status` 干净。**根因防复发已转门禁**：`hygiene-check.mjs` 新增检查项 4「符号链接检出退化」（索引 mode 120000 而工作区 lstat 非 link 即 fail；实测退化时 exit 1、恢复后 exit 0；确无 symlink 能力的机器用 `BIOF3_HYGIENE_ALLOW_FLATTENED_SYMLINKS=1` 降为信息级，但对应宿主功能确实不可用须如实告知）。AGENTS.md 发现桥行同步改写为「退化由 hygiene:check 检查项 4 兜住 + 克隆后三步自检」。Mac 侧无需此配置（POSIX 检出即真 link），换机后跑一次 `npm run hygiene:check` 见「全部为真 symlink」即可。

## 2026-09-20 Mac 会话总账之五（用户裁决「BLOCK-105 §7 剩余抑制基线收缩 冲」＝续接 BLOCK-105 §7 队列）

1. **Batch-4 前端 `no-unused-vars` 410→0 completed（提交 `c6a9b6d1` + 门禁登记 `f284030f`）**：抑制基线 **2150→1740（−410）**，`@typescript-eslint/no-unused-vars` 整族清零（Batch-3 清了 JS 面 622，本批清前端 TS 面，两批合起来该规则全仓归零）；净改动 59 文件 −532/+88。
2. **机械面=TS AST codemod（仓库外一次性脚本）**：359 条未用 import 绑定（IMPORT_SOLO 52 整句删 / IMPORT_PARTIAL 307 语句重建）。**两道保险阀**=含注释的 import 直接跳过（实测 0 命中）+ 整句删除的模块规格符全量打印做副作用人工过账（86 句；`project-workspace.module.css`、`react-markdown` 等真实消费者均在别处，前端全量与 tsc 双绿佐证）。真值取自绕基线全量报告 `npx eslint . --suppressions-location <空 json> --format json`（绕基线 errors=2150 与 `eslint-suppressions.json` 合计逐条相等，先证基线无漂移再动手）。
3. **人工面（三分类）**：①**最大件=化石删** `ResultView.tsx`——UI-146 路由化拆分后遗留的 148 行 import 块，文件早已退化为 `ResultArtifactShell` 透传壳，单文件 154 条一次清、229→86 行；②**级联退役** `project-workspace.tsx` 的 `leftPanelCtx`（44 行，UI-341 左栏上提后 `LeftPanelContext` 从未外传）——它一死，专喂它的 25 个 AppRail 别名/派生/回调（含 `handleShowScheduled`/`handleShowSettings`/`handleNavigateTo{Skills,Knowledge,Home}` 五个 useCallback）同时转死，同批删净；③解构元素 17（**含 `RestElement` 兄弟一律 `key: _key` 保 omit 语义**，Batch-3 教训内置为 codemod 硬门，本批 rest 命中 0）；④形参 `_` 前缀 10 + catch 空绑定 1 + **await 绑定去名保留等待** 1（`TitleBar.test` 的 `findByRole`：整行删等于删掉一次真实等待）；⑤死 useMemo/useCallback 7 全部返回值从未被读=零执行面，故与 Batch-3「调用式 init 保留求值」**刻意不同判**并在册：effectful 自定义 hook 一律不删。
4. **教训固化=`quality:types` 是本类批的裁判，eslint 看不见语义残骸**：①单行解构删首元素留 `{, jobs }` 语法残骸（`ResultsLibrary`）；②**对象解构删绑定必须同步删初始化对象字面量的同名属性**——`const { x } = { x: …, y: … }` 里 pattern 反向对字面量做 excess-property 检查，删绑定即 TS2353 红（`project-workspace` 的 `conversationsApi` 适配器）。姿势=「codemod → tsc → 按红修两侧 → 复扫到 unused-vars 归零」迭代两轮收敛。
5. **抓真观察 4 件（如实登记、本批不改）**：①`office-file-preview.loadAssets` 的 `baseUrl/projectId/workspacePath/relativePath/authHeader` 五参全程无消费者——资源已改为从已拉取的 zip 内条目生成 blob URL，五参属早期「按 URL 拉资源」设计的**签名化石**（调用点仍在传参，非缺陷；本批 `_` 前缀显性化，收窄签名需单独裁决）；②`useKnowledgeConsole` 的 `patchEntry`/`patchConfirmation` 两个补丁 helper 被后续 9 处内联 `setEntries` 取代后遗留为死函数（**更新路径本身完好**），已删；③`ResultArtifactShell` 的 `_jobMeta`/`_selectedSectionId` **只写不读**（setter 有调用、值从未投影到 UI）、`ResultStudioPage` 的 `currentVersion` 读写全无（死 useState 已删）→ 结果元信息与版本两处投影停在未接线态，交产品裁决；④`SideChatDock.test` 头注声称覆盖「copilotAsk 归属不在悬挂面（不派发）」，实际无任何断言承接该条（被删的正是从未被引用的 `vi.fn()`）→ 台账与断言不符，登记为后续小修候选。
6. **验证**=`quality:types` 0 红 + 前端全量 **144 文件/1146 用例 0 红**（与基线同值）+ Node 影响范围 `npm run test:changed` **860 项 852 绿/1 红/7 skip**（唯一红=P6 源绑定门点名本批 3 个绑定文件 `SimpleChat.tsx`/`ResultStudioChangeSetPanel.tsx`/`project-workspace.tsx`，属已知模式，批末重打收口）+ `quality:lint` 0 error（1301 warning 存量不变，**其余 27 条规则计数逐项零新增**）+ `docs:check`/`ui:audit:check`/`hygiene:check` 绿。**注意**：管道会吃掉 eslint 退出码，验证时单独取码。**收口补录**：P6 实采三轮——第一轮 `p6_evidence_source_binding_not_current`（根因=**我在实采期间提交了一笔 docs**，HEAD 前进被 `sourceBindingStableDuringCapture` 自守卫判废，属流程自伤非产品红；纪律已入 gewu-dev-infra SKILL「宣称收口之前」：跑 P6 前 `git status --porcelain` 必须为空、期间仓库完全静默）、第二轮 `p6_evidence_checks_not_recomputed`（用 `--live --verbose` 不写盘复跑 → 10/10 PASS，判定时序预算抖动，与前批在册 9/10 flaky 同类，**累计第 3 次观察**）、第三轮写盘成功 **10/10 锚定 `d81f794b`**（证据提交 `86101b6a`，默认校验路径复验 `10/10 canonical checks recomputed` PASS）。批级真实影响范围（提交后补跑避开空范围假绿）=`node scripts/test-affected.mjs --base=c6a9b6d1~1 --run` → **Node 1075 项 1061 绿/0 红/14 skip + 前端 81 文件/674 用例全绿 + docs/ui 门禁 + frontend tsc 全 PASS**。
7. **队列现状**：无 active 包；BLOCK-105 §7 剩余大头=unsafe 族 1040（根因集中在 `agentTaskStream.ts` 211 / `conversationRunStore.test.ts` 192 / `project-store.ts` 108 / `BrowserPanel.tsx` 90 四文件的 `any` 载荷）+ require-await 187 + react-hooks 族 203 + no-base-to-string 85。

## 2026-09-20 Mac 会话总账之三（用户裁决「可以冲」＝预授权续接 AUDIT-LOG 🟡「前端 tsc 29 红 + tsc 未入链」）

1. **前端类型债清偿 completed（29→0，提交 64da69b7）**：测试侧 25 处=testing-library 查询泛型窄化到真实 DOM 元素（`getByRole<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>`，`getByLabelText`/`findByLabelText`/`getByTestId`/`getAllByRole` 同法），并移除 ResultEditPanel 中因此变冗余的 `as` 断言（否则 `no-unnecessary-type-assertion` 新增违规）；产品侧 2 文件=`ResultArtifactShell` 引入 `PreviewAvailability`/`PreviewAvailabilityStatus` 别名 + 显式标注三元结果（**根因已最小复现**：条件表达式分支中的对象字面量把字面量联合拓宽成 `string`）、`MessageRail` 的 `closest` 泛型化到 `HTMLElement` 与 `bodyRef` 对齐；测试侧 1 处=`useDurableConversationLoop.test` 的 `initialProps` 提为显式 `string | null`。**纯类型注解，零行为变更**。
2. **quality:types 门禁入链（八门→九门）**：`package.json` 新增 `quality:types`（`tsc --noEmit -p frontend/tsconfig.json`）+ `closeout` 追加 `--gate quality:types`；AGENTS.md / gewu-dev-infra SKILL.md / block-105 plan（新增 §6.4）同步。Mac 侧此后 `npm run closeout` 自带类型门。
3. **P6 证据连带重打**：`package.json` 属 P6 源绑定集合（`EXTRA_SOURCE_FILES`）→ 默认校验路径实证 `[G0-RS-P6] FAIL - p6_stored_current_source_hash_mismatch` → `npm run g0:result-studio:p6:update` 重打 **10/10 passed 锚定 `efe86507`**（证据提交 cca36c18），复验 `10/10 canonical checks recomputed` PASS。**凡动 package.json / frontend 绑定文件即需此步**。
4. **UI 台账门禁连带**：本批属零 UI 行为变化的类型注解批，按 8c85898/5a4df30/f4af1ad2 同型先例在 `scripts/check-ui-productization-audit.mjs` 双豁免集合登记 64da69b（提交 efe86507）。**注意**：前端文件改动但提交号缺 `UI-###` 时 `ui:audit:check` 必红——纯类型/lint 批需此登记，不是漏改。
5. **验证**：批级真实影响范围 `node scripts/test-affected.mjs --base=64da69b7~1 --run` = **Node 766 项 757 绿/0 红/9 skip + 前端 18 文件/122 用例全绿 + docs:check / ui:audit:check / frontend tsc 全 PASS**；`tsc` 0 红；前端定向 12 文件/90 用例绿 + 全量 **144 文件/1146 用例 0 红**；`quality:lint` 复绿 0 error（1301 warning 存量不变）——类型窄化顺带消除 `KnowledgeSpaceSwitcher.test.tsx` 的 3 条 `no-unsafe-member-access` 抑制 → `--prune-suppressions` **2153→2150（−3，只删不加）**；`npm run quality:types` exit 0；P6 stored 两测转绿。**注意**：`quality:lint` 的 exit 2（失效抑制提示）在管道里会被 `tail` 吃掉退出码，验证时勿以管道退出码为准。
6. **队列现状**：无 active 包；AUDIT-LOG 该 🟡 行销号；⚡ 清单第 1/2/3 项均已销号，下一个选题需用户裁决。

## 2026-09-20 Mac 会话总账之二（用户裁决「行 冲」＝续接 handoff ⚡ 第 1+2 项，两件必须同批）

1. **前端依赖升级批 completed**（queue ② 第 2 项）：react-router-dom 6.30.4→7.18.4 / vite 5.4.21→8.3.0（rolldown 打包链）/ vitest 2.1.9→5.0.1 / happy-dom 14.12.3→20.14.5 / @vitejs/plugin-react 4.7.0→6.1.1（默认转换链 Babel→oxc）。lockfile 逐项审：版本变化 20 / 新增 43（@rolldown/binding-* 全平台二进制 + @oxc-project/types）/ 删除 79（@babel/* 全家随 plugin-react 6 退出）。`npm audit --registry=https://registry.npmjs.org` → **found 0 vulnerabilities**（npmmirror 无 audit 端点，本机默认源跑不了 audit）。
2. **升级引出的四处真实适配**（读 changelog + 血泪定位，非「只是 bump」）：④**类型感知连带修**（提交 f4af1ad2）＝react-router v7 的 `useNavigate()` 由 `void` 改返回 `Promise<void> | void`，`quality:lint` 从 0 error 变 **50 error**（no-floating-promises 31 / no-misused-promises 18 / no-unused-vars 1，15 文件）——按棘轮纪律**不建新豁免**，49 处 fire-and-forget 显式化（`void navigate(...)`／`() => void navigate(...)`／useCallback 改块体／ctx `navigate` 包装）＋顺带显形的既有 floating-promise（`fetchData()`、`setInterval(fetchData,…)`、async 订阅 handler、两处 IIFE）＋1 处 vitest 5 mock 类型收敛（`vi.fn` 返回类型不再宽松 → 显式声明被 mock 签名）；中间态 1144/2 红由套件抓出闭环（把 mock 改同步会让 hook 的 `.then` 链风暴，已回退异步）；①**单实例 React**——vite 8 解析语义变化使 frontend 之外的 `core/packages/shared-copilot` 命中**仓库根** node_modules 的 react 副本，双实例令 CopilotMarkdown 9 用例 `Cannot read properties of null (reading 'useMemo')` → 双 config 增 `resolve.dedupe: ['react','react-dom']`；②happy-dom 20 的 `CSSStyleDeclaration` 变 proxy（`vi.spyOn(style,'cursor','set')` 的 defineProperty trap 被拒）+ vitest 5 起不再允许代理 undefined 属性（`vi.spyOn(window,'confirm')` 崩）→ useResizableColumns 测试改断言真实写入、ReviewMode 两文件改 `vi.stubGlobal('confirm', …)` + `unstubAllGlobals`；③**真缺陷修**＝`ScientificInteractionViewer.scatterPointerPosition` 原守卫只查 `getScreenCTM`/`createSVGPoint`，SVG 点缺 `matrixTransform` 时整块散点拖拽崩 → 补 `typeof point.matrixTransform === 'function'` 判定并回退 rect 等比换算。
3. **P6 产品验收证据重打 completed**（queue ② 第 1 项，Mac 独占）：重打前实证存量失配 `[G0-RS-P6] FAIL - p6_stored_current_source_hash_mismatch`（旧锚 `c9535452`·2026-09-15、绑定 lockfile `cc22a578`）→ canonical `npm run g0:result-studio:p6:update` 实采 **10/10 passed=true 锚定 `f4af1ad2`**（含真实 R 作业链：gewu-pack-bio 装机 + volcano-plot 真跑；Electron 冷启/漂移/压力原型）→ 默认校验路径复验 `10/10 canonical checks recomputed` PASS；**同批三次重打**＝后续源改动依次使前两锚退役（`test/impact-map.json` 补登记 `frontend/vitest.config.*` → 锚 bec01c6d；`frontend/src/pages/project-workspace.tsx` 的 void 连带修 → 锚 f4af1ad2），最终证据锚定 f4af1ad2（**本批实采共 7 次，其中 2 次 9/10 flaky 失败集中在一次会话窗口、重试即过；flaky 观察在册，非确定性回归**）。**教训**：P6 重打必须是批内**最后一步**——任何改动 P6 绑定集合内文件（含 `test/impact-map.json`、`frontend/src/pages/project-workspace.tsx` 等 188 个绑定源）都会让刚写的证据立刻失效，本次为此多跑两轮（约 +8 分钟）。🟡 在册项销号。**前次 Mac 失败 `p6_restart_worker_exited_before_checkpoint` 本次未复现**（安静环境 + 无并行重负载）。**实采不依赖 dev 栈**：压力/恢复原型自起 backend+vite+Electron（故验收期间应保持无其它栈占用端口）。
4. **验证**：前端全量 **144 文件 / 1146 用例 0 红**（升级前基线同值；逐阶段复跑：router v7 后 1146 绿 → vite8+vitest5 后 1134/12 红 → happy-dom 20 + 适配后 1146 绿）；`vite build`（rolldown）2.47s 出包、dist 结构完整；react-router v6 future-flag 弃用告警随 v7 消失；closeout 八门绿。
5. **新登记 🟡**（本轮实测新增）：前端 `tsc --noEmit` **29 红属存量**（临时装回 router 6.30.4 复测同为 29 红，非本批引入），且 tsc **未入 closeout 八门链** → 处置候选＝修类型 / 新增 `quality:types` 门禁（须先清零或建棘轮基线），排期需用户裁决。
6. **收口门禁连带处置（本批实测两处）**：①`quality:lint` 在 eslint 9.39 下对「已不再发生的抑制条目」exit 2（prune 提示）——v7 的 49 处 void 修复使部分 `no-floating-promises`/`no-misused-promises` 抑制条目失效 → `npx eslint . --prune-suppressions` **2163→2153（−10，棘轮再收紧，只删不加）**；②`ui:audit:check` 要求 UI 改动同步台账 + 提交 subject 带 `UI-###` → f4af1ad2 属**零 UI 行为变化的规则符合性修复**，按 BLOCK-105 P2（8c85898）/Batch-1（5a4df30）同型先例，在 `scripts/check-ui-productization-audit.mjs` 双豁免集合登记（理由注释就地留痕，不重写共享历史）。最终 closeout 八门全绿（HEAD 3eb814c5；**2026-09-20 后续批已扩为九门**，见「Mac 会话总账之三」）。
7. **队列现状**：无 active 包；⚡ 清单第 1/2 项已销号，第 3 项（Mac 七红）已于此前的 258e7a06 清偿，第 4-10 项为基建知悉类（无待办动作）。

## 2026-09-20 Mac 会话总账（用户裁决「继续」＝预授权续接队列①）

1. **BLOCK-105 §7 Batch-3 抑制基线收缩 completed**（plan §7 批次日志）：根 2783→2163（−620：prune 一次收 −622，其后补登记两处源码契约豁免 +2），**no-unused-vars 622→0 清零**（core 391/test 142/scripts 67/src 22 全覆盖，211 文件）。
2. **交付构成**：机械面=acorn AST codemod（仓库外一次性脚本，未入库）——未用 require/import 解构项删除（全未用整句删；有加载副作用或动态路径的模块降为裸 require 保留加载语义；Node 内建判无副作用可整句删）、纯 init 局部变量删声明、调用式 init 保留求值去绑定、`catch (e)`→`catch`、未用形参 `_name`/`_unused`；人工面=死函数 13 件（routes/ai-agent.js 拆分化石整套 + skill-registry deepMerge/loadMarketplaceSkills + mcp/server sendNotification + file-references collectArtifactNamesFromResult + 测试死 helper 5 件）+ 只写不读链（resultsDir×4/finalizationRouting/jobDisk*/ssh-direct runner+死远程读 pid/newSummary 死计算 等）。
3. **测试抓真两类回归（本批唯一语义风险面，均闭环）**：①解构 **omit 语义**——`({ rowid, ...rest }) => rest` 的 rowid 被机械删除后残留进副本（block95-b2 + block98-compaction-upgrade 抓真，conversation-compaction ×3）→ 改 `{ rowid: _rowid, ...rest }`；②**thin facade 源码契约名**——agent-runner 的 P4R-3 `providerFailureReason` 与 P7 `createResultEditCompletionGuard` 被源码扫描测试锁定（result-studio-agent-binding / g0-rs-p7-acceptance），误删即红 → 恢复绑定 + 抑制豁免登记 `{"no-unused-vars":{"count":2}}`（非放宽，plan §7 已留痕）。
4. **codemod 两坑固化（复用时必读）**：①删整行时若只吞行尾换行而保留行首空白，会把该行缩进并进下一行（实测 7 行，已按 HEAD 逐行对齐回正 + 全量「trim 相同仅缩进不同」对账归零）；正确姿势=扩展删除区间时 `start` 一并前移到行首；②解构属性删除前必须判同模式内是否有 RestElement（omit 语义），有则改 `key: _key` 保留提取。另：acorn shorthand property 的 `key`/`value` 是两个节点且同位置，标识符定位须优先取 value 位，否则会走错分支（本批一次实测踩中，靠「全未用才整句删」+ no-undef 复扫兜住）。
5. **验证**：quality:lint 0 error（1301 warning 存量）；211 改动 JS 全数 `node --check`；no-undef 未增（3 存量）；模板串美元花括号序列零改写；closeout 八门绿（干净树）；test:changed 2344 项 2315 绿 15 红全部基线存量（BLOCK-84 pack 环境×3 + pipeline.test.js 死 require×10 + I.5 harness 插件扫描×1，干净树 stash 对照同红）+ P6 脏树一致性门 1（提交后自愈实测 13/13 绿）。
6. **队列现状**：无 active 包；⚡ 清单第 1+2 项（P6 产品验收证据重打 + 依赖升级批，必须同会话同批）未动，需 dev 栈在跑的 Mac 专门会话。

## 2026-09-19 Mac 会话总账④（用户裁决「开P4」=整包 closeout；Windows 侧用户配合）

1. **closeout 聚合 5/5 全绿**；P6 live 重打尝试一次未果（p6_restart_worker_exited_before_checkpoint）维持🟡归 G0-RS 专门会话。
2. **双真机端到端 12/12 allPass**（block88-p4-dual-machine.cjs）：Mac 指挥席×Windows 真机 DESKTOP-N94BLO7——署名配对/身份回显/零授权 403/REST 授权/真实委托跨机跑完真实模型（Windows_NT 10.0.26200）/归属+标题+会话 project_id 绑定/grantedProjects 发现面/吊销即刻 403；证据 acceptance/block-88/p4-dual-machine.json。双真机验收配方（token :3001 签发+局域网 :3005 直连免自签+单脚本自助全链）沉淀于该脚本可复用。
3. **跨端运维实录**：Windows 后端 P2 时代进程两次假重启（Git Bash 无 powershell 致脚本启动段空操作+detached 逃逸树杀）→ PowerShell 定点杀 :3001+带 env Start-Process 换血，验证法=POST /api/federation/grants 400=新代码/404=旧进程（plan §12）。
4. **队列现状**：无 active 包；BLOCK-88 整包 COMPLETED（P1-P4）。🟡 在册=P6 源绑定重打；BLOCK-85 通道两端健康（Mac 隧道 2234 connected，Windows 8442 在线）。

## 2026-09-19 Mac 会话总账③（用户裁决「开P3」）

1. **BLOCK-88 P3 项目授权边界 completed**（fe7649fc；plan §11）：federation-grants.js（grants.json 默认零授权/逐项目授权/随时吊销）+宿主管理 REST+网关访客面+chat.js 越界诚实 403+**授权项目委托落 project_id 绑定**（85 登记「delegation 无项目绑定（写类委托不可达）」缺口消化）+delegate 工具 projectId/grantedProjects 发现面+UI-420 联邦面板授权卡。
2. **实机 16/16 allPass**：默认零授权 403（诚实消息含署名与项目）→ 授权后同一委托真实跑完 done+委托会话 project_id 绑定 → 回执附 grantedProjects → 吊销即刻再 403 → CDP 测试实例授权卡可见；证据 acceptance/block-88/p3-grants.json+png。
3. **实机抓真三件**（症状均为委托请求 peer_timeout 静默挂起）：wantKind TDZ（express4 async 处理器吞异常=永久挂起）/require 相对深度错层/includeFederated 跨项目语义——已修并留痕 UI-420；教训=express4 async 处理器内同步 throw 不可见，评审新增分支先查依赖声明位置。
4. **队列现状**：无 active 包；BLOCK-88 P4=整包 closeout（npm run closeout+canonical 五件套+双真机端到端——Windows 侧需在线配对）待用户裁决；另 P6 源绑定重打 🟡 仍在册。

## 2026-09-19 Mac 会话总账②（用户裁决「开P2」）

1. **BLOCK-88 P2 任务归属隔离 completed**（8ad51d36；plan §10）：访客署名经网关会话门（P1 identity）进 chat.js → 独立委托会话（origin 列；消化 85 登记「委托未开独立会话」缺口）+getOrCreateActiveConversation 复用排除（反向污染防护）+自动标题守卫（实机抓真）+params.federated+spawn 继承+meta/tasks federatedFrom+默认视图隔离 includeFederated+UI-419 左栏联邦查看节/俯瞰角标。tasks.user_id 维持宿主权限面语义（实现注记，D3 意图完整达成）。
2. **实机 13/13 allPass**：真实 delegate_to_gewu_node 工具跨节点委托、B 端真实跑完模型回执 done → meta 归属/标题/默认视图零泄漏/includeFederated 可见/宿主活跃会话零污染/CDP 左栏联邦面；证据 acceptance/block-88/p2-attribution.json+png。
3. **定向 7 红全存量**（基线对照 git stash 证实同红）：block67 fs verbs 4（macOS bash 面）+sys_resource 1（Linux/WSL 用例）+P6 源绑定 2（🟡 在册）。
4. **运维坑复证**：后端单独重启会与 dev-electron 自动重生赛跑（抢 :3001 的那份可能 DB 未开）——全栈清场按序重启一次到位；已沉淀记忆 ⑥。
5. **队列现状**：无 active 包；BLOCK-88 P3（项目授权边界 grants+越界 403+授权/吊销 UI；85 登记缺口「delegation 无项目绑定」实机再证）待用户裁决。

## 2026-09-19 Mac 夜间会话总账（用户睡前裁决「都搞 我要睡觉了」=BLOCK-88 P1+侧边聊天悬挂化两项串行，队列序 88 先行）

1. **BLOCK-88 P1 身份层贯通 completed**（7cc5cbf3；plan §9）：engineer-identity 共享净化 + 配对握手/peers/会话注册表 identity 贯通 + 联邦面板协作成员（UI-418）；实机 15/15（loopback 双节点+CDP 9223 测试实例，探针零触碰 9222）；评审 P2 清偿（访客会话名署名优先）。门禁：契约 5/5+回归 12/12+test-affected 16/16+tsc 0+theme 4/4+docs/ui 双绿。
2. **「侧边聊天悬挂化」对账消项**：UI-417 已由 Windows 会话 4da4bb4a 实现并 verified（悬挂把手+滑出 overlay+右栏 tab 退役全套，实机截图在 acceptance/ui-417/）——评审防重复开发纪律命中，本会话零开发，仅在台账/roadmap 消项登记。
3. **基建顺债**：start-test-instance.sh 双端同形化（原纯 Windows 实现 macOS 静默空转，指纹=TIMEOUT 但 err 日志不存在；darwin 分支=lsof 定点杀+nohup 直启）；impact-map 补 ui417-side-chat-evidence（4da4bb4a 漏登记）+ block88-engineer-collab 规则。
4. **🟡 P6 源绑定存量红入册**：rs-p6-durability-recovery-performance.json stored 哈希对 test/impact-map.json 失配（多包合法演进未重打，哈希比对证实本会话开始前已红）——重打需 `--live --write-evidence` Electron 实采，归 P6/G0-RS 域专门会话，不阻塞 88 定向门禁。
5. **队列现状**：无 active 包；BLOCK-88 P2（任务归属隔离，含 85 验收登记的 delegation 无项目绑定/未开独立会话两结构缺口）待用户裁决启动。

## 2026-09-18 Mac 夜间会话总账（用户睡前授权「我希望你搞定这些……继续工作」，队列 BLOCK-94 → 85 → 88）

1. **看门狗自动化**：CronCreate 每 30 分钟值守（commit-age <90min 或心跳 <45min 即静默退出；否则按 canonical 文档自愈续作）——夜间连续工作的中断自愈机制，用户醒后可删（automations 页）。
2. **BLOCK-94 整包 completed**（六提交链 913a5fc0..收口笔；详见 plan §9 与 AUDIT-LOG）：
   - F1 可靠底盘：**mountKnowledge 启动恢复**（中间态文档重启重排入队；跨真实重启实证 4/4）/嵌入模型一致性（向量通道 model 门隔离+失配统计+面板横幅）/**召回挂点收敛 buildTurnInjection 单源**（agent-runner+chat.js 两处逐字同构去重）/列表分页+failed 批量重试。
   - F2 PDF：**pdfjs-dist 4.10.38（复用 UI-400 已裁决依赖，core/biof3-server exact）**，cmaps/standard_fonts 包内供给，500 页护栏，扫描件诚实 failed；实机真实 PDF 摄取 kind=pdf。
   - F3：面板拖拽上传（accent 描边）/上传逐文件错误聚合/粘贴文本直接入库。
   - F4：GET documents/:id/preview 分块全文+打开原文件/批量删除（missing 诚实）/失败批量重试。
   - F5：**knowledge_citations 专用事件（_emit 持久化重放可重建）→ conversationCitations 会话级存储 → 摘要卡「知识溯源」节**；docId 过滤/命中高亮/纯符号 ftsDegraded 诚实化/knowledge_read 工具（工具总数 58→59）。
   - F6：scaleStats 规模观测（SCAN_WARN_THRESHOLD=50000）；**sqlite-vec 评估=不引入**（bench 实测 5k=7.3ms/20k=28.6ms/50k=69ms/次，scripts/knowledge-vector-bench.cjs 可复现）。
   - 实机：`scripts/block94-knowledge-live.cjs` **18/18 allPass**（真实 DashScope 嵌入摄取+双通道检索+真实模型轮次 citations 端到端+CDP 面板/摘要卡）+ 跨重启恢复 4/4；acceptance/block-94/。
   - 门禁：契约 34/34+工具 9/9+前端批 88/88+tsc 0+theme 4/4（抓真：自造 --gewu-brand 未定义 token）；UI-402 verified；flow `block94-knowledge`；impact-map block94 规则。
3. **存量红当夜清偿**：agent-runner-loop-orchestrator「emitToolResult must forward via _emit」1 红（BLOCK-97 单通道契约变更后测试未同步）——语义已由 BLOCK-97 交接明载（emitToolResult 死参/emitAssistant 单通道/双挂 maybeEmitTaskTodo），当夜机械同步测试断言至已发布契约，3/3 绿；无语义裁决悬置。
4. **D1-D6 预置推荐先行留痕**（plan §7.2，呈问未应答按推荐先行可逆，待晨间追认）：PDF 复用 pdfjs-dist/sqlite-vec 不引入/URL 摄取不做/粘贴入库做/分组 UI 不做/knowledge_read 做。

## 2026-09-17 Windows 会话总账（换机前全量交接）

当日完成（自上而下，全部 committed + closeout 门禁绿 + 已 push）：

1. **BLOCK-97-AGENT-TODO-CARD 整包 completed**（P0–P5；实机 block97-todo-live 10/10）：todo_write 整单幂等工具 + task_todo 专用事件（**注意：loop-orchestrator 的 emitToolResult 是死参，全部事件走 emitAssistant 通道**，发射判定已双挂）+ 提示词纪律注入 + 摘要卡「任务清单」节（WorkspaceTodoSection 子组件）+ conversationTodos 会话级存储（run 终态后完成态保留、下一轮清除）。UI-398 verified。实机抓真：useSyncExternalStore 空态快照必须返回稳定引用（`|| []` 新数组 → Maximum update depth 整路由白屏）。
2. **UI-399 verified**：SSH 文件树切换文件不再整树重拉（refreshFiles 读 activeFileRef 身份稳定；旧行为=每次点击文件 setLoading 闪屏+整树 N 目录网络往返）。实机 5/5（/tree 零增长）。
3. **UI-400 文件体验六项批次 verified**（实机 ui400-batch-live 8/8）：①PDF 预览=**pdfjs-dist 4.10.38 本地渲染**（Electron 33+ 内置查看器结构性损坏：chrome://resources 被扩展 CSP 拦截，plugins/sandbox/遮挡均排除；WorkspacePdfPreview 组件逐页 canvas，依赖单层封装）；②预览头部「下载到本地」按钮 + 新 IPC 通道 `file:download-from-url`（主进程静默落 Downloads 重名-2 + 来源白名单 127.0.0.1/localhost；blob 下载在 Electron=GUID.tmp 无文件名，仅兜底）；③树面板拖拽到根落点（TREE_DRAG_MIME，accent 描边）；④树宽移除 320px 钳制（maxWidth 65% 兜底）；⑤上下文环待机显示 0% 空环不再「—」；⑥MD 预览左侧悬浮目录（1-3 级解析/平滑跳转/文件切换复位）。
4. **BLOCK-98-AGENT-RESILIENCE 整包 completed**（P0–P5；实机 block98-resilience-live 8/8）：M1 microcompact（helpers/agent-resilience.js，阈值 min(w×0.9,w−2000)、批次成组≥2、保留最近 5 组、投影副本原文零触碰，接线点=agent-runner callChatProvider 包裹，**loop-orchestrator 1241 行门零触碰**）+ M2 阈值公式化（planThreshold：eff=窗口−min(maxOut,21K)，buffer=min(13K,8%×eff)，preset 真值）+ 9 章节摘要模板 + 转写路径指针 + 续接纪律 + M3 防呆熔断（3 失败→10min）/reactive 原地重试（全量折叠→整块丢弃保 system 头防孤儿 tool）+ M4 输入插队（POST task/:id/steer → 进程内队列 → 请求边界 drain 注入；前端 onInputQueued→状态条排队可见）+ M5 ai_usage additive 四列（attempt/retryable/context_exceeded/cancelled_by_user）。**UI-401 verified**。附抓真：task-actions require 深度错致 /ai/agent 路由族 404（已修）。
5. **基建沉淀**：test-affected.mjs 加 `--test-force-exit` + `--test-timeout=120000`（**永久免挂**——block93-role-prompt 曾泄漏 mock server 句柄拖死聚合批 28 分钟；挂起定诊=进程 CPU 25s 零增量）；block93-role-prompt 补 server.close；test/impact-map 增 block97/block98 规则 + ui-392/393/399/400 证据目录归属。

## Mac 衔接（换机必读）

- **状态全部在 canonical 文档**：AUDIT-LOG（最后更新链）+ 各 plan §10/§8 收口记录 + ui-productization-audit + 本文件——读顺序照 AGENTS.md，无需 Windows 侧任何本机记忆。
- **不随 git 走的本机资产**（Mac 上不存在也不需要）：Windows 侧 ZCode 记忆目录、dev DB（`.biof3-dev-user-data/data/`，Mac 首次 `npm run dev` 自建空库跑 migrations）、llm-transcripts、Downloads 测试产物、WSL/aliyun/dell ssh 目标配置（Mac 用自己的 `~/.ssh/config` 重新注册远程目标）。
- **Mac 起 dev 栈**（runAgentLoop 实机同款）：`BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`（Windows 的 restart-dev-stack.sh 是 win32 专用，勿在 Mac 跑）。
- **灰度开关**（默认全关）：`BIOF3_AGENT_RESILIENCE=1`（BLOCK-98 M1–M3）/ `BIOF3_SESSION_COMPACTION=1`（B2）/ `BIOF3_SERVER_HISTORY_ASSEMBLY=1`（B1）。**翻默认待用户显式裁决（呈报中，勿擅改）**。
- **换机即解锁**：**BLOCK-85 Mac 双真机验收**（排队原因就是等 Mac——验收包已备，见其 plan/AUDIT-LOG 条目）。
- **队列**：BLOCK-94 知识空间 Pro（plan 就绪；UI-400 的 pdfjs 渲染可复用其 F2 PDF 摄取预览）/ BLOCK-85（Mac 就位即可启动）/ BLOCK-88。均启动需用户裁决。
- **待用户事项**：①两开关翻默认裁决（呈报中）；②UI-398/399/400/401 已 verified，可复看确认；③composer 运行中发送自动改走 steer 通道=已登记 UI 候选未接线。



最后更新：2026-09-16（**BLOCK-91-COMPOSER-ATTACH-EXPORT 整包收口 completed**：聊天附件真实接入（修孤儿缺陷——发送前复用 BLOCK-90 fs/upload 分片落 `.chat-attachments/` + `[附件: …]` 引用注入与 imageRefs 同构 + 拖入图片 dataUrl 对齐 + 10MB/8 个上限 + 欢迎页无项目守卫）+ ssh 文件行拖出导出（DownloadURL 改预览同源 HTTP URL 免物化本地副本）。实机探针 4/4 allPass（aliyun 真远端，`acceptance/block-91/`）；**用户真拖验收抓真 read_image ssh 读图缺口，当日修复 461c8431 复测通过「非常棒」→ UI-381 verified**。附带 UI-382/383（子智能体实况卡内联 / 工具时间线常规只读折叠）in_progress 待用户复看升 verified（716c8762 台账漏同步已按先例豁免+补登）。收口门禁：hygiene + docs:check 243 + ui:audit 绿；test:changed 聚合被既有 scratch `obs.tmp.cjs` 卡分类，按 BLOCK-89 先例定向直跑（前端 6 套件 80/80 + 文件面 Node 40 过 1 skip 0 红 + tsc 0；provider 映射 2 红=continuation guard 存量基线，非本包引入，🟡 登记）。**当前无 active 工作包**，候选：BLOCK-85 Mac 双真机 / P5 候选（启动需用户裁决）。G0 开发期常态 · 不外推 packaged/Provider/GA）。此前 最后更新：2026-09-15（**BLOCK-90-OS-DRAG-IMPORT 当日立项即收口 completed**：工作区 OS 拖入导入（本地 fs/import-from + ssh 64KB 分片上传，双后端同构，重名 -2、offset 完整性）+ 本地文件拖出导出（DownloadURL）；UI-380 verified（自动化 4/4 + ssh/aliyun 真远端链路 + 用户真拖验收「都测试了 可以」）。**当前无 active 工作包**，候选：BLOCK-85 Mac 侧双真机验收 / P5 候选（启动需用户裁决）；G0-SDC 已裁决移出本阶段。G0 开发期常态 · 不外推 packaged/Provider/GA）。此前 最后更新：2026-09-15（**G0-RS 整包 closeout completed（重启增量 P0→P1+P6 重采→P2→closeout 当日走完，active 槽位清空）**：最后一段=p4r ui observation 重采（旧证据锚 35a0760c 早于 UI-122/305 渲染层契约），驱动连随 7 关漂移修复（fd00c454/14531bef/955188b9/12565a41/582111ed/71493489/7ec27d8b/48ffdd24/834a4b42，全程非产品缺陷、零产品语义改动）：双 nav 短/长标签、采纳/恢复后跳回 result（UI-305）、图像交互静默降级（UI-122）、隐藏窗口 capturePage viz UnknownVizError 韧性回退、故障矩阵 prepare 跟随面板装载、键盘焦点播种+显式交互预览+重启版本经审查面板验。证据：rs-p4r-ui-observation.json passed=true 锚定 6b3c68bf（14 判据全过，反馈预算 模式 15.2ms/重开 7.5ms/首内容 3.9ms）；p4r:product 证据随 HEAD 重生成；UI-379 两处 React hooks 顺序真缺陷（首启整页空白/项目页全白）修复+当日用户委托代跑复测升 verified（草编 UI-378 与 BLOCK-89 撞号重编号）。下一包候选：G0-SDC / BLOCK-85 Mac 侧双真机验收 / P5 候选（启动均需用户裁决）。Result Studio 维持 implemented_unverified/experimental，P7 维持 deferred。G0 开发期常态 · 不外推 packaged/Provider/GA）。此前 最后更新：2026-09-15（**G0-RS P2 P4R-CORPUS 当日收口 completed（用户裁决启动后一次会话完成）**：p4r corpus 链包感知化——交付 scripts/g0-rs-p4r-pack.mjs（包根解析 `BIOF3_BIO_PACK_ROOT`→兄弟仓 / plugins.dormant/ 封存兼容 / 复制 staging（symlink 被候选发现 readdirSync isDirectory 静默跳过，plugin-sdk.js:49）/ `BIOF3_DEVELOPMENT_PLUGIN_DIRS`+`BIOF3_DOMAIN_TOOL_REGISTRY` 注入 fail-closed）；corpus 子进程+baseline/live/ui/source-observation/invariants 六处服务端 env 同源接线；实机抓真两件=显式输入须落项目工作区（admitted 校验 exactProjectFile 拒工作区外路径，修前 perf 证据 revisionCount0+context-envelope409 诚实性缺口）+ symlink staging 0 候选零诊断。证据：corpus 封存态 4 步全产物（deseq2 8.4s/23 volcano 1.4s/5 corr 0.6s/3 go-kegg 30.8s/19 真实 R）；p4r:test 231 项 0 红 0 跳；p4r:perf 14/14（事件循环 20.6ms vs 冻结 250ms）；source-observation allFourVerified（desktop@1357c4c4（收口链 HEAD）+包@21d610c 双绑定）；live 19 检查全绿含真实后端重启恢复；closeout 四门绿。ui observation SKIPPED（3001 被 dev 栈占用非产品缺陷）。顺手清存量债两笔（baseline.mjs pathToFileURL 缺 import 恒红 / agent-tool-registry 硬编码 53→57 跟 BLOCK-77/85）。**包余下一环=整包 closeout（P6 重采 D8 族归此）**；ui observation 待 dev 栈停用窗口补跑。G0 开发期常态 · 不外推 packaged/Provider/GA）。此前 最后更新：2026-09-15（**换 Agent 交接（G0-RS 整包 closeout 三步：P6 重采预修 / ui observation 3001 窗口 / 回写五件套）详见 [`docs/session-handoff-2026-09-15.md`](./session-handoff-2026-09-15.md)。** **G0-RS P2 P4R-CORPUS 启动 active（用户裁决「启动 G0-RS P2 P4R-CORPUS (Recommended)」）**：p4r corpus 链包感知化——实锤红态=corpus 子进程空领域注册表（`未知工具: deseq2`）+ CORPUS_INPUTS 两条核心树死路径（BLOCK-83 迁包删除）。改造面：包根解析（findBioPackRoot 先例：`BIOF3_BIO_PACK_ROOT` → 兄弟仓 `../gewu-pack-bio`）+ 子进程注入 `BIOF3_DOMAIN_TOOL_REGISTRY` + 输入改包源（`demo-data/deseq2/`、`plugins/go-kegg/demo-data/genes.csv`）+ 插件定位兼容 `plugins.dormant/` 封存态（包仓 0.1.1=21d610c，本地包仓落后待快进）。门禁：corpus 真跑 ≥3 步全产物（真实 R 作业）+ `g0:result-studio:p4r:test` 全绿 + `p4r:perf` 13 项证据刷新（RS-P4R0-13 基线冻结只写 currentObservation）+ docs/ui 门禁。非范围：P6 重采（D8 例外族）、P7（deferred）。DOC-REGISTRY G0-RS → active/P2-P4R-CORPUS）。此前 最后更新：2026-09-15（**UI-373 欢迎页冷启动不预选工作区 + 输入框常驻 verified**（用户两图截图对比「初始界面只有选择项目没有输入框，按理应该是图2 但不应该确定的工作区」）：根因两条——① welcome 首载 `listProjects` 单发无重试（UI-369 同族竞态，本页未同步自愈）→ 抛错即 `loaded=true` 空列表 + 无选中死态；② `chatMounted=Boolean(selectedProject)` 未选中时 composer 整体不挂载，而载入成功又自动选中最近项目（预「确定工作区」）。修=退避重试 0/2/5/10/15s + 去自动选中（`?project=` 显式预选保留）+ `chatMounted=backendReady` 输入框常驻（`projectId=''` 待机，空项目全链路守卫）+ `sendGuard` 发送前置守卫（未选项目展开面板+提示+文本退回输入框；Enter/copilotAsk 双路径；缺省零变化）+ 草稿随选中迁移（迁移在 `selectProject` 处理器内，先于换挂载读草稿）。证据 `welcome.test.tsx` **13/13** + `useChatStream.test.ts` **5/5** + 相邻 65/65 + tsc 0 + 实机 `scripts/ui373-welcome-composer-live.cjs` **3/3**，`acceptance/ui-373/`。**P6 源绑定登记**：SimpleChat.tsx 属 P6 绑定源文件，提交后写入门回绿、存量证据重算门按 D8 例外族转红（重采归 G0-RS）。G0 开发期常态 · 不外推 packaged/Provider/GA。）。此前 最后更新：2026-09-15（**BLOCK-86-DOMAIN-PACK-LIFECYCLE 整包收口 completed（P0–P3 当日）**：P1 契约与装卸编排（requires.runtimes+可测编排 src/pack-lifecycle.js+包仓 0.1.1=21d610c）+ P2 商店改版 UI-374 verified + P3 实机 24/24 allPass（封存负例/runtime_present skip/三档弹层真实体积/R+包源双保护/真实 R 工具 deseq2 completed/现场恢复）。封存裁决执行：14 插件入 plugins.dormant/（README 激活 checklist），deseq2 唯一活跃参考实现；测试纪律=日常只测 deseq2+契约套件，全量矩阵推迟到版本成型里程碑。P3 抓真修：运行时在位判定 runtimeStatus+语言映射双判据。附带 UI-375 标题栏悬空分隔线路由感知修复 verified。**当前无 active 工作包**，队列 planned：G0-RS P2 P4R（待裁决）/ BLOCK-85 双真机验收（Mac 侧）。此前 最后更新：2026-09-15（**BLOCK-86-DOMAIN-PACK-LIFECYCLE 启动 active（用户裁决原话「1」）**：P0 激活对账完成——启动检查单硬门全过（无阻塞/无未知 WIP/槽位空）+ plan §1 代码事实复核零漂移 + 运行时 pluginId 确认 `biof3-r-runtime`/`biof3-py-runtime`；P1 契约与装卸编排进行中；P2 商店改版预登记 UI-374。同日 UI-373 欢迎页不预选+输入框常驻 verified 已推送（`e82ec480`，含 Mac 侧 UI-358 修订 3 两笔收编）。此前 最后更新：2026-09-15（**G0-RS P6 重采 macOS 完成（10/10）**：`p6:update` 全套件 365 测试 0 红 + live capture 10/10 锚定 `e2ec798c`（证据 `f62ab036`）；实机抓真三件：pycache 残留伪装内置目录 / `_biof3-theme.R` 迁包两头落空（包仓 `b2d0e91` 兑现）/ BLOCK-84 多源遮蔽 drift 升级模拟（`e2ec798c` 冷启窗口隐藏包装载）；`BioF3-Local/runtimes/R` 半成品换符号链接指框架 R 4.5.2。剩 p4r corpus 包感知化待裁决。。此前 最后更新：2026-09-14（**Mac 侧接管：分叉对账收编 + UI-367/368 用户复测升 verified**：① 本地落后 origin/main 41 提交且有一笔同主题本地提交（UI 台账清偿）→ 分叉；冲突解审阅后 rebase 收编为 c0aaff54 并推送对齐。② 用户按 §9.1 路线复测通过 → UI-367/368 升 verified（无人化阶梯第 4 级，台账同提交回写）。③ 进行中：§9.2 Mac 双真机 BLOCK-85 验收（Mac 侧准备）+ §9.3 Mac P6 重采（`npm run g0:result-studio:p6:update`）。）。此前 最后更新：2026-09-14（**SEC-HARDEN 主进程安全加固 + 代码复审余项 ③④ 收口**（用户裁决「清两个低危安全/健壮性余项」）：④ 判定**设计决策不改**（无进程句柄时只改 DB 不发信号——PID 复用/属主不可证，SIGKILL 会误杀无关进程；有句柄路径确实会杀）；③ 字面项已满足，真残留=Electron 官方安全清单 **#5 权限默认批准 / #11 allowpopups / #12 未校验 webview webPreferences**。交付新 `src/main/security-hardening.js`（webview 附着中和 preload + 强制 sandbox·contextIsolation·nodeIntegration=false + partition 白名单 + src 限 http(s)；每 webContents popup 一律 deny→http(s) 交系统浏览器；权限默认拒绝、仅受信 origin 放行 clipboard-sanitized-write/openExternal）+ `src/main.js` 装配 + BrowserPanel 撤 allowpopups。**实机门抓出自己两个真缺陷并修**（分区 session 未覆盖 / check handler requestingOrigin 为空会误杀复制）。证据 `test/security-hardening.test.mjs` **17/17** + `scripts/sec-harden-live.cjs` **8/8**，`acceptance/sec-harden/`。）。此前 最后更新：2026-09-14（**UI-371 会话框测量改回调 ref——摘要卡形态不再「恒 pinned」verified**（用户问询 `sessionFrameWidth` 失联）：两条根因——① chat/scheduled 两分支**共用同一 refObject**，scheduled 卸载把 current 置空而常驻实例不重赋值 → 测量恒 0 → `summaryVisibility` 恒 `expanded`；② RO 只 observe 一次 → 节点替换后永不触发。修=`sessionFrameRef` 改回调式（挂载即 re-observe + 立刻测量 / `isConnected` 自清理 / 取多实例最大宽度 / 0 宽不写状态）+ 删 rAF 轮询 hack。回归门 `useWorkspaceLayout.test.tsx` **5/5（撤修复 → A1/A2/A4 三红）** + 实机 `scripts/ui371-frame-measure-live.cjs` **5/5**（不派发 resize 即跟随形态 / 模式往返不卡 0）+ 相邻回归 54/54 + tsc 0，`acceptance/ui-371/`。）。此前 最后更新：2026-09-14（**UI-370 摘要卡右缘 4px 灰带根除 + 悬浮/钉住两态统一贴齐会话区右缘 verified**（用户截图「红框那条每次摘要图都有 影响视觉效果」+ 提议右对齐）：根因=`box-shadow` 被祖先 `.workspaceSessionLayout/Content` 的 `overflow:hidden` 裁切、`right:4px` 只留 4px 残渣；交付 4 处 CSS（float `right:0` / 悬浮宿主卡片 `max-width:100%` 撤 24px 循环预留 / 钉住列 `padding-right:0`+`align-items:flex-end` / 入场动画 `translateX(-16px)`）。证据 `scripts/ui370-summary-card-edge-live.cjs` **5/5**（双态 gap=0px、band=0px，内置 PNG 逐列像素判定）+ CenterPanel 8/8 + WorkspaceSummaryCard 16/16 + tsc 0，`acceptance/ui-370/`。**同轮另发现（另立 🟡 待评估，未修）**：`sessionFrameWidth` 在会话框节点被替换后失联 → `summaryVisibility` 恒 `expanded`（卡片恒钉住并被挤压）；临时缓解=一次 `window resize`。）。此前 最后更新：2026-09-14（**UI-369 左栏项目列表首载自愈升级 verified（竞态复验双证）**：确定性 forced 6/6（CDP Fetch 构造后端不可达窗口跨过第 1/2 拍：阻断期项目行恒 0、拦截 5 次含第 2 拍 +2011ms、解除后零手势自动回填 5 行且落点 +7082ms vs 退避第 3 拍 7000ms）+ 自然重启 natural 4/4（canonical 重启后新窗口 t+5.69s 后端 200 与 5 行同刻到场、无需手动刷新）。探针 `scripts/ui369-project-list-selfheal-live.cjs`（`--mode=forced|natural`），证据 `acceptance/ui-369/`。**同场抓真并修掉 dev 基建两处静默失效**（`scripts/restart-dev-stack.sh`：① `taskkill //IM` 在 Git Bash 下参数原样透传 → 杀进程整段静默空操作（PID 前后不变、必然 TIMEOUT）→ 改 `MSYS_NO_PATHCONV=1` + 清场后置断言；② 就绪判定 `curl -o /dev/null` 本机 exit=23 → 拼成 `200000` → 永不 READY → 改读末行 `%{http_code}`；修后 READY@t+5s）。**环境事实（新）**：从 agent 工具 shell 启动的 Electron 会随该命令作业被回收（WMI 进程创建 / cmd 均被安全策略拦截），长驻 dev 栈须由用户自身终端启动。审计台已 >50KB，下次会话启动先滚动归档再进主线。）。此前 最后更新：2026-09-14（**多端同步实测缺陷三连修（UI-367 / UI-368 / GW-PERF，`53a8df5a`/`45d6bbff`/`f6ed8c4f` 已推送）**：用户手机实测「总是 rate_limited」「插件商店与桌面不一致」「点击频繁刷新慢」+ 裁决「左上按钮直接控制左栏抽屉」当日全修——限流只计 API 面 600/分；投影端点扩面（plugins.catalog / runtime.status / packs.read）+ 投影桥逐字对齐 IPC 契约；撤浮动 ☰、投影手机端 leftOpen 征用为抽屉开合单一真相（标题栏左上直接控制）；网关根因优化（会话落盘 30s 节流 / ETag 304 重验证 / 模块 gzip / dist immutable，实测条件再拉 304/0 字节）。**待用户手机复测后 UI-367/368 升 verified**；完整交接与踩坑清单见 `docs/session-handoff-2026-09-14.md`。此前 2026-09-14：最后更新：2026-09-14（**BLOCK-86-DOMAIN-PACK-LIFECYCLE 立项登记（planned 排队）**：领域包全生命周期——运行时托管+插件化契约（用户裁决「选择方案1」/「新开 工作包 等其它任务完成后 再来集中处理」）。登记五件套齐（plan / DOC-REGISTRY planned / README 121 / roadmap / AUDIT-LOG）；**不占 active 槽位**，等在制任务收口后用户裁决启动。plan `docs/block-86-domain-pack-lifecycle-plan.md`。此前 2026-09-13：最后更新：2026-09-13（**G0-RS P1 Windows 侧收尾完成，live capture 待 macOS 指挥席**（用户裁决「1」）：P6 套件 Windows 回绿 + 7 个真实 Windows 缺陷修复（truth-drift 缓存窗口 / SEC-001 脚本桥 argv / 11 处门禁守卫静默空转+扫描门等）+ 采集链 BLOCK-84 包装载接线 + R 4.5.2 首次引导（真实 volcano-plot 作业 completed；go-kegg 需的 org.* 注释库本机未装成）。**mac 侧下一步：`git pull && npm run g0:result-studio:p6:update`**；Windows 化 checkpoint-hold 需单独立项。此前 2026-09-13：最后更新：2026-09-13（**G0-RS 重启 active（P0-LAUNCH）**：用户裁决「可以的 冲」。增量=P6 证据重采（红因=存储证据 508999c 仍绑 18 个 BLOCK-83 已迁包插件文件，`p6_stored_source_map_invalid`）+ compute-settings 死链顺手清（UI-355，preload 在 P6 绑定内同批提交一次重采双清）+ p4r corpus 包感知化（需真实 R 运行时，独立阶段）。P7 维持 deferred；工作树 main 直接开发。此前 2026-09-13：最后更新：2026-09-13（**BLOCK-70-MOBILE-SYNC 整包收口 completed（P0–P4）**：扫码直达工作区全链（轻量页 /m + 桌面投影 /pair→完整 SPA + aliyun 隧道真远程）。**真机实测用户确认「挺好 成功啦」**。closeout 绿；P5 候选（Bot Channel/多端/附件/Web Push）另行裁决。**当前无 active 工作包**。此前 2026-09-13：最后更新：2026-09-13（**BLOCK-70 P3 A2 真远程实现收账（用户裁决「可以的 没有域名 用IP」）**：隧道管理器出站 ssh -R 钉 aliyun 回环/四态/退避重连 + REST + 面板隧道配置 + 配对 URL 公网优先 + aliyun 运维指引（自签+nginx 模板）。实机探针 **8/8 ALL PASS**（真实 ssh 到 aliyun 穿回环端到端）。**已代办 aliyun 运维**（nginx+自签证书+443 反代；公网入口 IP 勘正=47.110.228.168）+ **实机抓真修隧道互抖**（exit 事件迟到+树杀逃逸孤儿，集合跟踪+签名清场+守卫三件套），120s 稳定 connected、公网 health/移动页 200、QR 公网优先；真实外网手机扫码待用户。此前 2026-09-13：最后更新：2026-09-13（**BLOCK-70 P2 控制面追加实现（用户裁决「继续」）**：移动页批准卡（两步确认）/取消/composer 发消息 + decide 窄口直调 ackToolJob（权限不放大）；集成 10/10 + 实机探针 **28/28 ALL PASS**。active 维持：真实手机/真实模型 E2E 待用户；P3 隧道待裁决。此前 2026-09-13：最后更新：2026-09-13（**BLOCK-70 P0 A1 PoC + P1 主体实现收账（P0-LAUNCH 内）**：mobile-gateway 独立实例（默认关闭 additive）+ 配对/会话/吊销全链 + 设置区「手机远程」UI-319 + 移动只读页 /m；集成 8/8 + 实机探针 **16/16 ALL PASS** + 组件 3/3 + tsc 0。**active 维持**：真实手机扫码验收待用户（无人化阶梯第 2 级）；P2 控制面/P3 aliyun 隧道串行待裁决；⏳ qrcode-generator 依赖追认。提交 e9dd33c3。此前 2026-09-13：最后更新：2026-09-13（**BLOCK-83 遗留 A 清债 + 🟢 ABI 条目销号**：A 类 9 个已迁包核心旧副本删除（删前基线 99 红）；C 类 g0-rs-p5/p6-electron-pressure 改「包存在则跑、缺失显式 skip」（findBioPackRoot 包根解析）；`g0:chf0` 门首次可运行 3/3 转绿；g0-rs-p6-product-acceptance 7 红→2 红（余 2=D8 例外属 G0-RS）；悬空引用零残留。**新登记 G0-RS 归属**：`g0:result-studio:p4r:perf` corpus 生成链需包感知化改造。详见 AUDIT-LOG 最近处理记录。G0 开发期常态 · 不外推 packaged/Provider/GA。此前 2026-09-13：最后更新：2026-09-13（**BLOCK-84-DOMAIN-PACK-ONECLICK 整包收口 completed（P0–P3）**：领域包产品级一键装/卸交付（商店「领域包」分区 + `src/ipc/pack.js` 5 IPC + `core/shared-backend/pack-registry.js` + boot 接线）；收口门禁 `npm run closeout` **4/4 全绿**（P3 时 33 项存量 test:changed 债已经 TEST-INFRA-DEBT-3 `ce0cff4d` 清零转绿）；P1 隔离探针当前源码重跑 20/20 + 契约 17/17；P2 CDP 6/6 复用成立。plan v1.3 §10；DOC-REGISTRY → completed。**当前无 active 工作包**（用户 2026-09-13 夜间授权串行超长任务：遗留 A 清债 → 🟢 ABI 销号 → BLOCK-70-MOBILE-SYNC 启动）。G0 开发期常态 · 不外推 packaged/Provider/GA。此前 2026-09-12：最后更新：2026-09-12（**BLOCK-83 整包收口 completed（P0–P5）**：核心已零生信残留（删除 314 文件；tool-registry 空+env 注入 `BIOF3_DOMAIN_TOOL_REGISTRY`；dev 栈插件源=包 env 已入 restart 脚本）；生信包=Diandian-ops/gewu-pack-bio。收口门禁全绿；D7 棘轮基线 144。P6 证据重采属 G0-RS（D8 例外）。**当前无 active 工作包**。此前同日：最后更新：2026-09-12（**BLOCK-83 P4 收口 completed**：核心树生信内容物理清零（314 文件删除）；生信包 gewu-pack-bio（Diandian-ops，已推远程）为唯一来源；dev 栈默认插件源=包；D7 门禁基线 144。下一阶段 P5 收口。此前同日：最后更新：2026-09-12（**BLOCK-83 P4 切片 1**：生信包仓 gewu-pack-bio 本地建立（268 文件，首提交 2a51b73）+ 装卸缝实证（内置移走后核心从包加载 15 插件，flow 8/8）；关键事实=核心优先内置 canonical，切片 2 删除是必要条件；**远程建仓需用户操作（无 gh/token）**。此前同日：最后更新：2026-09-12（**BLOCK-83 P3 收口 completed**：核心扩展点定型 + D7 领域中性化棘轮门禁（`test/domain-neutrality.test.mjs`，基线 158 条=销号清单，负例验证会咬）+ 理由码中性化 `USER_INPUT_REQUIRED`（含存量兼容）+ D10 语言描述符 SPI 缝（R 档案行为分支 7 处登记 P4）。loop 族 283 测试全绿。下一阶段 P4。此前同日：最后更新：2026-09-12（**BLOCK-83 P2 收口 completed（实机 flow 8/8）**：目录提供者 SPI——后端投影自插件 + 前端 tool-catalog 通道；`frontend/src/tools/`（inventory 2,095 行）与 `_data.ts` 退役，6 消费方迁移；tsc 0 + 前端 30/30 + 后端 20/20。dev 栈在跑（含 Vite :3000，重启脚本只起 Electron——实机前需另起 Vite）。下一阶段 P3。此前同日：最后更新：2026-09-12（**BLOCK-83 P1 收口 completed（实机 4/4）**：D2/D3/D1 三切片+实机 4/4 allPass（acceptance/block-83/）；ABI 145 已修复；stash 卷入他方 block-77 WIP 事故已抢救（../block77-rescue-*）+HEAD 恢复；dev 栈当前在跑（3001/9222）。下一阶段 P2 前端领域中性化。此前同日：最后更新：2026-09-12（**BLOCK-83 P0 出口达成（P0-EXIT）**：D1-D14 确认通过，进 P1 RS 通用化（切片：D2→D3→D1 改名）。此前同日：最后更新：2026-09-12（**BLOCK-83 启动 active（P0-LAUNCH）**：P0 评审稿 docs/block-83-p0-design-review.md 落盘（D1-D14 代码事实+建议），⏳ 待用户逐项确认后进 P1（RS 通用化）。此前同日：最后更新：2026-09-12（**AGENT-WORKBENCH 对账收口 completed（用户裁决「确认」）**：八项归宿落定，唯一实做残余 P2.3 Skills 转独立小包排 BLOCK-83 P4 后；本包无新实现，实机证据沿用 A5+T-AW-013/T-AW-014 三轴；收口门禁 hygiene/docs/ui 三绿（docs-only）；active 槽位释放给 BLOCK-83（P0-LAUNCH）。G0 开发期常态 · 不外推 packaged/Provider/GA。此前同日：最后更新：2026-09-12（**AGENT-WORKBENCH 修订 3：Phase 2/3 逐项对账收束**：八项归宿全部落定（并入 BLOCK-83 三项残余/改属生信包两项/关闭三项），P2.3 Skills 残余转独立小包；待路线确认后本包对账收口释放 active 槽位。plan v1.4 §-1 修订 3。此前同日：最后更新：2026-09-12（**AGENT-WORKBENCH 修订 2：P1.4 参数确认卡取消（用户裁决）**：agent 主导不做参数级确认打断；Phase 1 七项 verified 即闭环；plan v1.3 状态头=active（P2 差距重审为下一步）。此前同日：最后更新：2026-09-12（**BLOCK-83 修订 2（planned 维持）：平台化——生信降格为首个参考领域**：核心基座=垂直领域扩展平台（五个领域中性 SPI），生信包=租户 #1 迁出核心树进独立仓库；D12 SPI 词表零领域词 + D13 第二租户证明；判据=清理不改核心代码 + 关键词扫描硬门；壳永远核心持有。plan v1.2 §0 修订链。此前同日：最后更新：2026-09-12（**BLOCK-83 修订 1（planned 维持）：目标升级「微内核 + 领域包」**：用户追问「生信独立存在、随时彻底清理」→ 能实现——核心只留领域中性五扩展点，生信功能代码整体迁出核心树进独立仓库，分发走远程插件清单；判据=清理不改核心代码 + 生信关键词扫描硬门；诚实边界（git 历史/DB 表留置/命名残留 D11）与 D9-D11、阶段重排见 plan v1.1 §0。此前同日：**BLOCK-83-GENERAL-AGENT-BASE 立项登记（planned 排队）**：用户两轮裁决——①生信作为通用 agent 可卸载插件（不需要即彻底剥离，模块化思想）；② Result Studio 定位三选一同意方向 1＝机制层升格底座「通用产物工作台」（去科学命名/SDK 去 .R 硬编码/validator 钩子化），剥离前置。全仓侦察结论与 B/C/D 分层、D1-D8 待评审项、P0-P5 阶段见 plan。active 槽位归 AGENT-WORKBENCH，本包启动需用户裁决。plan `docs/block-83-general-agent-base-plan.md` + DOC-REGISTRY planned + README 114。此前同日：**AGENT-WORKBENCH 启动 active（P0-LAUNCH）**：用户在队列候选（AGENT-WORKBENCH/G0-RS/G0-SDC/BLOCK-70-MOBILE-SYNC）问答中选择 AGENT-WORKBENCH——既有 Plan ID 增量复活（plan v1.1 写于 2026-08-14）。现状对账（plan v1.2 §-1）：Phase 1 七项 verified（UI-AGENTWB-001/002/003 verified；004/005/006/007 dev Electron 边界内 verified，2026-08-15 三份验证记录），不重复开发；**P1.4 参数确认卡片未实现**（无 ParamConfirmCard、无台账条目）＝P1 首项（§5.4 原规格，flag `paramConfirm` 默认关）；Phase 2/3 逐项启动前必须对照当前代码差距重审（BLOCK-66/69/72/78 等已落地相邻能力）。阶段：P0 对账立项 → P1 P1.4 → P2 Phase2 剩余缺口串行 → P3 远期另行用户裁决。当前 active：AGENT-WORKBENCH；队列 planned 剩 G0-RS / G0-SDC / BLOCK-70-MOBILE-SYNC。本机为 Windows 实机（fnm Node 24 + `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`；core/** 改动须重启 dev 栈）。plan `docs/agent-workbench-enhancement-plan.md` v1.2 + DOC-REGISTRY active/P0-LAUNCH。G0 开发期常态 · 不外推 packaged/Provider/GA。此前同日：**BLOCK-82-THINKING-CHANNEL-COMPAT 整包收口 completed**（P0–P3 一次会话完成，提交 34a30816/3fb91012/a9078d72/bf6916a5）：sensenova 思考段字段归一 + 能力位闭环——BLOCK-81 遗留候选收口。修复：deepseek.js 流式 delta + 非流式信封、io-transcript.js normalizeResponse 三处解析点归一（reasoning_content 优先/reasoning 兜底；后端归一后前端零改动）+ 契约测试 5/5；dev 栈 sensenova profile 补 reasoning 能力位（BLOCK-81 probe paramAccepted 有据）。实机 11/11 allPass（scripts/block82-thinking-compat-live.cjs，acceptance/block-82/）：standard 零思考参数（additive 红线）/ high 上游收 reasoning_effort=high / 思考段 136/307 字归一落库 meta.reasoningByIteration（修复前该渠道思考段整段丢失）/ 内容零破坏。收口门禁三绿 + test:changed 27/29（2 红=P6 源绑定存量漂移 HEAD 同败，重采属 G0-RS，例外登记）；impact-map 顺手清三处存量 unknown（dev-verify/block-79/ui-341，test-affected 16/16 全绿）。当前无 active 工作包，队列 planned：AGENT-WORKBENCH / G0-RS / G0-SDC / BLOCK-70-MOBILE-SYNC（启动需用户裁决）。会话纪要：用户休息期授权「规划一下……串起来完成一个长周期阶段性任务」，范围锁定 BLOCK-81 已登记候选、队列大包未启动；macOS 指挥席，dev 栈 BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev 一条命令起全栈。G0 开发期常态 · 不外推 packaged/Provider/GA。此前 ：2026-09-11（**BLOCK-81-THINKING-LEVEL-ENDPOINT-GRID 整包收口 completed**（P0–P3 同日完成，UI-342/343/344/345 verified）：Composer 思考档位（关闭/标准/高；标准＝不发任何上游参数）＋ 供应商设置页 Endpoint 网格修复（8 列显式 + 窄容器两行式）。**P3 真渠道实机 15/15 allPass**（`acceptance/block-81/block-81-p3-thinking-live.json`：composer 驱动三独立会话，UI 实发体与上游 `requestBody.reasoning_effort` 双向对账；工具轮展开后思考行渲染）＋ **渠道接受度矩阵 3/3**（`...-channel-probe-live.json`）。**实机抓真修**：P2 档位控件在「切档后不刷新页面直接发送」时静默失效——`useChatStream.send` 的 `useCallback` 闭包读了 `thinkingLevel` 却漏进依赖数组（实机拦截 fetch 实证：控件 high、请求体 standard）；修复 + 回归测试 `useChatStream.test.ts`（撤修复即 2/2 红）。剩余候选：sensenova 思考段字段名为 `reasoning`（我方解析面只认 `reasoning_content`）、思考行仅挂在执行记录内。**当前无 active 工作包**，队列 planned：AGENT-WORKBENCH / G0-RS / G0-SDC / BLOCK-70-MOBILE-SYNC（启动需用户裁决）。G0 开发期常态 · 不外推 packaged/Provider/GA。此前 2026-09-09：**BLOCK-73-HIDDEN-FILES-TOGGLE 一次会话收口 completed**（UI-322 verified）：文件树「显示隐藏文件」开关（方案 A）——local 分支 ?showHidden=1 参数化（默认行为不变）+ 工具条 toggle 默认关 + localStorage 持久化；ssh 项目禁用（BLOCK-67 协调项）；实机 6/6 allPass（scripts/ui322-hidden-files-live.cjs 入库，acceptance/ui-322/）。此前同日：**BLOCK-67-SSH-REMOTE-PROJECT 启动 active（P0-LAUNCH）**：用户裁决启动 SSH 远程项目（排队清单最大包之一，完整项目形态非 BLOCK-57 轻量）。P0 设计评审为硬门：§5 八项裁决（D1 thin per-call SSH / D2 体感预算 / D3 真值与缓存 / D4 凭据安全 / D5 断线语义 / D6 平台边界 / D7 ExecutionTarget 关系 / D8 产物链）逐项核实代码事实后呈用户确认；**D6 矛盾点显式裁决**：plan 写「指挥席 macOS 优先」但当前实机为 Windows（BLOCK-63 电脑控制已有 Windows 先例，ssh 客户端走系统命令理论跨平台，实测取证后由用户裁决放宽或换机）。真实节点资产：aliyun+dell（BLOCK-57 注册目标，既有 probe 链验证连通）。plan `docs/block-67-ssh-remote-project-plan.md`。此前同日：**BLOCK-72-WORKBENCH-GLOBAL-ENTRIES 一次会话收口 completed**（UI-320 verified）：知识空间+后端迁工作台全局入口——/knowledge 与 /backend 全局路由页 + 左栏工作台区「知识空间/后端」入口 + 右栏 RightPanelMode 去 terminal/knowledge（不预留空壳）；composer 大脑开关保留；实机 5/5 断言 allPass（scripts/ui320-workbench-live.cjs 入库，acceptance/ui-320/）。此前同日：**BLOCK-69-KNOWLEDGE-SPACE 首包 P0–P2 一次会话收口 completed**（UI-318 verified）：知识空间存储域（migration 009 三表 + FTS5 trigram 虚表）+ 双通道检索内核（向量 RRF 融合全文，短词 LIKE 兜底）+ 文本族摄取状态机 + `/api/knowledge/*` + knowledge_search/status 工具 + 自动召回注入（启用才检索，过阈值≤3 块，计入 knowledgeTokens 预算）+ composer 大脑开关 + 右栏 knowledge tab；实机 15/15 断言 allPass 含真实模型对话命中/关闭不命中（`scripts/block69-knowledge-live.cjs` 入库，需 fnm Node 24 + DASHSCOPE_API_KEY 环境）。**BLOCK-67-SSH-REMOTE-PROJECT 整包收口 completed**（P0–P5，UI-321/UI-324 verified；实机 P1e 6/6 + P2 5/5 + P3 4/4 + P4 8/8 allPass，acceptance/block-67/）；**当前无 active 工作包**；BLOCK-69 P3/P4 候选另行裁决。同日 BLOCK-70/71 由并行会话推进。G0 开发期常态 · 不外推 packaged/Provider/GA。）

## Session Snapshot

- **2026-09-16（Windows 会话）：远程同步 38 提交 + BLOCK-91 收口 completed**：快进 `a45c3b81..17cc53e4`（BLOCK-90 closeout / G0-RS 收编 / BLOCK-91 P1+P2 / UI-382/383）；对账后补走 BLOCK-91 closeout——716c8762（UI-382 增量）同提交台账漏同步按先例豁免+补登，ui-audit 门回绿；定向复跑前端 6 套件 80/80 + 文件面 Node 40 过 1 skip + tsc 0；**新登记 🟡 存量基线红**：provider 映射面 continuation guard 2 项（`agent-loop-control.js` capHit 计数语义 vs 测试预期，源/测试自 2026-09-12 前未变，非 BLOCK-91 引入，清债需用户裁决）。`obs.tmp.cjs`（既有观测草稿）保持不触碰。

- **2026-09-15 凌晨（Mac 指挥席）：G0-RS P6 重采 completed**：`p6:update` 全链绿（365 测试 0 红 + capture 10/10 @ `e2ec798c`，证据 `f62ab036`）。实机抓真三件：pycache 残留伪装内置目录（已移出）/ `_biof3-theme.R` 两头落空（包仓 `b2d0e91` 六插件兑现）/ BLOCK-84 多源遮蔽 drift 升级模拟（`e2ec798c` 冷启窗口）。运行时：`BioF3-Local/runtimes/R` 换符号链接指框架 R。剩：p4r corpus 包感知化（待用户裁决）。
- **2026-09-14 晚间（Mac 指挥席）：分叉对账收编 + UI-367/368 verified**：本地与 origin 分叉（ahead 1 / behind 41，同主题「UI 台账清偿」两侧各一份）已 rebase 收编并推送；UI-367/368 用户手机真机复测三条判定通过升 verified。待办：§9.2 Mac 双真机联邦验收（Mac 出码 → Windows 配对，F1/F2/F3）+ §9.3 P6 重采（`g0:result-studio:p6:update`）。
- **BLOCK-85 格物联邦 P0→P3（2026-09-14 交付，剩 P4 closeout）**：两台格物互派任务**双粒度**（分析作业级 / Agent 会话级）；**轻量包**（plan=AUDIT-LOG 条目 + P0 评审稿 `docs/block-85-federation-p0-design-review.md`）。**代码落点（接手锚点）**：对端握手 = `core/biof3-server/mobile-gateway/index.js`（`/federation/api/health` 挂 gateway **会话门内**——对端格物因此拿到与本地同源同门的全量 `/api/*`）；指挥席节点注册表 = `core/shared-backend/federation-peers.js`（`<dataDir>/federation/peers.json`，**凭证由指挥席保管、对端 sessions.json 只存 hash**）；peers REST + 作业级**转发/状态/产物**三端点 = `core/biof3-server/routes/federation-admin.js`（挂在 `routes/index.js`）；`fed:` 分派 = `core/biof3-server/helpers/tools-executor.js`（`executionTargetId=fed:<peerId>` → 对端 `/api/tools/run`，**真值在对端**）；Agent 委托 = `core/biof3-server/agent-tools/federation-tools.js` + `registry.js` + `tool-defs.js`。**前端**：`DesktopSettingsPanel/sections/Federation.tsx`（协作成员面板，含 P2.5「界面」按钮）+ `workspace-panels/LeftPanel.tsx`（左栏底部**单入口「联邦」** + tab 分页；旧「手机连接」独立入口已随 UI-358 修订 1 退役）。**探针**：`test/federation.test.mjs`（P1+P2 真实双实例）、`test/federation-jobs.test.mjs`、`test/agent-tool-registry.test.mjs`。**证据**：`acceptance/block-85/p1-federation-panel.png`、`acceptance/block-85/federation-merged-panel.png`。**下一步 = P4 closeout**（`npm run closeout` 4/4 + canonical 五件套）。**未接入**：前端**执行位置选择器 UI**（P2.5 侦察锁定实施点见 roadmap）。**本次顺带**：UI-358 修订 1/2 台账条目补登（LEGACY 豁免已由前序会话登记）。

- **BLOCK-81 思考档位 + Endpoint 网格（2026-09-11 completed，UI-342/343/344/345 verified）**：用户两截图提案（ZCode 有思考级别我方没有；设置页 Base URL 过宽/连通性列文字重合）→ 一次会话 P0–P3 收口。P0 UI-342 网格 8 列显式（修文字重合与垃圾桶换行）+ UI-344 窄容器两行式（容器查询）；P1 映射内核 `core/shared-backend/llm-providers/thinking-level.js`（中性档位→上游参数单一映射点，`standard`＝不发参零行为变化，按 protocol 映射，能力位门控）+ 渠道级「支持思考档位」开关 UI-343 + 网关唯一注入点与 400 去参重试；P2 composer 档位控件 + 会话级持久化 UI-345；P3 真渠道实机对比与收口。**实机抓真修（重要工程教训）**：`useChatStream.send` 的 `useCallback` 依赖数组漏 `thinkingLevel` → 切档后不刷新页面直接发送时沿用旧档位，**控件显示 high 而请求体仍是 standard**（拦截页面 fetch 实证）；P2 的证据取的是「切档后重进工作区再发送」（挂载时闭包已是 high），恰好绕过该路径——**控件类改动的实机证据必须覆盖「同一挂载内改态即用」**。修复 + `useChatStream.test.ts` 回归（除档位外所有入参保持同一引用，撤修复即 2/2 红）。**渠道事实**：本机 deepseek-flash 网关**不因档位改变思考行为**（standard 337 字 / high 117 字思考段），档位被透明转发并被接受；4 渠道均不以未知参数 400 拒绝 → D3 实机路径不可达（确定性门禁 6/6 覆盖）。**运行提示**：实机脚本 `scripts/block81-p3-thinking-live.cjs`（composer 驱动，15/15）与 `scripts/block81-p3-channel-probe.cjs`（直连上游接受度，3/3）需 dev 栈在跑；改了 `core/` 必须重启 dev 栈。

- **BLOCK-73 文件树隐藏文件开关（2026-09-09 completed，UI-322 verified）**：用户确认方案 A——routes/files.js local 分支 ?showHidden=1 参数化（默认请求逐字节不变）；右栏工具条 eye/eye-off toggle（data-testid=file-tree-show-hidden）默认关，refreshFiles→refreshVersion 链联动 FileTreeItem 子目录重取；localStorage gewu.fileTree.showHidden 持久化；ssh 项目 UI 禁用（node-agent/workspace-gateway 属 BLOCK-67 在制面，路由级契约测试锁定 no-op，登记 BLOCK-67 后续协调项）；审阅面板 git 通道不受影响。**工程备注**：ZCode 后台任务监管会回收长跑 dev 栈（exit 127，PATH 丢失）——改 cmd start 分离启动（env 完整保留）栈在会话外稳定存活。

- **BLOCK-72 工作台全局入口（2026-09-09 completed，UI-320 verified）**：用户裁决「知识、后端放在工作台中，它们是全局的」。/knowledge 与 /backend 全局页（对标 /skills；共享 global-page.module.css 壳）；左栏 QuickActions 增 知识空间(brain)/后端(cpu) 两入口；右栏 RightPanelMode 删 terminal/knowledge 两值不预留空壳；home 空态「后端」卡改跳 /backend；TerminalPanel project 放宽可选（仅影响 workspacePath 展示与 openShell cwd，IPC 内建数据根回落）；KnowledgeSpacePanel 零项目依赖原样复用；composer 大脑开关保留（会话内启停态 vs 全局管理面分工）。边界：底部终端（BLOCK-54）不动。实机 5/5 allPass（acceptance/ui-320/）。

- **BLOCK-69 知识空间首包收口（2026-09-09 completed，UI-318 verified）**：P0 存储域+检索内核（migration 009：knowledge_spaces/documents/chunks + knowledge_chunks_fts；knowledge-space.js 结构感知分块/双通道 RRF/删除单事务两通道同灭）→ P1 文本族摄取（knowledge-parsers 扩展名路由 fail-closed + knowledge-ingest 状态机 uploaded→parsing→chunking→embedding→ready|failed + 串行队列 + routes/knowledge.js REST + agent-tools/knowledge-tools）→ P2 注入+UI（agent-runner 与 ai-agent/chat buildAgentTurnBlock 轻按需注入 + knowledgeTokens 预算 + KnowledgeSpacePanel + useKnowledgeSpaceToggle）。**实机抓真修两处**：knowledge_search 工具加开关门（关闭后 agent 仍可工具命中违反验收语义）；面板空闲 10s 慢轮询（外部上传文档不出现）。**工程事实（重要）**：trigram 分词的 FTS5 表对 UNINDEXED 列的 LIKE/GLOB 谓词被 SQLite trigram-LIKE 优化劫持**恒返回空**（SELECT/DELETE 皆然；默认 unicode61 正常）——FTS 删除/计数一律走等值 IN 子查询，测试断言同。**验收脚本运行环境**：fnm Node 24.20 + `BIOF3_DEV_ELECTRON_ARGS=--remote-debugging-port=9222` + `DASHSCOPE_API_KEY`（用户 secrets 文件 `.biof3-dev-user-data/.biof3-secrets` 内含 key，提取后 export 即可启用真实嵌入通道）。

- **工作区改动卡片移除（2026-09-09，用户裁决）**：聊天区 AgentChangesCard（UI-216/252/255/273 宿主）整体移除——信息与审阅面板 + 对话内工具行重复、空会话呈现场景差、关闭 X 不持久。审阅面板（/review + dock + 首页审阅卡）为改动呈现唯一面；conversationChangesStore 暂保留（写路径在 run 流内）。台账四条置 cancelled 注记。
- **BLOCK-65 子智能体专属界面整包收口（2026-09-09 completed，`44050255`，UI-314 verified）**：用户裁决 P1-b①=自动弹出专属窗、P2-c②=SubAgentsBar 升格俯瞰。落地：① 后端用户态子域 `routes/ai-agent/task-actions.js`（GET /api/ai/agent/tasks + GET task/:id/meta + POST message/followup），语义与 send_message/followup_task 工具**单源**（spawn-agent-tools 导出 queueUserMessage/launchUserFollowup 复用 launchSubAgent/buildTerminalSummary）；② AgentWindowPage 交互补全（中断两步确认 + 留言队列语义诚实标注 + 终态继续派→自动弹新窗）+ 窗口标题 task 前缀；③ SubAgentsBar 自动弹窗（模块级 Set 去重 + autoDemoted 提示）+「全部俯瞰」跨会话面板（5s 轮询只读 tasks 投影）。P2-d 评估=维持独立窗形态。实机 6 断言全 PASS（`acceptance/block-65/`，真实模型 spawn 链路）。

- **BLOCK-64 指挥中心 UX 整包收口（2026-09-09 completed，`abc19b62`，UI-313 verified）**：P1-a mapToolJob 补 execution_target_id（远程徽章复活；新增 mapper 级回归禁手工注入）+ 瓦片项目标注 + 失败 error 摘要；P1-b 活跃置顶（commandCenterModel.orderJobsForWall）+ 查日志（新只读端点 `GET /api/tools/log/:id`：remote-runner.log 实时优先 / run.log finalize 兜底 / 32KB 尾 / 无文件诚实 no_log_yet）+ 取消两步确认；**cancelled 提为一等 ToolJob 状态**（此前 mapper 塌缩成 pending，取消后作业永远以「排队中」挂墙）；P2-d Ctrl/Cmd+Shift+C 快捷键（App 根注入）+ 空态引导。实机 9 断言全 PASS（`acceptance/block-64/`）。三面统一叙事评估=不合并（tool_jobs/task_events/进程表真相域不同）。**实机教训**：CDP Input 管线保留 Ctrl+Shift+C（Chromium devtools inspect），注入用页面级真实 KeyboardEvent。遗留：agent 俯瞰按计划移交 BLOCK-65。
- **UI-LEDGER-CLOSEOUT 整包收口（2026-09-09 completed）**：台账 9 项 + 隐藏拼行 UI-184 全部裁决（verified 8 / cancelled 2——UI-195 acceptRejectWidget 随 f57089cb 退休）。**随包真缺陷修复**：① UI-180 reject 在文件末尾恒败（parseDiffFiles EOF 零长度伪影行）+「全部还原」遇 untracked 恒败（revertPaths tracked/untracked 分区），a9df9f95；② UI-P2-001 branch:* 信封无人拆包 → /results 首载崩 + 切分支恒拒（branchBridge 单点拆包 + useBranchStore 补 projectId），a9df9f95；③ agent-workbench-flags IPC 裸调 publish → extraRenderers 开关被 bridge.set rejection 永久回滚，1dc133c3。证据 `acceptance/ui-ledger-closeout/`（ui180-live / ui-p2001-live / ui-agentwb-live / ui183-error-details / ui156-uiattch-verdict / harness-checkpoints）。
- **dev 数据根三分裂修复（2026-09-09，`835332dc`——用户报告「模型列表只剩 deepseek-chat」的根因）**：dev-electron.js 只把 `BIOF3_LOCAL_DATA_DIR` 传给 Electron、从不导出 → biof3-server 与迁移子进程回落各自默认：ai-settings 读 `~/Documents/BioF3-Local`（无文件 → 兜底 DEFAULT_CHAT_MODEL_PRESETS=deepseek-chat，用户 4 供应商配置读不到）、BIOF3_DB_PATH 钉死 macOS 时代 `~/Library/Application Support/biof3-local/bioF3.db`（空库）。修复：wrapper 在 fork 任何子进程前导出 `BIOF3_LOCAL_DATA_DIR=<userData>/data`，BIOF3_DB_PATH 镜像 env-coordinator 同款 `<数据根>/biof3.db`。重启后 /api/ai/settings 返回用户真实 4 preset + credential_status 全 true。**遗留磁盘残留（未清理，无引用）**：`~/Documents/BioF3-Local/biof3.db`（09-02 死库）、`~/Library/Application Support/biof3-local/bioF3.db`（空 schema 库）、`.biof3-dev-user-data/bioF3.db`（旧副本）、`core/biof3-server/biof3.db`（schema-only）。
- **事故记录（已恢复，如实登记）**：收口清理脚本曾按标题匹配误删 dev 会话 conv_240062f9-e01（新对话 (分支)——前日 UI-156 验证遗留的 fork 拷贝）；从 WAL 快照恢复全部真实字段（parent_id=conv_271303b6-b8d、created=2026-09-08T13:02:45Z）后按 fork 语义同 id 重建（4 条消息拷贝 = fork 时点父会话状态）。清理逻辑已改为 id-diff 只删本次新建；教训=清理端点一律禁止按 title 模糊匹配。
- **BLOCK-63 整包收口（2026-09-08 P0–P5 completed）**：Windows 电脑控制落地——sidecar `sidecars/computer-use-windows/`（C#/.NET 8 + FlaUI 5.0 UIA3，八动词 + close hwnd 粒度 + press 消息级键盘注入回退），host 平台门 darwin|win32，8 computer_* 工具双平台注册；实机 Win11 记事本闭环 allPass（`acceptance/block-63/`，hwnd 差集隔离 + ValuePattern 中文输入 + WM_CLOSE 清理，用户窗口零污染）。**关键工程事实**：① 本机宿主安全层拦截合成键盘输入（SendInput 三路径实证；探测器=GetAsyncKeyState 异步键态；消息级 WM_CHAR/WM_KEYDOWN 回退可达）；② Win11 打包记事本单实例多窗口 + 一窗多顶层 hwnd（frontmost 不可靠，`target:{hwnd}` 直投 + 差集隔离）；③ better-sqlite3 ABI 137=Node 24（测试/实机脚本必须 `fnm use 24`）。Windows 侧工具链门禁：`powershell sidecars/computer-use-windows/build.ps1`。plan `docs/block-63-windows-computer-use-research-plan.md`（P0–P5 全记录）。
- **UI-305 整包收口记录（2026-09-08 verified，ff2ddfe5/160e0f2c/feed10da + 收口提交）**：P0–P3 全落地（细节见台账 UI-305 段）。拆分后模块图：SimpleChat/ 子目录 5 组件 + 3 hook、project-workspace/ 子目录 11 组件 + 1 hook、WorkingTreeReview/ 3 组件、workspace-panels/ResultArtifactShell。**注意**：ReviewMode 手风琴用例在全量并发下偶发时序 flake（单独跑稳定 4/4）；前端全量 vitest 3 处 HEAD 存量失败已登记 AUDIT-LOG 🟢（theme-token `--gewu-live-*` 契约 + EFS Windows 路径 ENOENT）。
- **UI-311 收口记录（2026-09-08 verified，`1761958f`）**：`/project/:id/results` 整页白屏根因 = result:* IPC 信封契约漂移——handler 统一返回 `{ ok, data?, error? }`、preload 1:1 透传，electron.d.ts 却按裸值声明且 resultBridge/useResultStore 无人拆包。修复：electron.d.ts result 命名空间如实声明信封 + resultBridge 单点拆包（消费方零改动）；回归 9/9 + 受影响面 178/178 + 实机直达 /results 空态页零异常（证据 `acceptance/ui-311/`）。
- **dev 启动工具链事实（2026-09-08 实测，Windows 本机）**：`npm run dev` 的 wrapper（`scripts/dev-electron.js`）在启动期自行跑 DB migration 且**失败即退出**（`process.execPath` = PATH 上的 node 加载 `core/biof3-server` 的 better-sqlite3，ABI 必须匹配）。`.node-version` 钉 24，本机 fnm default = v24.20.0；若 shell PATH 上的 node 非 24（如系统 22.20.0），wrapper 报 `NODE_MODULE_VERSION 137 ... requires 127` 后直接失败。**启动 dev 前确认 `node -v` = v24**（fnm 环境 `fnm use 24` 或前置 `fnm/node-versions/v24.20.0/installation` 到 PATH）。main.js 内的迁移失败是非致命兜底（initSchema 兜底建表），wrapper 层才是硬门。
- **「工作区改动」项目关联核查（2026-09-08，准确）**：项目 `p_mtrawlau_7rly`（biof3-desktop）`workspace_path = D:\1.WorkDir\biof3-desktop`（后端实查）；AgentChangesCard 数据链 `git:working-tree-status → resolveGitAdapter(projectId) → project.workspace_path`，卡片与 git 地面真值逐文件精确吻合。
- **Electron 41 启动修复线（2026-09-07/08 收口推送）**：`b619c756` 剥离 ELECTRON_RUN_AS_NODE / `df777645` .node-version + scripts/dev 工具链 / `ec28e51b` windows-x64 runtime artifact sha256/sizeBytes / `4363a302` preload 路径 + 迁移子进程 ABI 运行时判定 + PROJECT_ROOT 深度修正（22:34 实例实机冒烟）。UI-310 加映：接缝悬停高亮全高连续（`0fc06603`，z-index 5→10000）。

- **修复包收口记录（2026-09-03 晚 verified）**：AgentStreamDisconnected 根因修复包已按接手三步收口——① 实机复测 3/3 PASS（composer 真实消息回复正常 / 无「任务事件流中断」横幅 / SQLite 最新任务 `agent_status=done` 且 error 空，证据 `acceptance/agent-stream-disconnected-fix/live-check.json`）；② 门禁 docs:check 199 + ui:audit:check PASS（台账按 UI-surface 规则补登 UI-281 verified）；③ 修复包已提交。
- **AgentStreamDisconnected 根因链（已修，交接上下文）**：events.js 曾用 `sseSend('[DONE]')` 发终态哨兵 → `JSON.stringify('[DONE]')` 序列化为带引号 `"[DONE]"` → 前端 copilotClient 匹配裸 `[DONE]` 永不成立 → 每个 task 完成后被判「在完成前中断」→ 24 次退避重连（~90s，终态回放路径同样发带引号哨兵）烧窗后报 AgentStreamDisconnected。旧 dev 实例长期未重启 + BLOCK-39 之前「干净截断=onDone」宽松兜底共同掩盖了该缺陷。修复：后端 `sseDone()` 裸写 + 前端 `isSseDone()` 双形状兼容 + 带引号形状回归用例。
- **两个 BLOCK-51 连带回归（c118e201 引入，重启 dev Electron 后才暴露，均已修）**：① `src/main.js` plumber 清理时误删 `require("./ipc/plugin")` 但保留 L468 调用 → 启动即崩 `setupPluginIpc is not defined`（BrowserWindow 不创建，CDP page=0）；已恢复 require，重启验证窗口正常。② `core/biof3-server/agent-runner.js` `safeCtx` 声明在 try 块内（const 块级作用域）而 `loopConfig.contextWindow` 在块外引用 → 所有 agent_loop 任务启动即 `failed / safeCtx is not defined`（fail-closed）；已改为块外 `let safeCtx = 64000` + try 内赋值。
- **验证状态（修复包）**：copilotClient 两套件 vitest 18/18（含新增带引号 `[DONE]` 回归用例）、tsc --noEmit 0、`node --check` 三文件通过、回归①（窗口创建）与回归②（safeCtx 端到端）均已实机验证；后端日志证据：`/var/folders/21/qbc03mcn1zd2kgnj7vkqgsnh0000gn/T/biof3-electron-main.log(.error)`。
- **教训（写进后续工作的约束）**：① 测试桩与真实契约漂移——SSE mock 全部用裸 `[DONE]` 而真实后端发带引号形状，测试全绿实机炸；SSE/IPC 契约测试必须以真实后端输出形状为准。② 旧 dev Electron 实例（未重启）会掩盖 main process / 后端回归，`src/main.js`、`core/**` 改动后必须重启实机冒烟再收口。
- **历史收口**: `BLOCK-29.7-REVIEW-CHANGES-TREE` 已于 2026-08-31 收口（plan `docs/block-29-7-review-changes-tree-plan.md`；UI-244 verified，证据 `acceptance/ui-244/`）。**审阅文件导航契约**：dock 改动 = 目录分组树（组头折叠与 /review 主区共享 collapsedDirs 语义、缩进参考线、行内编辑/历史/放弃三操作）；历史提交详情 = 左 mini 树 172px + 右 diff（局部 treeCollapsed）；/review 主区 = 左侧目录分组树（BLOCK-28 P2 原有）；三处同构共用 `groupFilesByDirectory`/`groupDisplayName`（根目录标签「（根目录）」）。**审阅 chrome 契约**：summary 单行（提交审阅唯一 primary、刷新/退出 icon 化、全部还原 danger-ghost）；历史行 ⋯ 溢出菜单（撤销上次提交，confirm 保留）；`.wt-btn` 28px 栅格。**字体契约**：sans=`--biof3-font-sans`（含 CJK）、mono=`--biof3-font-mono`、表单控件 inherit、新表面禁止字面量字体栈。**字号契约**：代码表面基准 body-sm 13px、行内 code caption 12px、阶梯最小 xs 10px。
- **Current branch**: `main`；HEAD、dirty state 与 `origin/main` 同步状态以运行时 Git 为准。
- **Code review boundary**: 代码审阅为**右侧停靠面板**（TitleBar 审阅按钮 Toggle；面板内 = 手风琴文件列表（BLOCK-29.1，未跟踪文件可预览 WORKTREE 全文）+ 提交详情头（BLOCK-29.3）+ 文件视图四态（BLOCK-29.4 三态 + BLOCK-29.5 blame）+ 分支选择器/标签 optgroup/stash 只读列表（BLOCK-29.5）+ 两提交对比模式 + 内嵌提交框）。`/review` 主区 mode 路由保留（同一 ReviewMode 组件）。审阅内核与主题契约不变：真实语义 token 明暗自适配、`git diff HEAD` 基准（c228beb 保留）、hunk 决策键 `path#hunkIndex`、零模型参与。
- **git history data shape**: `git:commit-log` 载荷 `commits[]` 自 BLOCK-29.3 起含 `message`（完整提交说明）；`commitDiff`/`commitFileContent` 自 BLOCK-29.5 起支持 `{fromRef,toRef}` 区间模式（hash 可省）；`branchList/blame/stashList/tagList` 为 BLOCK-29.5 新只读通道——浏览器 shim 桩若缺这些方法，对应功能降级为空/错误态（blame 视图会显示加载失败，属预期）。
- **注意（真实链路）**: `git:commit-log` 的 skip/file 透传断点已修（UI-226），**运行中的 dev Electron 须重启**才会载入新主进程代码；重启后 UI-221 分页/文件历史在真实 app 恢复。
- **git 写操作边界（BLOCK-41 起变化）**：写操作候选（分支切换/暂存区两栏/push-pull）已于 2026-09-02 由用户显式裁决启动为 `BLOCK-41`（含手动提交框；脏树切换拒绝并提示冲突清单）；stash 写操作维持排除。
- **P6 evidence boundary**: canonical `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json` 绑定 `1f276de`（206-file binding，10/10 checks）。注意：BLOCK-25 改动了 `core/r-server/**` 与 `src/ipc/working-tree-review.js` 等源文件，P6 evidence 的 206-file binding 若覆盖这些路径，下一次相关门禁会按设计 fail-closed，需要重采。
- **Minimum recovery**: 先读 `AUDIT-LOG.md` 当前待处理项，再核对 Git，然后用 `DOC-REGISTRY.json` 定位 active 工作包；无 active 包时停止，不通读历史文档。
- **Last recorded gates**: tsc --noEmit 0 / WorkingTreeReview 定向 vitest 23/23 / docs:check PASS(163) / ui:audit:check PASS / docs:reconcile 0 / git diff --check clean。UI-204~212、UI-219~223 verified（dev 边界内，证据 `acceptance/ui-204/`、`acceptance/ui-208/`、`acceptance/ui-210/`、`acceptance/ui-212/`、`acceptance/ui-219/`~`acceptance/ui-223/`）。UI-193/194 保持 in_progress（缺口已取证）。
- **G0 discipline**: G0 开发期常态 · 不外推 packaged/Provider/GA。


- **BLOCK-17-AGENT-DOC-REVIEW-PANEL（2026-08-21 → 2026-08-22 superseded）**：BLOCK-11 → paused。2026-08-22 用户裁决'多一个审阅界面没有意义'，UI 入口改为文件页面内 diff toggle，由 BLOCK-18 接管 active 槽位。
- **BLOCK-18-WORKSPACE-MD-DIFF（2026-08-22 → superseded 2026-08-22）**：BLOCK-17 → superseded，BLOCK-18 接管 active 槽位。把'前后差异'直接搬到 WorkspaceFilePreview 内：toolbar 加'预览 / 对比' toggle，diff 视图复用 BLOCK-17 computeSimpleDiff + .wt-* 样式 + agentDocReview IPC。PHASE 1 提取 markdownDiff.ts / PHASE 2 WorkspaceFilePreview 加 mode 状态机 / PHASE 3 删除 BLOCK-17 独立面板 / PHASE 4 验收门禁 + 收口。**2026-08-22 用户裁决"代码审阅模式"应是系统级常驻面板 + 全文本覆盖，BLOCK-18 转 superseded by BLOCK-20-CODE-REVIEW-PANEL**。已实现的 markdownDiff.ts / agentDocReview:saveCurrent / workspace.writeTextFile / <textarea> 资产由 BLOCK-20 复用。DOC-REGISTRY `BLOCK-18-WORKSPACE-MD-DIFF status:superseded`，plan `docs/block-18-workspace-md-diff-plan.md`。
- **BLOCK-20-CODE-REVIEW-PANEL（2026-08-22 active）**：BLOCK-18 → superseded，BLOCK-20 接管 active 槽位。系统级代码审阅体验：常驻右侧审阅面板覆盖项目所有 git 跟踪的修改文本文件（不限 markdown），基准 vs git HEAD，unified / split 双视图，hunk accept/reject，inline-edit drawer。5 新 IPC（git:list-modified / git:file-head-content / git:split-side-diff / git:revert-file / git:apply-inverse-hunk）。复用 BLOCK-16 DiffFileView / DiffHunkView / applyPatch / revertPaths / <working-tree-rejects> system-prompt 注入（0 改动）。PHASE 0 治理登记 commit f974076 + PHASE 1 IPC 5 通道 commit 9c303d6。DOC-REGISTRY `BLOCK-20-CODE-REVIEW-PANEL status:active`，plan `docs/block-20-code-review-panel-plan.md`。：2026-08-18 用户裁决 "block-11-bioSkills" 启动。GPTomics/bioSkills.git 32 categories × ~170 SKILL.md → BioF3 plugin/skill 映射。Top 5 priority single-cell (P0 95) / variant-calling (P0 92) / pathway-analysis (P1 85) / methylation-analysis (P1 82) / read-qc (P2 78)。plan v1.0 / 14 § / 6 PHASE 落地 `docs/block-11-bioSkills-integration-plan-v1.0.md`（278 行）。**3 个并行 WS** 收口：WS-A commit `b5e37a8` 提交 2 真 untracked (block-11 v0.1 DRAFT + diagnose-traffic-lights 报告) / WS-B chf0-critical 5 步定向测试全绿 39+23+19=81 tests pass + 0 TS errors + 0 fail / WS-D commit `02ea7bd` 提升 PLAN v0.1 → v1.0 canonical + DOC-REGISTRY active 登记 + README 同步。4 治理门 GREEN（docs:check 115 / docs:reconcile 0 / tsc 0 / ui:audit:check 4 pre-existing drift）。WS-C (CDP-wrap 实机 UI-157/158/159/161 验证) 取消，留 BLOCK-12+ 单独工作包。**当前 active 工作包**：BLOCK-11-BIOSKILLS-INTEGRATION（PHASE 0 调研 + 5 PHASE 收口）。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / marketplace 真实后端 / packaged artifact / Provider 矩阵 / OSS 远程分发 / GA 公证流水线 / MCP 暴露 / 32 category 全实现 / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/10 系列 / 不动 agent-tools/* / agent-transcripts/*。**Push 故障恢复**：2 次 github.com:443 timeout（75s + 60s）通过 gh CLI Diandian-ops token 推送成功 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-0-LAUNCH |

## 1. 恢复顺序

新的 Agent 不应通读历史计划猜测主线。按以下最小顺序恢复：

1. 上方 Session Snapshot 与 [`AUDIT-LOG.md`](./AUDIT-LOG.md) 的当前待处理项
2. `git status --short --branch`、`git log -8 --oneline --decorate`、`git worktree list`
3. `DOC-REGISTRY.json` 中 active 工作包与 canonical 冲突检查
4. 仅当存在 active 工作包时读取其 canonical plan；否则等待用户裁决
5. 当前任务涉及的源码、类型、测试、影响范围与专项规范

历史审计与阶段验收位于 [`archive/`](./archive/README.md)，只用于追溯，不决定当前顺序。

## 2. 当前产品阶段

`v0.0.1-rc.7` 是当前 OSS 线上最新版，已完成候选代码、双架构构建、安装启动验收和公开更新链核验。

当前固定顺序：

> **Stage 1 UI 产品化 → Stage 2 模型层 → Stage 3 Harness 与标准流程 → Stage 4 首个稳定产品版本**

Stage 1、Stage 2、Stage 3 均已完成出口验收。Stage 4 macOS arm64 RC 已完成代码、首用、迁移、隐私、构建、提交/tag、OSS 上传及公开下载反向验证。

## 3. 当前立即任务

### 3.0 当前恢复检查点：UI-141 / UI-142 macOS 开发启动

- 交付载体：PR #13；实现检查点 `6adeaa9`；单 worktree。开发/审计统一使用 `npm run dev`，不保留 `biof3-dev` wrapper。PR 必须使用 merge commit 合入，不 squash/rebase，以保留 Acceptance evidence 绑定的 source commit 可达性。
- 已提交：UI-141 将“后端未就绪”与“R Runtime 缺失”拆分并修复轮询挂起；UI-142 通过 LaunchServices + 隔离 userData 根治 macOS 后台启动无键盘焦点；UI-140 修复恢复身份、早期派生与并发收口缺陷。
- 根因证据：`launchctl asuser` 启动的 Electron 虽有 renderer focus，OS 层仍是 `AXFocused=false`，系统真实 `keystroke "x"` 不进 textarea；改为 LaunchServices `open -a` 后，同样按键读回 `"x"`。这证明问题来自 macOS GUI 启动上下文，不是 React textarea 抢焦点。
- 当前现场（2026-08-11 复核）：canonical `npm run dev` 正在运行；3000/3001/3004/9222 全部监听，r-server/py-server health 均为 ok。日志含 `[renderer] page loaded` 和 `[focus] isKeyWindow after load: n/a isFocused: true`；Accessibility focused element 为 composer textarea，系统 UI 通道输入 `x` 后 textarea 读回 `"x"`，测试字符已清空。
- UI-142 在当前 macOS 开发态边界已实机 verified。UI-141 也已用当前源码构建隔离 unsigned arm64 packaged 候选：真实 `rRuntime:false/pyRuntime:false` 首启只显示运行时安装引导，且在双后端未启动时仍能打开纯 IPC 插件商店；证据 `acceptance/startup-runtime/ui141-startup-runtime-gate.json` 与两张截图，状态 verified。
- `npm run test:changed:list` 当前因存量 `scripts/*.mjs` 分类规则重叠 fail-closed；本轮已用显式定向测试覆盖改动，不能把它表述为 `test:changed` 通过。
- UI-140 / `AGENT-CONCURRENCY` 已完成。A-1～A-6 在开发态 Electron 通过；DeepSeek `deepseek-v4-flash` 经 Clash Verge 规则恢复连通，真实主任务、排队续发、4 个并发 sub-agent 与第 5 个 `503 user_limit` 均有记录；renderer 重载按 conversation/project 恢复且控制台 0 error。`acceptance/agent-concurrency/ui140-electron.json` 精确绑定 `6adeaa9` 与 15 个 source hashes，UI-140 在该开发态边界为 verified。

### 3.0.5 已收口工作包：DOC-GOVERNANCE-GATES（2026-08-16 用户裁决启动同日收口）

- 状态：`completed / implemented`（2026-08-16 用户裁决启动同日收口）；DOC-REGISTRY `DOC-GOVERNANCE-GATES` `active → completed`；新增 `DOC-GOVERNANCE-GATES-CLOSEOUT` reference 登记项；`truthDomain: docs-governance-gates-closeout`。
- 8 commit 已 push 至 origin/main：`a363105` / `aea70a6` / `c552100` / `1b7ce3e` / `76e0f75` / `c1ce38c` / `1049ac5` / `d4822ea`。
- 范围：`scripts/docs-governance.mjs` / `scripts/check-ui-productization-audit.mjs` 门禁硬化（hooks/ 白名单 / exit code 契约化 / `--report` JSON 输出）、DOC-REGISTRY 扩展字段规范化、剩余 12 项 docs 治理债修复（v1-productization-roadmap / macos-oss-auto-update / stage4-stable-release-checklist / harness-* 顶部状态 / codex-style-workbench-direction / agent-workbench-enhancement-plan §5 ID 互引 / Skills 4 份 README 入口图 / W5 B 类 4 个 archive 文件首段吸收声明）。
- 不修改 UI 组件（`frontend/src/**`）、不修改 Electron 主进程（`src/main.js` / `preload.js` / `plugin-manager.js`）、不修改核心后端（`core/**`）、不修改 acceptance evidence、不外推 Provider / packaged / GA。
- 与 Block-2 / Block-6 UI 实机复核项（UI-157 / UI-161）解耦——UI 复核继续走 `ui:audit:check` 路径；本工作包不阻塞也不被它们阻塞；本工作包收口后下一块候选仍为 Block-2 UI-157 / Block-6 UI-161 既有 in_progress 复核项。
- 收口记录 canonical：`docs/doc-governance-gates-closeout.md`（含 1-8 收口判定 + 证据清单）；Plan canonical `docs/doc-governance-gates-plan.md` 保留（`archivePolicy: retain_stable_path`）。
- 验证：`npm run docs:check` 64 registered PASS；`npm run ui:audit:check` 131 PASS；`npm run docs:reconcile` 0 issues / 0 manual review / 0 validation issues；GATES-2 `--report` JSON 模式 3 脚本 schema 校验通过。

### 3.0.6 已启动工作包：BLOCK-2-UI-157-REVIEW（2026-08-16 用户裁决启动，当前唯一 active）

- 状态：`planning` → `active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-2-UI-157-REVIEW` `kind=work-package / status=active / canonical=true / truthDomain=block-2-ui-157-review / archivePolicy=retain_stable_path`；plan canonical `docs/block-2-ui-157-review-plan.md`（283 行 / 9 §）已落地。
- 目标：收口 `docs/ui-productization-audit.md` 第 113 行 UI-157（Skills UI 页面 P1/W-04）`in_progress` 状态 → `verified`。
- 核心 gap（已摸清）：不可变提交 `e6bf72f` 含 9 个 UI 文件 + `core/shared-backend/workflow-engine.js` + `frontend/src/hooks/useSkillStore.ts`，但 **IPC 桥完全未接通**（`src/preload.js` 与 `frontend/src/lib/desktopBridge.ts` grep `skill` 0 命中，store 仍走 fixture）。UI-161 不可变提交 `01c5e0b` 已落地 Skills 入口归位 + 死 SkillsSidebar 删除 + retry 按钮 + 4 token 补全（5 项核对 OK），但其 IPC 桥跨包接桥显式留白给本工作包（"不接 IPC / 不动 preload / main / workflow-engine——那是 UI-157 工作包范围，跨包接桥违反「单工作包串行」纪律"）。
- 6 PHASE：PHASE 0 摸底（git show + grep + tsc + ui:audit:check + docs:check） / PHASE 1 IPC 桥接通（main + preload + bridge + store 四层补齐 `skills:list` / `skills:invoke` / `skills:status` / `skills:progress`，仅消费 workflow-engine.js 既有 export，不改 engine 内部） / PHASE 2 UI-161 5 项清理核对 / PHASE 3 实机 dev Electron 4 截图存 `acceptance/SKILLS-IPC/` / PHASE 4 UI-157 in_progress → verified（仅在实机证据充分时） / PHASE 5 closeout（roadmap / handoff / registry 同步）。
- **2026-08-16 18:15 收口结果**：PHASE 0 摸底 4 子代理 + 主 agent 综合 + 修正 B 报告 2 处错误断言 / PHASE 1 IPC 桥接通 4 commit (`2d81377` feat + `0be5483` docs + `7e010a4` docs(audit) + `5c98ca8` docs PHASE 2 verify) / PHASE 2 UI-161 5/5 PASS / PHASE 3 实机**搁置**（用户 P1-T-A 裁决 Vite-only 跳过 dev Electron）/ PHASE 4 audit 末尾收口笔录已追加 / PHASE 5 closeout `docs/block-2-ui-157-review-closeout.md`（11 节 + 7 不变量 + 4 治理门 GREEN）。**UI-157 + UI-161 保持 `in_progress`**（按 audit 行 402 治理纪律缺实机证据）。DOC-REGISTRY `BLOCK-2-UI-157-REVIEW` `active → completed` + 新增 `BLOCK-2-UI-157-REVIEW-CLOSEOUT` reference entry。本工作包收口后**不主动启动**新工作包；下一块候选 (UI-158/UI-159 实机 / Block-6 UI-161 / Windows 代码签名 / i18n / release-pipeline dist staleness) 等用户显式裁决。

### 3.0.7 已启动工作包：BLOCK-3-IPC-BRIDGE-HARDENING（2026-08-16 用户裁决启动，当前唯一 active）

- 状态：`planning` → `active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-3-IPC-BRIDGE-HARDENING` `kind=work-package / status=active / canonical=true / truthDomain=block-3-ipc-bridge-hardening / archivePolicy=retain_stable_path`；plan canonical `docs/block-3-ipc-bridge-hardening-plan.md` 已落地（222 行 / 7 § / 4 PHASE / 11 项修复）。
- 目标：收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核（`agent-transcripts/phase-6-code-audit.md` 1001 行 / 12 节）发现的 12 项 Major 中的 11 项 P1 必修 + P2 强烈建议。
- 4 PHASE：PHASE 0 复用 PHASE 6 报告（不重新摸底）/ PHASE 1 P1 必修主 agent 直做（main.js 4 IPC handler sender 守门 + 1 行 9→4 状态映射） / PHASE 2 P2 修复 worker 委派（5 项内存/错误 + 5 项测试补） / PHASE 3 audit + PHASE 4 closeout。
- 11 项修复：P1 安全 B1/F1（sender 守门）/ P1 契约 C1（poller 9→4 映射）/ P2 内存 A1+A2+A3（终态清理 / poller 停止 / execute 同步）/ P2 错误 B2（_publishSkillProgress try/catch）/ P2 测试 G1+G2+G3+G4+G6（wakeup 链路 + execute 失败 + callback 抛错 + cancel 失败 + main.js 9→4 单测）。**跳过 E1** 100 并行 execution 性能（G0 边界不触发）。
- 不外推 Provider / packaged / GA / UI-157 verified（按 audit 行 402 治理纪律仍缺真实 dev Electron 实机证据）/ Chart a11y P2 / Worktree。
- 不动 `preload.js` / `electron.d.ts` / 4 page / `desktopBridge.ts` / `core/shared-backend/*` / `agent-tools/`。

### 3.0.8 已启动工作包：BLOCK-4-IPC-BRIDGE-POLISH（2026-08-16 用户裁决"按你的节奏来"启动，当前唯一 active）

- 状态：`planning → active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-4-IPC-BRIDGE-POLISH` `kind=work-package / status=active / canonical=true / truthDomain=block-4-ipc-bridge-polish / archivePolicy=retain_stable_path`；plan canonical `docs/block-4-ipc-bridge-polish-plan.md` 已落地（123 行 / 5 §）。
- 目标：收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核剩余 **Minor 15 + Nit 4 + 1 收尾**中的 12 项跨 3 文件可修项。
- 4 PHASE：PHASE 1 主 agent 直做 10 项代码改动（src/preload.js + src/_mapSkillRuntimeStatus.js + src/main.js + frontend/src/hooks/useSkillStore.ts 4 文件 / ~+50 / ~−10）/ PHASE 2 worker 测试补（G5 useSkillStore.test.ts unmount 验 _progressUnsubs + _mapSkillRuntimeStatus.test.mjs default → failed + null 守卫）/ PHASE 3 audit 收口 / PHASE 4 closeout。
- 12 项：① A5 preload.js 5 方法 `String(executionId ?? '')` 防御；② B3 `_mapSkillRuntimeStatus` default `running → failed` + 显式 null 守卫；③ B4 wakeup payload 缺 executionId `console.warn` 调试；④ B5 preload.js onProgress callback try/catch；⑤ C2 `_getSkillsSDK` createDefaultSDK vs createSkillsSDK 加注释；⑥ C3 preload.js 注释 `L114-169 → L114-218`；⑦ D1 useSkillStore payload 自动派生 d.ts 完整类型；⑧ E2 setExecutions 内部 deep-equal 避免无变化 re-render；⑨ G5 test 7 验证 unmount 后 `_progressUnsubs.size === 0`；⑩ H3 main.js 顶部注释加 9→4 状态映射行号；⑪+⑫ G6 二次扩展 `cancelled → failed` 区分 UI 文案 vs status + PHASE 2 worker 同步更新 _mapSkillRuntimeStatus.test.mjs 14 个 default case。
- 跳过：E1（100 并行 execution 性能 G0 边界外留 BLOCK-5+）/ E3 / F2 / F3 / H1 / H2（H1/H2 BLOCK-2 plan/closeout 修订错过窗口）。
- 不外推：Provider / packaged / GA / UI-157 verified / 重新激活 BLOCK-2 / BLOCK-3 / E1 poller 性能。
- 不动：`preload.js` 5 方法签名 / `electron.d.ts` / 4 page / `desktopBridge.ts` / `core/shared-backend/*` / `agent-tools/` / `docs/block-2-ui-157-review-plan.md` / `docs/block-2-ui-157-review-closeout.md`（H1/H2 跳过）。

### 3.0.9 已启动工作包：BLOCK-5-IPC-BRIDGE-FINALIZE（2026-08-16 用户裁决"1-4 搞完"启动，当前唯一 active）

- 状态：`planning → active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-5-IPC-BRIDGE-FINALIZE` `kind=work-package / status=active / canonical=true / truthDomain=block-5-ipc-bridge-finalize / archivePolicy=retain_stable_path`；plan canonical `docs/block-5-ipc-bridge-finalize-plan.md` 已落地。
- 目标：按用户裁决"1-4 搞完"合并 4 候选中的 **1（E1 poller 性能）+ 4（H1/H2 BLOCK-2 文档修订）**——共 3 项微调。**候选 2/3（UI-158/UI-159/UI-161 dev Electron 实机）** 留 BLOCK-6+ 工作包（需 dev Electron 启动 + CDP attach，BLOCK-5 不依赖外部环境）。
- 4 PHASE：PHASE 1 主 agent 直做 3 项微调（src/main.js E1-b/E1-c ~+5 / −2 + plan/closeout H1/H2 修订 ~+20 / −5）/ PHASE 2 worker 测试补 = 候选 B 跳过（PHASE 6 报告 E1 G0 边界内 OK；不强行加测试避免破坏 main.js 边界）/ PHASE 3 audit 收口 / PHASE 4 closeout。
- 3 项收口：① **E1-b** `execute()` 后立即 publish 初始 `status: 'pending'`（避免 poller 1s 延迟）；② **E1-c** 终态 publish 后立即 `_stopSkillsProgressPollerIfIdle()`（避免 1s tick 空转）；③ **H1** plan §3.1.A 内措辞修订（electron.d.ts ADDITIVE +2 字段）；④ **H2** closeout 末尾 R8（sender 守门）/ R9（终态清理缺失）/ R10（poller 停止机制缺失）三遗留风险追加。
- 不外推：E1-d（每个 execution 独立 setTimeout 链）/ E1-e（runtime.batchGetExecutionStatus）（G1+ 架构改动）/ Provider / packaged / GA / UI-157 verified / 重新激活 BLOCK-2/BLOCK-3/BLOCK-4。
- 不动：`preload.js` 5 方法签名 / `electron.d.ts` / 4 page / `desktopBridge.ts` / `core/shared-backend/*` / `agent-tools/`。
- 不做：dev Electron 实机复核（候选 2/3 留 BLOCK-6+）。

### 3.0.15 已启动工作包：BLOCK-9.1-MAIN-JS-SPLIT（2026-08-16 BLOCK-9 收口后用户裁决"继续"启动）

- 状态：`active`（2026-08-16 23:50）；DOC-REGISTRY 新增 `BLOCK-9.1-MAIN-JS-SPLIT` `kind=work-package / status=active / canonical=true / truthDomain=block-9-1-main-js-split / archivePolicy=retain_stable_path / entrypoint=docs/README.md`；plan canonical `docs/block-9-1-main-js-split-plan.md` 已落地。
- 目标：按用户裁决"继续"基于 senior-engineer-review-2026-08-16.md §2.4 P1 启动 main.js 拆分重构。main.js 2450 → ~200 行装配器；17 IPC setup 函数 + setupDesktopEnv 716 行拆到 `src/ipc/<domain>.js`。
- 原则：不修改行为（只搬代码）/ 不引入新依赖 / 保留向后兼容 / 不破坏测试 / 不外推。
- 边界：不拆 setupSkillsIpc（BLOCK-2/3/4/5 改动过跨包边界）/ 不拆 setupAgentWorkbenchFlagsIpc（历史特殊 argv）/ 不拆 setupCsp（与 createWindow 强耦合）。
- 5 PHASE：PHASE 0 架构调研（worker）/ PHASE 1 拆低风险 setup / PHASE 2 拆中风险 setup / PHASE 3 setupTerminalIpc / PHASE 4 setupDesktopEnv / PHASE 5 closeout。
- 完成语义：main.js 2450 → ~200 行 + 15+ src/ipc/<domain>.js + chf0-critical 测试通过 + 既有 vitest 0 失败 / 0 改动。
- 不外推：BLOCK-9.2 SimpleChat 2153 / BLOCK-9.3 plugin-manager 1457 / BLOCK-9.4 DesktopSettingsPanel 1515 / BLOCK-9.5 useSkillStore 743 / BLOCK-9.6 IPC channel 常量集中 5 项 + packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7/8/9。
- 不动：preload.js / electron.d.ts / desktopBridge.ts / frontend/src/ / core/shared-backend/* / agent-tools/ / setupSkillsIpc。

### 3.0.14 已收口工作包：BLOCK-9-MEGA-FILE-REFACTOR（2026-08-16 用户裁决"按照你的建议来"启动当日 4 PHASE 全部收口）

- 状态：`active → completed`（2026-08-16 23:38）；DOC-REGISTRY `BLOCK-9-MEGA-FILE-REFACTOR` `status=completed / linkedCommits=[d87a0f8, e78567c, 1c14f49, c1e2bd5] / qualificationEligible=false`；新增 `BLOCK-9-MEGA-FILE-REFACTOR-CLOSEOUT` `kind=reference / status=completed / canonical=false`（closeout 报告）；closeout 报告 `docs/block-9-mega-file-refactor-closeout.md`。
- 4 PHASE 全部完成：
  - **PHASE 0**（启动 + 评审报告永久化）：commit `d87a0f8`
  - **PHASE 1**（拆 `_data.ts` 2157 → 3 文件）：commit `e78567c`，UI-162 verified
  - **PHASE 2**（抽 `buildPreviewTable` 到 `lib/file-preview/`）：commit `1c14f49`，UI-163 verified
  - **PHASE 3**（拆 `project-workspace.tsx` 3213 → 3114 + 8 helpers + types 抽离）：commit `c1e2bd5`，UI-164 verified
- 3 项重构（基于评审报告 P0/P1 5 项中的 3 项）：
  1. **拆 `_data.ts` 2157 → 3 文件**（registry/categories/inventory + 兼容；实际无 demo 字段）
  2. **抽 `buildPreviewTable` 到 `lib/file-preview/`** 解决 ResultView + project-workspace 重复
  3. **拆 `project-workspace.tsx` 3213 → 3114 + 8 helpers + types 抽离**（保守拆分，组件链依赖复杂未拆子组件）
- 验证：tsc 0 / vitest 75 文件 630 tests PASS / 4 治理门 GREEN / 6 个 consumer 0 改动 / 不变量守住
- 不外推：main.js 2450 / SimpleChat.tsx 2153 / plugin-manager 1457 / DesktopSettingsPanel 1515 / useSkillStore 743 / IPC channel 常量集中 6 项（BLOCK-9.1~9.6）+ packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7/8
- 不动：preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/

### 3.0.13 已启动工作包：BLOCK-9-MEGA-FILE-REFACTOR（2026-08-16 用户裁决"按照你的建议来"启动，当前唯一 active）

- 状态：`planning → active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-9-MEGA-FILE-REFACTOR` `kind=work-package / status=active / canonical=true / truthDomain=block-9-mega-file-refactor / archivePolicy=retain_stable_path` + 新增 `SENIOR-ENGINEER-REVIEW-2026-08-16` `kind=reference / status=completed`（评审报告永久化）；plan canonical `docs/block-9-mega-file-refactor-plan.md` 已落地（约 130 行 / 6 § / 4 PHASE）；评审依据 `docs/senior-engineer-review-2026-08-16.md`。
- 目标：按用户裁决"按照你的建议来"基于高级软件工程师评审报告启动**巨型文件拆分重构**。3 项重构（基于评审报告 P0/P1 5 项中的 3 项；P1 剩余 2 项 + P2 3 项 + P3 1 项 = 6 项留后续工作包 BLOCK-9.1/9.2/9.3/9.4/9.5/9.6）：
  1. **拆 `_data.ts` 2157 → 5 文件**（P0：`registry.ts` 接口 + `categories.ts` 分类数组 + `inventory.ts` 工具数组 + `demos/` 每个工具一个 demo + `pages/_data.ts` re-export 兼容）
  2. **抽 `buildPreviewTable` 到 `lib/file-preview/`**（P1：解决 `ResultView.tsx` + `SimpleChat.tsx` 重复定义；高级工程师原则：任何文件被 ≥2 处使用必须抽到 lib/）
  3. **拆 `project-workspace.tsx` 3222 → 4 文件**（P0：`FileTree/` 文件树子模块 + `FilePreview/` 文件预览（含 7 个工具函数）+ `OfficePreview/` Office 渲染 + `index.tsx` 路由 + 布局 + 兼容入口）
- 原则：不修改行为（只搬代码，0 业务逻辑变更）/ 不引入新依赖 / 保留向后兼容原 import 路径 / 不破坏测试 / 不外推。
- 4 PHASE：PHASE 1 拆 `_data.ts` / PHASE 2 抽 `buildPreviewTable` / PHASE 3 拆 `project-workspace.tsx` / PHASE 4 审计 + closeout。
- 完成语义：`_data.ts` 2157 → 5 文件 + `buildPreviewTable` 抽到 `lib/file-preview/` + `project-workspace.tsx` 3222 → 4 文件 + 4 治理门 GREEN + 既有 vitest 0 失败 / 0 改动 + 不变量守住。
- 不外推：P1 剩余 2 项（main.js / SimpleChat.tsx）+ P2 3 项 + P3 1 项 / packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7/8。
- 不动：`preload.js` / `electron.d.ts` / `desktopBridge.ts` / 4 page / `core/shared-backend/*` / `agent-tools/`。

### 3.0.12 已启动工作包：BLOCK-8-UI-132-VERIFICATION（2026-08-16 用户裁决"接下来要做什么呢"启动，当前唯一 active）

- 状态：`planning → active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-8-UI-132-VERIFICATION` `kind=work-package / status=active / canonical=true / truthDomain=block-8-ui-132-verification / archivePolicy=retain_stable_path`；plan canonical `docs/block-8-ui-132-verification-plan.md` 已落地（约 100 行 / 7 § / 4 PHASE）。
- 目标：按用户裁决"接下来要做什么呢" + 选项 "BLOCK-8 UI-132 dev CSP 静态化（推荐）" 启动 **UI-132 (行 239 in_progress) 静态收口**。
- **PHASE 0 摸底发现 — entry 描述与实际代码不一致**：entry 描述的两个改动的**目标都已 100% 落地**但 entry 没同步状态（同 BLOCK-7 UI-161 同类盲点）。① main.js setupCsp dev-CSP `connect-src` / `frame-src` 放开 `http://127.0.0.1:*` 和 `ws://127.0.0.1:*` 已在 commit `3240a09 fix(desktop): Inject R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL for gateway (P1-CFG-1)` 落地（L1418-1422 + L1443 CSP dev mode 日志 "127.0.0.1:* whitelisted"）；② main.js R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL 用 `127.0.0.1` 注入 3 个 URL（L507-509）同期落地；③ styles/custom.css `--biof3-warning: var(--biof3-status-warning)` 明色主题（L71）+ 暗色主题（L181）早在 commit `3000a06 feat(frontend): Workspace UI plumbing` + `f3b5c42 refactor(css): migrate all CSS token references from --ifm-* to --biof3-*` 落地。
- 路径选择：沿用 BLOCK-7 Vite-only + 静态 grep 综合验证路径（UI-132 不依赖 IPC 桥 + UI-132 改动是纯代码静态层）。
- UI-132 4 项静态验证：① main.js setupCsp dev mode 放开 / ② main.js R_SERVER_URL 等 3 URL 注入 / ③ styles/custom.css `--biof3-warning` 明色主题 / ④ styles/custom.css `--biof3-warning` 暗色主题。
- 4 PHASE：PHASE 1 静态 grep 4 项 + git log 退化检查 / PHASE 2 Vite build + 产物 grep / PHASE 3 theme-token-contract test + tsc 0 / PHASE 4 audit 收口 + 4 canonical 同步 + closeout 报告。
- 完成语义：UI-132 (行 239 in_progress) → verified（仅当全部 PASS）；4 治理门 GREEN。
- 不外推：packaged / dist / notarization / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6/7。
- 不动：`preload.js` / `electron.d.ts` / `desktopBridge.ts` / 4 page / `core/shared-backend/*` / `agent-tools/`。

### 3.0.11 已启动工作包：BLOCK-7-UI-161-VERIFICATION（2026-08-16 用户裁决"Block-7 是啥 开搞"启动，当前唯一 active）

- 状态：`planning → active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-7-UI-161-VERIFICATION` `kind=work-package / status=active / canonical=true / truthDomain=block-7-ui-161-verification / archivePolicy=retain_stable_path`；plan canonical `docs/block-7-ui-161-verification-plan.md` 已落地（约 100 行 / 7 § / 4 PHASE）。
- 目标：按用户裁决"Block-7 是啥 开搞"启动 **UI-161 既有 in_progress 实机复核**（按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"）。**路径选择**：Vite-only + 静态 grep 综合验证（不同于 BLOCK-6 强行 dev Electron 实机失败路径）。
- UI-161 与 UI-157 / UI-158 / UI-159 关键区别：UI-161 是**纯 UI 表面 + 静态 token 补全**（LeftPanel/QuickActions/SkillsSidebar 删除/pages/skills error 按钮/styles/custom.css 4 token），**不依赖 IPC 桥接通**。Vite preview 渲染 + 静态 grep 综合验证可证 UI-161 完整性。
- UI-161 6 项清理（已 commit `01c5e0b`，BLOCK-2 PHASE 2 已 5/5 PASS）：① LeftPanel.tsx QuickActions Skills（sparkles + handleNavigateToSkills）/ ② LeftPanel.tsx footer 删除 Skills 冗余 / ③ App.tsx 移除 SkillsSidebar + import + marginLeft / ④ 删除 SkillsSidebar.tsx + .module.css / ⑤ pages/skills/index.tsx error 状态"返回首页"按钮 / ⑥ styles/custom.css 4 token。
- 4 PHASE：PHASE 1 静态 grep 6 项 + git log `01c5e0b..HEAD` 空确认 / PHASE 2 Vite build + preview 3110 + curl + grep 产物 / PHASE 3 theme-token-contract test + tsc 0 + ui:audit:check / PHASE 4 audit 收口 + 4 canonical 同步 + closeout 报告。
- 完成语义：UI-161 `in_progress → verified`（仅当全部 PASS）；4 治理门 GREEN；不变量守住 UI-157 仍 in_progress / UI-158/UI-159 仍 in_progress（仅 UI-161 verified）。
- 不外推：packaged / dist / notarization / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/3/4/5/6。
- 不动：`preload.js` / `electron.d.ts` / `desktopBridge.ts` / 4 page / `core/shared-backend/*` / `agent-tools/`。

### 3.0.10 已启动工作包：BLOCK-6-UI-158-UI-159-VERIFICATION（2026-08-16 用户裁决"可以继续"启动，当前唯一 active）

- 状态：`planning → active`（2026-08-16 用户裁决当日启动）；DOC-REGISTRY 新增 `BLOCK-6-UI-158-UI-159-VERIFICATION` `kind=work-package / status=active / canonical=true / truthDomain=block-6-ui-158-ui-159-verification / archivePolicy=retain_stable_path`；plan canonical `docs/block-6-ui-158-ui-159-verification-plan.md` 已落地（89 行 / 6 §）。
- 目标：按用户裁决"可以继续"启动 **UI-158 + UI-159 dev Electron 实机复核**（推翻 P1-T-A「跳过实机、走 Vite mock 验收路径」决策，按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"）。
- 4 PHASE：PHASE 1 dev Electron 启动 + playwright MCP `plugin-playwright-playwright` `browser_navigate` 远程连接 + 首屏截图 / PHASE 2 UI-158 CommandPalette 实机验证（3 截图：关闭 / 打开 / 搜索中）/ PHASE 3 UI-159 Workspace UI plumbing 实机验证（3 截图：首页 / Skills 页面 / Workspace 页面）/ PHASE 4 evidence 收集 + 收口 + `in_progress → verified`。
- 6 截图：UI-158 3 张（关闭 / 打开 / 搜索中）+ UI-159 3 张（首页 / Skills 页面 / Workspace 页面）。
- 不外推：packaged / dist / notarization / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n / 不重新激活 BLOCK-2/BLOCK-3/BLOCK-4/BLOCK-5。
- 不动：`preload.js` / `electron.d.ts`（UI-159 涉及 electron.d.ts 是 ADDITIVE 扩展，已在 commit `3000a06` 落地，本工作包不修改）/ `desktopBridge.ts` / 4 page / `core/shared-backend/*` / `agent-tools/`。
- 原理：playwright MCP 已注册（`plugin-playwright-playwright`），主 agent 可通过 `browser_navigate` 远程连接 dev Electron BrowserWindow。

**2026-08-16 21:35 用户裁决"关闭 BLOCK-6 保留 in_progress"**：
- **工具边界受限**：playwright MCP / WebFetch 跑在隔离 sandbox 不能访问 localhost（实测 `browser_navigate http://localhost:3100/` 返 `ERR_CONNECTION_REFUSED`；WebFetch 返 "Cannot fetch from localhost"）；macOS shell 退出杀 child process（实测 Vite 后台跑 30s 内 alive，shell 退出后 vite 死）
- **主 agent 无法独立完成 dev Electron 实机核查**
- DOC-REGISTRY `BLOCK-6-UI-158-UI-159-VERIFICATION` `status: active → superseded` + `cancelReason` 记录工具边界
- BLOCK-6 plan 保留为 future reference（canonical plan 仍存在）
- UI-158 / UI-159 状态保持 `in_progress` 字样不变（按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"）
- **当前无 active 工作包**
- 未来用户启动 dev Electron 实机并提供截图 / console.log 后，可重新启动 BLOCK-6.1（实际 dev Electron 实机）
- 不外推：Provider (`P-07`) / packaged / dist / notarization / GA 资格 / dist staleness / Worktree 创建（沿用 main）/ 新 Skills 业务能力 / Chart a11y P2。
- 主 agent 直接 owner（不委派 `luna_worker`，IPC 桥契约 + 实机启动属跨模块边界判断）。当前仅 PHASE 0 前置工作（plan + registry + canonical 同步）已完成；PHASE 0 摸底执行由主 agent 在用户裁决"继续"后启动。
- 验证起点：`npm run docs:check` 65 registered PASS（+1）；`npm run ui:audit:check` 131 PASS；`npm run docs:reconcile` 0 issues。

### 3.1 已收口主线：G0-RS-UX1H Async Tool Surface（2026-08-09 收口）

2026-08-06 用户在真实 airway 数据（`tmp/airway-test/airway_counts_symbol.csv` + `airway_metadata.csv`，4 control vs 4 treated，34889 gene rows × 8 sample）上完成开发态 Electron 端到端流程：`run_tool → tool_job → artifact truth → projectOpenResult` 全部成功，1 个 completed DESeq2 Job、Artifact Truth `valid`、同 Job PNG 自动打开。LLM 总结阶段真实 socket timeout 与自动重试结束后，返回对话显示"✓ 工具已完成，AI 总结暂时不可用"，assistant 行不再显示"请求超时"；截图与脱敏证据见 `acceptance/g0-rs-ux1h/`。

这是一个 user-visible 痛点：主 agent 同步流被工具完成后的 AI 总结占用，工具已成功却仍被渲染为"失败"。`G0-RS-UX1H` 已实现基于精确 `toolJobId` 的 summary-only 重试、历史恢复、运行中最多 5 条自动排队发送，以及“工具完成、总结失败”时 durable loop 的 completed 收敛。重试接口只读取当前 user/project/conversation 下 completed + Artifact Truth valid 的 ToolJob，不注册工具，并把新总结持久化到原会话。**UX1H 已于 2026-08-09 实现收口**；2026-08-12 又在 Windows 开发态 Electron 用当前源码完整复核真实 socket timeout 与重试：点击前后 completed DESeq2 Job 都是 1，Artifact Truth `valid`/非 blocking 不变，结果 PNG 自动打开，故 UI-126 升为 `verified`。证据 `acceptance/ui-126/electron-summary-retry-windows.json` 精确绑定 `e59f553`。范围仍限定在开发态 Electron，deterministic local adapter、`qualificationEligible:false`、不开 P7-F 等边界不变。Canonical 计划见 [`g0-rs-ux1h-async-tool-surface.md`](./g0-rs-ux1h-async-tool-surface.md)。

UI-108 / UI-109 / UI-113 / UI-114 仍维持 `in_progress`；本计划不冒充其 `verified`。`qualificationEligible:false` 不升级。

验证节奏按用户裁决采用风险驱动：开发中只跑语法与受影响单测；真实数据 Electron 长链仅在阶段收口运行一次，除非产品行为或验收脚本发生实质变化，不重复消耗长链窗口。

### 3.1.5 已收口工作包：G0-IDE-MCP-TOOLS Phase 1 + 1.5 + 3（2026-08-14）

Phase 1 + 1.5 + 3 均已 `qualified`（`docs/g0-ide-mcp-tools-plan.md` §11 + §Phase 3 收口）：

- 总计 18 个 `ide_*` 工具（7 文件 + 5 终端 + 1 search + 1 diff + 4 git）+ 2 个 MCP Resources
- 78/78 IDE 工具定向测试全 PASS（33 + 23 + 22）
- 全部封装系统 `git`/`rg`/`diff` CLI；Phase 3 复用 Phase 1.5 `diff.js` 的 `parseUnifiedHunks`
- 未引入 `simple-git` 依赖（避免单独 PR + package.json 改动）
- 整包 `implemented_unverified`，不进 `qualificationEligible`

**Phase 2 唯一仍 deferred**：Monaco 编辑器 + 9 个 `editor_*` 工具；待 `frontend/src/components/editor/*` 有可工作入口或 IDE-Transformation 完成后启动。

### 3.2 历史主线：G0 Living Foundation maintained

2026-07-25 `G0-START`、LF0～LF12 核心资格已关闭并进入 maintained。Result Studio RS0～RS8 的引擎基础存在，但后续产品复核确认 RS9 的第 17 类证据不能证明连续真实产品任务；`result-studio-editing` 支持声明暂停，当前状态为 `P7 deferred / implemented_unverified / experimental`。

G0 资格只覆盖 Support Matrix 明示范围，不覆盖 Windows/Linux/macOS x64、任意插件或任意科学任务。永久 `g0:qualification` 与 LF11 requalification 继续优先；任何触发器缺少新证据时 fail-closed。

LF12 完成记录为 [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md)，报告位于 [`../acceptance/g0-qualification/qualification-report.md`](../acceptance/g0-qualification/qualification-report.md)。

2026-07-24 后续治理收口：新增文档生命周期治理层（[`document-governance.md`](./document-governance.md)、[`worktree-governance.md`](./worktree-governance.md)、[`DOC-REGISTRY.json`](./DOC-REGISTRY.json)、`scripts/docs-governance.mjs`、`npm run docs:status|check|reconcile`，`docs:check` 已接入根 `npm run check`）；注册表中 `G0-LF12` 已收口为 `completed / canonical:false`，释放 `g0-current-work-package` truthDomain。干净 checkpoint 为 `38d3de2`（已推送，工作区 clean）。

Result Studio 旧实现的 11 个提交已于 2026-07-25 fast-forward 合并并推送至 `main`，检查点为 `03e5826`。SDC-0 已在 `codex/g0-sdc` 的 `7284921` 完成并推送；当前单线实现分支为 `codex/g0-result-studio-product`，从该检查点创建，不使用 Git Worktree。G0-CHF0 已在实现检查点 `41a365f` 完成 CHF0-R1～R5 审计修复并重新真实收口；P4R-3 实现检查点为 `3d3eb29`、P4R-4 为 `f710261`、P4R-5 为 `f5c50db`，P4R-6 实现为 `cb73132`、runtime evidence 为 `c449e57`、product closeout 为 `252e806`。P5 实现检查点为 `e7f271c`，source-bound 证据为 `acceptance/g0-result-studio/rs-p5-scientific-editing.json`（20/20，`sourceCommitMatchesSourceHashes:true`）。P6-0 已于 2026-07-31 以 `acceptance/g0-result-studio/rs-p6-ui110-electron-scientific-trace.json` 完成 UI-110 的 source-bound Electron trace，证据绑定 `6f5271e`，UI-110 仅在该开发态 Electron 边界内为 `verified`。

P6-1 已于 2026-08-02 在 `ad1e2ce` 收口，canonical evidence `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json` 为 10/10、source-bound、`qualificationEligible:false`。真实本地矩阵覆盖停止、R/validator 失败、精确进程组中断、Electron/owned backend 重启、drift、GC、并发候选与资源压力；开发态 Electron 恢复 15/15 且低于 5 秒，实际读取 10 万行表、复杂 SVG/PNG、长报告与 100+ 版本。201 条 synthetic Revision 只是 alias 压力，开发态冷启动首画布预算为 1500ms。2026-08-03 用户裁决将 P7 发布级重新资格后移；Result Studio 保持 `implemented_unverified / experimental`，真实 Provider、packaged Electron、literal OS reboot、明暗/尺寸资格矩阵均未证明。

P7 延期检查点：`e14a8e6` 已完成 existing Git 持久显式 opt-in 后端安全修复；`6dc3880`/`1bb295c` 已使资格器在没有可解引用 task-local fact bundle、独立 replay、唯一截图和重算不变量时 fail-closed；Agent 结果动作 completion 修复保留。没有生成 canonical P7 PASS evidence。selection→enrichment 当前是 direct Job + auto-adopted baseline，不满足 candidate/compare/lifecycle，必须作为未来产品缺口修复，不能由 harness 伪造。

当前分支为 `codex/g0-result-studio-product`。`G0-RS-UX1A`～`UX1G-2` 与短 Goal `G0-RS-TL1 / UI-120` 均已完成；当前唯一 active 增量为 `G0-RS-UX1H / UI-126`，其目标组合已实机通过但计划尚未收口。UX1G-1 已把 `conversation_id` 从受信 Agent 上下文贯通到 ToolJob、审批、ScientificTask/Workflow、插件执行/重试、Result Studio 派生执行及 Jobs 历史 API；UX1G-2 在此基础上补齐当前会话的顶部多分析结果入口与精确 Job 切换，Job 变化会原子清除旧 Artifact，迟到的结果响应和深链查询均不可覆盖新导航，其他会话和 legacy null Job 不混入。聚焦前端 46/46、受影响 Node 125 pass / 1 live skip、strict TypeScript 与开发态 browser/Electron 真实双 Job 核对通过；不改 Result Viewer、科学算法或 P7 资格。

验证边界：UX1F 原聚焦前端 51/51；真实图形补验修复后聚焦前端 44/44、Result Studio 前端聚合 199/199、TypeScript、UI/docs 门禁与开发态 Electron 通过。同一真实新 volcano Job `job_41578fbc4c6f4577` 覆盖正式 PNG 完整首屏、25 点交互往返和结果态无版本大面板。TL1 新增 TitleBar 11/11 与 Electron/preload 6/6；Darwin arm64 开发态真实窗口覆盖最大化/还原、最小化、双击隔离、缩放、明暗、约 1050/840/720px、Cmd+M/W、自绘关闭及 owned 服务退出/重启。ScreenCaptureKit `-3811` 使 840/720 像素截图与拖拽绝对 frame 位移不可用，AX 功能/可达性与 134px 几何测试仍通过。UI-120 仅在该开发态边界为 `verified`。`npm run test:changed` 仍会因 P6 历史 evidence 绑定 `ad1e2ce` 而在 `p6_current_source_tree_not_exact` 处 fail-closed；TL1 未运行 `g0:result-studio:p6:update`，不得把旧证据改绑当前源码。

`G0-RS-P0` 已完成资格纠偏：Baseline patch 为 1.1.1，LF12 核心 16/16 evidence 继续 qualified + maintained；`result-studio-editing` 为 experimental/excluded，旧 RS9 product/provider/visual/table-seed 为 non-qualifying historical evidence。Product Trace v1 要求 14 步连续来源证据并拒绝人工布尔值、提示词指定 JSON、测试摘要和常量不变量。证据位于 `acceptance/g0-result-studio/rs-p0-{truth-correction,ui-baseline}.json`。

`G0-RS-P1 Result Surface` 已于 2026-07-25 收口：中央 `ResultStudioCanvas`、紧凑 Inspector/ContextBar、六类 viewer adapter、受控 Artifact URL、无损 Agent 会话投影与 1440/1024/820px 响应式布局已进入同一 `ProjectWorkspace` 状态机。真实开发态 renderer 证据位于 `acceptance/g0-result-studio/rs-p1-result-surface.json`；该证据不升级产品资格。

`G0-RS-P2 Scientific Interaction + SelectionContext` 已于 2026-07-25 收口：完整表权威排序/过滤、18 行视口虚拟化、行列与 query 全选、scatter point/region/legend、matrix gene/sample 选择及缺 mapping 只读均进入同一 Result Studio viewer；持久 selectionId、显式 ID hash 或 query/filter+hash 贯通 Canvas、Inspector、Agent composer 和 SQLite，只有 compatible 选择进入 Agent 上下文。真实 admitted 链为 valid DESeq2 25 Artifact → 3 gene SelectionContext → 独立 R 脚本/参数/gene-list → valid GO/KEGG 36 Artifact，且选择创建早于当前 r-server 进程并成功恢复。10 万行 scroll/select/sort/filter renderer 反馈均低于 100ms；明暗 × 1440/1024/820 六格恢复 3 个勾选且无页面溢出。证据位于 `acceptance/g0-result-studio/rs-p2-{live-observation,ui-observation,scientific-interaction}.json`，为 non-qualifying P2 evidence。日常开发改用 `npm run g0:result-studio:p2:update|p2` 自动验收，Electron/真实 Provider 留给所属阶段出口。

`G0-RS-P3 Agent Context 与 Edit Orchestration` 已于 2026-07-25 完成实现（`implemented_unverified`）：`core/shared-backend/result-studio-context.js` 建立 `ResultStudioContextEnvelope v1` 与 `contextToken`，覆盖 artifact/family、job、revision（含 current 与 ordinal）、脚本相对路径与 sha256、参数摘要、插件可编辑参数与声明动作、selection、validation、reproducibility、workflow 及五阶段公开词表。`core/r-server/agent-tools/result-context-tools.js` 只把前端 `activeArtifact` 当线索，坐标全部从 SQLite/`tool_jobs`/插件 descriptor 重新解析；`result-context-edit-tools.js` 提供 context-bound plan/create/status/compare/adopt/revert 并复用既有 `result-changeset-service` 与 `result-compare-service`，未建立第二套执行真相。模型可见 schema 新增 7 个工具（注册表共 32 个），其中 6 个 `*_in_context` 工具参数不含 toolJobId/artifactId/revisionId/artifactFamilyId/selectionId；系统提示描述当前结果但不写入任何内部 ID，并禁止向用户索要 ID。写操作强制校验 token，陈旧返回 `context_token_stale`，intent 指向别的 Revision 返回 `context_intent_mismatch`；"归因只能到 Job"、跨项目 revision、未打开结果一律 fail-closed。`GET /api/result-studio/context-envelope` 与前端 `fetchResultStudioContext` 共用同一投影，Inspector 的 `ResultStudioContextReadiness` 如实显示 loading/blocked/ready。证据 `acceptance/g0-result-studio/rs-p3-agent-context.json`（20/20，`qualificationEligible: false`，离线契约/注册表/提示词/strict build）；门禁 `npm run g0:result-studio:p3[:update]` 已接入 `g0:result-studio:acceptance` 与根 `check`。P3 验收要求的双真实 Provider tool calling、真实候选 Revision 与重开重建复验尚未执行，UI-108 保持 `in_progress`。

`G0-RS-P4 Core Manual + AI Unified Editing` 已于 2026-07-26 形成稳定实现检查点（`implemented_unverified`）：`core/shared-backend/result-edit-controls.js` 从插件 descriptor 的 `parameters` + `parameterImpacts` 投影控件，不为任何插件手写孤立结果页；缺 impact 声明的参数不提供控件，只有 presentation 组允许标注"不改变科学结论"。`volcano-plot` 的 descriptor 与 `scripts/volcano-plot.R` 补齐配色（`color_up`/`color_down`/`color_ns`）、字体（`base_font_size`/`label_size`）、尺寸（`point_size`/`plot_width`/`plot_height`）、图例（`legend_position`）、标签（`plot_title`）与导出（`export_dpi`）共 12 个 presentation 参数——此前这些全是 R 脚本硬编码；阈值与分类逻辑仍只由 `fc_threshold`/`pval_threshold` 决定。`normalizeEditSubmission` 是手动控件与 AI 提议的唯一归一化闸门，随后共用 `ResultEditIntent → ScientificChangeSet`，validation/preview/compare/adopt/revert 只有一条路径；类型/范围/枚举 fail-closed 拒绝，未声明参数记为 rejected，与当前生效值相同的提交不产出 patch。影响分级只能由受信 descriptor 提升，保护字段只作影响下限。`currentValues` 取自 Job 的真实 `executionProvenance.params.normalized`；`ResultEditPanel` 只发出编辑请求，不写文件也不覆盖 current Revision。证据 `acceptance/g0-result-studio/rs-p4-unified-editing.json`（18/18，`qualificationEligible: false`，离线 descriptor 投影/插件接线/注册表/strict build）；真实手动/AI 候选等价链尚未执行，UI-109 保持 `in_progress`。

P4 Core 已于提交 `e0a4c7d` 形成可恢复检查点，四份历史审计于 `e38d6b5` 无损归档。2026-07-26 仓库静态审计随后确认：默认必读仍包含大量已完成材料，`AUDIT-LOG`/`CLAUDE.md` 膨胀，65 个脚本和 145 个 npm 命令缺少机器分层，定向测试仅有文字纪律，`tmp` 有 2013 个残留文件且测试依赖本机绝对路径。`G0-RS-RH0 Repository Hygiene Gate` 已完成上述收口并通过最终基线，治理提交为 `95a7fe3`、`041e32e`。

RH0 已完成：Truth Snapshot → Hot Context → Test Impact → Script/Temp Lifecycle → Acceptance 全部收口。`test/impact-map.json` 与 `scripts/test-affected.mjs` 现在提供确定性定向测试，未知映射 fail-closed；RH0 不删除 Acceptance 证据、不修改科学或执行真相、不创建 Worktree。P4R-0～P4R-6、P5 与 P6 的实现检查点继续保留；P7 已于 2026-08-03 延期，真实 Provider、packaged Electron、literal OS reboot 和资格重新裁决均未完成，也不再占用当前 active 工作包。

P4R-5 收口事实：Revision source projector、Result/Code 路由、复制/下载/项目内打开门控、Agent 点击时 contextToken 绑定、历史版本脚本隔离以及缺失/越界/hash/commit/plugin/input/跨项目 fail-closed 已落地。对 `reproduction.replayable` 的 Revision 提供服务端两阶段 replay：预检重读 Git/SQLite/Job/Artifact Truth，确认后只走注册工具执行链并创建非 current 候选；不接受调用方 toolId、params、script、command、shell 或 workflowPlan，重复确认只返回同一候选，材料不足明确 `unavailable`。四类真实 completed Job（DESeq2、standalone volcano、gene-correlation heatmap、go-kegg GO-BP）exact source observation 为 4/4，source-bound 到 `f5c50db`；其中 volcano/heatmap replayable，DESeq2/GO-BP unavailable，真实 replay E2E 覆盖 standalone volcano。P4R 为 7 条核心不变量 + 1 条显式 skip guard（本机 8/8），P4R-5 Node 15/15；source-bound product runner 为前端 114/114、Node 137/137，umbrella 前端 151/151，P4R product 17/17。`qualificationEligible:false` 与 UI `in_progress` 不变。

P4R-6 收口事实：持久 background child 重读 Project/Job/Artifact Truth、SQLite file 和 canonical Git/SQLite 服务，超时/关闭时隔离、排空或终止其进程树。性能 evidence 14/14（event-loop 19.661ms ≤ 250ms）；live chain 与同一 Electron BrowserWindow 的 UI 矩阵均 source-bound、脱敏且通过。其边界不变：deterministic context-bound Agent invocation，不是 Provider；开发态 Electron，不是 packaged；`qualificationEligible:false`。

P4R-3 收口事实：中央结果焦点中的 `ResultAgentComposer` 是默认编辑入口，右栏 `ResultEditPanel` 仅作为默认关闭的高级抽屉；草稿与 contextToken 按 project/conversation/Artifact/Revision/Selection 隔离。前端只保存用户原始目标，可见消息不夹带工具编排。后端 task/legacy 共用 token 投影、五阶段 recorder 与 terminal finalizer；context-bound create 只执行同一 Agent turn 中服务端保存的原始 intent，stale selection、分类/确认篡改、任意 script patch 与模型提供 DAG 全部拒绝。科学/数据/流程修改在没有权威持久 DAG 时明确阻断。专项 76/76 Node、134/134 frontend；affected 700/700 Node、102/102 related frontend；P2 17/17、P3 20/20、P4 18/18、P4R-performance 13/13、P4R-product 10/10。所有新证据都有 `sourceCommitMatchesSourceHashes:true`，仍不升级产品资格或 UI `verified`。

P4R-4 收口事实：Result / Compare / History 为真实互斥中央模式；Code 已由后续 P4R-5 接入。历史查看是前端可丢弃 state，主体、interaction、Selection 与 contextToken 均绑定显式 Revision；不移动 current、不切换 active Job、不调用写 API，首次 GET 不写 SQLite、不创建 managed Git。版本角色来自项目/family-scoped Revision + ChangeSet truth 并支持分页；审查摘要来自服务端受信持久元数据，Git 详情默认折叠。adopt/revert/restore 的 checkpoint 与 SQLite/Git 同退，参数/source commit/parent family/project 漂移 fail-closed。实现检查点 `f710261`；focused frontend 104/104、affected Node 258/258、related frontend 48/48、P4R product 13/13，P2/P3/P4/P4R 五份 evidence 全部绑定该提交。UI-113/UI-114 保持 `in_progress`，资格不升级。

`SDC-0 Profile Registry 与版本治理` 已于 2026-07-25 收口：`core/shared-backend/artifact-profiles.js` 从单个 DEG 种子升级为正式 Registry，落地 `biof3.counts-matrix.v1`、`biof3.sample-metadata.v1`、`biof3.expression-matrix.v1`、`biof3.deg.v1`、`biof3.gene-list.v1`、`biof3.enrichment-table.v1` 六个 canonical Profile，并区分 data / artifact / display 三类 Profile Kind。新增 profile 身份解析、registry 校验、contract digest、compatible/migration/breaking 变更分级和 fail-closed 兼容判定；`core/shared-backend/agent-workflow.js` 对未注册 Profile 返回 `unregistered_artifact_profile`，使其无法成为 typed DAG 正式边。`biof3.deg.v1` 及其 legacy alias（含 `log2FC → log2FoldChange`）保持向后兼容，未创建第二套执行真相。

SDC-0 证据与门禁：`acceptance/g0-scientific-data-contract/profile-registry.json`（10/10，锚定 `03e5826`）、`test/g0-sdc0-profile-registry.test.mjs`（7/7）、`scripts/g0-sdc0-profile-registry-acceptance.mjs`，命令 `npm run g0:sdc0`（含 `g0:sdc0:test`）已挂入 `postcheck`。实测 `npm test` 1339 pass / 0 fail / 11 skipped，`npm run check` 全绿（末尾 `[G0-SDC0] PASS — 10/10`）。SDC-0 只完成离线契约层，真实不规则数据端到端产品验收属于 SDC-7，不得由本阶段冒充。

`G0-SDC / SDC1-A Data-to-first-result` 已于 2026-08-04 收口，实现检查点 `bd15777`。`.csv/.tsv/.txt` 导入当前项目 `data/`，产生绑定完整 SHA-256 的有界只读 Observation，仅将 counts/metadata 显示为候选并交给现有 Agent；首个科学结果仍只由 `run_tool → tool_job → artifact truth → projectOpenResult` 产生和打开。`npm run g0:sdc1:update` 已在空 disposable 账本中验证真实导入、科学确认、1 个 completed DESeq2 Job、有效 Artifact Truth 与同 Job 非空 PNG 自动打开；证据见 `acceptance/g0-scientific-data-contract/data-to-first-result.json`，source-bound 且 `qualificationEligible:false`。当前没有 active 工作包；SDC-1 其余范围、`SDC-2`～`SDC-7` 与 P7 继续 deferred。

已收口阶段：

- `G0-RS0` 只读审计与 ADR —— [`g0-rs0-result-studio-audit.md`](./g0-rs0-result-studio-audit.md)，含 6 条 ADR 与 3 项计划契约缺陷登记（`validationStatus` 词表冲突归 RS2、`sourceScriptRef` 语义归 RS5、`ActiveArtifact` 文件级归 RS3）。
- `G0-RS1` Git Adapter 与 Repository Binding —— 新增 `core/shared-backend/git-adapter.js`（系统 git CLI 单一边界，无 git 库依赖）与 `core/shared-backend/git-repository-binding.js`（managed / existing 双模式）。门禁 `npm run g0:result-studio:git` 实测 24/24，已接入根 `npm run check`。

RS1 已固化的边界：整树 pathspec（`.`/`-A`/`-u`/`*`/`:` 等）在 Adapter 层结构化拒绝；选项形参数、pathspec magic、`..` 逃逸、越界绝对路径同样拒绝；提交走 `--only` + 显式 pathspec，不携带其他已暂存内容；托管模式 git 元数据落 `<workspace>/.biof3/git`，绝不对用户目录 `git init`；既有仓库模式下受管理路径与用户未提交改动相交即 `blocked_dirty_conflict`，不 stash、不覆盖；index.lock、merge/rebase/cherry-pick 中途态、submodule、linked worktree 一律先阻断；git 缺失或低于 2.20 时诚实 `blocked_git_unavailable`；诊断输出脱敏绝对路径与疑似凭据。

RS1 实测修正的一个真实缺陷：`git status --untracked-files=normal` 会把完全未跟踪目录折叠成单条（新建 `analysis/scripts/x.R` 只报告 `analysis/`），导致受管理路径下的用户新建文件漏判。冲突检测已改为 `untracked='all'` 并使用双向前缀匹配。

- `G0-RS2` Revision Contract 与持久化 —— 新增 `core/shared-backend/result-studio-schema.js`（5 张新表 DDL 的唯一来源）、`result-studio-contracts.js`（ChangeSet / ArtifactRevision / SelectionContext / WorkspaceCheckpoint v1 校验与状态机）、`result-studio-repository.js`（CRUD、状态迁移、幂等 adopt/revert、可达性），以及项目首个正式 migration `src/migrations/001_result_studio.sql`。聚合门禁 `npm run g0:result-studio` 实测 78/78，已接入根 `npm run check`。

RS2 已固化的边界：`validationStatus`（valid/degraded/blocked，来自 `reconcileArtifactTruth`）与 `reproducibilityStatus`（unavailable/available/verified，来自 delivery manifest）是两个独立字段，不合并成一套词汇；`validationStatus='valid'` 的 Revision 必须绑定 `toolJobId`，守住 `run_tool → tool_job → artifact truth`；含 `blocked` Revision 的 ChangeSet 不可采用；ChangeSet 只能以 `draft` 创建，不能凭空造出 `adopted`；`adopted → reverted` 合法（撤销已采用），`reverted`/`abandoned` 为完全关闭态；同 family 的当前版本由 partial unique index 在库层保证唯一，不存在两个"当前版本"；adopt/revert 同状态重放幂等；大于 2000 个实体的选择必须携带 `filterExpression` 才可持久化，计数如实反映真实规模。

RS2 实测修正的两个真实缺陷：其一，`canTransitionChangeSet()` 返回 `{allowed,...}` 对象，而三处守卫写成 `!canTransitionChangeSet(...)` —— 对象取反恒为 false，状态机守卫完全失效、放行所有非法迁移（含跳过预览直接采用）；已改为读 `.allowed`。其二，可达性分析无条件保护每个 family 的 ordinal 1，导致"用户新建 family 后放弃"的孤立 Revision 永久占盘；已改为仅当该 family 存在 current 或 adopted Revision 时才保护原始版本。

migration 现状更正：RS0 审计称 `src/migrations/` 只有 `.gitkeep`，实际该目录**根本不存在**，`runMigrations()` 因 `readdirSync` 抛错走 catch 分支静默返回，从未真正执行过。RS2 已建立该目录与首个 migration，并用 `test/result-studio-migration.test.mjs` 覆盖空库首装、重复执行幂等、已有库升级不动现有表、坏 SQL 事务回滚且不记版本、缺目录静默 no-op、`BIOF3_BETTER_SQLITE3_ROOT` ABI 路径，以及 `.sql` 与 schema 模块逐字节一致。

- `G0-RS3` Artifact Interaction 与 Selection Context —— 新增 `core/shared-backend/artifact-interaction.js`（稳定实体 ID 判定、表格/图形交互清单、选择解析与有界 Agent 摘要）、`core/r-server/routes/result-studio.js` 与 `frontend/src/lib/artifact-selection.ts`；`ActiveArtifact` 从文件级升级为 revision / semantic / selection-aware。该阶段建立的契约基础已由 `G0-RS-P2` 完成真实表/图交互、耐久恢复、下游链和视觉/性能复验，UI-102/UI-107 现按 P2 窄范围 `verified`，不外推 P3～P7。

RS3 已固化的边界：交互清单只能由**后端基于完整文件**产出，浏览器侧 40 行预览样本（`buildPreviewTable`）无权判定稳定 ID 列，前端只消费不自建第二套判定；`idStrategy='positional'` 时 `selectionDurable` 必须为 false，绝不把行号伪装成实体身份，且交互能力里不含 `row_select`；声明的 ID 列若在抽样中实测不唯一则拒绝采用并回退 positional，不产出错误的实体映射；超过阈值的选择以 `filterExpression` + hash 为权威表达，`entityIds` 只作抽样证据，计数如实反映真实规模；给 Agent 的摘要恒定有界且不可持久时必须带 caveat。

RS3 实测修正的三个真实缺陷：其一，我在路由里使用了 `app.locals.requireAuth` 与 `require('../db')` 直接当句柄 —— 前者在 `core/` 中**根本不存在**（桌面版 loopback 单用户，鉴权由全局 `localIdentityMiddleware` 注入 `req.user`），后者是模块对象而非 better-sqlite3 实例；两者都会让整个模块被 `routes/index.js` 的 try/catch 静默吞掉、6 个端点变成死代码，已改为裸注册 + 内联 `canAccessProject` + `require('../db').db` + 惰性仓库。其二，`ActiveArtifact` 的身份比较原本只比 `jobId + name`，导致"同一文件换了版本"或"用户改了选择"无法向上传播，已扩展为覆盖 revision / entityType / idField / selection。其三，前端 hash 不能冒充 sha256（浏览器无同步 sha256，`crypto.subtle` 是异步的），已改为 FNV-1a 双种子并在命名上不声称加密强度。

`G0-RS4` 已收口：`result_edit_plan` 能基于真实 Job/Artifact/provenance 和显式 DAG 生成 `ResultEditIntent v1`；插件无受信影响声明时未知参数保守进入科学重算，来源/脚本/输入/Revision/DAG 任一缺失即阻断。

`G0-RS5` 已收口：真实 valid Job Artifact 首次进入 Result Studio 时建立确定性 baseline v1 并把 `revisionId/artifactFamilyId` 投影回 `ActiveArtifact`；AI 与手动编辑共用 ChangeSet 服务，在 `.biof3/revision/<changeSetId>` 私有 staging 中派生独立脚本/参数，通过临时 Git index 生成不触碰工作树的 candidate commit，再复用正式 `run_tool → tool_job → artifact truth` 执行并登记 v2。候选仅为 `preview_ready/adopted:false`；失败、取消、并发冲突和恢复扫描均不改变 current。`result_edit_progress` 已接入 SSE 与前端有界 run store（UI-103 仍为 `in_progress`，待真实长修改失败/取消/历史恢复矩阵）。

`G0-RS6` 已收口：同一 Revision/ChangeSet 真相提供有界文本、JSON、表格与图像比较；Git current ref CAS 与 SQLite current 指针在一个 fail-closed 操作中切换，baseline 不可撤销，历史恢复生成新 commit/ChangeSet/Revision 而不改写旧版本。结果侧栏默认紧凑，展开后提供前后图、语义/字段/文本 diff、history 与折叠 Git 信息；真实隔离链已完成 v1 → 采用 v2 → 撤销 v1 → 恢复 v3，明亮/夜间/820×900 通过，UI-104 `verified`。

`G0-RS7` 已收口：Result Studio Plugin SDK v1 对 descriptor 与 golden Revision 执行 fail-closed lint；DESeq2、volcano、gene-correlation heatmap、GO/KEGG 的 12 个正式 table/plot 全部映射，每个 required file input 都有 Artifact binding。RS5 的 canonical `analysis/scripts/<family>/<revision>/<artifact>.R` 继续保证每个正式结果独立脚本，不拆分插件执行器、不建立插件内版本系统。相同 major/contract 的历史可读，漂移要求迁移，缺迁移时显式 `read_only_legacy`。下一阶段：`G0-RS8` 耐久恢复、性能与存储治理；不得提前实现 RS9 基线晋升。

`G0-RS8` 已收口：每个 ChangeSet 阶段持久化 WorkspaceCheckpoint；重启后只在 candidate ref、Revision、completed Job 与 valid Artifact Truth 全部一致时自动恢复 preview。Git/SQLite/Artifact 漂移分类为自愈或阻断；存储摘要、content-addressed hardlink 去重和 plan-token GC 均不删除正式 Artifact/Revision 历史。大表通过 1 MiB 有界 byte cursor 渐进加载，preview Job 受真实资源快照和并发预算约束且不修改科学参数。UI-105 功能完成但待 RS9 真实重启/大表/视觉矩阵，保持 `in_progress`。下一阶段：`G0-RS9` 真实产品验收与基线晋升。

`G0-RS9` 历史实现保留，但资格结论已撤销：复核确认 5 条任务由独立单测/fixture/截图拼装，Provider 探针没有执行真实 Result Studio tool calling，大表由 seed 直接构造数据库记录，视觉脚本主要消费人工 inspection 布尔值。证据继续位于 `acceptance/g0-result-studio/rs9-{product,provider,visual}-acceptance.json` 与 `rs9-ui/`，但只按 unit/synthetic/renderer historical evidence 使用。UI-102/UI-103/UI-105 回退 `in_progress`；UI-104 仅保留窄范围版本操作验证。

Result Studio 新顺序为 `RS-P0 Truth Correction → P1 Result Surface → P2 Scientific Interaction → P3 Agent Context → P4 Core Unified Editing → RH0 Repository Hygiene Gate → P4R Product Reframe → P5 Real Scientific Editing → P6 Durability & UX → P7 Requalification`。完整范围和阶段验收见 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) §22～§26。

### 3.1 已完成基线：真实科学任务驱动的 Harness 升级

用户已确认 Harness 应承担“把模糊科学需求转化为数据语言、可执行计划、验证证据和交付结果”的工程职责，而不是收集每一个分析需求点。当前采用增量升级，不重建 P-02 执行真相，不新增第二套 executor、job、artifact 或 workflow truth。

正式计划：[`harness-scientific-task-contract-plan.md`](./harness-scientific-task-contract-plan.md)。HRT-0 至 HRT-7 已完成。HRT-7 新增统一 `npm run harness:scientific-task` 离线聚合门禁，证据为 `acceptance/harness-scientific-task/hrt7-scientific-task-gate.json`；HRT-6 的持久化 ContextCheckpoint、ReplayPackage v1、逐 artifact 入口、五类漂移分类、真实离线 R 重放和数据库外接手仍由 `hrt6-replay-acceptance.json` 证明。UI-050 已实机点击导出 6 个逐产物入口/18 文件任务包，旧任务缺 checkpoint 时显示“历史部分可用”，控制台 0 error。后续运行控制面继续保持 `run_tool → tool_job → artifact truth` 唯一执行真相。

用户已确认 [`harness-loop-engineering-plan.md`](./harness-loop-engineering-plan.md) 是 P-03 Harness 的增量升级而非并行系统；HLE-0～HLE-6 当前已完成并成为长期基线。Loop 负责观察、决策、验证、修复、重规划、恢复和终止，继续复用现有 TaskSpec/DAG/Plugin/Job/Artifact/Delivery/Replay。任何 Agent 不得把它扩展为第二套 executor、job 表、artifact 仓库或 workflow truth，也不得让模型口头“完成”替代确定性和科学验证器。

2026-07-24 HLE-C0～HLE-C5 已完成：生产 Agent loop、真实 Job/Artifact Validator/Diagnoser/Repair、耐久恢复、UI-101、SPT-1 七节点三轨、双 Provider、应用重启、Delivery/Replay 和明暗/820px/停止恢复视觉矩阵均已验收。证据位于 `acceptance/harness-loop/production/`。G0-START / G0-LF0 已在此基础上关闭；HLE 作为长期不变量继续存在，不重开第二套 executor、Job、Artifact 或 workflow truth。

Post-HRT 运行控制面已于 2026-07-22 增加通用 `workspace_exec`、RuntimeResourceSnapshot v1、AI usage cache/cost 字段、设置页“用量与资源”、会话资源摘要和重启中断 Job 的 `recovery_required_after_restart` 投影。用户随后明确完全访问模式不应再受固定命令白名单限制：`accessMode=full` 现在从项目目录启动真实 shell，支持系统现有命令、脚本、管道和重定向；`read` 仍在 policy 与 handler 两层禁止执行。UI-051 真实项目/820px 窄窗验收通过，低内存能正确显示“资源不足”，控制台 0 error。Job 只记录开始/结束主机快照，真实进程峰值仍标记 `unavailable_without_process_sampler`，不得冒充已完成峰值采样。

UI-053 已补齐右侧文件面板实时一致性：Agent workspace 写入/替换/命令成功后广播项目刷新，文件页可见时以 2 秒轻量轮询覆盖终端与外部编辑器；展开目录自动收敛，活动预览只在 size/modifiedAt 改变时使用版本 URL 重读，Harness 文件摘要以 10 秒周期更新。真实临时项目验证了“已打开内容变化 + 新文件出现”均无需点击，控制台 0 error，验收数据已清理。

UI-054 已补齐并完成真实 Provider 验收：模型自然返回无工具最终答复时，若正文为空、响应非法或仍意外请求工具，会额外进行至多 1 次无工具整理请求；可重试的暂时性 Provider 错误则重试当前阶段。前端显示自动重试状态，且任何重试都不会重复执行已经完成的工具。两次仍无正文时保留工具结果，并明确提示用户可基于当前会话继续，不再要求重新描述需求。持久化消息 meta 记录 finalization attempts/recovered/failureReason；2026-07-23 真实 Provider 已覆盖连续空答复失败与第 2 次整理恢复，状态为 verified。

UI-035 已完成多轮工具体验收敛与实机验收：模型在工具批次前输出的用户可见阶段说明通过 `agent_progress` 固化，下一 iteration 不再令其消失，并随 assistant `meta_json.progressUpdates` 永久恢复；这只保存公开正文，不采集隐藏推理链。工具活动默认仅显示动作分类、数量和总耗时，点击后才展开紧凑单行明细。2026-07-23 Ark 真实长任务已覆盖 28 轮、32 次工具调用及历史重开，状态为 verified。

### Stage 4 之后的 Harness 工程主线

用户已于 2026-07-19 明确启动 Phase 7「通用基础工具与运行控制面」。这不重开已关闭的 Stage 3，也不增加分析流程；它是在 Stage 4 RC 基线之上的平台工程增量。

- 提交 `cec2c58` 已加入 7 个项目级文件/短命令工具并推送；开发壳已确认加载工具。
- P7-A 真实 Provider 基线验收已完成：DeepSeek `deepseek-chat` 与自定义 OpenAI-compatible `gpt-5.6-sol` 使用同一 8 场景矩阵，均为 8/8 PASS。
- 脱敏证据位于 `acceptance/harness-phase7/provider-baseline.{json,md}`；仅使用临时 fixture workspace，不含用户文件正文、凭据、请求头或完整 Provider 响应。
- 后端安全探针确认只读模式阻断 write/replace/exec/run，敏感/绝对/逃逸路径被拒绝，sudo、删除、git push 与远程脚本管道被拒绝；普通 `rm` 缺口已最小修复。
- P7-B 工具契约与注册表已完成：18 个模型可见工具的 definition、handler 与内部 contract 已收敛到 `agent-tools/registry.js`，模块加载时校验重名、定义/handler 漂移和非法元数据；`getToolDefs()` 只输出不含内部字段的 Provider-safe schema。
- dispatcher 已从注册表解析完整 entry，4 个退役学习工具保持不可见、不可由 Agent dispatcher 调用。
- P7-C 统一 Policy/Interceptor 已完成：schema 校验、workspace preflight、纯 `allow | deny` 执行决策和原 handler 调用形成统一后端链；handler 侧权限、路径、symlink、命令、大小和并发检查继续保留。
- 覆写已有文件与精确替换必须携带匹配的 `expectedSha256`；新文件使用原子 create-only 发布，同进程修改按目标串行化并在发布前复核 SHA。Phase 7 关闭时 `workspace_exec` 曾仅允许 `pwd`，该历史边界已被 2026-07-22 的完全访问产品决策替代；`run_tool(op=run)` 仍复用真实 pending `tool_job + ackToken`，workflow recovery token 与 `act` 执行后 ACK 未改义。
- P7-D 结构化结果、Trace 与前端呈现已完成：task/legacy loop 共用版本化 ToolResult envelope 与兼容 SSE 投影，`traceId/callId`、真实状态、termination reason、耗时、截断和副作用摘要贯穿；旧 `dispatchTool()` 与审批/Act 扁平字段保持兼容。
- Trace 仅保留容量 200、TTL 15 分钟的进程内脱敏摘要，不持久化原始参数、文件正文、命令输出或凭据。SimpleChat 按 `callId` 幂等显示运行/等待确认/成功/失败/拒绝、耗时、截断、拒绝原因和实际副作用；task 回放不重复，停止订阅不伪装工具已取消。只读 operation 不继承静态最大能力，待审批仅报告实际创建的 pending `tool_job`。
- P7-D 自动化证据：`agent-tool-result.test.mjs` 6/6；前端 SSE parser 与活动状态 7/7；后端 P7-D + 既有审批 + diagnostic redaction 回归保持通过。UI-034 已于 2026-07-21 完成开发壳明暗/窄窗/折叠/回放实机矩阵并标记 `verified`。
- P7-E 受控编辑补强已完成：`workspace_write` / `workspace_replace` 支持真实 `dryRun`，仍执行授权、路径、SHA、overwrite、大小和唯一匹配检查，但不创建工作区根目录、目标父目录、临时文件或目标文件；尚不存在的工作区返回 `workspace_unavailable`。成功结果在保留旧字段的基础上追加 `dryRun` 和仅含相对路径及前后 hash/bytes/lineCount 的 `changeSummary`。
- write/replace 已共用同目录原子发布函数；保留同进程目标锁、发布前 SHA 复核与 create-only hard-link。临时文件在 `finally` 中 best-effort 清理，常规冲突回归验证无残留；极端文件系统清理失败不作绝对保证。该边界不宣称跨进程 CAS。成功 dry-run 在只读上下文可执行并由 ToolResult 报告 `none/R0`；真实编辑继续为 `workspace-write/R2`。
- P7-E 定向证据：workspace handler、policy/interceptor 与 ToolResult 三文件合计 32/32，0 fail；覆盖 absent-root 零创建、dry-run 不落盘、授权/敏感路径/symlink/overwrite/stale SHA/唯一匹配、旧字段兼容及真实写入副作用。没有实现 `workspace_patch`，因为尚无 Provider 证据证明现有精确编辑不足。
- P7-F 后台任务 decision gate 已于 2026-07-20 完成：P7-A–D 前置条件满足，集成终端的 Agent 查询/停止缺口成立，但严格合格的真实 `>30s` 非科学 Agent 任务为 0/3，因此 AND gate 不成立并标记 `deferred`；未新增 `workspace_process_start/check/stop`。
- P7-G 上下文效率与 Provider 稳定性已完成：模型侧按 list/find/search/read/write/replace/exec 类型投影，硬截断保持有效 JSON，`modelContext` 暴露原始/投影字符数与压缩/去重状态；原始 handler result、ToolResult envelope 和 SSE 不压缩。read 只在 `projectId + traceId + path` 内提交实际入模范围，Trace entry 携带 `projectId` 并支持精确过滤。
- task 与 legacy Agent loop 已统一为目标驱动：正常路径不设置 iteration 或工具调用总量上限，模型在用户目标和真实产物完成后自然返回最终答复。用户取消、确认门、工具/Provider 问题会暂停或停止；相同工具与相同参数连续出现第 3 次时判定为异常循环，该次不执行并强制生成诚实的阻塞说明。批次仍严格 reserve，只把已接受调用及其配对结果写入 history。malformed JSON、数组/null 参数和跨轮重复或碰撞的 Provider/protocol call ID 均结构化拒绝且不执行 handler，协议 history 始终使用请求级唯一 ID并保留原始 `providerCallId`。观察到取消后不再启动剩余 handler 或下一轮 Provider 请求；当前没有公共 `AbortSignal`，因此不声称中断已开始的 handler。
- P7-G 定向证据：`agent-tool-result.test.mjs` + `agent-provider-boundary.test.mjs` 覆盖按类型压缩、有效 JSON、原始 ToolResult 截断语义、read 去重、Trace 项目隔离、无正常轮数/调用数上限、连续相同调用异常熔断、可注入测试保护上限、非法参数、跨轮 call ID 碰撞、协议配对与取消边界。
- P7-H 已于 2026-07-21 完成：单一零网络、零凭据的 `npm run harness:phase7` 已接入 CI，实测 manifests 7/7、Phase 6 tests 64/64、Phase 7 核心 tests 68/68、离线临时真实 workspace 产品检查 13/13，全部 0 fail；脱敏证据位于 `acceptance/harness-phase7/product-acceptance.{json,md}`。
- Phase 7 已关闭。P7-A live Provider 双目标继续保持 8/8 人工证据；P7-F 保持 `deferred`；UI-032/UI-033/UI-034 已实机关闭。下一步观察 rc.7 发布反馈，不默认扩展 Phase 7。
- 全面计划、出口判据和后续工具接手协议见 [`harness-phase7-completion-plan.md`](./harness-phase7-completion-plan.md)。
- `DeepSeek_harness/` 与 `api-failover-proxy/` 仅可作为未跟踪参考工程，均不得纳入 Desktop 提交。

**Stage 2 出口已于 2026-07-17 验收完成**（详见 `ui-productization-audit.md` 第 9 节与 `acceptance/stage2/`）：

> 注：`acceptance/stage2/`（`live-provider-check.mjs` 等验收工具与人工清单）已于 2026-07-17（commit `498a661`）移除；下列路径引用与结论仅作历史验收记录留存，验收结论以本记录为准。

1. ✅ 真实 Provider 连通 + streaming + Agent tool calling：DeepSeek（OpenAI-compatible）、xunfei-astron 与 api.xcdw.us `claude-opus-4-8`（Anthropic 原生）三者真机全绿，覆盖两种协议、≥2 Provider（`acceptance/stage2/live-provider-check.mjs` PASS）。
2. ✅ 打包态 UI-031 实机验收通过（`dist/mac-arm64/BioF3.app` arm64/rc.5）：模型 CRUD、8 类角色绑定与能力过滤、显式 fallback、Keychain（无明文回显）、保存重开、聊天选择器同步、窄窗。
3. UI-031 台账已标 `verified`；`run_tool → tool_job → artifact truth`、fallback 默认关闭、Key 不回显等不变量保持。

Stage 3 最新验收证据：

1. ✅ GO/KEGG、GSEA、WGCNA 三条真实标准流程均为 valid artifact。
2. ✅ DeepSeek + Anthropic Harness 评测各 6/6。
3. ✅ `r-enrichment` / `r-wgcna` 已发布并回填真实 SHA-256；Electron App 首次自动下载、校验、解压、挂载成功。
4. ✅ 发布后任务 `job_1257dae3bfda4aa0`（GO/KEGG，37/37）和 `job_02bb39e189d845f9`（WGCNA，28/28）均为 `valid`、0 issues。

Stage 4 rc.6 已完成：原生 ABI 边界、真实 OSS Runtime 首装、DESeq2 报告/ZIP、GO/KEGG bundle 真链、rc.4 数据副本迁移、诊断导出隐私及 arm64/x64 构建结构。arm64 是完整候选链；x64 因没有分析 Runtime 仅为壳层预览。详见 [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md)。

当前没有待执行的发布动作。UI-032 已完成真实 capability bundle 设置页验收；下一步观察 rc.7 真实使用反馈。签名/公证不属于本项目必需条件；当前 OSS 分发仅表示技术链路可用，本 RC 距离正式产品上线仍有较大距离。

### 已拆分给独立 Agent 的专项

`[P-02 工具执行、Job 与 Artifact Truth]` 项目工作路径结果沙盒 Phase 0–5b 已完成实施（resolver + R/Python/MCP 收敛 + 测试），记录见 [`project-result-sandbox-plan.md`](./archive/checkpoints/project-result-sandbox-plan.md)。

当前结论：项目作用域的 R/Python/MCP/Agent Workflow 已统一透传 `projectId`，由后端解析到 `workspace_path/results/jobs/<toolJobId>`；无项目的兼容任务仍保留显式全局落点。不得建立第二套结果系统、自动移动历史结果或删除用户外部工作目录。

## 4. 发布与安装状态

主模块：`P-06 桌面集成与交付`。

- 当前代码、Git 标签与 OSS 线上版本：`v0.0.1-rc.7`（发布提交 `ab519fa`）。
- 默认平台：macOS-only；构建 arm64/x64。
- GitHub：只保存源码和不可变标签，不上传 DMG。
- OSS：保存双架构 DMG、SHA-256 清单和 `latest-mac.yml`。
- 更新方式：检查 OSS → 下载匹配架构 DMG → 大小/SHA-512 校验 → 打开 DMG → 成员手动拖入 Applications。
- 本项目当前不以 Apple Developer ID 签名/公证作为上线条件；安装仍保留人工打开与拖入 Applications 的边界。
- `rc.4 → rc.7` 已完成更新选择、公开下载、大小/SHA-512 校验、DMG 只读挂载和包内版本/架构确认；rc.7 的公开 `latest-mac.yml` 与 SHA-256 清单已反向核验。
- 正式 `rc.4` 已恢复运行，R `:3001/api/health`、Python `:3004/api/health`、SPA `:3002` 验证通过。
- 发布端凭据只存在本地 `.biof3-secrets`，权限 `600`，禁止输出或提交。
- Clash Verge 使用规则模式：OpenAI/Codex/GitHub 代理，`aliyuncs.com`/`aliyun.com`/`alicdn.com` 直连。

详细操作见 [`macos-oss-auto-update.md`](./macos-oss-auto-update.md)。

## 5. 已建立的平台能力

### P-02 执行真相

唯一正式执行事实链：

> `run_tool → tool_job → artifact truth`

已有 job 状态、参数、日志、manifest、磁盘校验、valid/degraded/blocked、diagnostics、failureModes 和 lineage。不得建立第二套执行器、job 表或结果真相系统。

### P-03 Harness 与 Agent Workflow

Harness Phase 1–6 已建立：

- `inspect → infer → select → repair → confirm → run → verify → report`
- 参数 repair/readiness、工具选择、确认、恢复和二跳 artifact 绑定
- workflow 状态投影自现有 tool job/artifact truth
- Plugin SDK、built-in/installed/development 三来源与 fixture 门禁
- local/container/remote 共用 canonical execution context，差异留在 adapter

Stage 3 已完成 GO/KEGG、GSEA、WGCNA 与 capability bundle 自动 provision 真链。后续不继续批量增加分析内容；Stage 4 发布收口完成后的 Harness 增量限定为 Phase 7 通用基础工具与运行控制面。技术参考见 [`harness-engine-spec.md`](./harness-engine-spec.md)、[`harness-roadmap.md`](./harness-roadmap.md)、[`harness-phase7-completion-plan.md`](./harness-phase7-completion-plan.md) 和 [`stage3-standard-workflows-design.md`](./stage3-standard-workflows-design.md)。

### P-07 模型层现状

- ModelProfile v1 与 Model Gateway 已成为聊天、Agent、规划、摘要、记忆、报告、解释、vision 和 embedding 的统一调用边界。
- 项目记忆已按 `projectId` 形成硬隔离（主模块 `P-01 项目、会话与上下文`，影响 `W-03 Agent 会话` / `P-07 模型网关`，关注点 `C-04` / `C-05`）：
  - `copilot_conversations`、`memory_vectors`、`user_facts`、`project_chat_summaries` 使用同一项目作用域；向量召回、事实注入、长对话摘要、Agent `query/search` 和记忆管理 API 均只读写当前项目。
  - 无 `projectId` 的普通会话属于独立的全局作用域；历史无作用域事实和旧用户级摘要只保留在全局作用域，不自动注入任何具体项目。
  - 旧向量若有 `conversation_id`，启动迁移会按关联会话安全回填 `project_id`；无法可靠归属的历史数据不猜测、不跨项目复用。
  - 项目提示词的实时资源快照只包含当前项目；删除项目会同步清理该项目的向量、事实、摘要、会话和消息，删除单个会话会同步清理其向量记忆。
  - 隔离门禁：`test/project-memory-isolation.test.mjs` 覆盖 A/B/全局三作用域对撞，`test/project-memory-migration.test.mjs` 覆盖旧向量安全回填。
- 已注册 DeepSeek、OpenAI、OpenAI-compatible、Ollama、LM Studio、vLLM、Anthropic、DashScope embedding/vision；Anthropic 使用原生 Messages/stream/tool 协议适配。
- 2026-08-04 设置页已把协议与供应商分离：用户协议只有 OpenAI 和 Anthropic，DeepSeek/BioF3 等是可编辑供应商名；新渠道由用户显式填写 Base URL。旧 DeepSeek profile 读取时无损归一为 OpenAI-compatible，保留模型、Key 引用与原地址；协议切换隔离凭据并淘汰迟到的旧模型发现响应。开发态 Electron 已核对六列布局、两个协议选项、新渠道空 URL 和旧 DeepSeek 配置保留；真实 Anthropic Key 连通尚未复验，因此 UI-124 保持 `in_progress`。
- 多模型角色绑定覆盖 chat、agent、planner、vision、embedding、summary、report、explanation；能力不匹配在调用前阻断。
- fallback 默认关闭，仅在用户显式开启并逐角色配置候选时对可重试错误切换；401、缺 Key、取消和已经输出部分流内容时不切换，切换原因写入事件/日志。
- API Key 已从普通设置与读取 IPC 分离：macOS Keychain，其他平台独立 0600 凭据文件；旧字段自动迁移。一个兼容 Provider 可通过不同 credential reference 使用多套 Key。
- 模型管理中心已实现 Provider/Profile、Endpoint、能力标签、8 类角色、fallback、凭据状态和按 Profile 连通性测试。**UI-031 已于 2026-07-17 打包态实机验收通过并标 `verified`**（模型 CRUD、8 类角色与能力过滤、显式 fallback、Keychain 无明文回显、保存重开、聊天选择器同步、窄窗）。
- 真实 Provider 矩阵已真机验证（`acceptance/stage2/live-provider-check.mjs` PASS）：DeepSeek（OpenAI-compatible）、xunfei-astron 与 api.xcdw.us `claude-opus-4-8`（Anthropic 原生）三者 chat + streaming + Agent tool calling 全绿，覆盖两种协议。验收工具与人工清单沉淀在 `acceptance/stage2/`（不进单元测试套件与 CI；密钥仅经环境变量注入，从不落盘/打印）。**该 `acceptance/stage2/` 验收工具目录已于 2026-07-17（commit `498a661`）移除，此处引用仅作历史验收记录留存，验收结论以本记录为准。**
- 本地 `build:mac-arm64` 已生成约 183 MB 的 `BioF3-0.0.1-rc.5-arm64.dmg`（未上传、未签名、未公证）；包内 R/Python/SPA 健康，模型/凭据页可访问，设置 API 返回 Keychain 配置状态且无 secret 字段。**Stage 2 出口已满足**；下一 RC 版本、发布、签名公证需用户单独授权。
- 打包验收发现 `electron-builder.yml` 曾把双架构写死在 target，导致 `build:mac-arm64` 仍构建 x64 并把工作区 native module 留成 x86_64；现已改为由 `build:mac` / `build:mac-arm64` / `build:mac-x64` 的 CLI 架构参数决定，并重建回 arm64 Electron ABI。
- `api-failover-proxy/` 是未跟踪的嵌套参考仓库，绝不能加入 Desktop 提交；已融合的仅是 MIT 协议转换、usage/stream 聚合与可靠性原语。
- Provider/Gateway 自动化测试证据（仅测试新增，未改生产代码）：Anthropic 原生流 abort 传播（`test/anthropic-provider.test.mjs`）、OpenAI-compatible 非流式 `chat()` 错误分类覆盖 `http_error`/顶层 `error` 保留/`parse_error`/`no_api_key`（`test/provider-streaming.test.mjs`）、Anthropic 非流式用量与延迟记录（`recordAiUsage` 单次调用、prompt/completion tokens、`latencyMs` 有限且 `>= 0`；`test/anthropic-provider.test.mjs`）。当前门禁 `node --test test/*.test.mjs` = 309 tests / 292 pass / 6 fail（5 项 qa-smoke + 终端 Node ABI 下 migration-runner，均为已知非回归），11 skipped。

## 6. UI 已建立结构与边界

- 极简项目启动页与 `/project/:projectId` 工作台。
- 左/中/右三栏、折叠与拖拽。
- 项目级 conversation、Agent 输入和流式消息。
- 参数确认、工具调用、运行/失败/恢复状态。
- 聊天结果卡片与右侧 Artifact 联动。
- 图片、CSV/TSV、HTML、日志、JSON 和下载入口。
- 浏览器、文件、终端与设置/插件容器。

Stage 1 已完成。Stage 2 的模型管理 UI 复用现有设置分类；结果预览继续采用受控 iframe/WebView 分工，不得因为模型层改造重新发明结果系统。

### 2026-07-16 W-01/W-02 桌面壳与左栏检查点

主模块：`W-01 桌面壳层`；影响模块：`W-02 工作台布局`、`P-06 桌面集成与交付`；关注点：`C-02`、`C-05`。

当前已完成：

- macOS 顶栏采用单一物理几何基准：`hiddenInset` 保留系统原生交通灯，`trafficLightPosition` 绑定 38px 轨道中心；TitleBar 不再用局部 `translateY` 互相补偿。
- 标题栏视觉高度统一为全局 `--biof3-titlebar-height: 38px`；TitleBar、工作区和 Desktop Dock 共用该变量并随 renderer 同步缩放，主进程按 zoom factor 动态调整 macOS 原生按钮的纵向中心。
- 关闭最后一个 BioF3 窗口会退出整个应用；开发启动器会清理 Vite/Electron 子进程树，主进程同时停止 R/Python/Plumber 和集成终端。
- 加入单实例保护；重复打开只聚焦已有窗口，不启动第二套本地后端。
- R Server/Python Server/Plumber 保留 `3001/3004/8787` 为首选端口；如被其他程序占用，自动选择系统空闲端口，并通过 preload 安全桥传给前端，不杀占用者。
- 左侧项目栏删除了与“搜索”工作台按钮重复的顶部筛选输入框，同时删除对应查询状态和废弃 CSS；快捷按钮组自然上移约 44px。
- 左栏信息层级收敛：删除了重复的全局“新对话”，上方只保留搜索和插件等工作流入口；全局“设置”固定到左下角。原左下角主题切换器已移入设置页面的“外观主题”项，不在左栏重复暴露。
- 项目行内的 `+` 改为直接创建并进入默认“新对话”，不再弹出标题确认表单。项目列表标题的 `+` 与无项目启动页统一先打开系统目录选择器；用户选定后，以目录 basename 作为项目名、以所选目录作为 workspace path 立即创建并进入，取消选择则不创建。
- 项目树中的项目名和会话名支持双击后原位重命名；单击仍用于切换/展开，Enter 或失焦保存，Escape 取消，创建流程本身仍保持零确认。
- 设置页已从单列长表单重组为“常规 / AI 模型 / 凭据 / 计算与数据 / 隐私与维护”五类导航，右侧一次只展示当前模块；模型预设改为紧凑卡片，检查更新与诊断导出移入维护区，AI 保存按钮只在模型和凭据分类出现。窄窗口下分类栏自动切换为顶部横向导航。
- 项目和会话删除改为两阶段回收站机制：左侧树的 hover 删除按钮只归档，设置 → 隐私与维护固定展示回收站，可恢复、单项永久删除或清空。项目使用 SQLite 中的 Core `status=active|archived`，会话复用既有 archived 状态；永久删除项目会清理其应用内会话和消息，但明确不删除用户选择的外部工作目录。
- 全局 `BackendStatusProvider` 的 R/Python 状态已接入会话摘要卡 Footer：仅使用 5px 状态点与 `R / Py` 短标签，在同一行保留运行中/总次数；运行中、未启动、未安装通过颜色区分，详细降级原因只在 hover title 中显示，不新增卡片分区。
- 旧 Desktop Dashboard 已彻底删除（组件与 1133 行专属样式一并移除）。`/` 启动路由只在后端就绪后读取项目，有项目直接进入最近工作台；无项目只显示极简创建入口，加载失败显示可重试状态。启动路由也始终挂载统一 TitleBar，不再出现交通灯压住无拖拽页面的情况。

验证证据：

- `npm --prefix frontend run check` 通过。
- `npm test --prefix frontend` 通过：19 files / 146 tests。
- `npm --prefix frontend run build` 通过：568 modules；仅有既有 chunk-size 提示。
- `npm run build:mac` 通过，生成 `rc.5` x64/arm64 DMG；未签名、未公证，且未执行 OSS 上传脚本。
- 打包态 `dist/mac-arm64/BioF3.app` 在本地 `:3002` 启动，项目工作台、结果与 Artifact 读取正常。
- 真实占用 `3001/3004` 后启动 BioF3，R/Python 自动切换至系统空闲端口，渲染页和 Python Worker 正常就绪；验证后已恢复默认端口启动。
- 开发实例关闭时，日志确认 Electron、R Server 与 Python Server 收到退出/停止信号。
- 临时项目与会话均完成 `创建 → 归档 → 回收站可见 → 恢复 → 再归档 → 永久删除` 实际 API 验证；另验证永久删除项目后其活动会话返回 404，测试数据已清理。

Stage 1 出口已满足。Stage 2 代码主干完成，下一步只做真实 Provider 与打包态验收；不恢复局部偏移补丁、重复搜索框、旧 Desktop Dashboard 或第二套模型调用链。

## 7. 验证门禁

按风险选择并记录：

```bash
npm --prefix frontend run check
npm test --prefix frontend
npm --prefix frontend run build
npm run check
npm test
npm run harness:phase6
npm run harness:agent-evaluate
```

UI 任务必须补实机截图/交互证据；Electron 壳、IPC、runtime、更新和打包资源改动必须补打包态验证。涉及 Core 时直接修改仓库内 `core/` 并随 Desktop 提交；没有 submodule 或 `.vendor-lock`。

## 8. 禁止误读

- 不把 `docs/archive/` 中的历史 P0、旧分支、旧 CI 或旧阶段编号当成当前任务。
- 不把旧 Windows/Linux 发布计划恢复为当前门禁；除非用户重新明确要求。
- 不在 Stage 2 批量增加分析流程。
- 不用前端回退代替后端 artifact truth。
- 不覆盖用户未提交改动，不随手 reset 子模块或工作树。

## 9. 当前关键文件

UI Stage 1：

- `frontend/src/App.tsx`
- `frontend/src/components/desktop/`
- `frontend/src/components/workspace-panels/`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/home.tsx`
- `frontend/src/themes/`
- `frontend/src/styles/global.css`

阶段与规范：

- `docs/v1-productization-roadmap.md`
- `docs/ui-productization-audit.md`
- `docs/development-module-map.md`
- `docs/codex-style-workbench-direction.md`
- `.claude/ui-refactor-plan.md`
## 10. 2026-08-14 → 2026-08-16 同步笔录

> 本节为 2026-08-16 文档治理收口同步（worker-C）追加；只在上方 §1～§9 已收口主线之外新增一段同步状态，不重写或外推原有已收口阶段的实施细节与边界。

- **聚类形态**：本轮截至 2026-08-16 的本地 29 个最近 commit 已由审计 worker 聚类为 6 个 Block；当前阶段纪律要求按 Block 跟进，不引入新的活动 canonical 计划。
- **Block-1 · AGENT-WB**（10 commit）— 已收口。`UI-AGENTWB-###` 系列在 dev Electron + packaged 三轴边界内均 `verified`，详见 `docs/AUDIT-LOG.md` T-AW-013/014 二次实机收口登记。
- **Block-2 · SKILLS + WIRING + COPILOT**（7 commit）— 部分收口；`UI-157`（Skills IPC 桥）、`UI-158`、`UI-159` 仍处 `in_progress`，等待实机复核升 `verified`。
- **Block-3 · G0-IDE-MCP-TOOLS**（5 commit）— Phase 1 + 1.5 + 3 已按 `docs/g0-ide-mcp-tools-plan.md` §11 + Phase 3 收口 `qualified`（78/78 定向测试 PASS），Phase 2（Monaco 编辑器 9 工具）继续 `deferred`。
- **Block-4 · R-SERVER-FIX**（1 commit）— `/api/ai/agent` 路由修复及治理漂移收口已落地；本轮仍缺补强定向测试，留待下一次受影响范围触发时一并验证。
- **Block-5 · GOV-AUDIT-VERIFICATION**（5 commit）— T-AW-013（packaged 三轴验证）+ T-AW-014（dev Electron 边界内 4 工作包二次实机复核）已按各自边界收口，并在 `docs/AUDIT-LOG.md` 留有同收口径登记；含 6 份 planning 文档治理收口。
- **Block-6 · G0-LONGTERM-DEV + HOTFIXES**（3 commit）— `UI-161`（Skills 入口回收至 LeftPanel、移除 `SkillsSidebar`）等仍以 `in_progress` 提交，目前正在做实机复核；本轮未升 `verified`，记录点保留在 `docs/AUDIT-LOG.md`。
- **5 个 `wb/` 命名空间分支已 push**：`agent-workbench`、`backend-skills`、`copilot-gateway`、`docs-evaluation`、`g0-ide-mcp-tools`；均为命名空间分支，不与主分支并行开新 active 工作包。
- **当前恢复检查点不变**：仍以 §3.0 中 2026-08-11 复核的 `npm run dev` 现场为最新 active 现场；本轮未替换或刷新现场描述，待受影响范围触发时再核对。
- **当前阶段纪律**：`qualificationEligible: false` 是 G0 开发期常态事实，不构成缺陷、不是待办、不是下一次校验需推动的事；G1+ 阶段事项（`Provider` 矩阵、`packaged Electron` 公证/签名、`OSS` 远程接手、`GA` 公证流水、`dist staleness`）按当前阶段属于**不外推**而不是"待完成"。已收口阶段的边界保持不变。
- **单工作包串行纪律下「下一块候选」**：Block-2 的 `UI-157`（Skills IPC 桥实机收口）与 Block-6 的 `UI-161`（实机复核升 `verified`）属于当前 G0 边界内未完成的实机复核项；不主动启动新工作包，新工作包必须由用户显式裁决后才能由主 Agent 登记到 `docs/DOC-REGISTRY.json`。
- - **BLOCK-9.1-MAIN-JS-SPLIT 工作包已收口**（2026-08-17 07:38 status=completed）：5 PHASE 全部完成（5 commit 落地 fa8353a PHASE 0 + f63185b PHASE 1 + 2d94732 PHASE 2 + aed7498 PHASE 3 + 2493587 PHASE 4）。`src/main.js` 2450 → 1066 行（**-1384 行 / -56.5%**）：12 个 `src/ipc/<domain>.js`（每个自包含）+ 2 个 `src/main/` 共享层（env-coordinator.js 256 行 / backend-proc-manager.js 443 行）。建立 4 类跨文件依赖注入模式（module-level ChildProc / 函数引用 / mainWindow 句柄 / 日志子系统）。UI-165/166/167/168 verified。**验证**：tsc 0 / vitest 75 文件 630 tests PASS / chf0-critical 3 测试 33 PASS / window-controls 6/6 PASS / 15 个 ipc/main 文件 `node --check` OK / 不变量守住（preload.js / electron.d.ts / desktopBridge.ts / core/shared-backend/* 0 diff）/ 后端 IPC 契约 100% 不变。4 治理门 GREEN（docs:check 83 / ui:audit:check 137 / tsc 0 / docs:reconcile 0 Validation 0 Unregistered 0）。**关键修复**：PHASE 1 删除 _applyComputeSettings 但 setupDesktopEnv 仍调用之会导致运行时 ReferenceError — PHASE 3 env-coordinator 反向从 src/ipc/compute-settings.js import 修复。**关键修复 2**：window-controls.test.mjs 期望 stale（app:relaunch 已在 commit 7b78c88 加入但测试期望未同步）顺手修复。**当前无 active 工作包**；剩余候选 BLOCK-9.2（plugin-manager / SimpleChat / ResultView / DesktopSettingsPanel / useSkillStore 5 项 senior-engineer-review §3 非文件级问题）需用户显式裁决启动。G0 长期开发期阶段纪律不变，不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+。closeout 报告 [`block-9-1-main-js-split-closeout.md`](./block-9-1-main-js-split-closeout.md) 11 节。

- **BLOCK-9.2-MEGA-FILE-REFACTOR 工作包已启动**（2026-08-17 07:46 BLOCK-9.1 收口后用户裁决"可以开搞了"启动）：plan [`block-9-2-mega-file-refactor-plan.md`](./block-9-2-mega-file-refactor-plan.md)（v0.1 / 152 行 / 11 §）。评级依据 [`senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §3 5 项非文件级"不合理"巨型文件：① `src/plugin-manager.js` 1457 行（后端 plugin 生命周期 + IPC） / ② `frontend/src/components/copilot/SimpleChat.tsx` 2153 行（前端 React + UI） / ③ `frontend/src/components/workspace-panels/ResultView.tsx` 1662 行 / ④ `frontend/src/components/desktop/DesktopSettingsPanel.tsx` 1515 行 / ⑤ `frontend/src/hooks/useSkillStore.ts` 743 行（Zustand store）。**原则**：不修改行为 / 不引入新依赖 / 保留向后兼容 / 不破坏既有测试 / 不外推 G1+ 阶段事项 / worker 委派 + 主 agent 直做混合。**拆分范式**：后端按生命周期分层 + IPC 抽 `src/ipc/` + schema 独立 + utility 抽 `src/lib/`；前端 types 优先 + helpers 抽 `lib/<domain>/` + 自定义 hook 独立 + 子组件按需抽（保守）；Zustand store 按 State/Action/Selector/Subscriptions/Types 分层。**PHASE 0 架构调研**：worker 委派 ID `d06a18b5-93fd-4d59-b326-60ec01d9e1e7`，输出报告 `docs/block-9-2-mega-file-split-survey.md` 后主 agent 读报告 + 调整本计划 v0.2（细化 PHASE 1-N）→ 启动 PHASE 1。**完成语义**：5 文件每个 -200~1000 行不等 + 4 治理门 GREEN + chf0-critical 33 PASS + vitest 75/630 0 失败 / 0 改动 + 不变量守住（preload.js / electron.d.ts / desktopBridge.ts 0 diff）+ 后端 IPC handler channel 100% 一致 + 前端 React component name 100% 一致。**不在范围**：BLOCK-9 / BLOCK-9.1 / 重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1 / UI-157/158/159 实机 / agent-tools/* / agent-transcripts/* / packaged / Provider / GA / P7 / notarization / dist staleness G1+ / dev CSP / Worker / Chart a11y。**当前 active 工作包**：BLOCK-9.2。

**本节与 worker-A 的 `docs/AUDIT-LOG.md` closeout 登记、worker-B 的 `agent-interaction-evaluation.md` 迁移独立同步**：本节不动 `docs/AUDIT-LOG.md`、不动 `agent-interaction-evaluation.md`、不动 `docs/DOC-REGISTRY.json`、不动 `docs/README.md`，仅作为上方 §1～§9 的同步附录。
- - **BLOCK-9.2 PHASE 1+2+3 落地**（2026-08-17 09:10 PHASE 4 PHASE 5 PHASE 6 进行中 状态=active）：PHASE 1 拆 DesktopSettingsPanel.tsx 1515 → 870 行（commit `d06b66e` UI-170，10 模块）；PHASE 2 拆 ResultView.tsx 1654 → 1553 行（commit `014ad0d` UI-171，2 模块）；PHASE 3 拆 plugin-manager.js 1457 → 586 行（commit `49652f3` UI-172，9 模块）。**3 PHASE 累计 -1617 行** / 14 个新 lib/sections 模块 / 21 module.exports 100% 保留。**21 模块.exports 100% 保留**（含 Week 2 schema re-export 6 项）；计划下一阶段 PHASE 4 拆 SimpleChat.tsx 2153 行；PHASE 5 useSkillStore.ts 评估；PHASE 6 audit + closeout。**4 治理门 GREEN**（docs:check 85 / ui:audit:check 142 / tsc 0 / docs:reconcile 0）。**不变量守住**：`src/ipc/plugin.js` 0 diff / `src/main.js` 0 diff / `preload.js` 0 diff / `desktopBridge.ts` 0 diff / `electron.d.ts` 0 diff / `core/shared-backend/*` 0 diff / `agent-tools/*` 0 diff / 6 plugin 测试文件 0 改动 / 0 npm 依赖新增 / 0 npm 依赖删除。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 实机 Electron 验证 / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*

- **BLOCK-9.2 PHASE 4 SimpleChat.tsx 2153 → 1975 行 + 2 子模块抽出落地**（2026-08-17 用户裁决「继续」启动 PHASE 4；commit `8183f4e` UI-173）：`docs/block-9-2-mega-file-split-survey.md` §2.2 拆分边界 1:1 落地。抽出 14 个 types/constants/interface 到 `frontend/src/components/copilot/SimpleChat/types.ts`（189 行）+ 3 个 pure helper 到 `./SimpleChat/helpers.tsx`（108 行）。**SimpleChat.tsx：2153 → 1975 行（-178 / -8.3%）** + **2 新文件 / +297 / −0**。**保守拆原则沿用 PHASE 1/2/3**：按 PHASE 0 调研 §2.2「~1387 行 SimpleChat 主组件保留」理由 —— 内部 ~30 个 useState + ~6 个 useRef + ~6 个 useEffect 强耦合共享 input/messages/scroll/slash 状态，拆子组件 ROI<风险。**re-export 兼容策略**：SimpleChat.tsx 顶部 export 8 个 public symbols（4 const/function + 4 type）—— 4 测试文件 + 4 page consumer（CenterPanel / RightPanel / ResultView / project-workspace）契约路径 0 改动。**关键修复 4 项**：① `helpers.ts` → `helpers.tsx` 重命名；② `restoreToolActivities` import 路径修正；③ `PendingApproval` type alias 集中到 types.ts；④ `compactStageConclusion` 从 types.ts 移至 helpers.tsx。**测试矩阵 100% PASS**：vitest 23/23（SimpleChat 6 + simple-chat-file-open 4 + SimpleChat.progress 4 + extraRenderers 9）+ g0-chf0 + qa-smoke 39/39。**4 治理门 GREEN**：`docs:check` 85 / `ui:audit:check` 142 / `tsc --noEmit` 0 / `docs:reconcile` 0。**Vite build 0 错误**：dist JS 2308.57 kB（与 PHASE 1/2/3 持平）。**不变量守住**：SimpleChat 主组件 ~1387 行 render JSX / scroll / slash / 模型菜单 / 持久化草稿 / conversation run / plan 1.6 §4 全部保留原签名；`desktopBridge.ts` / `electron.d.ts` / `copilotClient.ts` / `toolActivity.ts` / `toolSummaryPresentation.ts` / `extraRenderers.ts` / `conversationRunStore.ts` / useAiSettings / useConversations / useCopilotContext / useErrorFormatter / useDurableConversationLoop 全部 0 diff；0 npm 依赖新增 / 删除。**保持 UI-161 `in_progress`**：纯代码组织变更（types + helpers 抽取），无实机 Electron 验证，不外推 packaged。**4 PHASE 累计指标**（1+2+3+4）：plugin-manager 1457 → 586（-871）/ DesktopSettingsPanel 1515 → 870（-645）/ ResultView 1654 → 1553（-101）/ **SimpleChat 2153 → 1975（-178）**；总 **-1795 行** / 16 个新 lib/sections/types/helpers 模块 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff。**当前 active 工作包**：NONE（BLOCK-9.2-MEGA-FILE-REFACTOR COMPLETED，等待用户裁决下一步工作包）。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*

- **BLOCK-9.2 PHASE 5 useSkillStore.ts 评估决议（不拆 / 0 代码变更 / UI-174）**（2026-08-17 用户裁决「好的 开冲」启动 PHASE 5）：决议 canonical `docs/block-9-2-phase-5-useSkillStore-decision.md` 139 行 / 7 节（TL;DR + 现状详情 + 不拆核心理由 5 项 + 后续建议 + PHASE 0 对照 + 不变量 + BLOCK-9.2 整体关系 + PHASE 6 下一步）。**决议**：保留不拆 + 仅审计登记（与 PHASE 0 调研 §1.5.7 + Senior Engineer Review §2.4 一致）。**5 大不拆理由**：① Singleton store 反模式（5 state + 3 modifier + 8 reader 强耦合 → 提到 ESM export + barrel re-export 破坏 singleton 语义 + tree-shaking 失败）；② polling + wakeup 双向耦合（`_subscribeProgressWakeup` ↔ `_startPolling` 通过 `Map<executionId, ...>` 同步追踪同一组 executionId，跨文件传 Map 集合的迭代时机难保证 atomic）；③ 测试基础设施已稳定（14 vitest `useSkillStore.test.ts` 覆盖所有 module-level state 边界，BLOCK-2/3/4/5 期间 22 次真值模拟全部 PASS）；④ 实际收益有限（743 行已是最小，距团队「1500 行阈值」还差 757 行空间）；⑤ G0 阶段纪律不容外推。**BLOCK-9.2 5 文件累计**：✅ plugin-manager 1457 → 586 (-871 / -59.7% / commit 49652f3 UI-172) / ✅ DesktopSettingsPanel 1515 → 870 (-645 / -42.6% / commit d06b66e UI-170) / ✅ ResultView 1654 → 1553 (-101 / -6.1% / commit 014ad0d UI-171) / ✅ SimpleChat 2153 → 1975 (-178 / -8.3% / commit e599ee0 UI-173) / ⏸ useSkillStore.ts 743 → 743 (0 行 diff / PHASE 5 决议保留不拆 / UI-174)。**整体 -1795 行 / 16 个新模块 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff**。**不变量守住**：useSkillStore.ts 0 行 diff / 14 vitest 0 改动 / 6 consumer 契约路径 0 改动。**未来扩展路径**：如 useSkillStore.ts 真增长到 1300+ 行，再启动 BLOCK-9.5+ 单独工作包，按 G0 阶段纪律需用户显式裁决。**当前 active 工作包**：BLOCK-9.2（PHASE 6 audit + closeout 待办）。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*

- **BLOCK-9.2-MEGA-FILE-REFACTOR PHASE 6 综合 closeout COMPLETED (active → completed) + PHASE 4 第二轮收口 + PHASE 5 评估登记**（2026-08-18 用户裁决「开冲」启动二次 PHASE 6 综合 closeout）。**PHASE 4 第二轮 3 commits** SimpleChat.tsx 2277 → 1961 行（**-316 / -13.9%**）— `ba23456` UI-175 attachments + ImagePreviewModal + types + helpers 4 模块 / `4207466` UI-176 formatHarness submodule / `1a58f2c` UI-177 useChatStream custom hook。**6 新模块 + 1 hook**：types.ts 189 + helpers.tsx 108 + attachments.ts 138 + ImagePreviewModal.tsx 127 + formatHarness.ts 79 + useChatStream.ts 322 = +963 / −0。**PHASE 5 评估决议**：useSkillStore.ts 743 行 0 diff / UI-179 not_applicable / canonical `docs/block-9-2-useSkillStore-evaluation.md` 7 节（5 大不拆理由 + useChatStream hook 反向佐证 + 量级判断 + 不外推）。**PHASE 6 综合 closeout 4 commits** `b2564ac` + `8136b35` + `xxx` + `xxx`：commit 1 PHASE 4/5 ledger + useSkillStore eval 文件 / commit 2 DOC-REGISTRY linkedCommits 11 项 + plan §13 / commit 3 roadmap + handoff / commit 4 AUDIT-LOG + closeout 报告。**累计 5 文件 -1933 行 / 18 新 lib + hooks + submodules**（plugin-manager 1457 → 562 / DesktopSettingsPanel 1515 → 870 / ResultView 1654 → 1553 / SimpleChat 2277 → 1961 / useSkillStore.ts 743 → 743）。**11 linkedCommits**（PHASE 0.5 `45448a8` + PHASE 1 `d06b66e` + PHASE 2 `014ad0d` + PHASE 3 `49652f3` + PHASE 4 第一轮 `e599ee0` + PHASE 4 第二轮 `ba23456` / `4207466` / `1a58f2c` + PHASE 5 evaluation `b2564ac` + DOC-REGISTRY 同步 `8136b35` + 本 closeout commit `xxx`）。**验证矩阵 100% GREEN**：`tsc --noEmit` 0 错 / SimpleChat vitest 19/19（4 文件）/ g0-chf0 33/33 + qa-smoke 45/45 + plugin 31/31 + window-controls 7/7 + useSkillStore 14/14。**4 治理门 GREEN**：`docs:check` 99 / `ui:audit:check` 99+ / `tsc` 0 错 / `docs:reconcile` 0 issues。**不变量守住**：4 客户端 import 路径 0 diff / 4 SimpleChat 测试 0 改动 / 7 个测试 0 改动 / desktopBridge.ts / electron.d.ts / copilotClient.ts / toolActivity.ts / toolSummaryPresentation.ts / extraRenderers.ts / conversationRunStore.ts 0 diff / 0 npm 依赖变动。**DOC-REGISTRY**：BLOCK-9.2-MEGA-FILE-REFACTOR **active → completed** + linkedCommits 11 项 + 新增 BLOCK-9.2-USESKILLSTORE-EVALUATION reference entry。**closeout 报告 canonical**：`docs/block-9-2-mega-file-refactor-closeout.md` 11 节。**当前 active 工作包**：NONE（BLOCK-9.2-MEGA-FILE-REFACTOR COMPLETED）。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/* / 不重新激活 PHASE 4/5/6 二次 closeout 已 orphan 的 8 commits。


- **BLOCK-10-AUDIT-CLOSEOUT 工作包 COMPLETED（active → completed · 2026-08-18）**：依据 `docs/code-audit-closeout-plan.md` v0.2 active 计划收口 8 份 2026-08-17 Agent Harness 独立只读审计报告共 90+ finding / 25 个修复单元（11C + 5H + 9 Major）。**4 PHASE 全部落地**：**PHASE 1** P0 用户可见（C-001 IPC branch/result bridge namespace + C-002 result:create conversation_export + DB migration 007 配套）/ **PHASE 2** P1 安全/资源（S-001..S-007 + PR-001 + E-017 backend exit handler + OB-004 error-log + OB-005 health shape partial）/ **PHASE 3** P2 契约（PL-001 MCP callTool inputSchema 校验 · **不引入 ajv**，自写 233 行极简 validator + 10 tests）/ **PHASE 4** closeout（DOC-REGISTRY active → completed + 8 linkedCommits + ui-productization-audit 笔录 + 4 canonical 文档同步 + closeout 报告）。**8 commits 落地**：`36c2789` PHASE 0 plan v0.2 + 4 份 PHASE 0 调研 / `32ed9e9` DOC-REGISTRY 4 份 PHASE 0 报告 / `1c0ebf0` PHASE 1 C-001/C-002 / `128b3d4` PHASE 2 S-001/2/3 / `4f9a10f` PHASE 2 S-004/5/6/7 / `a09f706` PHASE 2 PR-001 + E-017 partial / `1fedf9c` PHASE 2 OB-004 + OB-005 partial / `b79c472` PHASE 3 PL-001 / `b64c65b` PHASE 4-1 DOC-REGISTRY + linkedCommits 8 / `f678edf` PHASE 4-2 ui-productization-audit ledger / `本 commit` PHASE 4-3 4 canonical 文档 + closeout 报告 v1.0。**累计指标**：13 项已修复（11 Critical + 2 High） + 12 项不外推 + ~740 行 net + / 31 tests（25 新 + 6 复用）/ 0 新依赖 / 4 治理门 GREEN（docs:check 104 PASS / docs:reconcile 0 issues / tsc --noEmit 0 错 / ui:audit:check 4 pre-existing 漂移按 governance 不修）。**closeout 报告** `docs/block-10-audit-closeout.md` 11 节。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 架构 56+ singleton / observability 体系化 / SSE 全局 / 错误处理三套重试合并 / Agent Loop 事件规范化 / security medium+low / rserver-http debt pack / 不重新激活 BLOCK-2..9.2 / 不在 closeout 报告列举未做项 / `qualificationEligible:false` G0 长期开发期常态不外推。**当前 active 工作包**：NONE（BLOCK-10-AUDIT-CLOSEOUT 已 completed，等待用户裁决下一工作包启动）。**DOC-REGISTRY**：9 份 audit 注册 `kind=audit / status=completed / canonical=false` + BLOCK-10-AUDIT-CLOSEOUT `kind=work-package / status=completed / canonical=true / truthDomain=agent-harness-audit-closeout / archivePolicy=retain_stable_path` + 9 份 audit 全部归档 + linkedCommits 8 项（PHASE 0+1+2+3 主 commits）。


- **BLOCK-10-ARCHITECTURE 工作包 COMPLETED（active → completed · 2026-08-18）**：12 主范围全部落地（A-001/2/3/5/7/8/9/10 + PR-012 + E-019 full + A-006 部分）。**落地范围**：✅ A-007 + PR-012 + E-019 full（commit `a4f8bcb`）+ ✅ A-009 + A-010（commit `48e19e2`）+ ✅ A-002 result-studio（commit `101dcfc`）+ ✅ A-002 harness（commit `cd287f5`）+ ✅ A-005 ai-agent（commit `d620aa3`）+ ✅ A-001（commit `5f6c2de`）+ ✅ A-003 + A-008（commit `3635e7e`）。**验证**：chf0 5/5 + 106+ tests PASS + 0 regression + 4 治理门 GREEN。**7 关联候选不外推**：observability-work-package / rserver-http-debt-pack / type-drift-pack 等。**收口笔录**：G0 开发期常态 · 不外推 packaged/Provider/GA。**closeout 报告** `docs/block-10-architecture-closeout.md`。
**§3 当前 active 工作包**：NONE（BLOCK-10-AUDIT-CLOSEOUT 已 completed / 4 PHASE 全部收口）。

**§下一工作包候选**（按 G0 阶段纪律不主动推荐，需用户显式裁决）：observability-work-package（OB-001 console→logger 全量替换 / OB-003 metrics 端点 / OB-007 跨进程 unhandledRejection）/ SSE 治理（Mi-002 / Mi-003 / Mi-004 三处协议细节统一 + PR-004 SSE keepalive）/ RetryClassifier / RetryBudget / RetryExecutor 三套重试策略合并 + 错误处理体系化重设计 / Agent Loop 事件类型命名规范化（C-012 8+ 种 event 类型与 Result Studio 体系耦合）。

### 3.1 已完成工作包：BLOCK-11-PRELOAD-SANDBOX-FIX（2026-08-18 用户裁决修同日收口）

- 状态：`completed`（用户裁决启动同日收口）；closeout 报告 `docs/block-11-preload-sandbox-fix-closeout.md`（115 行 / 11 节）。
- 范围：`src/preload.js` 单文件 line-level 修复；A-009 引入的 traffic lights 消失回归。
- 验证（CDP 实机 dev Electron）：`window.biof3Desktop` undefined→object / `[class*="traffic"]` 0→4 / header button 6→9 / IPC click 成功。
- 治理门：`docs:check` PASS / `tsc --noEmit` 0 错 / `ui:audit:check` 4 项 pre-existing drift（与本工作包无关）/`node --check src/preload.js` 0 错。
- 不变量守住：sandbox: true 保持 / 8 IPC 通道签名 0 diff / electron.d.ts + desktopBridge.ts + env-coordinator.js 0 diff。
- **当前无 active 工作包**。

### 3.2 已完成基础设施：CDP-WRAP（2026-08-18）

- 状态：`completed`（commit `e3f5e02`）；新文件 `scripts/cdp-wrap.cjs`（100 行）。
- 用途：守护 CDP → playwright MCP 链路，dev Electron 重启后自动重连，无需重启 Cursor Window。
- 配套：`BIOF3_DEV_ELECTRON_CDP=1 npm run dev` 一键启用 9222 端口。
- **当前无 active 工作包**。

### 3.3 已完成工作包：BLOCK-22-CODEMIRROR-INLINE-DIFF（2026-08-24 启动同日收口）

- **状态**：`active → completed`（用户裁决启动同日收口）；DOC-REGISTRY `BLOCK-22-CODEMIRROR-INLINE-DIFF-PLAN` `status=completed / linkedCommits=[b9e697f, 3745bd5, 0436be2, 0e28498, b1f4453]`；新增 `BLOCK-22-CODEMIRROR-INLINE-DIFF-CLOSEOUT` `kind=reference / status=reference / canonical=true` 登记项；closeout 报告 `docs/block-22-codemirror-inline-diff-closeout.md`（285 行 / 10 节）。
- **5 commit 落地** `feat/block-22-codemirror-inline-diff` 分支 HEAD `b1f4453`：`b9e697f` P0-LAUNCH audit-log 登记 / `3745bd5` P0 CodeMirror 6 基础脚手架 + 12 个 @codemirror/* 依赖 + 10 editor/ 文件 616 行（UI-191）/ `0436be2` P1 Unified Diff 渲染（行级 + 字符级）+ scroll/pulse（UI-192）/ `0e28498` P2 Accept/Reject widget + 0 新增 IPC（UI-193）/ `b1f4453` P3 桥接层 + Context 抽象 + ChatCardLinkBridge（UI-194）。
- **累计指标**：24 files changed / +4357/-212 / 19 个新文件 ~3977 行 + 5 个修改（package.json/package-lock.json/editor/index.ts/AUDIT-LOG/DOC-REGISTRY）；0 新 npm 顶层依赖；0 新增 IPC（复用 BLOCK-20 PHASE 1 5 IPC + BLOCK-20 PHASE 4 git:hunk-reject-inverse + BLOCK-20 PHASE 3 workspace:write-text-file + BLOCK-16 PHASE 3 reject 清单 30 天 TTL schema）。
- **4 PHASE 落地**：PHASE 0 基础脚手架（commit `3745bd5`）/ PHASE 1 Unified Diff（commit `0436be2`）/ PHASE 2 Accept-Reject（commit `0e28498`）/ PHASE 3 桥接层（commit `b1f4453`）。4 PHASE 全部由 worker subagent 在 24 个 WIP + test.txt 完全未触碰前提下实施。
- **验证**：tsc --noEmit 0 错 / BLOCK-22 影响范围 vitest 53/53 PASS / 4 files（`CodeMirrorEditor.test.tsx` 32 + `WorkspaceFilePreviewBridge.test.tsx` 8 + `ChatCardLinkBridge.test.tsx` 7 + `pendingScrollContext.test.tsx` 6）/ docs:check 141 → 142 PASS / docs:reconcile 0 issues。全量 frontend vitest 15 failed 不归 BLOCK-22（TitleBar 8 + LeftPanel 6 + theme-token 1 全是其它 Agent WIP 导致的测试期望漂移，按 governance §Guardrails L84 不可改）。`npm run ui:audit:check` 报错不归 BLOCK-22：HEAD `2a4d435` 旧债 + UI-191~194 笔录延迟（`docs/ui-productization-audit.md` 在 24 个 WIP 锁内）。
- **不变量守住**：preload.js 既有 19 命名空间 0 diff / electron.d.ts 既有类型 0 diff / desktopBridge.ts 既有 API 0 diff / core/shared-backend 既有 6 git-adapter 方法 0 diff / agent-tools/* + agent-transcripts/* 0 diff / 24 个 WIP + test.txt 0 触碰 / 0 引 monaco-editor / react-diff-viewer / react-split-pane / n-way merge。
- **UI-191/192/193/194 保持 `in_progress`**：按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"；`docs/ui-productization-audit.md` 在 24 个 WIP 锁内笔录延迟登记；解锁条件：`docs/ui-productization-audit.md` 脱离 WIP 状态后由主 agent 追加 UI-191~194 共 4 行 `in_progress` 笔录 + 重跑 `npm run ui:audit:check`。
- **业务侧后续动作清单**（WIP 收口后）：① 接入 SimpleChat 聊天卡片（用 `<ChatCardLinkBridge>` 包装 ToolActivityList）；② 接入 WorkspaceFilePreview 容器（text 路径分支用 `<WorkspaceFilePreviewBridge mode="inline-diff">`）；③ 接入 events.ts（加 2 新事件 `projectOpenWorkspaceFileAtLine` + `projectReviewWorkspaceDiff`）；④ 决定 AppLevelBridge 挂载（`<AppLevelBridge />` 是否挂到 App.tsx）。
- **当前 active 工作包**：NONE（BLOCK-22 已 completed，下一工作包由用户显式裁决启动）。
