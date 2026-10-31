---
capability: block-322-ruling-04-feature-reference-v2
goal: 在 P3-03 任意面/边贴合与 P4-05 真工程图（尺寸链/GD&T）开工前，确定「特征级引用」的数据模型形态、可行性证据、红线核对与分期，使特征身份既可求值又可回溯，且不产生第二场景真值或第二几何执行器。
acceptance:
  - 选型材料 = 实码限制清单（可定位到文件行）+ 内核能力实测（真 CAD B-rep 与分面件两侧数字）+ 候选形态对照表 + 需用户裁决的点（D1–D5）+ 分期与每票判据。
  - 本材料不启动实现；开工以用户 D1–D5 裁决为发令，落地票各自需契约测 + 实机腿 + UI 腿。
  - 红线 = 不造第二场景真值（特征表只能是以源 sha/dimensions 为版本键的派生缓存）；Blender 仍是唯一构建/渲染执行器（明确禁止用 occt-wasm 的建模 API 建几何）；特征不可识别时显式拒绝，不静默近似。
reopen: 用户改判特征形态（如接受内核求解装配）、OCCT 特征哈希被证跨会话不稳定、或决定放弃 GD&T 面（改走外部 CAD）
status: reference
---

# BLOCK-322 · RULING-04 特征级引用（feature-level reference）v2 裁决材料

日期：2026-10-31 · 关联：[BLOCK-322 3D 全方位能力纲](./block-322-model3d-full-spectrum-plan.md) §3.5 RULING-04、`P3-03`、`P4-05`
前置事实：`P3-03` 第一切片（轴对齐平面贴合）已收口（提交 `7e5503b8`，UI-651 verified）；本材料只回答「剩下的要不要做、怎么做、代价是什么」。

## 0. 一句话

要把 `mate` 从「轴对齐平面」扩展到任意面/边/旋转贴合，并让工程图带真尺寸链，必须先给 SceneSpec 一个**特征身份**（哪个面、哪条边）。本材料给出候选形态、本轮实测的可行性数字、红线核对和分期——**等你裁决后才动代码**。

## 1. v1 为什么走不到底（实码可定位）

| 限制 | 实码位置 | 后果 |
| --- | --- | --- |
| `mate` 的几何来自解析半长，只认 `box/cylinder/plane` 的 `dimensions` | `core/petri-server/helpers/scene3d.js:556-573` | `mesh-reference` 节点（导入件/AI 生成件）无 `dimensions`（`:316-321`）→ 导入件根本不能贴合，求值即 `mate_dimensions_missing` |
| 面选择器只有世界轴向 `±x/±y/±z` | `:37`、`:45-49` | 零件一转，「世界 +z 那个面」就不再是原来那个面 → 语义本身要求无旋转 |
| 校验层显式拒绝非零 `rotation` | `:445-448` | 端盖/法兰这类真实装配姿势（旋转 90°贴合）当前不可表达 |
| 求值只做「分量写入」，另两轴直接取 a 的世界坐标 | `:593-599`、`:539-554` | 没有局部系→世界系的合成，任意角度贴合没有数学落脚点 |
| 法向必须相反同轴 | `:452-454` | 面-面斜接、面-圆柱面相切（`radius` 参与）都不在词汇表内 |
| 公差里的 `feature` 是**自由文本**（≤80 字符） | `:473` | 它是标签不是引用：不可核验、不可在图上定位 → GD&T 无锚 |
| HLR 工程图 manifest 明确 `dimensions:false`、`gdt:false` | `core/petri-server/helpers/model3d-cad-drawing.js:78-82` | 现状如实：现在是线框图，不是工程图 |

**分面件里没有特征——本轮实测钉死**（探针见 §6）：同一几何（box 120×80×30 + cylinder r40 h25）

- 真 CAD B-rep 往返：**9 个面**（8 plane + 1 cylinder），体积 **413663.71 mm³**，与解析值 `288000 + π·40²·25 = 413663.71` 精确吻合；
- 走一遍分面（STL → B-rep）：**124 个面且全部 `plane`**，一个 80×30 的侧面被拆成多片（实测两片中心 `[0,53.33,10]`/`[0,26.67,20]`）。

