---
capability: block-322-model3d-full-spectrum
goal: 把现有「参数化 SceneSpec + Blender 导出」工程链扩展为覆盖内容生成/叙事场景/真实生产的全方位 3D 能力（P1 外部资产一等公民 → P2 场景表现力/叙事 → P3 几何与装配 → P4 CAD 交换与工程 → P5 AI 生成资产 → P6 生产交付与协作）。
acceptance:
  - 阶段级验收 = 每阶段定向测试 + 专项门禁 + 实机 flow + acceptance/block-322-p<n>/ 证据；收口走 closeout 十三门。
  - 红线 = 零第二 revision 真值 / 零第二执行器（Blender 唯一）/ 外部资产 sha256 锚定 + 工作区路径 + 大小上限 / 能力缺失如实报。
status: active
---

# BLOCK-322 · 3D 全方位能力（不设能力上限）

**状态**：active（P1 COMPLETED，2026-10-30；下一段=P2 场景表现力与叙事，启动按 §7 单包串行待令）
**用户裁决**（原话）：「我需要全方位的能力，不要对此设限制。应该要满足所有应用场景 按照这个目标前进」
**定位**：把现有「参数化 SceneSpec + Blender 导出」的工程链，扩展为覆盖**内容生成 / 叙事场景 / 真实生产**的全方位 3D 能力；阶段化交付，但**能力型排除项只按"尚未排到的阶段"登记，不作为永久边界**。

---

## §0 目标与原则

1. **无能力上限**：故事的、生产的、工程的、内容的场景都要能覆盖；不预设"这个不做"。
2. **单一真值不变**：SceneSpec（`*.scene3d.json`）仍是参数化源真相；外部资产以 **sha256 锚定**进入场景，不做第二份几何真相。
3. **零第二执行器**：构建/渲染/导出仍由 Blender 无头执行（现路径），不新建并行几何内核的执行器。
4. **诚实边界**：能力没做到就如实报（capability_unavailable / 未实现），不伪造结果。
5. **阶段化**：按 §3 逐阶段立项；每阶段独立验收，阶段顺序可因用户裁决调整。

## §1 能力地图（四域）

| 域 | 能力 |
| --- | --- |
| A 建模 / 几何 | 参数化基本体、外部资产、布尔/圆角/阵列/挤出/放样、曲线与文字、装配约束、CAD 交换 |
| B 场景 / 叙事 | 场景组装、灯光/环境、相机/构图、PBR 材质、动画与镜头、序列帧/视频、AI 生成资产 |
| C 生产 / 工程 | 尺寸/单位/公差、2D 工程图、BOM/质量属性、网格质量、3D 打印准备与切片对接 |
| D 交付 / 协作 | 结果面 viewer、版本/血缘、导出格式矩阵、资产库、分享与批注 |

## §2 现状盘点（2026-10-30，代码级）

**已有**
- SceneSpec v1：`box / sphere / cylinder / plane / group / mesh-reference`；mm、z-up-right-handed；`align` 约束（x/y/z）；白名单操作（set_parameter / update_node / add_node / remove_node / set_metadata）。
- 外部网格：`mesh-reference` 支持 **STL/OBJ/GLB/GLTF**（P1a 扩入 GLB/GLTF）；契约层校验工作区相对路径 + sha256 + 扩展名白名单（`helpers/mesh-assets.js` 单源，≤64MB），Blender 构建时逐字节复验 sha。
- Blender 无头：构建 + 4 视角渲染（front/top/side/iso）+ 导出 GLB/STL/OBJ + manifest + 网格报告（顶点/三角面/非流形边/水密/体积）。
- Agent 工具：inspect / validate / propose / apply / render / visual_qa / export / recipe（5 类模板）。
- UI：3D 工作台（打开 SceneSpec / 导入 GLB/GLTF/STL/OBJ 只读预览 / **导入为场景节点（P1c）** / 参数编辑 / 草图转需求 / 对比 / 测量 / 视角书签 / 截图 / 节点点选 / 视觉 QA）。
- 预览渲染：SceneSpec 视图内的 `mesh-reference` 节点按工作区文件 URL 真加载并纳入包围盒与点选（P1b）；失败/无工作区按节点显式报，不静默省略。
- 成果面：3D viewer + revision/change-set/lineage + selectionBus。

