# Built-in plugin acceptance — darwin-arm64

Generated: 2026-07-22T16:14:25.350Z

Production path: `production run_tool -> tool_job -> artifact truth`

Summary: **31 passed / 0 failed / 4 skipped**

| Plugin | Fixture | Result | Observed | ms | Evidence / error |
|---|---|---:|---|---:|---|
| deg-standardizer | valid | PASS | valid | 283 | - |
| deg-standardizer | empty-result | PASS | valid | 191 | - |
| deg-standardizer | no-padj | PASS | blocked | 190 | - |
| deg-standardizer | missing-inputs | PASS | blocked | 4 | - |
| deseq2 | valid | PASS | valid | 6023 | - |
| deseq2 | missing-inputs | PASS | blocked | 4 | - |
| deseq2 | runtime-not-ready | SKIP | negative runtime fixture is not applicable on supported macOS runtime | - | - |
| expression-qc | valid | PASS | valid | 425 | - |
| expression-qc | invalid-non-numeric | PASS | blocked | 329 | - |
| expression-qc | low-expression | PASS | blocked | 327 | - |
| expression-qc | missing-inputs | PASS | blocked | 3 | - |
| gene-correlation | valid | PASS | valid | 338 | - |
| gene-correlation | spearman | PASS | valid | 335 | - |
| gene-correlation | missing-inputs | PASS | blocked | 2 | - |
| go-kegg | valid | PASS | valid | 110674 | - |
| go-kegg | empty-result | PASS | valid | 41533 | - |
| go-kegg | missing-inputs | PASS | blocked | 12 | - |
| go-kegg | runtime-not-ready | SKIP | negative runtime fixture is not applicable on supported macOS runtime | - | - |
| gsea | valid | PASS | valid | 31989 | - |
| gsea | empty-result | PASS | valid | 31826 | - |
| gsea | missing-inputs | PASS | blocked | 7 | - |
| gsea | runtime-not-ready | SKIP | negative runtime fixture is not applicable on supported macOS runtime | - | - |
| pca-explorer | valid | PASS | valid | 2740 | - |
| pca-explorer | missing-inputs | PASS | blocked | 3 | - |
| sample-metadata-validator | valid | PASS | valid | 268 | - |
| sample-metadata-validator | insufficient-replicates | PASS | blocked | 242 | - |
| sample-metadata-validator | sample-mismatch | PASS | blocked | 243 | - |
| sample-metadata-validator | sample-column-missing | PASS | blocked | 242 | - |
| sample-metadata-validator | missing-inputs | PASS | blocked | 3 | - |
| volcano-plot | valid | PASS | valid | 1019 | - |
| volcano-plot | empty-result | PASS | valid | 978 | - |
| volcano-plot | missing-inputs | PASS | blocked | 3 | - |
| wgcna | valid | PASS | valid | 33365 | - |
| wgcna | missing-inputs | PASS | blocked | 3 | - |
| wgcna | runtime-not-ready | SKIP | negative runtime fixture is not applicable on supported macOS runtime | - | - |
