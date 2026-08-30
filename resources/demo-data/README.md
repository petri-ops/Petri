# Demo data (Week 3 first-success path)

Per-tool demo fixtures that the desktop app's "Use sample data" button
serves and the biof3-server's `/api/tools/demo-data/:toolId/:filename` route
also serves. Used by `scripts/golden-path.mjs` and the frontend
onboarding flow.

## Layout

```
resources/demo-data/
├── README.md          ← this file
├── deseq2/            ← 10 genes × 4 samples (WT vs KO)
├── volcano-plot/      ← 25-row DEG table
├── go-kegg/           ← 68-gene SYMBOL list
├── gsea/              ← 199-row ranked list
├── km-survival/       ← 100 genes × 80 samples + 80-sample clinical
├── lasso-cox/         ← 200 genes × 80 samples + 80-sample clinical
├── bindea-immune/     ← 103 immune genes × 60 samples (Tumor/Normal)
├── cellchat/          ← 200 genes × 200 cells + 6 cell types meta
└── complexheatmap/    ← 50 HVGs × 80 samples + 6-col annotation
```

## Tool-by-tool notes

### `deseq2/` — bulk RNA-seq demo (canonical first-success path)
WT/KO contrast, 2 replicates per condition. 5 genes up in KO, 3 down in
KO, 2 housekeeping flat. Header `gene,WT_1,WT_2,KO_1,KO_2`. Filenames
match the biof3-server's `tool-demo-data/deseq2/` (legacy) and the
frontend's `loadDemoForForm()` expectations.

### `volcano-plot/` — DEG visualization
25-row table with `gene,log2FC,pvalue` columns. 10 up-significant
(|log2FC|>1, p<0.05) + 8 down-significant + 7 NS. Mirrors the existing
`resources/built-in-plugins/volcano-plot/demo-data/demo_deg.csv` shape.

### `go-kegg/` — enrichment gene list
68 curated cancer-related gene symbols. Single column `gene`.

### `gsea/` — ranked list
199 rows `gene,score` (one score per gene). Real GSEA needs ≥100
genes; 199 gives a stable run.

### `km-survival/` + `lasso-cox/`
TCGA-like synthetic data: 80 samples with `OS.time` and `OS` event
columns, plus age + stage annotations. KM has 100 genes; lasso has
200. Gene names follow `GENE001` convention for synthetic clarity.
**Note:** These are random Gaussian draws, not real survival data. Do
not cite as biological evidence.

### `bindea-immune/` — ssGSEA on immune signatures
103 immune-related gene symbols × 60 samples (30 Tumor / 30 Normal).
TPM-style values. Group file `sample,group` with 30/30 split
(satisfies the tool's "≥10 per group" requirement for box plots).

### `cellchat/` — cell-cell communication
200 curated signaling-pathway genes × 200 cells across 6 cell types
(T_cell, B_cell, NK_cell, Monocyte, DC, Platelet). Cell-type-specific
expression modulation in the data so CellChat's
`identifyOverExpressedGenes` step has signal to find.

### `complexheatmap/` — annotated heatmap
50 HVGs × 80 samples. 6-column annotation (PAM50, ER, HER2, Stage,
Age, Subtype) — note: `Subtype` is intentionally identical to
`PAM50` (a copy) so the demo exercises the "6 columns" cap exactly.

## Deferred tools

The following need real external datasets that don't belong in the
desktop repo:

- **`seurat-standard/`** — PBMC 3k (~16 MB filtered_gene_bc_matrices).
  Worker task: fetch from 10X, pre-filter to top HVGs, drop to
  ~16 MB CSV. See `docs/first-success-path.md`.
- **`wgcna/`** — TCGA-BRCA expression (218 samples × 5000 HVGs, tens
  of MB). Worker task: pull from TCGA via `biof3-spatial-demo-data.sh`
  pattern adapted to bulk.
- **`maftools-mutation/`** — TCGA-LAML MAF (`tcga_laml.maf.gz`,
  64 KB). Worker task: copy from `maftools` R package's
  `system.file('extdata', ...)` or vendor as a single small binary
  file.

## Why these are NOT vendored in the biof3-server

The biof3-server's `tool-demo-data/` tree lives at
`vendor/biof3-core/biof3-server/tool-demo-data/` and is excluded from
production deploys (`deploy.sh` lines 197, 583, 1013). Week 3 puts
fixtures in the desktop repo so the desktop app can run a full
golden-path without needing the biof3-server deployment to also have them.
In Week 4+ when the runtime artifact is wired in, the filenames here
will already match what `/api/tools/demo-data/deseq2/demo-counts.csv`
serves, so the same files Just Work in both places.

## Determinism

All CSV values are baked-in. The same input always yields the same
analysis output. This is what makes the golden-path script's
`run.json` reproducible.
