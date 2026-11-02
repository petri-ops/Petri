---
capability: block-334-result-host-unification
status: active
goal: 结果查看统一到右栏宿主（与文件预览 / 3D 工作面同栏同形态），中央栏永远是会话；退役中央 result/code/compare/history 四态接管与右栏「结果」Inspector 残骸；随后把两宿主各自一套的文件类型渲染合并为 viewerRegistry 单一分派。
acceptance:
  - P1 宿主迁移：聊天产物卡 / 任务列表 / `?job=` 深链打开结果 → 右栏「结果」tab 承载完整 ResultArtifactShell（四态为宿主局部子状态），中央仍是会话；结果 tab 激活且有 job 时右栏切 `resultRightWidth`（默认 720，可拖、独立持久化；不触碰左栏），离开恢复；`ResultStudioInspector` 退役；`WorkspaceMode` 收敛为 `'chat' | 'scheduled'`，旧 `/project/:id/result|code|compare|history` 深链 fail-closed 落 chat 且 `?job=` 仍打开右栏结果。证据=tsc 0 + 定向 vitest 全绿 + `acceptance/block-334/result-host-live.json`（实机断言 allPass）+ UI-657 verified。
  - P2 渲染层统一：`viewerRegistry.resolveResultViewer` 成为 `WorkspaceFilePreview` 与 `ResultArtifactShell` 的唯一类型分派源；markdown / table / text / image / html / spreadsheet 六类各只剩一个 viewer 组件，批注与选择身份经 scope 参数化；PDF / 3D / video 只改引用。证据=各 viewer 单测 + 两宿主行为测试 + `theme-token-contract` + `gate:code-size`。
reopen: 实机走查若证明 720–900px 右栏对大报告 / 宽表 / 并排比较不可用，重开条件=用户裁决是否增设显式「放大到中央」兜底（本包按用户倾向不保留第二套模型）。
---

# BLOCK-334 — 结果宿主统一（右栏承载 · 中央四态退役 · 渲染层合并）

状态：**active（2026-11-02 立项；P1 宿主迁移当日收口 COMPLETED，UI-657 verified；P2 渲染层统一 2026-11-02 加映启动，用户「继续之前的工作」）**
truthDomain：`block-334-result-host-unification`
canonical 入口：本文件
关联：`docs/ui-productization-audit.md` UI-657（本包 UI 行）；历史裁决 UI-106（G0-RS-P1 中央大画布）/ UI-116 / UI-181 / UI-653（本包推翻或吸收，行不改写，关系在 UI-657 注明）

## 0. 裁决来源与立项自检

用户 2026-11-02 三段原话：

1. 「目前我们有结果查看面板 我在想这个是否有必要呢？毕竟我们有文件预览 也有 3D 模型 结果展示页面」
2. 「右侧栏还有个结果 也是重复的吧 中间栏结果面板不是很合适,使用上不丝滑.」
3. 「把这个怎么做说的明白点 并且立包,下面开干」

评估结论（已向用户陈述并获发令）：结果面板**本体不可砍**——任务产物落在全局 `jobs/<jobId>/output/`，不在项目工作区，文件树看不到；真值 / 血缘 / 受控改写 / pack 结果面契约别处没有。但**宿主形态错了**：中央接管是 G0-RS-P1（UI-106）从右栏窄栏迁出的决定，前提（右栏 360px、无多 tab 栈）已不成立——右栏「文件」tab 今天已是 UI-451 的多 tab 常驻预览栈，3D 工作面也在右栏；此后围绕"中央是模态的"连续出了 P4R-2 / UI-116 / UI-181 / UI-653 四笔修补，就是用户说的"不丝滑"。右栏「结果」tab 是旧宿主残骸：只剩 `ResultStudioInspector` + 高级抽屉，内容与中央 ContextBar 八成重合，且在结果模式下被 UI-116 收起、回会话才露出"上一个结果的残影"。

**立项自检问句**（形态与 ZCode/Codex 的差别）：借的形=编辑器式右栏 tab 宿主、会话常驻不切模式；自己的形=结果 tab 不是文件预览的别名——它锚在 job/revision 上，带真值徽章、血缘、受控改写 Composer、pack 结果面接管，全部随迁不减。本地可审计 / 证据自证在迁移后更可见：结果与会话同屏，批注与「继续分析」的回路不再隔着一次模式切换。