**缺口（按域）**
- A：无布尔/圆角/阵列/挤出；约束只有 align；无 STEP/IGES。（GLB/GLTF 进 SceneSpec、UI 创建 `mesh-reference` 节点、预览渲染三项已随 P1a/P1b/P1c 关闭）
- B：无灯光/相机/贴图/动画/序列帧/视频；渲染固定 4 视角静帧；无 AI 生成资产。
- C：无 2D 工程图/BOM/公差/切片对接；质量属性仅网格报告。
- D：导出格式仅 GLB/STL/OBJ；无资产库/分享。

## §3 阶段划分

### P1 · 外部资产一等公民
- 范围：GLB/GLTF 进 `mesh-reference`（Blender `import_scene.gltf`）；预览渲染 `mesh-reference`（按工作区 URL 加载）；UI 添加外部资产（上传到工作区 → 计算 sha → add_node）；导出/登记链保持。
- 验收：单测（校验/扩展名契约）+ 实机（导入 GLB → 预览可见 → 导出成功 → revision 登记）。
- 证据：`acceptance/block-322-p1/`。
- **进度（2026-10-30，P1 整段 completed）**
  - **P1a**：Blender 构建支持 GLB/GLTF（`import_scene.gltf`），契约测试 2/2。
  - **P1b**：预览端渲染 `mesh-reference`——`Model3DScene` 按 `workspaceFileUrlFor` 从工作区文件路由真加载，纳入包围盒/相机取景/递归点选；原 `node.type === 'mesh-reference') continue` 静默跳过（侧栏列出节点、画面永不显示）已消除，且由 `test/block322-mesh-format-single-source.test.mjs` 反向锁定禁止回归。
  - **P1c**：UI「导入为场景节点」= 分片写入 `model3d/assets/`（同名不覆盖，换名新建）→ `POST /api/model3d/asset/inspect` 服务端从磁盘真实算 sha256/字节并按单源白名单拒绝 → `add_node` 走既有 `scene/apply` 白名单（乐观锁 + 修订历史）。零新增 IPC 通道、零第二写面。
  - **证据**：`acceptance/block-322-p1/block322-p1-external-asset-live-live.json`（**29/29 allPass**；win32-x64 + 真实 Blender 4.5.10 LTS + 9223 离屏：预览「渲染对象」2→3、资产落盘、SceneSpec 写入、缺失资产显式报 `mesh_reference_load_failed`、篡改 sha 构建 `mesh_source_hash_mismatch`、四类拒绝）+ 数值明细 `block322-p1-detail.json`。
  - **本批裁决留痕（补丁 vs 重构）**：实码盘点发现 12 份硬编码 mesh 格式列表 + 4 份大小上限 + 分片上传两处重复，而 §4 红线要求的「大小上限」在契约层根本没有执法点（只在 Blender 构建中途炸）。判定为重构信号（再加一片就是摞第二套真值），故本批建 `helpers/mesh-assets.js`（后端声明处）+ `frontend/src/lib/meshAssets.ts`（渲染层镜像，跨语言逐值对账门守护）+ `lib/workspaceFileUpload.ts`（分片上传单源，回改 RightFileTree 与 attachmentUpload 两处旧副本，行为基线=改前后同套定向测试绿）；并把格式/上限执法点前移到 SceneSpec 校验与预检端点。**未一并收敛**：导出侧格式白名单（glb/stl/obj）属另一概念、仍各自声明 → 登记为后续债，不在 P1 范围内硬合。
  - **未验证面（如实登记）**：①多文件 `.gltf`（外部 `.bin`/贴图）经 `setResourcePath` 的解析路径已实现，但本轮实机只覆盖自包含 `.glb`；②`mesh-reference` 指向非网格内容（相机/灯光/骨骼）时预览与 Blender 均只取 MESH、其余静默不显示（P2 候选）；③`asset/inspect` 沿用既有同步 sha256 helper（≤64MB 读盘 ~0.1–0.3s 阻塞事件循环，与 scene-store/artifact-truth 同形态），若后续大资产频繁导入再评估流式化。
  - **顺带澄清的既有语义**：`scene/apply` 首次写入不产生 revision（无历史可快照），第二次编辑才留痕，且 `revision.reason` 记的是触发快照的当前编辑——非缺陷，实机腿已按此契约断言。
