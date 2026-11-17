# img2threejs 技术评估与 Petri 整合方案（Projection / Index · 2026-11-17）

> 定位：第三方库技术评估 + 整合规划，供超级总蓝图（C-54）第 1 档依赖裁决与第 3 档 3D 造物域参考。
> 状态：`reference / non-canonical`；不启动工作包、不改产品行为、不引入依赖。
> 来源：github.com/img2threejs/img2threejs（README + README 原文，2026-11-17 抓取）；仓库版本 2.0.1，Apache-2.0，约 90 个 Python 模块。

## 0. 一句话结论

img2threejs 是**图像→程序化 Three.js 代码**的 agent skill（脚本强制质量门禁 + 模型做视觉判断），输出 `THREE.Group` factory——与 three-live 创作语言、Polyfork `.mjs createAsset()` **完全同构**。它是 3D 造物域**来源 C（从图重建）**的天然候选，且其"脚本 enforce / 模型 judge + fail-closed"门禁体系与 Petri"证据自证"魂高度契合；但重 Python/浏览器工具链、agent 宿主耦合、外部可选服务是主要适配面。

## 1. 技术评估

### 1.1 核心功能

单张参考图 → 重建为纯代码、程序化、质量门禁、动画就绪的 Three.js 模型。对象/角色/混合体分类走不同管线；硬表面（武器/机械/载具/道具）为强项；角色为风格化重建（含 anatomy、rig、skeleton）；可选多视图轮廓雕刻、GLB 基线测量、材质参考管线、CS2 武器皮肤插件。

### 1.2 技术架构（五阶段 + 插件）

```text
参考图 / GLB 测量资产
  → Stage1 Intake（图像探测/PBR 证据/材质区域/detail inventory/landmarks/camera pose/de-light）
  → Stage2 Spec（ObjectSculptSpec + strict-quality gate + assessment）
  → Stage3 Build（blockout→structural→form→material→surface→lighting→interaction→optimization 逐 pass）
  → Stage4 Review（material gate/comparison sheet/visual review/interior difference/chirality）
  → Stage5 Rig（rig spec/geodesic skinning/skeleton payload gate）
输出：TypeScript factory + ObjectSculptSpec JSON + runtime 元数据 + 渲染证据
```

原则：**浏览器 Three.js 渲染是最终权威**；Python 只做编排/哈希/manifest/诊断/gate；**脚本 enforce、模型 judge**；fail-closed（strict gate 失败返回 BLOCKED、不写 factory）；pass-gated 逐阶段生成；插件经 registry 注入（缺失即失败，不静默降级）。

### 1.3 依赖关系

- 必需：Node.js ≥18、Git、Python ≥3.10、一个 agent 宿主（Claude Code/Codex/OpenCode/Hermes）、Three.js 项目。
- 核心 Python 脚本 stdlib-only（PNG 读写用 struct/zlib），无需 pip/PIL/numpy/Playwright。
- 可选：SAM2、Depth Anything V2、MediaPipe、Chrome DevTools、Playwright、Context7；`img2glb` 插件走 hosted TRELLIS；私有 `environment` 插件需 GitHub 授权；赞助生态（MiniMax/Atlas Cloud/Tripo/Hyper3D）非核心依赖。
- 无硬性厂商锁定，但需多模态视觉+代码能力的 agent 宿主。

### 1.4 API / 输入输出

- 接口：agent slash command `/img2threejs`、npx install/doctor、img2 插件 CLI、~90 个 Python 脚本 CLI、state 恢复（`.img2threejs/state.json`）。无 HTTP API。
- 输入：单图（主）、多视图（可选）、GLB+diffuse（可选基线）、profile/plugin、state。
- 输出：`ObjectSculptSpec` JSON、`createXxxModel(spec, options): THREE.Group`、`userData.sculptRuntime`（nodes/sockets/colliders/destructionGroups）、`userData.rig`（bones/skeleton/boneOrder/boneIndexMap/bound）、comparison sheets、`BLOCKED` 失败产物。
- 质量门禁类型：strict-quality / pass gate / visual review / feature acceptance / material / geometry integrity / anatomy / scalp hard / hair soft / chirality / interior difference / rig / CS2 / plugin blocking / fail-closed routing。

### 1.5 适用场景

硬表面道具/武器从产品图重建；风格化角色/生物；需要 sockets/pivots/colliders 的动画前资产；需要可 diff/版本控制的文本资产而非二进制网格；带严格质量证据的 agent 工作流。

### 1.6 局限性

单图无法揭示背面/内部/遮挡面，按可见区推断并标低置信；不保证精确几何；角色风格化非 photoreal；code-only 限制超复杂真实细节；GLB 路线 rig/纹理常缺失、细节受 cell size 限制；v1.5 未含 hairProfile compiler/IK/pose-sweep/clothing；环境/引擎导出/Web UI/batch/多视角世界属 roadmap；doctor 只审计安装不证明相似度。

## 2. 与 Petri 的兼容性评估

| 维度 | 兼容判断 | 依据 |
|---|---|---|
| **功能定位** | ✅ 强互补 | 补 3D 造物域"来源 C：从图重建"，sand3d=从零工程件、Polyfork=现成件、img2threejs=参考图重建，三源归一 Scene IR |
| **技术栈** | ⚠️ 部分契合 | 输出 Three.js/TS 与 three-live/Polyfork 同语言；但核心是 Python stdlib 脚本 + agent skill 形态，非 npm 包，需本地 Python 3.10+ |
| **数据流** | ✅ 天然契合 | 输出 `THREE.Group` factory + `userData` runtime → 与 Scene IR nodes/joints/anchors 概念同构，可经适配层归一 |
| **架构** | ✅ 落魂 | 脚本 enforce/模型 judge + fail-closed + 逐 pass 证据 → 直接强化"证据自证 + 治理透明"，不动通用内核 |