## 1. 现状（代码事实，立项时核对）

| 面 | 挂载 | 锚点 | 关键文件 |
| --- | --- | --- | --- |
| 中央结果接管 | `CenterPanel` 在 `workspaceMode ∈ {result,code,compare,history}` 时渲染 `ResultStudioCanvas` → pack `PackSurfaceFrame` / 核心 `ResultView→ResultArtifactShell` / 无 job `ResultsLibrary` | ToolJob → manifest → artifact → revision | `CenterPanel.tsx:176-449`、`ResultArtifactShell.tsx`（1323 行，四态在壳内按 `mode` prop 分支）、`useWorkspaceRouting.ts` |
| 右栏「结果」 | `RightPanel.tsx:241-269` 只渲染 `ResultStudioInspector` + `ResultEditAdvancedDrawer` | 同上（镜像 activeArtifact） | `ResultStudioSurface.tsx:195-284` |
| 右栏「文件」 | `RightFileTree` 多 tab keep-alive 栈，每文件一个 `WorkspaceFilePreview` | 工作区相对路径 | `RightFileTree.tsx:860-920`、`WorkspaceFilePreview.tsx` |
| 右栏「3D 模型」 | `Model3DSurface` 工作面 | scenePath / meshPath | `work-surface/Model3D*.tsx` |

结果壳对外只依赖两个回调回写中央模式：`onBack`、`onModeChange(mode, jobId)`；导航器、血缘切换、变更集面板、修订代码视图、钉住分屏都在壳内。`handleOpenResult`（`project-workspace.tsx:767-855`）每条路径已经 `setRightOpen(true) + openRightPanel('results')`，之后才按 `preserveWorkspaceMode` 决定要不要 `updateWorkspaceMode('result')`。`useResizableColumns` 仍保留 `resultRightWidth: 720` 偏好位（旧右栏结果态宽度遗迹，当前零消费）。

四态消费面（非测试）：`project-workspace.tsx` 11 处、`ResultStudioChangeSetPanel` 7、`useWorkspaceTitleBar` 6、`CenterPanel` 4、`ResultStudioSurface` 4、`useWorkspaceOpenEffects` 2、`packTabData` 2、`result-title-bar` / `useWorkspaceRouting` / `RightPanel` / `resultFocusLayout` 各 1。`ReviewMode.tsx` 的 `'history'` 是其自有 `historyView`，不同源，不动。

## 2. 设计裁决

- **D1 四态降为宿主局部子状态，不进 URL。** `ResultSurfaceMode`（result/code/compare/history）由 `ResultsSurface` 用 `useState` 持有，job 切换重置为 `result`。URL 只承载 `?job=&artifact=`，且改为跟"右栏结果是否打开"同步（`bindActiveJob` 写、清空删），与中央模式彻底脱钩。路径段 `/project/:id/<mode>` 只剩 `scheduled`。
- **D2 右栏加宽走独立偏好。** 结果 tab 激活且有 activeJob → 右栏生效宽度取 `resultRightWidth`（默认 720），拖动时改写 `resultRightWidth`（`startColumnResize('resultRight')` 既有目标）而不是文件/3D 共用的 `rightWidth`；离开结果 tab 或 job 清空 → 回 `rightWidth`。**不触碰左栏**：实施时核出 UI-116 的自动收栏早已被 UI-341 加映二（2026-09-11「侧栏只由用户主动点击改变」）退役、UI-479 又明确"路由模式不触碰侧栏"，本包不反转该裁决。
- **D3 Inspector 退役而非保留。** 它独有的两项（来源工具、技术详情）折进 `CompactResultNavigator` 的次级动作区作「技术详情」折叠；`ResultEditAdvancedDrawer` 收入 `ResultsSurface` 底部折叠区，默认关闭语义不变（UI-109）。
- **D4 不保留中央「放大」兜底。** 用户倾向 + 避免两套模型；重开条件见 frontmatter。
- **D5 旧四态深链 fail-closed 落 chat。** 与 UI-347/364/365 退役 `search/plugins/settings` 同口径：从 `WORKSPACE_MODES` 移除即可，`parseWorkspaceMode` 返回 null → `'chat'`；`?job=` 由 `useWorkspaceOpenEffects` 既有逻辑打开右栏结果。`handleOpenResult` 跨项目 `navigate` 去掉 `mode=`。
- **D6 P2 以 `viewerRegistry` 为唯一分派源。** 文件宿主调用 `resolveResultViewer({ kind: 'file', fileName, preview: true })` 取 adapter；viewer 组件接 `scope`（`workspace-file` | `artifact-revision`）决定批注身份与选择总线行为。
- **D7 判定=重构不是补丁。** 四态相关改动若再打一层 `preserveWorkspaceMode` 式开关，就是 governance 所述"条件叠条件"的第五层；本包把宿主整体搬迁，行为基线=迁移前定向测试绿 → 迁移后同组测试（含迁址后的用例）绿。

