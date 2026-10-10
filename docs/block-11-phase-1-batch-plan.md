# BLOCK-11 PHASE 1 批次计划（single-cell · P0）

> Plan ID: `BLOCK-11-BIOSKILLS-INTEGRATION` (PHASE 1 子批次)
> Kind: Batch Plan
> Status: **DRAFT** — awaiting user explicit ruling to launch PHASE 1
> Parent plan: `docs/block-11-bioSkills-integration-plan-v1.0.md` (active canonical) + `agent-tools/block-11-bioSkills-integration-plan-v0.2.md` (superset)
> Truth Domain: `block-11-bioSkills-integration`
> Last Updated: 2026-08-18

---

## §0 启动前提

**本批次计划仅在以下两个条件都满足时启动 PHASE 1 实施：**

1. **用户显式裁决** BLOCK-11 vs 其他 block 顺序（BLOCK-10-ARCHITECTURE / 其他遗留候选）
2. **主 agent 复核**本批次计划 + v0.2 plan + PHASE 0 三份报告，并宣布"PHASE 1 启动令"

> 本协调任务**不实施** PHASE 1 真代码改动（无 plugin.json / skill.json / R 脚本生成）。

---

## §1 批次目标

交付 **5 个 P0 single-cell 真分析 plugin** + **1 个 single-cell 端到端 skill**，使 `single-cell` category 的 Petri 覆盖度从 `partial（4 figcode-card）` 提升至 `integrated pipeline ready`。

### 1.1 单工作包串行纪律核验

- 本批次是 BLOCK-11 **当前唯一 PHASE 1 子任务**
- 不得并行启动其他 block 的 PHASE 1（如 BLOCK-10 PHASE 1）
- 若主 agent 同时还承担其他 active 任务，需先确认 BLOCK-11 排他

### 1.2 G0 阶段纪律（v0.2 §0.6 对齐）

- 不外推 packaged / Provider / GA / MCP expose
- 不触发 artifact zip 构建 / 公证 / 签名流水
- `qualificationEligible: false` 不写入 closeout 为"待办"
- 实施仅做到"离线可执行 + manifest schema 校验 + workflow-engine discover"

---

## §2 批次清单（5 plugin + 1 skill）

### 2.1 Plugin 全表

| # | Plugin ID | Runtime | 关联 bioSkills SKILL.md（来源 `/tmp/bioSkills/single-cell/`） | 复用现有 | 八件套就位清单 |
|---|----------|---------|---------------------------------|---------|--------------|
| 1 | `scanpy-advanced` | P（py-runtime） | batch-integration / cell-annotation / doublet-detection 等 17 个 SKILL.md 中 scanpy 相关 | ✅ 复用 petri-py-runtime 内 `scanpy >=1.9` + `anndata >=0.9` | 见 §3.1 |
| 2 | `seurat` | R（r-runtime） | 单细胞 R 侧完整 pipeline | ✅ 复用 petri-r-runtime 内 `Seurat` + 已存 `core/r-server/tool-scripts/seurat-standard.R` + `_seurat-standard-scope.md` | 见 §3.2 |
| 3 | `celltypist` | P（py-runtime） | cell-annotation 中 **celltypist** 流派（自动 + 手动 annotation） | ✅ 复用 petri-py-runtime 基础栈；celltypist 本体**未装**需新增（PyPI ~10MB） | 见 §3.3 |
| 4 | `cellchat` | P（py-runtime；亦可走 R 版） | cell-communication 中 **CellChat** | ⚠️ 部分复用 py-runtime 基础栈；**liana 已通过 figcode-spatial-lr-liana artifact**就位，但 cellchat 本体未装（PyPI ~5MB） | 见 §3.4 |
| 5 | `scvi-tools` | P（py-runtime） | batch-integration / cell-annotation 中 **scvi-tools / scVI / scANVI** | ✅ 复用 petri-py-runtime 基础栈；scvi-tools 本体**未装**需新增（PyPI ~50MB，含 PyTorch 依赖） | 见 §3.5 |

