---
capability: block-322-model3d-full-spectrum
goal: 把现有「参数化 SceneSpec + Blender 导出」工程链扩展为覆盖内容生成/叙事场景/真实生产的全方位 3D 能力（P1 外部资产一等公民 → P2 场景表现力/叙事 → P3 几何与装配 → P4 CAD 交换与工程 → P5 AI 生成资产 → P6 生产交付与协作）。
acceptance:
  - 阶段级验收 = 每阶段定向测试 + 专项门禁 + 实机 flow + acceptance/block-322-p<n>/ 证据；收口走 closeout 十三门。
  - 红线 = 零第二 revision 真值 / 零第二执行器（Blender 唯一）/ 外部资产 sha256 锚定 + 工作区路径 + 大小上限 / 能力缺失如实报。
status: active
---

# BLOCK-322 · 3D 全方位能力（不设能力上限）

**状态**：active（放量连续执行中，用户发令 2026-10-30；P2 段、P3-01/P3-02a/b、P4-01~03、P4-04a、P5-01、P6-01~04 已收口；剩余=撞 RULING 的 P3-03/P4-04b〔IGES 导出/解析 B-rep〕/P4-05〔真工程图/GD&T〕/P5-02/P6-05，等用户裁决；P4-P6 无裁决项批提交=dc6adb43；RULING-01/P4-04a 批提交=2f8fa437〔均本地，推送待发令〕）
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
| `P2-01` 相机与构图 **completed（2026-10-30，实机 18/18 + next04a 回归 7/7）** | SceneSpec 增可选 `camera`（position/target/up/fovDeg/projection/orthoScaleMm）与 `render`（width/height 16..4096）；Blender **新增 `camera` 视角**用声明机位出图（标准四视角保留，未声明即跳过不伪造），Blender 侧 `sensor_fit='VERTICAL'`+`sensor_height=24` 使 fov 与 Three 的**垂直** fov 同轴；预览端多出「机位」视角并真按声明取景 | 校验双层（退化视线/up 共线/fov 越界/正交缺画幅均拒收）+ 前端镜像同判据 + 报告回显 `effectiveAngleYDeg`/`orthoScaleMm`/`upApplied` 与声明对账 + camera.png 与 front.png 不同图 + 实机腿 | `acceptance/block-322-p2/block322-p2-camera-live-live.json` + `block322-p2-camera-detail.json` |
| `P2-02` 灯光与环境 **completed（2026-10-30，实机 9/9）** | SceneSpec 增可选 `lights[]`（sun/point/spot/area + energy/color/position/target/size/spotDeg，≤16）与 `environment`（background/worldStrength/samples/engine）；**声明灯光或环境时才切 CYCLES(CPU)**，未声明仍是 WORKBENCH；预览端声明灯存在即整体替换默认摄影棚灯组 | 灯种/能量/位置/重复/数量/环境四字段双层 fail-closed + 哈希随灯光变化 + 灯种与引擎名跨 JS/TS/Python 逐值对账 + **像素平均亮度单调对照**（world=0：导出 0.08→11.73；预览 3.25→59.29）+ 报告回显生效值 | `acceptance/block-322-p2/block322-p2-lighting-live-live.json` + `block322-p2-lighting-detail.json` |
| `P2-03` PBR 材质与贴图 **completed（2026-10-31，契约 8/8 + 前端 15/15 + 实机 14/14；P2-02 灯光腿重构后回归 9/9）** | `material` 白名单化为 `color/roughness/metallic/emissive/baseColorTexture`（未知键直接拒，不再「写了不认也不报」）；贴图走 **工作区相对路径 + sha256 锚定 + 独立 16MB 上限**，与 mesh 共用同一预检内核（`helpers/mesh-assets.js` 内 `inspectAssetFile`，只换格式白名单/上限/错误码前缀，不复制第二份「路径解析+大小+sha」实现）；新增 `POST /api/model3d/texture/inspect`，两端点共用同一 `assetErrorStatus` 映射（404/413/403/400）；Blender 侧 Principled 挂 Image Texture→Base Color 并**逐字节复验 sha**（篡改→`texture_source_hash_mismatch` 落进 `unsupported[]`，同场景其余基本体照常构建）；预览端 `MeshStandardMaterial` 消费 metallic/emissive + `TextureLoader` 从工作区 URL 取贴图，取不到按节点显式报 `texture_reference_*` 并进告警区（前缀清单收敛一处）。**关键设计裁决**：`configure_display` 的切引擎条件由「声明灯光/环境」扩为「**或声明 PBR 材质**」——Workbench 的 MATERIAL 着色只看基础色，不认 metallic/emissive/贴图，不同步切 Cycles 就是 P2-02 刚修过的同一类「加了但看不见」静默失真；报告回显 `declaredMaterial` 与 `materials.declared[]` 供与像素对照 | **像素单调对照**（同环境光、同引擎、同采样：贴图换纯红后 front.png `R 157.1→204.7`、`B 183.5→142.2`）+ 篡改 sha 显式失败 + 预检格式/缺失/越界三态 + 白名单与上限跨 JS/TS/Python 逐值对账 + 「Python 出现 `images.load(... check_data` 即红」回归锁 + 实机腿 | `test/block322-p2-03-material.test.mjs` + `frontend/src/lib/scene3d.test.ts` + `acceptance/block-322-p2/block322-p2-03-material-live-live.json`（14/14）+ `…-material-detail.json` |
| `P2-04` 序列帧与转盘视频 **completed（2026-10-31，契约 5/5 + 实机 11/11）** | `turntable` 属**输出请求**而非场景真相：不进 SceneSpec、不参与 hash（同一份场景转 8 帧还是 48 帧不改几何，写进场景就会为纯出图理由刷 revision）；上下界唯一声明在 `helpers/model3d-views.js::normalizeTurntable`（`frames 2..48` 缺省 24、`elevationDeg -89..89` 缺省 20），MCP schema 引用常量不抄数字，provider 只透传不夹取；Blender 侧用 `frame_change_pre` handler 逐帧定角（**不用关键帧**：4.5 的位置/欧拉曲线只给 `AUTO/EASE_*` 四种插值，`LINEAR` 被 enum 拒 ⇒ bezier 系会让转盘两头变速），先逐帧 `write_still` 出 PNG 序列（帧名自己定，可断言），再 FFMPEG 动画跑出 mp4（名字由 Blender 拼 ⇒ **按目录发现**取，不猜）；未请求时零额外渲染；转盘失败计入 `report.ok` | 实机 **11/11 allPass**：mp4 存在且 sha/bytes 与**盘面重算全等**（23298 B）+ 文件头 `ftypisom` 证明是真 mp4 而非改名 PNG + 8 帧序列逐张 sha 全等且**8 个哈希互不相同**（证明相机真的在转，不是同一帧复制）+ 序列帧不进 `outputs`（只 1 个 mp4 进成果登记，N 张近似帧不淹面板）而单独以 `frameAssets` 可核 + 越界 `{frames:49}` 在探 Blender 之前 400 + 未请求场景 `turntable.requested=0` 且无 mp4（存量零变化） | `test/block322-p2-04-turntable.test.mjs` + `acceptance/block-322-p2/block322-p2-04-turntable-live-live.json` + `…-detail.json` |
| `P2-05` 结果面视频预览 **completed（2026-10-31，组件 7/7 + 注册表 4/4 + CSP 1/1 + 实机 10/10）** | viewer 注册表新增 `video` adapter（`.mp4/.webm` 命中，先于 image/json/text/binary 兜底；档案 `canExport=true`、`canSelect/canCompare=false` 如实声明——视频没有文本选择语义也没有两份视频的 diff 语义）；`VideoResultViewer` **先 fetch 字节再挂 `blob:` 源**，`<video controls preload="metadata">` 不自动播放，64MB 上限（超限直接拒且**不读入内存**），三态如实（读取中/已解出=显示时长与真实分辨率/失败=区分「取字节失败」与「解码失败」并给原文件出口）；CSP 补 `media-src 'self' blob:`，工作区文件路由补 `video/mp4`/`video/webm` MIME | **实机判据不是「DOM 里有 video」而是 Chromium 真解出媒体**：`readyState=4`、`duration=0.5s`、`800×600`（面板读数同行显示），产物投影带 `/api/workspaces/:id/file?path=` 读面 URL 且服务端按 `video/mp4` 回；失败态不在场 | `frontend/src/components/workspace-panels/VideoResultViewer.test.tsx` + `viewerRegistry.p205.test.ts` + `test/next05-csp.test.mjs` + `acceptance/block-322-p2/block322-p2-05-video-preview-live-live.json`（10/10） |

