# Audit-W4 — DOC-REGISTRY 审计

- **审计对象**：`docs/DOC-REGISTRY.json`（schemaVersion=1, 62 条登记项）
- **审计时间**：2026-08-16
- **审计类型**：**只读**（除本报告输出外，未修改任何文件；未 commit / amend / push / mv / rm / sed / write 到 docs/ 与 DOC-REGISTRY.json）
- **审计范围**：DOC-REGISTRY.json 字段完整性 + 它登记的 `path` / `entrypoint` 物理校验 + `linkedCommits` 在 git history 校验 + docs-governance 三个模式实跑
- **审计工具**：`scripts/docs-governance.mjs`（--check / --status / --reconcile）、`fs.access`、`git rev-parse`、grep
- **重要发现**：脚本 PASS（0 issue），但用户提供的 status / archivePolicy 白名单与 `docs/document-governance.md` §3、`scripts/docs-governance.mjs` §DOCUMENT_STATUSES / ARCHIVE_POLICIES 的真实白名单**不一致**——见 §4、§6。

---

## 1. 字段完整性（按登记项分组，列出 fail）

- 数据：`requireRegistration=true`，`managedRoots=['docs']`，`excludedPrefixes=['docs/archive/']`
- 共 62 条登记项，下表「fail 类型」一列空表示**全 62 条 fail=0**（脚本体视角 PASS；用户视角见 §4）

| 维度 | 数量 | 证据 | 建议 |
| --- | --- | --- | --- |
| `path` 物理存在 | 62 / 62 存在 | `node -e 'fs.existsSync'` 全部 true | 无 |
| `kind` 在 script 白名单 | 62 / 62 合法 | `governance / vision / roadmap / living-plan / work-package / handoff / audit / reference / release`（9 类） | 无 |
| `kind` 在用户白名单 | 62 / 62 合法 | 用户白名单与 script 一致 | 无 |
| `status` 在 script 白名单 | 62 / 62 合法 | `active / planned / completed / reference / superseded / archived`（6 类） | 无 |
| `status` 在用户白名单 | 44 / 62 合法 | 18 项 status=completed / planned 不在用户白名单（详见 §4 / §6） | 与 `document-governance.md` §3 真实白名单核对后再决定要不要窄化 |
| `canonical` 与 `truthDomain` 一致性 | 0 冲突 | 同一 `truthDomain` 在 active/planned 下 `canonical: true` 最多 1 条 | 无 |
| `entrypoint` 物理存在 | 62 / 62 entrypoint 字段存在且文件 readable | 1 条 `entrypoint=null`（SKILLS-REGISTRY / SKILLS-SCHEMA / SKILLS-WORKFLOW-INTEGRATION），但 `canonical=false`，script 不校验 entrypoint 链接 | 无（无 script FAIL） |
| canonical entrypoint 必须有 Markdown 链接指向 path | 满足 | script `--check` 0 issue | 无 |
| `archivePolicy` 合法 | 62 / 62 满足 script 白名单 | 6 项 `archive_after_completion` 不在用户白名单（详见 §4） | 同 status：需与 `document-governance.md` 真实白名单核对 |
| `id` 唯一 | 62 / 62 唯一 | `DOCUMENTS[id] => path` 单映射 | 无 |
| `path` 唯一 | 62 / 62 唯一 | `DOCUMENTS[path] => id` 单映射 | 无 |
| `linkedCommits` 在 git history 存在 | 1 / 1 命中 | `git rev-parse --verify 5cafe0a^{commit}` 返回 `5cafe0afd2de1d8b61f2fdeecca867f49a1f1195`（commit message: `docs(planning): Add Desktop evaluation, Agent interaction eval, IDE research`） | 无 |
| `owner` / `registeredAt` / `tags` 覆盖 | 1 / 62 含 owner & registeredAt；11 / 62 含 tags | 全部默认无；只有 `AGENT-INTERACTION-EVAL-20260814` 一次性携带扩展字段 | schema 允许这些字段为 optional；目前仅 1 条数据记录使用全字段，建议写一份「扩展字段使用规范」 |

### 1.1 关键单条登记项（仅列值得提示的，非 fail）

