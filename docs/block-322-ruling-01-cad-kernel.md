---
capability: block-322-ruling-01-cad-kernel
goal: 在 BLOCK-322 P4-04/P4-05 开工前确定 STEP/IGES 与工程图能力的内核选型、跨平台形态与诚实边界，使 Windows/macOS 共用一套可探测、可退出、无运行时静默下载的本地适配层。
acceptance:
  - 选型材料 = 候选事实表（许可证/体积/平台/能力/无头限制）+ 推荐单一方案 + 依赖变更检查单四问 + Mac 行为结论。
  - 实现验收（另包/本纲后续票）= 真实 STEP/IGES 文件的导入产物 + STEP 导出文件头/实体校验 + sha/bytes + 跨平台矩阵或如实标注未验证平台。
  - 红线 = 不造第二场景真值；Blender 仍是唯一构建/渲染执行器；不运行时静默下载内核；能力缺失如实报 unsupported/capability_unavailable。
reopen: 用户改判内核（改选 FreeCAD/OCP 原生）或要求真 B-rep/真 GD&T（需另立数据模型裁决）；候选版本/许可证重大变化
status: reference
---

# BLOCK-322 · RULING-01 几何内核选型材料（STEP/IGES 与工程图）

日期：2026-10-31 · 关联：[BLOCK-322 3D 全方位能力纲](./block-322-model3d-full-spectrum-plan.md) §3.5 RULING-01
用户裁决：2026-10-31 原话「批准 批准 开整」（批准 RULING-01 方向并开工；本文件是该批准的技术选型与边界记录）。

## 1. 结论（单一推荐）

**采用 `occt-wasm@5.11.0` 作为 CAD 交换主内核，`occt-import-js@0.0.23` 只补 IGES 导入。**

- 两者都是 **WASM/JS**：随 `npm install`/锁文件跨平台跟随，**不需要 Mac 上另装几何内核**，也没有 Windows 专有二进制。
- `occt-wasm` 覆盖 STEP 导入/导出（AP203/AP214/AP242）、XCAF 装配/颜色/名称、STL/BREP 导入导出、HLR 隐藏线消除与多视图 SVG；**明确不含 IGES**。
- `occt-import-js` 覆盖 STEP/IGES/BREP **只读导入**；没有导出，因此 **IGES 导出在本阶段如实不支持**。
- FreeCAD 与 CadQuery/OCP 都不作为首选：FreeCAD 495MB（Windows 安装器）/619MB（macOS arm64 DMG），且 TechDraw 的 SVG/PDF 无头导出仍受 GUI/Qt 约束；OCP 需要额外 Python 运行时与分平台 wheel（45.5–65MB/平台）。它们保留为「必须真 B-rep/真工程图」时的后续可选原生 provider，而不是默认依赖。

**能力边界（必须同时立项告知用户）**：

| 能力 | 本阶段结论 |
| --- | --- |
| STEP 导入 → 预览/资产 | ✅ `occt-wasm`：STEP → XCAF → GLB，保留装配层级/名称/颜色；原始 STEP 以 sha256 留痕 |
| STEP 导出（从当前 SceneSpec） | ⚠️ 只做 **faceted B-rep**：Blender 仍是唯一构建者，先出 STL，再由 OCCT `importStl` → `sewAndSolidify` → `exportStep`；**不是解析曲面/特征保持的 CAD STEP** |
| IGES 导入 → 预览/资产 | ✅ `occt-import-js` 解析为网格，再由 OCCT 转 GLB/STL；装配层级/颜色不保证 |
| IGES 导出 | ❌ 本阶段如实 `unsupported_format`（occt-wasm 明确排除 TKDEIGES） |
| 真工程图（尺寸链/GD&T） | ⏸ 只做 HLR 多视图 SVG 基础；尺寸链/GD&T 需要特征级引用（与 RULING-04 同源），本阶段不承诺 |
| 解析曲面/特征树级 STEP | ⏸ 当前 SceneSpec 是网格/基本体模型，没有 B-rep 特征树；要做必须另立数据模型裁决 |

## 2. 现状与硬约束（实码核实）

- `SceneSpec` 是参数化源真相；Blender 构建/渲染/导出是唯一执行器（`core/petri-server/helpers/blender-provider.js`）。
- 现有资产入链只接受 `glb/gltf/stl/obj`（`core/petri-server/helpers/mesh-assets.js`），STEP/IGES 没有入口。
- 现有导出格式为 GLB/STL/OBJ/FBX/USDZ（`resources/model3d/blender_scene.py::export_formats`）；Blender 4.5 没有内置 STEP/IGES 导出。
- 因此：**STEP/IGES 只能作为「外部格式适配器」接入，不能变成第二套场景真值或第二套几何执行器。**

## 3. 候选事实表（2026-10-31 核实）

