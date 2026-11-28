# P3（SVG 设计工具）与 P0–P2 生成产物联动评估结论（item 78）

> 性质：独立核真后的结论文档，零产品代码改动。核真方式=逐条读真源码 + Git 提交史 + dev 实例数据，不凭既有材料的措辞转述。
> 对象：创作包 petri-pack-create 四级路线（`acceptance/petri-pack-create-blueprint/CREATE-PACK-BLUEPRINT.md` §3）——P0 图像生成（`generate.image`/Seedream）、P1 视频生成（`generate.video`/Seedance）、P2 3D 生成（`generate.model3d`）、P3 艺术设计工具集（SVG 编辑器深化：圆角矩形参数化 / 图层可见性 / 导出 SVG·PNG）。
> 既有材料：`acceptance/petri-pack-create/P3-INTEGRATION-ASSESSMENT.md`（P3 开工令第 4 项产出的联动评估）。本结论对其中每条可核声明逐条复核，并补充其未覆盖的反向联动与两处如实修正。

## §1 联动了什么（逐条核真，全部代码级在场）

| 联动 | 核真结果 | 证据（现读代码） |
|---|---|---|
| **P0 图 → SVG 入画（三路径）** | ✅ 已打通，P3 零新增代码（不重复造通道，符合开工令核码防重复结论） | ① 内嵌本地文件 `svgEditorImage.ts:19 validateEmbedFile`（PNG/JPEG/GIF/WebP ≤2MB data: 内嵌）+ `:62 imageInsertOp`；② 项目内引用 `:96 assetRefInsertOp`（真值存相对路径、视图改写）；③ P0 产物落点：`generate-tools.js` 产物归项目工作区 `generated/<kind>/`（item83 注释在场），`GeneratedFilesSurface` 面板可见，从上述两路径选文件即入画 |
| **SVG/3D 快照 → 会话附件（反向通道）** | ✅ 在场（既有材料未报的反向联动） | SVG 渲染回验 PNG 经 `SvgEditorViewer.tsx:509 dispatchPetriEvent(composerAttachImage)` 直入 SimpleChat 附件；3D 快照同通道 `Model3DSurface.tsx:670`；`SimpleChat.tsx:462` 消费。生成类工具统一签名带 `referenceArtifactId`（图生图/图生视频，`tool-defs/generate.js:27`） |
| **P3 导出复用渲染回验路径** | ✅ 在场 | `SvgEditorViewer.tsx:131 renderMarkupToPng` 为导出 PNG 与渲染回验共用函数；失败如实报错不出假产物（`:497`） |
| **P1 视频 / P2 3D → SVG 本体编辑** | ❌ **不联动（介质边界，如实）** | `core/petri-server/helpers/svg-ops.js` 与 `agent-tools/svg-tools.js` **零 video 引用**（grep 现读 0 命中）；SVG 白名单无视频元素，3D 为 GLB/SceneSpec 由 3D 面板承载。可行的只有静帧：视频取帧 PNG / 3D `Model3DScene.capture()` 快照（`:147 onSnapshotApi`），再走 §1 第一行路径入画 |

## §2 没联动的部分（如实，不包装）

1. **P3 三项新能力自身与生成面零功能联动**：`roundrect` 参数化（`svgEditorInspector.ts DRAW_TOOLS` + rx 短边一半钳制）、图层可见性（`layerVisibilityOps` → `set_style display` op）、导出 SVG/PNG 副本（浏览器下载）——三者均不读取 `generated/<kind>/` 产物、不向 artifact-truth 回写、不触发任何 `generate.*`。这是能力深化不是联动缺口，**但不应表述为「P3 与 P0-P2 联动交付」**——联动发生在「SVG 编辑器（含既有能力）」与生成产物之间，且全部为 P3 之前已有；P3 提交（e34a4ac3b）本身未新增任何联动代码。现有 `P3-INTEGRATION-ASSESSMENT.md` 的口径（「P0 图片可入、P1/P2 介质边界如实报」）是准确的，未夸大。

2. **导出 PNG → 图生图参考的联动断点（真实缺口）**：P3 导出的 PNG/SVG 是**浏览器下载副本**，不落 workspace、不产 artifact-truth 描述符，因此**不能**被 `generate.image` 的 `referenceArtifactId` 直接引用（该参数要求 artifact id，`generate-tools.js:55` 解析失败即报 `reference_artifact_unresolved`）。要走通「SVG 设计 → 图生图参考」需用户手动把文件放入项目工作区再由 agent 落盘登记——链路存在但每一环都是手动的，产品内无一键通路。

3. **静帧入画同样手动**：视频帧/3D 快照 → SVG 的静帧路径（§1 第四行）没有一键动作——3D 快照目前只入会话附件（composerAttachImage），不入画布；要入画需先手动保存到工作区再走引用模式。

4. **既有材料一处证据引用漂移（如实修正）**：`P3-INTEGRATION-ASSESSMENT.md` §1 第三行验收栏引用「P0 `evidence/` 真实 PNG + `P0-LIVE-EVIDENCE.md`」——**该文件全仓不存在**（`find` 零命中，`acceptance/petri-pack-create/` 目录下只有评估文本身）。P0 通路本身另有旁证（dev 实例多会话真实调用过 `generate.image`，产物落 `generated/generate-image/` 代码链在场），但被引用的证据文件应补落或改引用，避免空引用成为惯例。

## §3 建议（按投入产出排序，均属后续发令范畴，本报告不动手）

1. **接上「导出 → 图生图」断点（最高价值）**：导出 PNG 增加「存入项目工作区」选项（落 `generated/` 或用户指定目录并走既有 artifact-truth 登记），一步把 P3 产物接入 `referenceArtifactId` 图生图参考链——这是把「设计工具」和「生成工具」真正串成环的最小改动。
2. **3D/视频快照一键入画**：快照/静帧给「存入工作区」动作，复用建议 1 的落盘路径，消掉手动保存+拖入两步。
3. **修正证据引用**：`P3-INTEGRATION-ASSESSMENT.md` 补落 P0 实机证据文件或把验收栏改为现存旁证引用。

不建议做的：SVG 内嵌视频/3D 本体（foreignObject/script 已被白名单禁止，伪支持违背如实原则，维持现状正确）；为 P3 三项硬造与生成面的联动入口（无真实需求前不扩面）。

## §4 结论

- **已联动（真实、代码级在场）**：P0 生成图 → SVG 三路径入画；SVG/3D 快照 PNG → 会话附件反向通道；导出与渲染回验共用离屏渲染路径。
- **介质边界（如实）**：P1 视频、P2 3D 本体不可入 SVG 编辑，仅静帧。
- **未联动（如实）**：P3 三项新能力自身与 P0-P2 零联动；「设计产物 → 图生图参考」链路存在但全程手动，无产品内通路；静帧入画同样手动。
- **修正项**：既有评估引用的 `P0-LIVE-EVIDENCE.md` 不存在，属证据引用漂移。
- 一句话：**P0→SVG 的消费向联动是真实可用的；SVG→生成的生产向联动只有半截管道（附件通道在场、artifact 化断链）；P3 提交本身没有新增联动，也不应被描述为联动交付。**

status: analysis_complete（纯分析核真，零产品代码改动；建议 1–3 均属后续工作包范畴待发令）