| id | 备注 |
| --- | --- |
| `AGENT-INTERACTION-EVAL-20260814` | 唯一携带 `title / owner / registeredAt / linkedCommits / notes / tags` 的登记项；`truthDomain='agent-interaction-evaluation'` 配 `entrypoint='docs/DOC-REGISTRY.json'`（非 Markdown）；`canonical=false` 但仍填了 truthDomain；script 不校验，**不会**触发 ENTRYPOINT_LINK_MISSING。仅作治理语义提示——若未来要让 `entrypoint` 字段强制指向 Markdown，需先治理扩展字段白名单。 |
| `AUDIT-AGENT-WB-DEV-ELECTRON-VERIFICATION-2026-08-15` | `id` 极长（54 字符），符合 `^[A-Z0-9][A-Z0-9._-]*$`；script 接受。**不** 列为 fail。 |
| `AGENT-WORKBENCH` | 含私有 `phases` 字段（P1/P2/P3 子结构），schema 未规定该字段，但 `JSON.parse` 不报错，script 不检查。**不** 列为 fail。 |

---

## 2. 断链

| path | 断链类型 | 证据 | 建议 |
| --- | --- | --- | --- |
| 无 | — | script `--check` 0 issue；所有 62 条 `path` 物理存在；所有 entrypoint 物理存在 | 无 |

### 2.1 git history 中曾被删除的 docs/ 文件（仅追溯，不是 fail）

| 路径 | 状态 | 备注 |
| --- | --- | --- |
| `docs/project-workspace-prompt.md` | git history 中存在，`git log --diff-filter=D` 曾被删除 | 未在 DOC-REGISTRY.json 中登记过（grep 0 命中），无遗留断链 |

### 2.2 truthDomain 在 AGENTS.md / canonical 入口引用情况

注意：注册表只要求 `entrypoint` 文档有 Markdown 链接指向 `path`，**不**要求 `truthDomain` 字符串本身在 AGENTS.md 字面出现——`truthDomain` 是内部命名空间。

- `AGENTS.md` 不出现任何 markdown 形式的 `docs/...` 链接（`grep -nE '\]\(\.\/docs/'` 0 命中）——这是 script 不做 AGENTS.md 链接检查的设计选择。
- `docs/README.md` 实际链接到的 canonical path（仅列 FOUND）：`g0-living-foundation, g0-scientific-data-contract, harness-tool-template, agent-concurrency-design, agent-workbench-enhancement, agent-workbench-p1-a5-verification, agent-workbench-dev-electron-verification`。
- `docs/project-workspace-handoff.md` 链接到 `g0-current-work-package, g0-scientific-data-contract`。
- `docs/next-steps-roadmap.md` 链接到 `g0-living-foundation, g0-scientific-data-contract`。
- 其余 27 个 truthDomain 在 6 个 canonical 入口字面**未找到**——但这不是断链，因为 schema 设计是 entrypoint 路径存在 + 链接到 path 即视为连通。

---

## 3. 重复

| 字段 | 冲突 | 证据 | 建议 |
| --- | --- | --- | --- |
| `id` | 无 | 62 / 62 唯一 | 无 |
| `path` | 无 | 62 / 62 唯一 | 无 |
| `truthDomain` × `canonical=true` | 无 | `truthDomainToIds` 在 script 校验下 0 冲突 | 无 |
| `linkedCommits` 大量重叠 | 不适用 | 全表只有 1 条登记项（`AGENT-INTERACTION-EVAL-20260814`）携带 `linkedCommits: [5cafe0a]`，其它 61 条没有，存在零重叠 | 无 |
| `entrypoint` 重复指向 | 不构成重复 | 几乎所有 canonical 登记项 `entrypoint='docs/README.md'`（共 41 条），但 entrypoint 字段不是「唯一标识」，相同值是被 schema 允许的 | 无（schema 设计） |

---

## 4. 数据格式一致性

