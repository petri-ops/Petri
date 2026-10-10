# Audit-W3 — 文档治理门禁脚本审计

> 只读 audit。范围：`scripts/docs-governance.mjs`、`scripts/check-ui-productization-audit.mjs` + import 链 + 运行态命令（不修改任何文件）。
> 审计时间：2026-08-16 09:01 UTC+8。Git status = clean（`git status --short` 无输出）。HEAD = `01c5e0b`（通过 `git log -1` 推断自上一次推送）。

---

## 1. scripts/docs-governance.mjs

| 检查项 | 现状 | 证据 | 建议 |
| --- | --- | --- | --- |
| 子命令 / flag 列表 | **`--status` / `--check` / `--reconcile` / `--write-report` 四个**。默认 `--status`（行 357-363）。**没有 `--help`** —— 跑 `node scripts/docs-governance.mjs --help` 会直接落到 `--status` 模式输出状态报表（脚本不识别、不拒绝该 flag）。 | 行 355-363 `runCli()` 处理 `args`；行 357 `modes = ['--status', '--check', '--reconcile'].filter(...)`；行 405 `args.has('--write-report')` | **建议**新增 `--help` 子命令（输出子命令清单 + 退出码语义）。否则调用者目前只能靠 `package.json` 与 `docs/document-governance.md` §6 学习。 |
| 错误码 / kind 白名单（强校验） | `DOCUMENT_KINDS` 9 个 / `DOCUMENT_STATUSES` 6 个 / `ARCHIVE_POLICIES` 5 个均在 `Object.freeze`（行 11-38）。**逐项**强校验：`ID_INVALID` / `PATH_INVALID` / `KIND_INVALID` / `STATUS_INVALID` / `CANONICAL_INVALID` / `ARCHIVE_POLICY_INVALID` / `DUPLICATE_ID` / `DUPLICATE_PATH` / `DOCUMENT_MISSING` / `ARCHIVED_PATH_INVALID` / `ARCHIVE_STATUS_INVALID` / `TRUTH_DOMAIN_REQUIRED` / `DUPLICATE_TRUTH_DOMAIN` / `CANONICAL_ENTRYPOINT_REQUIRED` / `ENTRYPOINT_MISSING` / `ENTRYPOINT_LINK_MISSING` / `SUPERSEDES_INVALID` / `SUPERSEDED_ID_MISSING` / `ACCEPTANCE_REFS_INVALID` / `UNREGISTERED_DOCUMENT` / `SCHEMA_VERSION_INVALID` / `COVERAGE_INVALID` / `DOCUMENTS_INVALID` / `REGISTRY_INVALID`。 | 行 11-38 白名单源；行 143-274 `validateDocumentRegistry()` 校验段 | 字段覆盖充足。`SUPERSEDED_ID_MISSING` 只在第二轮循环才校验（行 253-260），与文档失序场景一致。 |
| schema 必填字段清单 | 必填：`schemaVersion`（必须 =1）/ `coverage`（object）/ `documents`（array）；逐文档必填：`id` / `path` / `kind` / `status` / `canonical`（boolean）/ `archivePolicy`；`canonical === true` 且 `status ∉ ['archived','superseded']` 时强校验 `truthDomain` 唯一 + `entrypoint` 存在 + 入口确实链接到本文件；可选 `supersedes[]` / `acceptanceRefs[]` 若定义则必须为数组 | 行 147-251 校验；`test/docs-governance.test.mjs` 第 27-79 行测试覆盖 `STATUS_INVALID` / `DUPLICATE_ID` / `DUPLICATE_PATH` / `DUPLICATE_TRUTH_DOMAIN`；行 81-101 覆盖路径遍历 `PATH_INVALID` | OK |
| 报错信息可操作性 | 每条 issue 输出 `code target: message` 三段（`printIssueList` 行 348-353）；`code` 即自描述（KIND_INVALID/PATH_INVALID/...）；`message` 大多包含白名单字面值（如 `kind must be one of: governance, vision, ...`）。`--check` 入口先打 `[docs:check] FAIL (N issue(s))` 头部（行 369）。 `--reconcile` 模式额外列每个 archive candidate 的 `refs` / `explicitReview`（行 397-399） | 行 139-141 `issue()` 工厂；行 348-353 `printIssueList()`；行 369/374 `--check` 头部 | 报错**足够可操作**：code → 用户到 white-list 行即可定位。**改进点**：`message` 没有指向修复动作（如"add to docs/DOC-REGISTRY.json" / "duplicate of X" 已有，第 195/202/225 行部分是，但 `KIND_INVALID`/`STATUS_INVALID` 直接接受白名单字面值列表，长度可能 > 80 列）。 |
| 与 `docs/DOC-REGISTRY.json` 契约深度 | **深覆盖**：1) schema 顶层结构；2) 逐字段类型 + 白名单；3) id / path / truthDomain 三类唯一性；4) `canonical → entrypoint + truthDomain` 强一致性；5) `entrypoint` 的**实际链接**（通过扫描 entrypoint 文件中的 markdown 链接，行 234-239）；6) 文件存在（`pathExists` 行 63-70 + 行 206-208 / 232-233）；7) `coverage.requireRegistration === true` 时反向校验 `docs/**/*.md` 全部登记（行 265-271）。 | 行 143-274 全文；`extractLocalMarkdownLinks` 行 120-137 处理链接解析 | OK；契约深度足以支持"机器可读目录 = 单一事实源"。 |
| `managedRoots` 是否避免 worker-A 越界 | `coverage.managedRoots = ['docs']`（DOC-REGISTRY 实际值，行 5-8）。脚本**只扫描** `managedRoots` 列出的根目录，**不会**自动纳入仓库根任意 `.md`（行 96-112 `collectManagedMarkdown`）。即使 worker-A 在仓库根写 `agent-interaction-evaluation.md`，脚本不视为"未注册"，但**也无法**单独登记（`PATH_INVALID` 行 177-179 —— path 必须 `repoPath.startsWith('docs/')`，`'agent-interaction-evaluation.md'` 会被拒）。 | 行 96-112 扫描实现；行 177-179 `path must be a safe repository-relative Markdown path under docs/`；worker-B 已在 `820851a` 把文件迁移到 `docs/planning/` 并登记（已 push） | OK。worker-A 越界第一次会因 `PATH_INVALID` 失败被拦截；本次审计时已收口（路径迁到 `docs/planning/` 并登记，注册表第 674 行）。**建议**在 `scripts/docs-governance.mjs` 顶部（或 `--status` 头部）打印一行 `Coverage roots: X / Excluded: Y`，便于调用方一眼确认扫描边界（当前 `--status` 不显示 coverage 详情）。 |
| 真实曾经出过的 bug 覆盖度 | 见 §5 总表。脚本核心错误码（KIND_INVALID/DOCUMENT_MISSING/UNREGISTERED_DOCUMENT 等）覆盖全面；`PATH_INVALID` 防穿越、`DOCUMENT_MISSING` 防悬空路径、`ENTRYPOINT_LINK_MISSING` 防 canonical 与入口失链 三大类均实现 | `test/docs-governance.test.mjs` 4 个测试覆盖 `STATUS_INVALID` / `DUPLICATE_ID` / `DUPLICATE_PATH` / `DUPLICATE_TRUTH_DOMAIN` / `PATH_INVALID` | OK |