### P3 · 几何与装配

| ID | 范围 | 验收 | 证据 |
| --- | --- | --- | --- |
| `P3-01` 几何操作 **completed（2026-10-30，实机 10/10 数值全等）** | 节点级 `modifiers`（bevel / array / boolean union-difference-intersect）+ 白名单参数校验（boolean 目标须为更早节点且非自身，≤8 条按序求值）；Blender 侧求值并烘焙进 mesh、刀体消费后移出导出；**预览端不重做几何**（客户端 CSG=第二几何执行器，撞红线 2），改为显式声明「预览显示未加工基元」 | **解析式数值回归**（基线 384000；bevel→370372 水密；difference→240000=384000−144000；union→456000=384000+216000−144000；array count3/offset140→1152000 与包围盒 X=400）+ 白名单/引用/哈希/diff 契约测 8/8 + 前端 10/10 + 实机腿 | `acceptance/block-322-p3/` |
| `P3-02a` 装配约束求值器 **completed（2026-10-30，契约 8/8 + 前端 12/12 + 实机 16/16）** | 约束白名单扩 `distance` / `angle`（`align` 存量保留），**求值落点裁决变更**：原表写「由 Blender constraint 求解」，实作为在唯一真值处 `resolveSceneSpec` 单遍求值并把结果烘进 `transform` 后交给 Blender——Blender 侧不引入约束求解器（否则=第二套求解语义，且同一场景两次构建结果依赖求解器版本）。语义：`align`=b 该轴分量等于 a 当前值；`distance`=a 该轴分量 + 带符号间距；`angle`=a 绕同轴姿态 + 相对角度。过约束显式 `constraint_conflict`（不猜优先级、不静默取后值）。新增只读 `POST /api/model3d/scene/resolve`（纯函数、无项目前置，对标 `scene/diff`）。**清偿存量缺陷：`align` 此前从未被任何执行面求值（写了不动）** | 解析式位置/姿态数值断言 + 链式传递与闭合环 + 冲突 fail-closed + 过约束场景不得写盘 + 白名单跨 JS/TS 逐值对账 + Python 侧出现 constraint 字样即红（第二求解器锁）+ 实机数值回归（包围盒由网格实测） | `test/block322-p3-constraints.test.mjs` + `frontend/src/lib/scene3d.test.ts` + `acceptance/block-322-p3/block322-p3-constraints-live-live.json`（16/16：align `[190,80,40]→[120,80,40]`、distance `→[150,80,40]`、angle `[200,80,40]→[120,200,40]`，均与解析解逐位相符；conflict/out_of_range 双 400；导出链同样拒过约束场景） |
| `P3-02b` 预览消费服务端求值结果 **completed（2026-10-30，前端 13/13 + 实机 9/9）** | 预览端经只读 `POST /api/model3d/scene/resolve` 取求值后的 `transform` 渲染（`normalizeScene3DForView(raw, {constraintsEvaluated:true})` 只关掉「未求值」告警，**前端零求解代码**）；求值失败/后端缺席时保持声明位置并把服务端原因原样显示；文案前缀由 `SCENE3D_CONSTRAINT_NOTE*` 常量单源（不再两处字面量） | 组件层：求值态不挂「未取回求值结果」告警且位置随投影变化；实机：**面板包围盒 X 由声明态 190 变求值态 120**（数字来自 Three 侧实测盒而非文案）+ 过约束场景回落 190 且面板可见 `constraint_conflict` 原因 + **写盘 SceneSpec 仍保留声明位置 `[100,0,0]`（求值是投影不是新真相）** | `frontend/src/lib/scene3d.test.ts` + `acceptance/block-322-p3/block322-p3-02b-preview-eval-live-live.json`（9/9）+ `…-detail.json` |
| `P3-03`（撞裁决点）`mate` 约束 | 面/边贴合需要**特征级引用**（哪个面、哪个边），SceneSpec v1 只有节点级 id + 向量，属数据模型变更 | — | **RULING-04** |

