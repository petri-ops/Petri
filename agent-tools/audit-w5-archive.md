# Audit-W5 — docs/archive/ 历史 checkpoint 审计

> 只读审计（worker-A5）。未修改任何文件、未 commit / amend / push / mv / rm / sed / write。
> 范围：`docs/archive/**/*.md` 全树 + 仓库内对 archive 的引用。
> 口径：本次只审计**历史归档**。`docs/agent-workbench-enhancement-plan.md`（仍为 `reference / canonical` 状态）不在 archive，但其 §11 自述"建议后续归档"，本报告在 §5 提示主 agent 关注。

## 0. 摘要

| 维度 | 数量 |
| --- | --- |
| `docs/archive/` 全部 `.md` 文件 | 20 |
| 子目录 | 2（`checkpoints/`、`releases/`） |
| 注册到 `docs/DOC-REGISTRY.json` 且 `status: archived` | 6 |
| 未注册但物理在 archive | 14 |
| `docs/` 下 `status: superseded` 但仍放在非 archive 目录 | 0 |
| 仍被 active canonical 文档引用 | 5 个文件（其中 4 个为"明示追溯、非现行入口"型合规引用，1 个由 `AUDIT-LOG.md` 自身合规引导） |
| 完全无外部引用 | 9 |
| 仅 `DOC-REGISTRY.json` 引用（无文档/脚本引用） | 5 |
| 仅 agent memory 引用 | 1（`.workbuddy/memory/2026-08-09.md`，属于用户工作日志，非工程引用） |
| 触发 `docs:check` 不通过候选 | 0（脚本对 archive 走 `excludedPrefixes`） |

## 1. 目录结构

| 子目录 | 文件数 | 最大文件 | 总字节 | 备注 |
| --- | --- | --- | --- | --- |
| `docs/archive/checkpoints/` | 19 | `audit-log-through-2026-07-26.md`（66.2 KiB） | 267 786 | 历史审计、Agent 提示词、状态拆解、运行时验证、UI 阶段验收 |
| `docs/archive/releases/` | 1 | `v0.0.1-rc.1-plan.md`（20.3 KiB） | 20 825 | `rc.1` 已被 `rc.2–rc.4` 取代（文件自述"不得作为当前发布流程或版本基线"） |
| `docs/archive/README.md` | 1 | 504 B | 504 | 归档目录自述；明示"只用于追溯" |
| **合计** | **21** | — | **289 115** | — |

> 全部 archive 文件均以 `.md` 结尾，无其它类型。最大单文件 66.2 KiB（历史审计广播台快照）。无任何二进制、压缩包、临时文件残留。

### 1.1 目录登记与状态（DOC-REGISTRY.json 覆盖核对）

| archive 文件 | DOC-REGISTRY status | canonical 字段 | 一致性 |
| --- | --- | --- | --- |
| `agent-handoff-prompt.md` | `archived` | `false` | ✅ 一致 |
| `branch-handoff.md` | `archived` | `false` | ✅ 一致 |
| `model-provider-audit.md` | `archived` | `false` | ✅ 一致 |
| `stage2-acceptance-audit.md` | `archived` | `false` | ✅ 一致 |
| `stage3-m1-audit.md` | `archived` | `false` | ✅ 一致 |
| `ui-035-064-real-acceptance.md` | `archived` | `false` | ✅ 一致 |
| 其它 14 个文件 | （未注册） | — | 满足 `coverage.excludedPrefixes: ["docs/archive/"]`，不强制注册，但 6 个仍被登记为 `archived`，反映"主动登记"与"放任不登记"两种处理并存 |

> `scripts/docs-governance.mjs` 在 `archived` 但路径不在 `docs/archive/`、或路径在 `docs/archive/` 但状态非 `archived` 时会发出 `ARCHIVED_PATH_INVALID` / `ARCHIVE_STATUS_INVALID`。当前 0 issue：所有路径与状态自洽。

## 2. 每个 archive 文件的引用情况

> 引用方分级：
> - **DOC-REG**：仅 `docs/DOC-REGISTRY.json` 登记（机器目录）
> - **canonical doc**：被 `docs/` 下 active 文档正文引用
> - **入口文件**：`AGENTS.md` / `CLAUDE.md` 引用
> - **skill**：`*.agents/skills/*` 引用
> - **script**：`scripts/*` 引用
> - **memory**：`workbuddy/memory/*` 引用（用户工作日志，非工程入口）
>
> "合规"标准：要么 (a) 完全无外部引用，要么 (b) 引用方明示"此为追溯、非现行入口"。

