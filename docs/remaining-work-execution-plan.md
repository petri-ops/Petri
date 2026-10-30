---
capability: remaining-work-execution-plan
goal: 在下一阶段蓝图（next-stage-experience-blueprint）八包全部收口后，把全仓「剩余已知未完成项」收敛为 6 个串行执行包（RW-01~06）——3D 成果接入、UI 证据债清偿、C-32 治理语义缺陷、台账对账、harness 地基、工程卫生——使换模型/换会话可按本文件逐包恢复推进，队列零悬空、零双账本。
acceptance:
  - 方向级验收 = 各包独立立项（照走立项检查单 + 用户发令）后按其 plan 验收；本文件的逐包任务、证据目录与完成判据是执行契约，不冒充运行时证据。
  - 队列级验收 = backlog 推进队列与本文件 §2 一一对应（本文件管逐包任务，backlog 管全量队列序），不另立第二进度文档；每包收口后回写 backlog 对应行。
  - 依赖级验收 = RW-01 是 3D revision 真值前置，RW-02 内含 C-44 pack 写桥前置；RW-02/03 未收口前不得提前做可靠性 soak，RW-06 工程卫生与候选产品包不得提前并行。
  - 证据级验收 = 实现未完成只能 in_progress，证据充分才可 verified；长会话/内存、原生对话框、Provider、macOS 或平台项缺证据必须如实标未覆盖。
  - 边界级验收 = §4 条件触发/观察区不进串行序；G0 纪律出籍项（D 档、packaged/Provider/GA）不列为待办。
reopen: 逐包启动需用户发令（单工作包串行不变）；本纲要重估 = 队列外的候选池/条件项触发重开条件、或用户对标尺/方向改判
status: reference
---

# 剩余工作全量执行纲（Remaining Work Execution Plan）

最后更新：2026-10-30（**RW-06 completed；六包全收口，本文件整体转 reference**——RW-01 completed（3D 接入成果面）/RW-02 completed（62 条四档+写桥）/RW-03 判销（C-32 已清偿）/RW-04 completed（对账+RW-05 收缩）/RW-05 completed（存储能力协商）/RW-06 completed（ui-audit 109×+基线落盘+独立重放「可用但有盲点」4 处修复）。C 档 6 条人眼清单在 acceptance/rw-02-ui-evidence/human-eye-checklist.md 待用户一次栈窗口。§7 恢复协议保留为历史参考。

最后更新：2026-10-30（**RW-05 completed**：存储能力协商三件+REST 面落地（红绿 4/4+实机 local 全量能力位）；closeout 十三门 PASS。下一包=RW-06-ENGINEERING-HYGIENE（终包）。）

最后更新：2026-10-30（**RW-04 completed + RW-05 范围收缩定版**：2a/2d/2e 待核清偿（交付在案）；2c 逐项核实=元数据单源已清偿（BLOCK-233）+事件信封部分在库+存储能力协商零在库真缺口——RW-05 收缩为存储协商单件。下一包=RW-05（收缩后）。）

最后更新：2026-10-30（**RW-03 判销**：C-32 已由 BLOCK-211 清偿在案（回归锁 4/4+实证复验），立项前提过时；RW-04 台账对账与 RW-05 harness 核实顺位前移。下一包=RW-04-LEDGER-RECONCILE。）

最后更新：2026-10-30（**RW-02 completed**：A 线 62 条四档全处置 + B 线 C-44 写桥实机 9/9；UI-639 in_progress 随 UI-532。下一包=RW-03-C32-DECISION-ENV-GOV。）

最后更新：2026-10-30（**RW-01 completed**：closeout 十三门 PASS + 实机 18/18（真实 Blender 5.2.3 LTS）；UI-638 in_progress，面板发现路径实机腿随 RW-02 证据债批清偿。下一包=RW-02-UI-EVIDENCE-DEBT。）

