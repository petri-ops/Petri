# 全局未完成项计划表（Pending Work Backlog）

> 本台账是「所有已知未完成项」的唯一登记与推进序 canonical（truthDomain: `pending-work-queue`）。
> 职责分工：本台账管**全量队列与逐项推进序**；当前立即任务与 active 工作包仍由 [`next-steps-roadmap.md`](./next-steps-roadmap.md) 与对应 plan 文档决定（队首启动时 roadmap/handoff 同步一行，不复制队列）。
> 纪律：逐项推进＝**单工作包串行**，一项收口后才启动下一项；每项启动照常过工作包立项检查单（用户裁决留痕、登记三件套）；状态只在本表与对应 canonical 间同步，不另立第二进度文档。
> 标记图例：▶ 可执行排队项 · 👁 观察型（随使用累计）· 👤 用户事项（Agent 不代行）· 🗃 候选池（未排期，启动需裁决+立项）· ⛔ 阻塞/延期（外部条件）· ✅ 已核实销号（防重复入册）。

最后更新：2026-09-26（**HK-03 P0 勘察选型当日收口（队列头推进；选型文档 docs/hk03-symbol-graph-selection.md 登记 DOC-REGISTRY+README）**——盘点三产物：typescript 5.9.3 根 devDependency 在位（Compiler API 对 .ts/.tsx/.js/.cjs/.mjs 统一 AST 解析=完整满足）、dependency-cruiser 18.3.1（模块级无符号级）、knip 6.38.0（报告器非查询接口，盲区清单复用）；ts-morph 不在仓。**选型结论=方案 A 零新增依赖**（DEPENDENCY-CHANGE-CHECKLIST 默认「不增」天然满足；ts-morph 新增方案不推荐=仅人体工学收益；cruiser 为主方案不足=答不了「导入但未用」）。需求规格四要素+诚实盲区 UNRESOLVED 口径在文档 §1。**P1 开工待用户裁决**（红绿先行=HK-01 首次行使；回放校验=CK-11 批次四定性账对照集）。doc:suggest planDoc 建议=选型文档已登记承载，无需另立。）

此前 最后更新：2026-09-26（**HK-01+HK-02 制度化沉淀批当日收口（用户裁决「我们当前的HK是不是可以开始呢」=开工令；制度化/轻量包形态 AUDIT-LOG 条目即 plan；并行放行留痕=UI-444 会话活动中，按 BLOCK-104 先例本批只触 .agents/skills+台账、与其文件面零重叠）**——①**HK-01 红绿先行**节入 gewu-dev-infra：新行为契约/缺陷修复先落失败测试再实现，红→绿证据随收口笔录留痕；豁免四类（纯重构/纯类型面治理批/PoC/实机面）；不加新门禁（二次出现才按「回归→门禁转化」评估）+委派任务书第 4 节同步字段。②**HK-02 YAGNI 五问**入 gewu-code-review：维度 7「最小化」（不做/可复用/标准库可达/依赖必要/行数更少），六维度全线改称七维度+评审报告模板两处同步。素材源=Superpowers TDD/Ponytail 决策阶梯，改编内化非逐字移植（2026-09-20 用户裁决姿势）。门禁=hygiene/docs:check/ui:audit 绿；doc:suggest planDoc 建议（0.68>0.5）按轻量包形态先例不采纳留痕（BK-08 同款）；**实效验收=下一个实际工作包按红绿先行留痕+下一次评审报告行使维度 7**。**队列头=HK-03（符号图 P0 勘察选型）**，HK-04 垫后。）

此前 最后更新：2026-09-26（**HK 系列 harness 工程实践吸收批建表（用户裁决「需要改进…是否需要更详细和全面精准的改进队列项呢」；doc:suggest cloud 全通零建议如实附）**——外部 harness 六件套（OpenSpec/Superpowers/CodeGraph/Ponytail/Caveman/RTK）评估对照落四项推进序，性质=**开发 harness 层工程实践**（skills/治理/脚本），非产品工作包：**HK-01** TDD 红绿先行纪律入 gewu-dev-infra（红→绿证据随收口笔录留痕；豁免=纯重构/纯类型面/治理批/PoC；不加新门禁）→ **HK-02** YAGNI 五问阶梯入 gewu-code-review（最小化检查行；不引 Ponytail 插件）→ **HK-03** 符号图/导入边查询脚本两阶段（P0 选型走 DEPENDENCY-CHANGE-CHECKLIST；P1 落 scripts 查询+CK-11 批次四 35 条已定性边回放校验一致率判据）→ **HK-04** 能力级规格层勘察（front-matter goal/acceptance/reopen/status 四键草案+registry 增量；试点裁决点在用户；不引 OpenSpec CLI）。候选池 +C-13（符号图 MCP 产品化：重开=HK-03 收口+产品方向裁决）/+C-14（RTK 型输出压缩：重开=实测 token 痛点+ZCode hooks 适配验证）；Caveman 式输出压缩**评估不采纳销号**（与审计留痕文化冲突）。**队列头=HK-01（HK-02 可同批小刀）**。）

