# BLOCK-10: PHASE 0 范围评估

> Plan ID: **N/A — BLOCK-10 已在仓库内完整收口，无未启动 PHASE 0**
> Phase: **PHASE 0 范围评估（worker 委派产物）**
> Status: completed (范围评估) / **pending (user 裁决：是否启动新 BLOCK-10 work?)**
> Last Updated: 2026-08-18
> Worker: BLOCK-10-PHASE-0-SCOPE-ASSESSMENT worker

---

## §1 BLOCK-10 是什么

仓库内 `BLOCK-10` 当前 **不指单一工作包**，而指**两个均已 `completed` 的独立工作包**：

| 工作包 ID | 来源 plan | 来源 audit 报告 | 范围 | 当前状态 |
|-----------|----------|----------------|------|----------|
| `BLOCK-10-AUDIT-CLOSEOUT` | `docs/code-audit-closeout-plan.md` v0.2 | 8 份 2026-08-17 Agent Harness 独立只读审计报告 | 25 个修复单元（11 Critical + 5 High + 9 Major）：IPC bridge 命名空间 / result:create / agent-tool-policy / contextToken / IPC sender 守门 / workspace_exec 白名单 / retry_stats user_id / diagnostic 路径 / PR-001 SQLite 归档 / backend exit handler / error_log / health endpoint / MCP callTool inputSchema 校验（PL-001） | **completed**（commit `b64c65b` DOC-REGISTRY active → completed） |
| `BLOCK-10-ARCHITECTURE` | `docs/block-10-architecture-plan.md` v0.2 | `BLOCK-10-AUDIT-CLOSEOUT` §10.3 候选清单 19 项（10 A-* + 5 lifecycle/DB + 4 rserver-http） | 12 主范围全部落地：DB singleton + busy_timeout / 端口统一 + env 集中 / routes/result-studio 拆分 / routes/harness 拆分 / routes/ai-agent 拆分 / agent-runner 拆分 / configure 注入 + act-tools 解环 / A-006 部分 | **completed**（commit `ba5fb6e` PHASE 4 closeout 4 canonical docs） |

**两个 BLOCK-10 工作包均已 0 代码变更收口**，符合 AGENTS.md 单工作包串行纪律与 G0 阶段纪律。

**当前仓库无 active BLOCK-10 工作包**：
- `docs/DOC-REGISTRY.json` 中 `BLOCK-10-AUDIT-CLOSEOUT` `status=completed`
- `docs/DOC-REGISTRY.json` 中 `BLOCK-10-ARCHITECTURE` `status=completed`
- `docs/next-steps-roadmap.md` 最近一次同步（2026-08-18）记录两条 COMPLETE 笔录，**当前 active 工作包 = NONE**

---

## §2 BLOCK-10 当前证据

### §2.1 docs/ 文档

| 文件 | 行数 | 用途 |
|------|-----|------|
| `docs/code-audit-closeout-plan.md` | — | BLOCK-10-AUDIT-CLOSEOUT active plan（v0.2，2026-08-18） |
| `docs/block-10-audit-closeout.md` | 11 节 | BLOCK-10-AUDIT-CLOSEOUT closeout 报告 v1.0 |
| `docs/block-10-architecture-plan.md` | 758 行 / 12 § | BLOCK-10-ARCHITECTURE active plan v0.2（PHASE 0 已收口，PHASE 1+2+3+4 已落地） |
| `docs/block-10-architecture-closeout.md` | 187 行 / 10 节 | BLOCK-10-ARCHITECTURE closeout 报告 v1.0 |
| `docs/block-10-ph0-survey.md` | — | BLOCK-10-AUDIT-CLOSEOUT PHASE 0 调研报告（19 项修复单元清单） |
| `docs/block-10-ph0-fix-order.md` | — | BLOCK-10-AUDIT-CLOSEOUT PHASE 0 修复顺序 DAG + commit 拆分 |
| `docs/block-10-ph0-test-matrix.md` | — | BLOCK-10-AUDIT-CLOSEOUT PHASE 0 测试覆盖矩阵 |
| `docs/block-10-ph0-risks.md` | — | BLOCK-10-AUDIT-CLOSEOUT PHASE 0 风险登记表 |
| `docs/block-10-arch-ph0-survey.md` | — | BLOCK-10-ARCHITECTURE PHASE 0 调研（19 项 ID 详细清单） |
| `docs/block-10-arch-ph0-fix-order.md` | — | BLOCK-10-ARCHITECTURE PHASE 0 修复顺序 DAG |
| `docs/block-10-arch-ph0-test-matrix.md` | — | BLOCK-10-ARCHITECTURE PHASE 0 测试矩阵 |
| `docs/block-10-arch-ph0-risks.md` | — | BLOCK-10-ARCHITECTURE PHASE 0 风险矩阵 |
| `docs/block-10-arch-ph2-routes-mapping.md` | 1215 行 / 85 KB | BLOCK-10-ARCHITECTURE PHASE 2 调研（49 端点清单 + 22 子模块 + 6 `_helpers/`） |
| `docs/block-10-arch-ph3-agent-runner-mapping.md` | — | BLOCK-10-ARCHITECTURE PHASE 3 调研（agent-runner 1799 行 + A-001 拆分方案） |