### 2.2 Skill 清单

| # | Skill ID | 关联 plugin | 复杂度 |
|---|---------|-----------|-------|
| 1 | `sc-analysis-standard` | required: `[scanpy-advanced, seurat]`；optional: `[celltypist, cellchat, scvi-tools]`（按需展开 sub-pipeline） | **高**（端到端：QC → 整合 → 注释 → 通讯 → 报告） |

### 2.3 deferred-to-v2（不纳入 PHASE 1 实施范围）

| 包 | 类别 | 原因 |
|---|------|------|
| `pertpy` | Python | worker B §6.1 标注；PHASE 1 启动时 PyPI 新增 + 30MB 增量；功能重叠 scanpy-advanced；**不必要扩张 runtime** |
| `cassiopeia` | R | worker B §6.1 标注；线系追踪 niche 功能；PHASE 1 含主流 single-cell 流程；**deferred-to-v2** |
| `monocle3` / `CytoTRACE` / `scDblFinder` / `scvelo` / `squidpy` | 各种 | 已经通过 figcode-* 卡片 artifact 单独部署，**不重复打包**为 plugin |

---

## §3 各 plugin 八件套就位清单

### 3.1 `scanpy-advanced`（P · scanpy 主线高级用法）

```
resources/built-in-plugins/scanpy-advanced/
├── README.md                                # NEW
├── acceptance.json                          # NEW（valid + missing-inputs + runtime-not-ready）
├── demo-data/<fixture>.h5ad                 # NEW（AnnData 格式 demo，与 pbmc_3k_mini 同形）
├── golden-revisions/result-studio-v1.json   # OPTIONAL（Result Studio class 才需要）
├── scanpy-advanced-report-template.html    # NEW（参考 deseq2-report-template.html）
├── environment.json                         # NEW（依赖 scanpy/anndata/matplotlib/seaborn/pandas/numpy）
├── plugin.json                              # NEW（id/language=python/version/built-against/platform）
├── scripts/scanpy-advanced.py               # NEW（py 版本三件套：sys.argv[1]=jobDir + _petri-theme + params.json）
└── tool-definition.json                     # NEW（inputs: anndata_file/cell_type_col/batch_key/...; outputs: preprocessed.h5ad, marker_genes.csv, umap.png, report.html; failureModes: missing_required_file_inputs; resultStudio.semanticType=AnnDataEmbedding）
```

并更新 `resources/built-in-plugins/manifest.json`：

```jsonc
"scanpy-advanced": {
  "id": "scanpy-advanced",
  "version": "1.0.0",
  "kind": "analysis",
  "language": "python",
  "title": "Scanpy 高级分析",
  "description": "Scanpy 1.9+ 标准 single-cell 流程：QC / 归一化 / 降维 / 聚类 / 注释 / 差异",
  "artifacts": {
    "macos-arm64": { "url": "built-in://scanpy-advanced", "sha256": null }
  },
  "platforms": ["macos-arm64", "windows-x64"],
  "plugins": {
    "requires": ["petri-py-runtime"]
  }
}
```

### 3.1.x `scanpy-advanced` 实施状态（2026-08-18 SUB-1.1 收口）

> **状态**：✅ `dev Electron 边界内 verified`（G0 阶段）｜本批次计划落地条目；不外推 G1+ 阶段事项；`qualificationEligible: false` 维持。

**SUB-1.1 八件套落盘**：

