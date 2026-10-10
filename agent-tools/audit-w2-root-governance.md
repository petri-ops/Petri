# Audit-W2 — 根目录治理文档审计

**审计时间**：2026-08-16 09:01 (UTC+8)
**审计范围**：根目录 `AGENTS.md` / `CLAUDE.md` / `README.md` / `CHANGELOG.md` 及相关 canonical 入口
**审计约束**：只读审计，不修改任何文件

---

## 1. AGENTS.md 审计

| 检查项 | 现状 | 证据 | 建议 |
| --- | --- | --- | --- |
| 引用的 canonical 入口是否仍存在 | ✅ 全部存在 | `docs/AUDIT-LOG.md` (2026-08-16 08:45)，`docs/next-steps-roadmap.md` (2026-08-16 08:47)，`docs/project-workspace-handoff.md` (2026-08-16 08:47)，`docs/DOC-REGISTRY.json`，`.agents/skills/petri-project-governance/SKILL.md` 均存在 | 无 |
| 引用的治理文档是否仍存在 | ✅ 全部存在 | `docs/document-governance.md`，`docs/dependency-decoupling-checkpoint.md`，`docs/g0-result-studio-plan.md`，`docs/worktree-governance.md`，`docs/archive/checkpoints/claude-instructions-through-stage2.md` 均存在 | 无 |
| 引用 skill 路径是否一致 | ✅ 一致 | 统一指向 `.agents/skills/petri-project-governance/SKILL.md`；CLAUDE.md 的 `.claude/skills/` 符号链接正确指向同一实体 | 无 |
| "当前阶段纪律"段是否泄漏易漂移事实 | ⚠️ 合规但需注意 | `AGENTS.md` 是各 Agent 的**唯一工程指令**（第 119 行），`$petri-project-governance` skill 自身第 74-75 行显式引用 `AGENTS.md §"当前阶段纪律"` 作为 G0 阶段的 canonical 引用点。因此 `v0.0.1-rc.7`、`qualificationEligible: false`、`Result Studio implemented_unverified` 等易漂移事实写入 `AGENTS.md` 是**设计要求**，不是漂移违反。但 `gpt-5.6-sol`（第 110 行）是模型硬编码，可能随 Codex 配置变更而滞后 | 建议：将 `gpt-5.6-sol` 改为"主模型（由 Codex 配置决定）"，避免硬编码；或在 AGENTS.md 声明"以 Codex 当前配置为准，此处仅作历史参考" |
| 阶段纪律是否有日期/裁决溯源 | ✅ 有 | 第 28 行："用户当前已裁决'长期处于 G0 开发期'（2026-08-15）" | 无 |
| 模型委派策略段落合理性 | ⚠️ 基本合理，有边界模糊处 | `luna_worker` 被描述为"已注册的"（第 111 行），但仓库内无 `luna_worker` 的注册机制或配置文件；"已注册"语义不明确；主 Agent 使用 `gpt-5.6-sol` 硬编码（第 110 行）与"由 Codex 当前任务的模型选择器或主配置固定"存在潜在冲突 | 建议：明确 `luna_worker` 的注册位置（如 `docs/agent-registry.md`），或改为"符合委派条件的 subagent"；`gpt-5.6-sol` 改为泛指"主 Agent" |
| 是否提及 `frontend/AGENTS.md` | ✅ 有 | 第 19 行 CHANGELOG 中有记录 `frontend/AGENTS.md` 的添加 | 无 |
| 是否被 docs/ 内部文档引用 | ✅ 是 | `docs/DOC-REGISTRY.json` 已注册；`$petri-project-governance` skill 显式引用 | 无 |

---

## 2. CLAUDE.md 审计

| 检查项 | 现状 | 证据 | 建议 |
| --- | --- | --- | --- |
| 是否真的只是路由（无易漂移事实） | ✅ 是 | 仅包含启动顺序路由（指向 AGENTS.md + 4 个 canonical 入口），无阶段/进度/资格状态 | 无 |
| 顶部"Claude Code 兼容入口"措辞 | ⚠️ 小不一致 | AGENTS.md 标题为"项目指令"，CLAUDE.md 标题为"Claude Code 兼容入口"，governance skill 描述为"统一入口"；措辞有"指令"/"入口"/"兼容入口"三种说法，但语义一致 | 建议：统一为"统一工程入口"或"Agent 入口文档"，消除"兼容"隐含的次级感 |
| 引用 `$petri-project-governance` 路径 | ✅ 正确 | 第 16 行：`.claude/skills/petri-project-governance` → `../../.agents/skills/petri-project-governance`，符号链接有效 | 无 |
| 引用 canonical 入口路径 | ✅ 全部存在 | `docs/AUDIT-LOG.md`，`docs/README.md`，`docs/next-steps-roadmap.md`，`docs/project-workspace-handoff.md`，`docs/DOC-REGISTRY.json` 均存在 | 无 |
| 第 5 行"不得复制当前阶段/分支/门禁数量" | ✅ 合规 | 本文件确实未包含这些事实 | 无 |
| 与 AGENTS.md 的引用一致性 | ✅ 一致 | 第 9 行正确引用 AGENTS.md 的 G0 阶段纪律；启动顺序与 AGENTS.md 第 121 行一致 | 无 |
| 是否有自引用或循环引用 | ✅ 无 | 仅引用 AGENTS.md 和 docs/ 目录下的 canonical 文档 | 无 |

