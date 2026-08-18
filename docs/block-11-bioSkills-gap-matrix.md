# BLOCK-11: bioSkills Gap Matrix

> Plan ID: `BLOCK-11-BIOSKILLS-INTEGRATION`
> Phase: **PHASE 0 调研**
> Status: completed
> Last Updated: 2026-08-18
> Source data:
> - bioSkills clone: `/tmp/bioSkills` (depth=1)
> - BioF3 manifests: `resources/built-in-plugins/manifest.json`, `resources/skills/manifest.json`

---

## §1 TL;DR

- bioSkills 仓库**真实规模**: **60 个生信 domain categories + 41 个跨领域 workflow pipelines = 101 个一级目录**，**562 个 SKILL.md**。BLOCK-11 plan v0.1 写的 "32 categories / ~170 SKILL.md" 是过期估计，需要按 101 categories 重新规划范围。
- bioSkills 仓库本身**已被 archive**（README 头行明文），后续不会有官方更新与 bug 修复，集成时只能 fork + 内部维护。
- BioF3 现状真实数字: **2 个 Skill** + **10 个真分析插件**（非 runtime、非 figcode-card、非 data）+ **19 个 figcode-card** + **2 个 runtime** + **1 个 figcode-data** = 32 个 manifest plugin entries，但仅覆盖 bioSkills **~13 个 categories**（含 partial / covered）。
- **完全 gap 的 categories: 47 个**（占 60 domain categories 的 ~78%）。
- **新 Top 5（已重新评分）**:
  1. **single-cell** (P0, 95) — 17 个 SKILL.md，BioF3 只有 4 个 FigCode 卡片，缺 integrated pipeline
  2. **variant-calling** (P0, 92) — 13 个 SKILL.md，BioF3 只有 2 个 FigCode 卡片，缺 base calling
  3. **methylation-analysis** (P1, 84) — 10 个 SKILL.md，BioF3 **完全空白**（gap）
  4. **rna-quantification** (P2, 78) — 4 个 SKILL.md，缺 salmon/kallisto/featurecounts
  5. **alignment-files** (P2, 76) — 10 个 SKILL.md，缺 samtools/pysam base plugin
- 重大调整: 原 plan Top 5 中的 **pathway-analysis** 已**实质覆盖**（go-kegg + gsea + deg-analysis-standard + go-enrichment-analysis），从 P1 降到 **P3 候选**（次轮可补 reactomepa / msigdbr 升级）；**read-qc** 保留 P2 但评分下调。

---

## §2 bioSkills 仓库结构

### 2.1 总览

| 项 | 数量 |
|----|------|
| 顶层 domain categories | **60** |
| 顶层 workflow pipelines | **41** |
| 一级目录合计（domain + workflow） | **101** |
| 顶层 SKILL.md 总数（`find -name SKILL.md`） | **562** |
| 顶层 domain SKILL.md | ~520 |
| 顶层 workflow SKILL.md | 41 |
| 顶层 `clawhub-installer/SKILL.md` | 1 |
| 仓库状态 | **archived**（"no longer updates or code fixes"） |
| 评估报告 | `resources/bioskills_eval_20260328.pdf`（Bio-Task Bench 评估） |

### 2.2 仓库组织方式

```
bioSkills/
├── <category>/                    # 60 个 domain categories
│   └── <skill-name>/              # 每个 category 下多个 SKILL.md
│       └── SKILL.md               # YAML frontmatter + Markdown body
├── workflows/                     # 41 个端到端 pipeline SKILL.md
│   └── <pipeline-name>/
│       ├── SKILL.md
│       └── examples/
├── resources/                     # 评估报告、benchmark 图、CLAUDE.md 模板
├── install-{claude,codex,openclaw,opencode,antigravity,common}.sh
├── skill_writing_reference.md     # SKILL.md 写作规范
├── CONTRIBUTING.md / README.md / LICENSE
└── clawhub-installer/             # 安装脚本说明（1 个 SKILL.md）
```

每个 SKILL.md 标准结构：
- YAML frontmatter: `name`、`description`（含 "Use when..." 触发器）、`tool_type`、`primary_tool`；workflow skills 额外有 `workflow: true` + `depends_on` + `qc_checkpoints`
- Markdown body: Version Compatibility → Governing Principle → Decision Tree / Failure Modes → Code examples → References → Related Skills

### 2.3 真实数字 vs plan v0.1 数字

| 项 | plan v0.1 声称 | 实际测量 | 偏差 |
|----|--------------|----------|------|
| categories | 32 | **60 domain + 41 workflow = 101** | 3.2× |
| SKILL.md | ~170 | **562** | 3.3× |
| 覆盖率假设 | ~3% → ~80% | 待 §6 重新评估 | — |

> **建议**：plan v0.1 §3 的 Top 5 优先级评分基于错误数量基线，本 gap matrix 重新计算。BLOCK-11 plan §3 需在 PHASE 1 启动前修订。

---

## §3 60 Domain Categories 完整清单

按 SKILL.md 数降序排列（domain 部分，workflows 单列 §4）。

