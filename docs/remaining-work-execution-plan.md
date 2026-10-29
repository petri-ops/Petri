---
capability: remaining-work-execution-plan
goal: 在下一阶段蓝图（next-stage-experience-blueprint）八包全部收口后，把全仓「剩余已知未完成项」收敛为 6 个串行执行包（RW-01~06）——3D 成果接入、UI 证据债清偿、C-32 治理语义缺陷、台账对账、harness 地基、工程卫生——使换模型/换会话可按本文件逐包恢复推进，队列零悬空、零双账本。
acceptance:
  - 方向级验收 = 各包独立立项（照走立项检查单 + 用户发令）后按其 plan 验收；本文件的逐包任务、证据目录与完成判据是执行契约，不冒充运行时证据。
  - 队列级验收 = backlog 推进队列与本文件 §2 一一对应（本文件管逐包任务，backlog 管全量队列序），不另立第二进度文档；每包收口后回写 backlog 对应行。
  - 边界级验收 = §4 条件触发/观察区不进串行序；G0 纪律出籍项（D 档、packaged/Provider/GA）不列为待办。
reopen: 逐包启动需用户发令（单工作包串行不变）；本纲要重估 = 队列外的候选池/条件项触发重开条件、或用户对标尺/方向改判
status: planned
---

# 剩余工作全量执行纲（Remaining Work Execution Plan）

最后更新：2026-10-30（规划入册批：RW-01~06 六包 planned，队首=RW-01；本轮仅规划，未启动实现。）

## 1. 定位与来源

- **承接**：`docs/next-stage-experience-blueprint.md` 八包（NEXT-02A/01/03/04A/04B/05/02B/06，UI-631~637）已全部收口，当前无 active 工作包；本文件是八包之后的**方向+执行唯一 canonical**，覆盖「蓝图之外的全部已知剩余工作」。
- **盘点来源**（2026-10-30 全量对账）：`docs/pending-work-backlog.md` 对账批「真实剩余工作面」注记 + 蓝图八包收口边界（handoff 恢复要点）+ AUDIT-LOG 环境/候选登记 + 候选池活跃项（C-32 等）。盘点当轮已跑 Jev（doc:suggest 零建议如实附；next:suggest 单一建议=RW-01）。
- **与 backlog 分工**：backlog（truthDomain `pending-work-queue`）仍是全量队列与逐项推进序权威；本文件管六包的**逐包任务与换模型恢复契约**（§2/§3），不复制队列内容。

## 2. 总路线图（六包串行）

| 序 | ID | 量级 | 目标一句话 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | `RW-01-3D-ARTIFACT-REVISION` | 2–4 天 | 3D 链产物（SceneSpec/manifest/GLB/STL/OBJ/revision）接入成果面 revision 与血缘体系 | 无（Jev 建议，confidence 0.33；前判 0.73） | planned |
| 2 | `RW-02-UI-EVIDENCE-DEBT` | 1–2 周 | 71 条 UI 台账 in_progress 证据债分诊与清偿（代行走查+条件腿+用户过目+判销） | RW-01 收口 | planned |
| 3 | `RW-03-C32-DECISION-ENV-GOV` | 2–3 天 | 修 C-32：decision-config env='1' 运行时强开违反自身语义（治理透明缺陷） | RW-02 收口 | planned |
| 4 | `RW-04-LEDGER-RECONCILE` | 0.5–1 天 | 台账待核注记逐项核实回写（2a/2d/2e/2c 现状），治理无代码 | RW-03 收口 | planned |
| 5 | `RW-05-HARNESS-FOUNDATION` | 视核实 3–10 天 | harness 地基缺口实施（事件信封/工具元数据单源/存储能力协商） | RW-04 核实结论 | planned |
| 6 | `RW-06-ENGINEERING-HYGIENE` | 2–4 天 | ui-audit 门 144s + vitest 通道 864s 用例 + bash/tar PATH 环境债 | RW-05 收口 | planned |

> 串行纪律不变：同一时间只有一个 active 工作包；包号是稳定责任边界，不跳号并行。顺序原则=用户可见价值 → 证据/治理债 → 工程卫生；依赖或顺序需调整时先回写本节与 backlog 再执行。

## 3. 逐包任务与完成判据

### 3.1 RW-01-3D-ARTIFACT-REVISION（队首）

- **目标**：NEXT-04A~06 建成的 3D 链产物成为成果面一等公民——model3d 产物（SceneSpec、manifest、GLB/STL/OBJ、revision）接入 viewer registry / revision 快照与恢复 / lineage 血缘节点 / 选择回路进 Composer 结构化引用，与既有 result artifact 同权。
- **范围**：复用 BLOCK-138~142 成果面内核（viewer 注册表、revision、selectionBus、lineage），零第二执行器、零新依赖；对齐 NEXT-05 既有 revision/compare 语义。
- **非范围**：3D 几何内核扩展（布尔/抽壳/通孔、法线/壁厚/间隙——handoff 边界在册）；像素级图像 diff；G1+。
- **证据目录**：`acceptance/rw-01-3d-revision/`；**完成判据**=契约测（viewer/revision/lineage）+ 隔离实机断言（真实 Blender 产物经成果面打开/恢复/比对/引用）+ closeout 门禁；UI 台账登记对应条目。

### 3.2 RW-02-UI-EVIDENCE-DEBT（证据债清偿批）

