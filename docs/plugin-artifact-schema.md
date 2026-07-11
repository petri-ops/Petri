# BioF3 Plugin and Artifact Schema

This document defines the compatibility contract for Codex-style BioF3 analysis plugins.

## Plugin Tool Contract

Each runnable analysis plugin should normalize to `BioF3PluginManifest v1`.
The runtime keeps backward compatibility with the existing split files:

- `plugin.json`: install/runtime/platform metadata.
- `tool-definition.json`: form/input/output metadata.

`vendor/biof3-core/r-server/plugin-loader.js` merges both files through
`normalizePluginManifest()`, so Harness and MCP tools consume one stable
contract even while older plugins remain installable.

Each normalized runnable analysis plugin exposes:

- `id`: stable tool id, for example `deseq2`.
- `version`: plugin version used for reproducibility.
- `language`: `r` or `python`.
- `runtime`: runtime requirement, for example `{ "r": ">=4.3.0" }`.
- `supportedPlatforms`: platform capability list.
- `inputs`: UI and agent-facing parameter/input schema.
- `outputs`: expected artifact schema hints.
- `artifacts`: normalized artifact hints derived from `outputs`.
- `failureModes`: common failure modes and repair hints for Harness.

The runtime converts `inputs` into MCP `inputSchema`, and exposes `outputSchema.artifacts` to the agent through `run_tool(op="list")`.

Minimal normalized shape:

```json
{
  "pluginManifestVersion": 1,
  "id": "volcano-plot",
  "version": "1.0.0",
  "language": "r",
  "runtime": { "r": ">=4.3.0" },
  "supportedPlatforms": ["macos-arm64", "macos-x64", "windows-x64"],
  "inputs": [{ "id": "deg_table", "type": "file", "required": true, "accept": ".csv" }],
  "artifactSchemaVersion": 1,
  "artifacts": [{ "id": "volcano", "type": "plot", "label": "火山图" }],
  "failureModes": [
    {
      "code": "missing_required_columns",
      "title": "缺少必需列",
      "recoverable": true,
      "suggestedFix": "探测表头并尝试映射等价列名。"
    }
  ]
}
```

## Artifact Schema v1

Plugin scripts may write either legacy `manifest.outputs`, legacy `manifest.files`, or the normalized `artifacts` shape. The runtime normalizes all forms into:

```json
{
  "artifactSchemaVersion": 1,
  "artifacts": [
    {
      "id": "volcano_plot",
      "name": "volcano.png",
      "filename": "volcano.png",
      "type": "plot",
      "title": "Volcano plot",
      "label": "Volcano plot",
      "path": "/absolute/result/path/volcano.png",
      "preview": true,
      "download": true
    }
  ]
}
```

Supported artifact `type` values:

- `plot`: images or PDFs.
- `table`: CSV, TSV, XLS/XLSX.
- `text`: TXT, LOG, Markdown.
- `json`: structured JSON.
- `html`: HTML reports.
- `log`: execution logs.
- `file`: any other downloadable file.

## Failure Modes v1

`failureModes` are not UI copy only; they are Harness repair hints.

Each failure mode should include:

- `code`: stable snake_case id.
- `title`: short human-readable label.
- `description`: what went wrong.
- `recoverable`: whether Harness can attempt one repair.
- `suggestedFix`: concrete repair strategy.

Examples:

- `missing_required_columns`: inspect headers and map aliases.
- `sample_group_mismatch`: align sample ids by intersection.
- `top_n_too_large`: clamp parameter to available feature count.

## Reproducibility

Every completed tool job should preserve:

- `tool.id`, `tool.version`, `tool.language`.
- final confirmed `params_json`.
- `artifactSchemaVersion`.
- normalized `artifacts`.
- raw `manifest`, if emitted by the plugin.
- `stdout` tail and `error`, when available.

The project result panel consumes `artifacts` first and falls back to legacy `files`, so old plugins remain compatible while new plugins can use the standardized contract directly.

## Validation

Runnable built-in plugin manifests are validated by:

```bash
npm run harness:check
node --test test/harness-manifest.test.mjs
```

The check currently validates:

- `pluginManifestVersion`
- matching `plugin.json` / `tool-definition.json` ids
- `supportedPlatforms`
- input schema basics
- normalized artifacts
- non-empty `failureModes`
