# BLOCK-11: petri-py-runtime / petri-r-runtime 包清单

> Plan ID: `BLOCK-11-BIOSKILLS-INTEGRATION`
> Phase: **PHASE 0 伴随调研**
> Status: completed
> Last Updated: 2026-08-18

---

## §1 TL;DR

Petri 的 "runtime" 不是目录，而是**两件**注册在 `resources/built-in-plugins/manifest.json`
中的 `kind: "runtime"` 插件（`petri-py-runtime` v1.0.0 / `petri-r-runtime` v1.0.0），
附两份显式清单文件 `py-runtime-requirements.txt`（10 个 Python 包）与
`r-runtime-packages.txt`（26 个 R 包）。除此之外，`figcode-*` 卡片各自携带独立
artifact（squidpy / monocle3 / scvelo / scDblFinder / CytoTRACE / xgboost / shap 等）。

**Top 5 BLOCK-11 依赖覆盖度（已装 vs 需新增）**：

| Priority | Category | 已就位 | 需新增 | 风险 |
|---|---|---|---|---|
| **P0** | single-cell | scanpy / squidpy (figcode) / Seurat | pertpy / cassiopeia / scvelo(已有 figcode) | 低 |
| **P0** | variant-calling | 全部空白 | GATK / bcftools / freebayes / vcftools | **高**（GATK license） |
| **P1** | pathway | clusterProfiler / enrichplot / DOSE / msigdbr | ReactomePA / fgsea | 低 |
| **P1** | methylation | 全部空白 | methylKit / bsseq / minfi / ChAMP | 中 |
| **P2** | read-qc | 空白（仅 expression-qc 已存在但用 R） | fastqc / multiqc / cutadapt / trim_galore | 低 |

**关键提示**：所有 G1+ 阶段事项（packaged artifact 公证 / Provider 矩阵 / GA）按当前
G0 阶段纪律**不外推**；本报告只描述 runtime 已就位包清单与 PHASE 1-4 启动前的扩展
需求，不做实施。

---

## §2 petri-py-runtime 路径与结构

`petri-py-runtime` **不是 `core/` 下的目录**，而是一个注册在插件仓库里的
"runtime kind" 插件：

```
resources/built-in-plugins/
├── manifest.json                       # 含 petri-py-runtime / petri-r-runtime 注册项
├── py-runtime-requirements.txt         # 显式 Python 包清单（10 个）
├── r-runtime-packages.txt              # 显式 R 包清单（26 个）
├── petri-py-runtime 不存在独立目录     # runtime 实际从 OSS artifact zip 加载
└── <其他 plugin-id>/                   # 业务插件（含 figcode-*）

core/py-server/                         # Python 工具执行服务（Node 调度 + 子进程）
├── server.js / py-pool.js              # 调用 petri-py-runtime 加载的 Python 环境
├── python-tool-script-generator.js     # 生成临时 Python 脚本
├── package.json / .env.example         # petri-py-tmp 路径 + 容器名
└── pyserver.db                         # 任务数据库
```

**runtime 实际产物**（来自 manifest.json `artifacts`）：

| Platform | URL | sha256 | sizeBytes |
|---|---|---|---|
| macos-arm64 | `https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/py-runtime/1.0.0/macos-arm64.zip` | `f88502026027aec32eaa03ea5d2faefe77dbd59d0524f99d365208385b2abec8` | 154,126,592 (~147MB) |
| windows-x64 | `https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/py-runtime/1.0.0/windows-x64.zip` | null | null |

**Built against**: Python 3.11.9 · Requires: `python >=3.10.0`

**manifest description 原文**：_"Python 3.11.9 + pandas/numpy/scipy/sklearn/matplotlib/scanpy 等 200+ 包，Petri 所有 Python 工具的运行基础。"_
（"200+ 包"包括 pip 间接依赖；显式清单仅 10 个核心包。）

---

## §3 petri-py-runtime 已装 Python 包

数据源：`resources/built-in-plugins/py-runtime-requirements.txt`（10 个显式包）

| Package | Version Constraint | 用途 |
|---|---|---|
| numpy | >=1.24 | 基础数值计算 |
| pandas | >=2.0 | 数据框 |
| scipy | >=1.10 | 科学计算 |
| scikit-learn | >=1.3 | 机器学习 |
| matplotlib | >=3.7 | 静态绘图 |
| seaborn | >=0.12 | 统计绘图 |
| **anndata** | >=0.9 | **单细胞 AnnData 数据结构** |
| **scanpy** | >=1.9 | **单细胞分析核心** |
| requests | >=2.28 | HTTP 客户端 |
| tqdm | >=4.65 | 进度条 |