最后更新：2026-10-30（**RW-01 转 active**：用户预授权「一次性搞定所有内容 不需要我的参与」=六包串行全量发令（预授权连续工作模式）+「授权安装任何需要的软件」=Blender 本机安装；RW-01 立项 docs/rw-01-3d-artifact-revision-plan.md。）

最后更新：2026-10-30（复核优化批：RW-01~06 六包 planned；本轮仅规划与复核，未启动实现。）

## 1. 定位与来源

- **承接**：`docs/next-stage-experience-blueprint.md` 八包（NEXT-02A/01/03/04A/04B/05/02B/06，UI-631~637）已全部收口，当前无 active 工作包；本文件是八包之后的**方向+执行唯一 canonical**，覆盖「蓝图之外的全部已知剩余工作」。
- **盘点来源**（2026-10-30 全量对账）：`docs/pending-work-backlog.md` 对账批「真实剩余工作面」注记 + 蓝图八包收口边界（handoff 恢复要点）+ AUDIT-LOG 环境/候选登记 + 候选池活跃项（C-32 等）+ NEXT-06 证据矩阵未覆盖项。盘点当轮已跑 Jev（next:suggest 单一建议=RW-01）。
- **与 backlog 分工**：backlog（truthDomain `pending-work-queue`）仍是全量队列与逐项推进序权威；本文件管六包的**逐包任务与换模型恢复契约**（§2/§3），不复制队列内容。

### 剩余工作分级（复核口径）

| 分级 | 内容 | 本计划处置 |
| --- | --- | --- |
| 真缺口 | 3D 产物→Result Studio revision；C-44 pack 写桥；C-32 env 语义；harness 地基三件 | RW-01/02/03/05 实施 |
| 证据债/对账债 | 71 条 UI in_progress、UI-594/595/596、UI-501/503/504/457、旧批注探针、2a/2c/2d/2e 台账待核 | RW-02/04 分诊、补证、判销，禁止批量翻绿 |
| 可靠性/工程债 | 长会话/内存/复杂场景 soak、ui-audit 门耗时、vitest 通道、bash/tar PATH | RW-06 先记录基线再修 |
| 候选产品包 | C-35~C-43（含 C-43 批注画笔 v2；C-44 是前置写桥） | §4 观察区，满足前置+用户裁决后按序单包立项 |
| 外部条件/G1+ | 真实 vision Provider、R 运行时、macOS 专有、D-05、packaged/GA、B-rep/STEP、完整 CAD | 不进串行，另裁决或 G1+ |

## 2. 总路线图（六包串行）