此前 最后更新：2026-09-26 晨（**BLOCK-121 开发态结果闭环垂直切片当日整包 completed（P0+P1+P2）**——deg/deseq2 路径 dev Electron 边界内 verified：真实 chat→模型自主 run_tool→R 真实执行→artifactTruth=valid→Studio「可信结果」徽标→Copilot 跨轮追问引用真实基因/数字（flow 20/20）；P1 抓真=run_tool 迁 session 域修复 tool-route 剔除断点+回归钉；P2=result_summary 有界只读工具（74 工具恒等）。**队列=无可推进项；下一步等用户输入**（候选池 scrna_standard 路径已登记重开条件）。）

此前 最后更新：2026-09-25 深夜四（**阶段切换：清债期收束，产品闭环期开启（用户裁决「可以的 开始吧 一次性搞定」三件套全部落地）**——①D7 领域中立红门清偿（interpret.js 校准文案合法定性入基线+面板卡注迁改对齐单源；2f1314a）②CK-11 保留面冻结为 knip 棘轮 quality:knip:check 入 closeout 十一门（c819f144）③**BLOCK-121 开发态结果闭环垂直切片立项 active（P0-LAUNCH）**。**队列头=BLOCK-121**。）

此前 最后更新：2026-09-25 晚七（**U-02/03/04 代行实机评估完成（用户授权+Jev 裁决 fit=3 PASS）：437/438/440 翻 verified、442 保持 in_progress 待长任务自然取证**。**队列全清；仅余 U-01（Jev key 轮换）待用户**。）

此前 最后更新：2026-09-25 晚六（**CK-09/10 收口——CK 表全部处置完毕，预授权队列全清**：01-07 完成 / 08 观察态 / 09 热调不开放销号（设计结论固化注册表）/ 10 遥测漏斗实施。观察态三项重开条件均在案（CK-02/CK-08/CK-05 内两项）。**当前无可推进队列项；用户事项 U-01~U-04 待用户**。）

此前 最后更新：2026-09-25 晚五（**CK-08 重估收缩：task_id 改造不建议做（16.25MB 冗余仍实但清扫有界+无感知收益+迁移风险大），转观察**。**队列头=CK-09（量表热调设计，低）**——CK 表渐近尾声。）

此前 最后更新：2026-09-25 晚四（**CK-07 收口：测试卫生小批（grants 遗留销号+block107-long flow 断言归位 7/7 全绿）**。**队列头=CK-08（task_id 数据模型改造，大）**——CK-09/10 低优先随序。）

此前 最后更新：2026-09-25 晚三（**CK-06 收口：C-11 ctx 拆分 refs/纯值（验证锚点达成 refs 74→34 污染根除；根基线 394→353；closeout 十门绿 + fit=3.56 PASS）**。**队列头=CK-07（测试卫生小批）**。）

此前 最后更新：2026-09-25 晚二（**CK-05 收口：SQLite 评估批（mmap64 已实施 −8.5%/−15%；node:sqlite 与三契约单源化不采纳，重开条件在案；报告 docs/ck05-sqlite-evaluation.md 登记）**。**队列头=CK-06（CenterPanelContext 拆分）**。）

此前 最后更新：2026-09-25 晚一（**CK-04 收口：C-04 分段 token 预算治理第一刀（closeout 十门绿 + fit=3.61 PASS）**——system-prompt 段级字符预算+计量报告+截断标注，旧签名零破坏；总预算裁剪与前端接线留观察。**队列头=CK-05（node:sqlite 评估/三契约单源化）**。）

