# BLOCK-11: Plugin/Skill 实现模式分析

> Plan ID: `BLOCK-11-BIOSKILLS-INTEGRATION`
> Phase: **PHASE 0 伴随调研**
> Status: completed
> Last Updated: 2026-08-18

---

## §1 TL;DR

Petri 现成 plugin/skill 资产已收敛到 **10 个 built-in plugin** + **2 个 built-in skill**，分布严格分层：

- **Plugin**（执行体）按子领域归位（`bulk-rnaseq` / `spatial` / `figcode-*`），每个 plugin 自带 `plugin.json` + `environment.json` + `tool-definition.json` + `scripts/<id>.R` + `acceptance.json` + `golden-revisions/` + `demo-data/` + `<id>-report-template.html` + `README.md` 八件套。R 脚本统一以 **JSON 媒介** + `commandArgs` + `_petri-theme.R` source 的方式接入 Petri 调度器（`tools.js` 负责把 job 目录、params.json、inputs 和主题文件塞给脚本）。
- **Skill**（AI 编排）只承担 prompt / 参数 / plugin 组合 / 错误恢复策略，**不重写分析逻辑**，通过 `plugins.required / plugins.optional` 复用现成 plugin。`prompts.system / user_templates` 既可内联字符串，也可走相对路径 `prompts/system.md` + `prompts/user/*.md`，由 skill-schema 校验。注意 `go-enrichment-analysis` 的 `plugins.required` 中写的是 `clusterProfiler`（R 包名），与 `deg-analysis-standard` 写 plugin id 不同 — 这是 schema 容忍但尚未统一的现状。
- **Skill ↔ Plugin 连接**：以 `skill.json.plugins.required` 数组声明 plugin id 串（与 `manifest.json` 中 built-in plugin 名一一对应），调度时按 `outputs.primary[].type` + `parameters.optional[].options/default` 引导用户输入；运行期由 skill executor 解析 `workflows.default` 调用对应 plugin 的 `scripts/<id>.R`，结果再按 `outputs` schema 回填。

新 plugin/skill 的实现模板可直接套用 `deseq2`（最复杂 R 调用链）+ `volcano-plot`（参数最多的 presentation-heavy 类）+ `go-kegg` / `gsea`（enrichment + bundle 依赖）+ `deg-analysis-standard`（最完整 skill）。

---

## §2 现成 Plugin 盘点

| Plugin ID | 类型 | 复杂度 | 备注 |
| --- | --- | --- | --- |
| `petri-r-runtime` | runtime | N/A | R 4.5.2 + Bioconductor 3.22 + 70+ 包；走 OSS zip 真实 artifact |
| `petri-py-runtime` | runtime | N/A | Python 3.11.9 + scanpy/sklearn 等 200+ 包；走 OSS zip |
| `deseq2` | bulk RNA-seq | **高** | 最复杂 R 流程：counts + coldata → DESeq2 → lfcShrink(apeglm) → volcano/PCA/heatmap/report |
| `volcano-plot` | bulk RNA-seq | 中 | **参数最多（19 个 input）**，presentation-heavy；自动探测 log2FC 别名 |
| `expression-qc` | bulk RNA-seq | 中 | 表达量质控，deseq2 上游 |
| `gene-correlation` | bulk RNA-seq | 中 | 样本/基因相关性热图 |
| `pca-explorer` | bulk RNA-seq | 中 | 主成分可视化 |
| `deg-standardizer` | bulk RNA-seq | 中 | 把差异表标准化成 `gene,baseMean,log2FoldChange,pvalue,padj` 统一列名 |
| `sample-metadata-validator` | bulk RNA-seq | 中 | counts × coldata 预校验（preflight），zero-R 依赖 |
| `go-kegg` | enrichment | **高** | `requiresBundle=r-enrichment`；GO-BP/MF/CC + KEGG（离线 snapshot） |
| `gsea` | enrichment | **高** | `requiresBundle=r-enrichment`；GSEA GO-BP / KEGG / Hallmark |
| `wgcna` | bulk RNA-seq | 中 | 加权基因共表达网络 |
| `figcode-*` (≥14) | figcode-card | 低-中 | 可交互图卡（volcano/trajectory/doublet/CytoTRACE/QQ/Manhattan/Power-curve/meta-forest/...） |