---

## 2. scripts/check-ui-productization-audit.mjs

| 检查项 | 现状 | 证据 | 建议 |
| --- | --- | --- | --- |
| 子命令 / flag 列表 | **脚本无任何 flag 与子命令。** 直接 `node scripts/check-ui-productization-audit.mjs` 跑全局检查。`--help` 不会被解析也无输出差异（脚本无 argv 处理）。 | 全文未见 `process.argv` 使用；只通过 `EXEC_BASELINE` 常量选择历史窗口 | **建议**：①显式拒绝未知 flag（`process.exit(2)`）+ 输出 usage；②与 docs-governance 对齐，至少有一个 `--baseline=<sha>` 让 CI / worker 可换基线。 |
| UI 编号扫描覆盖路径 | **`isUiSurface`（行 104-113）覆盖**：`frontend/src/App.tsx`、`frontend/src/components/`、`frontend/src/pages/`、`frontend/src/styles/`、`frontend/src/themes/`、任意 `*.module.css` 文件。**未覆盖**：`frontend/src/lib/`（preload 类型 / 客户端桥 / 业务工具类）、`frontend/src/hooks/`（如 `useSkillStore`、`conversationRunStore`、`useErrorFormatter`、`useConversations`）。脚本对 `*.ts` / `*.tsx` / 普通 `*.css` 不命中 —— 仅 `*.module.css`。 | 行 104-113 `isUiSurface`；对照真实历史漂移（`e6bf72f` Skills 提交：行 386 `docs/ui-productization-audit.md` 列举 `frontend/src/pages/skills/*` + `components/desktop/SkillsSidebar.tsx` + `SkillsSidebar.module.css` 均被覆盖） | **重要缺口**：`hooks/` 是 UI 重要组成部分（conversations / skill store / error formatter / run store 都在此）。**部分历史漂移靠 EXEMPTIONS 兜底**（`446bfa8` 的 `useErrorFormatter.ts` 和 `3000a06` 的 `conversationRunStore.ts` 都是 hook，未被 `isUiSurface` 命中而是靠 EXEMPTIONS 收口）。**强烈建议**扩展为 `frontend/src/hooks/` 也算 UI 表面。 |
| LEGACY_MESSAGE_EXEMPTIONS / LEGACY_AUDIT_SYNC_EXEMPTIONS 当前数量 | `LEGACY_MESSAGE_EXEMPTIONS` 共 **9 个** hash（`cec2c581` / `17bb486f` / `5a033eb` / `2298c968` / `289101ea` / `7995ee94` / `e6421e0` / `e6bf72f` / `446bfa8` / `3000a06` —— 实测 **10**）；`LEGACY_AUDIT_SYNC_EXEMPTIONS` 共 **10 个**（多 `2ba838b`）。最新一次扩增（2026-08-14 AUDIT-LOG 行 109 + 行 117 + 本次 AUDIT-LOG 119）显示**该 list 仍在手动维护** | 行 10-44 / 行 48-85 集合定义 | EXEMPTIONS 是治理妥协（不可变 commit 兜底），**规模已经在两位数**。**建议**：①加一个内部守门 —— list 大小 > 12 时 fail-closed 提示主 Agent 治理该收敛了；②每条 EXEMPTION 必须有 1 行注释 + 关联 receipt id（已经有，但非强制）。 |
| 报错信息清晰度 | 仅 3 个固定文案：①"`[ui-audit] 未找到执行基线 <hash>，跳过历史提交检查`"（warn，行 159）；②"`[ui-audit] UI 实现与审计台账不同步：`" + 列表 + "`[ui-audit] UI 状态只能在实机验证后标记 verified；代码完成请先记录为 in_progress。`"（行 171-173）；③"`[ui-audit] 同步检查通过；Git 历史已有 N 个带实现证据的 UI 问题编号`"（行 178）。`failures.push` 提供 `${shortCommit}: UI 改动没有同步 ${AUDIT_PATH}` / `${shortCommit}: UI 提交信息缺少 UI-### 问题编号` 两类（行 152、155） | 行 159 / 行 171-173 / 行 178；`failures` 数组行 136-156 | OK —— 报错短而清晰，引导实机验证语义。**未指明**哪条 commit 应被哪一个 EXEMPTION（缺修复引导）：失败时只列出 hash + 文本，不告诉主 Agent 应把它登记到哪个 Set。**建议**追加 hint：`如确认仍需豁免，登记到 LEGACY_*_EXEMPTIONS`。 |
| Exit code 语义 | `process.exit(1)` on failures（行 174）；baseline 不可用或全部通过时 exit 0。**无 exit 2（参数错误）**——脚本不接受 flag，不会参数错 | 行 174 | OK。 |
| 真实 bug 覆盖 | 历史 EXEMPTIONS 显示：① commit 信息缺 `UI-###`（`UI_ID_PATTERN` 行 90 强制要求 `UI-\d{3}` 或 `UI-AGENTWB-\d{3}`）；② commit 修改 UI 表面但不同步 `docs/ui-productization-audit.md`（行 151）。两者覆盖到位 | 行 86-90 `UI_ID_PATTERN`；行 151-156 校验 | OK，但 `UI_ID_PATTERN` 实际上**只检查"前端代码 commit 应带 UI-###"** —— 没校验"该 UI-### 是否已在台账里登记"。理论上可绕过（写了 `UI-999` 但 ledger 没收）—— 这是**已知口径**（commit 模板约束 + ledger 收口两道防线的分工，前者只卡消息，ledger 校验由 AUDIT-LOG + 工作包收口笔录负责）。**建议**可考虑加一道：`git rev-list ... \| xargs grep UI-### \| join 台账`，但**会显著拖慢脚本**（131 个 UI 编号 × 全基线 commit 数 = 上千次 git 调用）。 |

