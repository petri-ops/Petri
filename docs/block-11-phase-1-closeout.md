# BLOCK-11 PHASE 1 Closeout（single-cell P0）

> Closeout ID: `BLOCK-11-PHASE1-CLOSEOUT`
> Truth Domain: `block-11-bioSkills-integration`
> Status: ✅ **PHASE 1 COMPLETE** — dev Electron 边界内 verified（需运行时 install），不外推 G1+ 阶段
> Completed: 2026-08-18

---

## §1 批次概览

| # | ID | Type | Language | Runtime | Status |
|---|-----|------|----------|---------|--------|
| 1 | `scanpy-advanced` | plugin | Python | biof3-py-runtime | ✅ PHASE 1 complete |
| 2 | `seurat-standard` | plugin | R | biof3-r-runtime | ✅ PHASE 1 complete |
| 3 | `celltypist` | plugin | Python | biof3-py-runtime | ✅ PHASE 1 complete |
| 4 | `cellchat` | plugin | R | biof3-r-runtime | ✅ PHASE 1 complete |
| 5 | `scvi-tools` | plugin | Python | biof3-py-runtime | ✅ PHASE 1 complete |
| 6 | `sc-analysis-standard` | skill | — | — | ✅ PHASE 1 complete |

---

## §2 交付物清单

### 2.1 Plugin 落盘路径

#### `scanpy-advanced`
- `resources/built-in-plugins/scanpy-advanced/plugin.json`（id/scanpy>=1.9/language=python/built-against: python 3.11.9）
- `resources/built-in-plugins/scanpy-advanced/environment.json`（scanpy/anndata/matplotlib/seaborn/pandas/numpy）
- `resources/built-in-plugins/scanpy-advanced/install.json`（policy=no-install-required）
- `resources/built-in-plugins/scanpy-advanced/scripts/scanpy-advanced.py`
- `resources/built-in-plugins/scanpy-advanced/schema/input.schema.json`
- `resources/built-in-plugins/scanpy-advanced/schema/output.schema.json`
- `resources/built-in-plugins/scanpy-advanced/tool-definition.json`
- `resources/built-in-plugins/scanpy-advanced/acceptance.json`
- `resources/built-in-plugins/scanpy-advanced/demo-data/pbmc_3k_mini.h5ad`
- `resources/built-in-plugins/scanpy-advanced/tools/figures/umap_placeholder.png`
- `resources/built-in-plugins/scanpy-advanced/README.md`
- `resources/built-in-plugins/scanpy-advanced/scanpy-advanced-report-template.html`
- 顶层 `resources/built-in-plugins/manifest.json` entry

#### `seurat-standard`
- `resources/built-in-plugins/seurat-standard/plugin.json`（id/Seurat>=5.0.0/language=r/built-against: r 4.5.2/Seurat 5.4.0）
- `resources/built-in-plugins/seurat-standard/environment.json`（Seurat/SeuratObject/ggplot2/patchwork/dplyr/Matrix/jsonlite/base64enc/png）
- `resources/built-in-plugins/seurat-standard/install.json`（policy=no-install-required）
- `resources/built-in-plugins/seurat-standard/scripts/seurat-standard.R`（复用 `core/r-server/tool-scripts/seurat-standard.R` ground truth）
- `resources/built-in-plugins/seurat-standard/schema/input.schema.json`
- `resources/built-in-plugins/seurat-standard/schema/output.schema.json`
- `resources/built-in-plugins/seurat-standard/tool-definition.json`
- `resources/built-in-plugins/seurat-standard/acceptance.json`
- `resources/built-in-plugins/seurat-standard/demo-data/pbmc_3k_mini.rds`
- `resources/built-in-plugins/seurat-standard/tools/figures/umap_placeholder.png`
- `resources/built-in-plugins/seurat-standard/README.md`
- `resources/built-in-plugins/seurat-standard/seurat-standard-report-template.html`
- 顶层 `resources/built-in-plugins/manifest.json` entry

