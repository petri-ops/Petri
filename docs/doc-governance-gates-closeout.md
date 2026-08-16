# DOC-GOVERNANCE-GATES — 工作包收口记录

最后更新：2026-08-16

状态：`completed / implemented`（GATES-0~GATES-4 五阶段全部完成，2026-08-16 用户裁决启动同日收口）

主模块：`docs/` 治理栈 + `scripts/` 治理门禁

影响模块：`docs/document-governance.md`、`docs/DOC-REGISTRY.json`、`docs/schemas/`、`scripts/docs-governance.mjs`、`scripts/check-ui-productization-audit.mjs`、`scripts/test-affected.mjs`、`scripts/lib/gate-report-schema.mjs`、8 份 docs Markdown、4 份 archive 文件

关注点：`C-01` 文档治理、`C-02` 门禁工程化

进入条件：`docs:check` 62 registered PASS、`ui:audit:check` 131 UI 编号 PASS、工作树 clean（领先 origin/main 2 commit 已 push，2026-08-16 上午）。

## 1. 决策结论

`DOC-GOVERNANCE-GATES` 工作包（Plan ID `DOC-GOVERNANCE-GATES`，canonical `docs/doc-governance-gates-plan.md`）是经用户裁决 2026-08-16 启动的独立治理工程工作包，定位为 `docs/` 治理栈工程化收口与门禁硬化。它不修改 UI 组件、不修改 Electron 主进程、不修改核心后端、不修改 acceptance evidence、不外推 Provider / packaged / GA / GA 公证流水 / dist staleness。

五阶段全部完成：

| 阶段 | commit | 范围 | 验证 |
| --- | --- | --- | --- |
| 启动 | `a363105` | plan 落地 + DOC-REGISTRY 1 项登记 + README / roadmap / handoff / AUDIT-LOG 同步笔录 | docs:check 62 → ui:audit:check 131 |
| GATES-0 | `1b7ce3e` | `scripts/check-ui-productization-audit.mjs` 新增 `UI_AUDIT_HOOKS_WHITELIST`（hooks/ 15 文件白名单 + `frontend/src/hooks/` 前缀） | hooks/ probe exit 0；components/ probe FAIL（未误伤） |
| GATES-1 | `76e0f75` | 3 个门禁脚本顶部退出码契约注释（0=PASS / 1=FAIL / 2=分类冲突）；`docs/document-governance.md` §4.5 新增"门禁退出码契约"表格 + 语义说明 | 契约不变；仅文档化 |
| GATES-2 | `1049ac5` + `d4822ea` | 3 个门禁脚本支持 `--report <path>` JSON 输出模式；`docs/schemas/{docs-governance,ui-audit,test-affected}-report.schema.json` 3 个 JSON Schema（draft-07，schemaVersion=1）；共享 helper `scripts/lib/gate-report-schema.mjs`（Ajv 6.x 优先 + 内置 draft-07 降级）；`docs/schemas/README.md` 索引；`docs/document-governance.md` §3.2 / §6 同步 | 3 个 schema 全部通过 `validateReport()` 校验；写盘前 schema 校验失败 → exit 2（分类冲突） |
| GATES-3 | `c1ce38c` | `docs/document-governance.md` §3.1 扩展字段填法与一致性约束 6 子节（`registeredAt` / `linkedCommits` / `tags` / `supersededBy` / `notes` / 字段一致性联动）；脚本侧 `validateDocumentRegistry` 强制 `archived/superseded` 状态无 `truthDomain`；plan §2.2 笔误修正（`test-impact-map.mjs` → `test-affected.mjs`） | docs:check 63 registered PASS |
| GATES-4 | `aea70a6` + `c552100` | 8 份 docs Markdown 头部 / 行内修订（v1-productization-roadmap / macos-oss-auto-update / stage4-stable-release-checklist / codex-style-workbench-direction / harness-engine-spec / harness-roadmap / agent-workbench-enhancement-plan §5 ID 互引 + README Skills 入口图）；4 份 archive 文件首段加"已被 X 吸收"声明（model-provider-audit / ui-035-064-real-acceptance / stage2-acceptance-audit / stage3-m1-audit） | docs:check PASS；不删 archive 文件；不动 acceptance evidence |

GATES-3 主要改动（schema 校验 + 文档化）已合并入 GATES-1 commit `76e0f75`（子代理并发写盘），本笔误修正 commit 独立保留收口可追溯性。

固定证据等级：