## 3. P1 宿主迁移 — 文件级改动

### 3.1 新建 `frontend/src/components/work-surface/ResultsSurface.tsx`

右栏「结果」tab 的唯一宿主。吸收 `CenterPanel.tsx:176-312` 与 `:356-449` 的全部结果逻辑，职责：

1. 子态：`const [mode, setMode] = useState<ResultSurfaceMode>('result')`；`activeJob?.id` 变化时重置。
2. pack 解析簇原样平移：`resolveResultSurfaceHost` / `usePackTabData` / `shouldDowngradeToCore` / `usePackResultData` / 身份水化 effect（`hydratedArtifactIdentities` 两张模块级 Map 随迁）。为过 code-size，把这一簇抽成同目录 hook `useResultSurfaceHost.ts`。
3. 渲染：`activeJob` 有 → pack 描述符且未降级时 `PackSurfaceFrame`，否则 `ResultArtifactShell`（`onBack` 不再传；`onModeChange` 接 `setMode`）；无 job → `ResultsLibrary`。
4. `ResultAgentComposer` 固定在面板底部（`mode==='result' && activeArtifact`）；`ResultEditAdvancedDrawer` 作底部折叠区。
5. `ResultStudioContextBar` 只在 pack 路径或 `mode!=='result'` 时渲染（沿用 CenterPanel 现行条件），`onBack` 改为 `setMode('result')`。
6. 透传 `active`（右栏当前 tab 是否为 results）给壳 → `Model3DResultViewer` 沿用 block-322 P3 的 WebGL `active` 门控，与同栏「3D 模型」tab 不互踢上下文。
7. `askAboutCurrentResult` / `onRevisionAgentRequest` 两个回调随迁；前者不再 `updateWorkspaceMode('chat')`（中央本来就是会话）。

### 3.2 `RightPanel.tsx` + `RightPanelContext`

- `tab==='results'` → `<ResultsSurface ctx=… active={ctx.rightTab==='results'} />`；删除 `ResultStudioInspector` 与 `ResultEditAdvancedDrawer` 两段直渲染。
- `RightPanelContext` 新增（从 `CenterPanelContext` 平移）：`conversationId`（=activeConvId 已有）、`allProjects`、`jobs`（已有？核对）、`packResultSurfaces`、`resultAgentDraft` / `setResultAgentDraft`、`resultEditSubmitting`（已有）、`onResultEditSubmit` 返回类型对齐、`handleAskAgent(prompt, options)` 支持 `compose/analysisMode`、`openResultBrowser`、`openRevisionWorkspaceFile`、`onAgentCodeRequest` 由宿主内部构造（需 `resultContext.contextToken`，已有）。
- `ResultStudioSurface.tsx`：删除 `ResultStudioInspector` 导出与 `ResultInspectorArtifact` 类型（若仅它消费）；`ResultStudioContextReadiness` 若仅 Inspector 用则一并删。相关测试迁 `ResultsSurface.test.tsx`。

### 3.3 `CenterPanel.tsx`

删除 `resultMode` 判定、pack 解析、身份水化、`ResultStudioCanvas` 投影层及其全部 import（预计 618 → ~330 行）。`CenterPanelContext` 去掉结果专属字段（`activeArtifact` 等仍可能被摘要卡用，逐项核对再删）。`SessionFrameView` 不动。

### 3.4 `useWorkspaceRouting.ts`

