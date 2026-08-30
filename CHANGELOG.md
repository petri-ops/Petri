# Changelog

All notable changes to the BioF3 desktop app are documented in this
file. The format is based on [Keep a Changelog](https://keepachangelog.com/).

## Week 4 (2026-07-14) -- RC Gate 1 close-out + Gate 4 macOS DMG + release CI

### Added

- `release-contract.json` + `frontend/src/lib/releaseContract.ts` --
  typed contract for positioning, golden path, platform matrix, GA bar
- `resources/built-in-plugins/manifest.schema.json` +
  `manifest.placeholders.json` -- schema-validated per-platform plugin
  manifest
- `resources/built-in-plugins/deseq2/` -- bundled deseq2 plugin with
  R script, tool definition, plugin.json and demo data
- `frontend/src/styles/theme-token-contract.test.ts` -- theme token
  contract coverage
- `AGENTS.md` + `frontend/AGENTS.md` + `.cursorignore` -- AI agent
  entry points and context scope
- `icons/biof3-logo-concept-v1.{svg,png}` -- brand concept for
  rc.1 packaging
- `.github/workflows/release.yml` -- tag-driven dual-platform build
  (`macos-14` arm64+x64 dmg, `windows-latest` x64 NSIS) +
  SHA-256SUMS aggregation + GitHub prerelease publish

### Changed

- `frontend/src/App.tsx` -- single-cell / spatial / tutorials
  independent routes closed; desktop lands on dashboard, project
  workspace, tools, admin
- `frontend/src/components/desktop/DesktopOnboarding.tsx` -- dropped
  "learn / practice" dual-mode framing; copy aligned to beta
  positioning
- `frontend/src/pages/tools.tsx` -- trimmed page-level state,
  consistent with collapsed routes
- `src/plugin-manager.js` -- per-platform artifact resolution backed
  by `manifest.schema.json`
- `electron-builder.yml` + `build/afterSign.js` +
  `build/entitlements.mac.plist` -- rc.1 macOS arm64 / x64 + Windows
  NSIS pipeline and notarize entitlements
- `package.json` -- registered golden-path script; replaced dead
  `build:site` (cd .. && npm run build:desktop) with no-op echo

### Fixed

- `electron-builder.yml` -- drop `mac.afterSign` (24.x rejects the
  property; top-level `afterSign` already covers the hook)
- `package.json` -- `build:site` no longer breaks the mac/win build
  chain

### Gate progress

- **Gate 1 -- source/version close-out: closed.** Working tree
  clean, submodule pointer = `e2efb73` matching `.vendor-lock`,
  `scripts/sync-vendor.sh check` OK. Split into 4 commits:
  meta / release-contract / desktop-collapse / docs+tests.
- **Gate 4 -- macOS DMG arm64 + x64: closed locally.** Desktop
  commit `ae31106`, rebuilt 2026-07-14. SHA-256:
  - arm64 dmg `eeff399dbe13332278b4d3f2136e8788d87a0a4515761464edb001f479a05e2c` (188.6 MB)
  - x64   dmg `90f514b64feec9a51b1c3fefa098162dcc1c7832924c79f9b519d1a629872585` (193.0 MB)
- **Gate 4 -- Windows NSIS, macOS notarize, Windows code sign:
  blocked on secrets.** Requires `WIN_CSC_LINK` /
  `WIN_CSC_KEY_PASSWORD` and macOS
  `MAC_CSC_NAME` + `APPLE_ID` + `APP_PASSWORD` + `NOTARIZE_TEAM_ID`
  in repo secrets, then a `git push v0.0.1-rc.1` will exercise the
  new `.github/workflows/release.yml` end-to-end.


## Week 4.1 (2026-07-15) -- Post-Gate-4 polish (local, not pushed)

### Changed

- `frontend/vite.config.ts` -- `manualChunks` 改为函数式，新增
  `ui-vendor` (xterm + highlight.js + infima, 504KB)、
  `markdown-vendor` (mdx/remark/rehype 栈, 76KB)、
  `vendor` (其余第三方, 105KB)。主入口 `index-*.js` 从 1.1 MB
  降至 **404 KB**（−63%）。
- `frontend/src/pages/single-cell/_AdminPanel.tsx` -- 第 544 行
  原 `await import('@/lib/authClient')` 改为顶部静态 import；
  消解 Vite "dynamically imported but also statically imported"
  警告；try/catch 容错语义保留。

### Known carry-over (下个 PR 单独评审)

- `Circular chunk: vendor ↔ react-vendor / markdown-vendor` -- 跨
  chunk 引用导致 HTTP 多一次往返，收益 < 风险。
- `ui-vendor` 504KB 超 500KB 警告线 -- 实际是 xterm 占 477KB；
  拆需改 `useTerminalSession.ts` 为 lazy import + 改
  `useTerminalSession.test.ts` 的 `vi.mock`，超出本 PR 范围。

### Verification

- `npm --prefix frontend run build` exit=0
- `npx tsc -b` exit=0
- `npm --prefix frontend test` 19 files / 147 tests passed
- 工作树 `git status --short` 干净（commit 后）

## Week 3 (2026-07) -- First-success path

### Added

- `resources/demo-data/<tool>/` demo fixtures for 9 of 11 built-in
  tools. Each fixture matches the file shape expected by the
  corresponding biof3-server `tool-scripts/<tool>.R`:
  - `deseq2/` -- 10-gene counts (5 up + 3 down + 2 housekeeping) +
    WT/KO coldata (2 reps each)
  - `volcano-plot/` -- 25-row DEG table (10 up + 8 down + 7 NS)
  - `go-kegg/` -- 68-gene SYMBOL list
  - `gsea/` -- 199-row ranked list
  - `km-survival/` -- 100 genes x 80 samples + clinical
    (OS.time / OS / age / stage)
  - `lasso-cox/` -- 200 genes x 80 samples + clinical
  - `bindea-immune/` -- 103 immune gene symbols x 60 samples
    (Tumor / Normal, 30/30)
  - `cellchat/` -- 200 signaling genes x 200 cells across 6 cell
    types (T, B, NK, Mono, DC, Platelet)
  - `complexheatmap/` -- 50 HVGs x 80 TCGA-BRCA-like samples
    with 6-col annotation (PAM50 / ER / HER2 / Stage / Age /
    Subtype)
- `resources/demo-data/README.md` -- tool-by-tool notes for
  each fixture, including deferred tools (seurat-standard /
  wgcna / maftools-mutation) that need real external datasets.
- `scripts/golden-path.mjs` -- emits `<base>.run.json`
  (schema `biof3/golden-path-run.v1`) alongside the HTML
  report, capturing tool / job / project / params / inputs /
  outputs / contract / duration.
- `test/demo-data.test.mjs` -- 60 assertions across the 9 demo
  tools (file presence, schema, dimensional constraints,
  up/down regulation sanity checks).
- `test/run-json.test.mjs` -- 27 assertions on the run.json
  schema + 8 assertions on the JSON-only captured run fixture
  (`test/fixtures/golden-path/deseq2-run.json`).
- `docs/first-success-path.md` -- end-to-end walkthrough of the
  user journey + reproduction steps for the captured real run.
- `test/fixtures/golden-path/deseq2-run.json` -- JSON-only record
  of the real captured run from 2026-07-14: DESeq2 on the biof3-server's bundled demo
  data, 6 samples, 1978 genes tested, 82 sig genes (46 up / 36
  down), 23 artifacts.

### Fixed

- `test/demo-data.test.mjs` -- corrected two pre-existing bugs
  in the draft: REPO_ROOT was 2 levels too deep, and sample-
  column indices in the deseq2 block were off by 1 (pointed at
  the gene name column, not the sample value).

### Known issues / deferred

- **seurat-standard / wgcna / maftools-mutation demo data** --
  require real external datasets (PBMC 3k, TCGA-BRCA, TCGA-LAML
  MAF). Worker task required.
- **biof3-server local-mode zip post-processor** -- the biof3-server
  marks a job `failed: Required artifact zip was not produced`
  in `BIOF3_EXEC_MODE=local`, even when all 23 R-output
  artifacts exist on disk. This blocks the report endpoint
  (`/api/tools/report/:id` returns 502) and therefore blocks
  Step 6 of the golden path. Real DESeq2 analysis is verified
  to complete end-to-end in local mode (see
  `tmp/real-run/`).
- **Frontend "Use sample data" button** -- `loadDemoForForm()`
  is implemented for all 11 tools in
  `frontend/src/pages/tools.tsx:500-800`, but the user-facing
  button is currently wired only for the 4 built-in plugins
  (deseq2, pca-explorer, gene-correlation, volcano-plot). Needs
  UI wiring for the other 7.
- **Windows validation** -- per `release-contract.json`,
  Windows is `supported: false` until Week 3.5 ships a real
  runtime artifact.

## Week 2 (2026-06) -- Prior milestones

(See git history; earlier changelogs not in this file.)

## Week 3B (2026-07-14) — Golden-path rescue path

### Added

- `scripts/golden-path.mjs` — two-stage rescue path for the local-mode
  zip post-processor gap:
  - Step 5: if biof3-server marks a job `failed: Required artifact zip was
    not produced` but `/api/tools/status/:id` shows ≥3 artifacts on
    disk, harvest the artifact list and continue to step 6 instead of
    bailing.
  - Step 6: if `/api/tools/report/:id` returns
    `report_source_not_found`, fall through to a disk-artifact rescue
    that writes run.json with `exit:
    analysis_succeeded_zip_packaging_pending`.
- `test/run-json.test.mjs` — added 10-assertion rescue-schema block
  asserting the new exit code shape (`html: null`, `htmlBytes: 0`,
  `summary.sig_genes` as number, etc.).
- `tmp/golden-path/report/deseq2-job_51d05ccdece3450c.run.json` —
  real captured run from the modified script on 2026-07-14 against
  the same biof3-server local-mode config; 22 artifacts, sig_genes=82,
  up=46, down=36.
- `docs/first-success-path.md` — append `Update 2026-07-14: rescue
  path landed` section documenting the two-stage rescue and the
  upstream status of the zip post-processor (vendor `e2efb73` ==
  origin/main, gap is upstream).

### RC Gate 2 (2026-07-14) — 生产依赖安全已通过

#### Re-audited

- 根项目 + 前端两条 `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`
  均退出 0、报告 0 vulnerabilities。Gate 2 通过。
- 根项目 `dependencies` 仅含 `@electron/notarize` / `@modelcontextprotocol/sdk` / `archiver` /
  `better-sqlite3` / `electron-updater` / `extract-zip` / `node-pty`，无 jspdf / glob / tar。
- 前端 `dependencies` 不含 jspdf / glob / tar / happy-dom。

#### Known dev-only high (NOT in Gate 2 scope)

不限定 `--omit=dev` 时，审计会报告 devDependencies 链路中的 high：

- 根项目：`electron-builder@24.13.3` → `app-builder-lib` → `tar@<7.5.15`（GHSA-34x7-hfp2-rc4v 等）；
  `electron-builder` → `read-config-file` → `config-file-ts` → `glob@7.2.3`
  （GHSA-5j98-mcp5-4vw2 命令注入）。
- 前端：`vitest` → `@vitest/mocker` → `vite@<6.4.2` → `esbuild@<0.24.2`
  （GHSA-67mh-4wv8-2f99 dev server 任意请求）；
  `vitest` → `happy-dom@<20.10.6`（GHSA-96g7-g7g9-jxw8 critical 等）。

这些都在发布/构建/测试链路，不进入生产镜像；修复路径都需要破坏性升级
（electron-builder@26 / vite@8 / happy-dom@20.10.6），按 RC "不重写构建工具链"
原则不强制升级；登记到 `knownLimits` / 后续清理项，不阻塞 RC。