此前 最后更新：2026-09-25 早十（**CK-03 收口：C-02 轮询→SSE 失效通知第一批 jobs 域（closeout 十门绿 + fit=3.73 PASS；UI-442 待过目）**——/api/events 通道+4 发布点+useInvalidationStream+两消费方接入，任务状态感知秒级；增量接入清单在 handoff。**队列头=CK-04（分段 token 预算）**。）

此前 最后更新：2026-09-25 早八（**CK-01 收口：C-06 运行中发送自动 steer 通道（Windows 侧当日立项当日收口；closeout 十门绿 + fit=3.77 PASS；UI-440 in_progress 待过目）**——send 的 isConversationRunning 分支由静默吞改为 POST task/:id/steer 自动入队（BLOCK-98 M4 既有通道零后端改动）+ onSteer 行内回执 4s 消退 + 失败回退文本保留 + 无 taskId 静默回归 + 按钮 title 显式化；设计裁决=即时 steer+回执（入队不可撤，「可撤销 2s」推荐形态修正）。契约 8/8（+3）+ 全量 147/1205 + tsc 0。双端协同=Mac 侧并行完成 BK-08（darwin 基线），rebase 合并 impact-map 双登记去重（decision-*.mjs 归 block118 通配）。**队列头=CK-02（长列表虚拟化）**。）

此前 最后更新：2026-09-25 早六（**BK-08=darwin 启动预算档建基线完成（Mac 会话首建；closeout 十门绿 + output:judge fit=3.36 PASS · jev×8）**——三轮 5 样本实测最差中位数 ×1.10 写入 platforms.darwin 七段档；契约测试 8→9；连带=TEST 实例三连修（dock.hide/并集外摆位/darwin 收尾清场）+ impact-map 两连补登（ui439 证据目录、decision-*.mjs 归类，均为远端提交 fail-closed 拦截）+ P6 源绑定重打 10/10（吸收 BK-03 以来 win32 侧陈旧，darwin-only P6 契约首跑 13/13 零 skip）。**队列头=CK-01 不变**，BK-08 移入已完成；本机无 Jev key 的环境事实已消除（用户会中提供 key，cloud 全通零降级）。）

此前 最后更新：2026-09-25 早五（**CK 推进系列建表（用户裁决「再检查检查是否不够齐全 之后像 BK 一样做个计划表 逐步推进所有的项目」）**——全仓二次盘点：候选池 11 + 新抓漏网 3（BLOCK-102 grants 测试 teardown 卫生 / BLOCK-106 mmap_size 评估并入 C-05 / qa-smoke 遥测漏斗 TODO）+ BK-08，编成 **CK-01~CK-10 逐项推进序**（用户预授权按表推进，项内产品语义裁决点仍单独问）；C-07/C-08/C-09 条件未满足不编入，D 区 G1+/证书/产品决策阻塞不编入；用户事项新增 U-04（UI-439 过目）。**队列头=CK-01（C-06 运行中发送走 steer 通道）**。）

此前 最后更新：2026-09-25 早四（**BK-07 全部完成（①② 按用户裁决「1 2 搞定」落地 + ③ 前刀完成；closeout 十门绿 + fit=3.76 PASS）**——①loadAssets 收窄 (entries, patterns)；②死状态拆除+currentVersion 复核推翻原判（已接线）。）

## 推进队列（串行，按序逐个推进）

> **CK 系列（2026-09-25 用户裁决）**：「像 BK 一样做个计划表，逐步推进所有的项目」=按本表逐项推进的预授权；每项启动仍走立项检查单，**项内产品语义裁决点单独问**。排序原则=用户可见价值 → 技术债卫生 → 评估/设计类；大改造与低优先项靠后。

> **HK 系列（2026-09-26 用户裁决）**：「需要改进…是否需要更详细和全面精准的改进队列项呢」=外部 harness 方法论（OpenSpec/Superpowers/CodeGraph/Ponytail/Caveman/RTK）吸收评估落成的推进序；性质=**开发 harness 层工程实践**（skills/治理/脚本），非产品工作包；排序原则=小刀规范类 → 工具类中刀 → 勘察裁决类；每项启动照常走立项检查单，项内裁决点单独问。