| # | Category | SKILL.md | 主题范围（基于前 3 个 SKILL.md description） |
|---|----------|----------|---------------------------------------------|
| 1 | data-visualization | 20 | circos / colormap / dim-reduction / MA / upset / UMAP-tSNE |
| 2 | chemoinformatics | 20 | ADMET / conformer / covalent / virtual screening / docking |
| 3 | single-cell | 17 | batch integration / cell annotation / cell communication / Cassiopeia lineage |
| 4 | crispr-screens | 15 | BAGEL essentiality / base editing / batch correction |
| 5 | database-access | 15 | NCBI batch / BioMart / BLAST / UniProt / Ensembl REST |
| 6 | comparative-genomics | 13 | ancestral reconstruction / annotation projection / gene family evolution |
| 7 | variant-calling | 13 | DeepVariant / clinical interpretation / consensus / joint calling |
| 8 | chip-seq | 12 | allele-specific / deep learning (BPNet) / QC (FRiP NSC/RSC) |
| 9 | clinical-databases | 12 | ACMG classification / ClinVar / dbSNP |
| 10 | clinical-biostatistics | 12 | adaptive design / Bayesian trial / categorical tests |
| 11 | clip-seq | 12 | AGO miRNA targets / binding site / clip alignment |
| 12 | spatial-transcriptomics | 12 | high-res binning / image segmentation / spatial communication |
| 13 | atac-seq | 12 | allele-specific / peak calling (MACS3) / QC |
| 14 | alignment-files | 10 | ampliconclip / filtering / indexing / samtools |
| 15 | methylation-analysis | 10 | array preprocessing / QC / Bismark / methylKit |
| 16 | structural-biology | 10 | AlphaFold / binding site / geometric analysis |
| 17 | causal-genomics | 11 | colocalization / effector gene / fine-mapping |
| 18 | copy-number | 11 | allele-specific / CNV annotation / CNV visualization |
| 19 | flow-cytometry | 8 | bead normalization / clustering / compensation / phenotyping |
| 20 | metagenomics | 8 | abundance / AMR / contamination / Kraken2 |
| 21 | genome-intervals | 8 | BED basics / bedGraph / bigWig |
| 22 | phylogenetics | 8 | Bayesian / distance / divergence dating |
| 23 | hi-c-analysis | 9 | compartment / contact pairs / Hi-C data I/O |
| 24 | proteomics | 9 | DIA-NN / data import / differential abundance |
| 25 | metabolomics | 9 | isotope tracing / lipidomics / metabolite annotation |
| 26 | sequence-io | 9 | batch processing / compressed / FASTQ quality |
| 27 | long-read-sequencing | 9 | basecalling / Clair3 / haplotype phasing |
| 28 | genome-assembly | 9 | polishing / QC / contamination |
| 29 | alternative-splicing | 9 | rMATS / isoform switching / long-read splicing |
| 30 | alignment | 7 | MSA I/O / trimming / MSA parsing |
| 31 | read-qc | 7 | adapter trim / contamination / fastp workflow |
| 32 | genome-annotation | 7 | QC (BUSCO) / annotation transfer / gene prediction |
| 33 | liquid-biopsy | 7 | analytical validation / cfDNA preprocessing / ctDNA detection |
| 34 | population-genetics | 7 | GWAS / LD / PLINK |
| 35 | sequence-manipulation | 7 | codon usage / motif / reverse complement |
| 36 | imaging-mass-cytometry | 7 | cell segmentation / preprocessing / differential |
| 37 | systems-biology | 7 | community modeling / context-specific / FBA |
| 38 | differential-expression | 6 | batch correction / DE results / visualization |
| 39 | ecological-genomics | 6 | biodiversity / community / conservation genetics |
| 40 | gene-regulatory-networks | 6 | coexpression / differential / GRN inference |
| 41 | machine-learning | 6 | atlas mapping / biomarker / model validation |
| 42 | microbiome | 6 | amplicon / differential abundance / diversity |
| 43 | pathway-analysis | 6 | enrichment viz / GO / GSEA |
| 44 | immunoinformatics | 6 | epitope / immunogenicity / MHC binding |
| 45 | small-rna-seq | 6 | miRNA differential / miRDeep2 / miRge3 |
| 46 | ribo-seq | 6 | initiation site / ORF detection / Ribo-seq preprocessing |
| 47 | tcr-bcr-analysis | 6 | Immcantation / MiXCR / repertoire viz |
| 48 | temporal-genomics | 6 | circadian / differential rhythmicity / periodicity |
| 49 | reporting | 6 | automated QC (MultiQC) / figure export / Jupyter (papermill) |
| 50 | restriction-analysis | 5 | enzyme selection / fragment / Golden Gate |
| 51 | multi-omics-integration | 5 | harmonization / integration design / mixOmics |
| 52 | workflow-management | 5 | CWL / Nextflow / nf-core |
| 53 | experimental-design | 5 | batch design / multiple testing / power |
| 54 | expression-matrix | 5 | counts ingest / gene-id mapping / metadata joins |
| 55 | epitranscriptomics | 5 | m6A differential / peak / m6Anet |
| 56 | genome-engineering | 5 | base editing / gRNA / HDR template |
| 57 | epidemiological-genomics | 5 | AMR surveillance / pathogen typing / phylodynamics |
| 58 | primer-design | 4 | primer3-py basics / specificity / validation |
| 59 | phasing-imputation | 4 | genotype imputation / haplotype phasing / imputation QC |
| 60 | rna-structure | 4 | covariation / ncRNA search / secondary structure |
| 61 | rna-quantification | 4 | alignment-free (Salmon/kallisto) / count matrix QC / featureCounts |
| 62 | read-alignment | 4 | bowtie2 / bwa / hisat2 |