| 文件 | 状态 | 备注 |
| --- | --- | --- |
| `plugin.json` | ✅ 已落 | language=python / version=1.0.0 / built-against python=3.11.9 / packages.python 含 scanpy>=1.9 + anndata>=0.9 + Pillow>=9.0 + 其它 |
| `environment.json` | ✅ 已落 | capabilities=["py-single-cell"] / runtime.policy.installInScript=false |
| `tool-definition.json` | ✅ 已落 | 8 outputs（preprocessed / marker_genes / qc_summary / umap / umap_clustered / hvg_plot / report / manifest）+ ipcChannel=`tools:invoke/scanpy-advanced` + 3 failureModes + resultStudio.semanticType=`single_cell_clustering` |
| `acceptance.json` | ✅ 已落 | 4 fixture: valid + missing-inputs + runtime-not-ready (skipOnSupportedPlatform:true) + empty-result |
| `manifest.entry.json` | ✅ 已落 | index片段，含 entryPoint 指向 scripts/scanpy-advanced.py |
| `install.json` | ✅ 已落 | `policy: no-install-required`，`steps: []`（PHASE 1 边界内 runtime 不扩展） |
| `scripts/scanpy-advanced.py` | ✅ 已落 | sys.argv[1]=jobDir + params.json 契约 + _canonicalize_png（Pillow read+save hash 稳定，与 R png::writePNG 同义） + 8 文件 output |
| `schema/input.schema.json` + `schema/output.schema.json` | ✅ 已落 | input 必填 anndata_file + 8 可选参数；output 8 enum + stats 必填字段 |
| `docs/README.md` | ✅ 已落 | 含 "dev Electron 边界内 verified" G0 阶段纪律用语；不写"待做 Provider/GA"等 G1+ 事项 |
| `scanpy-advanced-report-template.html` | ✅ 已落 | SCI 风格报告模板 |
| `demo-data/pbmc_3k_mini.h5ad` | ✅ 已落 | 270 obs × 100 vars，3 cluster with shifted mean (deterministic seed=42) |
| `demo-data/build_demo_h5ad.py` | ✅ 已落 | 上游生成脚本，n_obs=270 / n_vars=100 / seed=42 |
| `tools/figures/umap_placeholder.png` | ✅ 已落 | 312 B, sha256-prefix=`a39c050089e4`（hash 重写稳定，2 次连跑同 hash） |
| `tools/figures/generate_placeholder_figure.py` | ✅ 已落 | 用 Pillow Image.save 做 hash rewrite 的脚本 |

**顶层 manifest.json 末尾追加 scanpy-advanced 条目**：

```jsonc
"scanpy-advanced": {
  "id": "scanpy-advanced",
  "status": "canonical",
  "title": "Scanpy 高级分析",
  "version": "1.0.0",
  "kind": "plugin",
  "language": "python",
  "description": "...",
  "artifacts": { "macos-arm64": { "url": "built-in://scanpy-advanced", "sha256": null, "sizeBytes": 0 } },
  "checksumAlgorithm": "sha256",
  "packages": { "python": { "scanpy": ">=1.9", "anndata": ">=0.9", ... } },
  "runtime": { "python": ">=3.10.0" },
  "builtAgainst": { "python": "3.11.9" }
}
```

schema 校验 32 → 33 plugin entry 通过；既有 32 plugin 0 diff。

**真实可执行验证**（petri-py-runtime scanpy 1.11.5 + anndata 0.12.18，dev Electron 边界内）：

- QC + normalize + log1p + HVG + scale + PCA + neighbors + UMAP + leiden(igraph res=0.5) + rank_genes_groups(wilcoxon)
- 3 clusters × 20 markers = **60 marker rows** 全 gene names 为 `gene_NNN`，pvalue/padj 通过 wilcoxon 检验
- 8 个 output 全部写盘：`marker_genes.csv` (60 行) / `qc_summary.csv` (n=270/100/270/100/3/60) / `preprocessed.h5ad` (含 PCA+UMAP+leiden) / `umap.png` / `umap_clustered.png` / `hvg_plot.png` / `report.html` / `manifest.json`
- exit code: **0**（valid fixture 路径）

**三段 failure mode**（在 petri-py-runtime 下实测 exit code）：

| 路径 | 触发条件 | exit code | 映射 |
| --- | --- | --- | --- |
| valid | 提供 h5ad + 全部默认 params | 0 | valid |
| missing-inputs | job_dir 无 .h5ad | 3 | missing_required_file_inputs |
| runtime-not-ready | scanpy 未装（模拟） | 4 | runtime_not_ready |
| empty-result | min_genes=5000（>输入）使 QC 后 0 cell | 5 | empty_result |