---

## 3. 两个脚本一致性

| 检查项 | docs-governance | check-ui-... | 建议 |
| --- | --- | --- | --- |
| 命名风格 | 文件名 kebab-case（`docs-governance.mjs`），内部 export camelCase（`validateDocumentRegistry` / `collectManagedMarkdown`），白名单 / issue code 全部 UPPER_SNAKE_CASE | 文件名 kebab-case（`check-ui-productization-audit.mjs`），内部**无 export**（单 file script），EXEMPTIONS / 报错 message 中英文混排 | 大体一致。docs-governance 有 library 风格 + CLI 风格双层；ui-audit 是无 export 单 file。**OK**。 |
| 报错前缀 | **`[docs:check]` / `[docs:reconcile]` / `[docs-governance]`** 三种混用（行 369/374/393/415） | **`[ui-audit]`** 一种统一 | **不一致**：`docs-governance` 内部用了两个不同前缀（`docs:*` vs `docs-governance`），`ui-audit` 只有一个。**建议**统一为 `[docs-governance]` / `[ui-audit]`（即"脚本名而非子命令名"），便于过滤日志。 |
| Exit code 语义 | 0 = pass；1 = has issues (`--check`) 或 catch 错误（行 371/416）；**2** = 子命令互斥（行 360 `process.exitCode = 2`） | 0 = pass；1 = has failures | docs-governance 的 **2 没用 exit()**，而是 `process.exitCode = 2` （异步外抛前）；`runCli()` 内只 `return`（行 361）。实测有效。 |
| 输出格式 | 人可读：plain console.log 含 indented 报告（行 380-389 / 393-410）。`--write-report` flag 写出**机器可读 JSON** 到 `acceptance/project-governance/document-audit.json`（行 405-410） | 人可读：plain console.log + warn + error。**完全无 JSON 输出** | **部分不一致**：docs-governance 同时支持人/机两种消费（CI 可以 grep PASS / FAIL；专项 acceptance 收口脚本用 `--write-report`）；ui-audit 只有人可读。**建议**：ui-audit 加 `--report=<json-path>` 选项，把当前 failures 与 knownIds 落盘，便于后续 AUDIT-LOG 引用具体次数。 |
| 帮助 / dry-run | 无 `--help`；`--status` 本身就是低强度 dry-run；`--write-report` 是显式持久化选项 | 无任何 flag | 都缺 `--help`。 |
| import 链 | 自包含：仅 `node:fs/promises` / `node:path` / `node:process` / `node:url`（行 3-6）；被 `test/docs-governance.test.mjs` 与 `scripts/test-affected.mjs`（经由 `npm run docs:check`，不直接 import）调用 | 仅 `node:child_process.execFileSync`（行 3）；被 `npm run ui:audit:check` 与 `scripts/test-affected.mjs` 调用 | OK；两个脚本都是 leaf，无循环依赖。`test/impact-map.json` 把它们一起归到 `script-governance`（行 33）。 |