#### `celltypist`
- `resources/built-in-plugins/celltypist/plugin.json`（id/language=python/celltypist>=1.6/built-against: python 3.11.9）
- `resources/built-in-plugins/celltypist/environment.json`（celltypist>=1.6 + scanpy/anndata/numpy/pandas/scipy/matplotlib/seaborn/Pillow）
- `resources/built-in-plugins/celltypist/install.json`（policy=pip-bootstrap-install/1 step: pip install celltypist>=1.6）
- `resources/built-in-plugins/celltypist/scripts/celltypist.py`
- `resources/built-in-plugins/celltypist/schema/input.schema.json`
- `resources/built-in-plugins/celltypist/schema/output.schema.json`
- `resources/built-in-plugins/celltypist/tool-definition.json`
- `resources/built-in-plugins/celltypist/acceptance.json`
- `resources/built-in-plugins/celltypist/demo-data/pbmc_3k_mini.h5ad`（与 scanpy-advanced 共享 sha256）
- `resources/built-in-plugins/celltypist/tools/figures/annotation_placeholder.png`
- `resources/built-in-plugins/celltypist/README.md`
- `resources/built-in-plugins/celltypist/celltypist-report-template.html`
- 顶层 `resources/built-in-plugins/manifest.json` entry

#### `cellchat`
- `resources/built-in-plugins/cellchat/plugin.json`（id/language=r/requiresBundle=r-spatial/CellChat>=1.6.0/built-against: r 4.5/CellChat 1.6.1）
- `resources/built-in-plugins/cellchat/environment.json`（CellChat/Seurat/ggplot2/ggalluvial/ComplexHeatmap/circlize/igraph/NMF/BiocManager/jsonlite/base64enc/png）
- `resources/built-in-plugins/cellchat/install.json`（policy=biocmanager-install-required/1 step: BiocManager::install("CellChat")）
- `resources/built-in-plugins/cellchat/scripts/cellchat.R`（绕过 defunct SeuratObject::GetAssayData，直接传 normalized matrix；raw.use=TRUE；显式 subsetData→identifyOverExpressedGenes→identifyOverExpressedInteractions 三步）
- `resources/built-in-plugins/cellchat/schema/input.schema.json`
- `resources/built-in-plugins/cellchat/schema/output.schema.json`
- `resources/built-in-plugins/cellchat/tool-definition.json`
- `resources/built-in-plugins/cellchat/acceptance.json`
- `resources/built-in-plugins/cellchat/demo-data/pbmc_3k_mini.rds`（270 cells × 100 features × 3 cell types，set.seed(20260818)）
- `resources/built-in-plugins/cellchat/demo-data/build_demo_rds.R`
- `resources/built-in-plugins/cellchat/tools/figures/heatmap_placeholder.png`
- `resources/built-in-plugins/cellchat/README.md`
- `resources/built-in-plugins/cellchat/cellchat-report-template.html`
- 顶层 `resources/built-in-plugins/manifest.json` entry

#### `scvi-tools`
- `resources/built-in-plugins/scvi-tools/plugin.json`（id/language=python/scvi-tools>=1.0/torch>=2.0/device=cpu/built-against: python 3.11.9/scvi-tools 1.4.2/torch 2.13.0）
- `resources/built-in-plugins/scvi-tools/environment.json`（scvi-tools/torch + scanpy/anndata/numpy/pandas/scipy/matplotlib/seaborn/Pillow）
- `resources/built-in-plugins/scvi-tools/install.json`（policy=install-required/2 steps: pip install scvi-tools + pip install torch）
- `resources/built-in-plugins/scvi-tools/scripts/scvi-tools.py`
- `resources/built-in-plugins/scvi-tools/schema/input.schema.json`
- `resources/built-in-plugins/scvi-tools/schema/output.schema.json`
- `resources/built-in-plugins/scvi-tools/tool-definition.json`
- `resources/built-in-plugins/scvi-tools/acceptance.json`
- `resources/built-in-plugins/scvi-tools/demo-data/pbmc_3k_mini.h5ad`
- `resources/built-in-plugins/scvi-tools/tools/figures/latent_umap_placeholder.png`
- `resources/built-in-plugins/scvi-tools/README.md`
- `resources/built-in-plugins/scvi-tools/scvi-tools-report-template.html`
- 顶层 `resources/built-in-plugins/manifest.json` entry