`WorkspaceMode = 'chat' | 'scheduled'`；集合移除四态；文件头注释补 UI-657 退役记录（与 search/plugins/settings 同段）。

### 3.5 `project-workspace.tsx`

- `updateWorkspaceMode`：删 `isResultWorkspaceMode` 分支与 result 性能标记；`nextCarriesJob` 只认 `scheduled`。
- 新增 `syncResultQuery(jobId | null, artifactName?)`：右栏结果打开/切换/清空时同步 `?job=&artifact=`（`replace: true`），不碰路径段。`bindActiveJob` 调用处接入。
- `handleOpenResult`：删 `options` 参数（`preserveWorkspaceMode` / `workspaceMode`）与三处 `updateWorkspaceMode('result'|'chat')`；跨项目 `navigate` 为 `/project/<id>?job=…`；找不到 job 时只提示不切模式。
- 结果焦点联动：`resultsFocus = rightOpen && rightTab==='results' && activeJobId` 派生值；`effectiveRightWidth = resultsFocus ? resultRightWidth : rightWidth`；`RightPanel` 的 `onResize` 在焦点态走 `startColumnResize('resultRight')`。不动左栏。
- `centerPanelCtx` 去结果字段；`rightPanelCtx` 补 §3.2 字段。

### 3.6 外围消费点

- `useWorkspaceOpenEffects.ts`：`projectOpenArtifact` 去 `switchToResult` 判断（统一右栏打开）；跨项目 navigate 去 `mode=`。`ChatArtifactCard.tsx` 保留「在结果中查看」，不再传 `switchToResult`。
- `useWorkspaceTitleBar.ts` / `lib/result-title-bar.ts`：标题不再按工作区模式拼「· 结果/代码/…」；结果 tab 激活且有 artifact → `${artifact} · ${project}`，否则 `${project}`。对应测试改写。
- `lib/workSurface/packTabData.ts`、`result-studio/resultFocusLayout.ts`、`ResultStudioChangeSetPanel.tsx`、`ResultStudioSurface.tsx`：mode 类型改引 `ResultSurfaceMode`；`resultFocusLayout.ts` 若仅剩 `isResultWorkspaceMode` 则整文件删除（含测试）。
- `home.tsx` 自动导航与 `welcome.tsx` 深链若带 `mode=`，一并去掉。

### 3.7 测试面

- 迁址：`CenterPanel.test.tsx` 的 result 用例 → `ResultsSurface.test.tsx`；`RightPanel.test.tsx` 加结果 tab 渲染/Composer/AdvancedDrawer 用例；`copilotAskDelivery.test.tsx` 保持（会话常驻不变）。
- 路由：`project-workspace` 路由测试加"`/project/:id/result?job=x` → mode chat + 右栏 results 打开 + activeJob=x"；`useWorkspaceRouting` 测试四态返回 null。
- 标题栏：`result-title-bar.test.ts` / `useWorkspaceTitleBar` 用例改写。
- 宽度联动：`useResizableColumns` 或 project-workspace 层单测断言结果焦点态取 `resultRightWidth`、拖动写回该偏好。

### 3.8 实机断言（`scripts/block334-result-host-live.cjs` → `acceptance/block-334/result-host-live.json`）

1. 聊天 3D/图表产物卡「在结果中查看」→ 右栏 results tab 可见、中央 `data-projection="conversation"` 仍 active。
2. 右栏实测宽 ≥ 720（左栏不动，UI-341 加映二）。
3. 切 code / compare / history 子态，壳内容切换，URL 路径段不变。
4. 结果内批注「加入上下文」→ composer 草稿出现（送达链不丢）。
5. 切到「文件」tab → 右栏宽回 `rightWidth`。
6. 直接访问 `/project/<id>/result?job=<id>` → 落 `/project/<id>?job=<id>`，右栏结果打开。
7. 结果 tab 内 3D 产物 ↔ 「3D 模型」tab 来回 3 轮，Electron 日志 WebGL 上下文告警 0 条（复跑 block-322 P3 同型断言）。
8. 亮 / 暗主题截图；1024 与 820px 窄窗无横向溢出。

## 4. P2 渲染层统一 — 文件级改动