⇒ **P4-04a 的 faceted STEP 导出物不可能承载特征级引用**（这是 RULING-01 已声明的边界的定量版）；能承载的只有**真 CAD B-rep 导入件**与**基元解析派生**。谁要把特征引用建在分面件上，就是在建沙上之塔。

## 2. 关键新事实：特征抽取零新依赖

`occt-wasm`（RULING-01 已批、已在锁文件、Mac 随锁文件跟随）内核实例实测暴露 **213 个方法**，我们目前只用了 6 个。与特征引用直接相关、且本轮已跑通的：

| 能力 | API | 本轮实测 |
| --- | --- | --- |
| 面类型识别 | `surfaceType(face)` | `plane/cylinder/cone/sphere/torus/bspline/…` 枚举齐；9 面样例正确分型 |
| 平面特征描述 | `getSurfaceCenterOfMass` + `surfaceNormal(face,u,v)` + `uvBounds` + `getSurfaceArea` | 中心/法向/面积全部取到（如 `[60,0,15]` 法向 `[0,-1,0]` 面积 3600） |
| 圆柱特征描述 | `getFaceCylinderData(face)` → `{radius,isDirect}` | 半径 ✅；轴向不直接给，但**两条独立路线实测可推**：`getInertia` 主轴（圆柱实体的惯量张量 z 分量独异：`100530964.91` vs `56810467.15`×2）/ 端面圆三点定面（`outerWire`→`getSubShapes(edge)`→`curveType=circle`→`curvePointAtParam`） |
| 面身份哈希 | `subShapeHashes(shape,'face',bound)` | 9 面返回 **9 个唯一哈希**（跨会话稳定性未验证，见 §7） |
| 工程图标注所需 | `projectPointOnFace`、`sectionPlane`、`offset`、`renderMultiviewSVG` + 包内 `font5x7` 文本字形 | 尺寸线/文字在 WASM 侧闭环的路径存在（未做实现腿） |

⇒ **抽取特征不需要任何新依赖，也不需要 500MB 级原生 CAD 运行时**（这与 P4-04b/RULING-01 的「IGES 导出、解析 B-rep STEP 需原生内核」是两个问题，别混）。

同时必须说清另一件事：这个包里还带着**一整套建模 API**（`makeBox/makeCylinder/makeCone/makeTorus/extrude/revolve/loft/sweep/fillet/chamfer/linearPattern/circularPattern/booleanOp/…`）。用它们建几何＝第二个几何执行器，直接撞红线 2。本材料**不提议**使用，并把「明文禁止」列为裁决点 D3。

## 3. 候选形态对照

| 候选 | 覆盖能力 | 数据模型改动 | 红线风险 | 体量 | 与 P4-05（GD&T）关系 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A 局部面/边选择器 + 变换复合**（解除旋转限制，纯 JSON 求值器内解） | 旋转后的 box/cylinder/plane 平面贴合、面-圆柱面相切 | 小：`aFace/bFace` 语义从世界轴改为局部轴 + 求值器加局→世合成 | 低（求解仍在唯一 `resolveSceneSpec`）；但欧拉序必须与 Blender 实测一致，否则两侧漂移＝事实上的第二真相 | 中（1 票） | 不够：仍没有可命名/可锚定的特征身份 | **作为 B 的子集落地**（基元的自动派生就是 A 的数学） |
| **B 特征表 `features[]` + 引用 `nodeId#featureId`** | 导入 CAD 件与基元的任意平面/圆柱/锥/球面贴合；公差与尺寸有锚 | 中-大：SceneSpec 加特征数组与引用语法；导入链要抽特征并 sha 锚定 | 中：特征表是派生物，必须以源 sha/dimensions 为版本键且不一致即 fail-closed，否则成第二真值 | 2–3 票（可切 v2a/v2b/v2c） | **是前置**：GD&T 必须有特征身份 | **主干推荐** |
| **C 内核求解装配**（OCCT ConstraintSolver / FreeCAD Assembly 接管 mate） | 最广（含过约束求解、运动副） | 契约面不变但真值搬家 | **高**：撞红线 1（装配真值落内核）+ 红线 2（第二执行器）+ 预览与求解分家（P3-02b 刚把「唯一求解处」收口） | 大 | 可顺带 | **拒绝** |
| **D 只给 GD&T 加特征名，不解 mate** | 工程图尺寸链；装配仍停在第一切片 | 小：`metadata.tolerances.feature` 从自由文本改为可解析引用 + HLR 侧投影定位 | 低 | 1 票 | 直接命中 P4-05 | **可作为 B 的第一可交付切片**（先出用户看得见的真图纸） |
| **E 维持现状**（把边界做成产品承诺） | 无扩展 | 无 | 无 | 0 | P4-05 永久停在 HLR 线框，P3-03 永久停在轴对齐 | 不推荐：3D 纲的「生产交付」面（图纸/装配）是 P4/P3 立项理由 |