### P4 · CAD 交换与工程（含裁决点）

| ID | 范围 | 验收 | 依赖 |
| --- | --- | --- | --- |
| `P4-01` BOM 与质量属性 **completed（2026-10-31，定向 5/5 + 实机 BOM 全绿）** | SceneSpec 节点 → BOM CSV/MD/JSON + `bom-manifest.json`；体积取 Blender 网格报告（watertight 才生成），质量=volume×density；密度可经节点 `material.densityKgM3` 或 `metadata.defaultDensityKgM3` 声明（缺省 1000 kg/m³）；非水密拒绝 | 表格产物 + sha + manifest 登记 + 与网格报告体积一致；实机 392000mm³/405.6g、半写/缺件 fail-closed | `acceptance/block-322-p4/block322-p4-p6-live.json` |
| `P4-02` 公差字段 **completed（2026-10-31，后端/前端双层校验）** | `metadata.tolerances` 结构化（nodeId/feature/nominal/lower/upper/unit=mm，≤50 条）；未知节点/上下限倒置/非 mm fail-closed；BOM Markdown 增加「公差声明」表 | 校验 + 报告产出；前端镜像同判据 | `test/block322-p4-bom.test.mjs` + BOM 实机 |
| `P4-03` 三视图线稿 **completed（2026-10-31，真实 Blender Freestyle）** | `model3d_render` 增 `lineart` 输出请求：前/顶/侧 Freestyle 线稿 PNG + `lineart.labels` 视图标注；不声明即零额外渲染；**不是 GD&T 工程图** | 三张 PNG 哈希互不相同 + labels 在场 + 实机 | `acceptance/block-322-p4/block322-p4-p6-live.json` |
| `P4-04` STEP/IGES 导入导出 **in_progress（2026-10-31，P4-04a 已完成：STEP 导入/导出 + IGES 导入）** | `occt-wasm` STEP↔XCAF/GLB、Blender STL→OCCT faceted solid→STEP、`occt-import-js` IGES→STL；均走资产入链 sha/provenance；**IGES 导出、解析曲面 B-rep 未做**（需另一裁决） | 实机 18/18：STEP 头/2 个 MANIFOLD_SOLID_BREP/体积 392000；STEP→GLB 资产；IGES→STL 12 三角面；HLR SVG | `test/block322-p4-cad-exchange.test.mjs` + `acceptance/block-322-ruling01/block322-ruling01-cad-live.json` |
| `P4-05` 2D 工程图（标注/剖视） **in_progress（仅 HLR 多视图 SVG 基础验证）** | `occt-wasm` HLR 多视图 SVG 可从 STEP/IGES 生成；**尺寸链/GD&T 仍待特征级引用（RULING-04）**，本批不接工具/UI | HLR SVG 实机通过；真工程图未验收 | `acceptance/block-322-ruling01/` + RULING-04 |

