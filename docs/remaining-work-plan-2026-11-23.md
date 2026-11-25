---
capability: remaining-work-plan-2026-11-23
status: active
kind: living-plan
canonical: true
truthDomain: remaining-work-queue
entrypoint: docs/README.md
registeredAt: 2026-11-23
owner: main-agent
goal: 用户「没做的可以规划一下 / 这个计划也 push」——现读 canonical 后一次列全剩余未做项，按可自推/等用户裁决/等外部条件/已 done 未翻状态四类归档，作为后续逐项发令的单一入口。不占串行工作包槽位、不自动开工。
phase: G1-in-progress (G0 permanent maintained)
---

# 剩余工作规划（2026-11-23 现读基线）

> 发令：用户「没做的可以规划一下」+「push，这个计划也 push」。本文件是**规划入口**（living-plan），非工作包、不占串行槽位；任何项开工仍需用户发令。
> 基线：Q-MATRIX ✅95·🟡0·🔴0·⛔7=102；串行槽位空；两仓 0/0；AUDIT-LOG 头部最后=C-56 网络素材稿件 completed。
> 证据源：`docs/AUDIT-LOG.md`、`docs/pending-work-backlog.md`、`docs/ui-productization-audit.md`、`docs/DOC-REGISTRY.json`、`docs/c56-paper-writing-manual-draft-2026-11-19.md`（code-explorer 现读 37 工具调用）。

## A. 可 Agent 自推

**空**。代码待办清零（P6 全链 passed、🟡9 九项全收口、C-56 双链路已验）、状态归位已推完、串行槽位空。无新实现项可自推——不自造工作。

## A2. 已排期未开工（BLOCK-520 harness 可观测性，2026-11-25 新增）

| 项 | 排期 | 体量 | 证据 |
|---|---|---|---|
| BLOCK-520 OB-001/004/007 → OB-002/003/005 → OB-008/009 | P0 让失败可见 → P1 链路可追/状态可量 → P2 控制闭环；逐波发令、单工作包串行，第 9 项外部监督器单列 U 类待裁 | P0 S~M / P1 M / P2 M+待裁 | `docs/block520-harness-observability-plan.md`（含 §1 核码纠偏）；`acceptance/harness-observability/U-EXTERNAL-SUPERVISOR.md`（pending_user_ruling） |

## B. 等用户单一裁决（8 项）

| 项 | 等什么 | 体量 | 证据 |
|---|---|---|---|
| C-50 跨机 7×24 中心调度 | 场景裁决（共享工作区/常驻节点/Web 入口）+ 先答「中心权限边界到哪、本地主权从哪开始」，才立项 BLOCK | L | backlog:303 |
| ~~C-56 真实稿件改写~~ **已执行 2026-11-24** | 用户给 `petri-informal-paper.md`（自有英文稿），按 §9 通用保内核跑完三栏对照/四保护/未覆盖、不落盘；证据 `acceptance/c56-user-manuscript/` | S | manual:76-78 / registry:13559 |
| ~~C-56 英文论文另批~~ **已执行 2026-11-24（B 方案）**：E 类六项并入手册 §11（裁决原话留痕）；对用户英文稿跑 §9 全链 E 类扫描 0/6 命中（零改写建议、原文一字未动，记录见 `acceptance/c56-english-surface/B-EXECUTION.md`） | M | manual §11 / B-EXECUTION |
| D-04 i18n 资源抽离 | 是否国际化/哪些语言/react-i18next 还是自研 | L | AUDIT-LOG:190 / backlog:351 |
| ~~G0 qualified 视觉证据~~ **已执行 2026-11-24** | `distinctStates` 唯一性断言已实现（HK-01 3/3 绿）；`g0:qualification:visual` 实机**诚实红**（5 PNG 4 唯一态）维持「不补拍不伪造」裁决，等用户对实机红处置 | M | AUDIT-LOG 2026-11-24 B-CLASS 行 / backlog:349 |
| ~~C-32 `env='1'` 语义~~ **已清偿（BLOCK-211，2026-11-24 核码归位）** | 实现已按注释语义修正（`8a0731672`，2026-10-18），真相表 12/12 绿；登记滞后不开新包 | M | backlog:371 |
| ~~UI-706/707/709/710~~ **已执行 2026-11-24** | 口径已按台账 verified 翻正 BLOCK 登记行（pending_human_eye 零代签不动），冲突解除 | S | AUDIT-LOG 2026-11-24 B-CLASS 行 / audit:63-67 |
| C-26/C-27 judge 读数 | 是否批一次真实 Provider 预算做成对实验 | M | backlog:364-365 |