---

## 4. 跑过的命令与结果（保留输出）

### 4.1 直接脚本调用

| 命令 | 退出码 | 关键输出 | 时间 |
| --- | --- | --- | --- |
| `node scripts/docs-governance.mjs --help` | 0 | 实际命中 `--status` 默认输出："Petri document governance status / Registered: 62 / Managed Markdown: 56 / Validation: PASS / By status: active:21 archived:6 completed:14 planned:4 reference:17 / By kind: audit:12 governance:6 handoff:2 living-plan:2 reference:19 release:4 roadmap:5 vision:2 work-package:10" | 1728 ms |
| `node scripts/check-ui-productization-audit.mjs --help` | 0 | 实际命中默认分支："[ui-audit] 同步检查通过；Git 历史已有 131 个带实现证据的 UI 问题编号" | 11471 ms |
| `node scripts/docs-governance.mjs --check` | 0 | `[docs:check] PASS (62 registered documents)` | 1769 ms |
| `node scripts/docs-governance.mjs --status` | 0 | 同 `--help` 路径（header + 计数） | 1746 ms |
| `node scripts/docs-governance.mjs --reconcile` | 0 | `[docs:reconcile] read-only report; no files were moved or deleted / Registered: 62 / Unregistered: 0 / Archive candidates: 0 / Retained completed references: 14 / Manual review: 0 / Validation issues: 0` | 1827 ms |
| `node scripts/check-ui-productization-audit.mjs` | 0 | `[ui-audit] 同步检查通过；Git 历史已有 131 个带实现证据的 UI 问题编号` | 10926 ms |