---

## 3. README.md 审计

| 检查项 | 现状 | 证据 | 建议 |
| --- | --- | --- | --- |
| 根目录 README.md 是否存在 | ❌ 不存在 | `ls /Users/zhangdiandian/Documents/1.WorkDir/Petri-workspace/desktop/README.md` → File not found | 建议：若项目需要根 README（如 npm 展示、GitHub 仓库首页），应创建并引用 `docs/README.md` 作为完整入口；或在 `docs/README.md` 顶部加"根目录另有 `AGENTS.md` 为 Agent 入口"的说明 |
| 是否被 AGENTS.md 或 docs/README.md 引用 | ⚠️ AGENTS.md 未引用根 README；CLAUDE.md 引用的是 `docs/README.md`（不是根目录） | AGENTS.md 第 136 行："项目当前文档从 `docs/README.md` 进入"；根 README.md 不存在，无引用 | 同上 |
| docs/README.md 内容 | ✅ 存在且内容相关 | 2026-08-15 更新，与 `next-steps-roadmap.md` 一致 | 无 |
| 过时阶段描述/Commit 引用 | 无根 README，无法检查 | 不适用 | 不适用 |

---

## 4. CHANGELOG.md 审计

| 检查项 | 现状 | 证据 | 建议 |
| --- | --- | --- | --- |
| 是否被 governance 文档引用 | ❌ 未引用 | `$petri-project-governance` skill 和 `AGENTS.md` 均未提及 `CHANGELOG.md` | 建议：在 `AGENTS.md` 的"相关文档"节或 governance skill 的 gate 流程中加入 CHANGELOG.md 的引用，形成完整的文档链 |
| 最新条目时间 | ❌ 严重滞后 | 最后一个 entry 为 "Week 4.1 (2026-07-15)"；而 `docs/AUDIT-LOG.md` 最新条目为 2026-08-16；gap 超过 1 个月 | 建议：创建一个 `2026-08` 或 `Week 5` 条目，记录 v0.0.1-rc.7 后续工作（UI-AGENTWB 系列、IDE MCP Tools G0-IDE-MCP-TOOLS P1 收口等）；或将 CHANGELOG 维护纳入 governance gate |
| 是否遵循 conventional commits 风格 | ❌ 部分不符 | 最近 20 行使用 `### Added/Changed/Fixed` 标注（Keep a Changelog 风格），但无 `feat:`/`fix:`/`docs:` 前缀；entry 标题如 "Week 4.1 (2026-07-15) -- Post-Gate-4 polish" 包含 `--` 分隔符，与 conventional commits 格式不完全对齐 | 建议：如需兼容 conventional commits，检查 `AGENTS.md` 或 governance skill 是否要求 conventional changelog；如仅使用 Keep a Changelog 则当前格式合规，无需修改 |
| 最新 entry 格式一致性 | ✅ 基本一致 | Week 4.1 使用 `### Changed` 子节，与 Week 4 / Week 3 保持相同结构 | 无 |
| 是否有未来日期的条目 | ✅ 无 | 最新条目为 2026-07-15，无未来日期 | 无 |

---

## 5. 跨文件一致性

### 阶段描述统一性

| 文件 | G0 描述 | 一致性 |
| --- | --- | --- |
| `AGENTS.md` 第 10 行 | "当前阶段纪律（最高优先级 · G0 长期开发期）" | ✅ |
| `CLAUDE.md` 第 9 行 | "G0 长期开发期" | ✅ |
| `docs/next-steps-roadmap.md` | "当前不默认扩展分析功能...长期处于 G0" | ✅ |
| `docs/AUDIT-LOG.md` | 多处使用 `qualificationEligible: false`，G0 开发期 | ✅ |
| `$petri-project-governance` SKILL.md | "The project is permanently in G0 development stage" | ✅ |
| `CHANGELOG.md` | 无阶段描述 | N/A |

**结论**：所有文件在 G0 阶段描述上完全一致。

### 入口路径统一性