| 序 | ID | 事项 | 来源（证据指针） | 状态 |
| --- | --- | --- | --- | --- |
| 1 | ▶ HK-03 | **符号图/导入边查询脚本（中刀·开发工具·两阶段）**：P0 勘察选型=盘点 dependency-cruiser/knip/tsc 可复用产物，定「导入边精确分类」需求规格（CK-11 批次四方法论机械化：require/import 说明符解析+导入方符号核查→USED_PROD/USED_TEST/DEAD 三分类）；依赖裁决走 DEPENDENCY-CHANGE-CHECKLIST。P1 落地 `scripts/symbol-graph.mjs`（名随实现定）：who-imports \<symbol\> / classify-edges \<file\> 两查询 + **回放校验**（对 CK-11 批次四已定性导入边重放，与人工结论一致率为收口判据，分歧逐条留痕）+ 脚本自身契约测试入 test/（红绿先行 HK-01 首次行使）。**明确不做**=不建常驻索引服务、不做 MCP 产品化（转候选 C-13）、不引原生依赖（rust/tree-sitter）、不动 knip/dependency-cruiser 既有语义 | CK-11 批次四手工分类 78 条痛点实证（AUDIT-LOG 09-25 晚十二/深夜一）+ 外部 harness 评估 2026-09-26（CodeGraph 对照缺口）；**P0 选型结论=方案 A 零新增依赖（typescript Compiler API），docs/hk03-symbol-graph-selection.md 已登记** | **P0 收口；P1 开工待用户裁决** |
| 2 | ▶ HK-04 | **能力级规格层勘察（勘察+裁决类）**：P0=盘点 plan 文档 front-matter 现状 + DOC-REGISTRY schema + docs:check 规则面，产出「规格差量」映射设计稿（草案：goal/acceptance/reopen/status 四键 front-matter + registry 扩展 + docs:check 增量校验）落 docs/ 并登记 DOC-REGISTRY；**裁决点（用户）**=P1 是否试点（选 2-3 份 plan 文档结构化+门禁扩展）。**明确不做**=不引 OpenSpec CLI、不建第二 truthDomain、docs:check 只增量不动既有语义 | 外部 harness 评估 2026-09-26（OpenSpec delta 思想对照缺口：能力级行为要求散在 roadmap/plan/ui-audit/IPC registry 四处，工作包收口后无单点可查） | 待启动（垫后；勘察小，试点另裁） |
| — | ⛔ CK-08 | **C-03：task_id 数据模型改造——重估收缩转观察**：动机仍实（45 万行 UUID 冗余 16.25MB/库 14%）但 30 天清扫有界+无用户感知收益+契约迁移风险大（7+29 文件）；**重开条件=清扫上限内实测 I/O 痛点或库体积成用户可感知问题** | 本批重估数据（AUDIT-LOG 晚五行） | 观察待证据 |
| — | 👁 BK-02 | **汇报门 P2 试点观察期盘点**（持续观察，不占队列序）——采纳率/误拦率/延迟增量/fitReplay 触发率随真实轮次累计；观察窗开启中（dev 栈 BIOF3_JEV_REPORT_GUARD=1） | BLOCK-119 收口遗留候选 | 观察（持续） |

## 已完成（本表排队项收口记录）