**通过 figcode-* 卡片附带 artifact 提供的 Python 包**（不属于 petri-py-runtime，独立 artifact zip）：

| Package | 引入插件（figcodeCardId） | 备注 |
|---|---|---|
| **squidpy** | `figcode-spatial-cluster` / `figcode-spatial-deconv-c2l` / `figcode-feature-spatial` / `figcode-spatial-svg-moran` / `figcode-squidpy-neighbors` / `figcode-spatial-lr-liana` | 6 张空间转录组卡片共用 |
| **liana** | `figcode-spatial-lr-liana` | 空间细胞通讯 |
| **scvelo** | `figcode-scvelo-stream` | RNA velocity 流图 |
| **xgboost** | `figcode-shap-summary` | SHAP 模型解释 |
| **shap** | `figcode-shap-summary` | SHAP 模型解释 |

**通过业务插件 environment.json 直接声明**（非 figcode）：

| Plugin | Python 依赖 |
|---|---|
| `pca-explorer` | pandas >=2.0.0, scikit-learn >=1.3.0, matplotlib >=3.7.0 |

---

## §4 petri-r-runtime 路径与结构

`petri-r-runtime` 同样是注册在 manifest.json 中的 runtime kind 插件：

```
resources/built-in-plugins/
├── manifest.json                       # petri-r-runtime v1.0.0 注册项
├── r-runtime-packages.txt              # 显式 R 包清单（26 个）
└── petri-r-runtime 不存在独立目录      # runtime 实际从 OSS artifact zip 加载

core/r-server/                          # R 工具执行服务
├── server.js / agent-runner.js         # 调用 petri-r-runtime 加载的 R 环境
├── tool-scripts/                       # 24 个 .R 工具脚本 + _scope.md 步骤 0 文档
│   ├── seurat-standard.R               # 已存在（seurat 工具）
│   ├── deseq2.R / gsea.R / go-kegg.R / wgcna.R / ...
│   └── _seurat-standard-scope.md       # 步骤 0 ground truth
├── package.json / .env.example
├── petri.db                            # 任务数据库
└── node_modules / routes / ...
```

**runtime 实际产物**：

| Platform | URL | sha256 | sizeBytes |
|---|---|---|---|
| macos-arm64 | `https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/r-runtime/1.0.0/macos-arm64.zip` | `60e1c9bc1eae529585ff8184b2f507331539a8302beb34249b2597fe7231e68c` | 556,916,997 (~557MB) |
| windows-x64 | `https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/r-runtime/1.0.0/windows-x64.zip` | null | null |

**Built against**: R 4.5.2 + Bioconductor 3.22 · Requires: `r >=4.4.0`

**manifest description 原文**：_"R 4.5.2 + Bioconductor 3.22 + ggplot2/dplyr/data.table/BiocGenerics 等 70+ 包，Petri 所有 R 工具的运行基础。"_
（"70+ 包"包括 Bioconductor 间接依赖；显式清单 26 个核心包。）

---

## §5 petri-r-runtime 已装 R 包

数据源：`resources/built-in-plugins/r-runtime-packages.txt`（26 个显式包）

| Package | 用途 | 关联 BLOCK-11 Category |
|---|---|---|
| **ggplot2** | 通用绘图 | 多类共用 |
| **dplyr** | 数据处理 | 多类共用 |
| **data.table** | 高性能 data.frame | 多类共用 |
| **BiocGenerics** | Bioconductor 基础泛型 | 多类共用 |
| **Seurat** | **单细胞分析核心（R 侧）** | **single-cell** 已就位 |
| **WGCNA** | 共表达网络 | 间接相关 |
| **clusterProfiler** | **GO/KEGG 富集** | **pathway** 已就位 |
| **DESeq2** | bulk RNA-seq 差异 | 间接相关 |
| **ggrepel** | 标签避让 | 多类共用 |
| **pheatmap** | 热图 | 多类共用 |
| **apeglm** | lfcShrink 收缩 | 间接相关 |
| **jsonlite** | JSON 序列化 | 多类共用 |
| **digest** | 哈希 | 多类共用 |
| **enrichplot** | **富集可视化** | **pathway** 已就位 |
| **DOSE** | 疾病本体富集 | pathway 间接 |
| **org.Hs.eg.db** | 人类注释 | pathway |
| **org.Mm.eg.db** | 小鼠注释 | pathway |
| **KEGGREST** | KEGG REST API | pathway |
| **msigdbr** | **MSigDB 基因集** | **pathway** 已就位 |
| **flashClust** | WGCNA 辅助 | 间接相关 |
| **impute** | WGCNA 辅助 | 间接相关 |
| **base64enc** | Base64 编码 | 多类共用 |
| **qqman** | QQ/曼哈顿图 | 间接 |
| **pwr** | 功效分析 | 间接 |
| **metafor** | 荟萃分析 | 间接 |