- **P1 收口门禁总账（2026-10-30，`npm run closeout` 十三门全绿 PASS）**：audit:compact 自稳 → hygiene:check → docs:check PASS(432 文档) → ui:audit:check（Git 历史 571 个带证据 UI 编号）→ test:changed（Node 656 项 **654 pass / 0 fail / 2 skipped**；前端 related 29 + 定向 63 = **92 个测试文件全绿**）→ gate:code-size → gate:arch-cycles → gate:css-modules → quality:secret → quality:arch → quality:lint（**0 error**，2064 条存量 warning 全在抑制基线内）→ quality:types → quality:knip:check；报告级 skills:check OK。
  - **收口过程真红三条（非环境抖动，逐条根修后复绿）**：①`frontend npm run check` 全量 tsc 在新增测试的 `File` 构造报 `Uint8Array<ArrayBufferLike>` 不可赋给 `BlobPart`（`quality:types` 的门面 tsconfig 不含测试文件，故先前漏过——门禁面差异如实登记）；②ESLint 新增 13 条 error（`require-await` / `no-base-to-string` / `no-unsafe-*` / 多余类型断言），逐条真修：`scene3d.ts` 的 `String(unknown)` 改判型、测试桩去 async 改显式 `Promise.resolve`、删除无必要断言，未使用全局关规则、未加 `eslint-disable`；③knip 棘轮 2 处新增：`MESH_INPUT_EXTENSIONS` 确属死导出（改内部常量），新实机 flow 属目录扫描动态入口（与基线内既有 108 个 `files::…/flows/*.cjs` 同形态），`--update` 后基线实测恰好 +1、零移除。
  - **评审**：`acceptance/block-322-p1/review.md`（七维全跑；P1 级 0 条；P2 一条「多资产同时失败错误互相覆盖」收口前已修并重跑实机复绿，其余 P2 已登记去向；本轮未做 ocr AI 跑查并如实声明原因=评审对象为未提交工作区 diff）。
  - **docs:reconcile**：Registered 432 / Unregistered 0 / Validation issues 0；归档候选 136 条**本轮零处理**——它们与本包无因果，且每条需逐一核入向引用，混批移动违反「他包 active 期间不批量搬文档」纪律，留作专门归档轮。
- **P1 非范围（保持纲内后续阶段）**：灯光/相机/PBR/序列帧视频=P2；布尔/装配约束=P3；STEP/IGES 与 2D 工程图=P4（内核依赖须用户裁决）；AI 生成资产=P5（服务/成本/隐私须用户裁决）；切片/资产库/分享=P6。

### P2 · 场景表现力与叙事
- 范围：SceneSpec 扩展灯光/环境/背景；相机（位置/目标/FOV/构图）；渲染分辨率与视角自定义；PBR 贴图；序列帧与转盘视频输出；结果面视频预览。
- 验收：可配置渲染产物 + 视频/序列帧实机 + 登记；CLI/工具面与 UI 面一致。

### P3 · 几何与装配
- 范围：布尔/圆角/倒角/抽壳/阵列/挤出/放样；装配约束扩展（distance/angle/mate）；几何结果进入网格报告与 revision。
- 验收：几何操作白名单 + 数值回归（体积/水密）+ 实机导出。

### P4 · CAD 交换与工程交付
- 范围：STEP/IGES 导入导出（内核选型待裁决：OCCT / FreeCAD headless / Blender 插件）；2D 工程图（三视图/剖视/标注）；BOM 与质量属性；公差字段。
- 裁决点：新增几何内核属重依赖，开工前须用户裁决（DEPENDENCY-CHANGE-CHECKLIST）。

### P5 · AI 生成资产
- 范围：文/图生 3D（外部服务或本地模型）→ GLB → 自动进链（资产库 + revision 登记）；生成参数与来源留痕。
- 裁决点：服务选型/成本/隐私（是否外发提示词与图片）。

### P6 · 生产交付与协作
- 范围：3D 打印切片对接（Orca/Cura CLI，可替换）；资产库；分享/导出矩阵（USDZ/FBX/…）；版本对比增强。
- 验收：切片产物 + 资产库检索 + 分享链实机。