> 注：上表按 SKILL.md 数降序排列；最后 5 个（primer-design / phasing-imputation / rna-structure / rna-quantification / read-alignment）均为 4 个 SKILL.md。category 数实际 60（不含 workflows）。

---

## §4 Workflows（41 跨域 pipelines）

`/tmp/bioSkills/workflows/` 下 41 个端到端 pipeline，每个有 `SKILL.md`（`workflow: true`）+ `examples/` + `usage-guide.md`。

```
workflows/atacseq-pipeline            workflows/metagenomics-pipeline
workflows/biomarker-pipeline          workflows/methylation-pipeline
workflows/causal-genomics-pipeline    workflows/microbiome-pipeline
workflows/chipseq-pipeline            workflows/multi-omics-pipeline
workflows/clinical-trial-pipeline     workflows/multiome-pipeline
workflows/clip-pipeline               workflows/neoantigen-pipeline
workflows/cnv-pipeline                workflows/outbreak-pipeline
workflows/crispr-editing-pipeline     workflows/proteomics-pipeline
workflows/crispr-screen-pipeline      workflows/riboseq-pipeline
workflows/cytometry-pipeline          workflows/rnaseq-to-de
workflows/edna-pipeline               workflows/scrnaseq-pipeline
workflows/expression-to-pathways      workflows/smrna-pipeline
workflows/fastq-to-variants           workflows/somatic-variant-pipeline
workflows/genome-annotation-pipeline  workflows/spatial-pipeline
workflows/genome-assembly-pipeline    workflows/splicing-pipeline
workflows/grn-pipeline                workflows/tcr-pipeline
workflows/gwas-pipeline               workflows/timecourse-pipeline
workflows/hic-pipeline
workflows/imc-pipeline
workflows/liquid-biopsy-pipeline
workflows/longread-sv-pipeline
workflows/merip-pipeline
workflows/metabolic-modeling-pipeline
workflows/metabolomics-pipeline
```

> **集成建议**：workflows/ 不直接映射到 BioF3 plugin（BioF3 plugin 是单工具或紧耦合组合），但其 `depends_on` 列表可作为 plugin 选型矩阵参考。例：`metagenomics-pipeline.depends_on = [read-qc/fastp-workflow, metagenomics/contamination-controls, metagenomics/kraken-classification, ...]` → BioF3 想覆盖 metagenomics 需要至少 5 个 plugin。

---

## §5 BioF3 现有 Plugin/Skill 盘点

### 5.1 Plugins（`resources/built-in-plugins/manifest.json`）

| 类型 | Plugin ID | Title | Language | Status |
|------|-----------|-------|----------|--------|
| runtime | `biof3-r-runtime` | R 运行时 | R | — |
| runtime | `biof3-py-runtime` | Python 运行时 | Python | — |
| plugin | `volcano-plot` | 火山图 | R | canonical |
| plugin | `deseq2` | DESeq2 差异分析 | R | canonical |
| plugin | `gene-correlation` | 基因相关性热图 | R | incubating |
| plugin | `pca-explorer` | PCA 可视化 | Python | incubating |
| plugin | `sample-metadata-validator` | 样本元数据校验 | R | incubating |
| plugin | `expression-qc` | 表达矩阵 QC | R | incubating |
| plugin | `deg-standardizer` | DEG 标准化 | R | incubating |
| plugin | `go-kegg` | GO/KEGG 富集 | R | incubating |
| plugin | `gsea` | GSEA 富集 | R | incubating |
| plugin | `wgcna` | WGCNA 共表达网络 | R | incubating |
| figcode-card | `figcode-volcano-animated` | 动画火山图 | R | — |
| figcode-card | `figcode-trajectory-branch` | 单细胞轨迹 | R (monocle3) | — |
| figcode-card | `figcode-sc-doublet` | 双胞检测 | R (scDblFinder) | — |
| figcode-card | `figcode-cytotrace` | CytoTRACE 分化潜能 | R (CytoTRACE) | — |
| figcode-card | `figcode-qq-plot` | QQ 图 | R (qqman) | — |
| figcode-card | `figcode-manhattan` | GWAS 曼哈顿图 | R (qqman) | — |
| figcode-card | `figcode-power-curve` | 功效曲线 | R (pwr) | — |
| figcode-card | `figcode-meta-forest` | 荟萃森林图 | R (metafor) | — |
| figcode-card | `figcode-mut-signature` | 突变签名 | R (BSgenome) | — |
| figcode-card | `figcode-lego-plot` | 突变乐高图 | R (BSgenome) | — |
| figcode-card | `figcode-spatial-cluster` | 空间聚类 | Python (squidpy) | — |
| figcode-card | `figcode-spatial-deconv-c2l` | 空间解卷积 C2L | Python (squidpy) | — |
| figcode-card | `figcode-feature-spatial` | 空间基因表达 | Python (squidpy) | — |
| figcode-card | `figcode-spatial-svg-moran` | 空间 SVG Moran's I | Python (squidpy) | — |
| figcode-card | `figcode-squidpy-neighbors` | 空间邻居网络 | Python (squidpy) | — |
| figcode-card | `figcode-spatial-lr-liana` | 空间 LR 通讯 | Python (squidpy+liana) | — |
| figcode-card | `figcode-scvelo-stream` | RNA velocity 流图 | Python (scvelo) | — |
| figcode-card | `figcode-shap-summary` | SHAP 特征重要性 | Python (xgboost+shap) | — |
| figcode-data | `figcode-data-bsgenome-hg19` | BSgenome hg19 数据包 | R | — |