**通过 figcode-* 卡片附带 artifact 提供的 R 包**（独立 artifact zip）：

| Package | 引入插件（figcodeCardId） | 备注 |
|---|---|---|
| **monocle3** | `figcode-trajectory-branch` | 单细胞轨迹 |
| **scDblFinder** | `figcode-sc-doublet` | 双胞检测 |
| **CytoTRACE** | `figcode-cytotrace` | 分化潜能 |
| **gifski** | `figcode-volcano-animated` | GIF 导出 |
| **BSgenome.Hsapiens.UCSC.hg19** | `figcode-data-bsgenome-hg19` | hg19 参考（2.5GB 数据包） |

**业务插件 environment.json 直接声明的 R 包**（非 figcode，主要依赖 petri-r-runtime）：

| Plugin | R 依赖 |
|---|---|
| `volcano-plot` | ggplot2 >=3.4.0, ggrepel >=0.9.0 |
| `gene-correlation` | ggplot2 >=3.4.0, pheatmap >=1.0.12 |
| `expression-qc` | jsonlite >=1.8.0, digest >=0.6.0 |
| `deseq2` | DESeq2 >=1.40.0, ggplot2, ggrepel, pheatmap, apeglm, jsonlite, base64enc |
| `deg-standardizer` | jsonlite >=1.8.0, digest >=0.6.0 |
| `go-kegg` | clusterProfiler >=4.18.0, enrichplot, DOSE, org.Hs.eg.db, org.Mm.eg.db, KEGGREST, ggplot2 >=4.0.0 |
| `gsea` | clusterProfiler >=4.18.0, enrichplot, DOSE, org.*, msigdbr >=26.1.0, KEGGREST, ggplot2 >=4.0.0 |
| `wgcna` | WGCNA >=1.74, flashClust, impute, ggplot2, dplyr, jsonlite, base64enc |
| `sample-metadata-validator` | jsonlite >=1.8.0, digest >=0.6.0 |

> 注：上表中 "go-kegg" / "gsea" / "wgcna" 等均通过 `requiresBundle: "r-enrichment"` /
> `"r-wgcna"` 机制共享 petri-r-runtime 的 R 解释器。

---

## §6 Top 5 Category 依赖覆盖

### §6.1 P0 — single-cell

| Target Package | Language | 当前状态 | 来源 / 待加位置 | 备注 |
|---|---|---|---|---|
| **scanpy** | Python | 已就位 | petri-py-runtime（>=1.9） | 核心已就位 |
| **squidpy** | Python | 已就位 | 6 个 figcode-* 卡片 artifact | 空间转录组卡片 |
| **seurat** | R | 已就位 | petri-r-runtime（基础集） | 已就位 |
| **scvelo** | Python | 已就位 | `figcode-scvelo-stream` artifact | RNA velocity 卡片 |
| **scDblFinder** | R | 已就位 | `figcode-sc-doublet` artifact | 双胞检测卡片 |
| **CytoTRACE** | R | 已就位 | `figcode-cytotrace` artifact | 分化潜能卡片 |
| **monocle3** | R | 已就位 | `figcode-trajectory-branch` artifact | 轨迹推断卡片 |
| **pertpy** | Python | 未安装 | 需新增 PyPI 依赖 | bioSkills 单细胞补充生态 |
| **cassiopeia** | R | 未安装 | 需 Bioconductor 新增 | 线系追踪 |
| scanpy-advanced | Python | 部分 | scanpy 已装；advanced（pertpy/scvelo/...） | 复用现有 + 按需补 |

**风险等级**：低。scanpy/squidpy/Seurat 三大支柱已就位；pertpy / cassiopeia
按 PHASE 1 范围评估。

### §6.2 P0 — variant-calling

| Target Package | Language | 当前状态 | 备注 |
|---|---|---|---|
| **GATK（gatk4-cli）** | Java | 未安装 | 需 JVM + GATK4 开源子集；完整 GATK 有商业 license |
| **bcftools** | C（CLI） | 未安装 | 需 conda / brew 单独安装 |
| **vcftools** | C++（CLI） | 未安装 | 同上 |
| **freebayes** | C++（CLI） | 未安装 | 同上 |

