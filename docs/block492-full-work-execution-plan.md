---
capability: block492-full-work-execution-plan
status: reference
goal: 全量盘点当前项目所有欠缺与待完善事项，按波次分组与排序，形成独立完整的执行计划；无人工参与任务在前、需人工参与任务统一排在最后，并派生一份可由其他 Agent 全量执行的无人值守提示词。本文件为规划/参考文档（reference），落档后逐波发令执行，不自动开工。
acceptance:
  - 覆盖所有欠缺与待完善事项（实现票/既有红/候选池/3D 域/母纲余项），逐项标状态与证据来源
  - 波次目标/范围/预期成果/依赖关系/推进顺序明确，单工作包串行
  - 无人工参与波次与需人工参与波次分离，人工项统一排在所有自动波次之后
  - 明确排除 G1+（Provider/packaged 公证/GA/远程发布）与观感 pending_human_eye 代签，观感统一归人工区
  - 同提交派生无人值守执行提示词（§2 自包含正文）
  - 六件套回写 + docs:check 绿 + commit/push
reopen: 用户新增/撤销任一裁决点、外部依赖/凭据条件变化、或某波次收口后需重排后续波次时修订本计划
supersedes: 无（与既有 living-plan/蓝图并存，本文件是它们的执行序投影；冲突以各 canonical 真源为准）
---

# BLOCK-492 · 全量工作执行计划（2026-11-18 核对）

日期：2026-11-18 · 性质：规划/参考批（零产品代码）· 关联：母纲 [`qoder-essence-absorption-plan.md`](./qoder-essence-absorption-plan.md) · 3D 域 [`3d-authoring-domain-blueprint-2026-11-17.md`](./3d-authoring-domain-blueprint-2026-11-17.md) · BLOCK-322 纲 · [`block491-ruling-codification-plan.md`](./block491-ruling-codification-plan.md)

## 0. 一句话

把当前所有欠缺与待完善事项盘成一张可执行波次表：**能自动推进的在前、需人工参与的统一殿后**，逐波按 G0 单工作包串行推进，观感零代签、不碰 G1+。配套无人值守提示词见 [`block492-full-work-execution-prompt.md`](./block492-full-work-execution-prompt.md)。

## 1. 核对方法（事实优先级）

依据当次命令输出 > Git/源码 > 证据 JSON > canonical 文档。核对真源：`docs/AUDIT-LOG.md`（无 🔴/🟢 未决）、`npm run state`（串行槽位空、living-plan 两项常驻）、`docs/pending-work-backlog.md`、`docs/next-phase-e2e-prompt-2026-11-18.md` §1、`docs/qoder-essence-absorption-plan.md` §6.5、`docs/3d-authoring-domain-blueprint-2026-11-17.md`、`docs/3d-authoring-dependency-ruling-2026-11-17.md`、closeout 门禁实跑（docs/hygiene/ui-audit/test:changed/lint）。

**串行槽位现况**：空（BLOCK-491 已收口），所有波次启动均需用户发令。

## 2. 已收口（供对照，不列为待做）

C-53 P0–P7、C-52 余项 P2–P5、C-55 视频 P0–P3、C-54 六档序列、W11 P3 流式首切片、3D P0–P4 对账 + Agent Gym、img2threejs 借形封装、BLOCK-491 D1–D5 裁决固化、母纲 §6.5 串行队列（Q4b/Q9-REM/P4-REM 均 completed）。Q-MATRIX=✅74/🟡21/🔴0/⛔7=102（口径=BLOCK-263 changelog，两处收拢一致）。

## 3. 自动执行波次（无人工参与 · 顺序推进）

### W1 · 基础设施与既有红清偿（零产品代码 · 治理批）
- **目标**：清零非资产类既有红，使 closeout 链恢复可全绿。
- **范围**：
  1. `test:changed` evidence.json 债务——block464/470/477 三处未映射证据挂 impact-map rule（修工具映射，不改基线语义）。
  2. `lint:ledger` production(+11)/test(+2) 域既有 warning——溯源三分类（真缺陷修/化石删/误报 `--suppress-all` 留痕），禁止全局关规则，逐域只减不放宽。
  3. `docs:check` 中 **非资产类**登记残留（如有）清理。
- **预期成果**：test:changed / lint:ledger 转绿；closeout 除人工资产项外全绿。
- **依赖**：无（先行，为后续波次清场）。
- **注意**：post-h9 蓝图（`post-h9-optimization-blueprint-2026-11-10.md` DOCUMENT_MISSING）是 **untracked 用户资产**，处置权归用户——不在本波自动处置，列入 W5 人工区。

### W2 · 已裁决实现票（BLOCK-491 D1–D5 固化后逐票发令）
- **目标**：把 RULING-04 已裁决的特征级引用落到 SceneSpec，先吃「真工程图」可见收益。
- **范围**（逐票独立可停，每票 HK-01 红绿 + 契约测 + 实机腿 + UI 腿）：
  1. **P4-05b**：`tolerances[].feature` 变可解析引用 + HLR SVG 出尺寸线与文字（判据=D5 数值一致性：标注文本 + 视图投影坐标 + 解析尺寸一致）。体量 1 票。
  2. **P3-03 v2a**：求值器局部系→世界系合成，旋转平面贴合；前置=Blender 4.5 欧拉序实测探针（不设 `rotation_mode`，须实测不能按文档猜）。体量 1 票。
  3. **P3-03 v2b**：`features[]` 数据模型 + 基元自动派生 + CAD 导入件抽特征（平面/圆柱/锥/球，`bspline` 等标 other 并拒贴合）+ sidecar sha 锚定 + 前端约束编辑器。体量 2 票（后端/前端）。