| 序 | ID | 量级 | 目标一句话 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | `RW-01-3D-ARTIFACT-REVISION` | 2–4 天 | 3D 链产物（SceneSpec/manifest/GLB/STL/OBJ/revision）接入成果面 revision 与血缘体系 | 无（Jev 建议，confidence 0.68） | **completed**（2026-10-30；closeout 十三门 + 实机 18/18；UI-638 面板发现腿随 RW-02；plan=docs/rw-01-3d-artifact-revision-plan.md） |
| 2 | `RW-02-UI-EVIDENCE-DEBT` | 1–2 周 | 62 条 UI 台账 in_progress 分诊清偿；同包补 C-44 pack iframe 写桥 | RW-01 收口 | **completed**（2026-10-30；四档全处置 a 档 9 verified+638 发现腿、写桥实机 9/9；UI-639 in_progress 随 UI-532；plan=docs/rw-02-ui-evidence-pack-write-bridge-plan.md） |
| 3 | `RW-03-C32-DECISION-ENV-GOV` | 2–3 天 | 修 C-32：decision-config env='1' 运行时强开违反自身语义 | RW-02 收口 | **判销**（2026-10-30 RW-02 收口后核实：C-32 已由 BLOCK-211 清偿在案——decision-config.js 头注「现已按注释语义修正」+ resolvePointEnabled 实现即修正语义 + 回归锁 test/block211-c32-env-seed.test.mjs 4/4 在库 + RW-02 会话实证复验双判据过（设置关+env=1 残留→false；设置开+env=0→false）。立项前提过时，不硬造重复包） |
| 4 | `RW-04-LEDGER-RECONCILE` | 0.5–1 天 | 台账待核注记逐项核实回写（2a/2c/2d/2e 现状），治理无代码 | RW-03 判销 | **completed**（2026-10-30；2a 四件全有主判销 / 2c 逐项核实=元数据单源已清偿+事件信封部分在库+存储协商零在库真缺口 / 2d MCP 策略已交付+schema 部分定性 / 2e 两项清偿） |
| 5 | `RW-05-HARNESS-FOUNDATION` | 收缩后 1–2 天 | **范围收缩定版（RW-04 核实）**：仅存储能力协商（supports_* 式可插拔，全仓零在库）；工具元数据单源已由 BLOCK-233 清偿、事件信封 traceId/事件目录部分在库（turnId 细粒度=可选增量不立项） | RW-04 核实结论 | **completed**（2026-10-30；红绿 4 件+REST 实机+邻域 43/43+closeout 十三门 PASS；plan=本条目+RW 纲 §3.5 收缩定版，轻量包） |
| 6 | `RW-06-ENGINEERING-HYGIENE` | 2–4 天 | 长会话/复杂场景/内存与首帧基线 + ui-audit/vitest/PATH 环境债 + 最终复盘 | RW-05 收口 | **completed**（2026-10-30；B1 ui-audit 109×（54.9s→0.5s）+B2 判销留痕（block274 已根修 9s）+B3 Windows 侧专属登记；A 线基线落盘不预设阈值；C 线独立重放「可用但有盲点」4 处全修复；closeout 十三门 PASS） |

> 串行纪律不变：同一时间只有一个 active 工作包；包号是稳定责任边界，不跳号并行。顺序原则=用户可见价值与真值前置 → 证据/治理债 → 可靠性/工程卫生。依赖或顺序需调整时先回写本节与 backlog 再执行。

## 3. 逐包任务与完成判据

### 3.1 RW-01-3D-ARTIFACT-REVISION（队首）

- **目标**：NEXT-04A~06 建成的 3D 链产物成为成果面一等公民——SceneSpec、manifest、GLB/STL/OBJ、revision 接入 viewer registry / revision 快照与恢复 / lineage 血缘节点 / 选择回路进 Composer 结构化引用，与既有 result artifact 同权。
- **范围**：复用 BLOCK-138~142 成果面内核（viewer 注册表、revision、selectionBus、lineage）与 NEXT-05 本地修订/语义 diff；SceneSpec 是源真相，manifest 是导出证据；零第二执行器、零第二 revision/artifact truth、零新依赖。
- **非范围**：3D 几何内核扩展（布尔/抽壳/通孔、法线/壁厚/间隙——handoff 边界在册）；像素级图像 diff；G1+。
- **证据目录**：`acceptance/rw-01-3d-revision/`；**完成判据**=viewer/revision/lineage 契约测 + 真实 Blender 产物经成果面打开/恢复/比对/引用的隔离实机断言 + closeout；UI 台账登记对应条目。

### 3.2 RW-02-UI-EVIDENCE-DEBT（证据债清偿 + C-44 写桥前置）

