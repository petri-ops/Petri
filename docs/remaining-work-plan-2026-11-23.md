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
phase: G0
---

# 剩余工作规划（2026-11-23 现读基线）

> 发令：用户「没做的可以规划一下」+「push，这个计划也 push」。本文件是**规划入口**（living-plan），非工作包、不占串行槽位；任何项开工仍需用户发令。
> 基线：Q-MATRIX ✅95·🟡0·🔴0·⛔7=102；串行槽位空；两仓 0/0；AUDIT-LOG 头部最后=C-56 网络素材稿件 completed。
> 证据源：`docs/AUDIT-LOG.md`、`docs/pending-work-backlog.md`、`docs/ui-productization-audit.md`、`docs/DOC-REGISTRY.json`、`docs/c56-paper-writing-manual-draft-2026-11-19.md`（code-explorer 现读 37 工具调用）。

## A. 可 Agent 自推

**空**。代码待办清零（P6 全链 passed、🟡9 九项全收口、C-56 双链路已验）、状态归位已推完、串行槽位空。无新实现项可自推——不自造工作。

## B. 等用户单一裁决（8 项）

| 项 | 等什么 | 体量 | 证据 |
|---|---|---|---|
| C-50 跨机 7×24 中心调度 | 场景裁决（共享工作区/常驻节点/Web 入口）+ 先答「中心权限边界到哪、本地主权从哪开始」，才立项 BLOCK | L | backlog:303 |
| C-56 真实稿件改写 | 给一份真实论文文件路径；合成+arXiv 链路已验完，手册 §9 判据不改 | S | manual:76-78 / registry:13559 |
| C-56 英文论文另批 | 是否覆盖英文面（上轮"维持六项、英文另批"） | M | manual:91/100/102 |
| D-04 i18n 资源抽离 | 是否国际化/哪些语言/react-i18next 还是自研 | L | AUDIT-LOG:190 / backlog:351 |
| G0 qualified 视觉证据 | 是否批准补 `distinctStates` 唯一性断言（会让 G0 门先红） | M | AUDIT-LOG:187 / backlog:349 |
| C-32 `env='1'` 语义 | 漂移门就绪后独立包裁决 | M | backlog:371 |
| UI-706/707/709/710 | 口径冲突：台账标题已 verified vs BLOCK 登记 in_progress+pending_human_eye，以哪为准 | S | audit:63-67 vs 181/189/198/218 |
| C-26/C-27 judge 读数 | 是否批一次真实 Provider 预算做成对实验 | M | backlog:364-365 |

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

## 执行建议（advice，未获发令不开工）

1. **先做 D 类机械归位**（纯文档、零代码风险、S）——需用户一句发令；
2. B 类按优先级：C-56 真实稿件路径最轻（给路径即跑）、C-50 场景裁决最重（需先答权限边界）；
3. C 类按外部到位节奏，不主动催。

G0 开发期常态 · 不外推 packaged/Provider/GA。