**单一推荐：B 为主干；D 作为它的第一刀（先吃到「真工程图」的可见收益），A 是 B 中「基元自动派生」的数学子集，C 明确拒绝。**

## 4. 需要你裁决的点（不裁决＝不开工；每条给不裁的后果）

- **D1 特征表的真值地位**：推荐**派生缓存**——`features` 可以写进 SceneSpec，但版本键必须是该节点的 `sourceSha256`（导入件）或 `dimensions` 指纹（基元），派生表与源不一致即 fail-closed（沿用 `mesh_source_hash_required` 的执法口径 `scene3d.js:316-321`）。
  *不裁的后果*：实现者必须自行二选一，无论选哪个都会在收口时被认定为越权。
- **D2 引用语法**：推荐**新增 `aFeature`/`bFeature` 字段**（白名单加键），而不是把 `a`/`b` 改成 `nodeId#featureId` 字符串——旧场景零迁移、旧校验不破。但这是 SceneSpec 契约变更，会影响历史 revision 的 spec 文本、前端编辑器与工具 schema，需要知情同意。
  *不裁的后果*：v1 与 v2 两套语法共存＝第二真相（红线 1）。
- **D3 明文禁止 OCCT 建几何**：把「`occt-wasm` 只做只读分析（导入/特征抽取/HLR/导出），不得成为构建执行器」写进纲的红线清单（现 §4 第 2 条的具体化）。
  *不裁的后果*：这个能力就在手边，迟早被顺手用掉，且用掉之后没人会来补裁决。
- **D4 v2 覆盖范围**：先只解「**旋转 + 平面**」（v2a，真实高频：端盖/法兰），还是连**曲面/边**（v2c，需相切与接触代数、判据难写）一起承诺？推荐 v2a 先行，v2c 单列。
  *不裁的后果*：票被撑大成一整包，收口周期从「一票一晚」变「跨周」。
- **D5 GD&T 的验收等级**：推荐判据 =「标注文本 + 尺寸两端点的视图投影坐标 + 与解析尺寸数值一致（120/80/30/25/40 这类可代数的值）」，不做「像不像真图纸」的主观验收。
  *不裁的后果*：图纸类产物最容易在「看着挺对」上收口，事后无法证伪。

## 5. 批准后的开工序（每票独立可停）

1. **P4-05b（= 候选 D）特征锚定的尺寸标注第一刀**：`tolerances[].feature` 变可解析引用 + HLR SVG 上出尺寸线与文字。判据=契约测 + 实机 SVG 数值对账 + UI 腿。体量=1 票。
2. **P3-03 v2a**：求值器加局部系→世界系合成，`mate` 支持带旋转的平面贴合；前置探针=Blender 4.5 欧拉序实测（`resources/model3d/blender_scene.py:106-111` 直接设 `rotation_euler`、未设 `rotation_mode`，默认序必须**实测**确认，不能按文档猜——本纲已四次栽在 API/枚举漂移上，见纲 §5）。体量=1 票。
3. **P3-03 v2b**：`features[]` 数据模型 + 基元自动派生 + CAD 导入件入链时抽特征（平面/圆柱/锥/球；`bspline` 等一律如实标 `other` 并拒绝贴合）+ sidecar sha 锚定 + 前端约束编辑器。体量=2 票（后端/前端）。
4. **P3-03 v2c**：曲面/边贴合与相切约束（须 D4 明确承诺才排期）。
5. **不随本裁决**：P4-04b（IGES 导出 / 解析 B-rep STEP）仍是 RULING-01 的原生内核议题；P5-02（真实 Tripo key）你已裁决暂停；RULING-03（切片 CLI）本机实装的是 Orca agent CLI，不是 OrcaSlicer，条件不成立。