| ID | 事项 | 收口 |
| --- | --- | --- |
| ✅ HK-01 | **TDD 红绿先行纪律入 gewu-dev-infra（制度化沉淀）** | 2026-09-26 当日收口：SKILL.md 增「红绿先行」节（适用=新行为契约/缺陷修复先落失败测试，红→绿证据随收口笔录留痕；豁免四类=纯重构/纯类型面治理批/PoC/实机面；不加新门禁，二次出现才按「回归→门禁转化」评估）+委派任务书第 4 节同步字段；素材源=Superpowers TDD 改编内化；**实效验收=下一个实际工作包留红→绿证据**；门禁=hygiene/docs:check/ui:audit 绿 |
| ✅ HK-02 | **YAGNI 五问阶梯入 gewu-code-review（制度化沉淀）** | 2026-09-26 当日收口：维度 7「最小化」五问（不做/可复用/标准库可达/依赖必要/行数更少，引入依赖或并造第二实现可达 P1）+六维度全线改称七维度（顺序节/时机节/独立性节）+评审报告模板两处同步（维度行/收尾核对行）；素材源=Ponytail 决策阶梯改编内化非逐字移植；**实效验收=下一次评审报告行使维度 7** |
| ✅ BLOCK-121 | **开发态结果闭环垂直切片（P0+P1+P2）** | 2026-09-26 当日整包收口：选定 deg/deseq2 路径 dev Electron verified——flow block121-result-loop **20/20**（真实 chat→模型自主 run_tool→R 真实执行→artifactTruth=valid→Studio「可信结果」徽标→Copilot 跨轮追问引用真实基因/数字）；P1 抓真修复=run_tool 迁 session 域（tool-route 域收窄剔除执行入口的断链+回归钉，ee626e4b）；P2=result_summary 有界只读工具（B1 跨轮引用断点，74 工具恒等，b508bb89）；plan=docs/block-121-result-loop-vertical-plan.md |
| ✅ BK-01 | 汇报门 fit 分数轮间波动治理（BLOCK-119 加映 4） | 2026-09-24 当日收口：fitReviewBand=0.5 邻域重放 median-of-3（θ 不动/带外零开销/fail-open 不变），契约 24/24 + closeout 十门绿 + 实机真 spawn 轮 fitReplay 端到端；证据=acceptance/block-119/{fit-volatility-review,jiaying4-live}.json，plan=block-119 plan 加映 4 |
| ✅ BK-03 | 终态对账 v2：条目级归属（BLOCK-120） | 2026-09-24 当日收口：todoRefs 声明制 linkage（快照校验/丢弃回传/params 落库零 migration）+ item_level_mismatch 条目级对账向后兼容；契约 +11（block49+7/reconcile+4）+ 实机 todoRefs 落库零假阳性；plan=docs/block-120-reconciliation-linkage-plan.md §7，证据=acceptance/block-120/live.json |
| ✅ BK-04 | agent 可见决策工具（BLOCK-116 W2 轻量批） | 2026-09-24 当日收口：decision_summary/decision_recent 只读观测工具（decision-log 单源直调，工具 71→73 三面同步）；实机真模型自主调用正确作答；证据=acceptance/block-116/w2-agent-tools-live.json，台账=UI-437 v5.20 |
| ✅ BK-05 | 阈值热调统一（BLOCK-116 W2 轻量批） | 2026-09-24 当日收口：topic-shift/knowledge-guard 闸门迁 getPointRuntime（常量漂移退役）+ gates 键级 patch 四层校验；BLOCK-110~113 接点热调全通；实机七断言全过；证据=acceptance/block-116/bk05-gates-hot-tune-live.json |
| 🔁 BK-06 | Batch-8 第一刀：require-await 族（非整项收口，长线续批中） | 2026-09-24 当日收口：生产 35 条 stub 契约化直返 + 测试安全回调 5 条；替身 147 条承重 async 误报豁免保留；根基线 947→907 + frontend 本地基线化石删除；tsc 0 + 前端全量 147/1201 绿 + closeout 十门绿；教训=测试替身 async 不可机械摘（promise 契约+微任务让渡双承重） |
| 🔁 BK-06 | Batch-8 第二刀：类型面双族（非整项收口，长线续批中） | 2026-09-24 当日收口：no-base-to-string 36（project-store 25 + parse 11，typeof 守卫）+ no-redundant-type-constituents 22（字面量联合塌缩留值域注释）；根基线 907→849；tsc 0 + 全量 147/1201 + 定向 44/384 + closeout 十门绿；教训=String((x as string)) 直投触发 no-unnecessary-type-assertion 互锁 |
| 🔁 BK-06 | Batch-8 第三刀：unsafe-member-access result-studio 域簇（非整项收口，长线续批中） | 2026-09-24 当日收口：生产 29（信封 Record+typeof / json() 一次性信封断言）+ 测试 41（vi.fn 泛型签名/mockImplementation 回调类型/JSON.parse 断言）；根基线 849→752（−97=真修 70+陈旧槽位 27）；tsc 0 + 全量 147/1201 + closeout 十门绿；抓真=unknown 直投 as 判冗余、chore(lint) 类型豁免先例 |
| 🔁 BK-06 | Batch-8 第四刀：no-unsafe-member-access 全族收官（非整项收口，长线续批中） | 2026-09-24 当日收口：残余 81 条清零（生产 19 文件 66 + 测试 8 文件 15），族 151→0；根基线 752→616（−136=真修 81+漂移 55）；tsc 0 + 全量 147/1201 + closeout 十门绿；教训=判别联合信封与 eslint 类型信息不一致时改 Record 承载+返回处一次断言 |
| 🔁 BK-06 | Batch-8 第五刀：set-state-in-effect 定性 + no-unsafe-assignment 近清零（非整项收口，长线续批中） | 2026-09-24 当日收口：set-state-in-effect 三形态定性（C 示范修复 2 + A/B 99 豁免留痕）+ no-unsafe-assignment 真修 17（余 7 匹配器豁免）；根基线 616→597；tsc 0 + 全量 147/1201 + closeout 十门绿；教训=注解赋值触发 no-unsafe-assignment 而 cast 形态不触发 |
| 🔁 BK-06 | Batch-8 第六刀：promise 三族收官 + refs 定性（非整项收口，长线续批中） | 2026-09-25 收口：floating-promises 41→0 + misused-promises 41→2（真修 39）+ unsafe-argument 4→0 + refs 74 定性豁免（C-11 登记）；根基线 597→515；tsc 0 + 全量 147/1201 + closeout 十门绿 |
| 🔁 BK-06 | Batch-8 第七刀：tail 十八族收官（非整项收口，长线） | 2026-09-25 收口：配置双修（build globals+allowEmptyCatch）/unknownText 共享辅助 24 站点/联合塌缩 31/rules-of-hooks 4 真修/豁免定性 47/fileURLToPath 真缺陷补齐；根基线 515→397；tsc 0 + 全量 147/1201 + closeout 十门绿 |
| ✅ BK-06 | **BLOCK-105 §7 Batch-8 整包（七刀）** | 2026-09-25 整包收官：基线 947→395（−552），可清族全部归零，剩余 395 全为书面定性豁免类；豁免清单与六条机制教训见 handoff/整包声明；C-11（ctx 拆分）登记候选池 |
| ✅ BK-07 | **BLOCK-105 Batch-4 抓真三件处置** | 2026-09-25 全部完成：①loadAssets 五参化石收窄 (entries, patterns)（四调用点同步）；②_jobMeta/_selectedSectionId 死状态整体拆除+currentVersion 复核推翻原判（已接线，Batch-4 盘点路径有误）；③copilotAsk 断言补齐；tsc 0+全量 147/1202+closeout 十门绿 |
| ✅ CK-03 | C-02：轮询→SSE 失效通知第一批（jobs 域） | 2026-09-25 当日收口：/api/events 通道+4 发布点+useInvalidationStream+两消费方接入（15s→60s 兜底）；契约 4/4 + 全量 147/1205 + 实机 hello + closeout 十门绿；UI-442 待过目；增量接入清单在 handoff |
| ✅ CK-04 | C-04：分段 token 预算治理第一刀 | 2026-09-25 当日收口：system-prompt 段级字符预算（SECTION_CHAR_BUDGETS）+段计量报告+截断标注，旧签名零破坏（黄金对照+回归 22/22）；契约 5/5 + closeout 十门绿 + fit=3.61 PASS；总预算裁剪与前端接线留观察 |
| ✅ CK-05 | C-05：node:sqlite 评估 / 三契约单源化 / mmap 裁决 | 2026-09-25 当日收口：mmap64 实施（−8.5%/−15% 两轮稳定）+ node:sqlite/三契约不采纳（数据与重开条件在 docs/ck05-sqlite-evaluation.md）；closeout 十门绿 + fit=3.76 PASS |
| ✅ CK-06 | C-11：CenterPanelContext 拆分 refs/纯值两对象 | 2026-09-25 当日收口：CenterPanelRefs 独立 props+SessionFrameView prop 化；验证锚点=refs 74→34 污染根除实证，根基线 394→353；tsc 0 + 全量 147/1205 + closeout 十门绿 + fit=3.56 PASS |
| ✅ CK-07 | 测试卫生小批 | 2026-09-25 当日收口：grants teardown 遗留销号（资源自洽+runner 怪癖定性）+ block107-long flow 断言职责归位（7/7 全绿）；closeout 十门绿 + fit=3.68 PASS |
| ✅ CK-09 | C-10：output-judge 量表热调设计 | 2026-09-25 设计结论=**不开放**（fitPass/fitRetry 为校准最优解非环境参数+质量门热调纯风险+RETRY/ESCALATE 承载边界）；固化 decision-thresholds.js 注释；销号 |
| ✅ CK-10 | 遥测漏斗事件（qa-smoke TODO） | 2026-09-25 实施：src/telemetry-funnel.js 纯函数白名单+telemetry.js reportEvent（最小 payload 同隐私原则）+app_started 示范接线+qa-smoke TODO 转断言（7/7）；诚实边界=5 上报点待遥测端点上线 |
| ✅ BK-09 续 | electron-builder 26.15.3 major 升级（用户问「是否适合」裁决=适合） | 2026-09-25 当日收口：audit 10→2（critical tar+工具链 8 HIGH 清零）；G0 验证面全验（CLI/钩子语法/回归）；notarize 隔离论证（自有 v2 CJS）；真打包回归待 G1 |
| ✅ BK-09 | quality:baseline 重扫 + audit 处置 | 2026-09-25 当日收口：audit 32→10（−22，安全修 9+frontend 清零+回归 147/1205 绿）；剩余三族登记（工具链族 G1 打包期/extract-zip 待上游/uuid v4 不受影响）；jscpd 2.56% 收档；knip→CK-11 登记；连带修 baseline 脚本 secret 调用 bug |
| ✅ CK-01 | C-06：composer 运行中发送自动改走 steer 通道 | 2026-09-25 当日收口（Windows 侧）：isConversationRunning 分支改造（steer 入队+行内回执+失败回退+title 显式化）；设计裁决=即时 steer+回执（入队不可撤）；契约 8/8 + 全量 147/1205 + closeout 十门绿 + fit=3.77 PASS；UI-440 in_progress 待过目 |
| ✅ BK-08 | **darwin 启动预算档建基线** | 2026-09-25 当日收口：Mac 会话（darwin arm64/Node v24.16.0/项目数 4）三轮 5 样本实测，最差中位数 ×1.10（ceil）写入 platforms.darwin 七段（mainReady 46/preload 371/domContentLoaded 219/firstPaint 326/windowShown 577/didFinishLoad 578/dataReady 539）；教训=两轮基线被第三轮复跑判红 2 段（轮间中位漂移 ~15%）；契约测试 8→9；终轮 budget.pass=true violations=0；closeout 十门绿 + fit=3.36 PASS；连带=TEST 实例三连修 + impact-map 两连补登 + P6 重打 10/10（darwin-only P6 契约 13/13 零 skip）；证据=acceptance/block-101/block101-startup-timeline.json |

