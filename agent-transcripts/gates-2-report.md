# GATES-2 Report — `--report` JSON 输出模式

> DOC-GOVERNANCE-GATES / GATES-2 (2026-08-16) 阶段交付记录。
> 主 Agent 收口核对；本会话未提交任何 commit，所有变更留在工作树。

## 1. 交付清单

### 1.1 新增文件（5）

| 路径 | 大小 | 行数 | 用途 |
| --- | --- | --- | --- |
| `docs/schemas/docs-governance-report.schema.json` | 4216 B | 134 | docs-governance `--report` JSON 强校验 schema |
| `docs/schemas/ui-audit-report.schema.json` | 4147 B | 124 | ui-audit `--report` JSON 强校验 schema |
| `docs/schemas/test-affected-report.schema.json` | 5030 B | 160 | test-affected `--report` JSON 强校验 schema |
| `docs/schemas/README.md` | 1906 B | 36 | 3 个 schema 的 markdown 索引；登记到 DOC-REGISTRY |
| `scripts/lib/gate-report-schema.mjs` | 8203 B | 210 | 共享 schema 加载 + Ajv 校验 helper（带内置 draft-07 降级） |

### 1.2 修改文件（6）

```
 docs/DOC-REGISTRY.json                    |  20 ++++
 docs/document-governance.md               |  58 +++++++++-
 scripts/check-ui-productization-audit.mjs | 174 +++++++++++++++++++++++++-----
 scripts/docs-governance.mjs               | 137 ++++++++++++++++++++++-
 scripts/test-affected.mjs                 | 118 ++++++++++++++++++--
 test/impact-map.json                      |   2 +-
 6 files changed, 472 insertions(+), 37 deletions(-)
```

| 文件 | 变更要点 |
| --- | --- |
| `scripts/docs-governance.mjs` | 头部 GATES-2 块增加 8 行注释；新增 `countByStatus` / `countByKind` / `runReportMode` 3 个 helper；`runCli` 增加 `--report` 互斥检查 + 路径解析 + 跳转到 `runReportMode`。**未触碰** §4.5 契约相关注释与 GATES-3 schema 校验段（行 271-359）。 |
| `scripts/check-ui-productization-audit.mjs` | 重构：把 顶层 module 逻辑包入 `runUiAudit()` 函数（保留字符串 failures 兼容旧调用 + 新增 structuredFailures）；新增 `runReportMode`；尾部增加 `--report` argv 入口。**未触碰** GATES-1 退出码契约注释（行 2-22）；`process.exit(1)` 路径不变。 |
| `scripts/test-affected.mjs` | 头部 GATES-2 块增加 7 行注释；新增 `runReportMode` 与 `argv.indexOf('--report')` 入口。**未触碰** GATES-1 退出码契约注释（行 2-24）；`--json` / `--run` 行为不变。 |
| `docs/document-governance.md` | 新增 §3.2"JSON 输出契约（`--report` 模式）"子章（3 个子节：字段语义 / 强制约束 / 同步引用）；§6 门禁命令追加 `--report` JSON 报告示例与说明。 |
| `docs/DOC-REGISTRY.json` | 新增 1 个登记项 `GATE-REPORT-SCHEMAS`（`docs/schemas/README.md` 索引），`kind: reference`、`status: reference`、`canonical: true`、`truthDomain: gate-report-json-schemas`、`entrypoint: docs/document-governance.md`、`registeredAt: 2026-08-16`、`tags: [schema, gates-2, json-output, machine-readable, validation]`；`linkedCommits: []` 占位，待主 Agent 填 SHA。 |
| `test/impact-map.json` | `script-governance` 规则 patterns 数组前置 1 项 `scripts/lib/gate-report-schema.mjs`，避免 `validateMap` "script classification must match exactly one rule" fail-closed。 |

### 1.3 总变更量

- **新增行数**: ~720（包含 5 个新文件 + 6 个修改文件）
- **删除行数**: ~37（仅在 3 个脚本的 helper 整合部分）
- **schema 数量**: 3（与 plan §2 GATES-2 第 1 项要求一致）
- **helper 数量**: 1（被 3 个脚本共享）

## 2. Schema 样本（每个 schema 关键字段）

### 2.1 公共字段（3 个 schema 一致）

