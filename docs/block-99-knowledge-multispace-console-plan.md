# BLOCK-99-KNOWLEDGE-MULTISPACE-CONSOLE — 知识空间多空间版 + 空间管理会话台

计划编号：`BLOCK-99-KNOWLEDGE-MULTISPACE-CONSOLE`

状态：`planned（P0-PLANNED，排队不占 active 槽位；启动需用户裁决）`

用户裁决原话（2026-09-18，继「知识空间是否可分组归类加标签、按任务选背景」提问后的立项裁决）：
「是需要做的 并且是 完整多空间版」「知识空间的 面板中需要加入会话聊天的页面来单独处理控制知识空间内的各种内容 无论是布局还是分类 是否可以呢？」

前身：BLOCK-94-KNOWLEDGE-SPACE-PRO（v2 专业化升级，2026-09-18 completed；UI-402 verified）——单空间形态收口时明确登记「多空间数据模型改造在非范围」，本包即该边界的正面立项。v1=BLOCK-69（文本族 RAG 原型）。

## 0. 两目标 → 六工作面（2026-09-18 立项摸底，HEAD 16b0bd1a）

用户两诉求：①**完整多空间版**（多个命名知识空间，按领域组织，会话按任务选空间背景）；②**空间管理会话台**（知识空间面板内嵌会话聊天页，用自然语言驱动空间内容的管理与归类）。映射为六个工作面，每面独立可验收、独立提交。

### G1 多空间数据模型与 CRUD（专业）

- `knowledge_spaces` 表 v1 即支持多行（建表注释「space 字段留多空间扩展位」，`src/migrations/009_knowledge_space.sql:18`）；documents/chunks 均带 `space_id` 列 + FK ON DELETE CASCADE——数据模型扩展位现成，migration 010 additive。
- REST 面参数化：现有 12 端点全为单空间隐式 `ks_default`（`core/biof3-server/routes/knowledge.js`，space GET/POST + documents 8 端点 + clear + search）——新增 spaces CRUD（create/rename/delete/enable），存量文档端点加 spaceId 参数。
- 删除空间=级联删除其文档与分块（FK 已有）；须确认门 + 诚实列出影响面（文档数/块数）。
- 存量 `ks_default` 无缝保留为默认空间，单空间用户零迁移成本、零行为变更。

### G2 面板信息架构改造（易用）

- `KnowledgeSpacePanel.tsx`（现 701 行）从单空间管理面 → 空间列表/切换 + 每空间文档管理；BLOCK-94 交付的预览/批量操作/规模观测（scaleStats）沿空间维度沿用。
- 空间维度开关与无 key 降级提示（`knowledge-degraded-fts` 诚实化机制按空间呈现）。

### G3 会话级空间绑定与召回范围（专业）

- composer 大脑开关（`useKnowledgeSpace.ts`，现为全局布尔）→「开 + 空间选择」；会话级记住所选空间。
- 注入挂点 `buildTurnInjection`（BLOCK-94 F1 已收敛单源）按绑定空间过滤检索；`searchKnowledge` 的 docId 过滤（BLOCK-94 P4，向量/FTS/count 三处同参）扩展为 spaceId 过滤，管道同根。
- 溯源管道（knowledge_citations 事件→摘要卡）零结构变更，仅来源空间标注。

### G4 空间管理会话台（用户点名；易用 + 能力全面）

- `/knowledge` 页（`pages/knowledge/index.tsx`，48 行薄壳）内嵌会话聊天面：自然语言驱动空间管理——建空间/改名/启停/文档归类移动/删除/重建索引/查询状态。
- 管理操作工具化：新增 agent 工具族（space_create/space_list/space_enable/doc_move/doc_delete/doc_reindex 等，集合 P0 定）注册 tool-registry（现 59 工具，additive；**工具总数计数断言须同步**，BLOCK-94 58→59 先例）。
- 双通道同一真相：手动 UI 操作与会话驱动操作走同一套 REST/工具底层，面板状态实时反映。
- 破坏性操作（删空间/清空/批量删除）经确认门（既有确认弹层/approval 先例）。
- **诚实边界**：会话台控制的是知识空间的**内容组织**（空间集合/命名/启停/文档归属/归类/索引），不是面板 UI 布局代码本身。

### G5 嵌入模型与一致性按空间（专业）