### P5 · AI 生成资产

| ID | 范围 | 验收 | 依赖 |
| --- | --- | --- | --- |
| `P5-01` 生成资产入链管道 **completed（2026-10-31，定向 3/3 + 实机）** | 工作区 glb/gltf/stl/obj → `model3d/assets/<sha256>.<ext>` 单份字节；`model3d_asset` import 返回 mesh-reference 节点 + provenance（model/promptHash/parameters）；目标字节被篡改 → `asset_copy_hash_mismatch` 拒绝 | 篡改拒绝 + provenance 落盘 + 实机 | `test/block322-p5-assets.test.mjs` + 实机 |
| `P5-02` 真实生成服务接线 | 文/图生 3D | — | **RULING-02**（服务/成本/隐私） |

### P6 · 生产交付与协作

| ID | 范围 | 验收 | 依赖 |
| --- | --- | --- | --- |
| `P6-01` 导出矩阵扩展 **completed（2026-10-31，真实 Blender）** | 导出格式白名单扩 `fbx`/`usdz`；Blender 侧 `export_scene.fbx` + `wm.usd_export(selected_objects_only)`；输出进入 manifest/登记 | FBX 二进制头 + USDZ ZIP 头 + sha + 实机 | `test/block322-p6-share.test.mjs` + 实机 |
| `P6-02` 资产库 **completed（2026-10-31，定向 3/3 + 实机）** | `model3d/assets/index.json` 注册表 + `model3d_asset` list/get/import；列表按名称/路径/sha/model 检索，复用返回同一 sha 的 mesh-reference | 检索命中 + 引用同一 sha + 实机 | `test/block322-p5-assets.test.mjs` + 实机 |
| `P6-03` 版本对比增强 **completed（2026-10-31，纯函数 2/2 + UI 4/4）** | `compareGeometryReports` 消费真实 Blender 网格报告，输出对象/三角面/体积/bounds 差值；`POST /api/model3d/scene/compare-geometry` + 对比面板「几何差异」显示 Δ，不重算几何 | 纯函数 + 组件 + 实机（Δ bounds 30×0×0） | `test/block322-p6-geometry-compare.test.mjs` + `acceptance/block-322-p6/block322-p6-geometry-compare-live-live.json` |
| `P6-04` 分享包 **completed（2026-10-31，定向 2/2 + 实机）** | `model3d_share` 生成 `checksums.json` + zip（SceneSpec + manifest + 已登记产物）；打包前逐件校验存在性/工作区边界/manifest sha，缺件或哈希不符拒绝；不接云端 | zip PK 头 + bundle 校验和 + 缺件/篡改拒绝 | `test/block322-p6-share.test.mjs` + 实机 |
| `P6-05` 切片对接 | Orca/Cura CLI（**外部可执行，默认关 + capability 探测 + 缺失如实报**） | 探测三态 + 真实切片产物 | **RULING-03**（是否允许外部 CLI） |