**验证**：

- `node --test test/scanpy-advanced-smoke.test.mjs` 13/13 PASS（八件套结构 + schema + 4 段 fixture + PNG hash 稳定 + 顶层 manifest schema）
- `node --test test/plugin-manifest-schema.test.mjs` 1/1 PASS（既有测试 0 退化；32 → 33 plugin entry）
- `npm run docs:check` PASS（120 registered documents）
- `npm run ui:audit:check` 4 个 pre-existing UI 漂移（TitleBar fullscreen 按钮 `d9906fd / d08d8b1 / c271010 / e40313e`）属与本工作包无关（git stash baseline 同样失败）

**SUB-1.1 收口笔录**：

- 已按 G0 阶段纪律用语写为 "dev Electron 边界内 verified"；不外推 packaged / Provider / GA / dist staleness / MCP expose
- 不动 `src/main.js` / `src/plugin-manager.js` / `lib/desktopBridge.ts` / `core/shared-backend/*` / `core/r-server/*` / `core/py-server/*` 等既有文件
- 不预先启动 SUB-1.2..1.7（seurat / celltypist / cellchat / scvi-tools / sc-analysis-standard）
- 不创建 / 操作 Git Worktree（`G0-RS-WT0` deferred）
- 完整笔录：`docs/ui-productization-audit.md` 新增 "BLOCK-11 PHASE 1 SUB-1.1 收口" 节（UI-BLOCK11-SUB11）
- 不动 AUDIT-LOG.md（无新阻塞项）
- DOC-REGISTRY 不动（scanpy-advanced plugin 不是新的 closeout plan，无需登记）

**下一步**：等主 agent 复审本笔录后启动下一子批（Seurat / celltypist / cellchat / scvi-tools / sc-analysis-standard / PHASE 1 closeout），SUB-1.1 worker 不预先发起

---

### 3.2 `seurat`（R · Seurat 主线）

```
resources/built-in-plugins/seurat/
├── README.md                                # NEW（指明已复用 core/r-server/tool-scripts/seurat-standard.R）
├── acceptance.json                          # NEW
├── demo-data/<fixture>.rds                  # NEW（Seurat 对象 demo）
├── seurat-report-template.html              # NEW
├── environment.json                         # NEW（Seurat + ggplot2 + dplyr + jsonlite + base64enc + digest）
├── plugin.json                              # NEW
├── scripts/seurat.R                         # NEW（基于 _seurat-standard-scope.md 重写为 plugin 八件套脚本；保持 Petri 调度器 commandArgs+jobDir 契约）
└── tool-definition.json                     # NEW
```

**复用点**：
- 直接参考 `core/r-server/tool-scripts/seurat-standard.R` 的步骤 0 ground truth（来自 `_seurat-standard-scope.md`）
- `seurat-standard.R` 是现有 r-server 工具脚本，**不删除**，作为内部 helper/参考；新 `seurat.R` plugin 脚本是它对外暴露为 plugin 的标准八件套形式

manifest entry 与 §3.1 同形（language=r，依赖 petri-r-runtime）。

### 3.3 `celltypist`（P · 自动 + 手动 cell annotation）

```
resources/built-in-plugins/celltypist/
├── README.md
├── acceptance.json                          # valid + missing-inputs + runtime-not-ready + empty-result（细胞类型不在 model 内）
├── demo-data/<fixture>.h5ad
├── celltypist-report-template.html
├── environment.json                         # 含 celltypist 本体（PyPI 未装）
├── plugin.json                              # language=python
├── scripts/celltypist.py
└── tool-definition.json                     # inputs: anndata_file/model_name（pbmc_3k_mini 等内置）/majority_voting
```

**注意点**：
- celltypist 首次运行会下载预训练模型（`model.pkl` ~10-100MB），需评估是否预置 vs 运行时下载（PHASE 1 启动时决定；按 G0 离线优先，本批次倾向预置 artifact，或 runtime 离线白名单下载）

### 3.4 `cellchat`（P · cell-cell communication）

