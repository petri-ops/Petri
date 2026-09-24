# 全局未完成项计划表（Pending Work Backlog）

> 本台账是「所有已知未完成项」的唯一登记与推进序 canonical（truthDomain: `pending-work-queue`）。
> 职责分工：本台账管**全量队列与逐项推进序**；当前立即任务与 active 工作包仍由 [`next-steps-roadmap.md`](./next-steps-roadmap.md) 与对应 plan 文档决定（队首启动时 roadmap/handoff 同步一行，不复制队列）。
> 纪律：逐项推进＝**单工作包串行**，一项收口后才启动下一项；每项启动照常过工作包立项检查单（用户裁决留痕、登记三件套）；状态只在本表与对应 canonical 间同步，不另立第二进度文档。
> 标记图例：▶ 可执行排队项 · 👁 观察型（随使用累计）· 👤 用户事项（Agent 不代行）· 🗃 候选池（未排期，启动需裁决+立项）· ⛔ 阻塞/延期（外部条件）· ✅ 已核实销号（防重复入册）。

最后更新：2026-09-24 深夜一（**队列推进 1/8：BK-01 收口（BLOCK-119 加映 4，closeout 十门全绿）**——fit 阈值邻域复核落地：fitReviewBand=0.5 + median-of-3 重放 + fitReplay 观测面，实机真 spawn 轮端到端（详见 plan 加映 4 收口行）；BK-02 观察期首盘点并入其 P0。**队列头=BK-03（终态对账 v2 条目级 linkage）**。）

## 已完成（本表排队项收口记录）

| ID | 事项 | 收口 |
| --- | --- | --- |
| ✅ BK-01 | 汇报门 fit 分数轮间波动治理（BLOCK-119 加映 4） | 2026-09-24 当日收口：fitReviewBand=0.5 邻域重放 median-of-3（θ 不动/带外零开销/fail-open 不变），契约 24/24 + closeout 十门绿 + 实机真 spawn 轮 fitReplay 端到端；证据=acceptance/block-119/{fit-volatility-review,jiaying4-live}.json，plan=block-119 plan 加映 4 |

## 推进队列（串行，按序逐个推进）

| 序 | ID | 事项 | 来源（证据指针） | 状态 |
| --- | --- | --- | --- | --- |
| 1 | ▶ BK-03 | **终态对账 v2：条目级归属**——任务清单条目与子任务无结构化 linkage，v1 只能粗粒度核对（「N/M 失败但清单全完成」告警）；做数据模型 linkage（todo 条目 ↔ spawn 子任务，migration additive）升级为条目级归属对账 | BLOCK-109-ORCH-UX 批 v1 诚实边界 + roadmap 排队候选（「终态对账条目级归属（待数据模型 linkage）」） | **队列头（下一项）** |
| 2 | ▶ BK-04 | **agent 可见决策工具**（BLOCK-116 W2 剩余）——让 agent 会话内可查/用决策台账（decision_log/summary 面的 agent 工具化） | BLOCK-116 收口候选池 + roadmap「W2 剩余」 | 排队 |
| 3 | ▶ BK-05 | **阈值热调**（BLOCK-116 W2 剩余）——阈值注册表的运行时调整面；「改阈值必先重校准」红线由既有契约承载 | 同上 | 排队 |
| 4 | ▶ BK-06 | **BLOCK-105 §7 Batch-8：lint 抑制基线收缩**——剩余 ~956 条语义批（require-await 187 / set-state-in-effect 100 / refs 74 / exhaustive-deps 70 / base-to-string ~59 / unsafe 残尾等），逐案推进、每批棘轮收紧；**唯一无需新裁决即可续接的已登记工作**，可作长线在收口间隙续批 | roadmap/handoff「无需新裁决即可续接」段（Batch-7 后基线 956） | 排队（长线） |
| 5 | ▶ BK-07 | **BLOCK-105 Batch-4 抓真 3 件处置**——①Office `loadAssets` 五参签名化石（收窄需单独裁决）②`ResultArtifactShell` `_jobMeta`/`_selectedSectionId` + `ResultStudioPage` `currentVersion` 只写不读＝结果元信息与版本投影停在未接线态（**交产品裁决**）③`SideChatDock.test` 头注声称覆盖 copilotAsk 实际无断言（小修） | AUDIT-LOG 2026-09-20 Mac 会话之五第 5 条 | 排队（②需用户裁决） |
| 6 | ▶ BK-08 | **darwin 启动预算档建基线**——`block101-startup-timeline` 首跑因缺 `platforms.darwin` 档判红（设计行为非故障）；需 Mac 会话采 5 样本建基线，禁止复制 win32 数字 | BLOCK-106 遗留 + handoff ⚡ 清单 | 排队（需 Mac 环境） |
| — | 👁 BK-02 | **汇报门 P2 试点观察期盘点**（持续观察，不占队列序）——采纳率/误拦率（含误重写率）/延迟增量/fitReplay 触发率随真实轮次累计；首盘点已并入 BK-01 P0（decision_log report-guard 行 + fit-volatility-review.json）；观察窗开启中（dev 栈 BIOF3_JEV_REPORT_GUARD=1）。此后周期性盘点 | BLOCK-119 收口遗留候选 | 观察（持续） |