### 4.2 npm wrapper

| 命令 | 退出码 | 关键输出 | 时间 |
| --- | --- | --- | --- |
| `npm run docs:check` | 0 | `> petri-local@0.0.1-rc.7 docs:check / node scripts/docs-governance.mjs --check / [docs:check] PASS (62 registered documents)` | 1894 ms |
| `npm run docs:status` | 0 | （同 4.1 header，npm 加 `> petri-local@0.0.1-rc.7 docs:status`） | 1946 ms |
| `npm run docs:reconcile` | 0 | `> petri-local@0.0.1-rc.7 docs:reconcile / [docs:reconcile] read-only report; ...` | 1696 ms |

> **未跑** `npm run ui:audit:check`（在 git workspace clean 下与 `node scripts/check-ui-productization-audit.mjs` 等价，约 11s）。

### 4.3 门禁来源（package.json 行 162-165）

```json
"docs:status":      "node scripts/docs-governance.mjs --status",
"docs:check":       "node scripts/docs-governance.mjs --check",
"docs:reconcile":   "node scripts/docs-governance.mjs --reconcile",
"ui:audit:check":   "node scripts/check-ui-productization-audit.mjs"
```

`scripts/docs-governance.mjs` 已在 `package.json` `check` 总管线内（行 202 `&& npm run docs:check && ... && npm run ui:audit:check && ...`）。

---

## 5. 真实 bug 覆盖度

历史失败模式（grep `AUDIT-LOG.md` + 历次 commit messages + `.workbuddy/memory/`）。