1. **分派源唯一**：`WorkspaceFilePreview` 删 `fallbackKind` 八分支判定，改 `resolveResultViewer({ kind: 'file', fileName: file.name, preview: true }).adapter`；`viewerRegistry` 的 `office` 判定补齐（docx/pptx/odt/odp 走既有 `office-file-preview`，xlsx 与 `spreadsheet` adapter 二选一，见第 3 条）。
2. **共享 viewer 目录** `frontend/src/components/viewers/`：`MarkdownViewer`（合并 `MarkdownResultViewer` 与文件预览 ReactMarkdown 分支；TOC / 相对链接跳转 / 编辑切换以 props 开关，结果侧只读）、`TableViewer`（合并壳内联 csv 分页表与文件预览 40 行表，统一 `csv-preview-pagination`）、`TextViewer`（结果侧 `<pre>` 退役，统一走 CodeMirror readonly 得高亮；文件侧可写）、`ImageViewer`（`ResultImagePreview` 与 `AnnotatableImagePane` 合并，scope 参数化）、`HtmlViewer`（iframe + `withReportTheme`，sandbox 属性按宿主）、`SpreadsheetViewer`。PDF（已共用 `WorkspacePdfPreview`）/ 3D（已共用 `Model3DScene`）/ video 只改引用路径。
3. **xlsx 二选一**：`SpreadsheetResultViewer`（exceljs 直读）与 `OfficePreviewPane`（`office-file-preview`）保留一条；若因此有依赖可删，按 `DEPENDENCY-CHANGE-CHECKLIST` 做减法登记，不新增。
4. **scope 参数化**：viewer 接 `annotation: { scope: AnnotationScope | null; target: AnnotationTaskTarget }` 与 `selection: 'bus' | 'quote' | 'none'`，两宿主行为一致；`useArtifactTextSelection` 与 `usePreviewSelection` 收敛为一个带 source 的 hook。
5. 测试：每个 viewer 单测 + 两宿主行为测试（同一 md/csv/png 在两宿主渲染出同一 viewer）+ `theme-token-contract.test.ts`（CSS 迁移）+ `gate:code-size`。

## 5. 非范围

- 不改后端 manifest / artifact truth / revision / interaction 契约；不改 `jobs/<id>/output/` 落盘位置。
- 不引入任何新依赖。
- 不重设计 compare 分屏：`ArtifactPinPane` 原样随迁，窄宽度下由既有 CSS 纵排。
- 不动 `scheduled` 模式、3D 工作面本体、`GeneratedFilesSurface`、`RightFileTree` 的 tab 栈机制（P2 只复用其 viewer，不合并栈）。
- 不做结果独立窗（UI-385 已退役）。
- 不处理 G1+ 事项。

## 6. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 720px 内大报告 iframe / 宽表 / 并排比较体验下降（UI-106 当年的痛点） | 右栏可拖且 `resultRightWidth` 独立持久化；实机断言 2/8 覆盖；不可用时走 reopen 条件 |
| 旧 URL / 书签 `/project/:id/result?job=` | D5 fail-closed + 断言 6 |
| 两个 WebGL 渲染器同栏 | `active` 门控透传 + 断言 7 |
| `CenterPanel` / `RightPanel` 测试大面迁移造成假绿 | 迁址用例逐条保留原断言语义；基线=迁前跑一遍相关测试记录通过数，迁后对账 |
| `ResultsSurface` 体积 | pack 解析簇抽 `useResultSurfaceHost.ts`；`gate:code-size` 必过 |
| `ResultArtifactShell` 1323 行本身不动但其导出面变化 | P1 不重构壳内部，只改 props（去 `onBack`）；P2 再瘦身 viewer 分支 |

## 7. 验收门禁与节奏

| 门禁 | P1 | P2 |
| --- | --- | --- |
| `cd frontend && npx tsc --noEmit` | 0 错 | 0 错 |
| 定向 vitest（§3.7 / §4.5 文件列表） | 全绿，数字入收口条目 | 同 |
| `npm run gate:code-size` | PASS | PASS |
| `npm run docs:check` / `npm run ui:audit:check` | PASS | PASS |
| 实机 `acceptance/block-334/result-host-live.json` | §3.8 八项 allPass | 两宿主同 viewer 抽验 |
| UI 台账 | UI-657 in_progress → verified | UI-658（渲染层合并）同节奏 |
| `npm run closeout` | 十一门 PASS | 同 |

