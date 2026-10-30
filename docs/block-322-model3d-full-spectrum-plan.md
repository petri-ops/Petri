---
capability: block-322-model3d-full-spectrum
goal: 把现有「参数化 SceneSpec + Blender 导出」工程链扩展为覆盖内容生成/叙事场景/真实生产的全方位 3D 能力（P1 外部资产一等公民 → P2 场景表现力/叙事 → P3 几何与装配 → P4 CAD 交换与工程 → P5 AI 生成资产 → P6 生产交付与协作）。
acceptance:
  - 阶段级验收 = 每阶段定向测试 + 专项门禁 + 实机 flow + acceptance/block-322-p<n>/ 证据；收口走 closeout 十三门。
  - 红线 = 零第二 revision 真值 / 零第二执行器（Blender 唯一）/ 外部资产 sha256 锚定 + 工作区路径 + 大小上限 / 能力缺失如实报。
status: active
---

# BLOCK-322 · 3D 全方位能力（不设能力上限）

**状态**：active（P0-LAUNCH，2026-10-30 立项）
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
- 外部网格：`mesh-reference` **仅 STL/OBJ**（工作区相对路径 + sha256 + ≤64MB），Blender 构建时导入。
- Blender 5.2.3 无头：构建 + 4 视角渲染（front/top/side/iso）+ 导出 GLB/STL/OBJ + manifest + 网格报告（顶点/三角面/非流形边/水密/体积）。
- Agent 工具：inspect / validate / propose / apply / render / visual_qa / export / recipe（5 类模板）。
- UI：3D 工作台（打开 SceneSpec / 导入 GLB/GLTF/STL/OBJ **只读预览** / 参数编辑 / 草图转需求 / 对比 / 测量 / 视角书签 / 截图 / 节点点选 / 视觉 QA）。
- 成果面：3D viewer + revision/change-set/lineage + selectionBus。

**缺口（按域）**
- A：GLB/GLTF 不能进 SceneSpec；UI 不能创建 `mesh-reference` 节点；无布尔/圆角/阵列/挤出；约束只有 align；无 STEP/IGES。
- B：无灯光/相机/贴图/动画/序列帧/视频；渲染固定 4 视角静帧；无 AI 生成资产。
- C：无 2D 工程图/BOM/公差/切片对接；质量属性仅网格报告。
- D：导出格式仅 GLB/STL/OBJ；无资产库/分享。

## §3 阶段划分

### P1 · 外部资产一等公民
- 范围：GLB/GLTF 进 `mesh-reference`（Blender `import_scene.gltf`）；预览渲染 `mesh-reference`（按工作区 URL 加载）；UI 添加外部资产（上传到工作区 → 计算 sha → add_node）；导出/登记链保持。
- 验收：单测（校验/扩展名契约）+ 实机（导入 GLB → 预览可见 → 导出成功 → revision 登记）。
- 证据：`acceptance/block-322-p1/`。
- **进度（2026-10-30）**：**P1a 已完成**——Blender 构建支持 GLB/GLTF（`import_scene.gltf`），契约测试 2/2；实机 REST 导出（SceneSpec 含 GLB `mesh-reference`）成功并登记，网格报告 `objects=2`（`base` + `asset:enclosure`，体积各 600000/528000 mm³）。**P1b（预览渲染 mesh-reference）/ P1c（UI 上传 + 添加节点）待续**。

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

## §4 红线

1. 零第二 revision 真值（`artifact_revisions` 唯一；`.history/` 场景编辑线不动）。
2. 零第二执行器（Blender 仍是唯一构建/渲染/导出执行器；新增能力走工具/参数扩展）。
3. 外部资产必须 sha256 锚定 + 工作区内路径 + 大小上限；不接受任意 URL/脚本。
4. 预览不得伪造：渲染失败/能力缺失如实报 `capability_unavailable`。
5. 新增 npm/系统依赖（如 OCCT）必须先过依赖检查单并获得用户裁决。

## §5 依赖

- 本地 Blender（已装 5.2.3 LTS，`capability: ready`）。
- 现有 SceneSpec/Blender/结果面/登记桥（RW-01）链路。
- 可选外部服务（P5）需用户提供凭据与成本裁决。

## §6 验收与证据

- 每阶段：定向测试 + 专项门禁 + 实机 flow + `acceptance/block-322-p<n>/`。
- 收口走 `npm run closeout`（十三门）；阶段状态回写本文件 + AUDIT-LOG + UI 台账。

## §7 完成语义

- 本计划为**长线能力纲**：阶段按 P1→P6 串行，用户可随时改序/加阶段。
- 单阶段 `completed` 仅表示该阶段范围完成，不代表"全方位达成"；纲整体转 `reference` 需用户裁决。