**风险等级**：高。整个 variant-calling 生态在 Petri 中**完全空白**，需新建独立
"variant-calling tools" 子集（conda env / 系统级二进制）；GATK 商业 license 是核心
风险，建议改用 GATK4 开源子集 + bcftools/freebayes。

### §6.3 P1 — pathway

| Target Package | Language | 当前状态 | 来源 | 备注 |
|---|---|---|---|---|
| **clusterProfiler** | R | 已就位 | petri-r-runtime + go-kegg/gsea 插件 | 核心已就位 |
| **enrichplot** | R | 已就位 | petri-r-runtime | 核心已就位 |
| **DOSE** | R | 已就位 | petri-r-runtime | 核心已就位 |
| **org.Hs.eg.db / org.Mm.eg.db** | R | 已就位 | petri-r-runtime | 核心已就位 |
| **msigdbr** | R | 已就位 | petri-r-runtime + gsea 插件 | 核心已就位 |
| **ReactomePA** | R | 未安装 | 需 Bioconductor 新增 | 与 clusterProfiler 互补 |
| **fgsea** | R | 未安装 | 需 Bioconductor 新增 | 快速 GSEA |

**风险等级**：低。clusterProfiler 体系已就位；ReactomePA / fgsea 按 PHASE 3
范围评估是否新增（Bioconductor 增量包，约 10MB 级）。

### §6.4 P1 — methylation

| Target Package | Language | 当前状态 | 备注 |
|---|---|---|---|
| **methylKit** | R | 未安装 | 需 Bioconductor 新增（典型 ~5MB） |
| **bsseq** | R | 未安装 | 需 Bioconductor 新增 |
| **minfi** | R | 未安装 | 需 Bioconductor 新增（450K 阵列分析） |
| **ChAMP** | R | 未安装 | 需 Bioconductor 新增（450K/850K pipeline） |

**风险等级**：中。methylation 生态在 Petri **完全空白**；4 个工具都是
Bioconductor R 包，理论可统一扩展到 petri-r-runtime（需评估 zip 大小膨胀）。

### §6.5 P2 — read-qc

| Target Package | Language | 当前状态 | 备注 |
|---|---|---|---|
| **FastQC** | Java | 未安装 | 需 JVM + 下载 jar |
| **MultiQC** | Python | 未安装 | PyPI 可装；可作为 figcode-read-qc 卡片 |
| **cutadapt** | Python | 未安装 | PyPI 可装，但需 C 编译环境 |
| **trim_galore** | Python（wrapper） | 未安装 | 依赖 cutadapt + FastQC |

**风险等级**：低。FastQC/MultiQC/cutadapt 均为常见工具，可通过新建
"petri-read-qc-tools" 子集添加；trim_galore 是 cutadapt 的便捷 wrapper。

> 备注：现有 `expression-qc` 插件是 **counts 矩阵 QC**（不是 raw reads QC），
> 用 R 实现，不涉及 FastQC 等原始测序数据 QC 工具。

---

## §7 环境准备建议（PHASE 1-4 启动前）

按 BLOCK-11 §5 PHASE 实施路线，给出各 PHASE 启动前的 runtime 扩展需求清单。

### PHASE 1 — single-cell（启动门槛：低）

- **核心已就位**，无需扩展 petri-py-runtime 或 petri-r-runtime。
- 若纳入 **pertpy** 与 **cassiopeia**：
  - `pertpy`：Python 包，pip 装入 petri-py-runtime 增量 artifact（评估 ~30MB）
  - `cassiopeia`：Bioconductor R 包，加入 petri-r-runtime 增量（评估 ~20MB）
- **决策点**：pertpy / cassiopeia 是否纳入 v1？若纳入，需扩展 manifest runtime artifact。

### PHASE 2 — variant-calling（启动门槛：高）

- **核心决策**：是否使用 GATK？
  - 推荐改用 **GATK4 开源子集（gatk4-cli）** + bcftools + freebayes + vcftools
  - 全部以 CLI 形式封装，需新建独立 runtime 子集（不能放进 petri-py-runtime）
- **建议方案**：新建 `petri-variant-tools` runtime 类插件（kind: "runtime"），artifacts
  含 macos-arm64 conda-pack 或纯二进制 zip（包含 bcftools / freebayes / vcftools /
  samtools + GATK4-cli jar）。
- **不推荐**：把 variant-calling CLI 工具塞进 petri-py-runtime（污染纯 Python runtime）。

### PHASE 3 — pathway + methylation（启动门槛：低 + 中）

- **pathway 扩展**：在 petri-r-runtime 增量 artifact 添加 **ReactomePA** + **fgsea**
  - 都是 Bioconductor R 包；可与现有 clusterProfiler/enrichplot 共存
  - 评估总增量：约 15-20MB