| # | 文件 | 字节 | 外部引用 | 引用方表述 | 是否合规 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `checkpoints/claude-instructions-through-stage2.md` | 14 404 | `CLAUDE.md` §1.4（第 25 行） | `CLAUDE.md`：**"旧 Stage 2 指令与历史测试基线已归档到 [...claude-instructions-through-stage2.md]，不得继续执行。"**（合规红字提示） | ✅ 合规 | 该引用**必要**。`CLAUDE.md` 是 Claude Code 唯一入口；archive 内文档不放入入口文件会被误当现行指令。**保留**。文件本体内含 `> 不要把 docs/archive/ 中的历史任务当成当前优先级` 横幅（自警示充分）。 |
| 2 | `checkpoints/agent-handoff-prompt.md` | 3 275 | `docs/dependency-decoupling-checkpoint.md` §11 line 120（canonical ref, `status: completed`）；`DOC-REGISTRY.json` | `dependency-decoupling-checkpoint.md`：**"当时使用的 Agent 接手提示词已失效并归档于 [...]；当前 Agent 必须从 AGENTS.md 和文档入口恢复状态。"** | ✅ 合规 | 引用方为 `completed` 但仍位于 `docs/` 的非 archive 文档（其自身被 `DOC-REG` 标 `archivePolicy: retain_stable_path`），引用指向归档文件并明示失效。引用**必要**：这是 Agent 提示词生命周期的唯一指针。**保留**。 |
| 3 | `checkpoints/audit-log-through-2026-07-26.md` | 67 802 | `docs/AUDIT-LOG.md` line 4（自引用引导）；`AUDIT-LOG.md` §"最近处理记录" line 100 提及 4 份审计被移入 archive；`DOC-REGISTRY.json`（未列入本文件，但 `AUDIT-LOG` 自身 active 注册） | `AUDIT-LOG.md` header：**"每次会话先读本文件；只有追溯问题来源时才读取[完整历史归档](./archive/checkpoints/audit-log-through-2026-07-26.md)。"** | ✅ 合规 | 引用**必要**：现役 `AUDIT-LOG.md` 自我压缩后必须保留历史归档指针，且明示"只有追溯问题来源时才读取"。**保留**。 |
| 4 | `checkpoints/branch-handoff.md` | 6 775 | `DOC-REGISTRY.json` | 无文档/脚本引用 | ✅ 合规 | 已被 `AUDIT-LOG.md` 2026-07-17 条目 ✅已处理（"5 个 codex/* 已合并残留分支已删除"）覆盖。**候选**：可降级为内部登记或评估彻底删除（见 §4-候选 D）。 |
| 5 | `checkpoints/cross-platform-compatibility-audit.md` | 4 497 | `.workbuddy/memory/2026-08-09.md`（用户工作日志） | workbuddy memory：**"codex/cross-platform-runtime 为被取代旧并行分支"** | ⚠️ 形式合规 | 该引用位于 `.workbuddy/memory/`，属用户私有 Agent 工作记忆（git 跟踪但非工程入口）。内容也仅是顺带提及分支名，无内容回看。**保留**：引用方不强制，但删 archive 文件不影响工程。 |
| 6 | `checkpoints/local-path-map-windows.md` | 2 988 | 无 | — | ✅ 合规（无引用） | 内容是 2026-07-11 旧 Windows 路径关系；当前工作区已切 macOS（见 `workbuddy/memory`），文件首句明示"不适用于当前 macOS 工作区"。**强候选清理**（见 §4-候选 A）。 |
| 7 | `checkpoints/model-provider-audit.md` | 3 030 | `DOC-REGISTRY.json` | 无文档/脚本引用 | ✅ 合规 | 内容是 Stage 2 MODEL-1 调用链审计快照；当前阶段纪律已声明"Provider / GA 属于 G1+ 阶段，不外推"，该审计的契约结论已由 `next-steps-roadmap.md` 与 `AGENTS.md` 当前阶段纪律吸收。**候选降级**：可考虑补 1 行"已被当前 G0 阶段纪律吸收"或保留（见 §4-候选 B）。 |
| 8 | `checkpoints/plan1.6-closeout.md` | 20 685 | 无 | — | ✅ 合规（无引用） | 内容是 1.6 状态钩子重构收口；其后 `plan1.6` 工作已合并，前端 74 个测试已落地。**强候选清理**（见 §4-候选 A）。 |
| 9 | `checkpoints/project-result-sandbox-plan.md` | 26 129 | `docs/project-workspace-handoff.md` §3 line 213（canonical ref） | handoff：**"`[P-02 工具执行、Job 与 Artifact Truth]` 项目工作路径结果沙盒 Phase 0–5b 已完成实施（resolver + R/Python/MCP 收敛 + 测试），记录见 [...]。"** | ✅ 合规 | 引用**必要**：P-02 实施记录的指针；引用方为当前 canonical handoff。文件本体首段已自我标注"⚠️ 历史记录横幅 + 路径已变（vendor→core）+ PostgreSQL/docker 已移除"。**保留**。 |
| 10 | `checkpoints/runtime-validation-1.5.md` | 8 498 | 无 | — | ✅ 合规（无引用） | 内容是 2026-07-10 运行时验证（`main @ 870dcdd` 提交）；提交已远超 800 commits，验证条件不再代表当前状态。**强候选清理**（见 §4-候选 A）。 |
| 11 | `checkpoints/stage2-acceptance-audit.md` | 10 735 | `DOC-REGISTRY.json`；archive 内 `audit-log-through-2026-07-26.md` line 80 自指 | 内部自引用（非外部） | ✅ 合规 | 注册保留供回溯；当前阶段纪律不外推 Stage 2 验收。**保留**（小文件，且在 DOC-REGISTRY 显式登记）。 |
| 12 | `checkpoints/stage3-m1-audit.md` | 7 137 | `DOC-REGISTRY.json`；archive 内 `audit-log-through-2026-07-26.md` line 211 自指 | 内部自引用（非外部） | ✅ 合规 | 同上。**保留**。 |
| 13 | `checkpoints/state-decomposition-1.4.md` | 59 540 | archive 内 `branch-handoff.md` line 134 自指（`docs/archive/checkpoints/state-decomposition-1.4.md`）；自身 §9 line 790 含"This historical document now lives at ..."迁移说明 | 内部自引用（非外部） | ✅ 合规（无 active 文档引用） | 文件本体含迁移说明横幅"历史审计：本文件中的多项问题已经由 Plan 1.6 等后续工作关闭"。**强候选清理**（见 §4-候选 A）。 |
| 14 | `checkpoints/ui-035-064-real-acceptance.md` | 3 591 | `DOC-REGISTRY.json` | 无文档/脚本引用 | ✅ 合规 | UI-035/054-064 真实验收快照；其结论已被 `docs/ui-productization-audit.md` 与 `AUDIT-LOG.md` 多次合并吸收。**候选降级**（见 §4-候选 B）。 |
| 15 | `checkpoints/ui-audit-fixes-batch1.md` | 3 108 | 无 | — | ✅ 合规（无引用） | 8 个 UI 修复条目（2026-07-15）；已 100% 同步到 `docs/ui-productization-audit.md` 的当前台账。**强候选清理**（见 §4-候选 A）。 |
| 16 | `checkpoints/ui-audit-fixes-batch2.md` | 743 | 无 | — | ✅ 合规（无引用） | 3 个 UI 修复条目（2026-07-15）；同上 100% 同步。**强候选清理**（见 §4-候选 A）。 |
| 17 | `checkpoints/ui-audit-next-steps.md` | 4 576 | 无 | — | ✅ 合规（无引用） | 内容是"UI 审计下一步工作建议"（3 个选项，**未被选中**，文档未注明是否采纳）。**强候选清理**（见 §4-候选 A）。 |
| 18 | `checkpoints/ui-audit-phase1-summary.md` | 4 696 | 无 | — | ✅ 合规（无引用） | 30 个 UI 问题初查报告（2026-07-15）；已被 `ui-productization-audit.md` 当前台账覆盖。**强候选清理**（见 §4-候选 A）。 |
| 19 | `releases/v0.0.1-rc.1-plan.md` | 20 825 | 无 | — | ✅ 合规（无引用） | 文件首段明示"已被后续 rc.2–rc.4 取代，不得作为当前发布流程或版本基线"。**强候选清理**（见 §4-候选 A）。 |
| 20 | `README.md`（archive 索引） | 504 | 无 | — | ✅ 合规（自述） | 归档目录入口文件，明示用途。**保留**。 |