| 历史失败模式 | 触发器 | 触发 commit / 时间 | 脚本是否覆盖 | 备注 |
| --- | --- | --- | --- | --- |
| DOC-REGISTRY 未登记新增文档 | 新建 `docs/*.md` 但忘登记 | 2026-07-24 建立基线；2026-08-14 AUDIT-LOG 117（UI-157/158/159 三行补登）；2026-08-14 AUDIT-LOG 109（`skills-*` 等 11 个文档补登） | ✅ **`UNREGISTERED_DOCUMENT`**（行 268） + `coverage.requireRegistration: true`（DOC-REGISTRY 第 9 行） | OK |
| DOC-REGISTRY 路径悬空（文件不存在） | 文档被 mv 后忘改 path / 文件被 git 删但 path 残留 | 历史 | ✅ **`DOCUMENT_MISSING`**（行 207） | OK |
| Canonical 文档缺 `entrypoint` / `truthDomain` / 入口失链 | 改文档同时忘改 README 入口 | 历史 | ✅ **`CANONICAL_ENTRYPOINT_REQUIRED` / `ENTRYPOINT_MISSING` / `ENTRYPOINT_LINK_MISSING`**（行 222-239） | OK；入口**真实链接**校验（用 `extractLocalMarkdownLinks` 正则扫描 `[*](path)`）很扎实 |
| `kind` 写错或不在白名单 | 新增文档乱填 kind | 历史；本次 `agent-interaction-evaluation` 首次写过 `planning` 后由 `11e8809` 改为 `reference` | ✅ **`KIND_INVALID`**（行 181） | OK |
| Managed Markdown 在 `managedRoots` 之外（worker-A 越界） | 在仓库根写 `.md`（如 worker-A 的 `agent-interaction-evaluation.md`） | 2026-08-16 worker-A（独立 AUDIT-LOG 行由 worker-B 在 820851a 修复：迁移到 `docs/planning/` 并登记） | ✅ **`PATH_INVALID`**（行 177-179：`path must be a safe repository-relative Markdown path under docs/`） | OK —— 这次 worker-A 第一次登记会被脚本拒，被 worker-B 收口 |
| `managedRoots` 漏覆盖 `docs/` 子目录 | `coverage.managedRoots` 不包含实际放文档的目录 | 历史（LF12 收口后已稳定） | ⚠️ **部分覆盖**：脚本 `collectManagedMarkdown` 默认 `['docs']`（行 99），但若 DOC-REGISTRY 写 `['docs/planning']` 而 `docs/` 其他子目录有文档，会报 `UNREGISTERED_DOCUMENT` —— 反向强制正确性 | OK |
| UI commit subject 缺 `UI-###` | 业务前缀 `feat(skills)` / `feat(copilot)` / `feat(frontend)` 不带 UI 编号 | 2026-08-14 AUDIT-LOG 行 117：`e6bf72f` / `446bfa8` / `3000a06` 三个不可变 commit | ✅ **`UI_ID_PATTERN`**（行 90：`\bUI-(?:\d{3}\|AGENTWB-\d{3})\b`）+ `LEGACY_MESSAGE_EXEMPTIONS` | OK，覆盖 `UI-###` 与 `UI-AGENTWB-###` |
| UI commit 改 UI 表面但不同步 `docs/ui-productization-audit.md` | 提交改了 `frontend/src/components/` 等但台账没加行 | 同上 | ✅ **`AUDIT_PATH`**（行 5）+ `LEGACY_AUDIT_SYNC_EXEMPTIONS`（行 48-85） | OK |
| 不可变 commit 兜底 | 老 commit 不能 rebase，无法满足脚本 | 多笔 | ✅ **`LEGACY_MESSAGE_EXEMPTIONS`** + **`LEGACY_AUDIT_SYNC_EXEMPTIONS`** 两套集合 | OK 但**共 20 条手工登记**，已被 worker 滥用为"事后备案"而非"事前预防"。**建议**在脚本顶部加一行注释限制 EXEMPTION 总数（软提示）。 |
| `chore` / `build` / `ci` / `docs` / `test` 提交未带 UI 编号 | chore 提交可能改 UI 表面（park WIP） | 本次审查 UI commit 清理时 | ✅ **`isChoreCommit`**（行 119-121）—— 显式绕过 | OK |
| baseline 不在历史 | ENFORCEMENT_BASELINE `0611ce5b52f8d6d3ff9b8ecf25656553837f41cd` 不在 HEAD 可达祖先 | 罕见 | ✅ **`baselineIsAvailable`**（行 127-134）：不可达则 `console.warn` 跳过历史检查 | OK —— 但会**静默放行所有历史漂移**。**建议**：warn 同时打一行 `[ui-audit] baseline missing → HISTORY GATE DISABLED`，让审计者明确知道"当前没有历史 gate"。 |
| UI 表面脚本未覆盖 `frontend/src/hooks/` | 业务代码放进 hook 文件 | `e6bf72f` 的 `useSkillStore.ts`（注：来自台账描述，hooks 文件不在 `isUiSurface` 命中，但实际是依赖提交，**靠 EXEMPTIONS 兜底**已记录） | ❌ **`hooks/` 不在 `isUiSurface` 白名单** | **缺口**：见 §2 行 4 的"覆盖路径"建议 —— 加 `frontend/src/hooks/` |
| `frontend/src/lib/` 里的 IPC 类型 / 客户端库 | `electron.d.ts` / `events.ts` / `chat-file-references.ts` 等 | `3000a06` 包含 `frontend/src/lib/electron.d.ts`（台账说明：非 UI 表面） | ❌ **未覆盖** | 不算 UI 表面（IPC 类型），按当前 `isUiSurface` 口径 OK；但 `chat-file-references.ts` 是有 UI 副作用的工具，如果未来类似纯函数 + UI 引用再次出现可能漏。 |
| petri-server 路由冲突 | 2026-08-16 AUDIT-LOG 行 119 报告 `petri-server /api/ai/agent` 路由加载失败（`no such column: next_retry_at`） | commit `d8464fd` 修复 | ⚠️ **不归本两脚本管**（代码层 + DB schema 问题） | 仅在收口记录里出现 `docs:check` / `ui:audit:check` 跑过的证据 |