```
resources/built-in-plugins/cellchat/
├── README.md
├── acceptance.json                          # 含 valid + missing-inputs + runtime-not-ready + empty-result（无显著配体-受体对）
├── demo-data/<fixture>.h5ad
├── cellchat-report-template.html
├── environment.json                         # 含 cellchat 本体（PyPI 未装）
├── plugin.json                              # language=python；capabilities=["py-single-cell"]
├── scripts/cellchat.py
└── tool-definition.json                     # inputs: anndata_file/cell_type_col/species(human/mouse)/db(Category/Priority/NHC)
```

**运行时需求**：
- cellchat 依赖部分 R 包（如 CellChat for R）；推荐用 Python 版本直接通过 `anndata` 暴露对象，避免 R↔P 跨 runtime 调用
- 若选 R 版本，则 `core/r-server/tool-scripts/` 需新增 `_cellchat-scope.md`（已存在）或 `_cellchat.R` 工具脚本

### 3.5 `scvi-tools`（P · deep generative model for batch integration）

```
resources/built-in-plugins/scvi-tools/
├── README.md
├── acceptance.json                          # valid + missing-inputs + runtime-not-ready + empty-result（无显著批次差异）
├── demo-data/<fixture>.h5ad
├── scvi-tools-report-template.html
├── environment.json                         # 含 scvi-tools 本体（PyPI 未装，~50MB 含 PyTorch 依赖）
├── plugin.json                              # language=python；capabilities=["py-single-cell","requires-gpu-acceptable"]
├── scripts/scvi-tools.py
└── tool-definition.json                     # inputs: anndata_file/batch_key/layer/n_hidden/n_latent/n_layers/... ; outputs: integrated.h5ad(scvi_model), umap.png, latent.csv
```

**注意点**：
- scvi-tools 依赖 PyTorch；petri-py-runtime 当前声明只到 10 个核心包，不含 PyTorch。PHASE 1 启动时决策路径：
  - 选项 A：在 `petri-py-runtime` 增量加 PyTorch + scvi-tools（runtime 体积膨胀 ~200MB）
  - 选项 B：scvi-tools 拆独立 `petri-scvi-runtime` 子集
  - 选项 C：先做占位 stub plugin，待 v2 单独建 runtime 子集
- 决策点写在此处，PHASE 1 真实施时由主 agent 决定

### 3.6 `sc-analysis-standard` skill

```
resources/skills/sc-analysis-standard/
├── README.md                                # NEW
├── manifest.json                            # NEW（顶层索引，skillManifestVersion=1，kind=skill，category=bioinformatics/single-cell，capabilities=["py-single-cell","r-single-cell"]）
├── skill.json                               # NEW（14 字段：id/version/name/description/category/tags/capabilities/plugins/workflows/prompts/parameters/recovery_strategies/outputs/metadata）
└── prompts/
    ├── system.md                            # NEW（相对路径模式，参考 deg-analysis-standard/system.md 四段式：分析师角色 + 能力 + 错误处理 + 参考文献）
    └── user/standard-sc.md                  # NEW（多示例 prompt：QC→整合→注释→通讯→报告）
```

`skill.json` 关键字段：