### 2.1 内部 archive 互引用一览

| 来源 | 目标 | 性质 |
| --- | --- | --- |
| `audit-log-through-2026-07-26.md` → `stage2-acceptance-audit.md` | 同目录内部 | 历史快照内的相对链接 |
| `audit-log-through-2026-07-26.md` → `stage3-m1-audit.md` | 同目录内部 | 同上 |
| `branch-handoff.md` → `state-decomposition-1.4.md` | 同目录内部 | 老分支操作步骤里引用 |
| `claude-instructions-through-stage2.md` 第 48 行 → `docs/archive/` 本身 | 同级 | 自身纪律提醒 |
| `claude-instructions-through-stage2.md` 第 321 行 → `docs/archive/` 本身 | 同级 | 同上 |
| `state-decomposition-1.4.md` §9 line 790 → 自身路径 | 自指 | 迁移公告 |

> 内部互引用的"孤岛链路"：`branch-handoff.md → state-decomposition-1.4.md`、`audit-log-through → stage2/stage3-m1`。这两条孤岛链路**当前没有外部工程入口访问**（外部入口全部指向 `audit-log-through` 与 `claude-instructions-through-stage2`），可视为纯追溯。

## 3. 特殊审计：CLAUDE.md 对 archive 的引用

> `CLAUDE.md` 是 Claude Code 唯一工程入口；其对 archive 的每条引用都是"被 Agent 在每次会话启动时看到"的引用，必须逐条核对合规。