### B 类裁决材料（用户「其它也都安排上」→ 每项单一最合理建议 + 一句理由）

> **2026-11-24 用户裁决「行，能否一次性搞完」= 下表 7 项建议全批。** 执行结果：①G0 qualified 补 distinctStates 已实现（HK-01 3/3 绿、`g0:qualification:visual` 实机**诚实红**=5 张 PNG 4 唯一态，不补拍不伪造）；②UI-706/707/709/710 口径已按台账 verified 翻正登记行（pending_human_eye 零代签不动）；③C-50 / D-04 / C-56 英文另批 / C-26-27 按建议维持「不做/未裁决/待条件」登记，不开工；④**C-32 执行纠正（同日核码）**：发现已由 BLOCK-211 清偿（`8a0731672`，2026-10-18），「漂移门就绪后做」建议基于过期台账，登记滞后归位、不立项。详见 AUDIT-LOG 2026-11-24 条。

| 项 | 单一建议 | 一句理由 |
|---|---|---|
| C-50 跨机调度 | **不做**（维持候选登记） | 本地主权是产品魂，中心权限边界未裁决前开工必然越权，且无团队/常驻节点场景输入无法定范围。 |
| C-56 英文另批 | **维持未裁决**（本批只按通用保内核出建议、F 类 N/A） | 英文 F 类判据是中文现象的外推，需先定判据再谈覆盖，不先造标准。 |
| D-04 i18n | **不做** | 当前 G0 无多语言用户场景，引入框架属产品级新依赖，需明确语种与维护边界。 |
| G0 qualified 视觉证据 | **批准补 `distinctStates` 唯一性断言**（接受 G0 门先红） | 5 张 PNG 仅 4 唯一态属事实缺口，补断言是诚实修复；先红比假绿更符证据自证。 |
| C-32 `env='1'` | **按独立 M 包在漂移门就绪后做** → **执行纠正（2026-11-24）：不立项** | 核码发现已由 BLOCK-211 清偿（`8a0731672`，2026-10-18，真相表 12/12 绿）；原建议基于未核码的过期台账。 |
| UI-706/707/709/710 | **以台账标题 verified 为准翻正 BLOCK 登记行**（仅口径同步、不翻任何 pending_human_eye） | 证据已在库且台账已 verified，登记行滞后属机械漂移；观感签字项一律不动。 |
| C-26/C-27 judge 预算 | **不批**（维持 deferred） | G0 纪律下真实 Provider 预算属外部成本，无明确收益判据前不花。 |

## C. 等外部条件（本地不可闭环）

- **D-01** Result Studio requalification：G1+ + 七项前置，发布/资格声明前必须处理（L）。
- **D-03** Windows 代码签名：等 EV/标准证书，到位前不翻 `windows-x64.supported`（M）。
- **D-05** Q9 平台项：E7 macOS 构建、L4 sidecar、K4 OS 通知历史、D1 低峰计价——等 Mac 硬件/provider 电价真值/OS 数据源（L）。
- **环境**：`bash`→WSL launcher、`tar`→bsdtar 致测试整类误红；根治需修 PATH 顺序或测试显式路径；每次 closeout 须前置 PATH（S）。
- **UI 实机缺腿组** UI-693/663/595/593/475/482/522：代码完成、缺 9223 实机走查/隧道环境（S–M）。
- **UI-650** 3D 文生入口：需真实 provider 补腿后升 verified（M）；**UI-468** 加映 probe：等真实隧道环境（S）。
- **C-01** 长列表虚拟化：观察态，重开=真实会话 ≥400 条报卡顿或节点 >10k；**C-12/C-15** 已转 G0-BIO 池，仍需逐项裁决；**C-EXT-2** marketplace：G1+ 或显式裁决（L）。