## 6. 实测记录（探针只用于选型，跑完即删，不入库）

- 内核方法枚举：`OcctKernel.init()` 实例方法 **213** 个（`getSubShapes/surfaceType/getFaceCylinderData/getInertia/subShapeHashes/sectionPlane/projectPointOnFace/…`，另有 `makeBox/extrude/revolve/fillet/booleanOp` 等建模族＝D3 禁止面）。
- 真 CAD 侧：`makeBox(120,80,30)` + `makeCylinder(40,25)` → `exportStep(AP214,mm)` **22803 bytes** → `importStep` → **9 面**，`surfaceType` 分布 `{plane:8, cylinder:1}`，`getVolume`=**413663.71 mm³**（与解析值逐位吻合），`subShapeHashes('face',4096)` 返回 **9 个唯一值**，`describe(圆柱面)`=`face [80.00 x 80.00 x 25.00] | F:1 E:3 V:2`。
- 圆柱轴向：`getInertia`= `[56810467.15,0,0, 0,56810467.15,0, 0,0,100530964.91]`（z 独异→轴向）；`outerWire`→3 条边（`circle`/`line`/`circle`），`curvePointAtParam` 在 0.1/0.5/0.9 取到三点，圆周长 **251.33**（=`2π·40`）。
- 分面侧：同一 compound `exportStl(deflection 0.5)` **6284 bytes** → `importStl` → **124 面全 `plane`**，`sew` 后 **2 个 shell**（对应两个独立实体，与 P4-04a 的多实体处理一致）。
- 复现位置：探针曾落 `.petri-dev-user-data/ruling04-*.mjs`（gitignore 区，本材料定稿即删）。

## 7. 未验证与风险（如实登记，不宣称已通过）

- **特征哈希跨会话稳定性未验**：`subShapeHashes` 是否受加载顺序/装配结构影响未知。若不稳，v2b 的特征 id 必须改用**几何签名**（`kind` + 量化后的中心/法向/半径/面积做 sha），而不是内核哈希——**这条必须在 v2b 第一张票的探针里定掉**，否则特征引用不可复现。
- **Blender 欧拉序未实测**：v2a 的局→世合成与 Blender 侧 `rotation_euler` 必须同源；按纲 §5 纪律，先探针后写产品代码。
- **大装配成本未量**：特征表条目数、sidecar 体积、导入耗时（面数上千的件）都只有单件小样本数据。
- **分面件不可抽特征＝用户可见边界**：导入 STL/我们的 faceted STEP 不能贴合，需要 UI 与工具文案如实说明，不能只回一个 `mate_dimensions_missing`。
- **macOS 未取证**：WASM 同代码路径，但按纪律 Windows 证据不得代证 Mac。
- **工程图标注 API 只到「存在」级**：`font5x7`/`projectPointOnFace` 未跑过真实标注腿，§2 的「路径存在」不等于「已验收」。

## 8. 产品自检（AGENTS.md「对标不改魂」）

差别形态：特征身份由**本地纯 JSON 求值器**消费、求解只有 `resolveSceneSpec` 一处（`scene3d.js:692`）、冲突与越界**显式报错不静默取值**（`:600-611`）、特征只能从 sha 锚定的源派生并落 provenance。云端 CAD 或黑盒约束求解器给不出「这颗零件为什么在这个位置」的可审计回答——这正是 Petri 本地主权 + 证据自证的差异化面，不是合规负担。

## 9. 本材料不承诺

不启动实现、不新增依赖、不改 SceneSpec 契约、不动 P5-02 与 RULING-03。开工以你对 D1–D5 的裁决为发令；只裁部分点，则只开对应票。