## 👤 用户事项（Agent 不代行，仅登记与提醒）

| ID | 事项 | 说明 |
| --- | --- | --- |
| U-01 | **Jev key 轮换裁决** | 运行时抓真：decision-config.json 旧 Jev key 已失效（auth_failed→汇报门降级放行，fail-open 语义正确行使），备份 env 的有效 key 已按「只读不回显」纪律同步入 config；现 config 与备份双 key 并存且旧者已死。此前裁决「暂保留后续轮换」，轮换时机由用户定 |

## 🗃 候选池（未排期；启动均需用户裁决 + 立项）

| ID | 事项 | 重开条件 / 来源 |
| --- | --- | --- |
| C-01 | 长列表虚拟化——**已编入 CK-02 → 勘察收缩转观察（2026-09-25：cv 与 prepend 锚定结构性冲突，CSS 回退零残留；重开=用户实测卡顿报告，届时带实验数据选型 react-virtuoso 或重写锚定后 cv 重试）** | BLOCK-106/107 遗留候选 |
| C-12 | **scrna_standard 结果闭环路径**（BLOCK-121 出局项转候选）：seurat-standard/scanpy-advanced 在 `../gewu-pack-bio/plugins.dormant/` 休眠且包内无 scrna 演示数据；重开条件=dormant 激活 + scrna 演示数据入库 + Seurat/scanpy 运行时库在位实证；届时 BLOCK-121 的 flow/工具面（result_summary）直接复用 | BLOCK-121 P0 勘察登记 |
| C-13 | **符号图 MCP 产品化**（HK-03 产出后评估）：把 symbol-graph 查询注册为产品 MCP 工具（格物 agent 的代码理解能力） | 重开条件=HK-03 P1 收口 + 用户产品方向裁决（立项三件套照常）；来源=HK 建表批 2026-09-26 |
| C-14 | **RTK 型工具输出压缩**（ZCode hooks 适配 shell 输出压缩，社区口径 60-90%） | 重开条件=实测 token 成本成为痛点 + ZCode hooks 适配验证可行；来源=HK 建表批 2026-09-26 |
| C-02 | 轮询→SSE——**已编入 CK-03** | BLOCK-106 遗留候选 |
| C-03 | task_id 数据模型改造——**已编入 CK-08** | BLOCK-106 遗留候选 |
| C-04 | 分段 token 预算——**已编入 CK-04** | BLOCK-109 候选池 |
| C-05 | node:sqlite 评估 / 三契约单源化——**已编入 CK-05**（吸收 BLOCK-106 mmap 裁决） | BLOCK-109 候选池 |
| C-06 | composer 运行中发送自动改走 steer 通道——**已编入 CK-01** | BLOCK-98 M4 后端通道已有（POST task/:id/steer），UI 未接线 |
| C-07 | Laya 接点翻转重校准 | 重开条件＝门控语义改换（top-probability）属决策契约变更另裁；BLOCK-117/118 裁决＝三接点维持 Jev |
| C-08 | roadmap/handoff/auditLog 文档回写预测 | 重开条件＝工作流语境 state 证据补齐（BLOCK-118 终裁＝当前证据不支持，静默） |
| C-09 | capability-provisioning 共享下载 helper | 🟡建议：host 白名单已修；共享 helper 只在改动该能力时评估（AUDIT-LOG 2026-07-17） |
| C-10 | output-judge 0-4 量表多闸门热调——**已编入 CK-09** | BK-05 非范围登记 |
| C-11 | CenterPanelContext 拆分 refs/纯值两对象——**已编入 CK-06** | react-hooks/refs 74 条豁免的结构性修复（BK-06 第六刀定性时登记） |
| ✅ CK-11 | knip 死代码清理大批（BK-09 重扫登记）——**completed（2026-09-25 六批收口；用户逐批「继续/开」授权；closeout 六轮十门绿）** | 总账：knip 虚高 1078→**实测 61 收敛至保留面**，累计清理约 **220 条真实死导出 + 11 个死文件**；方法论三件套=①workspaces 别名修正（frontend/lib 簇 31 条误报根除）→②逐案词法 grep（frontend TS 面）→③导入边精确分类（JS 同名密集区词法全假证据）+测试网兜底；**保留面全数定性**=.agents dev-verify flows 34（verify runner 按路径动态调用入口）+acceptance 证据脚本 3+USED_PROD 40+USED_TEST 3（懒 require/resources 插件 require 盲区）+测试强制契约 4（getRuntimeBinName 源码扫描守卫/BLOCK-84+A-009.7 直测/FUNNEL_EVENTS CK-10 契约直测）；批次账=①authClient 14 ②frontend 90（232→142）③揭洋葱 29（139→110）④src CJS 30（110→80）⑤文件 11 删+族 12（80→62）⑥洋葱定性 1+47（62→61） |