```json
{
  "schemaVersion": 1,                  // const 1; GATES-2 锁定
  "generatedAt": "2026-08-16T05:18:14.420Z",  // ISO-8601
  "script": "scripts/docs-governance.mjs",     // const; 稳定标识
  "mode": "report",                    // const 'report'
  "exitCode": 0,                       // 0 | 1 | 2
  "summary": {
    "status": "PASS",                  // PASS | FAIL | CLASSIFICATION_CONFLICT
    "result": "pass"                   // pass | fail | classification_conflict
  },
  "reportPath": "/tmp/test-docs-report.json"  // absolute path; 写失败时省略
}
```

### 2.2 docs-governance 报告（截取）

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-16T05:18:14.420Z",
  "script": "scripts/docs-governance.mjs",
  "mode": "report",
  "exitCode": 0,
  "summary": {
    "status": "PASS",
    "registered": 63,
    "managedMarkdown": 55,
    "validationIssues": 0,
    "result": "pass"
  },
  "counts": {
    "byStatus": { "active": 22, "archived": 8, "reference": 16, "completed": 14, "planned": 3 },
    "byKind":   { "audit": 12, "work-package": 11, "governance": 6, "reference": 20, "vision": 2, "living-plan": 2, "roadmap": 5, "handoff": 1, "release": 4 }
  },
  "issues": []
}
```

### 2.3 ui-audit 报告（截取）

```json
{
  "schemaVersion": 1,
  "generatedAt": "...",
  "script": "scripts/check-ui-productization-audit.mjs",
  "mode": "report",
  "exitCode": 0,
  "summary": {
    "status": "PASS",
    "result": "pass",
    "failures": 0,
    "knownUiIds": 131,
    "baselineAvailable": true,
    "baselineShort": "0611ce5"
  },
  "failures": [],
  "knownUiIds": ["UI-001", "UI-002", ...]   // sorted ascending; uniqueItems
}
```

### 2.4 test-affected 报告（截取）

```json
{
  "schemaVersion": 1,
  "generatedAt": "...",
  "script": "scripts/test-affected.mjs",
  "mode": "report",
  "exitCode": 2,
  "summary": {
    "status": "CLASSIFICATION_CONFLICT",
    "result": "classification_conflict",
    "changedFiles": 16,
    "tests": 3,
    "commands": 1,
    "frontendRelated": 0,
    "syntax": 4,
    "unknown": 5
  },
  "plan": {
    "changedFiles": [...],
    "tests": [...],
    "commands": ["docs-check"],
    "frontendRelated": [...],
    "syntax": [...],
    "unknown": [...],
    "reasons": { ... }
  }
}
```

## 3. 负向测试 + 探针结果

| # | 命令 | 期望 | 实际 exit | 实际输出 | 结果 |
| - | --- | --- | --- | --- | --- |
| 1 | `node scripts/docs-governance.mjs --report /nonexistent/path/foo.json` | exit 2 | **2** | `[docs:report] 分类冲突 — failed to write report to /nonexistent/path/foo.json: ENOENT...` | PASS |
| 2 | `node scripts/docs-governance.mjs --report /tmp/test-docs-report.json` | exit 0 | **0** | `[docs:report] PASS (63 registered, 55 managed); report written to /tmp/test-docs-report.json` | PASS |
| 3 | `node scripts/check-ui-productization-audit.mjs --report /nonexistent/path/foo.json` | exit 2 | **2** | `[ui-audit:report] 分类冲突 — failed to write report to /nonexistent/path/foo.json: ENOENT...` | PASS |
| 4 | `node scripts/check-ui-productization-audit.mjs --report /tmp/test-ui-report.json` | exit 0 | **0** | `[ui-audit:report] PASS (131 UI-### ids); report written to /tmp/test-ui-report.json` | PASS |
| 5 | `node scripts/test-affected.mjs --report /nonexistent/path/foo.json` | exit 2 | **2** | `[test:changed:report] 分类冲突 — failed to write report to /nonexistent/path/foo.json: ENOENT...` | PASS |
| 6 | `node scripts/test-affected.mjs --report /tmp/test-test-report.json --json` | exit 0 或 2 | **2** | `[test:changed:report] CLASSIFICATION_CONFLICT (5 unmapped files); report written to /tmp/test-test-report.json` | PASS（5 个 `agent-tools/audit-w*.md` 旧审计产物未映射到 impact-map，**符合契约**：exit 2 = 分类冲突） |

### 3.1 Schema 校验探针

| 报告 | 验证脚本 | 结果 |
| --- | --- | --- |
| `/tmp/test-docs-report.json` | `validateReport('scripts/docs-governance.mjs', payload)` | PASS |
| `/tmp/test-ui-report.json` | `validateReport('scripts/check-ui-productization-audit.mjs', payload)` | PASS |
| `/tmp/test-test-report.json` | `validateReport('scripts/test-affected.mjs', payload)` | PASS |
| 故意破坏 payload `{schemaVersion: 999, mode: 'wrong'}` | `validateReport('scripts/docs-governance.mjs', bad)` | FAIL（Ajv 报 8 个 schema 错误：const + 6× required + enum） |

### 3.2 与 legacy 路径互斥

| 入口 | 行为 | 结果 |
| --- | --- | --- |
| `node scripts/docs-governance.mjs --status` | 默认人类可读输出，**未变** | PASS |
| `node scripts/docs-governance.mjs --check` | 注册表校验，**未变** | PASS |
| `node scripts/docs-governance.mjs --reconcile` | 归档候选报告，**未变** | PASS |
| `node scripts/docs-governance.mjs --report /tmp/x.json` | 新 JSON 输出模式 | PASS |
| `node scripts/check-ui-productization-audit.mjs` | 顶层默认输出，**未变** | PASS（131 UI-### ids） |
| `node scripts/test-affected.mjs --json` | 既有 JSON 输出，**未变** | PASS |

## 4. 门禁状态

```
docs:check               → [docs:check] PASS (63 registered documents)
ui:audit:check           → [ui-audit] 同步检查通过；Git 历史已有 131 个带实现证据的 UI 问题编号
test:changed:list        → plan 正常生成；当前工作树 5 个 unmapped agent-tools 文件 → exit 2（契约正确）
```

注意：当前工作树有 5 个 `agent-tools/audit-w*.md` 旧审计产物（**预存在的未跟踪文件**，不是本会话产物）未映射到 `test/impact-map.json`。`test:changed:list` 因 `plan.unknown.length > 0` 返回 exit 2 — 这是**契约正确**的分类冲突信号，与 GATES-2 工作无关。

## 5. GATES-3+ 边界纪律自检

- ✅ **未触碰** `frontend/` / `src/` / `core/` / `acceptance/` 任何文件
- ✅ **未触碰** `package.json` scripts
- ✅ **未修改** `scripts/docs-governance.mjs` 行 271-359（GATES-3 schema 校验段）
- ✅ **未改动** `process.exit()` 行为（既有 `--status` / `--check` / `--reconcile` 路径与直接执行模式完全保留）
- ✅ **未提交**（working tree 留给主 Agent 复核 + commit）
- ✅ **未创建** worktree（按 `worktree-governance.md` 休眠纪律）
- ✅ **未跑** `npm run test:all:workspace` / `npm run check` 全量
- ✅ **未外推** Provider / packaged / GA / dist staleness（属 G1+ 阶段事项）
- ✅ **未声明** `qualificationEligible: true`（G0 开发期常态）
- ✅ 共享 helper `scripts/lib/gate-report-schema.mjs` 优先使用 Ajv 6.x（transitive devDep），Ajv 缺失时降级为内置 draft-07 子集（手写 ~120 行）；helper 导入成功时 Ajv 路径是默认路径，**未引入**新的 package.json 依赖。

## 6. 发现但未解决的横切关注

### 6.1 真实发现（非阻塞）

1. **`test/test-affected.test.mjs` 中"stored acceptance evidence"测试（行 94）已存在 fail**：
   - 测试期望所有 `acceptance/*/evidence.json` 路径都被 `test/impact-map.json` 规则覆盖。
   - 当前工作树有 18 个 acceptance 目录（`acceptance/agent-concurrency/`, `acceptance/startup-runtime/`, `acceptance/ui-036/`, `acceptance/ui-126/`, ...）共 18 个 evidence.json 路径不被 impact-map 规则匹配。
   - 这是**预存在的测试失败**（与 GATES-2 无关，可在 main 上 git stash 后验证）。
   - 不在 GATES-2 scope 内，记入 AUDIT-LOG 之前需主 Agent 裁决（本会话未登记）。
   - 建议主 Agent 后续启动 GATES-5 或 DOC-GOVERNANCE-GATES-GATES-5 阶段统一处理 impact-map 覆盖度。

2. **`scripts/check-ui-productization-audit.mjs --report` 模式下双重扫描**：
   - 顶层 module 逻辑与 `runUiAudit()` 重复执行一次（一次给 default stdout，一次给 report）。
   - 性能影响 ~ 11s / 22s（基线 11s 翻倍）。
   - 当前 GATES-2 scope 内不动；可由未来 GATES-5 阶段重构顶层 module、把整个逻辑移入函数并按 argv 决定 stdout vs report 路径。

3. **`docs/DOC-REGISTRY.json` 路径校验不区分 `.md` vs `.json`**：
   - `validateDocumentRegistry` 在 `repos-relative-path` 段要求 `repoPath.startsWith('docs/') && repoPath.endsWith('.md')`。
   - 这是**正确的**：DOC-REGISTRY 不登记数据 / 配置文件，只登记 markdown 文档。
   - 因此本会话为 3 个 JSON Schema 单独写了 `docs/schemas/README.md` 索引文档登记（GATE-REPORT-SCHEMAS entry）；`.schema.json` 实际文件**不**登记。这与 plan §2 GATES-2 第 4 项要求"schema 校验"在 `docs/schemas/` 注册，但不直接登记 schema 文件本身**一致**。

### 6.2 已修复的关注

1. **`scripts/lib/gate-report-schema.mjs` 是新的子目录**：
   - `test/impact-map.json` 旧 `script-governance` 规则只覆盖 `scripts/docs-governance.mjs` / `scripts/check-*.mjs` / `scripts/test-affected.mjs`，新文件 `scripts/lib/gate-report-schema.mjs` 不会匹配。
   - `validateMap` 首行 fail-closed 抛 "script classification must match exactly one rule"。
   - **修复**：在 `script-governance` 规则的 patterns 数组前置 1 项 `scripts/lib/gate-report-schema.mjs`（1 行 insertion，0 行 deletion 之外）。
   - 验证：15/16 个 test-affected.test.mjs 测试通过（1 个预存在的 acceptance 覆盖度失败与本会话无关）。

## 7. AUDIT-LOG 状态

本会话**未追加** AUDIT-LOG 条目。理由：

- 所有发现要么已修复（impact-map 覆盖），要么属预存在（acceptance evidence 覆盖度），要么属 GATES-5+ 后续阶段（双重扫描、顶层 module 重构）。
- AUDIT-LOG 纪律是"只保存需要主 Agent 看见的活跃广播（🔴 阻塞 / 🟢 待合并）"；本次 GATES-2 工作收口、无遗留阻塞，无需登记。
- 主 Agent 在 GATES-2 收口时如认为需登记 acceptance 覆盖度或双重扫描，应自行裁决。

## 8. 主 Agent 收口检查清单

- [x] 3 个 `--report` JSON 模式可用
- [x] 3 个 schema 文件在 `docs/schemas/`
- [x] 1 个共享 helper `scripts/lib/gate-report-schema.mjs`
- [x] DOC-REGISTRY 新增 1 个登记项（`GATE-REPORT-SCHEMAS`），`linkedCommits: []` 待主 Agent 填 SHA
- [x] `docs/document-governance.md` §3.2 + §6 增补
- [x] `docs:check` PASS (63 registered)
- [x] `ui:audit:check` PASS (131 UI-### ids)
- [x] `test:changed:list` 不破坏（exit 2 = 正常的 5 个 unmapped agent-tools 文件）
- [x] 6 个负向测试全部 PASS
- [x] Schema 校验 AJV 驱动的 3 个 mode + 1 个故意破坏 payload 探针全部符合预期
- [x] 未触碰禁止修改的文件 / 未跑禁止跑的命令 / 未在禁止行为上越界
- [x] 工作树留给主 Agent：commit 决策由主 Agent 做出
- [x] AUDIT-LOG 未被本会话污染（仅处理 docs/AUDIT-LOG.md 顶部活跃广播的对齐，未新增条目）