### 2.2 Skill 落盘路径

#### `sc-analysis-standard`
- `resources/skills/sc-analysis-standard/skill.json`（14 字段：id/skillManifestVersion/name/version/description/category/tags/source/capabilities/plugins/workflows/prompts/parameters/recovery_strategies/outputs/metadata）
- `resources/skills/sc-analysis-standard/prompts/system.md`
- `resources/skills/sc-analysis-standard/prompts/user/standard-sc.md`
- `resources/skills/sc-analysis-standard/README.md`
- `resources/skills/manifest.json`（追加 sc-analysis-standard entry）

---

## §3 验收证据：4 治理门禁结果

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| G1: docs check | `npm run docs:check` | ✅ PASS | 121 registered documents |
| G2: UI audit check | `npm run ui:audit:check` | ⚠️ pre-existing drifts | 4 drifts (d9906fd/d08d8b1/c271010/e40313e) 为 SUB-1.1 baseline 就存在的 pre-existing drift；本批次 0 新增 drift |
| G3: manifest schema | `node --test test/plugin-manifest-schema.test.mjs` | ✅ PASS | 36 plugins validated；0 schema regressions |
| G4: smoke tests | `node --test test/*-smoke.test.mjs` | ✅ ALL PASS | 73 tests / 0 fail（cellchat: 14 + celltypist: 17 + scanpy-advanced: 14 + scvi-tools: 14 + seurat-standard: 14）|

> G2 说明：4 个 pre-existing UI drift 由更早期提交（c271010/e40313e/d08d8b1/d9906fd）引入，与 BLOCK-11 PHASE 1 本批次无关。按批次计划 §5.1 G2 GREEN 标准以"本批次 0 新增 drift"为判断依据。

---

## §4 关键技术决策记录

### 4.1 `scanpy-advanced`：选 Python 版本 / builtin scanpy>=1.9

- **决策**：直接使用 biof3-py-runtime 内置 scanpy>=1.9 + anndata>=0.9，`install.json` policy=no-install-required
- **理由**：biof3-py-runtime 基础栈已含 scanpy/anndata，不额外引入 PyPI 依赖
- **边界**：仅做 QC→HVG→PCA→UMAP→Leiden→markers，不做批次整合（批次由 scvi-tools 处理）

### 4.2 `seurat-standard`：选 R 版本 / builtin Seurat 已就位

- **决策**：完全复用 `core/r-server/tool-scripts/seurat-standard.R` ground truth，`install.json` policy=no-install-required
- **理由**：biof3-r-runtime 基础栈已含 SeuratObject/Seurat>=5.0，零增量安装
- **关键**：Seurat 5.x 语法（`NormalizeData()` vs `Normalize()`）；patchwork 导出

### 4.3 `celltypist`：选 PyPI bootstrap install celltypist>=1.6

- **决策**：`install.json` policy=pip-bootstrap-install，step= `pip install celltypist>=1.6`（biof3-py-runtime venv 内部）
- **理由**：celltypist 不在 biof3-py-runtime 基础栈（200+ 包不含 celltypist），bootstrap install 是最小侵入方案
- **边界**：不修改 biof3-py-runtime 制品本身；install 走 plugin-manager install 流程

### 4.4 `cellchat`：选 R 版本 via cellchat.R

- **决策**：`install.json` policy=biocmanager-install-required，step=`BiocManager::install("CellChat")`，script=`scripts/cellchat.R`
- **理由**：用户裁决"R 包 CellChat"；biof3-r-runtime 基础栈不含 CellChat，按 install.json 一次性补齐
- **已知 trap**（已处理）：
  - CellChat 1.6.1 `createCellChat(object=data.input)` 绕过 defunct `SeuratObject::GetAssayData`
  - `raw.use=TRUE`（默认 FALSE 时走 data.project 常触发 "no rows to aggregate"）
  - 显式三步：`subsetData` → `identifyOverExpressedGenes` → `identifyOverExpressedInteractions`（跳过后 LRsig 0 row → "subscript out of bounds"）
  - LR-family genes ≥ 100 保证至少若干 LR pair 通过 `identifyOverExpressedInteractions`

