---
capability: block460-scene-joints
status: active
goal: 3D 造物域 P1 首包（BLOCK-460）——SceneSpec v1 additive 关节扩展（scene3d.js 零破坏）+ sand3d GLB→SceneSpec 归一器（fail-closed）+ sand3d runner sidecar（run_cmd guard-ack 链内）+ 3d-authoring 产品 Skill + 一个可动装配端到端（程序→GLB→IR→校验绿→digest 锚定）
acceptance:
  - joints[] additive 扩展契约测试红→绿（HK-01），既有 scene3d 契约测试零回归
  - GLB 归一器契约测试红→绿：真实探针 GLB fixture → SceneSpec(+joints) 文档，轴向四元数变换/单位归一/rest 校验/floating 映射/mimic 映射逐项断言
  - runner sidecar 零新 IPC：agent 经 run_cmd 调用（guard-ack 审批链内），venv 幂等 bootstrap（pin sand3d==1.6.3）
  - 3d-authoring 产品 Skill 过 skills:check + manifest 登记
  - 端到端证据落 acceptance/block460/（digest 双锚：program fingerprint + GLB sha256）
---

# BLOCK-460 · 3D 造物域 P1 首包（L0/L1/L2）（active / P1-LAUNCH）

> **发令**：用户 2026-11-18 端到端预授权（S3=P1 首包按推荐执行，前置=BLOCK-459 探针可行——已收口判「可行」）。
> **从属**：`docs/3d-authoring-domain-charter.md`（稳定顶层）→ `docs/3d-authoring-domain-blueprint-2026-11-17.md` §8 P1 → 本 plan。
> **探针依据**：`acceptance/block-459/PROBE-REPORT.md`（extras 实测 schema + 六行映射）+ `scene-ir-v0-draft.md`（N1–N8 归一规则）。

## 0. 架构修正记录（本 plan 相对蓝图 §4.1 的偏差 · 必读）

**蓝图 §4.1 假设「新建独立 SceneIR v0」——本包改为「既有 SceneSpec v1 的 additive 关节扩展」。** 依据（charter 仲裁，非新裁决）：

- 实探发现仓库已有成熟 scene 表示链：`core/petri-server/helpers/scene3d.js`（`scene3d/v1` 单一真相：可 diff/校验/哈希）+ `model3d-scene-store.js`（修订/diff）+ model3d agent tools/routes/前端 viewer 全套（BLOCK-322/NEXT-04A/NEXT-05 遗产）。
- 3D charter §3.2（**冻结**）：「禁止第二套中间表示」——再立一份平行 SceneIR 即违规；charter §0.2 冲突以 charter 为准，派生文档（蓝图）同批修正。
- 蓝图 §4.1 的 joints/kinematics 能力恰是既有 SceneSpec v1 **缺失的增量**（现有 constraints 是静默装配定位，非运动关节）→ 正确落点=SceneSpec v1 additive `joints[]` 段（version 不变、向后兼容，沿 constraints/lights 历史扩展先例）。
- BLOCK-322「求值只发生在 Blender（唯一执行器）」原则不受损：sand3d 程序经 bpy 执行（同一 Blender 内核，DSL 接口而非第二几何内核）；预览端仍零建模。
- S2 探针的 Scene IR v0 草案**不作废**：其 N1–N8 归一规则与实测 schema 是本包归一器的直接输入；草案文档已加注 canonical 落点变更。

## 1. 范围（scope）

### A · SceneSpec v1 additive 关节扩展（L2 校验器，红绿先行）

- `core/petri-server/helpers/scene3d.js`：新增 `JOINT_KINDS = revolute|prismatic|continuous|floating`（探针实测导出层值域）、`validateJoints(joints, nodesById, errors)`（id 唯一/child+parent 引用必须在场/follows 指向在场且非自身禁环/kind 越界拒绝/axis 三维有限向量/range 仅 revolute+prismatic 且 min≤0≤max/数值全有限）+ `validateSceneSpec` 接线（`if (input.joints !== undefined)`，与 constraints 同款）。
- **零破坏红线**：无 joints 的既有文档行为逐字节不变；既有全部 scene3d 契约测试零回归。
- 哈希/diff 链自动覆盖（stableStringify 整对象哈希），不另建第二哈希。

### B · sand3d GLB → SceneSpec 归一器（L2 归一，fail-closed）