节奏：P1 本会话打通主链（tsc 0 + 定向绿），实机走查后 P1-COMPLETED；P2 下一会话立 P2-LAUNCH 加映。环境纪律：dev 栈 `npm run dev`（本机 fnm Node 24），前端改动走 Vite HMR，后端零改动不需重启。

**并行包文件面隔离声明（立项时工作区实况）**：另一 Agent 在制 BLOCK-333（3D 约束编辑器 UI-639a）未提交 WIP——`core/petri-server/helpers/scene3d.js`、`frontend/src/lib/scene3d.ts`、`acceptance/block-333/`、`test/block333-*`、`.agents/skills/petri-dev-infra/dev-verify/flows/block333-*`。本包对以上文件**零触碰、不 stage、不提交**；本包文件面=`frontend/src/components/work-surface/ResultsSurface*`、`workspace-panels/{RightPanel,CenterPanel}.tsx`、`hooks/useWorkspaceRouting.ts`、`pages/project-workspace.tsx` 及 `pages/project-workspace/{useWorkspaceOpenEffects,useWorkspaceTitleBar}.ts`、`lib/result-title-bar.ts`、`lib/workSurface/packTabData.ts`、`components/result-studio/{ResultStudioSurface,ResultStudioChangeSetPanel,resultFocusLayout}.*`、`components/copilot/ChatArtifactCard.tsx`、对应测试与本包文档。潜在交叉点=`work-surface/` 目录与 `RightPanel.tsx`（若 BLOCK-333 后续触碰右栏 3D tab 接线），以 git 变更面为准在收口时如实归属。

## 8. P1 收口记录（2026-11-02）

| 门禁 | 结果 |
| --- | --- |
| `cd frontend && npx tsc --noEmit` | 0 错 |
| `npm run quality:lint` | 0 error（顺手清 project-workspace 五个因 CenterPanel 瘦身而失活的死变量） |
| 定向 vitest | **13 文件 51/51**：新 `work-surface/ResultsSurface.test` 9 / `RightPanel.test` 2 / `CenterPanel.test` 7 / `useWorkspaceRouting.test` 2（四态 fail-closed）/ `result-title-bar.test` 3 / `useWorkspaceTitleBar.test` 2 / `ChatArtifactCard.test` 3 / 邻域 Model3DResultViewer 5、ArtifactPinPane 3、ResultStudioSurface 5、selectionBus、resultAnnotation |
| `npm run gate:code-size` | PASS（`ResultArtifactShell` 1323 行持平——技术详情抽 `ResultArtifactShell/ResultTechnicalDetails.tsx`；CenterPanel 618→~270） |
| `npm run quality:arch` / `gate:arch-cycles` / `quality:knip:check` | PASS / 13 环（1 环消亡，基线收紧）/ PASS（保留面 −1，基线下调） |
| `npm run docs:check` / `ui:audit:check` / `test/ui-ledger-status-contract` | PASS / PASS / 4/4（UI-657 verified 后 live-missing 回 5） |
| 实机 `acceptance/block-334/block334-result-host-live-darwin.json` | **11/11 allPass**（flow `block334-result-host-live`；真 Blender 导出登记 tool job → `?job=` 深链）+ `block334-result-host-live.png` |

实机抓真两处（均为断言面修正，非产品缺陷）：①右栏宽度绝对值由持久化偏好与视口夹持决定（实测 498 = `resultRightWidth` 偏好，> 共用 417），断言改为相对判据；②model3d 导出产物在壳里不水化 revisionId/artifactFamilyId → 导航器无模式切换器（壳既有行为），V7 改为如实记录，子态局部化由单测覆盖。**裁决修正**：D2「左栏收起」在实施时核出与 UI-341 加映二（2026-09-11）/ UI-479「路由模式不触碰侧栏」冲突，已删，只动右栏自己的宽度。

未覆盖（留 P2 收口实机腿）：批注「加入上下文」送达（需人工划选）、820px 窄窗与暗色。

## 9. P2 加映启动（2026-11-02，用户「填好了 你查一下填好了，适配完整，继续之前的工作」）