### 4.5 `scvi-tools`：选方案 B-minimal（biof3-py-runtime venv 内 pip install，不修改制品）

- **决策**：`install.json` policy=install-required，2 steps（`pip install scvi-tools` + `pip install torch`），device=cpu
- **理由**：
  - 方案 A（biof3-py-runtime 内加 PyTorch）会从 147MB 膨胀至 ~600MB，破坏 runtime 基础栈定位
  - 方案 B（venv 内 pip install）最小侵入，不修改制品，且 torch CPU 模式避免 GPU 依赖链
  - GPU/MPS 验证属于 G1+ 阶段
- **边界**：torch CPU-only；scvi-tools 1.4.2；pytorch 2.13.0

### 4.6 `sc-analysis-standard`：skill.json 14 字段 + 3 workflow variants

- **决策**：`skill.json` 完整 14 字段（capabilities/plugins/workflows/prompts/parameters/recovery_strategies/outputs/metadata）
- **capabilities**：`["py-single-cell","r-single-cell"]`
- **plugins.required**：`["scanpy-advanced","seurat-standard"]`
- **plugins.optional**：`["celltypist","cellchat","scvi-tools"]`
- **workflows.variants**：`["sc-quick-qc","sc-comprehensive-integration","sc-cell-communication-only"]`
- **recovery_strategies**：5 条（insufficient_cells / missing_required_file_inputs / batch_effect_undetectable / annotation_model_mismatch / no_significant_interactions）
- **outputs**：3 primary + 4 secondary（含 cell_cell_communication_result / scvi_latent 等 optional plugin 触发产物）

---

## §5 G0 阶段语义

> **G0 开发期常态 · 不外推 packaged/Provider/GA**
>
> 本批次所有验收均为 **dev Electron 边界内 verified**（需运行时 install），不触发 packaged / Provider / GA / MCP expose / dist staleness 等 G1+ 工作。`qualificationEligible: false` 是 G0 长期开发期常态，不写入"待办"。

---

## §6 不变量守住声明

本批次 **PHASE 1 严格遵守以下不变量**：

1. **`src/main.js`** — 61KB 主进程文件 0 diff
2. **`src/plugin-manager.js`** — 47KB 插件管理器 0 diff
3. **`src/preload.js`** / **`lib/desktopBridge.ts`** — IPC 桥接 0 diff
4. **`core/shared-backend/*`** — 共享后端 0 diff
5. **`core/r-server/*`** — R 服务器 0 diff
6. **`core/py-server/*`** — Python 服务器 0 diff
7. **既有 35 个 plugin**（plugins 33 + figcode-card 等）— 全部 0 diff
8. **既有 2 个 skill**（deg-analysis-standard / go-enrichment-analysis）— 0 diff；sc-analysis-standard 新增
9. **`biof3-r-runtime`** 与 **`biof3-py-runtime`** runtime entry — 0 diff（仅 manifest.json entries 新增）
10. **既有 acceptance.json fixtures** — 0 diff
11. **Git worktree** — 未创建，未操作（`G0-RS-WT0` deferred）

---

## §7 PHASE 2+ 预留

> **待用户裁决启动 G1+ 阶段后推进**
>
> BLOCK-11 PHASE 2+（variant-calling / bcftools+DeepVariant+Clair3）属于 G1+ 阶段候选，按当前 G0 阶段纪律暂不推进。PHASE 2 实施需用户显式裁决进入 G1+ 阶段。

| PHASE | 候选内容 | 前置条件 |
|-------|---------|---------|
| PHASE 2 | variant-calling / bcftools+DeepVariant+Clair3 | 用户显式裁决 G1+ 阶段启动 |
| PHASE 3 | pertpy deferred-to-v2（runtime 膨胀 niche 工具） | G1+ 阶段候选 |
| PHASE 4 | cassiopeia deferred-to-v2（线系追踪） | G1+ 阶段候选 |

---

## §8 治理门禁复核详情

### G1: `npm run docs:check`
```
> biof3-local@0.0.1-rc.7 docs:check
> node scripts/docs-governance.mjs --check
[docs:check] PASS (121 registered documents)
```
✅ **GREEN** — 121 registered documents，0 missing，0 orphaned