```jsonc
{
  "id": "sc-analysis-standard",
  "skillManifestVersion": 1,
  "name": "标准单细胞分析",
  "version": "1.0.0",
  "description": "端到端 single-cell RNA-seq 分析：QC → 整合 → 细胞类型注释 → 细胞通讯 → 报告",
  "category": "bioinformatics/single-cell",
  "tags": ["single-cell", "scrnaseq", "scanpy", "seurat", "scvi", "celltypist", "cellchat"],
  "source": "built-in",
  "capabilities": ["py-single-cell", "r-single-cell"],
  "plugins": {
    "required": ["scanpy-advanced", "seurat"],
    "optional": ["celltypist", "cellchat", "scvi-tools"]
  },
  "workflows": {
    "default": "sc-standard-pipeline",
    "variants": ["sc-quick-qc", "sc-comprehensive-integration", "sc-cell-communication-only"]
  },
  "prompts": {
    "system": "prompts/system.md",
    "user_templates": ["prompts/user/standard-sc.md"]
  },
  "parameters": {
    "required": ["anndata_file", "species", "cell_type_column"],
    "optional": {
      "qc_method":    { "type": "select", "options": ["scanpy", "seurat"], "default": "scanpy" },
      "integration_method": { "type": "select", "options": ["none", "harmony", "scvi", "seurat-cca"], "default": "seurat-cca" },
      "annotation_method": { "type": "select", "options": ["scanpy-marker", "celltypist", "manual"], "default": "celltypist" },
      "run_cell_cell_communication": { "type": "boolean", "default": true },
      "species":      { "type": "select", "options": ["human","mouse"], "default": "human" }
    }
  },
  "recovery_strategies": [
    {
      "when": "insufficient_cells",
      "description": "过滤后细胞数过少",
      "do": "警告用户并降低 min_genes / min_cells 阈值",
      "fallback": "跳过整合步骤，仅做基本 QC",
      "recoverable": true
    },
    {
      "when": "missing_required_file_inputs",
      "description": "AnnData / RDS 文件缺失",
      "do": "提示用户提供 .h5ad 或 .rds",
      "fallback": "请求用户从上游 QC plugin 输出",
      "recoverable": true
    }
  ],
  "outputs": {
    "primary": [
      { "id": "qc_report",        "type": "html",  "label": "QC 报告" },
      { "id": "umap_plot",        "type": "plot",  "label": "UMAP 可视化" },
      { "id": "annotated_table",  "type": "table", "label": "细胞类型注释表", "format": "csv",
        "columns": ["cell_id", "leiden", "cell_type", "score"] }
    ],
    "secondary": [
      { "id": "cell_cell_communication_result", "type": "table", "requires_plugin": "cellchat",
        "label": "细胞通讯结果表" },
      { "id": "scvi_latent",       "type": "table", "requires_plugin": "scvi-tools", "label": "scVI 隐空间" }
    ]
  },
  "metadata": {
    "author": "Petri Team",
    "license": "MIT",
    "source": "built-in",
    "compatibility": {
      "min_app_version": "0.1.0",
      "platform": ["macos-arm64", "windows-x64"],
      "r_version": ">=4.4.0",
      "python_version": ">=3.10.0"
    }
  }
}
```

并在顶层 `resources/skills/manifest.json` 新增 entry。

---

## §4 批次执行顺序与依赖图

### 4.1 依赖图（plugin → skill）

```
                       ┌─────────────────────────────────────┐
                       │ sc-analysis-standard (skill)        │
                       │ ↕ plugins.required / optional        │
                       └────────────┬────────────────────────┘
                                    │
       ┌────────────┬───────────────┼───────────────┬───────────────┐
       │            │               │               │               │
   ┌───▼───┐   ┌───▼───┐   ┌───▼────────┐   ┌───▼───┐   ┌───▼────────┐
   │scanpy-│   │seurat │   │celltypist  │   │cell-  │   │scvi-tools  │
   │advanced  │   │(R)   │   │(annotation)│   │chat   │   │(deep model)│
   └────────┘   └───────┘   └────────────┘   └───────┘   └────────────┘
       │              │            │               │               │
       └──────┬───────┘            └───────────────┘               │
              │                                                    │
              ▼                                                    │
   petri-py-runtime + petri-r-runtime                              │
   （scanpy/Seurat 已就位）                                          │
                                                                  ▼
                                                       petri-py-runtime + PyTorch 增量（决策点）
```

### 4.2 推荐实施子批次（7 子批，逐批 commit + 4 治理门）

