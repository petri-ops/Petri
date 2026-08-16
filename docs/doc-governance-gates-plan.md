# DOC-GOVERNANCE-GATES：文档治理门禁工程化

最后更新：2026-08-16

状态：`active / planned`（2026-08-16 用户裁决启动）

Plan ID：`DOC-GOVERNANCE-GATES`

## 1. 决策与定位

`DOC-GOVERNANCE-GATES` 是经用户裁决（2026-08-16）启动的独立治理工程工作包，定位为 `docs/` 治理栈的工程化收口与门禁硬化。它不修改 UI、不修改主代码、不外推 Provider/packaged/GA 资格，专门收口 `scripts/docs-governance.mjs`、`scripts/check-ui-productization-audit.mjs`、DOC-REGISTRY 契约与跨工具入口联动。

`DOC-GOVERNANCE-GATES` 与当前 G0 边界内未完成的实机复核项（Block-2 的 `UI-157` Skills IPC 桥、Block-6 的 `UI-161` Skills 入口回收）解耦：UI 工作包属 `frontend/` 主线，受 `npm run ui:audit:check` 与 `npm run test:files` 约束；本工作包属 `docs/` + `scripts/` 治理栈，受 `npm run docs:check` / `docs:reconcile` / `docs:status` 约束。两者**互不阻塞**：UI 复核继续走 `ui:audit:check` 路径，本工作包不进入 UI 测试或代码改动；本工作包收口前不启动新 UI 工作包，但 UI 工作包可独立推进实机复核并按既有路径升 `verified`。

按 governance skill "Single work package serial" 纪律：当前同时只允许本工作包一个 `active` 工作包；任何新 UI 工作包、新主代码工作包须等本工作包收口后再启动。

### 1.1 范围输入

本工作包基于以下已完成的只读审计产出（不重做审计本身）：

| Worker | 输出 | 关键发现 |
| --- | --- | --- |
| W1 | `agent-tools/audit-w1-docs-dir.md` | 56 docs/ 文件 + 17 治理债候选（4 处 P1.A 已修；剩余 13 项候选待本工作包评估） |
| W3 | `agent-tools/audit-w3-gate-scripts.md` | 3 项 gate 改进建议（hooks/ 白名单 / baseline exit 2 / `--report` JSON）+ hook 链路一致性 |
| W4 | `agent-tools/audit-w4-registry.md` | DOC-REGISTRY 62 项 schema 视角 PASS；`truthDomain` × `canonical` 在 active/planned 下唯一性已被脚本强校验 |
| W5 | `agent-tools/audit-w5-archive.md` | 20 archive 文件 0 指针冲突；A 类 9 + D 类 1 已于 2026-08-16 P3 收口；B 类 4（archive 文档首段补"已被 X 吸收"声明）待本工作包评估 |

### 1.2 W3 三项 gate 改进建议（核心范围）

来自 `agent-tools/audit-w3-gate-scripts.md` §4-§6：

1. **gate-scripts/hooks/ 白名单**：当前 `scripts/check-ui-productization-audit.mjs` 对 hooks/ 目录文件的检测未单独分类，导致 hooks 触发的脚手架变更偶发误命中。W3 建议把 hooks/ 加入白名单或拆分 detection rule。
2. **gate baseline exit 2 契约化**：当前 `npm run test:changed:list` 在多次命中 classification rule 时 fail-closed 退出 2；应把 exit code 2 定义为"分类冲突"契约，而非静默 fail-closed。
3. **`--report` JSON 输出模式**：当前 gate 脚本只有人类可读 stdout；增加 `--report json` 输出标准化 JSON 报告供 CI / sub-agent 消费。

### 1.3 5-worker 审计后残余治理债（W1 + W5）

W1 §3 报告 P1.A 已修，剩余候选：

- `docs/v1-productization-roadmap.md` 行 36 "rc.5 检查点" vs 当前 rc.7（35 天未更新）
- `docs/macos-oss-auto-update.md` 行 104 引用 `v0.0.1-rc.6` 已成历史
- `docs/stage4-stable-release-checklist.md` 仅记 rc.6 收口；rc.7 收口见 `docs/releases/v0.0.1-rc.7.md`
- `docs/harness-engine-spec.md` / `docs/harness-roadmap.md` 顶部状态句未跟进 Phase 7 / HRT / HLE 收口
- `docs/codex-style-workbench-direction.md` 39 天未更新（已被 enhancement-plan §1.4 替代方向）
- `docs/agent-workbench-enhancement-plan.md` §5 (P1.1/P1.2/P1.3) ID 命名与 3 份验证报告（UI-AGENTWB-00X）不互相引用
- `docs/architecture/skills-architecture.md` vs `docs/skills-{schema,registry,workflow-integration}.md` 4 份文档分工未在 README 明示

