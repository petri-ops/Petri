---
capability: q6-annotation-host
goal: Q6（产物批注/学习闭环）垂直切片——核心提供通用 annotation host（旁路元数据、有界、可审计），在核心渲染的 PDF 页与图像产物上支持区域批注，并「加入任务」进 Agent 对话；批注绝不写回原始产物，不硬编码生信语义。
acceptance:
  - 批注只存旁路元数据（`result_annotations`）：来源 project/artifact/revision/file、页号、归一化坐标、作者、时间、评论；原始产物文件零写入。
  - 归一化坐标跨缩放可复现（PDF 按页 `[0,1]`、图像按自然尺寸 `[0,1]`）；越界/退化矩形被拒或钳制，服务端二次校验。
  - 批注读取/写入/删除有界（评论 ≤2000 字，超限拒绝而非静默截断；单 scope ≤200 条；坐标 4 数字），项目隔离 fail-closed。
  - 核心渲染面可批注：结果面 PDF/图像、工作区文件预览 PDF/图像；不支持格式（docx/pptx/xlsx/二进制）显示诚实原因，不伪造入口。
  - 「加入任务」经 `petri:copilot-ask` 单一通道进 composer，携带结构化批注引用（artifact 身份 + 页/坐标 + 评论），不新增第二投递路径。
  - 定向测试 + 9223 实机腿（工作区 PDF/图像批注 → 加入任务 → composer 出现引用）+ closeout 十三门 PASS。
reopen: 椭圆/箭头/画笔/文字/马赛克工具与撤销重做；文本选中批注与速记板合并（Q2 未做）；PPTX/DOCX/XLSX 批注；pack 渲染结果面（plot/table/report）经窄桥消费 annotation host；Agent 侧批注读取工具；批注合成图导出。
status: completed
---

# BLOCK-219 · Q6（垂直切片）：产物批注 host + 加入任务

> 用户裁决：2026-10-20「继续」= 承接 BLOCK-218 收口笔录「下一步 按批准顺序进入 Q6 产物批注/学习闭环」（Q5 → P2-UI → P2b → **Q6** → P3 → P4）。
> 前置：Q5 工作面 host（BLOCK-216）、P2-UI actions（BLOCK-217）、P2b resultSurface 垂直切片（BLOCK-218）已收口。
> 波次母纲：`docs/qoder-essence-absorption-plan.md` §6-Q6（C12/C13/E5 + H2 additive）。

## 0. P0 实码勘察（2026-10-20）

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| 批注能力存量 | `git grep -i annotat` 全仓只命中 MCP `annotations.readOnlyHint`（`agent-tools/mcp-projection.js:63`）与矩阵 `rows_genes_columns_annotations`；UI 台账/backlog 零「批注」条目 | **完全空白**，无第二套批注词汇可冲突 |
| viewer 能力位 | `viewerRegistry.ts:60-70` 九类 adapter 档案仅有 `canSelect/canCompare/canExport`；无 annotate 位 | 需新增能力位，取值由本包定义 |
| PDF 渲染 | `WorkspacePdfPreview.tsx`（87 行）逐页 `document.createElement('canvas')` 后 `container.appendChild(canvas)`（:55）；**无页容器、无页号 DOM、无缩放暴露**（scale 按 pane 宽度算 :45） | 批注坐标必须先把页变成可定位容器：每页包一层带 `data-page` 的盒子 |
| 图像渲染 | 结果面 `ResultArtifactShell.tsx:805-841` 纯 `<img>` + 灯箱；工作区 `WorkspaceFilePreview.tsx:335-341` 纯 `<img>` | 归一化覆盖层可零依赖实现 |
| Office 文档 | `WorkspaceFilePreview` 走 `OfficePreviewPane`（docx/pptx），不可用则 `BinaryPreviewCard`（系统应用打开） | 无文本层可锚定 → 本切片**诚实不支持**，不新增依赖（Q6 依赖门） |
| 持久化先例 | `result_selection_contexts`（`result-studio-schema.js:135-156`）+ 仓储 save/find/delete + 路由（`routes/result-studio/selection.js`）；DDL 单源、`001_result_studio.sql` 与之逐字节一致（`test/result-studio-migration.test.mjs:99`）；后续增量迁移各有生成器模块（`result-ref-transaction-schema.js` → `003_*.sql`） | 批注走**同形态**：独立 schema 生成器 + `015_*.sql` + 独立仓储/路由，不塞进 1752 行的 `result-studio-repository.js` |
| 「加入任务」通道 | `petri:copilot-ask`（`events.ts:69`）由 SimpleChat 消费注入 composer；结果面已有 `onAskAgent`，`ContinueAnalysisMenu` 已用同通道 | 复用**唯一**投递路径，不建第二事件 |
| pack 结果面 | `petri-pack-bio/pack.json` 的 `resultSurfaces.artifactTypes = plot/table/report`；命中后主 body 在 `petri-pack://` iframe 内（`PackSurfaceFrame.tsx:186-202`，CSP `connect-src 'none'`） | 核心覆盖层**够不到** pack iframe；本切片明确不含 pack 面批注（reopen 走桥） |
| 实机可行性 | dev DB `tool_jobs=0`（BLOCK-218 记录）；但工作区文件预览有 `projectId` + 真实文件 | live 腿改走**工作区 PDF/图像**，不依赖结果 job |