| 子批 | 内容 | 预估 commit 数 | 依赖 | 备注 |
|------|------|--------------|------|------|
| **SUB-1.1** | `scanpy-advanced` 八件套 + manifest entry | 1 | 无（py-runtime 已有 scanpy） | 最大工作量，但零 PyPI 新增 |
| **SUB-1.2** | `seurat` 八件套 + manifest entry（复用 seurat-standard.R scope） | 1 | 无（r-runtime 已有 Seurat） | 现成步骤 0，零 R 新增 |
| **SUB-1.3** | `celltypist` 八件套 + manifest entry | 1 | SUB-1.1 的 demo fixture | PyPI 新增 celltypist |
| **SUB-1.4** | `cellchat` 八件套 + manifest entry | 1 | SUB-1.1 / SUB-1.3 | PyPI 新增 cellchat；选 P 版本 |
| **SUB-1.5** | `scvi-tools` 八件套 + manifest entry + runtime 扩展决策记录 | 1 | runtime 决策（PyTorch in py-runtime vs 新子集） | **含决策文档**（写在 SUB-1.5 commit message 里） |
| **SUB-1.6** | `sc-analysis-standard` skill（skill.json + prompts/ + manifest entry） | 1 | SUB-1.1-1.5 全部 plugin 已就位 | skill→plugin 跨 ID 引用 |
| **SUB-1.7** | audit + closeout（4 治理门 + closeout 报告） | 1-2 | SUB-1.6 完成 | 收口，不外推 G1+ |

**总预估**：6-7 commit，~2500-3500 行新文件（plugin + skill 八件套平均 ~200-400 行/插件）

### 4.3 跨 SUB 验证

- 每 SUB commit 后：`npm run docs:check` + `npm run ui:audit:check`（继承基线）
- SUB-1.6 skill 提交后：`node --test <manifest schema>` + 手工调 `discover()`
- SUB-1.7 收口：4 治理门全部 GREEN + closeout 报告

---

## §5 验收语义

### 5.1 单 plugin 验收（每个 SUB 都跑）

- `plugin.json` 通过 `resources/built-in-plugins/manifest.schema.json` schema 校验
- `environment.json` R/Python 包字符串与 `plugin.json.packages` **严格一致**（同 deseq2 模式）
- 至少 3 fixture：`valid` + `missing-inputs (blocked)` + `runtime-not-ready (skipOnSupportedPlatform:true)`
- enrichment / annotation 类 plugin 另加 `empty-result`（celltypist / cellchat / scvi-tools 均适用）
- R/Python 脚本满足三件套：`commandArgs[1]` = jobDir（Python 用 `sys.argv[1]`）；`_petri-theme.R` source；`fromJSON(file.path(jobDir,"params.json"))`（Python 用 `json.load(open(...))`）
- 末尾 PNG 重写：`png::writePNG(png::readPNG(f), f)`（R）；Pillow 等价（Python）

### 5.2 单 skill 验收

- `skill.json` 通过 `core/shared-backend/skill-schema.js` 校验
- `plugins.required` / `plugins.optional` 必须用 **plugin id**（与 manifest.json plugins 的 key 一致），不是 R 包名
- `prompts.system` 优先相对路径 `prompts/system.md`
- `recovery_strategies[].when` 与 plugin `failureModes[].code` 至少 1 处显式交叉引用

### 5.3 批次整体收口（SUB-1.7）

- 5 plugin + 1 skill 全部通过各自 schema
- `skill-registry.js discover()` 输出包含全部新增条目
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（无 UI 改动）
- `npm run docs:reconcile` 0 issues
- `tsc --noEmit` 0 errors
- closeout 报告：`docs/block-11-bioSkills-integration-closeout-ph1.md`（或合并入 PHASE 1-5 整体 closeout）

---

## §6 风险与依赖

### 6.1 SUB-1.5 runtime 扩展决策（关键决策点）

PHASE 1 SUB-1.5 启动前，**主 agent 必须在 SUB-1.5 commit message 内显式声明**：
- scvi-tools 走方案 A（在 `petri-py-runtime` 增量加 PyTorch）
- 还是方案 B（新建 `petri-scvi-tools-runtime` 子集）
- 还是方案 C（占位 stub plugin 留 v2）