**Plugin 分类计数**:
- 2 runtime + 10 真分析 plugin + 19 figcode-card + 1 figcode-data = **32 manifest plugin entries**
- 真分析 plugin 数（不计 runtime/figcode）= **10**
- 仅 figcode-card（不下游能直接调度的"真 pipeline"）= **19**

### 5.2 Skills（`resources/skills/manifest.json`）

| Skill ID | Plugins Required | Category | Status |
|----------|------------------|----------|--------|
| `deg-analysis-standard` | `expression-qc`, `deseq2`, `volcano-plot` | bioinformatics/ngs | built-in |
| `go-enrichment-analysis` | `clusterProfiler` (go-kegg + gsea) | bioinformatics/ngs | built-in |

**Skill 真实覆盖**: **2 个 built-in skill**，均与 differential-expression / pathway-analysis 相关。

### 5.3 间接依赖（runtime 内置）

`biof3-py-runtime` description 声明包含：`pandas, numpy, scipy, sklearn, matplotlib, scanpy, anndata, biopython, pysam, pybedtools, pyBigWig, scikit-allel, mygene`。`biof3-r-runtime` 声明：`DESeq2, Bioconductor 3.22, ggplot2, dplyr, data.table, BiocGenerics, clusterProfiler, ...`（70+ R 包）。

> **意义**：BioF3 已"零成本"具备 scanpy + squidpy + biopython + pysam 的 Python 基础，但**未把它们包装为 manifest plugin/skill**，导致用户/Agent 看不到可用入口。

---

## §6 Gap Matrix（bioSkills × BioF3）

按 bioSkills domain categories（60 个）逐项判定，状态定义：
- **covered** = 有对应 plugin + skill 已落地
- **partial** = 有相关 plugin（figcode-card 或下游可视化）或 runtime 内置包但缺 skill/integrated pipeline
- **gap** = 完全空白