来源：`resources/built-in-plugins/manifest.json` 顶层 30 个 plugin 条目（前两个是 runtime，其余 28 个含 functional + figcode）；`resources/built-in-plugins/<id>/` 实际目录 10 个 functional plugin（含 deg-standardizer、sample-metadata-validator）。

---

## §3 `plugin.json` 模板（来自 deseq2 / volcano-plot / go-kegg / gsea）

Plugin 自身目录的 `plugin.json` 与顶层 `manifest.json` 中该 plugin 条目冗余存在，是 **execution 端最权威的 metadata 源**。

### §3.1 字段最小集

```json
{
  "id": "deseq2",
  "status": "canonical",                         // canonical | incubating | deprecated
  "pluginManifestVersion": 1,
  "title": "DESeq2 差异分析",                     // 人类可读
  "version": "1.0.0",                             // semver
  "language": "r",                                // r | python
  "description": "Bulk RNA-seq 差异表达基因检测（DESeq2 + lfcShrink(apeglm)）。",
  "packages": {
    "r": {
      "DESeq2": ">=1.40.0",
      "ggplot2": ">=3.4.0",
      "ggrepel": ">=0.9.0"
    }
  },
  "runtime": {
    "r": ">=4.4.0"
  },
  "builtAgainst": {
    "r": "4.5"
  },
  "platform": ["macos-arm64", "windows-x64"],
  "supportedPlatforms": ["macos-arm64", "windows-x64"]
}
```

### §3.2 可选扩展字段

| 字段 | 来源 plugin | 用途 |
| --- | --- | --- |
| `requiresBundle` / `requiresBundleVersion` | `go-kegg`, `gsea` | 依赖 R bundle（如 `r-enrichment`）随环境分发离线数据 |
| `requiresBundle: false` | `sample-metadata-validator` | 显式声明不依赖 bundle（即使 `incubating`） |
| `sourcePolicy` | `deseq2` | `"builtin-canonical"` 表示 OS 内置 canonical 插件 |
| `dagStep` / `dagPosition` / `downstream` | `sample-metadata-validator` | 把插件挂到 DAG 上：`upstream` input-validation → `expression-qc` / `deseq2` |
| `entryPoint` | `sample-metadata-validator` | 等同 `scripts/<id>.R` 入口显式声明 |

> **注意**：`plugin.json` 自身只用 basic id/title/version/language/description/packages/runtime/builtAgainst/platform 八件套；执行所需的 inputs/outputs/failureModes/resultStudio 都搬到 `tool-definition.json`。

---

## §4 `environment.json` 模板

`environment.json` 是部署侧依赖清单（与 `plugin.json.packages` 平行存在，描述运行环境）。两份清单的 R 包字符串必须保持一致。

```json
{
  "schemaVersion": 1,
  "runtime": {
    "language": "r",
    "version": ">=4.4.0",
    "builtAgainst": "4.5",
    "platforms": ["macos-arm64"]
  },
  "capabilities": [],                              // ["r-enrichment"] for enrichment plugins
  "packages": {
    "r": {
      "DESeq2": ">=1.40.0",
      "ggplot2": ">=3.4.0",
      "ggrepel": ">=0.9.0",
      "pheatmap": ">=1.0.12",
      "apeglm": ">=1.20.0",
      "jsonlite": ">=1.8.0",
      "base64enc": ">=0.1-3"
    }
  },
  "policy": {
    "installInScript": false,                      // 脚本中禁止 install.packages()
    "networkDuringAnalysis": false,                // 分析期间关闭网络
    "recordPackageVersions": true,                 // 生成 provenance 时记录
    "recordRuntimeVersion": true
  }
}
```

enrichment 类（`go-kegg` / `gsea`）额外带：

```json
{
  "capabilities": ["r-enrichment"],
  "requiresBundle": "r-enrichment",
  "requiresBundleVersion": "1.0.0"
}
```