W5 报告 B 类降级候选：

- `docs/archive/checkpoints/model-provider-audit.md`（archive 文件首段补"已被当前 G0 阶段纪律吸收"声明）
- `docs/archive/checkpoints/ui-035-064-real-acceptance.md`
- `docs/archive/checkpoints/stage2-acceptance-audit.md`
- `docs/archive/checkpoints/stage3-m1-audit.md`

## 2. 必须完成的范围

### GATES-0：hook 链路白名单（来自 W3 §4.1）

1. `scripts/check-ui-productization-audit.mjs` 拆分 hooks/ 分类规则：hooks/ 目录文件不计入 UI audit 检测路径。
2. 增加白名单 constant `UI_AUDIT_HOOKS_WHITELIST`，列出已知 hooks/ 路径前缀与文件。
3. 现有相关测试（在 `frontend/src/` 与 `test/` 下）验证 hooks/ 修改不触发 ui:audit:check fail-closed。

### GATES-1：baseline exit code 契约化（来自 W3 §4.2）

1. `scripts/docs-governance.mjs` 与 `scripts/check-ui-productization-audit.mjs` 明确文档化退出码语义：0=PASS / 1=FAIL / 2=分类冲突。
2. `scripts/test-impact-map.mjs`（`npm run test:changed:list`）退出 2 时输出"分类冲突"诊断消息（不是 fail-closed）。
3. `package.json` 脚本不改 exit 行为；契约化以脚本注释 + 文档化同步完成。

### GATES-2：`--report` JSON 输出模式（来自 W3 §4.3）

1. `scripts/docs-governance.mjs` 增加 `--report json` flag，输出标准化 JSON 报告（包含 `issues[]` / `summary` / `registered` / `unregistered` / `coverage`）。
2. `scripts/check-ui-productization-audit.mjs` 同上。
3. 新增 `npm run docs:report` 与 `npm run ui:report:json` 在 `package.json` 暴露。
4. JSON schema 在 `scripts/schemas/gate-report.schema.json` 注册（DOC-REGISTRY 不登记 JSON schema；仅本目录 schema）。

### GATES-3：DOC-REGISTRY 扩展字段规范化（来自 W1 §1 + W4 §6）

1. 写一份"扩展字段使用规范"附在 `docs/document-governance.md` §3 末尾：`registeredAt` / `linkedCommits` / `tags` / `supersededBy` / `notes` 等 optional 字段的填写时机与一致性约束。
2. `truthDomain` 在 canonical=false / non-active 状态下不应保留（已在 P2 收口中删除 IDE-TRANSFORMATION 等 3 项的 truthDomain）；脚本侧应增加校验 `archived / superseded` 状态无 truthDomain。
3. `supersededBy` 字段 schema 化为可选数组（元素为登记项 id）。

### GATES-4：剩余 W1 + W5 治理债修复

按用户逐项裁决分批实施：

1. `v1-productization-roadmap.md` 行 36 "rc.5 检查点" vs rc.7 同步
2. `macos-oss-auto-update.md` 行 104 rc.6 历史标注
3. `stage4-stable-release-checklist.md` 顶部追加 rc.7 收口指针
4. `harness-engine-spec.md` / `harness-roadmap.md` 顶部状态句跟进 Phase 7 / HRT / HLE 收口
5. `codex-style-workbench-direction.md` 头部加"快照声明"指向 enhancement-plan §1.4
6. `agent-workbench-enhancement-plan.md` §5 P1.1 主动引用 3 份验证报告
7. `architecture/skills-architecture.md` vs `skills-*` 4 份文档 README 入口图
8. W5 B 类 4 个 archive 文件首段加"已被 X 吸收"声明（不删文件）

## 3. 明确不在范围内

- 不修改任何 UI 组件（`frontend/src/**`）。
- 不修改任何 Electron 主进程代码（`src/main.js` / `src/preload.js` / `src/plugin-manager.js`）。
- 不修改核心后端（`core/**`）。
- 不修改任何 acceptance evidence（`acceptance/**`）。
- 不启动新 UI 工作包或新主代码工作包。
- 不外推 Provider / packaged / GA / GA 公证流水 / dist staleness。
- 不重写历史 commit。
- 不删除 W5 B 类 4 个 archive 文件（仅加 1 行吸收声明）。