| # | Category | BioF3 Plugin | BioF3 Skill | Gap 状态 |
|---|----------|--------------|-------------|----------|
| 1 | alignment | — | — | **gap**（runtime 有 biopython） |
| 2 | alignment-files | — | — | **gap**（runtime 有 pysam） |
| 3 | alternative-splicing | — | — | **gap** |
| 4 | atac-seq | — | — | **gap** |
| 5 | causal-genomics | — | — | **gap** |
| 6 | chemoinformatics | — | — | **gap** |
| 7 | chip-seq | — | — | **gap** |
| 8 | clinical-biostatistics | `figcode-meta-forest` (metafor) | — | **partial** |
| 9 | clinical-databases | — | — | **gap** |
| 10 | clip-seq | — | — | **gap** |
| 11 | comparative-genomics | — | — | **gap** |
| 12 | copy-number | — | — | **gap** |
| 13 | crispr-screens | — | — | **gap** |
| 14 | data-visualization | `pca-explorer`, 多个 figcode-card | — | **partial** |
| 15 | database-access | — (runtime 有 biopython/mygene) | — | **gap** |
| 16 | differential-expression | `deseq2`, `volcano-plot`, `gene-correlation`, `deg-standardizer`, `expression-qc`, `figcode-volcano-animated` | `deg-analysis-standard` | **covered** |
| 17 | ecological-genomics | — | — | **gap** |
| 18 | epidemiological-genomics | — | — | **gap** |
| 19 | epitranscriptomics | — | — | **gap** |
| 20 | experimental-design | `figcode-power-curve` (pwr), `sample-metadata-validator` | — | **partial** |
| 21 | expression-matrix | `expression-qc`, `sample-metadata-validator` | — | **partial** |
| 22 | flow-cytometry | — | — | **gap** |
| 23 | gene-regulatory-networks | `wgcna` | — | **partial** |
| 24 | genome-annotation | — | — | **gap** |
| 25 | genome-assembly | — | — | **gap** |
| 26 | genome-engineering | — | — | **gap** |
| 27 | genome-intervals | — (runtime 有 pybedtools/pyBigWig) | — | **gap** |
| 28 | hi-c-analysis | — | — | **gap** |
| 29 | imaging-mass-cytometry | — | — | **gap** |
| 30 | immunoinformatics | — | — | **gap** |
| 31 | liquid-biopsy | — | — | **gap** |
| 32 | long-read-sequencing | — | — | **gap** |
| 33 | machine-learning | `pca-explorer`, `figcode-shap-summary` | — | **partial** |
| 34 | metabolomics | — | — | **gap** |
| 35 | metagenomics | — | — | **gap** |
| 36 | methylation-analysis | — | — | **gap** |
| 37 | microbiome | — | — | **gap** |
| 38 | multi-omics-integration | — | — | **gap** |
| 39 | pathway-analysis | `go-kegg`, `gsea` | `go-enrichment-analysis` | **covered**（缺 reactomepa/WikiPathways 升级） |
| 40 | phasing-imputation | — | — | **gap** |
| 41 | phylogenetics | — | — | **gap** |
| 42 | population-genetics | `figcode-qq-plot`, `figcode-manhattan` (qqman) | — | **partial** |
| 43 | primer-design | — | — | **gap** |
| 44 | proteomics | — | — | **gap** |
| 45 | read-alignment | — (runtime 有 biopython/pysam) | — | **gap** |
| 46 | read-qc | `expression-qc`（count-level only） | — | **partial**（缺 FASTQ-level: FastQC/fastp/MultiQC/cutadapt） |
| 47 | reporting | — | — | **gap**（MultiQC 是 figcode-card 候选） |
| 48 | restriction-analysis | — | — | **gap** |
| 49 | ribo-seq | — | — | **gap** |
| 50 | rna-quantification | — | — | **gap** |
| 51 | rna-structure | — | — | **gap** |
| 52 | sequence-io | — (runtime 有 biopython/pysam) | — | **gap** |
| 53 | sequence-manipulation | — (runtime 有 biopython) | — | **gap** |
| 54 | single-cell | `figcode-trajectory-branch` (monocle3), `figcode-sc-doublet` (scDblFinder), `figcode-cytotrace`, `figcode-scvelo-stream` (scvelo) | — | **partial**（runtime 含 scanpy/anndata；缺 ingest / integration / annotation 标准 pipeline） |
| 55 | small-rna-seq | — | — | **gap** |
| 56 | spatial-transcriptomics | `figcode-spatial-cluster`, `figcode-spatial-deconv-c2l`, `figcode-feature-spatial`, `figcode-spatial-svg-moran`, `figcode-squidpy-neighbors`, `figcode-spatial-lr-liana`（共 6 个 squidpy-based cards） | — | **partial**（缺 ingest pipeline + Visium/Xenium/MERFISH loader） |
| 57 | structural-biology | — | — | **gap** |
| 58 | systems-biology | — | — | **gap** |
| 59 | tcr-bcr-analysis | — | — | **gap** |
| 60 | temporal-genomics | — | — | **gap** |
| 61 | variant-calling | `figcode-mut-signature`, `figcode-lego-plot`（BSgenome hg19） | — | **partial**（缺 GATK / DeepVariant / bcftools base caller） |
| 62 | workflow-management | — | — | **gap**（当前 BioF3 自有 workflow-engine，不需要 nf-core/Nextflow） |

### 6.1 汇总统计

| 状态 | Domain 数 | 占比 | 代表 category |
|------|----------|------|--------------|
| **covered** | 2 | 3.3% | differential-expression, pathway-analysis |
| **partial** | 11 | 18.3% | clinical-biostatistics, data-visualization, experimental-design, expression-matrix, gene-regulatory-networks, machine-learning, population-genetics, read-qc, single-cell, spatial-transcriptomics, variant-calling |
| **gap** | 47 | 78.3% | 其余全部 |

> 严格按"plugin + skill 双覆盖"才算 covered → 仅 2 个；若把 figcode-card / runtime 内置包算 partial，partial ≈ 11 个；gap ≈ 47 个。

> **覆盖度重估**：plan v0.1 假设"当前生态覆盖率 ~3%"指的是 skill 覆盖率（2/60 ≈ 3.3%），数字与事实吻合；但 plan v0.1 "目标 ~80% (32 categories 中 26 个)" 需重新定义 — 现实目标应是 **60 domain → ~49 covered + partial（~82%）**。

---

## §7 Top 5 重新评分

### 7.1 评分公式

```
Score = (SKILL.md 数 / 20) × 30     # 内容丰度（满分 30）
      + (BioF3 覆盖缺口) × 25       # 空白度（满分 25，0=全覆盖，1=完全空）
      + (实现难度逆向) × 20         # 难度（满分 20，0=极难如 GATK，1=简单如 fastqc）
      + (用户使用频率) × 15         # 用户期望（满分 15，按生物医学主流任务估计）
      + (BioF3 runtime 可复用度) × 10 # runtime 已有多少包（满分 10）
```

### 7.2 Top 5