**P0 结论**：Q6 全量（六种图形工具 + 文本批注 + 速记板 + Office + pack 化）跨多轮；本轮按垂直切片交付「批注 host（旁路、有界）+ PDF/图像区域批注 + 加入任务」，核心保持通用（零生信语义），pack 面与其余形态如实 reopen。

## 1. 切片

### P1 — 旁路存储与契约（后端）

- 新 `core/shared-backend/result-annotation-schema.js`：`result_annotations` 表 + 两条索引；`buildAnnotationMigrationSql()` 生成 `src/migrations/015_result_annotations.sql`（逐字节一致，测试强制）；`ensureAnnotationSchema(db)` 幂等建表（测试/脚本用）。
- 新 `core/shared-backend/result-annotation-contracts.js`：`normalizeAnnotationInput()`（坐标钳制到 `[0,1]`、宽高下限、页号正整数、评论裁剪、颜色白名单、surface 枚举）、`summarizeAnnotationForAgent()`（有界投影）、常量（`MAX_COMMENT_CHARS=2000`、`MAX_ANNOTATIONS_PER_SCOPE=200`）。
- 新 `core/shared-backend/result-annotation-store.js`：`createResultAnnotationStore(db)` → `create/listByScope/countByScope/get/delete`，行映射与 JSON 编解码。
- 新 `core/petri-server/routes/result-studio/annotations.js`：`POST /api/result-studio/annotations`、`GET /api/result-studio/annotations`、`DELETE /api/result-studio/annotations/:annotationId`；项目存在性与 `canAccessProject` fail-closed；超限 409；校验失败 400 带 details。注册进 `routes/result-studio/index.js`。

### P2 — 前端数据层

- `frontend/src/lib/annotations.ts`：`ArtifactAnnotation` 类型、`normalizeAnnotationRect()`（拖拽反向后归一）、`clampNormalized()`、`isAnnotatableSurface()`、`buildAnnotationTaskPrompt()`（结构化引用：artifact 身份 / 页 / 坐标百分比 / 评论）、`MAX_*` 常量单一书写处。
- `frontend/src/lib/annotation-client.ts`：三端点 REST 客户端（沿用 `getApiPrefix/getToken` 惯例、错误归一）。
- `frontend/src/hooks/useArtifactAnnotations.ts`：按 scope 键控加载、乐观新增/删除、错误与超限诚实提示；scope 变化即重载。

### P3 — 查看器接线与加入任务

