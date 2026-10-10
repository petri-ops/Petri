# BLOCK-11: bioSkills 生态集成计划（v0.2 · PHASE 0 整合后）

> Plan ID: `BLOCK-11-BIOSKILLS-INTEGRATION`
> Kind: Work Package · 整合 superset（v0.1 → v0.2）
> Status: **DRAFT v0.2** — awaiting user explicit ruling to promote to active
> Canonical entrypoint: `docs/block-11-bioSkills-integration-plan.md`
> Truth Domain: `block-11-bioSkills-integration`
> Archive Policy: `retain_stable_path`
> Last Updated: 2026-08-18
> Supersedes: `agent-tools/block-11-bioSkills-integration-plan-v0.1.md`

---

## §0 用户裁决（未决）

**必须用户显式裁决后启动 PHASE 1 实施。**

用户已表达意图：将 [GPTomics/bioSkills.git](https://github.com/GPTomics/bioSkills) 生态接入 Petri Desktop Skills 系统。

**当前 active 工作包**：`BLOCK-11-BIOSKILLS-INTEGRATION`（PHASE 0 已收口，待 PHASE 1 启动）；
同会话最近还收口过 `BLOCK-11-PRELOAD-SANDBOX-FIX`（单 commit 修复）、BLOCK-2/3/9/9.1/9.2/10 系列均已 `completed`。

**单工作包串行纪律**：同一时间只有一个 active 工作包。本计划 v0.2 不在用户未裁决前启动 PHASE 1 实施；用户在以下选项中裁决：

- **选项 A**：暂停其他遗留 block，启动 BLOCK-11 PHASE 1（single-cell）
- **选项 B**：BLOCK-11 PHASE 1 等 BLOCK-10-ARCHITECTURE（PHASE 0 已收口、待 PHASE 1）先启动后再排队
- **选项 C**：两包并行（需说明理由，违反单工作包串行纪律）

> 协调 worker 标注：本协调任务只产 v0.2 + 批次计划 + 汇总报告，**不实施 PHASE 1 真实插件代码改动**。PHASE 1 启动由用户裁决后由主 agent 推进。

---

## §0.5 PHASE 0 关键结论速览（来自三份调研报告）

来源：
- `docs/block-11-bioSkills-gap-matrix.md`（worker A）
- `docs/block-11-bioSkills-runtime-inventory.md`（worker B）
- `docs/block-11-bioSkills-implementation-patterns.md`（worker C）

> 注：以下 §0.5 列出的是**关键结论摘要**（依 AGENTS.md "治理门禁只写出必要分支 + 不外推 G1+ 事项"），非重复 worker 报告原文。

### §0.5.1 规模修正

| 项 | v0.1 声称 | PHASE 0 实测 |
|----|---------|------------|
| bioSkills category 数 | 32 | **60 domain + 41 workflow = 101** |
| SKILL.md 数 | ~170 | **562** |
| Petri skill 数 | 2 | 2（未变） |
| Petri 真分析 plugin 数 | 未列 | **10**（含 figcode 卡片 19 项 + runtime 2 + figcode-data 1 = 32 manifest entries；其中真分析 10） |

### §0.5.2 覆盖率基线

- skill 覆盖率：**2 / 60 = 3.3%**
- plugin 真分析覆盖率：**10 / 60 ≈ 17%**
- 目标（v0.2 修订）：覆盖 ~49 / 60（~82%）covered + partial 后停手（PHASE 1-5 完成即可达成主体）

### §0.5.3 已就位 runtime 依赖（PHASE 1 直接复用）

| Runtime | 已装核心包 | 已覆盖 BLOCK-11 类别 |
|---------|----------|-------------------|
| petri-py-runtime | scanpy / squidpy / scvelo / liana / xgboost / shap / anndata + 9 项基础包 | **single-cell**（scanpy 已就位，squidpy/scvelo 经 figcode-* artifact 已就位） |
| petri-r-runtime | Seurat / clusterProfiler / enrichplot / DOSE / msigdbr / monocle3 / scDblFinder / CytoTRACE + 20+ 包 | **single-cell**（Seurat）/ **pathway-analysis**（clusterProfiler/enrichplot/msigdbr，已实质 covered） |

### §0.5.4 缺口（PHASE 1-5 启动前 runtime 扩展需求）

| Phase | 主要缺口 | 风险等级 |
|-------|---------|---------|
| PHASE 1 single-cell | 核心已就位；可选 pertpy / cassiopeia | 低（**pertpy / cassiopeia 已确认 deferred-to-v2**，不阻塞 v1 PHASE 1） |
| PHASE 2 variant-calling | 全栈空白（生物信息 runtime 不含），CLI 二进制 + JVM | 中-高（决策：PHASE 2 启动时新建独立子集，不污染 py-runtime；具体方案留给 PHASE 2 启动时决定） |
| PHASE 3 pathway + methylation | pathway 已 covered；methylation 全 Bioconductor R 增量 | 低（pathway 实质 covered，PHASE 3 应调整为"methylation-only 或关闭 pathway 重定向 PHASE 6+"） |
| PHASE 4 rna-quantification | salmon / kallisto CLI + tximport R | 中（二进制 + decoy index artifact） |
| PHASE 5 alignment-files | samtools CLI + pysam wrapper（pysam 已在 py-runtime） | 低（仅 plugin manifest + run.sh） |

### §0.5.5 实现模式结论（来自 worker C）

- **plugin 八件套**：`plugin.json` + `environment.json` + `tool-definition.json` + `scripts/<id>.R|.py` + `acceptance.json` + `README.md` + `demo-data/` + `<id>-report-template.html`；Result Studio class 加 `golden-revisions/result-studio-v1.json`
- **R 脚本三件套**：`commandArgs[1] <- jobDir`、`source(jobDir/_petri-theme.R)`、`fromJSON(file.path(jobDir,"params.json"))`；缺一会让 SCI 主题、param 输入、deterministic PNG 三件事塌方
- **PNG hash 稳定**：用 `png::writePNG(png::readPNG(f), f)` 末尾重写以稳定 Result Studio hash
- **skill 引用 plugin 必须用 plugin id**（非裸 R 包名）；capability 可走 `r-enrichment` 等 bundle 名
- **`acceptance.json` 至少 3 fixture**：`valid` + `missing-inputs (blocked)` + `runtime-not-ready (skipOnSupportedPlatform:true)`；enrichment 类另加 `empty-result`

### §0.5.6 已存可复用的 Seurat 工具步骤 0（PHASE 1 直接调用）

- `core/petri-server/tool-scripts/seurat-standard.R` + `_seurat-standard-scope.md`（已存在）
- 提供给 PHASE 1 single-cell R 侧 `seurat` / `seurat-advanced` plugin 的最小脚本骨架基础（复用而非重写）

---

## §0.6 G0 阶段纪律约束（写入 v0.2 · AGENTS.md 最高优先级）

- **本计划不外推 G1+ 阶段事项**：`packaged Electron` 公证/签名、`Provider` 矩阵、`OSS` 远程分发、`GA` 公证流水线、`dist staleness` 等都不在 PHASE 1-5 范围
- **`qualificationEligible: false` 是 G0 开发期常态**，不写入 closeout 笔录为"待办"或"未做"
- **dev Electron 边界内 verified / packaged 边界内 verified = 当前最高证据等级**，PHASE 1 收口用语遵守此约束
- **plugin/skill 实现**仅写到"离线可执行 + manifest schema 校验 + workflow-engine discovery"为止，**不**触发：
  - packaged artifact zip 构建
  - 公证 / 签名流水
  - MCP Server 把新 plugin 暴露为工具（skill-runtime 层已足够，MCP 暴露属 G1+）
- PHASE 1 实施如需扩展 runtime（py / r artifact），仅做**方案 / 评估 / 文档**决策，不在本工作包内做构建 + 上传 OSS + 翻新 manifest sha256

---

## §1 背景与目标（v0.2 修订）

### 1.1 bioSkills.git 是什么（v0.2 修正）

GPTomics/bioSkills（已 **archived**，仅作为内容参考）的**生信 Prompt 指南库**：
- 真实规模：**60 domain categories + 41 workflow pipelines = 101 一级目录**，**562 个 SKILL.md**
- 仓库 README 头行明文："archived, no longer updates or code fixes"
- **不是**：可执行代码 / Plugin / Workflow Engine
- SKILL.md 标准结构：YAML frontmatter（name / description / tool_type / primary_tool / workflow + depends_on + qc_checkpoints）+ Markdown body（Version Compatibility → Governing Principle → Decision Tree / Failure Modes → Code examples → References → Related Skills）
- 评估报告：`resources/bioskills_eval_20260328.pdf`（Bio-Task Bench 评估）

### 1.2 Petri Desktop Skills 是什么

- Petri Skills 是**可执行工作流引擎**：JSON manifest + DAG Workflow + Plugin 执行器 + Recovery 策略
- 当前 **2 个** built-in 生信 Skill（`deg-analysis-standard` / `go-enrichment-analysis`）
- 真分析 Plugin **10 个**（deseq2 / volcano-plot / expression-qc / gene-correlation / pca-explorer / deg-standardizer / sample-metadata-validator / go-kegg / gsea / wgcna）
- figcode 卡片 19 项（含 spatial / sc trajectory / doublet / CytoTRACE / QQ / Manhattan / Power-curve / meta-forest 等）
- runtime：2 项（petri-py-runtime v1.0.0 / petri-r-runtime v1.0.0）+ 1 项 figcode-data（BSgenome hg19）
- 生态覆盖率（v0.2 重算）：skill **3.3%** / 真分析 plugin **~17%** / 总 manifest entry 覆盖 bioSkills **~13 个 categories（含 partial）**

### 1.3 目标（v0.2 修订）

将 bioSkills 的**内容领域**映射为 Petri Skills 的**可执行生态**：

- 主体目标（PHASE 1-5 完成）：覆盖 **49 / 60 categories = ~82% covered + partial**
- plugin 总数（v0.2 重新估算）：达成主体后预计新增 ~13-18 个**真分析 plugin**（外加若干 figcode-card 增量）
- skill 总数：达成主体后预计新增 ~7-8 个 skill（block 内合计 9-10 个）

### 1.4 反目标（v0.2 不做，与 v0.1 一致）

- ❌ marketplace 真实后端
- ❌ packaged artifact 构建 + 公证 + 签名
- ❌ Provider 矩阵 / OSS 远程分发
- ❌ GA 公证流水线
- ❌ MCP Server 把新 plugin 暴露为工具
- ❌ 把 bioSkills SKILL.md 的 Prompt 文本逐字翻译进 Petri skill.json
- ❌ 60 个 category 全部实现（PHASE 6+ 长期规划）
- ❌ 修改 SKILL.md 上游（仓库已 archive）

---

## §2 范围与边界（v0.2）

### 2.1 In Scope（PHASE 1-5）

- [ ] 制定 PHASE 1 详细批次计划（`docs/block-11-phase-1-batch-plan.md`）
- [ ] 实现 Top 5 优先级 categories（v0.2 修订后）的 plugin + skill.json
- [ ] 验证 workflow-engine 调度新 plugin
- [ ] 更新 `resources/built-in-plugins/manifest.json` + `resources/skills/manifest.json`
- [ ] 4 治理门禁 GREEN（docs:check / tsc / ui:audit:check / docs:reconcile）
- [ ] **新增**：runtime 扩展决策（PHASE 2 启动时新建 `petri-variant-tools` 子集等）
- [ ] **新增**："skill.json → plugin 选型矩阵"文档（基于本计划 §4 + worker A §6）

### 2.2 Out of Scope（v0.2 强化边界）

G1+ 阶段事项一律 **不外推**（按 AGENTS.md §"当前阶段纪律"）：
- ❌ packaged artifact 公证 / 签名 / Provider 矩阵 / OSS 远程 / GA / dist staleness
- ❌ MCP Server 暴露新 plugin 为工具
- ❌ 完整 marketplace 后端
- ❌ 60 categories 全部实现（PHASE 6+ 后续）
- ❌ bioSkills SKILL.md 文本搬迁

### 2.3 验收证据（v0.2 与原计划一致）

- `resources/built-in-plugins/{plugin-id}/plugin.json` 存在且通过 schema 校验
- `resources/skills/{skill-id}/skill.json` 存在且通过 `skill-schema.js` 校验
- `skill-registry.js discover()` 能发现所有新 plugin/skill
- `workflow-engine.js` 能实例化新 plugin 并执行
- 4 治理门禁 GREEN

---

## §3 优先级路线图（v0.2 修订）

依据 worker A 的 `petri 空白度 × 用户频度 × 实现难度` 综合重评分，**Top 5 调整如下**：

### 🟢 Phase 1 — P0 Top 5（v0.2 修订）

| Rank | Priority | Category | SKILL.md | Petri 现状 | 评分 | Plugin ID | Skill ID |
|------|---------|---------|---------|-----------|------|-----------|----------|
| 1 | **P0** | single-cell | 17 | scanpy ✅ / squidpy ✅ / Seurat ✅（已就位），缺 integrated pipeline | **95** | `scanpy-advanced`, `seurat`, `celltypist`, `cellchat`, `scvi-tools` (5 个) | `sc-analysis-standard` |
| 2 | **P0** | variant-calling | 13 | **完全空白** | **92** | `deepvariant`, `bcftools`, `clair3` (3 个) | `variant-analysis-standard` |
| 3 | **P1** | methylation-analysis | 10 | **完全空白** | **84** | `methylkit`, `bsseq` (2 个) | `methylation-analysis-standard` |
| 4 | **P2** | rna-quantification | 4 | **完全空白** | **78** | `salmon`, `kallisto`, `featurecounts` (3 个) | `rna-quantification-standard` |
| 5 | **P2** | alignment-files | 10 | **完全空白**（runtime 有 pysam 但未包装） | **76** | `samtools-wrapper`, `pysam-wrapper` (2 个) | `alignment-files-standard` |

### 变化对比（v0.1 → v0.2）

| Rank | v0.1 | v0.2 | 变化原因 |
|------|------|------|---------|
| 1 | single-cell (P0, 95) | single-cell (P0, 95) | 不变 |
| 2 | variant-calling (P0, 92) | variant-calling (P0, 92) | 不变 |
| 3 | pathway-analysis (P1, 85) | **methylation-analysis (P1, 84)** | pathway-analysis 实质 covered（go-kegg + gsea + 2 skills）；methylation 是 Petri 真完全空白 |
| 4 | methylation-analysis (P1, 82) | **rna-quantification (P2, 78)** | rna-quantification 上升：DEG 上游必经 + Petri 完全空白 |
| 5 | read-qc (P2, 78) | **alignment-files (P2, 76)** | alignment-files 上升：是 read-qc / variant-calling / rna-quantification 共同上游；read-qc 下调保留 PHASE 6+ |

### 🔶 Phase 2（PHASE 6+ 候选 — 不在 v0.2 范围）

| Priority | Category | 评分 | 候选 Plugin ID |
|---------|---------|------|---------------|
| P2 | read-qc | 74 | fastqc / multiqc |
| P2 | atac-seq | 73 | macs3 / chromVAR |
| P2 | genome-intervals | 71 | bedtools / deeptools |
| P2 | chip-seq | 70 | macs3 / chipseeker |
| P3 | clip-seq | 66 | pureCLIP / peakachu |
| P3 | long-read-sequencing | 65 | dorado / clair3 |
| P3 | spatial-transcriptomics | 64 | Visium/Xenium ingest |

### 🔴 Phase 3（PHASE 7+ 候选 — 47 个剩余 gap）

> 不在 v0.2 范围。计入 `docs/bioSkills-ecosystem-roadmap.md`（长期规划）。

---

## §4 实施方法（v0.2 与 worker C 调研对齐）

### 4.1 Plugin 实现八件套

```
resources/built-in-plugins/{plugin-id}/
├── README.md
├── acceptance.json             # 至少 3 fixture：valid + missing-inputs + runtime-not-ready
├── demo-data/<fixture>.*       # 至少 1 个 demo
├── golden-revisions/result-studio-v1.json   # 进 Result Studio 看板时才需要
├── <id>-report-template.html
├── environment.json            # 依赖包声明（r/python version ranges）
├── plugin.json                 # 8 字段（id/status/version/title/language/description/packages/runtime/builtAgainst/platform）
├── scripts/<id>.R | .py        # 三件套：commandArgs / _petri-theme.R / params.json
└── tool-definition.json        # inputs/outputs/failureModes/tutorialUrl/demoDataUrl/estimatedMinutes/resultStudio
```

并在顶层 `resources/built-in-plugins/manifest.json` 新增 entry（含 `artifacts.macos-arm64.url = "built-in://<id>"`）。

### 4.2 Skill 实现模式

```
resources/skills/{skill-id}/
├── README.md
├── manifest.json               # skillManifestVersion=1 + 顶层索引
├── skill.json                  # 14 字段（id/version/name/description/category/capabilities/plugins/workflows/prompts/parameters/recovery_strategies/outputs/metadata 等）
└── prompts/
    ├── system.md              # 优先相对路径而非内联
    └── user/standard-<id>.md
```

并在顶层 `resources/skills/manifest.json` 新增 entry。

### 4.3 bioSkills SKILL.md → Petri skill.json 转换规则

| bioSkills 字段 | Petri skill.json 字段 |
|---------------|----------------------|
| `Use when...` | `description`（直接复用） |
| `Quick Start` | `prompts.system`（提炼为系统 prompt） |
| `Example Prompts` | `prompts.user_templates` |
| `Version Compatibility` | `metadata.compatibility` |
| `Category` | `category`（格式：`bioinformatics/<subdomain>`） |
| 工具列表 | `plugins.required`（**必须用 plugin id，非裸 R 包名**） |
| 核心流程 | `workflows.default` + `workflows.variants[]` |

### 4.4 关键原则

1. **Plugin first, Skill second**：先实现 plugin 可执行，再包装 skill
2. **Minimize new plugin id**：复用现有 plugin（如 scanpy 已有，补 `scanpy-advanced` 而非新建）
3. **Version compatibility 保守**：bioSkills 要求普遍宽松，Petri 取交集
4. **No MCP exposure in this package**：只到 skill-runtime 层
5. **Offline-verified only**：不跑 packaged / Provider / G1+ 验证
6. **runtime 扩展最小化**：能复用的不重建（PHASE 2 决策见 §4.5）

### 4.5 PHASE 2-4 启动前 runtime 扩展决策（v0.2 新增）

| Phase | 决策 | 实施方案 |
|-------|------|---------|
| PHASE 1 single-cell | **不扩展 runtime** | 复用 petri-py-runtime + petri-r-runtime 已就位包；`scanpy-advanced` / `seurat` / `celltypist` / `cellchat` / `scvi-tools` 全部走 py / r runtime |
| PHASE 1 (可选) | **pertpy / cassiopeia deferred-to-v2** | 不纳入 PHASE 1 范围；记录到 "PHASE 1 → v2 deferred" 列表 |
| PHASE 2 variant-calling | 新建 `petri-variant-tools` 子集 | CLI 类工具不污染 py-runtime；启动 PHASE 2 时单独决策 |
| PHASE 3 methylation | 在 petri-r-runtime 增量加 methylKit / bsseq / minfi / ChAMP | Bioconductor R 包，估计 50-80MB 增量 |
| PHASE 4 rna-quantification | 新建 `petri-quant-tools` 子集 | 含 salmon / kallisto / featurecounts + decoy-aware index artifact |
| PHASE 5 alignment-files | 在 petri-py-runtime 增量加 pysam wrapper | pysam 已装，只需 plugin manifest + run.sh |

---

## §5 实施 PHASE（v0.2 修订 · 与 worker A 报告 §10.2 对齐）

### PHASE 0（已完成 · BLOCK-11-BIOSKILLS-INTEGRATION 当前状态）

- [x] 调研 bioSkills.git → 60 domain + 41 workflow = 101 categories / 562 SKILL.md（**v0.1 估算 32/~170 偏差 3.2×**，已修正）
- [x] 逐一对照 Petri 现有 plugin（deseq2 / go-kegg / gsea / scanpy / squidpy / deseq2 / volcano-plot / expression-qc 等）
- [x] 评估 Top 5 技术可行性（runtime 已装包 vs 需新增）
- [x] 写出三份调研报告：
  - `docs/block-11-bioSkills-gap-matrix.md`（worker A）
  - `docs/block-11-bioSkills-runtime-inventory.md`（worker B）
  - `docs/block-11-bioSkills-implementation-patterns.md`（worker C）
- [x] v0.2 计划整合（本文件）

### PHASE 1（**待启动** · single-cell P0）

详见 `docs/block-11-phase-1-batch-plan.md`。本批次交付：
- 5 个 P0 single-cell 真分析 plugin（plugin id 见 §3 Rank 1）
- 1 个 skill：`sc-analysis-standard`
- 更新 `resources/built-in-plugins/manifest.json` + `resources/skills/manifest.json`
- 4 治理门禁 GREEN

**批次纪律**：
- pertpy / cassiopeia 标注为 **deferred-to-v2**（不纳入 PHASE 1）
- 现有 `seurat-standard.R` 工具脚本（`core/petri-server/tool-scripts/`）可直接复用为 `seurat` plugin 骨架

### PHASE 2（**待启动** · variant-calling P0）

- 3 个 plugin：`deepvariant` + `bcftools` + `clair3`
- 1 个 skill：`variant-analysis-standard`
- 启动前决策：是否使用 GATK？v0.2 不预设（按 PHASE 2 启动时的具体方案决定）

> v0.2 不外推 G1+ 阶段事项：PHASE 2 不动 packaged / 公证 / Provider / GA。

### PHASE 3（**待启动** · methylation-analysis P1）

v0.2 替换 v0.1 §5 PHASE 3：原计划"pathway + methylation"调整为 **methylation-only**：
- 2 个 plugin：`methylkit` + `bsseq`
- 1 个 skill：`methylation-analysis-standard`
- 路径：pathway-analysis 实质 covered（go-kegg + gsea + 2 skills）；继续投入属于 P3+ 候选，不阻塞 Top 5

### PHASE 4（**待启动** · rna-quantification P2）

- 3 个 plugin：`salmon` + `kallisto` + `featurecounts`
- 1 个 skill：`rna-quantification-standard`

### PHASE 5（**待启动** · alignment-files P2 + 收口）

- 2 个 plugin：`samtools-wrapper` + `pysam-wrapper`
- 1 个 skill：`alignment-files-standard`
- 4 治理门禁 + 文档收口（按 AGENTS.md "完成语义"）

### PHASE 6+（**不在 v0.2 范围**）

读 qc / atac-seq / chip-seq / clip-seq / long-read / spatial-pipeline / database-access 等 47 个剩余 gap category，统一入 `docs/bioSkills-ecosystem-roadmap.md`（不在本计划创建）。

---

## §6 依赖（v0.2）

- ✅ `core/shared-backend/skill-schema.js`（skill manifest 校验）
- ✅ `core/shared-backend/skill-registry.js`（registry discover）
- ✅ `core/shared-backend/workflow-engine.js`（workflow 执行）
- ✅ `core/shared-backend/skill-runtime.js`（skill → plugin 调度）
- ✅ `resources/built-in-plugins/manifest.schema.json`（plugin manifest schema）
- ✅ `petri-py-runtime` v1.0.0（10 个核心包 + figcode 卡片artifact：scanpy/squidpy/scvelo/xgboost/shap/liana）
- ✅ `petri-r-runtime` v1.0.0（26 个核心包 + Bioconductor 间接至 70+：Seurat/clusterProfiler/enrichplot/DOSE/msigdbr + figcode artifact：monocle3/scDblFinder/CytoTRACE）
- ✅ PHASE 1 可复用 `core/petri-server/tool-scripts/seurat-standard.R` + `_seurat-standard-scope.md`
- ⚠️ PHASE 2-5 启动前需评估 runtime 增量决策（见 §4.5）

---

## §7 风险（v0.2）

| Risk | Severity | Mitigation |
|------|----------|------------|
| **PHASE 2 variant-calling 是否用 GATK** | High | v0.2 不外推到具体方案；PHASE 2 启动时由主 agent 决策（默认走 bcftools + DeepVariant + Clair3 开源组合） |
| **runtime 体积膨胀**（petri-r-runtime 557MB → 700MB+ 若 PHASE 3 加甲基化包） | Medium | PHASE 3 决策时考虑拆 `petri-methylation-runtime` 子集 |
| **seurat 启动慢（GB 级内存）** | Medium | acceptance.json 加 memory threshold；scanpy 路径作为快速替代 |
| **bioSkills SKILL.md 内容质量参差** | Low | 只映射技术领域，skill.json 不复制 Prompt 文本 |
| **BLOCK-10-ARCHITECTURE / 其他 block 并行冲突** | High | 单工作包串行纪律：用户未裁决前 PHASE 1 不启动 |
| **PHASE 0.5 决策延迟导致批次模糊** | Low | 本协调任务已把 PHASE 1 详细批次写到 `docs/block-11-phase-1-batch-plan.md` |
| **GATK / OSS / Provider 类 G1+ 阶段误启动** | High | AGENTS.md §"当前阶段纪律"硬约束；本计划已标注 §0.6 显式排除 |

---

## §8 完成语义（v0.2 与原计划一致）

BLOCK-11 PHASE 1-5 完成 = 以下全部为真：

- Top 5 categories 的 plugin.json 全部通过 `resources/built-in-plugins/manifest.schema.json` 校验
- Top 5 categories 的 skill.json 全部通过 `core/shared-backend/skill-schema.js` 校验
- `skill-registry.js discover()` 输出包含所有新增 plugin/skill
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（无 UI 改动时继承基线）
- `npm run docs:reconcile` 0 issues
- TypeScript 0 errors（前端相关改动时）
- 文档更新：`resources/skills/manifest.json` + `resources/built-in-plugins/manifest.json` 更新 + `docs/bioSkills-ecosystem-roadmap.md`（PHASE 6+ 长期规划）+ `docs/block-11-bioSkills-integration-closeout.md`

---

## §9 文档清单

| Document | Kind | Status | Path |
|----------|------|--------|------|
| BLOCK-11 bioSkills Integration Plan v1.0 | work-package | active | `docs/block-11-bioSkills-integration-plan-v1.0.md` |
| BLOCK-11 bioSkills Integration Plan v0.2 | work-package (superset) | **DRAFT** | `agent-tools/block-11-bioSkills-integration-plan-v0.2.md` |
| PHASE 1 批次计划 | batch | **DRAFT** | `docs/block-11-phase-1-batch-plan.md` |
| bioSkills Gap Matrix | reference | completed | `docs/block-11-bioSkills-gap-matrix.md` |
| petri Runtime 包清单 | reference | completed | `docs/block-11-bioSkills-runtime-inventory.md` |
| Plugin/Skill 实现模式 | reference | completed | `docs/block-11-bioSkills-implementation-patterns.md` |
| bioSkills Ecosystem Roadmap (PHASE 6+) | reference | pending | `docs/bioSkills-ecosystem-roadmap.md` |
| BLOCK-11 Closeout | closeout | pending | `docs/block-11-bioSkills-integration-closeout.md` |

---

## §10 参考

- [GPTomics/bioSkills.git](https://github.com/GPTomics/bioSkills)（source, archived）
- bioSkills clone 路径（PHASE 0 调研用）：`/tmp/bioSkills`（depth=1）
- bioSkills 评估：`resources/bioskills_eval_20260328.pdf`
- `core/shared-backend/skill-schema.js`
- `core/shared-backend/skill-registry.js`
- `core/shared-backend/workflow-engine.js`
- `resources/built-in-plugins/manifest.schema.json`
- `resources/skills/deg-analysis-standard/skill.json`（skill 参考实现）
- `resources/built-in-plugins/deseq2/plugin.json`（plugin 参考实现）
- `resources/built-in-plugins/go-kegg/plugin.json`（enrichment 类参考）
- `core/petri-server/tool-scripts/seurat-standard.R` + `_seurat-standard-scope.md`（PHASE 1 直接复用）

---

## 附录 A · v0.2 vs v0.1 关键差异

1. **规模数字修正**：bioSkills 32/~170 → 101/562（3.2×-3.3× 偏差）
2. **Top 5 顺序调整**：pathway-analysis P1 → P3 候选；methylation 进入 Rank 3；rna-quantification 进入 Rank 4；alignment-files 进入 Rank 5
3. **覆盖目标重写**：3% → 80%（32 中 26）→ **3.3% → 82%（49/60 covered+partial）**
4. **PHASE 数量调整**：原计划 5 PHASE（含 read-qc）→ v0.2 PHASE 1-5 single-cell / variant / methylation / rna-quant / alignment-files（read-qc 推迟 PHASE 6+）
5. **§0.5 PHASE 0 结论摘要**：首次把 worker B "runtime 扩展需求"作为正式决策挂入计划
6. **§4.5 runtime 扩展决策**：PHASE 2 新建 variant-tools 子集 / PHASE 3 增量 methylKit-bsseq / PHASE 4 新建 quant-tools / PHASE 5 增量 pysam
7. **§0.6 G0 阶段纪律显式约束**：明确不外推 packaged / Provider / GA / MCP expose

---

**v0.2 生成时间**：2026-08-18
**生成者**：BLOCK-11 PHASE 1 协调 worker
**约束**：仅产出计划 + 批次计划 + 门禁报告，不实施 PHASE 1 真代码改动