- **methylation 扩展**：4 个工具（methylKit / bsseq / minfi / ChAMP）全部需新增
  - 评估总增量：约 50-80MB（minfi/ChAMP 含较多依赖）
  - 决策点：4 个工具是否全装？若全装，建议**单独** `petri-methylation-runtime`
    子集，避免 petri-r-runtime 体积膨胀（557MB → 700MB+）。

### PHASE 4 — read-qc（启动门槛：低）

- **建议方案**：新建 `petri-read-qc-tools` 子集
  - FastQC（Java jar）+ MultiQC（Python 包，可与 petri-py-runtime 共享）
  - cutadapt（Python，但需 C 编译）+ trim_galore（Python wrapper）
- **替代方案**：若保持 read-qc 卡片化，可分两个 figcode 插件：
  - `figcode-read-qc-fastqc`：FastQC jar + wrapper R/Python
  - `figcode-read-qc-multiqc`：MultiQC + 聚合

### 通用建议

1. **优先复用 runtime**：PHASE 1/3 的扩展尽量增量加到 petri-py-runtime /
   petri-r-runtime，避免插件膨胀。
2. **CLI 工具拆子集**：variant-calling / read-qc 的 CLI 类工具（带 JVM、二进制）
   建议独立 runtime 子集（petri-variant-tools / petri-read-qc-tools），不污染
   纯 Python 基础栈。
3. **G1+ 阶段事项不动**：按当前 G0 阶段纪律，本报告不外推 packaged 公证 / Provider
   矩阵 / GA，仅描述 runtime 包清单与 PHASE 1-4 启动前扩展需求。

---

## §8 参考

### runtime 注册路径

- `resources/built-in-plugins/manifest.json` — `petri-py-runtime`（line 37） /
  `petri-r-runtime`（line 8）注册项，含 artifacts / sha256 / builtAgainst / description
- `resources/built-in-plugins/py-runtime-requirements.txt` — petri-py-runtime 显式
  Python 包清单（10 个核心包）
- `resources/built-in-plugins/r-runtime-packages.txt` — petri-r-runtime 显式 R 包
  清单（26 个核心包 + Bioconductor 间接依赖至 70+）

### runtime artifact URL

- petri-py-runtime macos-arm64: `https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/py-runtime/1.0.0/macos-arm64.zip`
  - sha256: `f88502026027aec32eaa03ea5d2faefe77dbd59d0524f99d365208385b2abec8`
  - size: 154,126,592 bytes (~147MB)
- petri-r-runtime macos-arm64: `https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/r-runtime/1.0.0/macos-arm64.zip`
  - sha256: `60e1c9bc1eae529585ff8184b2f507331539a8302beb34249b2597fe7231e68c`
  - size: 556,916,997 bytes (~557MB)

### 相关代码位置

- `core/py-server/server.js` / `py-pool.js` — Python 工具调度（消费 petri-py-runtime）
- `core/r-server/server.js` / `agent-runner.js` — R 工具调度（消费 petri-r-runtime）
- `core/r-server/tool-scripts/seurat-standard.R` + `_seurat-standard-scope.md` —
  已存在的 Seurat 工具脚本与步骤 0 ground truth（PHASE 1 实施可直接复用）
- `core/r-server/tool-scripts/_gsea-scope.md` — GSEA 范围卡（pathway PHASE 3 实施参考）
- `core/shared-backend/skill-registry.js` — skill/plugin 注册（BLOCK-11 新 plugin
  自动发现入口）
- `core/shared-backend/workflow-engine.js` — workflow DAG 执行（BLOCK-11 验证入口）
- `resources/built-in-plugins/manifest.schema.json` — plugin manifest schema 校验

### BLOCK-11 计划

- `agent-tools/block-11-bioSkills-integration-plan-v0.1.md` — 计划源文件（draft v0.1）
- §3 PHASE 1-5 路线图对应本报告的 PHASE 启动门槛评估

### 现有 skill/plugin 引用

- `resources/skills/manifest.json` — 仅 2 个 built-in skill：`deg-analysis-standard`
  / `go-enrichment-analysis`（BLOCK-11 需扩展至 7 个 Top 5 skill）
- `resources/skills/deg-analysis-standard/` / `go-enrichment-analysis/` — Skill
  参考实现（PHASE 1-4 实施模板）

---

**报告生成时间**：2026-08-18
**调研范围**：仅 runtime 包清单，不修改任何代码 / 不安装任何包 / 不跑 docs:check
/ 不写 AUDIT-LOG