### §2.2 git 历史（commit `ba5fb6e` 之前所有 block-10-* commit）

| # | commit | PHASE | 范围 |
|---|--------|-------|------|
| 1 | `cf70c85` | PHASE 0 | survey + plan v0.1 active |
| 2 | `a4f8bcb` | PHASE 1 | A-007 + PR-012 + E-019 full（DB singleton） |
| 3 | `48e19e2` | PHASE 1 | A-009 + A-010（端口 + env + jspdf） |
| 4 | `427cf07` | PHASE 2 | routes mapping 调研 |
| 5 | `e832e2d` | PHASE 2.1a | result-studio facade + _helpers prep |
| 6 | `101dcfc` | PHASE 2.1b | result-studio 9 subdomains + 15 endpoints |
| 7 | `cd287f5` | PHASE 2.2a | harness 8 subdomains + 19 endpoints |
| 8 | `d620aa3` | PHASE 2.2b | ai-agent 5 subdomains + 3 endpoints |
| 9 | `9bfa01e` | PHASE 3 | agent-runner mapping 调研 |
| 10 | `5f6c2de` | PHASE 3.1 | agent-runner 1799 → 3 submodules |
| 11 | `3635e7e` | PHASE 3.2 | configure inject + act-tools cycle break |
| 12 | `ba5fb6e` | PHASE 4 | closeout 4 canonical docs + closeout 报告 v1.0 |
| 13 | `69b69b3` | PHASE 4-3 | BLOCK-10-AUDIT-CLOSEOUT 4 canonical docs + closeout |
| 14 | `f678edf` | PHASE 4-2 | BLOCK-10-AUDIT-CLOSEOUT ui-productization-audit ledger |
| 15 | `b64c65b` | PHASE 4-1 | BLOCK-10-AUDIT-CLOSEOUT DOC-REGISTRY active → completed |
| 16 | `b79c472` | PHASE 3 | BLOCK-10-AUDIT-CLOSEOUT PL-001 MCP inputSchema validation |
| 17 | `32ed9e9` | PHASE 0 | BLOCK-10-AUDIT-CLOSEOUT DOC-REGISTRY 4 PHASE 0 research reports |
| 18 | `36c2789` | PHASE 0 | BLOCK-10-AUDIT-CLOSEOUT survey + plan v0.2 active |
| 19 | `1fedf9c` | PHASE 2 | BLOCK-10-AUDIT-CLOSEOUT OB-004 + OB-005 partial |
| 20 | `a09f706` | PHASE 2 | BLOCK-10-AUDIT-CLOSEOUT PR-001 + E-017 partial |
| 21 | `1c0ebf0` | PHASE 1 | BLOCK-10-AUDIT-CLOSEOUT C-001 + C-002 |
| 22 | `4f9a10f` | PHASE 2 | BLOCK-10-AUDIT-CLOSEOUT S-004/5/6/7 |
| 23 | `128b3d4` | PHASE 2 | BLOCK-10-AUDIT-CLOSEOUT S-001/2/3 |

### §2.3 DOC-REGISTRY 登记

