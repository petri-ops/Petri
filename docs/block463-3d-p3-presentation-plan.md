---
capability: block463-3d-p3-presentation
status: active
goal: 3D 造物域 P3 呈现层首包（BLOCK-463，L3/L5）——SceneSpec 证据面板（joints/provenance/verifierResults 呈现进 Model3DResultViewer）+ 双形态互达（::compose 卡 ↔ Result Studio 工作面）+ 领域扩展点零内核改动证明；沿 RW-01 既有 viewer/选择总线增量，不重建
acceptance:
  - HK-01 红绿先行：SceneSpec 证据面板 + 双形态互达契约测试先红后绿
  - Model3DResultViewer 配对 scene.json 时呈现 joints 清单/provenance digest/verifierResults verdict（证据自证=魂）；无配对时零行为变化
  - ::compose mesh-reference 卡（.glb）提供「打开工作面」跳转（沿 UI-654 先例）；沙箱/compose/model3d 三面互达契约在册
  - 零内核改动证明：registry 解析链/路由/agent-runner 零 diff，增量全部落领域面（diff 分析入 acceptance）
  - 9223 离屏实机腿尽力跑（无窗口栈）；不可行则 external-blocked 如实判档（不冒充）
---

# BLOCK-463 · 3D P3 呈现层首包（L3/L5）（active / P3-LAUNCH）

> **发令**：用户 2026-11-18「好 接下来 干啥子呢」（= Jev 单一建议 3D P3 呈现层首包获批）。
> **从属**：`docs/3d-authoring-domain-charter.md` §1（L3 呈现层）→ 蓝图 §8 P3 任务卡 → 本 plan。
> **存量对账（plan 差异，必读）**：蓝图 P3 ①③ 大半已被 RW-01 既有面覆盖（viewerRegistry 已有 model3d adapter + .glb/.scene3d.json 解析 + canSelect=true；Model3DResultViewer 已接选择总线 + UI-654 工作面跳转）——蓝图作者漏了存量（与 SceneSpec 漏勘同源）。本包只做**真实增量**，不重建既有面。

## 1. 范围（scope）

1. **A · SceneSpec 证据面板**（呈现层核心增量）：`Model3DResultViewer` 配对 scene snapshot（沿既有 `sceneSnapshotFromUrl`）存在时，展示——joints 清单（id/kind/axis/range）、`metadata.provenance`（producer/programDigest/glbSha256）、`verifierResults` 逐条 verdict+digest（BLOCK-462 truth 链呈现到用户面前=证据自证）；无配对/无 joints 时零行为变化。CSS 走既有 module 增量 + theme token 契约。
2. **B · 双形态互达**：`ComposeCard` 的 mesh-reference 节点当 source.path 以 .glb 结尾时提供「在 Result Studio 打开」跳转（沿 UI-654 workbench 先例）——::compose 卡 ↔ 3D 工作面互达；三面（沙箱/compose/3D viewer）选择语义以纯函数 `selectComposePresentation` 契约化（测试钉住判定矩阵）。
3. **C · 零内核改动证明**：diff 分析落 acceptance（viewerRegistry 解析链/路由/agent-runner/IPC 零 diff；增量全部落 Model3DResultViewer/compose 领域面）——领域入驻配方复验证据。
4. **实机腿**：9223 离屏尽力跑（无窗口后端 + test instance）；场景=sand3d 端到端产物（GLB+scene.json）在 Result Studio viewer 的面板在场断言。不可行则 external-blocked 如实判档。

## 2. 非范围（exclusions）

- three-live 原生多端渲染的 UI 面（render PNG 已是证据帧；WebXR 重渲染属 P3 后续/另包）；
- 选择总线的消费者扩展（既有消费面零改动）；
- viewerProfile 能力位调档（canCompare/canExport 维持既有占位语义）；
- Agent Gym、MCP 显式开启（用户动作）、G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`Model3DResultViewer` 证据面板契约测试（配对/无配对/joints 呈现/verifierResults 呈现）+ `ComposeCard` 跳转契约测试，先红后绿。
- **G2 零回归**：viewerRegistry/Model3D viewer/gen-ui compose 既有测试全绿。
- **G3 内核零改动**：diff 分析在册（内核面零 diff）。
- **G4 实机腿**：9223 离屏断言（尽力）；不可行 external-blocked 归因。
- **G5 治理**：closeout 定向门 + UI 台账登记（UI-710，观感不代签）+ impact-map。

## 4. 完成语义

completed = G1–G5 全绿或明确 external-blocked + 六件套回写。观感签字槽留空（Agent 不代签）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
