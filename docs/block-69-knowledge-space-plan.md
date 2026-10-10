# BLOCK-69 — 知识空间（Knowledge Space）：智能体的可启用知识库器官

> 状态：`completed`（2026-09-09 用户裁决启动，同日首包 P0–P2 一次会话收口：实机 15/15 断言 allPass，UI-318 verified；P3 文档族 / P4 音视频+数据库 候选另行裁决）
> 立项日期：2026-09-09（同日裁决启动、同日首包收口）
> truthDomain: `block-69-knowledge-space`
> UI 台账：UI-318（实现同提交登记）
> 来源：用户 2026-09-09 想法原文（§1）
> 修订 1（2026-09-09，用户评审四问回应）：D4 扩展为 FTS5+向量双通道混合检索并写明按需语义；新增 D9 存储位置可见性、D10 删除语义；P0/验收门同步

## 1. 用户提案（评估对象）

> "目前我们是个智能体，依靠 skills 和 mcp 或者提示词等各种信息来进行工作。我想着这个智能体是否能抽象出来一个知识空间，用来上传解析以往的知识背景，这个空间中不限制任何格式的数据，视频，图像，数据库，文字，语音等等（可以设定特定的解析工具对信息进行预处理）。这个空间作为一个独立的整体，用上大脑的图标，如果启用了这个知识空间，那和智能交互就有了知识库。"

拆解为五条需求：
1. **独立知识域**——智能体之下抽象一个"知识空间"整体，承载用户上传的既有知识背景
2. **格式不设限**——文字 / 图像 / 视频 / 语音 / 数据库等均可上传
3. **可配置解析**——可设定特定解析工具对原始信息做预处理（结构化/转录/描述化）
4. **大脑图标实体**——空间作为独立整体有统一视觉入口（大脑图标）
5. **启用即生效**——开关启用后，智能对话自动带知识库（检索增强）

## 2. 可行性结论

**可行，且地基好于预期**——项目已有真实的 RAG 半套基建，本包补上另一半（摄取管道 + agent 主链路读面 + UI）：

- **嵌入通道已有生产使用**：`core/petri-server/helpers/memory-vectors.js`（SEMANTIC_SEARCH_v1：`memory_vectors` 表 BLOB 存 Float32Array、`EMBEDDING_DIM=1024`、`text-embedding-v3`、cosine 检索、TOPK=3、THRESHOLD=0.55）；调用链 `memory-vectors.js dashscopeEmbed` → `core/petri-server/helpers/model-gateway.js embed()` → `core/shared-backend/llm-providers/model-gateway.js:295-319` → `dashscope.js:38-103`
- **agent 主链路只写不读（本包正好补读面）**：`routes/ai-agent/chat.js:1121-1143` 跑完 turn 写记忆向量，但 `ai-agent/chat.js` / `agent-runner.js` 全程无任何检索注入（grep 证实 0 命中）——知识空间注入是新增能力，不与既有注入冲突
- **工具注册双模式成熟**：agent 工具面 `core/petri-server/agent-tools/tool-defs.js`（名字→实现 `registry.js:104-124`，权限分级 `contract()` `:176-201`），注入点 `agent-runner.js:596` 与 `routes/ai-agent/chat.js:592`——`knowledge_search` 工具有干净挂点
- **存储约定现成**：单一 `petri.db`（`core/petri-server/db.js`）+ `<LOCAL_DATA_DIR>` 子目录约定（`src/main/env-coordinator.js:222-244`），新增 `knowledge/` 子目录顺理成章
- **UI 扩展有先例**：`RightPanelMode` 八值 union（`frontend/src/pages/project-workspace.tsx:84`）+ `RightPanel.tsx:137-239` 分支分发，review tab 是最近先例；`ContextBudgetBar` TokenBudget categories（`frontend/src/components/copilot/ContextBudgetBar.tsx:3-22`）可扩展类目
- **全文索引能力内建（修订 1 核实）**：better-sqlite3 12.11.1 自带 SQLite 且默认启用 FTS5 全文检索 + trigram 分词器（中文子串匹配可用）——**关键词索引通道 0 新依赖**；注意当前仓库 better-sqlite3 按 Electron ABI 编译，系统 node 直接 require 会 NODE_MODULE_VERSION 报错，FTS5/trigram 可用性在 P0 以重建环境单测实证