```jsonc
"BLOCK-10-AUDIT-CLOSEOUT"  → kind=work-package / status=completed / canonical=true
"BLOCK-10-ARCHITECTURE"     → kind=work-package / status=completed / canonical=true
"BLOCK-10-ARCHITECTURE-CLOSEOUT" → kind=reference / status=completed / canonical=false
"BLOCK-10-ARCHITECTURE-PHASE0-FIX-ORDER" → kind=reference / status=active / canonical=false
"BLOCK-10-ARCHITECTURE-PHASE0-RISKS" → kind=reference / status=active / canonical=false
"BLOCK-10-ARCHITECTURE-PHASE0-SURVEY" → kind=reference / status=active / canonical=false
"BLOCK-10-ARCHITECTURE-PHASE0-TEST-MATRIX" → kind=reference / status=active / canonical=false
"BLOCK-10-ARCHITECTURE-PHASE2-ROUTES-MAPPING" → kind=research-report / status=completed
"BLOCK-10-ARCHITECTURE-PHASE3-AGENT-RUNNER-MAPPING" → kind=research-report / status=active
"BLOCK-10-AUDIT-CLOSEOUT-CLOSEOUT" → kind=reference / status=completed / canonical=false
"BLOCK-10-PHASE0-FIX-ORDER" → kind=reference / status=active / canonical=false
"BLOCK-10-PHASE0-RISKS"     → kind=reference / status=active / canonical=false
"BLOCK-10-PHASE0-SURVEY"    → kind=reference / status=active / canonical=false
"BLOCK-10-PHASE0-TEST-MATRIX" → kind=reference / status=active / canonical=false
```

> 注：`status=active` 的 block-10-* entry 全部为 **PHASE 0 调研报告**（reference/research-report），不是新 active 工作包。active 工作包本身均已 `completed`。

---

## §3 BLOCK-10 与其他 Block 的关系

### §3.1 BLOCK-10 ↔ BLOCK-11（bioSkills 集成） — 用户当前决策点

| 维度 | BLOCK-10（已收口） | BLOCK-11-BIOSKILLS-INTEGRATION（active） |
|------|------------------|----------------------------------------|
| 范围 | 后端架构重构 + 安全/资源/契约审计修复（25 项） | bioSkills 生态 → BioF3 plugin/skill 映射（60 categories + 41 workflows = 101 顶层目录 / 562 SKILL.md） |
| 工作包类型 | 内部架构 + 审计收口 | 业务能力扩张（plugin + skill） |
| 当前阶段 | completed（2 包 19+23 = 42 commits 全部落地） | active PHASE 0（commit `02ea7bd`，PHASE 1 启动待用户裁决） |
| PHASE 1 启动条件 | 不适用（已 completed） | 用户显式裁决（user 提示词："BLOCK-11 vs BLOCK-10 顺序已裁决为 PHASE 1 实施各自互斥（BLOCK-11 已完成 SUB-1.1）"） |
| SUB-1.1 现状 | 不适用 | scanpy-advanced v1 已在 `docs/block-11-phase-1-batch-plan.md` §3.1.x 标记 SUB-1.1 八件套 ✅ 已落；尚未 commit 到 git |
| 单工作包串行纪律 | 已满足（无 active） | 当前 active；PHASE 1 实施期间不并行 BLOCK-10 PHASE 1（BLOCK-10 已无 PHASE 1 可启） |

### §3.2 BLOCK-10 ↔ BLOCK-2/3/4/5/6/7/8/9/9.1/9.2 — 历史 Block 链