- `frontend/src/components/annotations/AnnotationOverlay.tsx`：在给定容器上拖拽画矩形（归一化）、渲染既有批注、点击选中；底色/描边走主题 token。`AnnotationBar.tsx`：批注计数、列表（评论/页/删除）、颜色三档、「加入任务」。
- `WorkspacePdfPreview`：每页增加 `<div data-page>` 容器 + `renderPageOverlay(page, size)` 可选 prop（缺省 `null` → 现有调用零行为变化）；canvas 仍渲染进页容器。
- `ResultArtifactShell`：`adapter==='image'` 分支包一层批注宿主（artifact/revision 身份来自既有 `viewedRevision`）；`adapter==='pdf'` 分支透传页覆盖层。
- `WorkspaceFilePreview`：图像与 PDF 两分支接同一宿主（scope=`workspace-file` + `projectId` + 相对路径）。
- `viewerRegistry` **不新增** `canAnnotate` 能力位（实施期修正）：可批注性由「渲染分支 + 是否有产物身份」直接决定——图像/PDF 两个分支挂宿主，其余分支给原因文案。理由是 BLOCK-151 已有「零消费声明位」债务先例，再加一个只声明不消费的位只会制造第二判断点；批注能力不是 viewer 固有属性（同一 adapter 无 revision 时同样不可批注）。
- 不支持格式与 pack 渲染面：条内或空态写明「当前面由领域包渲染/该格式暂不支持批注」，不放置无效入口（pack iframe 面本轮不注入核心条，避免在独立 origin 上伪造可用入口）。

### P4 — 验证与收口

- 后端：契约/仓储/路由边界（越界钳制、超限 409、跨项目 403、删除幂等 404）。
- 前端：纯函数（归一化/钳制/prompt）、overlay 拖拽、bar 列表与加入任务派发、PDF 页覆盖层挂载、shell 分支。
- 实机腿：9223 实例 + dev 项目写入 PNG（必要时手写最小 PDF）→ 批注 → 加入任务 → composer 出现结构化引用；截图 + 断言 JSON 落 `acceptance/block-219/`。
- canonical 回写（roadmap/handoff/backlog/AUDIT-LOG/UI 台账 UI-533/Q-MATRIX C12·E5 注记）+ `closeout` 十三门。

## 2. 非范围（明确 reopen）

- 椭圆/箭头/画笔/文字/马赛克工具、撤销重做（本切片只有矩形 + 删除）。
- 文本选中批注与速记板（C13）：Q2 未立项，**不建第二套速记**。
- PPTX/DOCX/XLSX 批注：无文本层锚定，沿用 `OfficePreviewPane` + 系统应用打开，不新增依赖。
- pack 渲染的结果面（生信 plot/table/report）：本轮核心覆盖层够不到独立 origin iframe；桥契约（`petri:annotation-*`）与 pack 侧实现为 reopen。
- Agent 侧批注读取工具 / 结果上下文 envelope 携带批注：本切片只做「加入任务」显式引用。
- 批注合成图导出、批注共享/协作、跨项目查询。

## 3. 验收与证据

| 项 | 判据 |
| --- | --- |
| 旁路 | 原始产物文件 SHA 前后一致；批注仅在 `result_annotations` |
| 坐标 | 同一批注在 50%/200% 缩放与重开后位置一致（归一化）；越界被钳制、退化矩形被拒 |
| 有界 | 评论 >2000 截断；单 scope >200 返回 409 且不落库 |
| 隔离 | 跨项目读/写/删 403；未知项目 404；未知批注 404 |
| 加入任务 | 走 `petri:copilot-ask`；prompt 含 artifact 身份、页号、坐标、评论；无第二事件 |
| 诚实降级 | 不支持格式/包渲染面显示原因，无死按钮 |
| 回归 | 结果面/工作区预览/PDF 预览邻域测试全绿；closeout 十三门 PASS |

## 4. 风险

- **PDF 页容器改造**：`WorkspacePdfPreview` 现为命令式 append；改 React 页容器必须保持「渲染进度/错误态/清理」语义不变，既有测试 `WorkspacePdfPreview.test.tsx` 2/2 作为拆前基线。
- **大文件体积**：`ResultArtifactShell.tsx`（1329 行）与 `WorkspaceFilePreview.tsx`（521 行）只做最小接线，新增行数进 code-size 台账重打，不借机重构。
- **坐标语义**：只存归一化值，不存像素；缩放/DPI 变化不影响复现，但旋转/裁切类 PDF 需在 reopen 处理。
- **pack 面断裂**：生信 pack 在位时 plot/table/report 由 pack 渲染，批注入口只出现在核心渲染面——必须在 UI 上如实标注，避免用户以为批注丢失。

## 5. 完成语义