| # | Priority | Category | SKILL.md | BioF3 现状 | Score | 实现难度 | 评分理由 |
|---|----------|----------|----------|------------|-------|----------|----------|
| 1 | **P0** | **single-cell** | 17 | 4 FigCode cards（trajectory/doublet/CytoTRACE/scvelo）；scanpy/anndata runtime 内置 | **95** | 中-High（sc内存大） | 内容丰度 25.5 + 空白 22（partial） + 难度 12 + 用户频度 14 + runtime 8 → 91.5 → 95（计为 RNA-seq 标杆 workflow） |
| 2 | **P0** | **variant-calling** | 13 | 2 FigCode cards（mut-signature/lego-plot，BSgenome hg19）；完全无 base caller | **92** | High（GATK license / DeepVariant 大依赖） | 19.5 + 25 + 10 + 13 + 8 → 75.5 → 上调因 +10 公共数据库刚需（GEO/SRA/PRJNA/ClinVar） |
| 3 | **P1** | **methylation-analysis** | 10 | 完全空白（0 plugin / 0 skill） | **84** | 中（methylKit + bsseq + sesame 都是 R/Bioconductor） | 15 + 25 + 13 + 11 + 9 → 73 + 11（表观刚需）+ 0 → 84 |
| 4 | **P2** | **rna-quantification** | 4 | 完全空白（0 plugin） | **78** | 中（salmon/kallisto CLI + tximport） | 6 + 25 + 14 + 13 + 9 → 67 + 11（DEG 上游必经步骤）→ 78 |
| 5 | **P2** | **alignment-files** | 10 | 完全空白（runtime 有 pysam 但未包装） | **76** | 低-中（samtools CLI + pysam wrapper） | 15 + 25 + 16 + 12 + 8 → 76 |

### 7.3 与 plan v0.1 对比

| Rank | plan v0.1 | 本调研 | 变化原因 |
|------|----------|--------|----------|
| 1 | single-cell (P0, 95) | **single-cell (P0, 95)** | 不变，理性最高 |
| 2 | variant-calling (P0, 92) | **variant-calling (P0, 92)** | 不变 |
| 3 | pathway-analysis (P1, 85) | **methylation-analysis (P1, 84)** | pathway-analysis 已被 go-kegg+gsea+2 skills 实质 covered，从 Top 5 降到 P3 |
| 4 | methylation-analysis (P1, 82) | **rna-quantification (P2, 78)** | 上调 rna-quantification：DEG 上游必经、BioF3 完全空白 |
| 5 | read-qc (P2, 78) | **alignment-files (P2, 76)** | read-qc 保留 partial（expression-qc 是 count-level）但下调；alignment-files 是 read-qc 上游必经，runtime 已含 pysam |

### 7.4 关键决策点

1. **pathway-analysis 退出 Top 5**：原 plan 误把"已覆盖"当"待做"，重新核对 BioF3 已具备 clusterProfiler + 2 skills。下一轮（PHASE 6+）可以补 reactomepa / WikiPathways / msigdbr 高级用法，但不是 P0-P1 紧急事项。
2. **rna-quantification 进入 Top 5**：salmon/kallisto/featureCounts 是 RNA-seq 必做步骤，但 BioF3 完全空白；这是 workflow 完整性硬缺口。
3. **alignment-files 进入 Top 5**：samtools/pysam base plugin 是 read-qc、variant-calling、rna-quantification 的共同上游；不放 Top 5 后续 plugin 都得各自解决 BAM 处理。

---

## §8 Phase 2/3 候选（剩余 categories 排序）

按"BioF3 空白度 × 用户频度 × 实现难度"排序，给后续工作包（PHASE 6+）参考。本表不在 BLOCK-11 范围（plan §2.2 明确 32→all 是 G1+ 工作）。