### 3.1 引用清单

| 行 | 引用对象 | 引用表述 | 合规性 |
| --- | --- | --- | --- |
| `CLAUDE.md` 第 22 行（一致性边界第 3 条） | `docs/archive/`（目录级） | "`docs/archive/` 只用于追溯，不决定当前工作顺序；Acceptance 只能证明其契约声明的范围。" | ✅ 合规（目录级声明，明示不决定工作顺序） |
| `CLAUDE.md` 第 25 行（末段） | `docs/archive/checkpoints/claude-instructions-through-stage2.md`（文件级） | "旧 Stage 2 指令与历史测试基线已归档到 `[...claude-instructions-through-stage2.md]`，不得继续执行。" | ✅ 合规（明示"不得继续执行"，与本文件 §1.4 第 1 步的"完整遵守 AGENTS.md"形成显式否定） |

### 3.2 合规判定

- **文件级引用合规**：CLAUDE.md 第 25 行采用"前置否定语 + 不得继续执行"措辞，且文件被引用的同时**未给出任何执行性指令**（无"按以下步骤"、"请遵循"等）。`AGENTS.md`（最高优先级）已声明"长期处于 G0 开发期，不外推 Stage 2 Provider"。`CLAUDE.md` 与 `AGENTS.md` 在 G0 阶段纪律上完全一致。
- **目录级声明合规**：第 22 行与 `AGENTS.md` 第 131 行（同义句"只保存活跃广播；除非追溯具体问题，不读取 docs/archive/ 中的历史审计账本"）保持一致。
- **引用是否仍合理**：合理。`CLAUDE.md` 是 Claude Code 路由入口，必须告知该文件存在"已归档、不得执行"的红字提示。若删除此引用，新 Agent 可能误读 `claude-instructions-through-stage2.md`（其自述"Stage 2 模型层与多 Provider，当前阶段"），与 G0 阶段纪律冲突。**保留**。

### 3.3 风险提示

- `claude-instructions-through-stage2.md` 第 1 行仍以 `# CLAUDE.md` 为标题、保留历史快照的 Heading 结构。若未来 Agent 通过其他渠道（不是 `CLAUDE.md`）直接 grep 到该 archive 文件，仍可能误以为是新 `CLAUDE.md`。**建议**：在 archive 文件本体第 1 行加强自警示横幅（目前仅有第 48 / 321 行的纪律提示）。**此为建议，不阻断**。

## 4. archive 可优化候选

> 候选类型：
> - **A**：完全无外部引用，且内容已被后续 canonical 文档完整涵盖 → 可清理（删除或并入既有 handoff）
> - **B**：仅 DOC-REGISTRY 引用，结论已被当前阶段纪律吸收 → 可降级（在 archive 文档头部加 1 行"已被 X 吸收"或精简内容）
> - **C**：内部互引用但无外部引用，且非历史快照价值 → 可清理
> - **D**：被 `AUDIT-LOG.md` 条目明确 ✅已处理覆盖 → 可清理或保留为里程碑证据