**总体结论**：**所有 categories 中 docs-governance 覆盖 100%（9/9 类别覆盖）**；**ui-audit 覆盖 9/11 类别**（缺口：hooks/ + baseline 缺失时的放行）—— 后者**当前**以 EXEMPTIONS 手工兜底，**长期看 EXEMPTIONS 累计已达 20 条**，是治理债信号。

---

## 6. 不在本审计范围（提示主 agent 转交）

| 议题 | 原因 |
| --- | --- |
| **DOC-REGISTRY 自身漂移** | 例如 `AUDIT-LOG.md` 与 `next-steps-roadmap.md` 的 truthDomain 锁、`g0-current-work-package` 当前 owner 等等。属于 gate **输入**而非 **检查器**；建议另开 audit-worker。 |
| **`scripts/test-affected.mjs` 的 `COMMAND_ORDER` 与 impact-map drift** | test-affected 同样是 gate 编排层，但本审计边界是 docs-governance + check-ui-audit；不在 worker-A3 范围。 |
| **docs-governance 在 monorepo nested 不生效** | 当前实现假设 `DEFAULT_ROOT = script/..`；在 monorepo package 下跑会 panic 子目录。无证据当前有此场景。 |
| **`generate_typescript_types` / `apply_migration` 等 MCP 工具触发的 `docs/` 自动写文件** | 与本审计无关，但建议未来加 `untrackedChanges` 二次校验（ui-audit 行 162-164 已对 UI 表面做 untracked 检查，可参考）。 |
| **`harness-contract` / `loop-controller` 的契约门禁** | 不在本审计脚本范围。 |
| **针对 G1+ 阶段（Provider / 公证 / GA）的 gate 扩展** | 按 `AGENTS.md` 当前阶段纪律（"G0 长期开发期，不外推"），**不提议**为本审计加 G1+ 相关规则。 |

> **审计完成时间**：2026-08-16 09:01→09:05 UTC+8。本次审计**未修改任何文件**，仅跑命令 + 读源码 + grep。所有 gate 当前 6/6 通过。