- `npm run docs:check`：**63 registered documents PASS**（GATES-0 阶段 62 → GATES-3 阶段 63，因 archive 状态 truthDomain 校验启用后无新增登记项）
- `npm run ui:audit:check`：**131 UI 编号 PASS**（未变化）
- `npm run docs:reconcile`：`0 unregistered / 0 archive candidates / 0 manual review / 0 validation issues`（无候选需要人工处置）
- GATES-2 `--report` 模式：3 个脚本各自产出一份 schema-valid JSON 报告，由 `scripts/lib/gate-report-schema.mjs` 的 `validateReport()` 强校验。

继续运行：3 个常驻门禁脚本（`docs:check` / `ui:audit:check` / `test:changed:list`）的退出码契约不变（0=PASS / 1=FAIL / 2=分类冲突）。`--report` 模式仅在调用方显式传入 path 时启用；本工作包不引入 `npm run docs:report` / `npm run ui:report:json` 便利脚本（`package.json` 不在本工作包可写范围内；直接 `node scripts/{docs-governance,check-ui-productization-audit,test-affected}.mjs --report <path>` 已可用）。

## 2. 唯一真理链

```text
docs/ 治理栈工程化
  → scripts/docs-governance.mjs（注册表管理 + 校验 + 状态报告）
  → scripts/check-ui-productization-audit.mjs（UI 实现与台账同步门禁）
  → scripts/test-affected.mjs（受影响定向测试）
  → scripts/lib/gate-report-schema.mjs（共享 JSON Schema 校验 helper）
  → docs/schemas/{gate}-report.schema.json（draft-07 机器可读）
  → docs/DOC-REGISTRY.json（active/reference + 1 work-package completed）
  → docs/document-governance.md §3.1 / §3.2 / §4.5（canonical 规范）
  → docs/AUDIT-LOG.md（非主 Agent 广播入口）
```

不得把 GATES-0~GATES-4 改装为第二套文档真理或测试门禁；工作包不创建第二套 executor / job / artifact / workflow truth。

## 3. 实施时间线

| 日期 | commit | 阶段 | 关键决策 |
| --- | --- | --- | --- |
| 2026-08-16 | (上游) | 5-worker 审计 | W1 / W3 / W4 / W5 落 `agent-tools/audit-w{1,3,4,5}-*.md`；P1.A（4 处数据漂移）+ P2（IDE 改造方向归档 3 文件）+ P3（10 个无引用 archive 文件清理 ~132 KiB + DOC-REGISTRY BRANCH-HANDOFF 移除）均已收口并 push |
| 2026-08-16 10:18 | `a363105` | 启动 | 用户裁决启动工作包；plan 落地 + DOC-REGISTRY 1 项登记 + 4 入口同步 |
| 2026-08-16 12:02 | `aea70a6` | GATES-4 batch 1 | 4 份 release docs 头部 / 行内修订（rc.5 → rc.7 历史漂移修正） |
| 2026-08-16 12:06 | `c552100` | GATES-4 batch 2 | 4 份 docs + 4 份 archive 文件首段吸收声明 |
| 2026-08-16 12:26 | `1b7ce3e` | GATES-0 | hooks/ 白名单 + 15 文件清单 |
| 2026-08-16 12:26 | `76e0f75` | GATES-1 + GATES-3 主改动 | 退出码契约注释 + GATES-3 扩展字段文档化 + schema 校验增强（合并提交） |
| 2026-08-16 12:37 | `c1ce38c` | GATES-3 笔误修正 | plan §2.2 文件名笔误 (`test-impact-map.mjs` → `test-affected.mjs`) |
| 2026-08-16 13:29 | `1049ac5` | GATES-2 主提交 | 3 个门禁脚本 `--report` JSON 输出模式 + 3 个 JSON Schema + 共享 helper |
| 2026-08-16 13:30 | `d4822ea` | GATES-2 收口补登 | DOC-REGISTRY `GATE-REPORT-SCHEMAS` linkedCommits 占位补 SHA |
| 2026-08-16 14:00 | (本笔录) | 收口 | docs:check / ui:audit:check / docs:reconcile 全 PASS；DOC-REGISTRY status → completed；AUDIT-LOG 收口登记 |

## 4. 收口笔录判定

按 plan §5 验收门：

- 阶段内：每个 GATES-N commit 单独 `git diff --stat` 可核对；`docs:check` 与 `ui:audit:check` 始终 PASS。
- 收口前：`docs:check` 63 PASS / `ui:audit:check` 131 PASS / `docs:reconcile` 0 issues。
- 收口时：DOC-REGISTRY `DOC-GOVERNANCE-GATES` status `active → completed`（保留 `kind: work-package` / `canonical: true` / `truthDomain: docs-governance-gates` / `archivePolicy: retain_stable_path`，不动台账）；AUDIT-LOG 写一条 `已收口` 条目；canonical handoff / roadmap 同步指针；plan 顶部状态 `active / planned → completed / implemented`。
- 收口后：本文档保留为 canonical 收口记录；plan `docs/doc-governance-gates-plan.md` 保留，`archivePolicy: retain_stable_path`（不为追求目录整洁迁移到 archive）。