## 👤 用户事项（Agent 不代行，仅登记与提醒）

| ID | 事项 | 说明 |
| --- | --- | --- |
| U-01 | **Jev key 轮换裁决** | 运行时抓真：decision-config.json 旧 Jev key 已失效（auth_failed→汇报门降级放行，fail-open 语义正确行使），备份 env 的有效 key 已按「只读不回显」纪律同步入 config；现 config 与备份双 key 并存且旧者已死。此前裁决「暂保留后续轮换」，轮换时机由用户定 |
| U-02 | **UI-437 v5.13–v5.19 实机过目** | 行级复制钮归位/思考行同族/耗时降噪/动词图标注册表等七批增量已实装，待用户实机过目翻 verified（Agent 不代行） |
| U-03 | **UI-438 子智能体行内呈现实机过目** | 组卡下线→时间线行内 bot 图标行，待子智能体任务实机过目 |

## 🗃 候选池（未排期；启动均需用户裁决 + 立项）

| ID | 事项 | 重开条件 / 来源 |
| --- | --- | --- |
| C-01 | 长列表虚拟化 | 前置证据已备（BLOCK-107 帧时基线转交）；BLOCK-106/107 遗留候选 |
| C-02 | 轮询→SSE | BLOCK-106 遗留候选 |
| C-03 | task_id 数据模型改造 | BLOCK-106 遗留候选 |
| C-04 | 分段 token 预算 | BLOCK-109 候选池（压缩机制零重复，BLOCK-95/98 已交付基础） |
| C-05 | node:sqlite 评估 / 三契约单源化 | BLOCK-109 候选池 |
| C-06 | composer 运行中发送自动改走 steer 通道 | BLOCK-98 M4 后端通道已有（POST task/:id/steer），UI 未接线；handoff 待用户事项登记的 UI 候选 |
| C-07 | Laya 接点翻转重校准 | 重开条件＝门控语义改换（top-probability）属决策契约变更另裁；BLOCK-117/118 裁决＝三接点维持 Jev |
| C-08 | roadmap/handoff/auditLog 文档回写预测 | 重开条件＝工作流语境 state 证据补齐（BLOCK-118 终裁＝当前证据不支持，静默） |
| C-09 | capability-provisioning 共享下载 helper | 🟡建议：host 白名单已修；共享 helper 只在改动该能力时评估（AUDIT-LOG 2026-07-17） |

## ⛔ 阻塞/延期（🟡 在册维持；G0 纪律不外推，重开条件见 AUDIT-LOG 对应行）

| ID | 事项 | 阻塞点 |
| --- | --- | --- |
| D-01 | G0-RS-P7 Honest Product Requalification | 🟡延期（G1+ 资格工作；七项前置在册） |
| D-02 | macOS G0 视觉证据唯一性缺口 | 🟡待评估（重开条件＝任何对外发布/资格声明前；修补检查脚本会使 G0 门变红需先获批） |
| D-03 | Windows 代码签名 | 🟡延期（阻塞于代码签名证书） |
| D-04 | i18n 资源抽离 | 🟡延期（阻塞于国际化产品决策） |

## ✅ 已核实销号（防重复入册）

- **灰度开关翻默认裁决**（BIOF3_SERVER_HISTORY_ASSEMBLY / SESSION_COMPACTION / AGENT_RESILIENCE）——`core/biof3-server/helpers/feature-flags.js` `FLAG_DEFAULTS` 现全为 `true`（Git 事实），handoff 2026-09-17「翻默认待用户显式裁决（呈报中）」记载已过时。
- **汇报门重写丢运行中 steering 指令行**（AUDIT-LOG 🟡 2026-09-23）——BLOCK-119 加映 3 已修（report-guard steeringLines + 重写 prompt「必须逐字保留」段 + 契约），该 🟡 行已从 AUDIT-LOG 待处理表清除。
