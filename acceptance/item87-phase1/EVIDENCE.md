# item 87 第一阶段 — 领域知识层 MVP + bio 三件套草稿 · 验收证据（2026-11-27）

## 范围声明

本批覆盖方案 v1.0（owner 批准稿）§11 三件套草稿 + §5/§6 知识层骨架（A 组：纯后端+资产）。
Acceptance 只证明其契约声明的范围：知识层是**骨架与管线 MVP**（无 HTTP 读面/无前端面——待 88/教练层接线）；
bio 三件套是**草案**（待领域专家 owner 确认后定稿，草稿期机器钉已生效）。

## A. 知识层骨架

### 1. 数据层（方案 §8 五件套纪律）

- `core/shared-backend/do-knowledge-schema.js`：`do_knowledge_cards` / `do_citation_records` DDL 唯一来源；
  `src/migrations/025_domain_knowledge.sql` 由 `buildDoKnowledgeMigrationSql()` 生成，
  `test/item87-do-knowledge.test.mjs` 强制逐字节一致（scratchpad 016 同款防第二真相）。
- **append-only**：两表 BEFORE UPDATE/DELETE 触发器 RAISE(ABORT)——改写/删除在 SQL 层即失败；
  修订只能追加新卡（`revision_of` 版本链，`supersedeKnowledgeCard`）。
- 引用记录 DOI 唯一约束：同 DOI 不得二次入库。

### 2. sources.yaml schema（方案 §5.2 先真理源）

- `core/shared-backend/do-sources.js`：零依赖严格子集 YAML 解析（tab/未知形态 fail-closed 抛错）+
  schema 校验（meta.status=draft|confirmed；来源字段 id/name/url/authority_level 枚举/freshness 枚举/verified_date）。
- 校验通过 ≠ 权威性确认——「可信」是领域内判断，专家拍板前 status 保持 draft。

### 3. 采集管线 MVP（真源实测）

- `core/shared-backend/do-ingest.js`：抓取→结构化总结卡片（结论/证据等级/来源/日期/有效期）→入库带溯源
  （provenance.pipeline/fetchedAt/summarizeMode 落 provenance 列）。
- fail-closed：抓取失败/总结失败/DOI 验真失败→零副作用不出卡。
- MVP 总结器=摘录式（`extractiveSummarizer`）：卡片 conclusion 均为原文摘录（前缀【摘录·源名】），
  不生成原文没有的结论；LLM 总结面等教练层接入再升级（provenance 已留 summarizeMode 字段）。
- 有效期策略：stable+730d / fast+90d（`VALIDITY_POLICY_DAYS`，快变到期即需 L2 重采）。

### 4. 引用验真（方案 §6 入库验真关）

- `core/shared-backend/citation-verify.js`：`normalizeDoi`（剥 doi.org/dx.doi.org/doi: 前缀）+
  `verifyCitation`（Crossref 先查、404 时 **DataCite 兜底**——实测 `10.18129/B9.bioc.DESeq2`
  在 Crossref 404、DataCite 200，只接 Crossref 会误杀 Bioconductor 包 DOI）；
  题录匹配（expectedTitle 粗匹配，副标题/截断容忍）。
- fail-closed 契约：status ∈ verified | title_mismatch | doi_unresolvable | network_error，
  只有 verified 可入库；**网络错误永远不是 verified**（不可达 ≠ 验真通过）。
- 隐私红线（方案 §9）：反查只发 DOI 字段，用户正文不出本机。

## B. bio 三件套草稿（resources/domain-onboarding/petri-pack-bio/）

1. `sources.yaml`：6 条真理源候选（NCBI Bookshelf / Ensembl / Bioconductor DESeq2 vignette /
   STAR 手册 / Love 2014 论文 / Bioconductor Release Announcements），逐条 authority_level+freshness，
   头部显式标「待领域专家（owner）确认」，meta.status=draft（测试钉住不得提前翻 confirmed）。
2. `playbooks/deseq2-differential-analysis.md`：8 步教练化草稿（升级自包内 DESeq2 golden path 实战：
   demo 工具 `deseq2` + `test/fixtures/golden-path/deseq2-run.json`）——每步带领域含义/验收标准/常见坑/
   「依据:」真理源引用 + 坑速查表 + 6 条可执行验收红绿（HK-01 文化扩展雏形）。