- **目标 A：分诊清偿**：UI 台账 71 条存量 `in_progress` 分四档——(a) 可代行 CDP 走查的批量取证翻账（1z 先例）；(b) 条件型实机腿：UI-587 批注画笔（需结果面 job+artifact seed）、UI-594/595/596、1d 血缘条（随 BIO-4 真实跨 Job 数据）；(c) 用户人眼最小集**集中一次栈窗口**过目（UI-501/503/504/457）；(d) 无证据链条目按 P0 台账对账先例判销/改判。
- **目标 B：C-44 pack iframe 写桥前置**：补齐 selection / revisions restore-replay / annotations / export 写操作白名单、上下文快照、ack/审批与过期、项目归属、pack 缺失/停用/版本不匹配回退；沿用既有 UI action/审批通道，不建第二审批链。它是批注证据债与 C-43 画笔 v2 的硬前置。
- **红线**：不用新 UI 覆盖证据债；不凑证据、不伪造实机断言；旧探针 block298/299 只保留历史身份，当前契约探针按 BLOCK-300/303 之后语义重建。
- **证据目录**：`acceptance/rw-02-ui-evidence/` 与 `acceptance/rw-02-pack-write-bridge/`；**完成判据**=分诊表落 backlog/台账 + 每条四档处置留痕 + 可翻账条目翻 verified、条件腿条目如实保留触发条件；四类写面各一条真实写链 + 审批过期/权限拒绝/恢复。

### 3.3 RW-03-C32-DECISION-ENV-GOV（治理语义缺陷）

- **目标**：修 C-32（候选池活跃真缺陷）：`core/petri-server/helpers/decision-config.js` 文件头明写 env='1'「不在运行时强制开（避免 UI 关不掉）」，但 `getPointRuntime` 实现为 env='1' 直接强开——用户在设置页显式关掉的守卫，环境残留 `PETRI_JEV_*=1` 即复开，UI 关不动。修法=env '1' 降级为**首载种子**（`seedDoc` 已是这语义，运行时不再赢一次）；env '0' 保留杀开关。
- **连带回归**：设置页读写、REST `/api/ai/agent/decisions`、依赖 env=1 开接点的 dev 脚本（`test:suggest` / `doc:suggest --supply=cloud`）。
- **红线**：必须独立包动——`test/block199-config-compat.test.mjs` 第六条把现状钉成对账锚，改它=同时改验收锚与被验收物（BLOCK-199 自我约束在案）；治理透明魂面实证修复。
- **证据目录**：`acceptance/rw-03-c32/`；**完成判据**=红绿先行（「设置关 + env=1 残留」先红后绿）+ 连带回归全绿 + closeout。

### 3.4 RW-04-LEDGER-RECONCILE（对账批，治理无代码）

- **目标**：backlog 2026-10-27 对账批标注「待核」的行逐项核实回写——2a 设置搜索+全景导出（BLOCK-201 在案）、2d 设置阶段 B 结构（BLOCK-200/204 在案）、2e 设置阶段 C 治理（BLOCK-206~210 在案，外观扩展/hooks 产品化状态核实）、**2c harness 地基三件现状核实**（事件信封+事件目录 / tool-metadata 与 CONTRACTS 两套元数据并存未消费 / 存储能力协商）。
- **产出**：核实结论直接回写 backlog 对应行（已交付注记判销、真缺口转 RW-05 立项范围）；**零产品代码**。
- **证据目录**：backlog 行内注记（核实引用 BLOCK 收口证据在案即可）；**完成判据**=无「待核」悬空注记残留，且无第二份台账。

### 3.5 RW-05-HARNESS-FOUNDATION（依赖 RW-04 结论 · 范围已收缩）

- **目标**：按 RW-04 核实结论实施 harness 地基缺口——①事件信封+事件目录（traceId/turnId、类型可枚举）；②工具元数据单源（收敛 tool-metadata 与 CONTRACTS 两套并存）；③存储能力协商（supports_* 式可插拔）。若核实判销（已交付/无实义缺口）则本包收缩或判销，**不硬造**（幽灵锚点红线，BLOCK-195 教训）。
- **证据目录**：`acceptance/rw-05-harness/`；**完成判据**=逐件红绿契约 + 邻域回归 + closeout；范围裁决（做/收缩/判销）随 RW-04 结论由用户发令确认。

### 3.6 RW-06-ENGINEERING-HYGIENE（可靠性/工程卫生 + 最终复盘）