**缺口（本包分期补齐）**：无 PDF/OCR/音视频转录/数据库直读解析；embedding 供应商当前仅 DashScope text-embedding-v3 一个实现；向量检索为暴力全表扫描（无 sqlite-vec/FAISS）；前端无任何知识库 UI。

## 3. 代码事实基线

- **对话记忆（相邻域，不动）**：`memory_vectors`（按 user/project/kind 索引）+ `user_facts`（`routes/ai-memory.js:12-126`）；旧 chat 路由注入检索块（`routes/ai-chat.js:205,340`），agent 路由只写——三者与知识空间语义不同（记忆=对话沉淀、事实=用户画像、知识=用户上传背景），**不合并不互写**
- **项目数据导入（相邻域，不混）**：`POST /api/workspaces/:projectId/import`（`core/petri-server/routes/files.js:236-301`，multer 限 `.csv/.tsv/.txt` 500MB）+ `core/shared-backend/data-profiler.js` profiling——这是**项目工作区数据面**真相；知识空间是独立域，不落 `<workspace>/data/`，不复用该端点
- **前端 Office 预览（参考件）**：`frontend/src/lib/office-file-preview.ts` 用 unzipit 提取 docx/xlsx/pptx 结构化摘要——是前端渲染层简化摘要，非后端摄取管道，思路可参考不直接复用
- **视觉通道**：`core/petri-server/agent-tools/vision-tools.js` `read_image`（dashscope-vision provider，注册于 `agent-tools/registry.js:124`）——图像知识摄取可复用同通道做"描述化索引"
- **上下文组装链**：前端 `useChatStream.send`（`frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts:163-210`）→ `conversationRunStore.startConversationRun`（`:363` 起）→ `copilotClient.streamChat`（`copilotClient.ts:1113-1121`）→ `POST /api/ai/agent` SSE → 后端 `buildSystemPrompt`（`agent-runner.js:340-370`；`helpers/system-prompt.js:423`）——注入块加在 `buildSystemPrompt` 一层
- **composer 挂点**：accessMode 档位菜单（`SimpleChat.tsx:1687-1751`）、模型选择器（`:1798-1850`）、⋯ 菜单（`:1756-1795`，**BLOCK-68 已裁决整体移除，本包不得依赖该挂点**）；预算环挂载 `:1797`

## 4. 设计裁决（D1–D8，标 ⏳ 者待 P0 评审用户确认）

- **D1 独立知识域（第三数据域）**：`petri.db` 新增 `knowledge_spaces`（v1 单行 default 空间：name/enabled/embedding 模型——"大脑"的实体化）、`knowledge_documents`（name/kind/size/status/error/chunk_count/时间戳）、`knowledge_chunks`（doc_id/seq/text/vector BLOB/dim/model）。向量编码沿用 memory-vectors 的 Float32Array BLOB 方案但**独立建表**，不改 `memory_vectors` 任何语义。表带 space 字段留多空间扩展位，v1 只呈现"一个大脑"
- **D2 摄取管道**：解析器注册表（parser registry，按扩展名/MIME 路由）；文档状态机 `uploaded → parsing → chunking → embedding → ready | failed(+error)`；原始文件落 `<LOCAL_DATA_DIR>/knowledge/<docId>/`；进程内串行摄取队列 + 前端轮询状态
- **D3 分块**：结构感知（标题/段落边界）+ 尺寸上限（约 800 token/块、少量重叠），参数收敛到单一常量模块，不提前调优
- **D4 检索与注入（本包核心裁决 ⏳，修订 1 扩展）**：
  - **双通道索引，不只向量**——① 向量通道（DashScope text-embedding-v3 + cosine，负责语义/换说法召回）；② **FTS5 全文通道**（关键词精确命中，负责基因名、代码标识符、药名、错误码等罕见精确 token——向量嵌入对这类词常失真，生物信息域尤其依赖）；检索时两路各取 top-k 后 **RRF 融合排序**，`knowledge_chunks` 同步建 FTS5 虚表（trigram 分词），中文短词（<3 字）边界情况由单测覆盖（必要时查询侧 n-gram 扩展）
  - **按需检索，两层语义**——① **自动召回是"轻按需"**：启用后每 turn 以用户最新消息为 query 检索一次，**过相关阈值（沿用 0.55 先例）才注入**，且上限 ≤3 块；无命中不注入任何内容，不是无脑全量塞；② **`knowledge_search` 是"深按需"**：agent 在推理中主动发查询，可多轮、可换关键词，走工具结果进上下文。推荐两层同开（贴合"启用即有知识库"心智）；若用户只选工具层，知识库退为 agent 可选能力——**待 P0 评审裁决**
  - 注入块计入 ContextBudgetBar 新增 `knowledge` 类目，预算透明