## §3.5 任务单总表（2026-10-30 用户发令「后面所有的任务单 一次性安排好 并冲起来」=P2→P6 放量连续执行授权）

**执行纪律**：单票串行，每票自带「定向测试 + 专项门禁 + 实机腿 + acceptance 证据」，票内不预留半成品；每票收口回写本表状态列。**裁决点（RULING）不进队列头**——不依赖它们的票照常推进，撞到裁决点才停并出材料。

### P2 · 场景表现力与叙事（先做）

| ID | 范围 | 验收（可机械断言） | 证据 |
| --- | --- | --- | --- |
| `P2-01` 相机与构图 | SceneSpec 增 `camera`（position/target/up/fov/ortho 比例）；Blender 用该相机替换固定 4 视角相机；预览端同参数 | 校验层 + 前端镜像 + Blender 消费；导出渲染图的机位/张角与声明一致（渲染尺寸与几何投影可测）；实机腿 | `acceptance/block-322-p2/p2-01-*` |
| `P2-02` 灯光与环境 | `environment`（背景色/环境光强/三点灯 key-fill-rim 参数）；Blender world + 灯组；Three 侧同名灯组 | 背景色与亮度可按像素采样断言；两侧同参数同观感（容差内）；实机腿 | 同上 |
| `P2-03` PBR 材质与贴图 | `material` 扩 metallic/emissive/baseColorTexture（工作区贴图，**sha256 锚定，复用 P1 资产单源**）；Blender Principled + 贴图节点；Three `MeshStandardMaterial` + 贴图经工作区 URL | 贴图 sha 校验（篡改即拒）；渲染像素差异（有/无贴图）；实机腿 | 同上 |
| `P2-04` 序列帧与转盘视频 | 渲染面扩 `frames`/`turntable`（角度步进）；视频由 **Blender 内置 ffmpeg** 输出 mp4（不引入系统/npm 依赖） | 产物含 mp4 + 序列帧；bytes/sha/帧数可断言；登记进成果面 | 同上 |
| `P2-05` 结果面视频预览 | viewer 注册 `.mp4/.webm`（`<video>` 有界加载 + 失败如实报） | 组件测试 + 实机：结果面打开视频可播放 | 同上 |

### P3 · 几何与装配

| ID | 范围 | 验收 | 证据 |
| --- | --- | --- | --- |
| `P3-01` 几何操作 | 节点级 `modifier`（bevel / array / boolean union-difference-intersect）+ 白名单参数校验；Blender 应用 modifier；**预览端如实声明「近似/不显示 modifier」**（capability 不许伪造） | 数值回归（体积/水密/非流形边变化方向正确）+ 白名单 fail-closed + 实机导出 | `acceptance/block-322-p3/` |
| `P3-02` 装配约束扩展 | 约束扩 distance / angle / mate（写入后由 Blender constraint 求解并**回写 transform 快照**，SceneSpec 仍是源真相） | 约束应用后位置/角度数值回归 + 无效约束 fail-closed + 实机 | 同上 |

### P4 · CAD 交换与工程（含裁决点）

| ID | 范围 | 验收 | 依赖 |
| --- | --- | --- | --- |
| `P4-01` BOM 与质量属性 | 装配树 → BOM 表（CSV/MD）+ 体积×密度→质量（密度缺省可声明） | 表格产物 + sha + 登记 + 与网格报告体积一致 | 无（可先做） |
| `P4-02` 公差字段 | `metadata.tolerances` 结构化（标称/上下偏差/单位）+ 报告渲染 | 校验 + 报告产出 | 无 |
| `P4-03` 三视图线稿 | Blender freestyle/lineart 出前/顶/侧线稿 PNG + 视图标注（**不是 GD&T 工程图**） | PNG 产物 + 视图可区分 + 实机 | 无 |
| `P4-04` STEP/IGES 导入导出 | 需几何内核选型 | — | **RULING-01** |
| `P4-05` 2D 工程图（标注/剖视） | 真工程图（尺寸链/GD&T） | — | **RULING-01** |

### P5 · AI 生成资产