| 候选 | 许可证 | 体积/依赖 | 平台 | STEP | IGES | 工程图/HLR | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **occt-wasm 5.11.0** | MIT OR Apache-2.0 | 包 21.8MB；WASM brotli ~4.7MB；Node 18+ | Windows/macOS/Linux（Node/WASM） | 导入/导出（AP203/214/242），XCAF 装配 | ❌ 明确排除 | HLR + Front/Top/Right/Iso 多视图 SVG | **主选** |
| **occt-import-js 0.0.23** | LGPL-2.1 | 包 11.6MB；Node/browser | Windows/macOS/Linux | 导入 | 导入 | ❌ | **只补 IGES 导入** |
| CadQuery + OCP 8.0.1.1.0 | CadQuery Apache-2.0；OCP Apache-2.0 | OCP wheel 45.5–65MB/平台；需 Python 3.11–3.14 + 运行时 | Win x64 / macOS x86_64/arm64 | 导入/导出 | 导入/导出（OCCT） | OCP 可做 HLR；无现成 TechDraw | 备选（真 B-rep/IGES 导出时） |
| FreeCAD 1.1.4 | LGPL-2.1+ | Windows 安装器 495MB；macOS arm64 DMG 619MB；需独立 App | Win/macOS/Linux | 导入/导出 | 导入/导出 | TechDraw 有；但 SVG/PDF 无头导出依赖 GUI/Qt（官方社区长期限制） | 不默认；仅在需要 TechDraw 时评估 |
| Blender STEPper 插件 | 第三方/商业 | 插件 | 页面标注 Windows-only | 导入 | ❌ | ❌ | 拒绝（不跨平台、非仓库可维护依赖） |

参考：[occt-wasm GitHub](https://github.com/andymai/occt-wasm) · [occt-import-js GitHub](https://github.com/kovacsv/occt-import-js) · [OCCT 官方发布页（LGPL-2.1）](https://dev.opencascade.org/release) · [CadQuery OCP PyPI](https://pypi.org/project/cadquery-ocp/) · [FreeCAD 1.1.4 安装包（winget 元数据）](https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4) · [FreeCAD TechDraw 无头导出 issue #5710](https://github.com/FreeCAD/FreeCAD/issues/5710) · [FreeCAD 许可证](https://wiki.freecad.org/Licence/zh-cn)。

## 4. 依赖变更检查单（四问）

1. **替代方案审过没**：审过 FreeCAD / CadQuery+OCP / Blender 插件 / 自研 STEP 解析。自研 STEP/IGES 解析不可行（B-Rep 拓扑、单位、装配、曲面求交远超本包范围）；FreeCAD/OCP 体积与运行时代价高；WASM 两件套覆盖面最大、可退出性最好。
2. **许可证与维护度**：`occt-wasm` 为 MIT/Apache-2.0（宽松）；`occt-import-js` 为 LGPL-2.1（需随分发附许可证与来源说明，动态/WASM 形态不做静态链接修改）。两者均为活跃包（occt-wasm 5.x 系列、occt-import-js 0.0.23），后者维护频率低于前者，故只用于 IGES 导入的窄面。
3. **影响面**：新增 npm 包约 33MB 解包体积；WASM 在 Node 主进程按需加载（不是每次启动常驻），不改变 Electron/前端 bundle；无 native ABI 依赖（不挑 Node 版本）；无系统安装、无 PATH、无运行时下载。
4. **退出成本**：所有调用收敛在 `helpers/cad-exchange.js` 一层；工具/路由只依赖该适配层的稳定返回；移除依赖时只需删除该文件与两个 format 分支，不散落直引。

## 5. Mac 行为（用户问题的直接回答）

| 形态 | Mac 上是否跟随 | 说明 |
| --- | --- | --- |
| `occt-wasm` / `occt-import-js`（本次选型） | **跟随** | 都是 npm 包 + WASM；Mac 上 `npm install`/锁文件即可，不需要另装 FreeCAD/OCCT；代码路径与 Windows 相同 |
| FreeCAD（未选） | 不自动跟随 | macOS DMG 需单独安装（约 619MB）；路径 `/Applications/FreeCAD.app/...`，要 capability 探测；TechDraw 无头导出另有限制 |
| CadQuery/OCP（未选） | 不自动跟随 | 需 Python 3.11–3.14 + 对应平台 wheel；Mac 上可能要另装 Python，wheel 还涉及签名/Gatekeeper |
| 运行时静默下载 | **禁止** | 不在后端启动/首次使用时联网拉内核；缺包即 `capability_unavailable`，安装由开发者显式执行 |
| 证据 | Windows ≠ Mac | WASM 代码相同，但仍必须在 Mac 上跑一次真实 STEP/IGES 导入/导出用例；Windows 实机证据不得代证 Mac |

## 6. 落地顺序（本文件批准后的实现边界）

1. **P4-04a（本次实现）**：加入两依赖 + `cad-exchange` 适配层 + capability probe；`model3d_asset` 支持 `.step/.stp/.iges/.igs` 导入 → 派生 GLB/STL 资产 + provenance；`model3d_export` 新增 `step`（Blender STL → OCCT faceted solid）。
2. **P4-04b（后续票）**：IGES 导入的装配/颜色增强（如需要），以及 STL→STEP 的多实体/大文件上限与错误码完善。
3. **P4-05（后续票，不随本批承诺）**：对导入 STEP 输出 HLR 多视图 SVG/剖视基础；尺寸链/GD&T 等 RULING-04 特征级引用落地后再做。
4. **不做**：IGES 导出、解析曲面 STEP、B-Rep 特征树、运行时自动安装内核。

## 7. 证据与未验证面

- 本材料的事实来自公开文档与本机实测探针（STEP 导出/导入、XCAF→GLB、STL→实体→STEP、IGES 导入、HLR SVG 均在本机 Node/WASM 跑通）；探针文件只用于选型，不入库。
- 未验证：macOS 实机、超大装配（>100MB）、复杂 NURBS/装配颜色一致性、FreeCAD/OCP 对照实测。上述均按「未验证」登记，不宣称跨平台已通过。