- **目标**：UI 台账 71 条存量 `in_progress` 分诊四档并清偿——(a) 可代行 CDP 走查的批量取证翻账（1z 已清 12 条同款先例，acceptance/ 自持证据）；(b) 条件型实机腿：UI-587 批注画笔（需结果面 job+artifact seed）、UI-594/595/596、1d 血缘条（随 BIO-4 真实跨 Job 数据）；(c) 用户人眼最小集**集中一次栈窗口**过目（UI-501/503/504/457）；(d) 无证据链条目按 P0 台账对账先例判销/改判。
- **红线**：不用新 UI 覆盖证据债（roadmap 明令）；不凑证据（不伪造实机断言）。
- **证据目录**：`acceptance/rw-02-ui-evidence/`；**完成判据**=分诊表落 backlog/台账 + 每条四档处置留痕 + 可翻账条目翻 verified、条件腿条目如实保留触发条件。

### 3.3 RW-03-C32-DECISION-ENV-GOV（治理语义缺陷）

- **目标**：修 C-32（候选池活跃真缺陷）：`core/petri-server/helpers/decision-config.js` 文件头明写 env='1'「不在运行时强制开（避免 UI 关不掉）」，但 `getPointRuntime` 实现为 env='1' 直接强开——用户在设置页显式关掉的守卫，环境残留 `PETRI_JEV_*=1` 即复开，UI 关不动。修法=env '1' 降级为**首载种子**（`seedDoc` 已是这语义，运行时不再赢一次）；env '0' 保留杀开关。
- **连带回归**：设置页读写、REST `/api/ai/agent/decisions`、依赖 env=1 开接点的 dev 脚本（`test:suggest` / `doc:suggest --supply=cloud`）。
- **红线**：必须独立包动——`test/block199-config-compat.test.mjs` 第六条把现状钉成对账锚，改它=同时改验收锚与被验收物（BLOCK-199 自我约束在案）；治理透明魂面实证修复。
- **证据目录**：`acceptance/rw-03-c32/`；**完成判据**=红绿先行（「设置关 + env=1 残留」先红后绿）+ 连带回归全绿 + closeout。

### 3.4 RW-04-LEDGER-RECONCILE（对账批，治理无代码）

- **目标**：backlog 2026-10-27 对账批标注「待核」的行逐项核实回写——2a 设置搜索+全景导出（BLOCK-201 在案）、2d 设置阶段 B 结构（BLOCK-200/204 在案）、2e 设置阶段 C 治理（BLOCK-206~210 在案，外观扩展/hooks 产品化状态核实）、**2c harness 地基三件现状核实**（事件信封+事件目录 / tool-metadata 与 CONTRACTS 两套元数据并存未消费 / 存储能力协商）。
- **产出**：核实结论直接回写 backlog 对应行（已交付注记判销、真缺口转 RW-05 立项范围）；**零产品代码**。
- **证据目录**：backlog 行内注记（核实引用 BLOCK 收口证据在案即可）；**完成判据**=无「待核」悬空注记残留。

### 3.5 RW-05-HARNESS-FOUNDATION（依赖 RW-04 结论）

- **目标**：按 RW-04 核实结论实施 harness 地基缺口——①事件信封+事件目录（traceId/turnId、类型可枚举）；②工具元数据单源（收敛 tool-metadata 与 CONTRACTS 两套并存）；③存储能力协商（supports_* 式可插拔）。若核实判销（已交付/无实义缺口）则本包收缩或判销，**不硬造**（幽灵锚点红线，BLOCK-195 教训）。
- **证据目录**：`acceptance/rw-05-harness/`；**完成判据**=逐件红绿契约 + 邻域回归 + closeout；范围裁决（做/收缩/判销）随 RW-04 结论由用户发令确认。

### 3.6 RW-06-ENGINEERING-HYGIENE（工程卫生）

- **目标**：①ui-audit 门 ~144s 优化（BLOCK-274 收口后新最大单项，普惠优化候选另案在案）；②BLOCK-272 plan reopen 的 vitest 通道「防复发」用例 864s 优化；③bash/tar PATH 环境债根治（AUDIT-LOG 🟡：WSL bash/bsdtar 误伤 closeout——测试改显式 Git Bash/GNU tar 路径或固化前置校验，消除每次收口误红）。
- **证据目录**：`acceptance/rw-06-hygiene/`；**完成判据**=门耗时前后对照（红绿基线）+ 不前置 PATH 的 closeout 全绿 + closeout。

## 4. 条件触发与观察区（不进串行序；启动均需触发条件满足 + 用户裁决）

| 项 | 触发条件 |
| --- | --- |
| 真实 vision Provider 链实测（NEXT-04B 视觉链仅以本地 mock 端点验证协议，缺席明确降级在案） | 用户提供真实 vision 凭据（👤 用户事项） |
| R 运行时 657MB 安装（bio 链真实 R 执行） | 已裁决暂缓；重开=用户裁决 |
| 右栏内容拖出独立窗 P1 | 方案已评估，等用户发令 |
| BIO-7 领域深化池（scrna_standard 结果闭环） | 用户裁决方向倾斜 |
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
- **收口回写**：每包收口后更新本文件 §2 状态列 + backlog 对应行 + roadmap/AUDIT-LOG 顶部条目；本文件整体完成（六包全收口）后转 reference。