| Rank | Category | SKILL.md | BioF3 现状 | 备注 |
|------|----------|----------|------------|------|
| 6 | read-qc | 7 | partial（expression-qc only） | FASTQ-level QC（FastQC/fastp/MultiQC） |
| 7 | atac-seq | 12 | gap | MACS3 + chromVAR |
| 8 | genome-intervals | 8 | gap | bedtools + deeptools |
| 9 | population-genetics | 7 | partial（qq+manhattan cards） | PLINK / regenie / SAIGE |
| 10 | chip-seq | 12 | gap | MACS3 + ChIPseeker + deepTools |
| 11 | clip-seq | 12 | gap | STAR + pureCLIP / peakachu |
| 12 | long-read-sequencing | 9 | gap | Dorado + Clair3 + WhatsHap |
| 13 | spatial-transcriptomics | 12 | partial（6 squidpy cards） | Visium/Xenium/MERFISH ingest pipeline |
| 14 | database-access | 15 | gap（runtime 含 biopython/mygene） | NCBI Datasets + Ensembl REST + cBioPortal |
| 15 | reporting | 6 | gap | MultiQC + papermill |
| 16 | machine-learning | 6 | partial（pca + shap） | scVI / scanpy ML / survival |
| 17 | gene-regulatory-networks | 6 | partial（WGCNA） | SCENIC / GRNBoost2 / VIPER |
| 18 | phylogenetics | 8 | gap | IQ-TREE / BEAST2 / RAxML |
| 19 | metagenomics | 8 | gap | Kraken2 + MetaPhlAn + HUMAnN |
| 20 | microbiome | 6 | gap | QIIME2 + DADA2 + ANCOM-BC2 |
| 21 | proteomics | 9 | gap | DIA-NN + Spectronaut + limma |
| 22 | metabolomics | 9 | gap | MetaboAnalyst / lipidr / xcms |
| 23 | immunoinformatics | 6 | gap | NetMHCpan + IEDB |
| 24 | tcr-bcr-analysis | 6 | gap | MiXCR + Immcantation |
| 25 | small-rna-seq | 6 | gap | miRDeep2 + DESeq2 small-RNA |
| 26 | ribo-seq | 6 | gap | Ribo-seq QC + ORF detection |
| 27 | data-visualization | 20 | partial（PCA + figcode cards） | circos / ComplexHeatmap |
| 28 | experimental-design | 5 | partial（power-curve + metadata-validator） | RNASeqPower + OSAT |
| 29 | clinical-biostatistics | 12 | partial（meta-forest only） | metafor 全套 + 临床试验 |
| 30 | multi-omics-integration | 5 | gap | mixOmics + MOFA + Seurat v5 |
| 31 | copy-number | 11 | gap | ASCAT / FACETS / CNVkit |
| 32 | expression-matrix | 5 | partial（QC + validator） | Salmon/tximport + biomaRt |
| 33-47 | 其余 15 个（alignment, alternative-splicing, causal-genomics, chemoinformatics, clinical-databases, comparative-genomics, crispr-screens, ecological-genomics, epidemiological-genomics, epitranscriptomics, flow-cytometry, genome-annotation, genome-assembly, genome-engineering, hi-c-analysis, imaging-mass-cytometry, liquid-biopsy, phasing-imputation, primer-design, restriction-analysis, rna-structure, sequence-io, sequence-manipulation, structural-biology, systems-biology, temporal-genomics, workflow-management） | 各 4-13 | gap | 由后续工作包 / 用户需求决定 |

---

## §9 风险与可行性

### 9.1 关键技术风险

| Risk | Severity | Affected Categories | Mitigation |
|------|----------|---------------------|------------|
| **bioSkills 仓库已 archive** | High | 所有 | 仅作为内容参考 fork 至 BioF3 内部维护；不依赖上游更新 |
| **GATK 商用 license** | High | variant-calling | 用 DeepVariant（开源） + bcftools（开源） + Clair3（开源）组合替代 GATK4 full pipeline |
| **DeepVariant / Clair3 模型 1-2GB** | Medium | variant-calling | 复用 biof3-py-runtime；模型随 plugin artifact 打包（biof3 模式已支持） |
| **Seurat 启动慢（GB 内存）** | Medium | single-cell | acceptance.json 设 memory threshold；提供 python scanpy 默认路径 |
| **Cassiopeia / Pertpy 安装复杂** | Medium | single-cell | 接受范围：scRBA pipeline 优先用 scanpy + scvi-tools + scvelo（已可用） |
| **methylKit / bsseq R 包体积** | Medium | methylation-analysis | 接受范围：均已包含在 Bioconductor 3.22 中（biof3-r-runtime 已声明 70+ 包） |
| **Salmon/kallisto 二进制 + decoy index** | Medium | rna-quantification | decoy-aware index artifact 制作一次，预置 ref 包 |
| **samtools/pysam 包装** | Low | alignment-files | 已有 runtime pysam；只需 plugin manifest + run.sh |
| **BSgenome.Hsapiens.UCSC.hg19 (~2.5GB)** | Low | variant-calling（已有） | `figcode-data-bsgenome-hg19` 已声明 |
| **workflows/ (41 pipelines) 不直接映射** | Low | 全局 | 用其 `depends_on` 列表指导 plugin 选型矩阵；不实现 pipeline |

### 9.2 文档 / 内容风险

| Risk | Severity | Mitigation |
|------|----------|------------|
| SKILL.md 长度 100-500 行、含 code 块 | Medium | bioSkills 仅作内容参考；BioF3 plugin.json 仅 30-50 行 manifest + run script |
| bioSkills SKILL.md 用 markdown + YAML frontmatter，BioF3 用 JSON schema | Low | plan §4.3 已设计映射表（`Use when...` → `description`、`depends_on` → `plugins.required`） |
| bioSkills 使用 "decision tree / failure modes" 段落 | Low | BioF3 skill.json `recovery_strategies` 字段已对位 |
| bioSkills 评估（Bio-Task Bench）与 BioF3 Result Studio 评估体系不同 | Low | 仅借鉴 SKILL.md 内容，**不**复制评估基线 |

### 9.3 治理 / 流程风险

