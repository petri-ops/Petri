# P3 与创作包 P0–P2 联动评估（owner P3 开工令第 4 项）

> 核真方式：读既真源码 + 既有验收台账，不凭想象承诺能力。结论分「已打通」「介质边界」两类。

## §1 P0 图像生成 → SVG 编辑器：已打通（零新代码）

SVG 编辑器已有三条图片入画路径，P0 生成的 PNG 产物均可直接二次加工：

| 路径 | 实现 | 验收 |
|---|---|---|
| 嵌入本地图片 | `svgEditorImage.ts::validateEmbedFile` + `imageInsertOp`，PNG/JPEG/GIF/WebP ≤2MB，data: 内嵌随 SVG 走；工具栏「图片」按钮 + 拖图进画布 | UI-672，`svgEditorImage.test` 8/8 |
| 引用项目内图片 | `assetRefInsertOp` + `rewriteAssetHrefsForView`（真值存项目内相对路径、视图改写 URL，文件可替换不重嵌）；工具栏「引用」按钮 | UI-692，`svgEditorImage.test` 路径守卫六态、flow 72/72 |
| 生成产物落点 | P0 `generate.image` 产物入 workspace / Result Studio 生成文件面板（artifact-truth sha256 描述符），用户从上述两路径选文件即入画 | P0 `evidence/` 真实 PNG + `P0-LIVE-EVIDENCE.md` |

结论：P0 图 → SVG 二次加工**已可用**；P3 不重复造第三条入画通道。唯一操作门槛是 ≤2MB 内嵌上限（大图走引用模式，已有方案）。

## §2 P1 视频 → SVG 编辑器：介质边界（不支持，如实报）

SVG 是静态矢量格式，`content.video_url` / mp4 不能成为 SVG 元素；编辑器无视频元素白名单（`applyOpsToDom` / 后端 `svg_edit` 白名单均无 video）。
- 可行的只是**静帧**：取视频某一帧 PNG 按 §1 路径嵌入，得到静态图，不是可播放/可编辑视频。
- 不实现「SVG 内嵌视频」伪支持（foreignObject/script 已被视图脱敏剥离，白名单明确禁止）。

## §3 P2 3D → SVG 编辑器：介质边界（不支持，如实报）

3D 产物为 GLB / SceneSpec，由 3D 面板承载；SVG 无三维网格/材质表达。
- 可行的只是**快照静帧**：Model3DScene 已有 `onSnapshotApi`（UI-679，`toDataURL('image/png')`）可出 PNG，再按 §1 嵌入为静态图。
- 不把 3D 模型冒充可编辑 SVG 路径/图形。

## §4 收口口径

- P0：已打通（既有路径，零新增代码，P3 不重复）。
- P1/P2：介质不匹配，只有静帧可作为静态素材入 SVG；不支持视频/3D 本体的 SVG 二次编辑，不伪造支持。
- 边界登记在此，不新增 UI 入口、不改 artifact-truth 契约。
