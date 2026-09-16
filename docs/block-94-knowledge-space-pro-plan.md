# BLOCK-94-KNOWLEDGE-SPACE-PRO — 知识空间专业化升级

最后更新：2026-09-16

状态：`planned（2026-09-16 立项登记，排队不占 active 槽位；启动需用户裁决）`

计划编号：`BLOCK-94-KNOWLEDGE-SPACE-PRO`

用户裁决原话：「需要新建一个block用来优化知识空间 主要目的是让知识空间内变得专业 易用 能力全面」（2026-09-16）

主模块：知识空间（`/knowledge` 全局页 + `core/biof3-server` knowledge 域）

前身：`docs/block-69-knowledge-space-plan.md`（v1，completed；UI-318/320/348/366 verified）——文本族单空间 RAG 原型。v1 P1/P2 交付质量高（诚实空态 / fail-closed / 单一真相纪律贯彻、21 项后端契约测试 + 实机 15 断言、产品代码近零 TODO），但能力边界清晰：格式仅文本族、DashScope 单点、无引用溯源、无批量管理、无预览、重启摄取卡死。本包是 v2 专业化升级载体：兑现 BLOCK-69 plan 已登记未启动的 P3 断层，并扩展管理面 UX 与工程底盘。

## 0. 三目标 → 六工作面（2026-09-16 代码摸底证据）

用户目标「专业 / 易用 / 能力全面」映射为六个工作面。每面独立可验收、独立提交；优先级与裁剪在 P0 评审由用户裁决。

### F1 可靠底盘（专业）

- **摄取队列启动恢复**：队列为进程内 promise 链，无持久化、无启动恢复（`core/biof3-server/helpers/knowledge-ingest.js:31-45`）——重启后 uploaded/parsing 中间态文档永久显示「摄取中」，只能逐个手动 reindex。→ 启动时中间态文档自动重排入队或标 failed 并支持批量重试。
- **嵌入模型一致性防护**：chunks 已存 dim/model 列但检索只查 `embedding IS NOT NULL`（`knowledge-space.js:343-347`），换嵌入模型后旧向量静默产出错误相似度。→ model 不匹配 chunk 隔离 + 换模型时提示重建。
- **自动召回挂点收敛**：同段注入逻辑在 `agent-runner.js:420-436` 与 `routes/ai-agent/chat.js:405-417` 双处重复实现。→ 收敛为单一实现（纯去重零行为变更）。
- **文档列表分页**：`listDocuments` 全量返回（`knowledge-space.js:78-82`）。

### F2 格式能力（能力全面）

- PDF 解析——BLOCK-69 P3 首项，现状 `PLANNED_EXTENSIONS` fail-closed 拒收（`knowledge-parsers.js:23-28`），面板 accept 白名单同样不含（`KnowledgeSpacePanel.tsx:236`）。docx/Office 为后续评估项。
- **依赖裁决项**：PDF 文本提取的现实路径需新依赖（pdf-parse / pdfjs-dist 家族），按 `DEPENDENCY-CHANGE-CHECKLIST` 在 P0 由用户逐项裁决；「零依赖纯自研提取器」不可行，作为前提如实登记。裁决前维持 fail-closed 现状。

### F3 摄取易用（易用）

- 拖拽上传（对齐 BLOCK-90/91 拖拽房风）；多文件部分失败时只显示第一个错误（`KnowledgeSpacePanel.tsx:107`）→ 逐文件结果聚合展示。
- URL 网页摄取 / 粘贴文本直接入库（评估项）。

### F4 管理面（易用 + 专业）

- **文档预览**：列表仅名称/状态/块数/大小（`KnowledgeSpacePanel.tsx:263-295`），检索命中截 220 字符——无法查看全文或打开原文件。→ 全文预览 + 打开原文件（`files.openPath` IPC 既有先例）。
- **批量操作**：删除/重建仅单文档逐行按钮 → 批量选择 / 批量删除 / 失败批量重试。
- 标签/分组（评估项，仅文档级元数据；多空间数据模型改造见非范围）。

### F5 检索与引用溯源（专业 + 能力全面）