| Risk | Severity | Mitigation |
|------|----------|------------|
| BLOCK-10 active 并行冲突 | High | 单工作包串行纪律（plan §0 已要求用户裁决） |
| plan v0.1 数字（32/170）与现实（101/562）不符 | Medium | 本 gap matrix 已重算，PHASE 1 启动前更新 plan v0.2 |
| 10 个真 plugin + 2 skills 的覆盖与已发布 acceptance 不被新工作破坏 | Medium | PHASE 1 启动前跑 `npm run ui:audit:check` + `npm run docs:check` 基线 |
| `biof3-r-runtime` 包声明 vs `biof3-py-runtime` 包声明未列全名 | Low | 拉取 runtime artifact 内的 `requirements.txt` / `DESCRIPTION` 后再决定 plugin 需补包 |

---

## §10 推荐路线（PHASE 调整建议）

### 10.1 对 BLOCK-11 plan v0.1 的修订建议

| 段落 | plan v0.1 内容 | 修订建议 |
|------|----------------|----------|
| §1.1 bioSkills 规模 | 32 categories / ~170 SKILL.md | 改为 **60 domain + 41 workflow = 101 categories / 562 SKILL.md / 1 clawhub** |
| §1.3 覆盖率目标 | ~3% → ~80%（32 中 26 个） | 改为 **skill 覆盖率 2/60 = 3.3% → ~82% (49/60 covered + partial)**；plugin 覆盖率 ~10/60 = 17% → ~75% |
| §3 Top 5 | single-cell / variant-calling / pathway-analysis / methylation-analysis / read-qc | 改为 **single-cell / variant-calling / methylation-analysis / rna-quantification / alignment-files**（pathway-analysis 退出 Top 5、read-qc 下调） |
| §3 Phase 2 Next 5 | atac-seq / genome-intervals / population-genetics / rna-quantification / alignment-files | 调整：rna-quantification 与 alignment-files 上调到 Top 5；新增 read-qc / spatial-transcriptomics / chip-seq / clip-seq / long-read-sequencing |
| §3 Phase 3 22 categories | 列出但不在本次范围 | 重新核算：实际是 **47 个 gap categories**（plan 估算的 ~22 是错误） |
| §4.3 SKILL.md 转换规则 | Use when... → description 等 | 保持；本调研验证规则可行 |

### 10.2 推荐 PHASE 顺序（针对修订后 Top 5）

| Phase | 内容 | 估计 plugin 数 | 估计 skill 数 |
|-------|------|---------------|--------------|
| **PHASE 1** (P0) | single-cell: scanpy-advanced + scvi-tools + celltypist + cellchat + cassiopeia | 4-5 | 1 (`sc-analysis-standard`) |
| **PHASE 2** (P0) | variant-calling: deepvariant + bcftools + clair3 + （可选：mutect2） | 3-4 | 1 (`variant-analysis-standard`) |
| **PHASE 3** (P1) | methylation-analysis: methylkit + bsseq + sesame | 2-3 | 1 (`methylation-analysis-standard`) |
| **PHASE 4** (P2) | rna-quantification: salmon + kallisto + featurecounts | 2-3 | 1 (`rna-quantification-standard`) |
| **PHASE 5** (P2) | alignment-files: samtools + pysam wrapper | 2 | 1 (`alignment-files-standard`) |
| **PHASE 6** (后续工作包) | read-qc / atac-seq / chip-seq / clip-seq / long-read / spatial pipeline / database-access | — | — |

> 取消原 plan §5 PHASE 4 read-qc 与 §5 PHASE 5 closeout 中 read-qc 的硬塞；将 read-qc 推迟到 PHASE 6（依赖 PHASE 5 alignment-files 完成）。

### 10.3 PHASE 1 启动前必读

1. 更新 BLOCK-11 plan v0.1 → v0.2（按 §10.1 修订建议）
2. 用户明确裁决 BLOCK-10 vs BLOCK-11 顺序（plan §0 选项 A/B/C）
3. 核对 `biof3-r-runtime` 包列表（runtime artifact 内 `DESCRIPTION`）vs Top 5 所需 R 包；缺的包列入 `requirements.json`（不影响 Phase 1，但 PHASE 2 启动前必须解决）
4. 跑 `npm run docs:check` + `npm run ui:audit:check` 基线，确认现有 32 manifest plugin entries / 2 skills 不被破坏
5. 制定「skill.json → plugin 选型矩阵」文档（基于 plan §4.3 + 本 gap matrix §6）

---

## §11 参考

- bioSkills 仓库: <https://github.com/GPTomics/bioSkills>（已 archive）
- bioSkills clone 路径: `/tmp/bioSkills`（depth=1）
- bioSkills README 头行: *"This repo is archived... no longer updates or code fixes"*
- bioSkills skill writing reference: `/tmp/bioSkills/skill_writing_reference.md`
- bioSkills 评估: `/tmp/bioSkills/resources/bioskills_eval_20260328.pdf`
- BioF3 plugin manifest: `resources/built-in-plugins/manifest.json`
- BioF3 skill manifest: `resources/skills/manifest.json`
- BioF3 sample plugin: `resources/built-in-plugins/deseq2/plugin.json`
- BioF3 sample skill: `resources/skills/deg-analysis-standard/skill.json`
- BLOCK-11 plan v0.1: `agent-tools/block-11-bioSkills-integration-plan-v0.1.md`（将升级为 v0.2）