3. `taste-samples.md`：5 组好/坏对照候选（图表规范/统计口径/结论谨慎度/可复现性/数据质控），
   每组带来源行 + 「状态: 候选」标注供 owner 增删。

## HK-01 红绿先行证据

红（实现前）：`test/item87-*` 四文件 17 测全红于缺模块（Cannot find module do-knowledge-schema/citation-verify/do-sources）。

绿（实现后）：17/17，含三钉：
- **钉①卡片 schema**（HK-87-3）：缺 sourceId/sourceUrl/sourceDate/validUntil/conclusion/domain、
  未知证据等级/时效分级 → 一律拒绝入库，可读原因。
- **钉②DOI 验真**（HK-87-5）：verify.status≠verified 的引用拒绝入库；验真通过才收；同 DOI 二次入库拒绝。
- **钉③引用纪律**（HK-87-13/14）：领域断言无来源=红；来源不在真理源清单=红；
  playbook「依据:」与品味样本「来源」批量核验全部解析回清单（提取器 `extractPlaybookSourceRefs`）。
- 附加钉：append-only 触发器（HK-87-2，注意触发器是行级的——空表 UPDATE 0 行不触发，测试已按此核）、
  迁移字节一致（HK-87-1）、管线 fail-closed（HK-87-16/17）。
- live 真调用（HK-87-11）：真调用 Crossref 反查 Love 2014 DESeq2 论文通过（网络不可达则如实 skip 不冒充实测）；
  fixture 注入测试全部如实标注 mock，live 与 fixture 分测。

## 真源实测（acceptance/item87-phase1/live-ingest.mjs → live-evidence.json）

- 真源 1 Bioconductor DESeq2 vignette：真抓取（200，2.9MB）→ 摘录卡片入库 ok（2705ms）
- 真源 2 STAR 官方 README：真抓取→摘录卡片入库 ok（fast 分级，有效期 90 天）（634ms）
- Crossref DOI 反查 Love 2014：真调用 **verified via crossref**（1005ms），引用记录入库
- 共 2 卡片 + 1 引用记录，全部带 provenance/verify_detail 溯源

## 门禁证据（CI 等价，2026-11-27 本地）

- 11 静态门全绿：docs:check ✅ · ui:audit:check ✅ · quality:secret ✅ · quality:arch ✅ ·
  quality:lint ✅（0 errors）· quality:types ✅ · gate:code-size ✅ · gate:css-modules ✅ ·
  gate:arch-cycles ✅ · quality:knip:check ✅（`--update --allow-grow` 登记留因：live-ingest.mjs
  为一次性证据脚本=动态入口，同 stall-live 先例；基线同轮收缩 1 存量键为上游删除）·
  gate:tracked-consistency ✅
- platform 步：35 测 33 绿 2 live-skip；harness:check ✅ + harness:phase6 66 测 64 绿 2 skip +
  工具单测 bundle 106 测 104 绿 2 skip
- `test:changed`：113 测 104 绿 / 5 红 / 4 skip——5 红全部为存量名单（P6 源绑定、MCP 子进程缺
  projects 表 ×3、W5a 棘轮），非本批引入；本批曾引入 1 例新红（item85 acceptance 目录的
  evidence.json 假想路径未映射）已当批修复（impact-map 补 `acceptance/item85-video-file-panel/**`）。

## 约束遵守

零触碰 `frontend/src/components/copilot/**`、`build/afterPack.js`、generate-tools 凭据段；零新依赖
（sources.yaml 解析为内置严格子集实现）；未 push。

## 待办（owner / 下阶段）

- owner 确认真理源清单（逐条改判权威等级→翻 confirmed）；品味样本增删改判；playbook 定稿。
- 知识层 HTTP 读面/前端呈现随 88 第一波接入；教练循环（四阶段）依赖 88 工作台。
- L2 默认源白名单（方案 §13 开放问题 4）与数据入库路由（DB 目前为独立 ensure 面，未接 petri-server 路由层）。