---

## §5 Script 接口约定（`scripts/<id>.R` 或 `.py`）

### §5.1 调用约定（来自 deseq2.R / volcano-plot.R / go-kegg.R / gsea.R）

每个 R 脚本都遵循同一接入契约：

```r
#!/usr/bin/env Rscript
args <- commandArgs(trailingOnly = TRUE)
job_dir <- args[1]                       # ← 入口：Job 工作目录
output_dir <- file.path(job_dir, "output")
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

# 1) 加载 Petri SCI 视觉主题 (tools.js 自动塞到 jobDir)
source(file.path(job_dir, "_petri-theme.R"))

# 2) 读取参数（统一 JSON 媒介）
params <- fromJSON(file.path(job_dir, "params.json"))
design_col <- params$design %||% "condition"
padj_cut <- as.numeric(params$padj_cutoff %||% 0.05)

# 3) 读取输入文件（约定：input id 对应 jobDir 下文件名）
counts_file <- list.files(job_dir, pattern = "^counts", full.names = TRUE)[1]
coldata_file <- list.files(job_dir, pattern = "^coldata", full.names = TRUE)[1]

# 4) preflight 校验（fail-fast 中文报错）
stop("[deseq2] counts 文件未找到。期望 job 目录包含以 'counts' 开头的 CSV 文件。")

# 5) 主体逻辑（DESeq() → results() → lfcShrink()）

# 6) PNG 规范化（deterministic artifact）
canonicalize_png(file_path)              # 用 png::writePNG(png::readPNG(f), f) 重写

# 7) 落盘到 output_dir；主清单写 entry_point + 失败码
```

> **关键约束**：R 脚本之间通过 `output_dir` 内产物 + `params.json` 隐式传递；Plugin 之间没有直接 IPC。Slot 1 的 `volcano-plot` 会在 `deg-standardizer` 的 `deg_table.csv` 上消费。

### §5.2 `tool-definition.json`：UI 与 failureMode 契约

`tool-definition.json` 是 **Harness/UI** 唯一渲染源，含 `id/title/category/inputs/outputs/failureModes/tutorialUrl/demoDataUrl/estimatedMinutes/resultStudio`。新插件必须给齐全，否则 UI 无法二跳绑定上游。

```json
{
  "id": "volcano-plot",
  "title": "火山图绘制",
  "subtitle": "差异基因可视化",
  "category": "bulk RNA-seq",
  "language": "r",
  "description": "...",
  "inputs": [
    { "id": "deg_table", "label": "...", "type": "file", "required": true, "accept": ".csv" },
    { "id": "fc_threshold", "label": "|log2FC| 阈值", "type": "number", "default": 1 },
    { "id": "legend_position", "label": "图例位置", "type": "select",
      "default": "right", "options": ["right","left","top","bottom","none"] }
  ],
  "outputs": [
    { "id": "volcano", "filename": "volcano.png", "type": "plot", "label": "火山图" },
    { "id": "classified_table", "filename": "classified_table.csv", "type": "table", "label": "分类结果表" }
  ],
  "tutorialUrl": "/docs/bulk-rnaseq/module02",
  "demoDataUrl": "/demo-data/deseq2-demo",
  "estimatedMinutes": 2,
  "packages": ["DESeq2","ggplot2","ggrepel","pheatmap","png"],
  "color": "#dc2626",
  "reportUrl": "/exports/tools/deseq2/index.html",
  "resultStudio": { ... },
  "failureModes": [
    {
      "code": "missing_required_file_inputs",
      "title": "缺少必需输入文件",
      "description": "...",
      "recoverable": true,
      "suggestedFix": "...",
      "detect": "missing required file inputs|missing input file|please provide file"
    }
  ]
}
```

`resultStudio` 仅在 Block-11 范围内的 plugin 才有（含 `semanticType` / `entity` / `validator` / `goldenFixture`）。新 plugin 是否填 `resultStudio`，看是否要进 Result Studio 看板。

### §5.3 `acceptance.json` 合约