| 引用路径 | AGENTS.md | CLAUDE.md | 一致性 |
| --- | --- | --- | --- |
| `docs/AUDIT-LOG.md` | 第 127 行（审计广播台） | 第 10 行（启动顺序 2） | ✅ |
| `docs/next-steps-roadmap.md` | 第 12 行 | 第 13 行（启动顺序 3） | ✅ |
| `docs/project-workspace-handoff.md` | 无直接引用 | 第 14 行（启动顺序 3） | ✅（AGENTS.md 用"canonical 入口"泛指，CLAUDE.md 更具体） |
| `docs/DOC-REGISTRY.json` | 第 136 行 | 第 15 行（启动顺序 4） | ✅ |
| `docs/README.md` | 第 136 行 | 第 12 行（启动顺序 3） | ✅ |
| `.agents/skills/petri-project-governance/SKILL.md` | 第 135 行 | 第 16 行 | ✅ |

**结论**：两条路由链指向相同的 canonical 入口，路径完全统一。

### 易漂移事实的所在位置

| 易漂移事实 | 所在文件 | 是否符合"单一 canonical"原则 |
| --- | --- | --- |
| 当前阶段（G0） | `AGENTS.md`（被 `$petri-project-governance` skill 显式引用） | ✅ 设计如此 |
| `qualificationEligible: false` | `AGENTS.md`（被 skill 第 75 行引用） | ✅ 设计如此 |
| 当前 active 工作包 | `docs/project-workspace-handoff.md` + `docs/DOC-REGISTRY.json` | ✅ |
| 下一步工作 | `docs/next-steps-roadmap.md` | ✅ |
| UI 验收状态 | `docs/ui-productization-audit.md` | ✅ |
| 审计活跃项 | `docs/AUDIT-LOG.md` | ✅ |
| `gpt-5.6-sol` 模型硬编码 | `AGENTS.md` 第 110 行 | ⚠️ 可能滞后但非漂移问题 |

**结论**：易漂移事实分散在各处但各自有唯一的 canonical 位置，无重复声明。

---

## 6. 不在本审计范围（提示主 agent 转交）

以下发现已超出 worker-A2 的只读审计边界，建议转交主 agent 决策：

1. **CHANGELOG.md 超过 1 个月未更新**（最后 entry 2026-07-15，AUDIT-LOG 最新 2026-08-16）：
   - 涉及 v0.0.1-rc.7 发布后的多项收口工作（UI-AGENTWB 系列、G0-IDE-MCP-TOOLS P1 收口、macOS R/Python 运行时修复等）是否需要补录
   - 是否需要将 CHANGELOG 维护纳入 governance gate

2. **根目录缺少 README.md**：
   - 是否需要创建根 README（用于 npm/GitHub 展示）
   - 如创建，内容应引用 `AGENTS.md`（Agent）或 `docs/README.md`（开发者文档）

3. **`gpt-5.6-sol` 模型硬编码**：
   - AGENTS.md 第 110 行硬编码主 Agent 模型，可能随 Codex 配置变更而滞后
   - 建议澄清是否应跟随 Codex 动态配置

4. **`luna_worker` 注册机制缺失**：
   - AGENTS.md 第 111 行提到"已注册的 luna_worker"，但仓库内无对应注册表
   - 建议明确委派边界或提供注册机制文档

5. **CLAUDE.md 标题"兼容入口"措辞**：
   - 与 AGENTS.md 的"项目指令"、governance skill 的"统一入口"措辞不一致
   - 建议统一为"Agent 入口文档"

---

## 附录：证据清单

```
docs/AUDIT-LOG.md         — 存在，2026-08-16 08:45，62215 字节
docs/next-steps-roadmap.md — 存在，2026-08-16 08:47，23142 字节
docs/project-workspace-handoff.md — 存在，2026-08-16 08:47，65470 字节
docs/DOC-REGISTRY.json   — 存在，2026-08-16 08:56，19690 字节
docs/README.md            — 存在，2026-08-15，9781 字节
.agents/skills/petri-project-governance/SKILL.md — 存在，2026-08-15，7793 字节
.claude/skills/petri-project-governance → .agents/skills/petri-project-governance (symlink valid)
AGENTS.md                 — 184 行，canonical 指令
CLAUDE.md                 — 26 行，路由文档
README.md (root)          — 不存在 ❌
CHANGELOG.md              — 存在，最后 entry 2026-07-15 ❌
git log --oneline -5:
  11e8809 fix(docs-registry): AGENT-INTERACTION-EVAL-20260814 kind=planning → reference
  719a5af docs(roadmap,handoff): Sync next-steps-roadmap + workspace-handoff to 2026-08-16
  820851a docs(governance): Relocate agent-interaction-evaluation.md to docs/planning/
  f6301cc docs(audit): WB-NAMESPACE-PUSH-2026-08-16 + petri-server /api/ai/agent 路由修复
  01c5e0b feat(skills): UI-161 closeout — relocate Skills entry to LeftPanel
```

---

*Audit-W2 completed by worker-A2 (read-only) — 2026-08-16*
