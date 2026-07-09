# BioF3 Plugin and Artifact Schema

This document defines the compatibility contract for Codex-style BioF3 analysis plugins.

## Plugin Tool Contract

Each runnable analysis plugin should expose:

- `id`: stable tool id, for example `deseq2`.
- `version`: plugin version used for reproducibility.
- `language`: `r` or `python`.
- `inputs`: UI and agent-facing parameter/input schema.
- `outputs`: expected artifact schema hints.

The runtime converts `inputs` into MCP `inputSchema`, and exposes `outputSchema.artifacts` to the agent through `run_tool(op="list")`.

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
- `file`: any other downloadable file.

## Reproducibility

Every completed tool job should preserve:

- `tool.id`, `tool.version`, `tool.language`.
- final confirmed `params_json`.
- `artifactSchemaVersion`.
- normalized `artifacts`.
- raw `manifest`, if emitted by the plugin.
- `stdout` tail and `error`, when available.

The project result panel consumes `artifacts` first and falls back to legacy `files`, so old plugins remain compatible while new plugins can use the standardized contract directly.