```json
{
  "schemaVersion": 1,
  "pluginId": "deseq2",
  "pluginVersion": "1.0.0",
  "platforms": ["macos-arm64"],
  "fixtures": [
    { "id": "valid",           "description": "...", "inputs": {...}, "expectedStatus": "valid",   "expectedOutputs": [...] },
    { "id": "missing-inputs",  "description": "...", "inputs": {},    "expectedStatus": "blocked", "expectedFailureMode": "missing_required_file_inputs" },
    { "id": "runtime-not-ready","description":"...","inputs":{...},"expectedStatus":"blocked","expectedFailureMode":"runtime_not_ready","skipOnSupportedPlatform":true }
  ],
  "reproducibility": {
    "requireScriptSha256": true,
    "requireParamsHash": true,
    "requireInputSha256": true,
    "requireOutputSha256": true,
    "requireRVersion": true,
    "requirePackageVersions": true,
    "evidenceSource": "runtime-generated artifact-manifest.json + provenance.json"
  }
}
```

> **三段 fixture 必须有**：`valid`（happy-path）、`missing-inputs`（无输入 blocked）、`runtime-not-ready`（runtime/bundle 缺失 blocked，且 `skipOnSupportedPlatform:true`）。另外建议加 1 个 `empty-result` 验证"科学空结果"。

---

## §6 `golden-revisions` / `acceptance` 模式

### §6.1 目录结构（deseq2 / volcano-plot / go-kegg）

```
resources/built-in-plugins/<id>/
├── README.md
├── acceptance.json
├── demo-data/                         # 至少 1 个 demo fixture
│   ├── demo-counts.csv
│   ├── demo-coldata.csv
│   └── (其他)
├── golden-revisions/
│   └── result-studio-v1.json          # Result Studio 契约 digest
├── <id>-report-template.html          # SCI 风格 HTML 报告模板
├── environment.json
├── plugin.json
├── scripts/
│   └── <id>.R                         # 主执行脚本
└── tool-definition.json
```

注意：`gsea` 没有 `golden-revisions/` 目录（incubating 阶段可以推迟），但其它三件套都有。

### §6.2 `golden-revisions/result-studio-v1.json` 模板

```json
{
  "schemaVersion": 1,
  "pluginId": "deseq2",
  "pluginVersion": "1.0.0",
  "descriptorVersion": 1,
  "sourceScriptSha256": "013856191f06d1ab1326d7747a4cbd6b0979efcb31d084da707e5fec10cfa297",
  "inputBindingDigest":      "42937e704e3fca8dd421dfaa0e5522740a28696556e360205d826fded3966776",
  "artifactContractDigest":  "f5ce38f6ba8079d559b3a1527ae751cce56320bc0063d8c93f624a8778c5256b",
  "revisionSourceStrategy": "execution_snapshot_per_artifact",
  "independentScriptPathTemplate": "analysis/scripts/{artifactFamilyId}/{revisionId}/{artifactId}.R",
  "fixtureInput": "demo-data/demo-counts.csv + demo-data/demo-coldata.csv",
  "expectedArtifactIds": ["deg_table", "volcano", "pca", "heatmap", "report"]
}
```

> 该文件在 PHASE 1-4 内 Block-11 新加的 Result Studio class plugin 才需要，并在 CI 阶段填入真实 SHA-256（Week 4 流程）。当前 G0 阶段允许创建条目，但 sha256 等字段先以 placeholder 占位。

### §6.3 `acceptance.json` 验收点

- **fixture 三段模板**：valid + missing-inputs + runtime-not-ready 几乎一成不变；incubating 可以多加 `empty-result`。
- **reproducibility**：6 个 require 全开 + `evidenceSource` 固定指向运行时生成的 `artifact-manifest.json + provenance.json`，不重复造 source of truth。

---

## §7 现成 Skill 盘点

| Skill ID | 关联 plugin | 复杂度 | 备注 |
| --- | --- | --- | --- |
| `deg-analysis-standard` | `expression-qc` `deseq2` `volcano-plot` required; `go-kegg` `gsea` optional | **高** | 完整端到端 RNA-seq skill，含 system.md + user/standard-deg.md |
| `go-enrichment-analysis` | `clusterProfiler` required; `enrichplot` `DOSE` optional | 中 | 注意：`plugins.required` 在此例是 **R 包名**，不是 plugin id（与现有 plugin 子领域交错并存） |