### 2.1 可复用模块（按优先级）

1. **质量门禁体系**（最高价值）：strict-quality / visual review / material gate / fail-closed routing 的"脚本强制 + 模型判断"模式 → 可抽象为 Petri 3D 产物验证框架（L4），与 three-live validate/render/sim 并列。
2. **`ObjectSculptSpec` schema 思想**：componentTree/materials/sockets/runtimeHierarchy/detailInventory/per-region confidence → 喂给 L2 Scene IR 的字段设计参考（尤其 sockets/colliders/confidence）。
3. **pass-gated 分阶段生成**：逐 pass 解锁、单图审查、state 恢复 → 可作为 3d-authoring Skill 的工作流骨架（对齐 plan-first）。
4. **comparison sheet + 视觉审查**：reference-vs-render 对照 → 与 Gen UI 数据面评估的"视觉对照证据"同向。
5. **factory 代码形态**：`createXxxModel(): THREE.Group` → 与 Polyfork `.mjs` 同构，统一走 Scene IR 装配。

### 2.2 潜在冲突点

| 冲突 | 性质 | 处置 |
|---|---|---|
| agent 宿主耦合（skill 装到宿主目录） | 与 Petri 内置 Skill 体系不同源 | 不直接装 skill；抽取脚本与 schema 概念，改造成 Petri built-in Skill + MCP 工具 |
| 重工具链（Python+浏览器渲染+可选 CV） | 零依赖惯例张力 | 核心脚本 stdlib-only 是加分项；可选层按需、默认关 |
| 外部服务（hosted TRELLIS/Context7） | 本地主权红线 | 核心路线不依赖；可选服务默认关，需 P5-a 确认 |
| `doctor` 只审计安装 | 假完成风险 | Petri 侧验收必须走真机渲染 + 视觉对照，不采信 doctor |
| 单图 fidelity 上限 | 期望管理 | 产品文案明确"风格化重建、非精确复制" |

### 2.3 需要适配的部分

- **形态适配**：skill/CLI → Petri built-in Skill（`resources/skills/`）+ 受治理的 Python runner（走 guard-ack 审批链，同 sand3d runner）。
- **数据适配**：`ObjectSculptSpec` → Petri Scene IR v0 归一映射（componentTree→nodes、sockets/runtimeHierarchy→joints/anchors、confidence→evidence）。
- **验证适配**：img2threejs 门禁 → 并入 L4 verification adapter，与 three-live 工具编排复用同一 truth 链。
- **授权/依赖适配**：纳入 U-3D-D1/D4 依赖裁决；核心 stdlib-only 路线优先，外部服务默认关。

## 3. 整合规划

### 3.1 整合方式

**借形 + 受治理封装，不整包引入**：抽取质量门禁模式、spec schema 思想、pass-gated 工作流与 factory 形态，改造成 Petri 3D 造物域的"来源 C + 验证框架"；不把 img2threejs skill 直接装进宿主目录，不引入其外部服务依赖。

### 3.2 模块划分（映射到五层架构）

| Petri 层 | 来自 img2threejs 的模块 | 形态 |
|---|---|---|
| L0 意图编排 | pass-gated 工作流 + state 恢复 | 3d-authoring Skill 的"从图重建"分支 |
| L1 几何生产 | generate_threejs_factory（经 Python runner） | 来源 C runner，输出 THREE.Group factory |
| L2 Scene IR | ObjectSculptSpec 字段映射 | spec→IR 归一器扩展 |
| L4 验证证据 | strict/visual/material gate + comparison sheet | verification adapter 扩展 |
| L5 治理 | fail-closed routing + 逐 pass 证据 | 审批与留痕契约 |

### 3.3 集成步骤（建议并入第 3 档，来源 C 增量）

- S0：纳入第 1 档 `U-3D-D5` 依赖裁决（img2threejs 是否引入、以抽取/封装形态、Python 3.10+ 环境）。
- S1：spec→IR 映射探针（抽一个示例 spec，验证 sockets/runtimeHierarchy→IR nodes/joints）。
- S2：来源 C runner + guard-ack 接线（一个参考图→factory→Scene IR→渲染端到端）。
- S3：门禁框架抽取（strict + visual comparison 两个 gate 先落，复用 truth 链）。
- S4：与 sand3d（A）/Polyfork（B）三源归一回归，确认可替换判据仍成立。

### 3.4 预期收益

补齐"从参考图重建"这一高频创作入口（产品图/道具/角色），使 3D 造物域形成三源闭环（工程件/现成件/图生件）；把成熟的"脚本强制 + 模型判断 + fail-closed"门禁内化为 Petri 证据自证能力，可直接反哺 W11 Gen UI 的 spec fail-closed 设计；全程文本资产可 diff/审计，符合本地主权。

## 4. 与现有方向一致性

- 不碰 Result Studio 资格线、不动通用 agent 主线（dim1/2/3）、不引入 G1+；
- 与 three-live（呈现/验证）、Polyfork（素材源）、sand3d（程序化）三源并存于同一 Scene IR，内核零改动；
- 三裁决点扩展：U-3D-D1/D2/D3/D4 之外新增 U-3D-D5（img2threejs 引入形态），仍 `pending_user_ruling`；
- 本文件=non-canonical 投影，事实以 GitHub 仓库 README 与各 canonical 计划为准。

G0 开发期常态 · 不外推 packaged/Provider/GA。