| 文件 | 候选类型 | 证据 | 建议 | 影响面 |
| --- | --- | --- | --- | --- |
| `checkpoints/local-path-map-windows.md` | A | 内容是 2026-07-11 旧 Windows 路径；`workbuddy/memory` 已记录 macOS 工作区；`AUDIT-LOG` 已无此相关活跃条目；无外部引用 | 可清理 | 删除 2.9 KiB；无工程影响 |
| `checkpoints/plan1.6-closeout.md` | A | 1.6 状态钩子重构已收口；前端 74 个测试已在仓库；`state-decomposition-1.4.md` §9 已宣布"由 Plan 1.6 关闭"；无外部引用 | 可清理或保留为里程碑证据 | 删除 20.7 KiB；保留亦可（无破坏性） |
| `checkpoints/runtime-validation-1.5.md` | A | 内容是 `main @ 870dcdd` 的运行时验证；HEAD 早已远移；当前阶段纪律另有 `npm run docs:check` / `ui:audit:check`；无外部引用 | 可清理 | 删除 8.5 KiB；保留亦无碍 |
| `checkpoints/state-decomposition-1.4.md` | A | 自身已宣布"由 Plan 1.6 关闭"；内容是 1.4 状态拆解问题清单；前端已被 1.6 修；外部唯一引用是 archive 内部 | 可清理（保留为历史快照亦可） | 删除 59.5 KiB（最大候选） |
| `checkpoints/ui-audit-fixes-batch1.md` | A | 8 个修复条目 100% 同步进 `ui-productization-audit.md` 当前台账；无外部引用 | 可清理 | 删除 3.1 KiB；保留亦可 |
| `checkpoints/ui-audit-fixes-batch2.md` | A | 3 个修复条目 100% 同步进当前台账；无外部引用 | 可清理 | 删除 0.7 KiB（最小候选） |
| `checkpoints/ui-audit-next-steps.md` | A | 内容是"下一步工作建议"3 选项，未注明是否采纳；后续 UI 阶段走的是 `ui-productization-audit.md` 当前台账；无外部引用 | 可清理（删除或归并进 `ui-audit-phase1-summary.md`） | 删除 4.6 KiB |
| `checkpoints/ui-audit-phase1-summary.md` | A | 30 个问题初查已被 `ui-productization-audit.md` 当前台账覆盖；无外部引用 | 可清理 | 删除 4.7 KiB |
| `releases/v0.0.1-rc.1-plan.md` | A | 自述"rc.1 已被后续 rc.2–rc.4 取代，不得作为当前发布流程或版本基线"；无外部引用 | 可清理 | 删除 20.8 KiB |
| `checkpoints/branch-handoff.md` | D | `AUDIT-LOG.md` 2026-07-17 ✅已处理条目已明确"5 个 codex/* 已合并残留分支已删除"；内容是分支合并备忘；唯一外部引用是 DOC-REGISTRY | 可清理或保留为里程碑证据（与 `ui-audit-phase1-summary.md` 等同性质） | 删除 6.8 KiB；或保留 1 个"已合并残留分支备忘"作为唯一历史快照 |
| `checkpoints/model-provider-audit.md` | B | DOC-REGISTRY 登记但无外部文档引用；当前阶段纪律（AGENTS.md §G0）已吸收"Provider / GA 属 G1+ 阶段" | 可降级：保留文件，在文件首段补 1 行"其结论已被 docs/next-steps-roadmap.md 与 AGENTS.md 当前阶段纪律吸收" | 极小（不动文件） |
| `checkpoints/ui-035-064-real-acceptance.md` | B | DOC-REGISTRY 登记；UI-035/054-064 已多次在 `ui-productization-audit.md` / `AUDIT-LOG.md` 出现；唯一当前台账已记录 | 可降级：在文件首段补 1 行吸收声明 | 极小（不动文件） |
| `checkpoints/stage2-acceptance-audit.md` | B | DOC-REGISTRY 登记；当前阶段纪律已吸收 Stage 2 结论 | 可降级：同上补 1 行 | 极小 |
| `checkpoints/stage3-m1-audit.md` | B | DOC-REGISTRY 登记；Stage 3 M1 结论已被 G0-RS 系列吸收 | 可降级：同上补 1 行 | 极小 |
| `checkpoints/audit-log-through-2026-07-26.md` | — | **保留**：被 `AUDIT-LOG.md` 自身合规引用（追溯指针）。 | 不动 | 67.8 KiB（最大） |
| `checkpoints/claude-instructions-through-stage2.md` | — | **保留**：被 `CLAUDE.md` 红字引用（红字提示）。 | 不动 | 14.4 KiB |
| `checkpoints/agent-handoff-prompt.md` | — | **保留**：被 `dependency-decoupling-checkpoint.md` 引用（失效指针）。 | 不动 | 3.3 KiB |
| `checkpoints/project-result-sandbox-plan.md` | — | **保留**：被 `project-workspace-handoff.md` §3 引用（P-02 实施指针）。 | 不动 | 26.1 KiB |
| `checkpoints/cross-platform-compatibility-audit.md` | — | **保留**：内容是跨平台 runtime 决策；当前 macOS-only 默认已收口但保留决策历史有追溯价值；唯一外部引用仅为 workbuddy memory | 不动（但 workbuddy 不是工程入口） | 4.5 KiB |
| `README.md`（archive 索引） | — | **保留**：归档目录入口文件 | 不动 | 0.5 KiB |

