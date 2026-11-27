# item 83 生成产物会话区富媒体呈现证据

## §1 核码防重复结论

会话区富媒体卡 `frontend/src/components/copilot/ChatArtifactCard.tsx:95` 已存在（BLOCK-322/509/UI-713）：图片缩略图+灯箱、`<video controls>` 内联、`Model3DScene` 懒加载 220px、下载与轻量/详情切换；挂载于 `ToolActivityList.tsx:774` / `ConversationTimeline.tsx:265`。所以本包**不重造卡片**，只补三处真缺口。

## §2 真缺口与修复

1. **读面缺口**：generate.* 产物落 `<dataDir>/generated/generate-{image,video,model3d}`（`generate-tools.js:54-56`），既不在 workspace 也不在 tool job dir，既有 `/api/workspaces/:pid/file` 与 `/api/tools/file/:jobId/:filename` 都取不到。
   - 新增 `core/petri-server/routes/generated-file.js`：`GET /api/generated/file/:kind/:filename`，kind 白名单 `image|video|model3d|html`；根 = `resolveDataDir()/generated/generate-<kind>`；扁平文件名 + `..`/绝对路径/盘符/子目录一律拒 + 根内校验 + 真实文件 + `Content-Type` + `Cache-Control: private, no-store`。导出 `buildGeneratedArtifactUrl` / `resolveGeneratedArtifactPath` 作单一真值。
   - `routes/index.js` 注册一行；`generate-tools.js` handler 给单/数组描述符补 `url`（保留 path/sha256/mime/source，落盘不变）；`ChatArtifactCard.fileUrl` 仅对 `/api/generated/` 优先于 workspace path，其余零回归。
2. **HTML 缺口**：新增 `HTML_EXTENSIONS` 与 `htmlArtifacts`，复用 `HtmlViewer`（`frontend/src/components/viewers/HtmlViewer.tsx`）渲染，`sandbox="allow-scripts"`、**不含 allow-same-origin**（opaque origin，与 `WorkspaceFilePreview.tsx:528` 同安全边界）；从 `otherArtifacts` 排除避免重复下载行。
3. **元信息缺口**：`ChatArtifact` 加选填 mime/source；detailOpen 显 provider / model / taskId / `toolActivity.durationMs`（两个挂载点透传）。**费用不展示**——generate.* 未调 `recordAiUsage`，`ai_usage.cost_cny` 无值，缺值直接省略、不写 0、不伪造。

## §3 HK-01 红绿与验证

- 新建 `frontend/src/components/copilot/ChatArtifactCard.generate.test.tsx`：五条断言（图/视频/3D/HTML 四类渲染 + HTML sandbox 严格等于 `allow-scripts` 且不含 `allow-same-origin` + 元信息且无费用伪造）。红 3/5 → 绿 5/5。
- 新建 `test/generated-file-route.test.mjs`：URL 单一真值 + 合法路径 + 越界负测（`../`、绝对路径、盘符、子目录、空名、未知 kind）。红（模块缺失）→ 绿 3/3。
- 邻域回归：`ChatArtifactCard*.test.tsx` + `HtmlViewer.test.tsx` + `theme-token-contract.test.ts` 共 25/25 绿。
- 门禁：docs/ui-audit/secret/arch/lint/types/knip/code-size/css-modules/arch-cycles/tracked-consistency 全绿；code-size 仅指纹漂移已 `--write` 随提交。

## §4 安全边界与待办

- HTML sandbox 为 opaque origin，不能凭同源凭据调后端——预期安全边界，非缺陷。
- 产物文件与元信息继续本地留存（dataDir/generated），会话预览不替代落盘；artifact-truth 契约未改。
- **待 owner 重启后端**加载新 route，并在 9223 会话区确认四类产物呈现/HTML 不逃逸沙箱；观感 `pending_human_eye` 零代签，台账 in_progress。
- 未引入重依赖、未改生成 provider、未碰 owner 未提交 WIP。
