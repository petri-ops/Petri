---
capability: block-270-freehand-renderer
goal: BLOCK-264（C-43）尾项=批注画笔前端渲染器与绘制交互：契约 v2 的 freehand kind 在前端落地——KINDS 契约镜像、ArtifactAnnotation.path、client locator 三态（rect/anchor/path 互斥）、Overlay SVG polyline 渲染 + 画笔采点绘制、session beginPath 链、两 pane 接线；抽稀镜像后端（≤512 等距保留首尾）。
acceptance:
  - annotations.ts 契约镜像：AnnotationKind 含 'freehand'；ArtifactAnnotation.path 点序列；decimatePath 镜像后端抽稀语义（有界/保形/不拒绝）。
  - annotation-client createAnnotation 三态 locator：text-selection→anchor、freehand→path、其它→rect；freehand 不发 rect（契约互斥）。
  - AnnotationOverlay：freehand 批注 SVG polyline 渲染（归一化点→viewBox 0..100）；kind=freehand 绘制采点（down 开始/move 采点预览/up 提交抽稀 path，≥2 点才提交）。
  - session 链：beginPath(path, page) → 待填评论 → store.add({path, kind:'freehand'})；undo 重建保持定位互斥。
  - 两 pane（Image/Pdf）接线 onCommitPath；AnnotationBar 形状选项含画笔。
  - 测试=annotations 契约 + Overlay 渲染/采点 + client locator + session 分支；closeout 十三门 PASS；canonical 回写。
reopen: 压感/平滑贝塞尔（渲染保真进阶形态）；触屏掌压防误触（指针形态已统一 pointer events）。
status: completed
---

# BLOCK-270 · 批注画笔前端渲染器（C-43 尾项，批次 3/5）

用户发令：「行！ 你规划一下 按顺序批次完成」（2026-10-27）。上游=BLOCK-264 C-43（契约 v2：freehand/path 抽稀 512/三态互斥/迁移 020/store 往返——**后端已交付**，前端镜像缺位）。

## 1. 改动面

| 文件 | 内容 |
| --- | --- |
| `frontend/src/lib/annotations.ts` | kind 加 freehand + LABELS + `ArtifactAnnotation.path` + `CreateAnnotationInput.path` + `decimatePath`/`normalizeFreehandPath` 工具（镜像后端） |
| `frontend/src/lib/annotation-client.ts` | locator 三态：anchor / path / rect（freehand 不发 rect） |
| `frontend/src/hooks/useArtifactAnnotations.ts` | add 透传 path |
| `frontend/src/components/annotations/useAnnotationSession.ts` | PendingTarget 加 path 支；beginPath；submitComment/undo 分支 |
| `frontend/src/components/annotations/AnnotationOverlay.tsx` | freehand SVG polyline 图层 + 画笔采点绘制（draft 预览→提交抽稀） |
| `frontend/src/components/annotations/AnnotatableImagePane.tsx` / `AnnotatablePdfPane.tsx` | onCommitPath 接线 |
| `frontend/src/components/annotations/AnnotationBar.tsx` | 形状选项含画笔（KINDS 驱动）；提示语按 kind |

## 2. 阶段

P1 契约镜像红绿 → P2 session/client 链 → P3 Overlay 渲染与绘制 → P4 pane 接线 + 实机（组件级+既有实机批覆盖；UI 台账如实）→ P5 closeout。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 3. 收口记录（2026-10-27）

- 批注域组件级 **59/59** 全绿（Overlay 11/契约/client/Bar/session）；tsc 0；既有夹具随 path 必填字段同步（AnnotationBar/Overlay/annotations 三测试文件）。
- buildAnnotationTaskPrompt 参数按可选交叉收 path（freehand 报「画笔路径（N 个点）」不报假矩形）；KINDS 镜像断言六档→七档（C-43 契约 v2 同步）。
- 实机抓真一处：画笔采点 up 终点与末次 move 重合产生重复点——finish 相邻去重后 ≥2 点才提交。
- UI-587 in_progress（实机腿需结果面真实 job+artifact seed，随下次结果面板实机批补，reopen 已登记）。