### 4.1 清理收益估算

| 操作 | 文件数 | 释放字节 | 风险 |
| --- | --- | --- | --- |
| A 类清理（9 个完全无外部引用） | 9 | 131.7 KiB | 低：DOC-REGISTRY 不强制注册 archive；`docs:check` 走 `excludedPrefixes`；`AUDIT-LOG` 与各 canonical 文档的现有指针都不指向这些文件 |
| B 类降级（4 个加 1 行吸收声明） | 4 | 0（不删） | 极低：仅补 1 行，文档结构不变 |
| D 类（branch-handoff.md） | 1 | 6.8 KiB | 低：唯一指针在 DOC-REGISTRY；可同步移除 |
| **合计** | 14 | **138.5 KiB** | — |

> 总占比：从 289 115 B 缩至 150 600 B（≈ -48%）。但**本次审计仅提供候选，不实施**。

## 5. 不在本审计范围（提示主 agent 转交）

> 以下项目 worker-A5 **未审计**，主 agent 如需进一步清理或决策，请转交给对应工作包。

| 项目 | 当前状态 | 不在范围原因 |
| --- | --- | --- |
| `docs/agent-workbench-enhancement-plan.md`（11.1 节） | 仍位于 `docs/`（非 archive），`status: planned`，被 `docs/README.md` / `docs/ui-productization-audit.md` / `docs/agent-workbench-p1-a5-verification-2026-08-15.md` 多处引用 | 不在 archive；本审计范围限于 archive |
| `docs/ide-transformation-plan.md` 与 `docs/ide-research/*`（建议归档） | 由 `agent-workbench-enhancement-plan.md` §11 提议归档；当前未执行 | 工作包 `G0-IDE-MCP-TOOLS` Phase 1+1.5+3 已收口、Phase 2 `deferred`；归档动作属独立 governance 工作包 |
| archive 子目录 `ide-transformation-retired/` 的实际创建 | 未发生；文件未移动 | 同上 |
| `docs/DOC-REGISTRY.json` 内 `coverage.excludedPrefixes` 是否扩到 `docs/agent-workbench-*` 等 | 当前策略未变 | 治理门禁调整属 `$petri-project-governance` skill 范畴 |
| archive 文档首段是否补"已被 X 吸收"声明（B 类降级） | 当前未发生 | 文件内容修改属归档编辑，非只读审计 |
| `claude-instructions-through-stage2.md` 第 1 行加强自警示横幅 | 当前仅有第 48/321 行的纪律提示 | 文件本体修改属归档编辑，非只读审计 |
| `docs:check` 实际运行验证（PASS / issue 数量） | 未执行；`scripts/docs-governance.mjs` 自查表明 0 issue | 本审计范围不含门禁执行；如需确认，主 agent 可运行 `npm run docs:check`（秒级） |

## 6. 审计纪律自证

- 未执行任何修改命令（commit / amend / push / mv / rm / sed / write / str-replace / edit）。
- 仅使用了 `find`、`grep`、`head`、`sed -n`、`cat` 等只读命令。
- 未触碰 `docs/archive/`、`docs/DOC-REGISTRY.json`、`CLAUDE.md`、`AGENTS.md`、`scripts/*`。
- 仅写入 `agent-tools/audit-w5-archive.md`（本次报告）。

---

*worker-A5 审计完成。归档目录 20 个文件全部审计完毕，无任何工程指针冲突。候选清理清单（A 类 9 个、B 类 4 个、D 类 1 个）由主 agent 决策。*