- **D5 多模态分期 + 可配置解析（对应需求 2/3）**：P1 文本族（txt/md/code/json/csv/tsv，**0 新依赖**）→ P3 文档族（PDF 需新依赖如 pdf-parse ⏳ 届时裁决；Office 结构化抽取；图像复用 dashscope-vision 生成描述文本入库索引）→ P4 音视频（DashScope ASR HTTP API，如 paraformer/sensevoice，0 本地重依赖）+ 数据库（`.sqlite/.db` 直读 schema+采样行转文本）。"设定特定解析工具" = 注册表内每类格式的解析器映射可在设置面配置；**外部插件化解析器（用户自定义脚本进程）登记远期候选，不进本期**
- **D6 UI（对应需求 4/5）**：大脑图标 = 知识空间实体入口——composer 工具条独立 icon 开关按钮（启用态高亮，**不挂 ⋯ 菜单**——BLOCK-68 已裁决其移除）+ 右栏 `RightPanelMode` 增 `'knowledge'` tab（与文件/审阅/模型 I/O 并列）。tab 内容：空间开关 + 文档列表（名称/类型/状态/块数/时间）+ 多选上传 + 删除/重建索引 + **检索测试框**（输入 query 看.top-k 命中，摄取质量可自证）。启用状态单一真相 = DB，前端经端点读写，不造第二真相
- **D7 嵌入依赖事实（诚实呈现）**：当前唯一 embedding 实现 = DashScope text-embedding-v3；**启用前提 = DashScope key 已配置**（aiSettings 既有通道），无 key 渲染诚实空态（"配置嵌入模型后可启用"），不静默降级。本地 embedding（transformers.js）登记远期候选
- **D8 检索规模边界**：better-sqlite3 暴力扫描 + 余弦在万级 chunk 内可用（单机桌面场景合理）；sqlite-vec 等向量索引登记为规模触顶后的候选，本期不做
- **D9 存储位置与可见性（修订 1 新增）**：知识库全部落在用户数据根目录 `PETRI_LOCAL_DATA_DIR`（默认 `<文档>/Petri-Local`，`src/main/env-coordinator.js:222-231`）——**原始文件** `<root>/knowledge/<docId>/`，**索引与清单** 同一根目录 `petri.db` 内的知识域表 + FTS5 虚表；设置面板/知识 tab 提供「打开知识目录」入口（复用既有 files 桥的 reveal 通道），用户始终找得到、备份得了
- **D10 删除语义（修订 1 新增，对应"用户可以清除部分内容吗"）**：**可以，粒度 = 整篇文档**——知识 tab 文档列表每行带删除入口，删除在单事务内清除原始文件 + chunks + 向量 + FTS 行，同时生效于两条检索通道（删后立即可证不命中）；另设「清空空间」危险区入口（两步确认，BLOCK-64 取消两步确认先例）；解析质量不佳用「重建索引」对单文档重跑管道。**文档内部段落级编辑不在首包**（远期候选，chunk 粒度删除涉及引用一致性，先不做）