## 5. 留待未来 / 不外推

本工作包不外推 Provider / packaged / GA / dist staleness，这些属 G1+ 阶段事项。G0 开发期纪律段（`AGENTS.md` §"当前阶段纪律"）保持不变：

- `qualificationEligible: false` 是 G0 开发期常态事实，不构成缺陷、不是待办。
- `run_tool → tool_job → artifact truth` 仍是唯一执行真相。
- P7 继续 deferred；不重开 RS-P7 / P7-F / GA 公证流水。

## 6. 证据清单

- Plan canonical：`docs/doc-governance-gates-plan.md`（154 行，9 章节，状态 `active / planned` 在收口完成后变 `completed / implemented`）。
- 收口本笔录：`docs/doc-governance-gates-closeout.md`（本文档）。
- 阶段实施 commit：`a363105` / `aea70a6` / `c552100` / `1b7ce3e` / `76e0f75` / `c1ce38c` / `1049ac5` / `d4822ea`（8 commit 已 push 至 origin/main）。
- 受益文档：`docs/document-governance.md` §3.1 / §3.2 / §4.5 / §6（同步 GATES-3 + GATES-1 + GATES-2 文档化）。
- 受益注册项：`docs/DOC-REGISTRY.json` 中 `DOC-GOVERNANCE-GATES`（本文档登记项）+ `GATE-REPORT-SCHEMAS`（GATES-2 阶段产物登记项）。
- 受益脚本：`scripts/docs-governance.mjs` / `scripts/check-ui-productization-audit.mjs` / `scripts/test-affected.mjs` / `scripts/lib/gate-report-schema.mjs`（4 脚本同步升级）。
- 受益 schema：`docs/schemas/{docs-governance,ui-audit,test-affected}-report.schema.json`（3 JSON Schema，draft-07，schemaVersion=1）。
- 受益 docs 修订：v1-productization-roadmap / macos-oss-auto-update / stage4-stable-release-checklist / codex-style-workbench-direction / harness-engine-spec / harness-roadmap / agent-workbench-enhancement-plan / README.md（8 份 docs）。
- 受益 archive 修订：docs/archive/checkpoints/{model-provider-audit,ui-035-064-real-acceptance,stage2-acceptance-audit,stage3-m1-audit}.md（4 份 archive 文件首段加"已被 X 吸收"声明）。
- AUDIT-LOG 收口笔录：本会话末追加 `已收口` 条目，状态 `当前 active` 行收回。

## 7. 阶段纪律保持

- 不修改 UI 组件（`frontend/src/**`）。
- 不修改 Electron 主进程（`src/main.js` / `preload.js` / `plugin-manager.js`）。
- 不修改核心后端（`core/**`）。
- 不修改任何 acceptance evidence（`acceptance/**`）。
- 不启动新 UI 工作包或新主代码工作包；本工作包收口后下一块候选仍为 Block-2 UI-157 与 Block-6 UI-161 既有 in_progress 复核项。
- 不外推 Provider / packaged / GA / dist staleness。
- 不重写历史 commit。
- 不删除 W5 B 类 4 个 archive 文件（仅加 1 行吸收声明）。
- 本工作包本身由 `docs/DOC-REGISTRY.json` 同步登记项 status 字段值变化（`active` → `completed`）实现收口；不修改 `truthDomain` / `canonical` / `archivePolicy`。

## 8. 后续入口

- 治理门禁：`npm run docs:check` / `npm run ui:audit:check` / `npm run docs:reconcile` / `npm run docs:status`。
- 机器可读 JSON 报告：`node scripts/docs-governance.mjs --report <path>` / `node scripts/check-ui-productization-audit.mjs --report <path>` / `node scripts/test-affected.mjs --report <path>`，schema 索引见 `docs/schemas/README.md`。
- 阶段收口出口：GATES-0 / GATES-1 / GATES-2 / GATES-3 / GATES-4 均在本笔录完成；未来若有 GATES-5+ 阶段需先经用户裁决 + 新立工作包。
- 下一块候选：Block-2 UI-157（Skills IPC 桥实机复核）、Block-6 UI-161（实机复核升 `verified`）—— 属 G0 边界内未完成复核项，按 single work package serial 纪律须等用户显式裁决启动新工作包。