## D. 已 done 未翻状态（机械归位，不重开工作包，S）

- C-47：BLOCK-502 已 completed 票已关，backlog 行仍 open（registry:13561-13584 vs backlog:308）。
- C-53：八期全交付，backlog 行仍 planned（AUDIT-LOG:22 / backlog:3/300）。
- C-55：P0–P4 交付声明，backlog 行仍 planned、P3 未启动表述冲突（backlog:3/297）。
- C-56 登记行：合成+网络素材改写均 completed，行仍「仅登记不开工」（backlog:296）。
- P6 AWAIT_RULING 5 行残留（AUDIT-LOG:214-218 vs 全链 passed 行 210）。
- MIGRATION-IDEMPOTENT / C-34 / BLOCK-128 / capability-provisioning / BLOCK-365 等历史 🟡/🟢 标记（AUDIT-LOG:157/179/185/188/177）。
- UI 台账 line 61「E-01/E-03 保持 pending_human_eye」残留：E-01 已 2026-11-23 verified，E-03 仍真实 pending。

## 确认项（勿列未做）

E-01 树测试、E-02 IA v2 delegated-walk、UI-720 pack sandbox B1、UI-721 审批卡解释入口——均 verified（AUDIT-LOG:3/22/209，audit:3/9）。

## 下一阶段统一清单（2026-11-25 · item 39 口径对齐，收进同一张表）

> 性质：把 G1 余步、规划外在跑/待跑项、资格门收口收进一张表；每项写性质/等什么/体量/证据指针。不新增工作包、不改变发令纪律。G0 永久 maintained、G1 进行中（主人 2026-11-24 裁决），对外动作与外部采购逐项等主人发令。

