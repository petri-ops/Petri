---
capability: 3d-authoring-domain
status: planned
goal: 为 3D 造物域五方外部工具/素材源（sand3d、three-live、Polyfork、img2threejs、立项本身）产出可逐项裁决的依赖与授权决策材料，供用户裁决 U-3D-D1~D5；未裁决前不安装、不引包、不改产品行为
acceptance:
  - 每项 U 含现状/候选/风险/推荐/状态五段，按 DEPENDENCY-CHANGE-CHECKLIST 四问答全
  - 授权红线（Polyfork 禁令 / img2threejs 外部服务）单列核对
  - 状态一律 pending_user_ruling，Agent 不代答、verdict 禁用 PASS/verified/completed
  - 本文件从属于 3d-authoring-domain-charter，冲突以 charter 为准；不启动工作包
---

# 3D 造物域依赖与授权裁决材料（U-3D-D1~D5）

> **从属声明**：本文件从属于 `docs/3d-authoring-domain-charter.md`（稳定顶层设计），在其 §4 依赖/授权约束下逐项裁决；冲突以 charter 为准。
> 定位：决策输入材料（`evidenceClass: decision-material`），非验收证据。五项均 `pending_user_ruling`，**Agent 不代答、不替用户裁决**；`verdict` 禁用 PASS/verified/completed。
> 依赖四问（每项必答）：① 替代方案审过没；② 许可证与维护度；③ 影响面；④ 退出成本。推荐形态取值：引 / 不引 / 隔离探针 / 自研替代。

## U-3D-D1 · sand3d（来源 A 程序化几何）

- **现状**：面向 LLM 的确定性 Python/bpy 建模 DSL（v1.6.3，Apache-2.0，~2.1k stars），导出带 joints extras 的 GLB/URDF/USDA/IFC；无 MCP、无渲染、无 server。是来源 A 的核心候选。
- **候选**：① 引入（本地 Python runner）；② 不引、自研最小 DSL；③ 隔离探针（临时 venv 验证 GLB extras schema 后决定）。
- **四问**：
  1. 替代：CadQuery/原生 bpy 脚本 token 成本高、无命名式与 joints extras 语义，自研等价 DSL 体量大 → 替代不充分。
  2. 许可证/维护度：Apache-2.0；有近期提交与数据集生态，维护度中上。
  3. 影响面：重依赖 `bpy`（Python 3.11/3.13 + Blender），不入前端 bundle；本地执行；无 native ABI 风险到 Node。
  4. 退出成本：L1 以一层 runner wrapper 隔离，不散落直引；移除只需摘除 wrapper。
- **风险**：环境前置重（bpy 版本/平台）；GLB extras schema 未公开需先探针；golden digest 跨平台漂移。
- **推荐**：③ 隔离探针先行——P0 用临时隔离环境实测 extras schema 与 Scene IR 映射，成功且用户认可后再议正式引入；默认不装全局。
- **状态**：`pending_user_ruling`（用户裁决原话待填，日期待填）。

## U-3D-D2 · three-live（呈现 + 验证运行时）

- **现状**：Three.js→多端原生 JIT 运行时（Android Filament/Jetpack XR、iOS RealityKit、Web WebXR）+ capability 沙箱 + CLI/MCP 9 工具 + Agent Gym；Apache-2.0，Beta，非 Google 官方支持产品。
- **候选**：① 引入（外部 MCP server + 呈现运行时）；② 不引，仅用其验证范式自研；③ 隔离探针。
- **四问**：
  1. 替代：多端原生运行时 + Agent Gym 验证闭环无等价现成替代，自研体量巨大 → 替代不充分。
  2. 许可证/维护度：Apache-2.0；Beta 且"非官方支持"，上游稳定性需评估。
  3. 影响面：CLI/MCP 走外部 stdio server，零前端 bundle 影响；运行时依赖 npx 工具链。
  4. 退出成本：L3 viewer 包 + L4 verification adapter 两层 wrapper 隔离；移除不触内核。
- **风险**：Beta 上游漂移；外部工具链引入需裁决；capability 声明须与 Petri 治理对齐。
- **推荐**：① 引入但限定为"外部 MCP + adapter 隔离"——只在用户认可后接入 MCP 货架，capability 默认关；核心验证范式（脚本 enforce + validate/render/sim）先自研抽象。
- **状态**：`pending_user_ruling`。

## U-3D-D3 · 3D 蓝图立项与首包范围

- **现状**：`3d-authoring-domain-blueprint`（planned）已含蓝图六要素 + 计划六要素 + 七方面考量；超级总蓝图 C-54 将其列第 3 档、前置为 D1/D2 裁决 + GLB extras 探针。
- **候选**：① 按建议立项（首包 P0–P1：探针 + Skill + runner + IR）；② 缩到仅 P0 探针；③ 暂不立项。
- **四问（立项形态不完全等同于依赖，按等价维度评估）**：
  1. 替代：不立项则维持现状散点 Skill，无法满足用户"大幅提升 3D 能力"诉求 → 替代不成立。
  2. 许可证/维护度：本域为 Petri 自身能力，无外部许可问题。
  3. 影响面：占串行槽位；阶段内不触通用主线 / Result Studio 资格线。
  4. 退出成本：按领域入驻配方组织，领域可整体下线不动内核。
