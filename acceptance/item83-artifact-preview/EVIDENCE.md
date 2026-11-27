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

## §4 owner 实机补充：generate.video 无卡且不能播（同批修复）

实机反馈：generate.video 成功但会话区只给文件路径、无结果卡片，视频也播不了。只读核真两因：
1. `generate.*` 是 agent 工具，活动无 `toolJobId`；`ToolActivityList` / `ConversationTimeline` 的产物卡挂载条件要求 `toolJobId && status==='success'`，所以卡片恒不出现。结果描述符完整躺在 `toolActivity.resultData`（含 `path/sha256/mime/source/url`）。
2. CSP `media-src 'self' blob:`（`src/main/csp-config.js:47`）拒跨源 media——注释记录 Chromium `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`；直连 `http://localhost:3001/api/generated/...` 不可播。既有可播方案是 `VideoResultViewer.tsx` 的 fetch 字节 → `blob:` URL。

修复（不重造）：
- `ChatArtifactCard.tsx` 导出 `generatedArtifactsFromResult(resultData)`，把单/数组描述符归一化为 `ChatArtifact[]`（只接受 `/api/generated/` 受控 URL）；组件新增可选 `artifacts` 直挂 prop，有直挂时跳过 `/tools/status` 拉取。
- 视频分支对生成产物 `fetch → arrayBuffer → URL.createObjectURL(Blob)`（64MB 上限、卸载时 revoke），`<video src>` 用 blob URL，下载出口保留原 API URL；读取失败不伪造可播。
- `ToolActivityList` / `ConversationTimeline` 对 `generate.*` 成功活动用直挂卡（非轻量摘要，视频直接可见），三处渲染分支均接线。
- HK-01 `ChatArtifactCard.generated-video.test.tsx` 红 3/3 → 绿 3/3（描述符归一化、blob src、无 toolJobId 活动挂载）；邻域 8 文件 63/63 绿；11 静态门绿。
- 文件面板视频播放属 item 85，等 83 交付后单独立令，本包未做。

## §5 结果卡片 UX 三点升级（owner 截图反馈，同批）

- **默认缩略**：图片默认 `maxHeight=360 / maxWidth=480`（在 320–400 建议区间），点击或「放大」进灯箱，按钮切「还原」退出；灯箱带 `data-testid="chat-artifact-lightbox"`。
- **自由缩放**：`+/-` 档位 `0.75/1/1.5/2`，按 `projectId + artifact.url/path` 记本次会话偏好（模块内 Map，上限 64 条、不落盘），切 tab/重挂载仍保留。
- **多结果编号**：图片组 >1 时显示 `1/3 2/3 3/3` tabs（仅当前一张渲染，不垂直堆长串），元信息行保持现状。
- HK-01 `ChatArtifactCard.ux.test.tsx` 红 3/3 → 绿 3/3；邻域 9 文件 66/66；静态门全绿。

## §6 核心验收：产物驱动自动出卡（owner 纠正后钉死）

owner 明确纠正：此前截图里的内嵌预览卡是手动要求 agent 现做的 HTML fragment，**不代表自动呈现已存在**。核心=生成工具成功返回时会话流自动出卡，零用户提示、零额外请求、回复无需特殊标记；截图卡的沙箱 iframe/复制图/导出/放大/元信息行只作设计参考。

核真与实现（非跳过开发）：
- 主会话渲染路径 `SimpleChatMessageRow.tsx:235` → `ConversationTimeline`；其 `generatedCards` 与 `ToolActivityList` 三处分支均从 `toolActivity.resultData` 读取 `generate.*` 成功活动的产物描述符自动挂卡。
- `generatedArtifactsFromResult` 只接受 `/api/generated/` 受控 URL 的 descriptor（单/数组），无 toolJobId 也能挂；失败活动 fail-closed 不出卡。
- 触发条件不含任何回复文本/marker：`name.startsWith('generate.') && status==='success' && resultData _descriptor`。
- HK-01 `ChatArtifactCard.auto-trigger.test.tsx` 3/3：generate.image 三候选数组自动出 1/3 tabs、generate.model3d 单描述符自动出 3D 卡、status=error 不出卡；邻域 6 文件 63/63。

## §7 打磨批：图片居中 + 常规操作工具条（owner 实机通过自动出卡后）

- **居中**：`<img>` 外包 `data-testid="chat-artifact-image-frame"`，`display:flex; justify-content:center; width:100%`。
- **工具条（image 分支）**：复制图片 / 另存为 / 打开所在文件夹 / 系统查看器打开。
  - 复制图片新增 `app:copy-image` 通道：`src/ipc/channels.js` → `src/preload.js` → `src/ipc/desktop-shell.js`；只收 `{kind,filename}`，用 `core/shared-backend/generated-artifact-path.js` 单源 fail-closed 校验（kind 白名单+扁平名+根内+真实文件），主进程 `nativeImage.createFromPath` → `clipboard.writeImage`。不传字节、不信渲染层裸路径。
  - 另存为复用 `files.downloadFromUrl`（本机来源 + 原生保存对话框）；打开所在文件夹与系统查看器打开复用 `files.openPath`（目录无扩展名校验、`.png` 在既有白名单）。
  - 前端单一调用面 `frontend/src/lib/generatedArtifactActions.ts`，bridge 缺失返回 `{ok:false}`，不伪造成功。
- **边界（owner 拍板）**：预览不做人工编辑（裁剪/标注/滤镜一律不做），只做查看+带出+复制；HK-01 断言无编辑入口。
- HK-01：前端 `ChatArtifactCard.toolbar.test.tsx` 4/4、节点 `test/clipboard-ipc.test.mjs` 扩展至 6/6；邻域前端 41/41、节点 18/18、`quality:arch` 绿（src→core/shared-backend 合法边）。

## §8 安全边界与待办

- HTML sandbox 为 opaque origin，不能凭同源凭据调后端——预期安全边界，非缺陷。
- 产物文件与元信息继续本地留存（dataDir/generated），会话预览不替代落盘；artifact-truth 契约未改。
- **待 owner 重启后端**加载新 route，并在 9223 会话区确认四类产物呈现/HTML 不逃逸沙箱；观感 `pending_human_eye` 零代签，台账 in_progress。
- 未引入重依赖、未改生成 provider、未碰 owner 未提交 WIP。