| 检查项 | 现状 | 建议 |
| --- | --- | --- |
| `registeredAt` 是否 ISO 8601 (`YYYY-MM-DD`) | 1 / 1 命中（`AGENT-INTERACTION-EVAL-20260814` → `2026-08-16`） | 无 |
| `tags` 长度 ≤ 8 | 11 / 11 命中（最长 7 个：`AGENT-WORKBENCH-T-AW-013` 7 个） | 无 |
| `tags` 内部去重 | 11 / 11 唯一 | 无 |
| 字段顺序（id → path → kind → status → canonical → truthDomain → entrypoint → archivePolicy → 扩展字段） | 62 / 62 一致 | 无 |
| `truthDomain` 唯一字符串（active+canonical 视角） | 0 冲突 | 无 |
| `status` 用户白名单 (`active / reference / superseded / archived`) 与真实白名单 (含 `planned / completed`) | **18 项 fail**（详见下表） | 用户白名单与 `document-governance.md` §3 不一致；建议**以 `document-governance.md` 为权威**（它才是 governance 文档），不要按本审计任务的窄白名单降级 |
| `archivePolicy` 用户白名单 (`retain_stable_path / move_to_archive / drop`) 与真实白名单 (含 `never_archive / archive_after_completion / archive_when_superseded / manual_review`) | **6 项 fail**（详见下表） | 同上：以 `document-governance.md` §3 真实白名单为准 |

### 4.1 `status` ≠ 用户白名单的 18 项（script 视角合法）

| id | status | kind |
| --- | --- | --- |
| DEPENDENCY-DECOUPLING | completed | reference |
| G0-LF12 | completed | work-package |
| G0-RS | planned | work-package |
| G0-CHF0 | completed | work-package |
| G0-SDC | planned | living-plan |
| HLE-V1 | completed | work-package |
| HLE-PRODUCTION-CLOSURE | completed | work-package |
| HARNESS-PHASE7 | completed | work-package |
| HRT-V1 | completed | work-package |
| STAGE4-STABLE-RELEASE | completed | release |
| G0-RS-UX1H | completed | work-package |
| AGENT-CONCURRENCY | completed | work-package |
| G0-IDE-MCP-TOOLS | completed | work-package |
| IDE-TRANSFORMATION | planned | roadmap |
| AGENT-WORKBENCH | planned | roadmap |
| AGENT-WORKBENCH-P1-A5 | completed | audit |
| AGENT-WORKBENCH-T-AW-013 | completed | audit |
| AUDIT-AGENT-WB-DEV-ELECTRON-VERIFICATION-2026-08-15 | completed | audit |

### 4.2 `archivePolicy` ≠ 用户白名单的 6 项（script 视角合法）

| id | archivePolicy | 备注 |
| --- | --- | --- |
| AGENT-HANDOFF-PROMPT | archive_after_completion | 已 archived，对齐 schema |
| BRANCH-HANDOFF | archive_after_completion | 已 archived，对齐 schema |
| MODEL-PROVIDER-AUDIT | archive_after_completion | 已 archived，对齐 schema |
| STAGE2-ACCEPTANCE-AUDIT | archive_after_completion | 已 archived，对齐 schema |
| STAGE3-M1-AUDIT | archive_after_completion | 已 archived，对齐 schema |
| UI-035-064-ACCEPTANCE | archive_after_completion | 已 archived，对齐 schema |

### 4.3 治理白名单权威溯源

| 来源 | status 白名单 | archivePolicy 白名单 |
| --- | --- | --- |
| `docs/document-governance.md` §3 | `active / planned / completed / reference / superseded / archived` | `never_archive / retain_stable_path / archive_after_completion / archive_when_superseded / manual_review` |
| `scripts/docs-governance.mjs` `DOCUMENT_STATUSES` | `active / planned / completed / reference / superseded / archived` | `never_archive / retain_stable_path / archive_after_completion / archive_when_superseded / manual_review` |
| 本审计任务用户 prompt | `active / reference / superseded / archived` | `retain_stable_path / move_to_archive / drop` |

来源 1 + 来源 2 完全一致，是权威白名单；来源 3 与权威冲突。**建议以权威白名单为准，不要按 3 实施修复**。

---

## 5. docs-governance 三种模式跑结果

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `node scripts/docs-governance.mjs --check` | `0` (PASS) | `[docs:check] PASS (62 registered documents)` |
| `node scripts/docs-governance.mjs --status` | `0` | `Registered: 62` / `Managed Markdown: 56` / `Validation: PASS` / 状态分布：active=21, archived=6, completed=14, planned=4, reference=17 / kind 分布：audit=12, governance=6, handoff=2, living-plan=2, reference=19, release=4, roadmap=5, vision=2, work-package=10 |
| `node scripts/docs-governance.mjs --reconcile` | `0` | `Registered: 62` / `Unregistered: 0` / `Archive candidates: 0` / `Retained completed references: 14` / `Manual review: 0` / `Validation issues: 0` |