### 裁决点（材料就绪即停，不自行选型）

- **RULING-01（P4-04/05 前置）**：STEP/IGES 与真工程图需要几何内核（OCCT / FreeCAD headless / Blender 插件），属重依赖 → 必须先过 DEPENDENCY-CHANGE-CHECKLIST 并由用户裁决；**材料已出（2026-10-31，用户「批准 批准 开整」）：[block-322-ruling-01-cad-kernel.md](./block-322-ruling-01-cad-kernel.md)**——推荐 `occt-wasm` 主内核 + `occt-import-js` 仅 IGES 导入；STEP 导出为 faceted B-rep（Blender 仍是唯一构建者），IGES 导出/真工程图/GD&T 如实留边界。
- **RULING-02（P5-02 前置）**：外部生成服务=成本 + 提示词/图片外发（隐私）→ 用户裁决。
- **RULING-03（P6-05 前置）**：调用外部切片 CLI（Orca/Cura）→ 用户裁决。
- **RULING-04（P3-03 前置，2026-10-30 P3-02a 执行中撞出）**：`mate`（面/边贴合）需要**特征级引用**——SceneSpec v1 的约束只能引用节点 id 与轴向，没有「哪个面/哪条边」的表达；补齐需要节点子结构 + 哈希语义 + diff + 预览拾取四处同改，属**数据模型变更**而非参数扩展 → 需用户裁决是否扩 v1（或另立 v2）。裁决前 `mate` 不实现、不假装支持：白名单里根本没有该 kind，写入即 `kind 只支持 align/distance/angle` 显式拒。