**当前本批次计划倾向**：方案 B（新建子集），理由：
- 避免 petri-py-runtime 体积膨胀（当前 147MB → 含 PyTorch 后 ~600MB）
- 维持 petri-py-runtime "通用 numpy/pandas/scipy/sklearn/scanpy" 基础栈定位
- scvi-tools 是 niche deep learning 工具，独立子集更可持续维护

### 6.2 pertpy / cassiopeia 显式 deferred-to-v2

PHASE 1 真实施时在 SUB-1.7 closeout 笔录里**一次性**写："pertpy / cassiopeia deferred-to-v2"，**不**作为"未做"或"待办"。

### 6.3 模板与参考

PHASE 1 实施参照：
- 最复杂 R plugin：`resources/built-in-plugins/deseq2/`（八件套全齐 + acceptance.json 三段 fixture + RNG 主题）
- enrichment 类 plugin：`resources/built-in-plugins/go-kegg/`（含 `requiresBundle` 机制）
- 最完整 skill：`resources/skills/deg-analysis-standard/`（含 system.md / user/standard-*.md）
- 现成 Seurat 工具：`core/r-server/tool-scripts/seurat-standard.R` + `_seurat-standard-scope.md`

### 6.4 并行风险

- 单工作包串行纪律：BLOCK-11 PHASE 1 启动期间不并行开 BLOCK-10 PHASE 1 或其他 block PHASE 1
- pertpy / cassiopeia 不并行实施（在同一批次计划下防止 runtime 体积叠加）
- 已存 `seurat-standard.R` / 现有 figcode-* 卡片 / 现有 2 skill **0 diff**

### 6.5 G0 阶段纪律硬约束（不可触碰）

- 不做：packaged artifact 构建 + 公证 + 签名
- 不做：Provider 矩阵 / OSS 远程分发
- 不做：GA 公证流水线
- 不做：MCP Server 把新 plugin 暴露为 `tools/list` 项（skill-runtime 已足够）
- 不在 closeout / AUDIT-LOG 反复写"qualificationEligible 维持 false" / "未做 Provider" / "未做 GA"
- 实施用语：`dev Electron 边界内 verified` / `packaged 边界内 verified` = 当前阶段最高证据等级

---

## §7 启动检查清单（主 agent 启动前必跑）

- 用户显式裁决 BLOCK-11 PHASE 1 vs 其他 block 顺序
- 主 agent 读毕：`v0.2 plan` + 本批次计划 + PHASE 0 三份报告
- PHASE 0 三份报告收录至 active 工作包证据链（按 AUDIT-LOG 收口登记规则）
- SUB-1.5 runtime 决策提案（A / B / C）已给出
- 若选 B：`petri-scvi-tools-runtime` 子集的 artifact 设计文档 v0.1 已写到 `agent-tools/` 候选路径
- DOC-REGISTRY 同步：本批次计划登记为 BLOCK-11 sub-entry

---

## §8 收口语义（本批次完成 = 全部以下成立）

- SUB-1.1 至 SUB-1.7 全部 commit 落地
- 5 plugin + 1 skill 全部通过 schema 校验
- `skill-registry.js discover()` 输出包含全部新条目
- 4 治理门 GREEN（docs:check / ui:audit:check / tsc / docs:reconcile）
- `core/shared-backend/*` + `src/preload.js` + `electron.d.ts` + `desktopBridge.ts` 0 diff
- petri-r-runtime / petri-py-runtime 基线 manifest 0 diff（除非 SUB-1.5 选中 A 或 B 触发增量）
- G0 阶段纪律守住（不外推 packaged / Provider / GA / MCP expose）
- closeout 报告 + DOC-REGISTRY `BLOCK-11-BIOSKILLS-INTEGRATION` 状态更新

---

## §9 协调 worker 留痕

- 本批次计划由 BLOCK-11 PHASE 1 协调 worker 生成（v0.2 plan 同一协调任务）
- 生成时间：2026-08-18
- 本协调任务**未实施**任何真代码改动；只产出 plan + 批次计划 + 汇总报告
- 主 agent 后续动作：复核本批次 + v0.2 plan + 用户裁决请求