### G2: `npm run ui:audit:check`
```
> biof3-local@0.0.1-rc.7 ui:audit:check
> node scripts/check-ui-productization-audit.mjs
[ui-audit] UI 实现与审计台账不同步：
- d9906fd: UI 改动没有同步 docs/ui-productization-audit.md
- d9906fd: UI 提交信息缺少 UI-### 问题编号
- d08d8b1: UI 改动没有同步 docs/ui-productization-audit.md
- d08d8b1: UI 提交信息缺少 UI-### 问题编号
- c271010: UI 改动没有同步 docs/ui-productization-audit.md
- c271010: UI 提交信息缺少 UI-### 问题编号
- e40313e: UI 改动没有同步 docs/ui-productization-audit.md
- e40313e: UI 提交信息缺少 UI-### 问题编号
[ui-audit] UI 状态只能在实机验证后标记 verified；代码完成请先记录为 in_progress。
```
⚠️ **pre-existing drifts** — 4 个 drifts (d9906fd/d08d8b1/c271010/e40313e) 为 SUB-1.1 baseline 就存在的 pre-existing drifts；本批次 BLOCK-11 PHASE 1 **0 新增 drift**。按批次计划 §5.1 G2 GREEN 以"本批次 0 新增 drift"为判断依据。

### G3: `node --test test/plugin-manifest-schema.test.mjs`
```
[plugin-schema] repoRoot=...
[plugin-schema] validating 36 plugins
✓ manifest validates against manifest.schema.json (0 issues)
✓ manifest has 2 windows-x64 artifact(s), all with real URLs/descriptors
✓ release-contract.macos-arm64.supported is still false
✓ manifest declares 36 macos-arm64 artifacts
✓ selectArtifact(stub, 'macos-arm64') → https://github.com/BioF3/example/releases/v1/macos-arm64.zip
✓ selectArtifact(stub, 'windows-x64') throws ARTIFACT_MISSING with supportedPlatforms=[macos-arm64]
✓ 23 non-built-in URLs all match ALLOWED_RUNTIME_HOSTS
✓ Runtime archives have SHA-256/size descriptors and no stale placeholders
✓ legacy remote Runtime entry normalizes to per-platform artifacts
✓ assertAllowedUrl accepts built-in:// + whitelisted hosts, rejects others
所有 plugin-manifest-schema 检查通过
✔ test/plugin-manifest-schema.test.mjs (66.24ms)
ℹ tests 1 / pass 1 / fail 0
```
✅ **GREEN** — 36 plugins，0 schema regressions

### G4: `node --test test/*-smoke.test.mjs`
```
✔ cellchat-smoke.test.mjs        14/14 PASS
✔ celltypist-smoke.test.mjs     17/17 PASS
✔ scanpy-advanced-smoke.test.mjs 14/14 PASS
✔ scvi-tools-smoke.test.mjs     14/14 PASS
✔ seurat-standard-smoke.test.mjs 14/14 PASS
ℹ tests 73 / pass 73 / fail 0 / duration 152ms
```
✅ **GREEN** — 73 tests，0 failures，0 skipped

---

## §9 批次子任务收口汇总

| SUB | 工作包 | 状态 | 收口笔录位置 |
|-----|--------|------|------------|
| SUB-1.1 | scanpy-advanced | ✅ complete | batch-plan.md §SUB-1.1 |
| SUB-1.2 | seurat-standard | ✅ complete | batch-plan.md §SUB-1.2 |
| SUB-1.3 | celltypist | ✅ complete | batch-plan.md §SUB-1.3 |
| SUB-1.4 | cellchat | ✅ complete | batch-plan.md §SUB-1.4 |
| SUB-1.5 | scvi-tools | ✅ complete | batch-plan.md §SUB-1.5 |
| SUB-1.6 | sc-analysis-standard skill | ✅ complete | batch-plan.md §SUB-1.6 |
| SUB-1.7 | PHASE 1 closeout | ✅ complete | 本文件 |

---

*Generated: 2026-08-18 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-1 / SUB-1.7-CLOSEOUT*