- **引用溯源 UI**：注入/工具结果仅「《文档名》第 N 块」头（`knowledge-space.js:398`、`knowledge-tools.js:50-56`），聊天侧无 citation 卡片、无定位跳转。→ 聊天流内 citation 卡 + 命中块原文定位，回答「这段结论哪来的」。
- 检索过滤（按文档/类型）+ 命中高亮；纯符号查询静默降级诚实化（`knowledge-space.js:244-247`）。
- agent 工具面扩展：`knowledge_read` 按文档深读（评估项；现状仅 search/status 且 status 截前 20 文档，`knowledge-tools.js:71`；工具面窄于 REST 面）。

### F6 规模化底线（专业）

- 向量检索为暴力全表扫描（全量载入 BLOB 后 JS cosine，`knowledge-space.js:340-361`）+ FTS 短词 LIKE 全表兜底（`:250-262`）→ 规模警戒指标（chunk 数阈值观测）+ sqlite-vec/ANN 方案评估。**sqlite-vec 属新依赖，仅评估登记不默认引入。**
- 嵌入单点：无 DashScope key 整空间无法启用（`routes/knowledge.js:76-81` 409）。→ 无 key 诚实降级体验（已入库文档只读可见、开关态诚实呈现）；多 provider 嵌入抽象属架构裁决，仅评估登记。

## 1. 事实基线（2026-09-16 摸底）

| 文件 | 行数 | 角色 |
| --- | --- | --- |
| `frontend/src/pages/knowledge/index.tsx` | 48 | `/knowledge` 全局页壳 |
| `frontend/src/components/workspace-panels/KnowledgeSpacePanel.tsx` | 344 | 管理面（开关/上传/列表/删除/重建/清空/检索测试） |
| `frontend/src/components/copilot/SimpleChat/hooks/useKnowledgeSpace.ts` | 71 | composer 大脑开关（DB 单一真相） |
| `frontend/src/lib/knowledgeClient.ts` | 103 | 前端 API 封装（7 函数） |
| `core/biof3-server/routes/knowledge.js` | 175 | REST 8 端点 |
| `core/biof3-server/helpers/knowledge-space.js` | 493 | 检索内核（分块/嵌入/双通道 RRF/注入/删除） |
| `core/biof3-server/helpers/knowledge-ingest.js` | 194 | 摄取管道（状态机 + 进程内串行队列） |
| `core/biof3-server/helpers/knowledge-parsers.js` | 126 | 解析器注册表（P1 文本族 ~50 扩展名） |
| `core/biof3-server/agent-tools/knowledge-tools.js` | 80 | agent 工具（search + status） |
| `src/migrations/009_knowledge_space.sql` | 73 | 四表（spaces/documents/chunks/chunks_fts trigram） |

- 检索链路：向量（text-embedding-v3 1024 维 cosine 阈值 0.55）+ FTS5 trigram bm25 双通道 RRF k=60 融合；分块=结构感知（Markdown 标题边界）+1600 字符上限+120 重叠；注入 ≤3 块 ≤1800 字符。**是真实语义检索，但向量为暴力扫描。**
- 测试基线：`test/knowledge-space.test.mjs` 21 用例 + `KnowledgeSpacePanel.test.tsx` 4 + `useKnowledgeSpace.test.ts` 3 + global-pages 冒烟 + 实机 `scripts/block69-knowledge-live.cjs` 15 断言。
- 台账：UI-318/320/348/366 均 verified；无散落 TODO（唯一空缺=设计内 fail-closed 的 P3/P4 格式拒绝）。

## 2. 非范围（exclusions，写死）

- 音视频转录 / 数据库直读解析（BLOCK-69 P4 线，维持登记不启动）；
- 多空间（multi-space）数据模型改造（v1 单空间 `ks_default` 是设计内决策；本包最多做文档级标签元数据评估项）；
- 手机投影 / 面板响应式（BLOCK-89 先例：桌面-only 先行，投影另行候选）；
- 嵌入多 provider 大架构改造（F6 只做无 key 降级体验 + 评估登记）；
- 摄取上限（单文件 50MB / 单批 12 个）调整（如需另裁）；
- G1+ 事项（Provider / GA / packaged）与 Result Studio P7（deferred）；
- **BLOCK-93（AGENT-OPTIMIZATION）文件面零触碰**（agentCategories / 子智能体 UI 三处）；BLOCK-92 拆分波文件面如与本包重叠（如 SimpleChat），按届时边界协调、串行不并行。

