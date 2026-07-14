# DESeq2 demo data (Week 3 first-success path)

These CSVs power the desktop app's "Use sample data" button under
DESeq2 and the `scripts/golden-path.mjs` end-to-end burn-in script.

## Files

- **`demo-counts.csv`** — 10 genes × 4 samples (WT_1, WT_2, KO_1, KO_2).
  Header is `gene,WT_1,WT_2,KO_1,KO_2`. All counts are integer UMI-style
  values; ranges reflect a typical bulk-RNAseq demo (high-abundance
  housekeeping genes around 4000, induced inflammatory transcripts
  around 100–1400). Not real RNA-seq — illustrative only.
- **`demo-coldata.csv`** — sample → condition table (`WT` vs `KO`,
  2 samples per condition).

## Determinism

The values are baked in so the *same* input always yields the *same*
DESeq2 output. This is what the Week 1 `release-contract.json →
goldenPath.name = "demo-deseq2-report"` describes: a predictable
first-success path used for onboarding and the golden-path script.

## Why these visible up/down genes?

- **Up in KO** (`Tnf`, `Il6`, `Ccl2`, `Cxcl10`, `Ifit1`) — roughly
  4–6× higher mean in KO vs WT. Gives DESeq2 5 DE candidates.
- **Down in KO** (`Cdkn1a`, `Cdkn2a`, `Trp53`) — roughly 3× higher
  mean in WT vs KO. Gives DESeq2 3 DE candidates in the other direction.
- **Housekeeping** (`Actb`, `Gapdh`) — flat across conditions,
  included so DESeq2 has a baseline of non-DE genes for the
  diagnostic plots.

## Layout decision

These files live under `resources/demo-data/deseq2/` (desktop repo)
rather than the r-server's `tool-demo-data/` tree because Week 3
focuses on local desktop validation and we don't want to round-trip
through the vendored r-server layout until Week 4 picks up an actual
runtime artifact. The filename contract (`demo-counts.csv`,
`demo-coldata.csv`) matches what `/api/tools/demo-data/deseq2/:filename`
serves upstream, so the same files will work once the runtime
artifact is wired in.

## Not a real dataset

Do not cite these counts in any methodological write-up. The
contrasts (WT vs KO) are a convenient 2-condition toy example, not
a real biological comparison.