| 项 | 性质 | 等什么 | 体量 | 证据指针 |
|---|---|---|---|---|
| G1 序列3 SUS 真人样本投放 | 半外部 | 主人定投放渠道（问卷已备 BLOCK-503） | S | `acceptance/g1-execution-plan-2026-11-24/EXECUTION-PLAN.md` 序列3 |
| G1 序列4 W4 双 Provider 矩阵 | 外部真值 | 第二家 Provider 账号/预算（主人日常已用真实模型，第二家待定）——见下方 H 裁决材料 | L | `acceptance/g1-rs-requalification/G1-RS-PLAN.md` W4 + EXECUTION-PLAN 序列4 |
| G1 序列4 W5 packaged 六格 + literal OS reboot | 外部真值 | 签名/公证 + 真机重启窗口（序列5/6 连带） | L | EXECUTION-PLAN 序列5/6 + G1-RS-PLAN W5 |
| G1 序列5 Win 签名证书 / macOS 公证 | 外部采购 | 证书到位（不催不动、不翻 supported 字段） | M | EXECUTION-PLAN 序列5 |
| P7 资格契约 UI-462 对齐 | ✅ 已落 main | 无（已完成：`7d24bffea`） | S | `acceptance/g1-rs-requalification/P7-UI462-ALIGNMENT-EVIDENCE.md` |
| heatmap 归属 | ✅ 已裁决 | 无（归 bio 包 `petri-pack-bio` 激活验收，非内核 G1） | — | `G1-RS-PLAN.md` W2 + msg_ef23501c425e |
| A1 静默吞错扩面（harness 队列1） | 规划外·待发令 | 主人发令（A1 本体已 Done `721dc1edc`，扩面未开） | S | harness 文档 §5 队列1 |
| A3 D1 落地 / 队列7 第一/二波 | ✅ 已集成入 `origin/main=4536aebed`（七支串行合并 `petri-ops/item39-harness7`） | 无（已合主线；CI lint 陈旧 suppressions 归 harness 线处理） | — | harness 文档 §5 队列5.5/队列7；集成链 1bcfa205f / 4d537b7b0 / 8b6129e88 / 43983eef2 / 38513bc09 |
| A1 静默吞错分级治理（扩面） | ✅ 已集成入主线（队列1 本体 `721dc1edc`） | 扩面待发令（本体已合入） | S | harness 文档 §5 队列1；集成链 ff269491a |
| A5 外部监督器 C 先行 | ✅ 已集成入主线（队列4 `450483bc3`，U 材料 status 仍 pending_user_ruling 未擅翻） | 是否升级形态待 owner 裁决 | M | `acceptance/harness-observability/U-EXTERNAL-SUPERVISOR.md`；集成链 fc738bb20 |
| B4 focus + B5 死代码 | ✅ 已集成入主线（队列2 `6a3fa87ff`，UI-727 in_progress） | 观感过目（pending_human_eye 零代签） | S | harness 文档 §5 队列2；集成链 008f57e3a |
| B1 z-index 语义 token | ✅ 已集成入主线（队列3 `6120456e6`，UI-728 in_progress） | 观感过目（pending_human_eye 零代签） | S | harness 文档 §5 队列3；集成链 4c266fb1b |
| A5 外部监督器 U 类 | 待 owner 裁决 | 主人判 C 先行之外是否升级（U 材料 pending_user_ruling） | M | `acceptance/harness-observability/U-EXTERNAL-SUPERVISOR.md` |
| B2 间距 token 收尾 | 观察·收尾项 | 触发条件/发令（大部分已修） | S | harness 文档 §1 B2（裸 px 1055、token 1645） |
| B3 长列表虚拟化 | 观察态·未触发 | 会话≥400 或节点>10k（C-01 重开条件） | M | harness 文档 §1 B3 |
| 视觉逐屏改版（Orca item 24） | 规划外·未开工 | 主人发令 | L | Orca item 24 |
| G0 视觉资格门诚实红（J） | ✅ 已裁决收口 | 无——11-24 B 类裁决已批补 distinctStates + 接受 5PNG/4唯一诚实红、不补拍不伪造；本表纠正 B 段「等处置」滞后登记 | — | `acceptance/g0-distinct-states-ruling/` + AUDIT-LOG 2026-11-24 B-CLASS 行 |

### H 条裁决材料（两项，单一建议 + 一句理由，随 item 39 回报递主人）

| 项 | 单一最合理建议 | 一句理由 |
|---|---|---|
| 签名/公证口径：v1-productization-roadmap §6「不作为必需条件」 vs EXECUTION-PLAN 序列5 前置 | **统一为「G1 发布就绪前置、G0 非必需」两层口径**——在 v1-productization-roadmap §6 加一句 G1 衔接注（不改其 G0 结论），EXECUTION-PLAN 序列5 保持前置 | 两句各自在其阶段成立，矛盾源于阶段口径未分层；加衔接注消除歧义又不翻 G0 历史结论。 |
| G1-RS-PLAN W4「双 Provider」挂外部依赖，而主人日常已用真实模型 | **保持 W4 外部依赖登记、不因日常单 Provider 使用而降级为可本机闭环**——在 W4 加一句「主人日常真实模型供参考，不构成双 Provider 矩阵资格证据」 | 资格矩阵要的是两家真实 Provider 的可审计对照证据，单家日常使用不能替代，登记不降级才不冒进。 |

## 执行建议（advice，未获发令不开工）

1. **先做 D 类机械归位**（纯文档、零代码风险、S）——需用户一句发令；
2. B 类按优先级：C-56 真实稿件路径最轻（给路径即跑）、C-50 场景裁决最重（需先答权限边界）；
3. C 类按外部到位节奏，不主动催。

G0 永久 maintained · G1 进行中（六序按令推进）。