- `knowledge_spaces.embedding_model` 列已留；BLOCK-94 F1 的 chunk dim/model 一致性隔离机制天然按空间扩展，换模型隔离语义不变。

### G6 实机收口

- dev-verify flow `block99-knowledge-multispace` 注册 + 证据落 `acceptance/block-99/`（新 acceptance 目录必配 impact-map）；跨重启启动恢复按空间维度复验（BLOCK-94 boot recovery 4/4 家法延续）。

## 1. 事实基线（2026-09-18 立项摸底，HEAD 16b0bd1a）

| 文件 | 行数 | 角色 |
| --- | --- | --- |
| `core/biof3-server/helpers/knowledge-space.js` | 594 | 检索内核（双通道 RRF/docId 过滤/scaleStats/注入收敛后单源） |
| `core/biof3-server/helpers/knowledge-ingest.js` | 239 | 摄取管道（状态机+串行队列+启动恢复） |
| `core/biof3-server/helpers/knowledge-parsers.js` | 182 | 解析器注册表（文本族+PDF） |
| `core/biof3-server/routes/knowledge.js` | 287 | REST 12 端点（全单空间隐式 ks_default） |
| `core/biof3-server/agent-tools/knowledge-tools.js` | 116 | agent 工具 search/status/read 三件（工具总数 59） |
| `frontend/src/components/workspace-panels/KnowledgeSpacePanel.tsx` | 701 | 管理面（**已达 BLOCK-92 棘轮 ≥700 行台账线**） |
| `frontend/src/pages/knowledge/index.tsx` | 48 | `/knowledge` 页壳（G4 会话台挂载点） |
| `frontend/src/lib/knowledgeClient.ts` | 168 | 前端 API 封装 |
| `frontend/src/components/copilot/SimpleChat/hooks/useKnowledgeSpace.ts` | 71 | composer 布尔开关（DB 单一真相） |
| `src/migrations/009_knowledge_space.sql` | 73 | 四表（spaces 多行能力/space_id 遍布/FK CASCADE/embedding_model 列已留） |

测试基线（BLOCK-94 收口时点）：knowledge 契约 34/34 + agent-tool-registry 9/9（计数断言）+ 面板 8/8 + useKnowledgeSpace 3 + 实机 block94-knowledge-live 18/18 + boot-recovery 4/4。台账 UI-402 verified。

## 2. 非范围（exclusions，写死）

- 音视频转录 / 数据库直读解析（BLOCK-69 P4 线维持登记不启动）；
- 手机投影 / 面板响应式（桌面-only 先例延续）；
- 嵌入多 provider 抽象（G5 仅限已支持家族内选择；provider 大架构另议）；
- sqlite-vec/ANN（BLOCK-94 §8 结论延续：按全库 chunk 总量常态化超 50k 阈值且有真实卡顿再立项）;
- 文档级标签/分组 UI（多空间后「空间=领域主分类」承接该诉求；空间内文档标签降为 P0 评估项，默认不做——BLOCK-94 D5 结论顺延）；
- **SimpleChat.tsx 主文件零触碰**（P6 绑定源 + BLOCK-92 Wave A 产物；G4 会话台走独立轻量面）；
- 知识溯源 citation 管道结构变更（G3 只改检索范围与空间标注）；
- 会话台控制面板 UI 布局代码（诚实边界见 G4）；
- G1+ 事项（packaged/Provider/GA）与 Result Studio P7（deferred）。

## 3. 原则（继承 v1/v2 家法）

1. 诚实空态 / fail-closed / 单一真相延续（DB 开关唯一、knowledgeDir 布局不变、migration 010 additive、不动 memory_vectors/工作区数据面红线延续）；
2. **新依赖默认 no**：本期预计 0 新依赖；如 P0 出现依赖诉求逐项走 `DEPENDENCY-CHANGE-CHECKLIST` + 用户裁决留痕；
3. 自动召回策略变更须用户裁决：G3 空间过滤=范围收窄属新注入行为，「选中空间无命中时是否回退全库」为 P0 裁决项（D2），不得静默回退；
4. UI 增量同提交登记 `docs/ui-productization-audit.md`（UI-### 顺延，当前 361 号段后）；
5. 每工作面独立提交、可中断可续作；面内动前存受影响测试基线、动后对账归属（红禁静默）；
6. KnowledgeSpacePanel 已 701 行触台账线：G2 改造须同步拆分或在行数台账中如实说明，禁只增不减恶化台账；
7. dev 纪律：core/biof3-server 变更须重启 dev 栈并预告用户窗口闪动；fnm Node 24。