## 3. 原则（继承 v1 家法）

1. 诚实空态 / fail-closed / 单一真相延续（DB 开关唯一、knowledgeDir 布局不变、新表走 migration）；
2. **新依赖默认 no**：逐项走 `DEPENDENCY-CHANGE-CHECKLIST` + 用户裁决留痕（F2 PDF、F6 sqlite-vec 均属此类）；
3. 自动召回策略变更（query 改写/多查询等行为变更）须用户裁决后入册；F1 挂点收敛=纯去重零行为变更；
4. UI 增量同提交登记 `docs/ui-productization-audit.md`（UI-### 顺延）；
5. 每工作面独立提交、可中断可续作；面内动前存受影响测试基线、动后对账归属（红禁静默）；
6. SimpleChat.tsx 是 P6 绑定源 + UI-38x 高频迭代面：F5 citation 卡等落点涉及它时避免与在制 UI 包/BLOCK-92 Wave A 撞期，撞期即停手上报裁决；
7. dev 纪律：后端（core/biof3-server）变更须重启 dev 栈并预告用户窗口闪动；fnm Node 24。

## 4. 阶段草案（P0 评审裁剪优先级后串行执行）

| 阶段 | 内容 | 验收门禁 |
| --- | --- | --- |
| P0 | 设计评审：六工作面逐项代码事实复核 + 用户裁决优先级与依赖（PDF 依赖 / sqlite-vec / URL 摄取取舍） | 评审结论回写本文件 + 用户确认 |
| P1 | F1 可靠底盘（启动恢复 / 模型一致性 / 挂点收敛 / 分页） | knowledge 契约测试扩展全绿 + tsc + 重启恢复实机断言 |
| P2 | F2+F3 摄取能力与易用（按裁决含/不含 PDF） | 解析器契约 + 面板组件测试 + 实机上传链 |
| P3 | F4 管理面（预览 / 批量操作） | 面板组件测试 + 实机操作链 |
| P4 | F5 检索与引用（citation 卡 / 过滤 / 高亮；knowledge_read 评估项） | 契约 + 组件 + 实机真实轮次溯源命中 |
| P5 | F6 规模化（警戒指标 + 评估报告；依赖项按裁决） | 指标落地 + 评估结论登记 |
| P6 | 整包收口 | `npm run closeout` + dev-verify 实机 flow（扩展 block69-knowledge-live 或新建 knowledge-pro flow）allPass + 证据落 `acceptance/block-94/`（新 acceptance 目录必配 impact-map） |

**完成语义**：整包 `completed` = 已启动工作面全部收口 + 实机证据落 `acceptance/block-94/`；未启动工作面必须经用户显式裁决 `deferred` 并回写本状态头，不允许「半拆无主」状态跨包存续。

## 5. 风险与红线

- **SimpleChat 三重敏感**（全仓最大前端文件 + P6 绑定源 + UI-38x 高频迭代面）：F5 落点撞期即停手上报，参照 BLOCK-92 §5 同款纪律；
- **loop/agent 族存量基线红**（continuation guard 2 项 🟡 等）：F1 挂点收敛触碰 agent-runner/chat.js，动前存基线、动后逐项对账归属，禁把存量红记成本包引入；
- **队列并发**：BLOCK-92（copilot 族拆分）/ BLOCK-93（子智能体面）在排队，本包 F4/F5 的 UI 面与其文件面重叠度在 P0 评审显式对账，单工作包串行不并行；
- **诚实边界**：F6 评估项只做结论登记，不虚设性能宣称；G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口预期预先声明（对账清单）

- 每工作面门禁实况数字（定向测试 x/x / tsc / 实机断言数）记入本文件状态头与 AUDIT-LOG 行；
- UI-### 台账行与 `acceptance/block-94/` 实机证据一一对应，impact-map 同步登记；
- 依赖裁决逐项留痕（用户裁决原话）；`npm run docs:check` 与 `npm run ui:audit:check` 收口必绿。
