---
capability: block-459-3d-p0-probe
status: active
goal: 3D 造物域 P0 可行性探针（BLOCK-459）——在临时隔离 venv 实测 sand3d 导出带关节 GLB 的 extras 真实 schema，验证到 Scene IR v0 的字段映射可行性，产出探针报告 + Scene IR v0 契约草案 + 决策记录，供 P1 领域首包（S3）是否开工的判据
acceptance:
  - 临时隔离 venv 安装 sand3d 成功导出带 revolute/prismatic 关节的 GLB（或诚实 external-blocked + 归因）
  - nodes[i].extras 真实 schema 实测记录（逐字段，非文档转述）
  - GLB extras → Scene IR v0 字段映射逐项验证结论（§4.3 映射表对照）
  - Scene IR v0 契约草案落 acceptance（P1 的 canonical 化在 P1 plan 内完成，本包不登记第二真相）
  - 零产品 manifest 改动、零全局 Python 包安装、venv 在仓库外
---

# BLOCK-459 · 3D 造物域 P0 可行性探针（active / P0-LAUNCH）

> **发令**：用户 2026-11-18 端到端预授权批量裁决——「B-3 立项 = 仅 P0 探针包」+「B-1 sand3d = 隔离探针（临时 venv，不全局装、不引产品依赖）」+「不需要人参与，尽可能一路推进下去」。
> **从属**：`docs/3d-authoring-domain-charter.md`（稳定顶层）→ `docs/3d-authoring-domain-blueprint-2026-11-17.md` §8 P0（任务卡）→ 本 plan（执行细化）。冲突以 charter 为准。
> **裁决材料**：`docs/3d-authoring-dependency-ruling-2026-11-17.md` U-3D-D1/D3（2026-11-18 已回填 ruled）。

## 1. 范围（scope）

1. **隔离环境**：仓库外临时 venv（`/tmp/block459-sand3d-venv`），安装 sand3d v1.6.3 + bpy 依赖；不污染全局 Python、不改动产品 package.json/pyproject、不新增产品依赖。
2. **程序化导出**：用 sand3d 写最小建模程序，导出带 **revolute + prismatic** 关节（含 axis/range）的 GLB 到探针工作目录。
3. **schema 实测**：解析 GLB `nodes[i].extras` 与 joints 相关字段，逐字段记录真实 JSON 结构（与蓝图 §4.3 假设对照，差异如实登记）。
4. **映射验证**：对蓝图 §4.3 六行映射（name/kind/axis+range/follows+ratio/assembly 树/mm 单位）逐项给出 可直接映射 / 需转换 / 缺口 三态结论。
5. **Scene IR v0 契约草案**：按实测结果修正蓝图 §4.1 草案，落 `acceptance/block-459/scene-ir-v0-draft.md`（P1 立项时的 canonical 化底稿）。
6. **探针报告 + 决策记录**：`acceptance/block-459/PROBE-REPORT.md`——含 S3（P1 首包）开工判据结论（可行 / 有条件可行 / 不可行 + 证据）。

## 2. 非范围（exclusions）

- P1 及以后：3d-authoring Skill、geometry runner wrapper、IR 归一器/校验器实施、可动装配端到端（=S3，仅当本探针判「可行」后按当期裁决启动）；
- three-live 接入（P2 阶段；capability 默认关的接线不在本包）；
- Polyfork 素材源（授权核清前不接入——B-4 边界）；
- img2threejs 封装（借形封装属后续包）；
- 任何产品代码 / manifest / 运行时行为改动（charter §2.2「不把 3D 引擎引进渲染进程」等冻结项不变）；
- G1+（Provider / 公证 / GA / 远程发布）。

## 3. 依赖与边界

| 项 | 边界 |
|---|---|
| sand3d v1.6.3 | 仅装进临时 venv（B-1 预置）；pip 源不可达/平台轮子缺失 → external-blocked 如实降级，不硬推、不改产品 |
| bpy（Python 3.11/3.13） | 随 sand3d 传递依赖装 venv；macOS arm64 轮子若不可得 → external-blocked + 归因（R1 风险预案） |
| GLB 解析 | 用 Python stdlib `json`/`struct` 手写最小 GLB JSON chunk 解析（零第三方依赖），脚本落 acceptance 目录随证据提交 |
| 网络访问 | pip 安装需要网络；失败即降级，不伪造成功 |

## 4. 验收门禁与证据

- **G1**：venv 安装与导出成功（或 external-blocked 归因记录）——证据：venv pip freeze 输出 + GLB 文件 sha256。
- **G2**：extras schema 实测 JSON 全文在册（原始导出物 + 解析脚本 + 解析输出）。
- **G3**：映射六行逐项三态结论 + 差异登记。
- **G4**：Scene IR v0 契约草案 + 探针报告 + S3 开工判据落 acceptance/block-459/。
- **G5**：零产品改动证明——`git status` 产品面（src/ frontend/ core/ package.json）零 diff。
- 治理门禁：docs:check / ui:audit:check（本包无 UI 写面）/ hygiene:check 定向执行；本包无产品代码改动，test:changed 预期零命中（如实记录）。

## 5. 完成语义与后续

- **completed 判据**：§4 G1–G5 全部有证据或明确 external-blocked 归因；canonical 回写（registry / roadmap / handoff / AUDIT-LOG）完成。
- **S3 开工判据**：探针判「可行 / 有条件可行」→ 按用户预授权启动 P1 首包（BLOCK-460，红绿先行）；判「不可行」→ 触发 charter §5.2 技术证伪变更评估流程，如实登记，不硬开 S3。
- 观感项：本包无观感面（零 UI 改动），无 pending_human_eye 条目。

## 6. 收口笔录（2026-11-18 · 一次会话收口）

- **G1 ✓**：venv（/tmp/block459-sand3d-venv，python3.11 + bpy 4.5.16 + sand3d 1.6.3，`pip-freeze.txt`）装成功；导出 revolute+prismatic+follows+continuous+free 全 kind 组合 GLB（`probe-rest.glb` sha256 `2e803be3…`、`SHA256SUMS.txt`）。
- **G2 ✓**：extras schema 实测原文在册（`rest-nodes-dump.json` + PROBE-REPORT §2）：`s3d_joint{name,type,value,axis,lower,upper,mimic?}`；kind 值域实测 = revolute|prismatic|continuous|**floating**（程序层 free→导出层 floating 的命名 gap 实锤）。
- **G3 ✓**：六行映射逐项三态（PROBE-REPORT §3 + `mapping-verdicts.json`）：4 direct（name/kind/follows+ratio/assembly 树）+ 2 convert（axis 局部系需四元数变换；混合单位 transform=程序单位 vs joint range=米/弧度）——**零不可行项**。
- **G4 ✓**：`scene-ir-v0-draft.md`（N1–N8 归一规则 + fail-closed 校验器要点）+ PROBE-REPORT + S3 判据=**可行**。
- **G5 ✓**：`git diff -- src/ frontend/ core/ package.json` 零 diff（零产品改动证明）。
- **确定性 ✓**：双进程 GLB sha256 一致 + `s3d.fingerprint()` 跨进程稳定（L1 判据探针尺度成立）。
- **门禁**：docs:check PASS（611）/ ui:audit:check PASS / hygiene:check PASS；test:changed 零命中（无产品代码改动，如实记录）。
- **后续**：S3（P1 首包）按用户预授权启动=BLOCK-460；三个实测差异（floating/混合单位/局部轴向）进 P1 plan 红绿契约。URDF 交叉对照确认平行输入可用（P2 仿真链）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