来源：`resources/skills/manifest.json`（仅 2 个 built-in skill，且都在 bioinformatics/ngs 类）。

---

## §8 `skill.json` 模板（来自 `deg-analysis-standard`）

### §8.1 双源文件结构

每个 skill 有两个等价来源（推荐优先使用 `skill.json`，`manifest.json` 在顶层索引）：

```
resources/skills/<id>/
├── README.md
├── manifest.json           # 顶层索引，build metadata, short fields
├── skill.json              # 完整 schema（与 manifest 等价但有 prompt / recovery / outputs）
└── prompts/
    ├── system.md           # 默认相对路径
    └── user/
        └── standard-<id>.md
```

### §8.2 `skill.json` 完整字段

```json
{
  "skillManifestVersion": 1,
  "id": "deg-analysis-standard",
  "name": "标准差异表达分析",
  "version": "1.0.0",
  "description": "从原始计数矩阵到火山图的完整 DEG 分析流程。",
  "category": "bioinformatics/ngs",                // 必须符合 domain/subdomain
  "tags": ["deg", "rna-seq", "deseq2", "volcano-plot", "expression"],
  "source": "built-in",                            // built-in | installed | marketplace
  "capabilities": ["r-enrichment", "bioinformatics"],

  "plugins": {
    "required": ["expression-qc", "deseq2", "volcano-plot"],
    "optional": ["go-kegg", "gsea"]
  },

  "workflows": {
    "default": "deg-standard-pipeline",
    "variants": ["deg-quick", "deg-comprehensive"]
  },

  "prompts": {
    "system":          "你是一位资深的生物信息分析师…\n1. 评估数据质量\n2. …",
    "user_templates": [
      "对 {dataset} 进行标准 DEG 分析",
      "使用 {method} 方法比较 {group1} vs {group2}"
    ]
  },

  "parameters": {
    "required": ["dataset", "group_column"],
    "optional": {
      "method":         { "type": "select", "options": ["deseq2","edger","limma"], "default": "deseq2", "description": "差异分析方法" },
      "padj_threshold": { "type": "number", "default": 0.05, "min": 0, "max": 1, "step": 0.01, "description": "校正后 P 值阈值" },
      "logfc_threshold":{ "type": "number", "default": 1,    "min": 0, "max": 10,"step": 0.5,  "description": "Log2 Fold Change 阈值" },
      "species":        { "type": "select", "options": ["human","mouse","rat","zebrafish"], "default": "human", "description": "物种" }
    }
  },

  "recovery_strategies": [
    {
      "when": "sample_group_mismatch",
      "description": "样本分组不匹配",
      "do": "尝试自动检测分组或请求用户确认",
      "fallback": "提供分组模板让用户填写",
      "recoverable": true
    },
    {
      "when": "insufficient_replicates",
      "description": "生物学重复不足",
      "do": "警告用户并建议使用 limma-voom 方法",
      "fallback": "使用 DESeq2 的 nbinomWaldTest",
      "recoverable": true
    }
  ],

  "outputs": {
    "primary": [
      { "id": "volcano_plot", "type": "plot", "label": "火山图", "description": "...", "format": "png", "dpi": 300 },
      { "id": "degs_table",   "type": "table","label": "DEGs 结果表", "description": "...", "format": "csv",
        "columns": ["gene", "baseMean", "log2FC", "lfcSE", "stat", "pvalue", "padj", "significant"] }
    ],
    "secondary": [
      { "id": "go_enrichment", "type": "table", "label": "GO 富集结果", "requires_plugin": "go-kegg", "description": "..." },
      { "id": "qc_report",     "type": "html",  "label": "QC 报告" }
    ]
  },

  "metadata": {
    "author": "Petri Team",
    "license": "MIT",
    "source": "built-in",
    "created": "2026-08-14",
    "updated": "2026-08-14",
    "compatibility": {
      "min_app_version": "0.1.0",
      "platform": ["macos-arm64", "macos-x64", "windows-x64"],
      "r_version": ">=4.4.0"
    }
  }
}
```

