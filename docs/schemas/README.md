# GATE_REPORT JSON Schema 参考

> 本目录在 `DOC-GOVERNANCE-GATES / GATES-2`（2026-08-16）阶段建立，提供
> 三个门禁脚本 `--report` JSON 输出模式的强校验 schema。

## 文件清单

| Schema | 关联脚本 | 用途 |
| --- | --- | --- |
| `docs-governance-report.schema.json` | `scripts/docs-governance.mjs --report` | 文档注册 + 校验 + 冲突报告 |
| `ui-audit-report.schema.json` | `scripts/check-ui-productization-audit.mjs --report` | UI 实现与台账同步门禁报告 |
| `test-affected-report.schema.json` | `scripts/test-affected.mjs --report` | 影响范围计划 JSON 报告 |

## 契约

- **schemaVersion**: `1`（GATES-2 锁定；扩展字段在 schema v2 引入）。
- **退出码契约**: 0 / 1 / 2 与 `docs/document-governance.md` §4.5 一致；
  2 表示"分类冲突"（path 不可写 / schema 校验失败 / 影响范围 unknown）。
- **stable fields**: `schemaVersion` / `generatedAt` / `script` / `mode` /
  `exitCode` / `summary` / 各自 `issues` / `failures` / `plan`。
- **写入失败 = 分类冲突 = exit 2**；写盘前必须 schema 校验通过。
- 实际写入由 `scripts/lib/gate-report-schema.mjs` 的 `validateReport()` 负责；
  优先使用 Ajv 6.x（已是 transitive devDep），缺失时降级为内置 draft-07 子集。

## 同步引用

- canonical: `docs/document-governance.md` §3.2"JSON 输出契约" + §4.5"门禁退出码契约"
- 计划: `docs/doc-governance-gates-plan.md` §2 GATES-2 / §4 阶段定义
- skill: `$gewu-project-governance` "Run the deterministic controls"

## 后续门禁

- 使用方：CI / sub-agent / Xcode 验收脚本可通过 `--report <path>` 消费 JSON。
- 升级规则：未来 schema 扩展必须同步 `GATE_REPORT_SCHEMA_VERSION` 常量与
  `scripts/lib/gate-report-schema.mjs` 内的 Ajv 加载逻辑；契约变化须经
  `DOC-GOVERNANCE-GATES` 工作包流程裁决。