**推荐队列序**：`P2-01 → P2-02 → P2-03 → P2-04 → P2-05 → P3-01 → P3-02a → P3-02b → P4-01 → P4-02 → P4-03 → P5-01 → P6-01 → P6-02 → P6-03 → P6-04`（撞 RULING 即停取材料；RULING 解锁项插回队尾；P3-03=mate 待 RULING-04，不入队）。**理由**：先把「看得见的表现力」做完（P2 是用户对 3D 能力最直观的感知面），再做几何正确性（P3），再做生产交付（P4 无依赖项/P6），最后是需要外部条件的项。

**实际执行序（用户改序 2026-10-30「提交 P2-02 并开冲 P3」，覆盖上面的推荐序；§0 第 5 条允许阶段顺序因用户裁决调整）**：
`P2-01 ✅ → P2-02 ✅ → P3-01 ✅ → P3-02a ✅ → P3-02b ✅ → P2-03 ✅ → P2-04 ✅ → P2-05 ✅ → P4-01 ✅ → P4-02 ✅ → P4-03 ✅ → P5-01 ✅ → P6-01 ✅ → P6-02 ✅ → P6-03 ✅ → P6-04 ✅（2026-10-31，无裁决项队列收官）→ 余下=RULING-01 P4-04/05、RULING-02 P5-02、RULING-03 P6-05、RULING-04 P3-03`
即 P2 剩余三票（PBR 贴图 / 序列帧视频 / 结果面视频）后移到 P3 之后，**未取消、未出籍**。原 `P3-02` 在执行中拆为 a/b 两票（求值器落真值处 / 预览消费求值结果），并把 `mate` 单列为撞裁决点的 `P3-03`。

---

## §4 红线

1. 零第二 revision 真值（`artifact_revisions` 唯一；`.history/` 场景编辑线不动）。
2. 零第二执行器（Blender 仍是唯一构建/渲染/导出执行器；新增能力走工具/参数扩展）。
3. 外部资产必须 sha256 锚定 + 工作区内路径 + 大小上限；不接受任意 URL/脚本。
4. 预览不得伪造：渲染失败/能力缺失如实报 `capability_unavailable`。
5. 新增 npm/系统依赖（如 OCCT）必须先过依赖检查单并获得用户裁决。

## §5 依赖

