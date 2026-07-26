# First-success path (Week 3)

> Status: maintained as the demo/golden-path regression contract because tests and fixtures reference it. It is not the current product roadmap.

The exact steps a brand-new BioF3 desktop user needs to take to go
from "I just installed the app" to "I have a real analysis report".
Designed to be smooth, deterministic, and zero-config.

## 1. App launch

- User opens BioF3 desktop
- Land on dashboard
- See "Run your first analysis" card in the center panel

## 2. Click the card -> opens Tools page, pre-selects DESeq2

The DESeq2 tool tile is visually marked "Recommended to start" with
a one-line reason ("smallest valid demo dataset").

## 3. Click "Use sample data"

`frontend/src/pages/tools.tsx` `loadDemoForForm()` already
implements this for DESeq2 (`tools.tsx:500-535`):

- GET `/api/tools/demo-data/deseq2/demo-counts.csv`
- GET `/api/tools/demo-data/deseq2/demo-coldata.csv`
- Pre-fills `design=condition`, `contrast_ref=WT`,
  `contrast_treat=KO` (the demo fixture's conditions are WT vs KO;
  defaulting to Control/Treatment would silently produce empty
  results)

## 4. Click "Run"

- POST `/api/tools/run` with `toolId=deseq2`, base64'd files, and
  parameters
- r-server submits the job and returns a `jobId`
- Frontend polls `/api/tools/status/:jobId` every 3s

## 5. Job completes

- Status flips to `completed`
- Inline result preview shows: `X up / Y down DEGs`, top gene
  table, thumbnails of 8 plots (volcano, PCA, heatmap, etc.)
- "View report" button appears

## 6. Click "View report"

- GET `/api/tools/report/:jobId` returns the HTML report
- Renders inline with the BioF3 dark theme applied
- "Download results" link -> `all_results.zip` with all 23
  artifacts

## 7. Land in project workspace

- New project auto-created with this run
- User can re-open, re-run with different params, share

## What's checked locally (no r-server required)

- `test/demo-data.test.mjs` -- 60 assertions across 9 tools'
  built-in demo fixtures under `resources/demo-data/<tool>/`
- `test/run-json.test.mjs` -- 27 assertions on the golden-path
  `run.json` schema, plus 8 assertions on the real captured run
  fixture at
  `tmp/real-run/deseq2-job_6b3808816e0041b4.run.json`

## What still needs worker / runtime

### A. seurat-standard / wgcna / maftools-mutation demo data

These need real external datasets:
- seurat-standard -- PBMC 3k (~16 MB filtered_gene_bc_matrices
  from 10X)
- wgcna -- TCGA-BRCA expression (~tens of MB)
- maftools-mutation -- TCGA-LAML MAF (`tcga_laml.maf.gz`, 64 KB,
  gzipped)

Worker task: fetch these via `scripts/biof3-spatial-demo-data.sh`
(adapted pattern from spatial) -> `resources/demo-data/<tool>/`.

### B. Frontend onboarding wiring

`frontend/src/pages/tools.tsx` already has `loadDemoForForm()`
designed for all 11 tools, but the user-facing "Use sample data"
button is wired only for the 4 built-in plugins (deseq2,
pca-explorer, gene-correlation, volcano-plot). The other 7 tools
need the button added to the tool page template, with the
per-tool `loadDemoForForm` already implemented (see
`tools.tsx:535-800`).

### C. r-server local-mode ZIP post-processor

✅ Stage 4 已闭合。执行器在 R 脚本成功后生成 `all_results.zip`，再进入
artifact truth；DESeq2 内置插件同时复用 r-server 报告模板生成
`report.html`。`scripts/golden-path.mjs` 会读取当前报告 API 返回的 URL，
并把任务绑定到刚创建的项目沙盒。

### D. Windows validation (Week 3.5)

`release-contract.json` `platforms[2].windows-x64.supported =
false` with `reason: "no real Runtime artifact yet, awaiting
Week 3 milestone"`. The Week 3 deliverable is the macOS arm64
build artifacts; Windows follows in Week 3.5.

## Reproducing the real run locally

```bash
# 1. Start r-server in local mode (local storage, uses system R)
cd core/r-server
BIOF3_R_HOME=/Library/Frameworks/R.framework/Resources \
  R_SERVER_PORT=3003 BIOF3_TEMP_DIR=/tmp/biof3-tmp BIOF3_CACHE_DIR=/tmp/biof3-cache \
  node server.js &

# 2. Run the golden path
cd ../..  # back to repo root
R_BASE=http://localhost:3003 node scripts/golden-path.mjs --skip-install

# Expected:
# STEP 1-4: pass
# STEP 5: status=completed
# STEP 6: final-report.html written
# Result: run.json exit=passed; project sandbox contains all_results.zip
```

The JSON-only captured fixture at `test/fixtures/golden-path/deseq2-run.json`
was produced by this procedure on 2026-07-14 and serves as Week 3A evidence.
Binary archives and generated logs remain local runtime output under `tmp/`
and are not repository fixtures.

## Historical note: 2026-07-14 rescue path

After the first run on 2026-07-14, two gaps were observed:

1. Step 5 bailed when r-server marked the job `failed: Required artifact
   zip was not produced`, even though all 23 R analysis artifacts existed
   on disk.
2. Step 6 bailed when the report endpoint returned `report_source_not_found`
   for the same reason.

Both are caused by a missing zip post-processor in r-server's local mode
(r-server vendor `e2efb73` does not yet have this post-processor; vendor
HEAD == origin/main confirms this is upstream, not a local lag).

`scripts/golden-path.mjs` was updated in Week 3B with a two-stage rescue:

- **Step 5 rescue**: when `status === failed` but `/api/tools/status/:id`
  reports ≥3 artifacts in `result.files`, the script harvests the artifact
  list and continues to step 6 instead of bailing.
- **Step 6 rescue**: when `/api/tools/report/:id` returns
  `report_source_not_found`, the script falls through to a disk-artifact
  rescue path that writes a run.json with `exit:
  analysis_succeeded_zip_packaging_pending`.

Verified by re-running on 2026-07-14 against the same local r-server config
(`BIOF3_R_HOME=/Library/Frameworks/R.framework/Resources`). The new run
produced a fully-populated run.json under the local `tmp/golden-path/report/`
with 22 artifacts harvested from `/status.result.files`.

Rescue-path run.json shape remains asserted for compatibility with old installed
builds. Stage 4 evidence on 2026-07-19 completed normally in 9 seconds with
`all_results.zip`, a 1.6 MB self-contained `final-report.html`, and
`run.json exit=passed`; the rescue branch was not used.