| 已收口 | 边界守住证据 |
|--------|------------|
| BLOCK-2/3/4/5 IPC bridge | `BLOCK-10-ARCHITECTURE` §2.4：不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* |
| BLOCK-9/9.1/9.2 mega file 拆分 | `BLOCK-10-ARCHITECTURE` §2.4：不动 _data.ts / main.js（除 env-coordinator.js 对齐 fallback）/ DesktopSettingsPanel/ + ResultView/* + plugin/* + SimpleChat/* + useSkillStore.ts |

### §3.3 BLOCK-10 vs BLOCK-11 PHASE 1 实施互斥的事实状态

按用户裁决 "PHASE 1 实施各自互斥"：
- ✅ BLOCK-11 PHASE 1 SUB-1.1 (scanpy-advanced v1) 八件套已落（batch plan §3.1.x 标记 ✅）
- ❌ BLOCK-10 PHASE 1 不存在（两包均 completed，无 active PHASE 1）
- 故"互斥"在事实层面不冲突——`BLOCK-10` 已无 PHASE 1 可并行启动

### §3.4 BLOCK-10 不外推纪律（来自 closeout reports §11.1 / §5.1）

按 G0 阶段纪律（AGENTS.md 顶部 §当前阶段纪律）：

> G0 开发期常态 · 不外推 packaged/Provider/GA

具体不外推事项清单（来自 `docs/block-10-architecture-closeout.md` §5.2）：

- ❌ packaged Electron 公证 / 签名（G1+）
- ❌ Provider 矩阵真实接入（G1+）
- ❌ GA / release-pipeline（G1+）
- ❌ dist staleness check（G1+）
- ❌ notarization（G1+）
- ❌ MCP Server 暴露新 plugin 为工具（BLOCK-11 v1.0 §2.2 已明确"skill-runtime 层够了，MCP 暴露是 G1+"）

---

## §4 PHASE 1 范围建议（草案）

**重要事实**：
- 仓库内 BLOCK-10 双包均 `completed`，无未启动 PHASE 1
- 用户 prompt 的"BLOCK-10 PHASE 0 范围评估"与实际状态不一致——**BLOCK-10 PHASE 0 已分别被两个独立工作包做过**（AUDIT-CLOSEOUT PHASE 0 调研 + ARCHITECTURE PHASE 0 调研）
- **PHASE 1 草案仅在用户显式裁决"启动新 BLOCK-10 work"时才相关**

### §4.1 选项 A — 不启动新 BLOCK-10 work（推荐：与用户裁决"PHASE 1 实施各自互斥"一致）

按用户裁决，BLOCK-11 PHASE 1 启动期间不并行新 BLOCK-10 PHASE 1：
- **BLOCK-10 系列保持 completed，不动**
- 下一块候选保留为 BLOCK-11 SUB-1.2..1.7（seurat / celltypist / cellchat / scvi-tools + sc-analysis-standard skill），用户已裁决"暂不起动"
- BLOCK-10 候选工作包（如需新启动）由用户显式裁决

### §4.2 选项 B — 启动新 BLOCK-10 工作包（不推荐：违反用户裁决 + 缺乏证据）

如果用户后续裁决启动新 BLOCK-10 work，**7 项关联候选**（来自 `docs/block-10-architecture-closeout.md` §5.2）登记为潜在范围：

| 类别 | ID | 候选工作包 | 当前证据等级 |
|------|----|-----------|------------|
| observability 体系化 | A-004 + E-017 main + E-018 + PR-006 | observability-work-package | 仅登记，未启动 |
| rserver-http debt | C-001-rserver + C-002-rserver + M-001 + M-003 | rserver-http-debt-pack | 仅登记，未启动 |
| type drift | A-011 | type-drift-pack | 仅登记，未启动 |
| fixture manifest | A-012 | fixture-manifest-pack | 仅登记，未启动 |
| singleton 收敛（部分） | A-006（仅 `_pendingActAcks→SQLite` 1 候选） | — | 仅登记，未启动 |

**PHASE 1 启动前提**（必须用户裁决）：
1. 候选工作包名确定（observability-work-package / rserver-http-debt-pack / type-drift-pack / fixture-manifest-pack / 新组合）
2. 主 agent 起草 PHASE 0 调研（worker 委派）
3. 4 治理门 GREEN + G0 阶段纪律不外推 packaged/Provider/GA

### §4.3 BLOCK-10 vs BLOCK-11 PHASE 1 实施互斥的事实澄清

按用户裁决 "BLOCK-10 vs BLOCK-11 顺序已 user 裁决为 PHASE 1 实施各自互斥（BLOCK-11 已完成 SUB-1.1）"：
- **BLOCK-11 PHASE 1 SUB-1.1** = scanpy-advanced v1 八件套（plugin.json / environment.json / tool-definition.json / acceptance.json / scripts/scanpy-advanced.py / report-template.html / manifest.entry.json / install.json）— batch plan §3.1.x 标记 ✅，但**尚未 commit**（待主 agent 推进）
- **BLOCK-10 PHASE 1** = 不存在（completed）
- **互斥事实状态**：不冲突，因 BLOCK-10 已无 PHASE 1

---

## §5 G0 阶段纪律合规检查

按 AGENTS.md 顶部"当前阶段纪律（最高优先级 · G0 长期开发期）" §1-§6：

| 纪律 | 状态 | 说明 |
|------|------|------|
| ❌ 不主动建议/启动 Provider / 公证 / GA / 远程发布 / dist staleness（G1+） | ✅ 遵守 | 本报告不启动任何 G1+ 阶段事项；仅登记已完成 closeout |
| ❌ 不在收口报告反复写"qualificationEligible 维持 false" / "未做 Provider" / "未做 GA" | ✅ 遵守 | 本报告用"G0 开发期常态 · 不外推 packaged/Provider/GA" 收口笔录；不列举未做项 |
| ❌ 不把"dev Electron / packaged Electron 三轴对齐"描述为"待完成" | ✅ 遵守 | BLOCK-10 系列工作包均在 dev Electron 边界内 verified 收口 |
| ❌ 用户未明确裁决启动 G1+ 前，主 Agent 不得主动提出"是否要做 Provider / GA / release-pipeline" | ✅ 遵守 | §4 选项 B 明确标注"不推荐：违反用户裁决 + 缺乏证据"；选项 A 为默认推荐 |
| ✅ UI-AGENTWB-### 等前端工作包状态标头：`dev Electron 边界内 verified` / `packaged 边界内 verified` 即为当前阶段最高证据等级 | ✅ 遵守 | BLOCK-10-ARCHITECTURE closeout §3-§4 验证矩阵严格使用"dev Electron 边界内 verified" |
| ✅ 收口笔录用一句"G0 开发期常态 · 不外推 packaged/Provider/GA" | ✅ 遵守 | 详见 §3.4 + §6 |

**BLOCK-10 系列工作包 G1+ 阶段事项红旗清单**（按 §3.4 严格执行）：
- ❌ packaged Electron 公证 / 签名 — G1+
- ❌ Provider 矩阵真实接入 — G1+
- ❌ GA / release-pipeline — G1+
- � dist staleness check — G1+
- ❌ notarization — G1+
- � MCP Server 暴露新 plugin 为工具 — G1+

---

## §6 待用户裁决

**重要前提**：用户 prompt "BLOCK-10 PHASE 0 范围评估" 与仓库实际状态不一致——**BLOCK-10 双包均已 completed，无未启动 PHASE 0**。下列裁决项按 G0 阶段纪律需用户显式裁决：

1. **user 裁决 BLOCK-10 当前状态理解是否一致**：
   - 选项 A1：**确认 BLOCK-10 系列（2 包）均 completed，本范围评估无需启动新 work**
   - 选项 A2：**user 本意是新启动"BLOCK-10+1" work，需明确工作包名 / 范围 / 关联候选**
   - 选项 A3：**user 本意是 BLOCK-11 PHASE 1 范围评估（prompt 编号笔误）**

2. **如选项 A1**：本报告作为 BLOCK-10 PHASE 0 范围评估的最终状态；不启动任何代码改动；BLOCK-11 SUB-1.2..1.7 由用户后续裁决

3. **如选项 A2**：user 需明确：
   - 工作包 ID（如 `BLOCK-10.1-OBSERVABILITY-WORK-PACKAGE` / `BLOCK-10.1-RSERVER-HTTP-DEBT-PACK` 等）
   - 包含哪些 ID（A-004 + E-017 main + E-018 + PR-006 / C-001-rserver + C-002-rserver + M-001 + M-003 / A-011 / A-012 / 自由组合）
   - PHASE 0 调研 worker 委派指令

4. **如选项 A3**：本报告可作为 BLOCK-11 PHASE 0 范围评估的参考（前 BLOCK-10 closeout 经验 + 7 项关联候选不外推纪律复用）

5. **G0 阶段纪律不变**：`qualificationEligible: false` 维持 false 是 G0 长期开发期常态事实，不外推 packaged/Provider/GA

---

**G0 开发期常态 · 不外推 packaged/Provider/GA**

本报告作为 BLOCK-10 PHASE 0 范围评估的 worker 委派产物，0 代码改动，0 git 操作，0 npm 操作，仅作为 §6 待用户裁决的依据；不启动任何 BLOCK-10 PHASE 1 实施（与用户裁决"PHASE 1 实施各自互斥 + BLOCK-11 已完成 SUB-1.1" 一致）。