## 5. 阶段划分（建议 P0–P2 为首包一次会话收口；P3+ 另行裁决）

| 阶段 | 内容 | 依赖裁决 |
| --- | --- | --- |
| P0 | 存储域 + 检索内核：三表 + FTS5 全文虚表 + helper（chunk/embed/双通道检索 RRF 融合）+ 单测，0 UI | FTS5/trigram 可用性单测实证 |
| P1 | 文本族摄取 + agent 工具：上传端点 + parser registry（文本族）+ 状态机 + `knowledge_search`/`knowledge_status` 工具注册 | 无（0 新依赖） |
| P2 | agent 注入 + UI 第一版：自动召回注入 + 大脑开关 + 右栏知识 tab + ContextBudgetBar 类目 | D4 ⏳（注入策略） |
| P3 | 文档族解析：PDF / Office / 图像 vision 索引 | PDF 依赖 ⏳ |
| P4 | 音视频 ASR + 数据库直读 | DashScope ASR 权限 |
| P5 | 收口：实机 CDP 断言 + UI-318 台账 | — |

## 6. 验收门（启动时可按实际裁剪范围调整）

- `tsc` 0 错误；受影响定向 vitest（chunker / 双通道检索融合 / FTS 中文与短词边界 / 工具契约 / UI 组件）
- `npm run docs:check` + `npm run ui:audit:check`
- dev Electron 实机 CDP 断言（证据落 `acceptance/block-69/`）：
  1. 上传 txt/md → 状态流转到 ready，块数合理
  2. 启用后对话命中知识（回答引用知识内容，工具轨迹或注入块可证）；**关闭开关后同问题不再命中**
  3. 检索测试框 top-k 命中合理
  4. 删除文档后（单事务）原始文件 + 分块 + 向量 + 全文索引一并清除，两条检索通道均不再命中；「清空空间」两步确认生效
  5. 无 DashScope key → 诚实空态，不崩不假启用
- UI-318 台账与实现同一提交登记

## 7. 范围外

- **不动** `memory_vectors` / `user_facts` / `routes/ai-chat.js` 记忆检索语义（对话记忆域零改动）
- **不混**项目工作区数据面（`routes/files.js` import + data-profiler 项目数据真相不动）
- 不做本地 whisper / tesseract / 本地 embedding 模型 / sqlite-vec（远期候选，触顶再议）
- 不做外部插件化解析器执行面（用户自定义脚本解析器，远期候选）
- 不做文档内部段落级编辑（chunk 粒度删改涉及引用一致性，远期候选；解析质量差用「重建索引」兜底）
- 不动 agent-runner 核心循环逻辑（注入发生在 buildSystemPrompt 层与工具注册层）
- G0 开发期常态 · 不外推 packaged/Provider/GA

## 8. 排队与串行

- 当前无 active 工作包；排队候选：BLOCK-67-SSH-REMOTE-PROJECT（大包）+ BLOCK-68-UI-DECLUTTER（小包）+ 本包（中大包，建议 P0–P2 首包收口）
- **文件面重叠警示**：本包 UI 与 BLOCK-68 相邻（`SimpleChat.tsx` / `project-workspace.tsx` / `RightPanel.tsx` / `useRightPanelTabs.ts`）——按串行纪律天然不并发；若两者相继启动，**建议 BLOCK-68 先行**（其 `RightPanelMode` 增 `'io'` 后本包再增 `'knowledge'`，union 演进有序，且 ⋯ 菜单移除后 composer 挂点形态定型）
- 工作区现状（2026-09-09 登记时核实）：UI-315 终端块跟进 WIP（`ToolActivityList.tsx` / `simple-chat.css` 未提交）进行中，任何启动按串行纪律待其落定
- 启动顺序由用户裁决