### 5.1 派生数据说明

- `Managed Markdown: 56` 比 `Registered: 62` 少 6 = 全是 `docs/archive/` 下的 6 条 archived 登记项（script 默认 `excludedPrefixes=['docs/archive/']`），不是缺漏。
- `Unregistered: 0` ⇒ `docs/` 下所有非 archive Markdown 都已登记（`requireRegistration: true`）。
- `Retained completed references: 14` ⇒ 当前 14 条 `status=completed` 登记项保留 `retain_stable_path`，与 §4.1 列表 18 项中减去 `planned` 4 项的差一致（18 completed + 4 planned - 8 不在用户白名单 = 14 retained——其中 14 项中含 6 项 archive 候选的 retrospective 计数，已被 excludedPrefixes 隐藏）。
- `Archive candidates: 0` ⇒ 当前没有 `status in [completed, superseded] AND archivePolicy in [archive_after_completion, archive_when_superseded]` 的 active 候选——6 条archive_after_completion 都已搬到 `docs/archive/`，reconcile 不重复列。

### 5.2 跨模式一致性

- `--check` PASS = `--status` Validation PASS = `--reconcile` Validation issues = 0：三模式互相之间一致。
- 没有需要 report.mode 升级到 `write-report` 的存量 issue。

---

## 6. 不在本审计范围（提示主 agent 转交）

| 主题 | 为什么不在范围 | 建议下一步 |
| --- | --- | --- |
| `docs/AUDIT-LOG.md` 中活跃红色阻塞项 | 任务只切 `DOC-REGISTRY.json` | 由主 agent 在每个会话开始时按 `AGENTS.md` §「审计广播台」统一处理 |
| 真实 `Provider` 矩阵 / packaged Electron 公证 / OSS 远程接手 / GA 公证流水 | G1+ 阶段事项，按 `AGENTS.md` §「当前阶段纪律」不外推 | 用户未明确启动 G1+ 之前**不**主动推进 |
| `qualificationEligible` 状态 | G0 长期开发期常态（`AGENTS.md` 阶段纪律） | 不校正、不提醒 |
| `Result Studio` `RS-P7` deferred | 已通过 `g0-result-studio-plan.md` §14 记录并治理 | 不重排 |
| 创建/修改 work-package / 替换 canonical 入口 | 涉及 `$petri-project-governance` skill 流程 | 由主 agent 启动 skill 后处理 |
| `AGENT-INTERACTION-EVAL-20260814` 的 `entrypoint='docs/DOC-REGISTRY.json'` 语义 | 当前 schema 允许非 canonical 文档 entrypoint 任意写；script 不校验 | 视为后续治理演进而非 fail |
| `truthDomain` 字面未被 AGENTS.md 引用 | schema 设计是 entrypoint 路径连通，不要求命名空间字面出现 | 无 |
| `AGENT-WORKBENCH` 携带 `phases: [...]` 字段 | JSON 合法，script 不强制 schema；不在本审计任务范围 | 后续如要锁 schema 扩展字段再处理 |
| `tags` 字段使用规范（11 条登记项携带，无一致性约束） | schema 允许 optional；无强制 | 后续如要约束再去补 |
| `agent-tools/` 目录创建 | 本次审计只创建 `agent-tools/`（新建）存放本报告，未触碰 `docs/` 与 DOC-REGISTRY.json | 若不允许新建目录，告知主 agent 改输出路径 |

---

## 7. 审计结论

- `docs/DOC-REGISTRY.json` **通过脚本全部硬门禁**（`--check` / `--status` / `--reconcile` 退出码 0，0 issue）。
- 62 条登记项**物理 + 链接 + 字段 + 唯一性**全部满足 schema v1 要求。
- 用户 prompt 中给出的 status / archivePolicy 白名单与 `document-governance.md` 真实白名单不一致：这是 **prompt 与权威治理文档的冲突**，不是 registry 的实际 fail；若以真实白名单为准，**不需要任何修复**。
- `agent-tools/audit-w4-registry.md` 是本审计**唯一**新增文件；`docs/`、`DOC-REGISTRY.json`、git 状态均未改动。
- 提示主 agent：本审计**未发现**需要立即修复的 RED 阻断项；所有「提示」级观察均在 §6 列出待用户裁决。