## ⛔ 阻塞/延期（🟡 在册维持；G0 纪律不外推，重开条件见 AUDIT-LOG 对应行）

| ID | 事项 | 阻塞点 |
| --- | --- | --- |
| D-01 | G0-RS-P7 Honest Product Requalification | 🟡延期（G1+ 资格工作；七项前置在册） |
| D-02 | macOS G0 视觉证据唯一性缺口 | 🟡待评估（重开条件＝任何对外发布/资格声明前；修补检查脚本会使 G0 门变红需先获批） |
| D-03 | Windows 代码签名 | 🟡延期（阻塞于代码签名证书） |
| D-04 | i18n 资源抽离 | 🟡延期（阻塞于国际化产品决策） |

## ✅ 已核实销号（防重复入册）

- **Caveman 式输出压缩**（2026-09-26 外部 harness 评估）——不采纳：极简表达与审计留痕/收口笔录/诚实边界文化直接冲突；子代理中间过程理论可用但收益薄、无落地场景。防重复入册。
- **U-02/U-03/U-04 实机过目**（2026-09-25）——用户授权 Agent 代行评估 + Jev 裁决（fit=3 PASS）：UI-437/438/440 翻 verified（真实 spawn 任务轮取证 acceptance/ui-eval-agent/）；UI-442 保持 in_progress（运行稳态证据待长任务自然产生，不凑证据）。
- **灰度开关翻默认裁决**（BIOF3_SERVER_HISTORY_ASSEMBLY / SESSION_COMPACTION / AGENT_RESILIENCE）——`core/biof3-server/helpers/feature-flags.js` `FLAG_DEFAULTS` 现全为 `true`（Git 事实），handoff 2026-09-17「翻默认待用户显式裁决（呈报中）」记载已过时。
- **汇报门重写丢运行中 steering 指令行**（AUDIT-LOG 🟡 2026-09-23）——BLOCK-119 加映 3 已修（report-guard steeringLines + 重写 prompt「必须逐字保留」段 + 契约），该 🟡 行已从 AUDIT-LOG 待处理表清除。