## 4. 阶段草案（P0 评审裁剪后串行执行）

| 阶段 | 内容 | 验收门禁 |
| --- | --- | --- |
| P0 | 设计评审：六工作面逐项代码事实复核 + D1-D7 用户裁决 | 评审结论回写本文件 + 用户确认 |
| P1 | G1 多空间数据模型 + REST CRUD + 参数化 | migration 契约 + knowledge 契约测试扩展全绿 + 存量 ks_default 零行为变更回归 |
| P2 | G2 面板信息架构（空间列表/切换/沿空间管理） | 面板组件测试 + tsc + theme 门禁 |
| P3 | G3 会话绑定 + 召回范围 + 溯源空间标注 | 契约 + 实机真实轮次（选中空间命中/无命中诚实行为） |
| P4 | G4 管理会话台 + 工具族 | 工具注册契约（计数断言同步）+ 会话台实机操作链 + 破坏性确认门 |
| P5 | G5+G6 嵌入一致性按空间 + 实机收口 | 跨重启恢复按空间复验 + dev-verify flow allPass |
| P6 | 整包收口 | `npm run closeout` + 证据落 `acceptance/block-99/` + canonical 五件套回写 |

**完成语义**：整包 `completed` = 已启动工作面全部收口 + 实机证据落 `acceptance/block-99/`；未启动工作面必须经用户显式裁决 `deferred` 并回写本状态头，不允许「半拆无主」状态跨包存续。

## 5. P0 裁决项预置（D1-D7）

- **D1 会话绑定粒度**：单会话绑单空间（推荐，语义清晰可预期）vs 多空间多选 vs 提供「全部空间」聚合检索模式（RRF 天然可多源融合，但溯源/无命中语义复杂化）。
- **D2 选中空间无命中行为**：诚实提示「所选空间未命中」不回退（推荐，可预期性优先）vs 回退全库检索并诚实标注来源空间。
- **D3 管理会话台形态**：独立轻量 chat 面（推荐，绑定 knowledge 工具子集，避开 SimpleChat 红线）vs 复用 SimpleChat 全家桶。
- **D4 破坏性操作门**：删空间/清空/批量删除走确认弹层（推荐）+ 会话驱动触发时同门。
- **D5 空间级嵌入模型**：P0 先全局统一、`embedding_model` 列留而不用（推荐，降复杂度；G5 隔离机制已就位随时可启用）vs 每空间可配一步到位。
- **D6 管理会话存储**：复用会话系统独立 conversation（推荐，可回溯可审计）vs 即抛式不落库。
- **D7 管理工具集边界**：只读+非破坏全开、破坏性走确认门（推荐）；最小集 vs 全集 P0 按工具数成本定。

## 6. 风险与红线

- **KnowledgeSpacePanel 701 行触台账线**：G2 必须处理行数台账（拆分或如实说明），BLOCK-92 棘轮纪律延续；
- **agent-tool-registry 计数断言**：G4 新增工具族须同步总数断言（58→59 先例），漏同步即红；
- **migration 010 additive 红线**：只新增表与列，存量 ks_default 数据零破坏，禁 INSERT OR REPLACE/PRAGMA（009 家法）；
- **buildTurnInjection 挂点**：agent/chat 两路共用的收敛单源，动前存 loop/agent 族定向基线、动后逐项归属；
- **队列关系**：当前队列=BLOCK-85 Mac 双真机（P4 closeout 待收）/ BLOCK-88（P0-REVIEW 待裁决）；本包排队不占 active 槽位，启动序由用户裁决；
- **诚实边界**：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 收口预期预先声明（对账清单）

- 每工作面门禁实况数字（定向测试 x/x / tsc / 实机断言数）记入本文件状态头与 AUDIT-LOG 行；
- UI-### 台账行与 `acceptance/block-99/` 实机证据一一对应，impact-map 同步登记；
- 依赖裁决逐项留痕（预计 0 新依赖，如有须原话）；`npm run docs:check` 与 `npm run ui:audit:check` 收口必绿；
- 「G0 开发期常态 · 不外推 packaged/Provider/GA」收口恰一次。