- **风险**：依赖未裁决先开工（触 §4 依赖纪律）；范围蔓延成通用引擎。
- **推荐**：② 先只立 P0 探针包（S 体量）——验证 GLB extras 映射与三源可替换判据，再据结果决定 P1；立项需在 D1/D2/D4/D5 裁决后。
- **状态**：`pending_user_ruling`。

## U-3D-D4 · Polyfork 素材源（来源 B）

- **现状**：3,392 个 low-poly 3D 素材（GLB + ES module `createAsset()` 返回 `THREE.Group`），商用免署名、免费 mesh 为 CC BY 4.0、提供 API+MCP 与 CDN hotlink。
- **候选**：① 引入（CDN hotlink / 本地按需下载 / API+MCP 检索）；② 不引；③ 仅登记候选。
- **四问**：
  1. 替代：自建 3392 级素材库不现实；现成件装配是来源 B 的必要条件 → 替代不充分。
  2. 许可证/维护度：商用免署名（允许用于 apps/commercial products）；维护活跃（周更素材）。
  3. 影响面：不打包进产品（走 hotlink/按需下载）；catalog 只存元数据与链接。
  4. 退出成本：catalog + `asset_search` 工具隔离；移除不触内核。
- **授权红线（单列核对）**：⛔ 禁转售/再分发 `.mjs` 源与 HD 版；⛔ 禁用其资产构建"商业资产生成器"（向他人提供生产 3D 资产的服务/流水线）；把大量资产托管给用户使用需 Platform licence。裁决须确认：Petri 本地 agent 帮用户装配其**自有场景**落在"commercial use"允许侧；**不得**打包分发、**不得**做成对外生成服务。
- **风险**：授权边界误判导致合规问题；检索退化为"内置素材包"触 §2.2 排除项。
- **推荐**：① 引入但限定 CDN hotlink / 用户工作区按需下载 + `asset_search` 工具；授权未核清前不接入。
- **状态**：`pending_user_ruling`。

## U-3D-D5 · img2threejs（来源 C 图像重建）

- **现状**：图像→程序化 Three.js `THREE.Group` factory 的 agent skill（v2.0.1，Apache-2.0，~90 Python stdlib 脚本），质量门禁 + 逐 pass + fail-closed；输出与 three-live/Polyfork 同构。技术评估见 `IMG2THREEJS-EVALUATION.md`。
- **候选**：① 引入（抽取门禁/spec 思想 + 受治理封装为 built-in Skill/MCP）；② 整包 skill 安装；③ 不引，仅借鉴范式。
- **四问**：
  1. 替代：门禁体系与 spec schema 可自研，但已有成熟实现；从图重建入口无等价 → 部分不可替代。
  2. 许可证/维护度：Apache-2.0；版本 2.0.1，有插件生态。
  3. 影响面：核心脚本 stdlib-only（加分）；需 Python 3.10+；agent 宿主耦合（改造成 Petri built-in Skill 不装宿主目录）；可选 CV 工具与外部服务默认关。
  4. 退出成本：抽取概念 + wrapper 隔离，不整包引入；移除不触内核。
- **风险**：本地主权（hosted TRELLIS/Context7）需默认关；`doctor` 只审计安装不能作质量证据；单图 fidelity 上限须产品文案诚实标注。
- **推荐**：① 引入——借形 + 受治理封装，不整包安装；门禁范式反哺 L4 验证与 W11 spec fail-closed；外部服务默认关 + P5-a 确认。
- **状态**：`pending_user_ruling`。

---

## 汇总（供裁决一览，非结论）

| U 项 | 对象 | 推荐形态 | 状态 |
|---|---|---|---|
| U-3D-D1 | sand3d | 隔离探针先行 | pending_user_ruling |
| U-3D-D2 | three-live | 引入（外部 MCP + adapter 隔离） | pending_user_ruling |
| U-3D-D3 | 立项/首包 | 先立 P0 探针包 | pending_user_ruling |
| U-3D-D4 | Polyfork | 引入（hotlink/按需 + asset_search，授权核清后） | pending_user_ruling |
| U-3D-D5 | img2threejs | 引入（借形封装，不整包） | pending_user_ruling |

> 用户逐项裁决后：把裁决原话与日期填入各 U 项"状态"行；回写 charter 修订记录（若触及冻结项）、超级总蓝图 C-54 第 1 档投影、AUDIT-LOG 一行。**裁决前一律不安装、不引包、不改 manifest、不开工程包。**

G0 开发期常态 · 不外推 packaged/Provider/GA。