- 新文件 `core/petri-server/helpers/scene3d-import.js`：stdlib 解析 GLB JSON chunk（复用探针 parse 逻辑）→ 产出 SceneSpec v1 文档：
  - 单个 `mesh-reference` 节点承载整装配 GLB（mesh-assets 资产单源：sha256 锚定；不做逐件拆分——留 P3）；
  - `joints[]` 按 N1–N7 归一（关节节点→IR 关节、axis 四元数变换到父/世界系、transform mm→m、rest 校验 value 全 0 否则拒绝、floating/continuous 无 range、mimic→follows/ratio）；
  - `source` 溯源段（producer/producerVersion/programDigest/glbSha256）入 `metadata`。
- fail-closed：任何校验失败→拒绝整份文档+诊断 JSON，不产出半份。

### C · sand3d runner sidecar（L1，guard-ack 链内）

- 新文件 `sidecars/sand3d-runner/sand3d-runner.mjs`（Node stdlib，零依赖）+ `README.md`：
  - 子命令 `bootstrap`（幂等建 venv + pin `sand3d==1.6.3`；venv 路径默认 `.petri-dev-user-data/sand3d-venv`，env `SAND3D_VENV` 可覆盖）与 `run --program <file.py> --out <dir>`（执行程序→导出 GLB+URDF→stdout JSON：glb/urdf 路径、sha256、s3d fingerprint、退出码）。
  - **零新 IPC/零新 agent 工具**：agent 经既有 `run_cmd`（guard-ack 审批链）调用本脚本——不建第二执行通道（charter §3.4）。
  - runner 自身不联网（bootstrap 除外）不读任意路径（program 路径限 workspace 相对）。

### D · 3d-authoring 产品 Skill（L0）

- `resources/skills/3d-authoring/`（沿 design-brief 包形态：`skill.json` + `prompts/system.md` + `README.md`）：plan-first 工作流（部件计划→程序→runner→归一→验证）；sand3d API 摘要（探针实测口径）；SceneSpec joints 契约摘要；明确「执行走 run_cmd 审批」「capability 默认关」「观感不代签」。
- `resources/skills/manifest.json` 登记 + `npm run skills:check` 绿。

### E · 可动装配端到端（判据：M1 子集）

- 程序→runner→GLB→归一器→`.scene3d.json`（validateSceneSpec 绿）→digest 双锚一致（program fingerprint + GLB sha256）。
- 证据落 `acceptance/block460/`（端到端脚本 + 输出 JSON + 场景文档样例）。
- **不含渲染**（P3 呈现层另包）；不含 three-live 接入（P2）；不含 Polyfork/img2threejs（裁决边界未到）。

## 2. 非范围（exclusions）

- 逐件 mesh 拆分与装配树到 mesh-reference 的完整映射（P3）；渲染/viewer 接线（P3）；three-live MCP（P2）；仿真/gym（P2）；Polyfork 素材源（B-4 授权核清前）；img2threejs 封装（后续包）；UI/台账条目（本包零 UI 写面）；agent 内核（agent-runner/registry/IPC 零改动=内核零改动判据）；G1+。

## 3. 依赖与边界

| 项 | 边界 |
|---|---|
| sand3d 1.6.3 | 仅入 sidecar 自管 venv（B-1 边界延续）；零产品 npm/py 依赖 |
| bpy 4.5.16 | 随 sand3d 传递依赖（py3.11） |
| GLB 解析 | stdlib `struct`+`json`（探针已验证），零第三方 |
| 既有 scene3d 契约 | additive 零破坏；BLOCK-322 既有测试全数保持绿 |

## 4. 验收门禁与证据

- **G1 红绿先行**：`test/block460-scene-joints.test.mjs` + `test/block460-glb-import.test.mjs` 先红后绿（两轮输出留痕）。
- **G2 零回归**：既有 scene3d/model3d 邻域测试全绿（`node --test` 定向）。
- **G3 sidecar**：bootstrap 幂等 + run 输出契约 JSON 断言（真实执行腿，venv 复用探针环境可重建）。
- **G4 Skill**：`npm run skills:check` PASS + manifest 登记。
- **G5 端到端**：acceptance/block460/ 证据 + digest 双锚一致。
- **G6 治理门**：docs:check / ui:audit:check / hygiene / test:changed（impact-map 登记）定向绿；quality:lint/types 按改动域。

## 5. 完成语义

- completed = G1–G6 全绿 + 六件套回写（plan/blueprint 修正/roadmap/handoff/AUDIT-LOG/registry）+ commit。
- P2（验证闭环 L4）与 P3（呈现 L3/L5）不在本包；观感面=零（无 UI 改动，无 pending_human_eye 条目）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