- 本地 Blender（分平台事实，均为可选后端）：Windows=`Blender 4.5.10 LTS`（本批 P1 实机证据出于此，`capability: ready`）；macOS=`Blender 5.2.3 LTS`。跨平台收口需两侧各自取证，不得以一侧代另一侧。
- **渲染引擎实测（2026-10-30，win32 + Blender 4.5.10 LTS 无头）**：`CYCLES(CPU)` 640×480/16 采样 **0.61s** 可用；`BLENDER_EEVEE_NEXT` 无头走软件回退 **13.34s** 不可用；`BLENDER_WORKBENCH` 不吃场景灯（声明灯光对它无效）。故 P2-02 起：未声明灯光/环境仍用 Workbench（存量耗时不变），声明后自动切 Cycles CPU（`environment.engine/samples` 可覆写，采样上限 128）。
- 现有 SceneSpec/Blender/结果面/登记桥（RW-01）链路。
- **P2-04 前置实测（2026-10-31，win32 + Blender 4.5.10 LTS 无头，探针脚本在仓库外临时目录跑完即删）**：内置 ffmpeg **可用**——`render.ffmpeg.format` 枚举含 `MPEG4/MKV/WEBM/AVI/...`，`codec` 含 `H264/H265/AV1/FFV1/...`；8 帧 320×240 Workbench 动画渲染产出 `turntable0001-0008.mp4` **8554 bytes**，单次 `bpy.ops.render.render(animation=True)` 即可成片。三条跨版本 API 名漂移当场抓到（写产品代码必须按这些实名，别再照旧文档猜）：①`Scene.use_sequencer` 与 `Scene.editor_type` 在 4.5 **已不存在**（VSE 路线需改用 `scene.sequence_editor`，且新场景是否自带该编辑器未验证）→ 本票取**两次渲染**路线（先 `write_still` 逐帧出 PNG 序列，再 FFMPEG 动画跑出 mp4），不依赖 VSE；②`render.ffmpeg.constant_rate_mode` 已改名 **`constant_rate_factor`**（枚举 `NONE/LOSSLESS/PERC_LOSSLESS/HIGH/MEDIUM/LOW/VERYLOW/LOWEST`）；③动画产物的真实文件名由 Blender 拼出 `<前缀><start>-<end>.mp4`，**必须由目录发现得出路径**，不得在代码里猜文件名（猜错就是产物存在但登记不到）。
- **P2-04 执行中又抓一条（2026-10-31，实机腿首跑 V4-V8 五连红后改写路线）**：关键帧路线也不成立——4.5 里相机 `location`/`rotation_euler` 的 FCurve 插值枚举只有 `AUTO / EASE_IN / EASE_OUT / EASE_IN_OUT`，设 `LINEAR` 直接 `bpy_struct: enum "LINEAR" not found` 把整个 turntable 打挂，而 bezier 系会让转盘两头变速 ⇒ 最终用 **`frame_change_pre` handler 逐帧显式定角**（天然匀速，且不赌属性名/枚举）。跨版本 API 名与枚举漂移至此累计四条：布尔 `solver` vs `solver_mode`、`images.load` 无 `check_data`、`constant_rate_mode` → `constant_rate_factor`、关键帧插值无 `LINEAR`。**结论固化为纪律**：本纲凡新增 Blender 能力，先写一次性探针实测属性名/枚举/产物名，结论入 §5、探针跑完即删，再动产品代码——这不是可选步骤，四次教训都是实机腿才暴露的。
- **媒体加载实测（2026-10-31，win32 + Electron/Chromium，P2-05 实机腿抓真）**：`<video src="http://127.0.0.1:3001/...">` 这种**跨源**媒体加载会被 Chromium 直接拒绝——`MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`（页面在 :3000、产物读面在 :3001；`<img>` 与 fetch 不受这条限制，所以此前图片/模型预览从未暴露它）。同源（页面 origin）虽过安全检查，但 Vite dev 不代理 `/api` ⇒ 取回的是 SPA HTML，FFmpeg demuxer 照样打不开（`DEMUXER_ERROR_COULD_NOT_OPEN`）。**结论固化为形态**：媒体一律「fetch 取字节（connect-src 已放行）→ 自建 `blob:` 源 → 交给 `<video>`」，并补 CSP `media-src 'self' blob:`；这也顺带成为有界加载的执法点（超上限不读入内存）。未来音频等其他媒体面沿用同一形态。
- 可选外部服务（P5）需用户提供凭据与成本裁决。

## §6 验收与证据

- 每阶段：定向测试 + 专项门禁 + 实机 flow + `acceptance/block-322-p<n>/`。
- 收口走 `npm run closeout`（十三门）；阶段状态回写本文件 + AUDIT-LOG + UI 台账。

## §7 完成语义

- 本计划为**长线能力纲**：阶段按 P1→P6 串行，用户可随时改序/加阶段。
- 单阶段 `completed` 仅表示该阶段范围完成，不代表"全方位达成"；纲整体转 `reference` 需用户裁决。