| ID | 范围 | 验收 | 依赖 |
| --- | --- | --- | --- |
| `P5-01` 生成资产入链管道 | 任意来源的 GLB → 资产目录 → sha 锚定 → `add_node`（复用 P1c）+ **provenance 留痕**（model/prompt 哈希/参数快照，不存明文提示词以外的敏感物） | 篡改 sha 拒绝 + provenance 落盘 + 实机 | 无 |
| `P5-02` 真实生成服务接线 | 文/图生 3D | — | **RULING-02**（服务/成本/隐私） |

### P6 · 生产交付与协作

| ID | 范围 | 验收 | 依赖 |
| --- | --- | --- | --- |
| `P6-01` 导出矩阵扩展 | USDZ（Blender 内置）/ FBX（内置） | 产物 + sha + 登记 + 实机 | 无 |
| `P6-02` 资产库 | `model3d/assets/` 注册表 + 列表/检索/复用（引用而非复制） | 检索命中 + 引用同一 sha + 实机 | 无 |
| `P6-03` 版本对比增强 | 场景 diff 之上加几何差值投影（bounds/体积/对象数变化） | 纯函数 + 组件 + 实机 | 无 |
| `P6-04` 分享包 | 本地导出包（场景 + manifest + 产物 + 校验和），不做云端 | 包可复算 + 缺件拒绝 | 无 |
| `P6-05` 切片对接 | Orca/Cura CLI（**外部可执行，默认关 + capability 探测 + 缺失如实报**） | 探测三态 + 真实切片产物 | **RULING-03**（是否允许外部 CLI） |

### 裁决点（材料就绪即停，不自行选型）

- **RULING-01（P4-04/05 前置）**：STEP/IGES 与真工程图需要几何内核（OCCT / FreeCAD headless / Blender 插件），属重依赖 → 必须先过 DEPENDENCY-CHANGE-CHECKLIST 并由用户裁决；候选对比与推荐在撞到时单出材料。
- **RULING-02（P5-02 前置）**：外部生成服务=成本 + 提示词/图片外发（隐私）→ 用户裁决。
- **RULING-03（P6-05 前置）**：调用外部切片 CLI（Orca/Cura）→ 用户裁决。

**推荐队列序**：`P2-01 → P2-02 → P2-03 → P2-04 → P2-05 → P3-01 → P3-02 → P4-01 → P4-02 → P4-03 → P5-01 → P6-01 → P6-02 → P6-03 → P6-04`（撞 RULING 即停取材料；RULING 解锁项插回队尾）。**理由**：先把「看得见的表现力」做完（P2 是用户对 3D 能力最直观的感知面），再做几何正确性（P3），再做生产交付（P4 无依赖项/P6），最后是需要外部条件的项。

---

## §4 红线

1. 零第二 revision 真值（`artifact_revisions` 唯一；`.history/` 场景编辑线不动）。
2. 零第二执行器（Blender 仍是唯一构建/渲染/导出执行器；新增能力走工具/参数扩展）。
3. 外部资产必须 sha256 锚定 + 工作区内路径 + 大小上限；不接受任意 URL/脚本。
4. 预览不得伪造：渲染失败/能力缺失如实报 `capability_unavailable`。
5. 新增 npm/系统依赖（如 OCCT）必须先过依赖检查单并获得用户裁决。

## §5 依赖

- 本地 Blender（分平台事实，均为可选后端）：Windows=`Blender 4.5.10 LTS`（本批 P1 实机证据出于此，`capability: ready`）；macOS=`Blender 5.2.3 LTS`。跨平台收口需两侧各自取证，不得以一侧代另一侧。
- 现有 SceneSpec/Blender/结果面/登记桥（RW-01）链路。
- 可选外部服务（P5）需用户提供凭据与成本裁决。

## §6 验收与证据

- 每阶段：定向测试 + 专项门禁 + 实机 flow + `acceptance/block-322-p<n>/`。
- 收口走 `npm run closeout`（十三门）；阶段状态回写本文件 + AUDIT-LOG + UI 台账。

## §7 完成语义

- 本计划为**长线能力纲**：阶段按 P1→P6 串行，用户可随时改序/加阶段。
- 单阶段 `completed` 仅表示该阶段范围完成，不代表"全方位达成"；纲整体转 `reference` 需用户裁决。