Jev 核查：key 文件链路通（`jev-cloud-supply` 读到 key、baseUrl/model 默认值）；真实云调用 **HTTP 451 "Typesafe is not available in your region"**——外部区域可用性条件，非配置错；决策工具按设计诚实降级（`partial_degraded:http_error`），解法在用户侧（`TYPESAFE_BASE_URL` 指向可达中转 / 网络出口）。

P2 切片顺序（每片独立可验、同包串行）：

- **Slice A（本会话）**：`components/viewers/{MarkdownViewer,TableViewer,HtmlViewer}` 三类单 viewer；`WorkspaceFilePreview` 的类型分派改走 `resolveResultViewer({ kind: 'file' })`（office docx/pptx/odt/odp 仍由 `detectOfficeKind` 先行，不在注册表域内）；壳的 markdown / table / report 三分支改用共享 viewer；`MarkdownResultViewer` 退役。**CSS 策略**：viewer 只统一结构与逻辑，外观类名由宿主注入（两宿主零视觉变化），样式归并留后续切片——目标是「一种类型一个组件」，不是一次性把两套视觉也合掉。
- **Slice C（2026-11-02 完成）**：勘察实证图像引擎早在 BLOCK-219 Q6 就已统一——`AnnotatableImagePane` 同一组件服务三消费方（结果壳/文件预览/草稿面板），scope 即批注身份参数。实做=去 `ResultImagePreview`→`AnnotatedResultImage` 纯透传一层（resultAnnotation 182→156 行）；**不新建 `viewers/ImageViewer`**（purity=更少结构，不是更新的名字）。未覆盖项撤销。
- **Slice B（2026-11-02 完成）**：验证腿 `block334-p2-text-selection-live` **7/7**（真 Chromium：CM 内 DOM 选区非折叠/容器内/文本可取、CM 接管焦点、宿主动作条弹出）→ 可合并。实施：`viewers/TextViewer`（两宿主唯一文本引擎=CodeMirror；壳只读、文件可写）；壳 `<pre>` 退役；`useArtifactTextSelection` 优先 EditorApi 精确选区 + DOM 兜底 + keyup。单测 6/6、定向 61/61、实机复跑 7/7。壳侧真实 text 产物实机留待首个含 json/text 产物的 tool job。
- **Slice D**：spreadsheet——`exceljs` 仅 `SpreadsheetResultViewer` 一处消费，壳改用 `OfficePreviewPane` 后可做**依赖减法**（走 DEPENDENCY-CHANGE-CHECKLIST 的删除登记）。

UI-658 的台账段在本切片实机腿跑绿后一次写入 verified（BLOCK-332 证据债棘轮 live-missing ≤5 不允许「代码绿、实机待跑」的 in_progress 段先登记——P1 已实证该规则）。

### 9.1 Slice A 收口记录（2026-11-02）

| 门禁 | 结果 |
| --- | --- |
| tsc / `quality:lint` / `quality:knip:check` / `gate:code-size` | 0 / 0 error / PASS（两条 flow 按动态入口登记）/ PASS（壳 1323→1304） |
| 定向 vitest | **12 文件 47/47**（viewers 10 + WorkspaceFilePreview 12 + ResultsSurface 9 + RightPanel 2 + CenterPanel 7 + 壳邻域） |
| `theme-token-contract` | 本包项绿（accent 基线键随 css 搬家平移）；另 4 条红=block-322 10-31 存量（`SceneConstraintEditor`/`Model3DGenerateDialog`：未定义 `--petri-color-danger`、raw fallback×2、裸 font-size×2、按钮清单×1），已登记 AUDIT-LOG 🔴，非本包文件面 |
| 实机 `acceptance/block-334/block334-p2-viewers-live-darwin.json` | **9/9 allPass** + png（临时样本跑完即删） |

顺手清理：`previewFileUtils.isImageFile` 与 `helpers.{isCsvFile,isPdfFile,isHtmlFile,isJsonFile}` 五个失去消费方的判定导出删除（注册表成为唯一来源的直接后果）。未覆盖：壳侧 md/csv/html 实机（本机无此类产物的 tool job），留 Slice C/D 同批补腿。

G0 开发期常态 · 不外推 packaged/Provider/GA。