## 4. 串行阶段

1. **GATES-0 hook 白名单**（小改，约 30 分钟）：改 `scripts/check-ui-productization-audit.mjs`，验证 `npm run ui:audit:check` PASS。
2. **GATES-1 exit code 契约化**（文档化为主，约 30 分钟）：脚本顶部 + `docs/document-governance.md` §4 同步；不改 exit 行为。
3. **GATES-2 `--report` JSON**（中等工程，约 2-3 小时）：两个 gate 脚本加 JSON 输出模式 + `package.json` 入口 + JSON schema。
4. **GATES-3 DOC-REGISTRY 扩展字段规范化**（小改，约 1 小时）：文档化 + 脚本校验增强。
5. **GATES-4 剩余治理债修复**（按用户裁决分批）：单行/单段修订，逐文件提交。
6. **收口**：`npm run docs:check` + `npm run ui:audit:check` + 新 `npm run docs:report` 三门 PASS；DOC-REGISTRY `DOC-GOVERNANCE-GATES` active → completed；AUDIT-LOG 收口笔录登记。

## 5. 验收门

每个阶段必须满足：

- 阶段内：受影响文件 `git diff --stat` 可核对；`npm run docs:check` 与 `npm run ui:audit:check` 必须 PASS。
- 收口前：`docs:check` / `ui:audit:check` / `docs:report` 三门 PASS；新 JSON schema 在 `scripts/schemas/` 注册且被引用脚本 link。
- 收口时：DOC-REGISTRY 同步；AUDIT-LOG 写一条 ✅已收口条目；canonical handoff / roadmap 同步指针；plan 顶部状态 `active / planned → completed / implemented`。
- 收口后：`docs/archive/` 留本文档迁移快照（保留路径 `docs/g{0}-*-plan.md` 不动；如需迁移到 archive 由未来工作包裁决）。

## 6. 证据位置

- W1 / W3 / W4 / W5 只读审计报告：`agent-tools/audit-w{1,3,4,5}-*.md`（已落地）。
- 本计划 canonical：`docs/doc-governance-gates-plan.md`（本文档）。
- 阶段门禁脚本：`scripts/docs-governance.mjs` / `scripts/check-ui-productization-audit.mjs` / `scripts/schemas/gate-report.schema.json`。
- 收口笔录：`docs/AUDIT-LOG.md` 末尾 `## 最近处理记录` 区。
- canonical handoff / roadmap 同步笔录：`docs/project-workspace-handoff.md` §3 / `docs/next-steps-roadmap.md` "当前入口" 段。

## 7. 依赖与排除

- **依赖**：
  - `npm run docs:check` 当前 61 registered PASS（2026-08-16 状态）。
  - `npm run ui:audit:check` 当前 PASS（131 UI 编号）。
  - 工作树 clean（领先 origin/main 2 commit 已 push）。
- **被依赖**：
  - Block-2 / Block-6 UI 实机复核项（`UI-157` / `UI-161`）不依赖本工作包；可独立推进。
  - 任何新 UI 工作包 / 新主代码工作包依赖本工作包收口（按单工作包串行纪律）。

## 8. 风险与约束

- GATES-2（`--report` JSON）增加 schema 维护成本：未来 gate 脚本输出字段扩展需同步 schema；本阶段 schema 锁定为 v1，扩展字段在 schema v2 引入。
- GATES-3 truthDomain 校验增强可能影响存量 56 个非 archive Markdown：先做脚本修改 + dry-run，确认 0 issue 后再 enable 强校验。
- GATES-4 治理债修复涉及 8 份文档 + 4 份 archive 文件首段：每份独立 commit，避免单次大批量 commit 增加回滚成本。
- 本工作包本身不得修改 `docs/DOC-REGISTRY.json` 中本文档的 status 直至收口；DOC-REGISTRY 当前不登记本计划文件，收口时一次性登记。

## 9. 阶段纪律

- 工作包期间不得在 `docs/` 主目录下新建 active canonical 计划文档（除本工作包及其后续阶段产物）。
- 不得把本工作包作为"待外推 Provider / packaged / GA"事项推进；属 G0 治理工程。
- `qualificationEligible: false` 是 G0 开发期常态事实，本工作包不触及、不升级、不冒充。
- 工作包期间发现新的 RED 阻塞项必须先登记 `docs/AUDIT-LOG.md` 顶部，再决定是否纳入本工作包范围；不得"顺手"修。