### §8.3 参数类型枚举（来自 `core/shared-backend/skill-schema.js`）

| `type` | 必带字段 | 用例 |
| --- | --- | --- |
| `select`  | `options[]`、可选 `default`（必须 ∈ options） | 方法、物种、ontology |
| `number`  | `min`/`max`/`step`、可选 `default`（须在范围内） | 阈值、pvalue |
| `string`  | 可选 `pattern`（合法 RegExp） | gene list、gene ID |
| `boolean` | 可选 `default` | 开关 |
| `file`    | `accept`（文件扩展名 glob） | 输入 CSV |

### §8.4 prompt 二选一：内联 vs 相对路径

`go-enrichment-analysis` 走的就是相对路径（schema 允许字符串，相对路径在运行时被读出）：

```json
"prompts": {
  "system": "prompts/system.md",
  "user_templates": ["prompts/user/standard-go.md"]
}
```

`prompts/system.md` 是 Markdown，含分析师角色定位 + 核心能力 + 失败处理模板；`prompts/user/standard-<id>.md` 是 `{{var}}` 模板变量说明 + 多示例 prompt。

---

## §9 Skill ↔ Plugin 连接方式

### §9.1 声明层（`skill.json`）

```jsonc
"plugins": {
  "required": ["expression-qc", "deseq2", "volcano-plot"],   // plugin id（与 manifest.json.plugins 的 key 一致）
  "optional": ["go-kegg", "gsea"]
},
"capabilities": ["r-enrichment"]   // 由 capability 映射到 r-enrichment analysis 包
```

> 现成 skill 既有引用 plugin id（如 deg-analysis-standard），也有引用 R 包名（如 go-enrichment-analysis 中 `clusterProfiler`）。block-11 新 skill 建议统一用 **plugin id**，并在 worker execution 层把 capability 映射到 `r-enrichment` analysis bundle。

### §9.2 调度层（运行期）

```
User → Skill Executor
        ├─ 解析 parameters（parameters.required / parameters.optional）
        ├─ 按 plugins.required 顺序校验 runtime / bundle
        ├─ 对每个 plugin 调 tools.js runHook()
        │     ├─ 准备 jobDir
        │     ├─ 拷贝 inputs.csv + params.json + _petri-theme.R
        │     ├─ Rscript scripts/<id>.R <jobDir>  (或 plugin-manager 等价调用)
        │     ├─ 读 output_dir + provenance.json 校验 resultStudio / artifact manifest
        │     └─ 失败 → 触发 recovery_strategies 或 failureModes
        ├─ 串联 plugin outputs（deg_table.csv → volcano inputBinding）
        └─ 落 outputs.primary[].type 对应的 UI 卡片（plot / table / html）
```

### §9.3 二跳绑定（slot-1 上游 output → 下游 input）

| 上游 plugin | 输出 (`tool-definition.json` outputs[]) | 下游 input id | 语义（`semanticRole`） |
| --- | --- | --- | --- |
| `deseq2` | `deg_table.csv` (table), `volcano.png` (plot) | `volcano-plot`'s `deg_table` (file) | "differential_expression_table" |
| `deseq2` | `deg_table.csv` | `go-kegg` / `gsea`'s `deg_table` (file) | "gene_set_or_differential_expression_table" |
| `deg-standardizer` | `deg_table.csv`（带 `gene,baseMean,log2FoldChange,pvalue,padj` 标准列） | 所有下游火山/富集 | "differential_expression_table" |

`tool-definition.json` 内的 `inputBindings[].acceptsArtifactTypes` 显式声明上游 slot 列表，Harness 据此匹配。

### §9.4 失败传播（`failureModes` ↔ `recovery_strategies`）

- plugin 在 `failureModes[].code` 列出可恢复 / 不可恢复失败（Harness 正则匹配 `detect` 字段）。
- skill 在 `recovery_strategies[]` 用 `when: <failure_code>` 交叉引用并提供 `do / fallback / recoverable` 三段决策。