completed 需：P1–P3 代码与测试、P4 证据、canonical 回写、closeout 十三门。**明确声明这是 Q6 垂直切片**：批注 host + 矩形批注 + 加入任务已落地；其余图形工具、文本/速记、Office、pack 面批注仍在 reopen。

## 6. 收口（2026-10-20）

**结论：BLOCK-219 Q6 垂直切片 completed（含 9223 实机腿 13/13）。**

### 6.1 交付

- **旁路存储**：新表 `result_annotations`（schema 生成器 + `src/migrations/015_result_annotations.sql` 逐字节一致 + 独立仓储/路由）；坐标归一化 0..1、页号、评论 ≤2000 字、单 scope ≤200 条、项目隔离 fail-closed；三个端点 `POST/GET/DELETE /api/result-studio/annotations`。
- **前端数据层**：`lib/annotations.ts`（归一化/百分比样式/prompt 唯一构造器）、`lib/annotation-client.ts`、`hooks/useArtifactAnnotations.ts`（快照 key 派生 loading/error，effect 内零同步 setState）。
- **批注宿主**：`components/annotations/`——覆盖层（拖拽 → 归一化矩形，按页过滤）、工具条（开关/三色/评论/列表删除/加入任务）、图像与 PDF 两个宿主；`WorkspacePdfPreview` 每页加 `data-page` 定位盒 + `renderPageOverlay`（portal 注入，缺省零行为变化）。
- **接线**：结果面图像/PDF（身份 `(artifactId, revisionId)`，缺 artifactId 即不可批注）、工作区文件预览图像/PDF（`projectId + 相对路径`）；表格/Office/二进制显示「该格式暂不支持批注」原因，不放置死入口。
- **加入任务**：`buildAnnotationTaskPrompt` 组装结构化引用（产物身份 + 页/百分比坐标 + 评论 + 「原始产物未被修改」），经 `petri:copilot-ask` 单一通道进对话。
- **体积纪律**：图像分支与身份推导外置到 `ResultArtifactShell/resultAnnotation.tsx`，shell 净减 8 行（1320 ≤ 1328 基线），code-size 台账重打。

### 6.2 验证

- 后端 `test/block219-result-annotations.test.mjs` **12/12**（迁移单源/禁用构造/幂等建表/坐标钳制/退化拒绝/路径安全/scope 隔离/上限 409/删除 404）。
- 前端 **42/42**：`annotations` 11 + `annotation-client` 7 + `AnnotationOverlay` 5 + `AnnotationBar` 6 + `AnnotatableImagePane` 2 + `resultAnnotation` 3 + `WorkspacePdfPreview` 3 + `WorkspaceFilePreview` 8（邻域）。
- `test:changed`：Node **744 项 0 红**（738 pass + 6 平台 skip）、前端 **30 文件全绿**。
- 实机（9223 离屏）：`block219-annotations-loop` **13/13 allPass**——SVG 预览拖拽 → 保存（REST `page=null`、`rect=[0.2,0.2,0.4,0.35]`）→ 加入任务 prompt 取证 → PDF 单页逐页覆盖层 → 批注落 `page=1` → SVG/PDF 哈希前后一致 → 清理还原。证据 `acceptance/block-219/`。
- `quality:types` 0、`quality:lint` 0 errors、theme-token-contract 17/17、`gate:code-size` PASS。

### 6.3 边界（明确 reopen）

- 六种图形工具（椭圆/箭头/画笔/文字/马赛克）与撤销重做未做：本轮只有矩形 + 删除。
- 文本选中批注与速记板（Q2 未立项）：不建第二套速记。
- PPTX/DOCX/XLSX 批注：无文本层锚定，沿用现有预览 + 系统应用打开，只给原因。
- 生信 pack 在位时 plot/table/report 由 `petri-pack://` iframe 渲染，核心覆盖层够不到；pack 侧批注需经窄桥契约（`petri:annotation-*`）另行提供，本轮不做。
- `viewerRegistry` 未新增 `canAnnotate` 能力位（实施期修正，见 §1 P3）：可批注性由渲染分支 + 产物身份决定。
- 「加入任务」沿用 copilotAsk 立即投递语义（与「继续分析」一致）；实机 flow 用页内探针拦截 payload，不触发真实模型轮次。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