- **预期成果**：GD&T 特征锚可用、旋转平面 mate 可表达、特征表=sha/dimensions 派生缓存（不一致 fail-closed），零第二场景真值、零 OCCT 建几何。
- **依赖**：BLOCK-491 已固化裁决（真源=`resources/ruling-codification/block322-ruling-codification.json`）；v2a 先于 v2b；v2a 前置=Blender 欧拉序实测。
- **不随本波**：P4-04b（IGES 导出）、RULING-03（切片 CLI）、P5-02（真实 key）、v2c（曲面/边）。

### W3 · 候选池转正评审（评审材料为主 · 不直接实现）
- **目标**：把候选池各条产出一页可裁决评审材料，启动与否仍由用户发令。
- **范围**（每项 = 现状/候选/风险/推荐/影响面/退出成本六段材料，状态一律 `pending_user_ruling`）：
  1. **C-45**：工具消息配对熔断裁剪修复（BLOCK-348 P1，`message-trimmer.js:159-160` assistant(tool_calls)↔tool 原子性）。
  2. **MIGRATION-IDEMPOTENT**：桌面 021 迁移与 `ensureProjectWorktreeColumn` 自愈补列幂等缺口。
  3. **BLOCK-490**：capability-intake 能力承接 Skill 评审稿 D1–D8 推进。
  4. **母纲产品包候选 C-35~C-40**：K9 分步引导 / C14 模型生成建议 / D4 成本复杂度审计 / D1 权限与缓存 / E7 PiP / K4 审批卡定位 / L3 浏览器连接器。
  5. **C-50**：控制面中心化 / 安装版端口模型 / Linux 服务器化（含场景裁决）。
  6. **C-56**：论文写作/修改保真 Skill（G0 当前不建设，仅登记）。
- **预期成果**：候选材料落档 + 三件套登记；**不启动实现**。
- **依赖**：无硬依赖，可在 W1/W2 间隙穿插（不占实现串行槽位时仅作评审）。

## 4. 人工参与波次（统一排在所有自动波次之后）

### W4 · 观感签字与人眼终审（仅用户）
- 观感签字：UI-706/707/709/710（保持 `in_progress`/`pending_human_eye`，零 verified）。
- E 类人眼 22 条（11+2+9，其中 3 可过目）。
- Agent 不得代签、不得改状态、不得标 verified。

### W5 · 用户裁决与资产处置（仅用户）
- post-h9 D5 原件处置权（含 `post-h9-optimization-blueprint-2026-11-10.md` 这份 untracked 用户资产的处置 → 解除 docs:check 该项红）。
- Polyfork 授权边界结论（材料已只读收集；接入决策归用户）。
- C-47 修复票方向 A/B 裁决。
- 各阶段/波次发令本身。

## 5. 依赖关系与整体推进顺序

```
W1 基础设施清偿（先清场）
  └─→ W2 已裁决实现票（P4-05b → P3-03 v2a → v2b；逐票串行，每票待发令）
        └─→ W3 候选池转正评审（可穿插；材料 pending_user_ruling，不启动实现）
人工区（全程不阻塞自动波次，统一殿后）：
  W4 观感签字（用户）· W5 裁决与资产处置（用户）
```

- **串行纪律**：同一时间一个 active 工程包；W1→W2→W3 按序，前一波收口才进下一波；评审材料可穿插但不并行开实现包。
- **G0 常态**：不外推 Provider/packaged/公证/GA/远程发布/dist staleness；Result Studio P7 deferred；qualificationEligible=false 是常态非待办。

## 6. 已核对的漂移（如实登记，不掩盖）

- **3D 域蓝图 §10 漂移**：U-3D-D1/D2/D3 在 `3d-authoring-domain-blueprint` 表内仍写 `pending_user_ruling`，但 `3d-authoring-dependency-ruling-2026-11-17.md` 已回填 2026-11-18 批量裁决 `ruled`（B-1~B-5）。属登记未同步，非新待裁决点。处置：列入 W1 一并校准（把蓝图表头对齐到已裁决态），属零产品代码治理。
- **backlog 历史快照**：`pending-work-backlog.md` 实质队列停在 2026-10-31；当前终态以 `post-h9-2026-11-10-final-report.md` + DOC-REGISTRY + `npm run state` 为准。

## 7. 全局纪律（适用所有波次）

- 零新增产品依赖默认；任何产品级新依赖 = 停下报用户。
- 观感 `pending_human_eye` 永不代签、永不写 verified。
- 既有红如实归属，不把未跑/失败/复用的门写成 freshly passed。
- 每波收口：定向测试 + 专项门 + closeout 定向 + 证据落 acceptance/ + 六件套回写 + commit/push + snapshot 标签。
- 他方 WIP 零触碰：`docs/architecture/gateway-design.md`、`docs/pending-work-backlog.md` C-56 行、`docs/block490-capability-intake-review-plan.md`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