例：`deseq2.failureModes` 列 `missing_required_file_inputs` → `deg-analysis-standard` 如果声明 `recovery_strategies` 中含同名 `when` 即可接管 fallback。

### §9.5 新加 skill 的最小写法（BLOCK-11 PHASE 1-4 模板）

```text
resources/skills/<id>/
├── README.md
├── manifest.json                # skillManifestVersion=1, 内嵌 short version of skill.json
├── skill.json                   # 完整 14 字段（见 §8.2）
└── prompts/
    ├── system.md
    └── user/standard-<id>.md
```

并在顶层 `resources/skills/manifest.json` 增加条目：

```jsonc
"skills": {
  "<id>": {
    "id": "<id>",
    "version": "1.0.0",
    "source": "built-in",
    "kind": "skill",
    "category": "bioinformatics/<sub>",
    "capabilities": ["r-enrichment" | "py-single-cell"],
    "plugins": { "required": ["..."] },
    "artifacts": {
      "macos-arm64": { "url": "built-in://skills/<id>", "sha256": null }
    }
  }
}
```

### §9.6 新加 plugin 的最小写法（BLOCK-11 PHASE 1-4 模板）

```text
resources/built-in-plugins/<id>/
├── README.md
├── acceptance.json              # §5.3 三段 fixture
├── demo-data/<fixture>.csv
├── golden-revisions/result-studio-v1.json   # 只有进 Result Studio 看板时才需要
├── <id>-report-template.html
├── environment.json            # §4 模板
├── plugin.json                 # §3 模板
├── scripts/<id>.R              # §5.1 Rscript jobDir 接入
└── tool-definition.json        # §5.2 inputs/outputs/failureModes/resultStudio
```

并在顶层 `resources/built-in-plugins/manifest.json` 增加内置条目，`artifacts.macos-arm64.url = "built-in://<id>"`。

---

## 附录 A：BLOCK-11 新 plugin/skill 模板要点（3-5 条）

1. **八件套不能缺**：plugin 目录必须同时存在 `plugin.json + environment.json + tool-definition.json + scripts/<id>.R + acceptance.json + README.md + demo-data/ + <id>-report-template.html`；Result Studio class 加 `golden-revisions/result-studio-v1.json`。缺哪一件，Harness/UI/Acceptance 三处都会卡。
2. **`plugin.json` ↔ `environment.json` R 包字符串必须严格一致**（同样版本约束表达式），否则 runtime 校验和 tool-definition 渲染会出现版本漂移。
3. **R 脚本三件套要清真**：`commandArgs[1] <- jobDir`，`source(jobDir/_petri-theme.R)`，`fromJSON(file.path(jobDir,"params.json"))`，缺一会让 SCI 主题、param 输入、确定性 PNG 三件事全部塌方。生成的 PNG 末尾用 `png::writePNG(png::readPNG(f), f)` 重写以稳定 Result Studio hash。
4. **`tool-definition.json` 是 UI 二跳绑定的真相源**：`inputs[].required` + `outputs[].filename + type + interaction` + `resultStudio` + `failureModes[].detect` 全部要在 tool-definition，不要只写在 plugin.json 中。
5. **`acceptance.json` 至少 3 个 fixture**：`valid` + `missing-inputs` (expectedStatus:blocked, expectedFailureMode:missing_required_file_inputs) + `runtime-not-ready` (skipOnSupportedPlatform:true)。Enrichment 类再加 `empty-result`（`expectedStatus: valid, expectedNote: "科学空结果"`）。
6. **Skill 的 `prompts.system` 优先用相对路径**（`prompts/system.md`），内容是分析师角色定位 + 能力 + 错误处理 + 参考文献四段式，可与同一 skill 的 user prompt 模板共享 `{{var}}`。
7. **Skill ↔ Plugin 引用必须使用 plugin id 列表**（而非裸 R 包名）；如需 R 包聚合级别，引入 capability（如 `r-enrichment`）并在 worker 层映射到对应 bundle。