- **目标 A：可靠性基线**：长会话/长工具列表/复杂场景/慢后端/模型超时/Blender 取消恢复/WebGL 丢失的实机与指标——首帧/首次可预览时间、dryRun 上界准确性、resume 正确性、参数 diff 正确性、内存与后端响应；先记录真实基线，再决定是否设棘轮，**不预设通过阈值**。
- **目标 B：工程债**：①ui-audit 门 ~144s 优化；②BLOCK-272 plan reopen 的 vitest 通道「防复发」用例 864s 优化；③bash/tar PATH 环境债根治（显式 Git Bash/GNU tar 路径或固化前置校验，消除每次收口误红）。
- **目标 C：最终复盘**：逐项 delivered/partial/deferred/reopen；由未参与实现的只读 Agent 按本文件与 acceptance 重放恢复步骤，不能定位的产物/失败/回退入口保留队列，不宣告「全部工作完成」。
- **证据目录**：`acceptance/rw-06-hygiene/`；**完成判据**=可靠性/门耗时前后对照（红绿基线）+ 不前置 PATH 的 closeout 全绿 + 独立重放记录 + closeout。

## 4. 条件触发与观察区（不进串行序；启动均需触发条件满足 + 用户裁决）

| 项 | 触发条件 |
| --- | --- |
| 真实 vision Provider 链实测（NEXT-04B 仅以本地 mock 端点验证协议） | 用户提供真实 vision 凭据（👤 用户事项） |
| R 运行时 657MB 安装（bio 链真实 R 执行） | 已裁决暂缓；重开=用户裁决 |
| 右栏内容拖出独立窗 P1 | 方案已评估，等用户发令 |
| BIO-7 领域深化池（scrna_standard 结果闭环） | 用户裁决方向倾斜 |
| C-35~C-43 候选产品包 | 先完成 RW-02 写桥与证据债；再按 C-43 → C-35 → C-36 → C-37 → C-39 → C-38 → C-40 → C-41 → C-42 串行单包立项；C-41 先独立设计裁决 |
| C-14 RTK 输出压缩 / C-01 长列表虚拟化 / CK-08 task_id / BK-02 汇报门观察 | 各自重开条件（token 痛点实测/实测卡顿/库体积可感知/观察窗数据） |
| CP-19 移动栈 | deferred，用户裁决 |

## 5. 用户事项（👤，随 RW-02 安排集中执行）

- UI-501/503/504/457 一次栈窗口人眼过目（四条集中，避免分散打扰）。
- （可选）真实 vision 凭据提供 → 解锁 §4 首行实测。

## 6. 出籍声明（G0 阶段纪律）

D 档（D-01 RS-P7 / D-02 macOS 视觉证据 / D-03 代码签名 / D-04 i18n / D-05 Q9 平台外部条件）与 packaged/公证/Provider 矩阵/GA 属 G1+ 或外部条件，**按当前阶段纪律不外推、不列为待办**。本文件任何一包收口笔录按惯例一句「G0 开发期常态 · 不外推 packaged/Provider/GA」即可，不展开列举。

## 7. 纪律与换模型恢复协议

- **单工作包串行**：逐包启动走 `petri-project-governance` 立项检查单 + 用户发令；包内产品语义裁决点单独问。
- **恢复协议**：换会话/换模型恢复时，读本文件 §2 确定队列位次 → 读对应包 §3 小节（目标/范围/非范围/证据目录/完成判据）→ 按 backlog 确认无进行中 WIP → 立项开工。本文件 §3 是逐包执行的唯一契约；蓝图（next-stage-experience-blueprint §11）对八包的历史契约保留为 reference。
- **证据与完成语义**：实现未完成只能 in_progress；只有真实证据充分才能 verified；partial/deferred 必须写清边界，禁止文档勾选冒充运行时证据。
- **收口回写**：每包收口后更新本文件 §2 状态列 + backlog 对应行 + roadmap/AUDIT-LOG 顶部条目 + UI 台账（在范围内）+ closeout；本文件整体完成（六包全收口）后转 reference。
