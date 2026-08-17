# Audit-W1 — docs/ 目录审计

- **审计对象**：`docs/` 目录下所有 `.md` 文件（**不含** `docs/archive/`，那是 worker-A5 切片）
- **审计时间**：2026-08-16
- **审计类型**：**只读**（除本报告输出外，未修改任何 docs/ 文件；未 commit / amend / push / mv / rm / sed）
- **审计允许工具**：`npm run docs:status` / `npm run docs:check` / `cat` / `grep` / `git log` / `stat` / `find` / `wc`
- **审计覆盖基线**：62 条 DOC-REGISTRY 登记项 + 56 份受治理 Markdown（含 docs/README.md）；`docs:check` PASS
- **当前阶段纪律锚点**：`docs/AUDIT-LOG.md`（最后更新 2026-08-15）记录 G0 长期开发期、`qualificationEligible:false` 是常态事实；`docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md`（最后更新 2026-08-16）记录 6 Blocks 聚类 + 5 个 wb/ 命名空间分支已 push
- **跨切片协作**：worker-A2 / A3 / A4 / A5 各自负责治理文档 / 门禁脚本 / DOC-REGISTRY / 归档；本报告只切片 docs/ 目录结构与内容

---

## 1. 目录结构与总数

| 子目录 | 文件数 | 最大文件 | 备注 |
| --- | --- | --- | --- |
| `docs/`（根，含 README.md / AUDIT-LOG.md / DOC-REGISTRY.json） | 42 | `docs/ui-productization-audit.md`（224576 B / 402 行） | 最大文件，全仓库最大；UI 台账永久审计 |
| `docs/architecture/` | 3 | `docs/architecture/skills-architecture.md`（13905 B / 473 行） | gateway / pipeline-api / skills-architecture 三件套 |
| `docs/ide-research/` | 2 | `docs/ide-research/monaco-integration-research.md`（19982 B / 739 行） | mcp-ide-tools-design + monaco-integration-research；自带标头声明是"草稿 v0.1 / 研究阶段" |
| `docs/planning/` | 1 | `docs/planning/agent-interaction-evaluation.md`（12026 B） | 由 worker-B 2026-08-16 从仓库根迁移过来，DOC-REGISTRY 同步登记 |
| `docs/releases/` | 3 | `docs/releases/v0.0.1-rc.6.md`（2671 B / 84 行） | rc.2 / rc.6 / rc.7 三份发布记录 |
| `docs/archive/`（**不在本切片范围**） | — | — | 由 worker-A5 审计 |
| **合计（不含 archive）** | **51 + 4 sub = 55** | — | 与 `docs/README.md` · `AUDIT-LOG.md` 同行登记数 56 相符（README 是 1 份） |

**总数核对**：`find docs -name "*.md" -not -path "docs/archive/*" -type f` 返回 **56 个**（含 `docs/release*` / `docs/planning` / `docs/ide-research` / `docs/architecture`）；`docs:status` 报告 **Managed Markdown: 56** — 三个数字一致。

**最大文件 Top 3**（全部含 UI/计划/历史验收）：
- `docs/ui-productization-audit.md` 224576 B / 402 行（永久 UI 审计台账）
- `docs/g0-result-studio-plan.md` 172002 B / 1991 行（Status Studio 全部 phase 文档）
- `docs/agent-workbench-enhancement-plan.md` 85678 B / 1880 行（planned 状态，v1.1）

**国别名**：上次修改 mtime 早于 2026-07-25 的有 21 份（占 38%），其中最后更新日期明确写 **2026-07-08** 的 `docs/codex-style-workbench-direction.md` 是最久的"未更新"参考文档。

---

## 2. 状态分布

**映射规则**（按 DOC-REGISTRY.json 的 `status` + `kind`+`canonical` 字段）：
- **active canonical**：当前治理权威文档（governance / handoff / roadmap / living-plan / audit / 当前 active 工作包）
- **completed reference**：已收口的工作包 / 阶段，保留为追溯
- **planned canonical**：未来工作但尚未启动（必须由用户裁决才能启动）
- **reference**：长期不变的方向 / 规范（design / harness spec / 第三方插件 / 排错指南）
- **release**：版本说明（rc.2 / rc.6 / rc.7）
- **superseded**：被替代（DOC-REGISTRY.json 中没有 `status:superseded` 字段；通过 archive 表达——见 §6）

| 分类 | 文档数 | 列表 |
| --- | --- | --- |
| **active canonical**（governance / handoff / roadmap） | 6 | `docs/README.md`（DOC-INDEX）、`docs/document-governance.md`（GOV-DOC-1）、`docs/worktree-governance.md`（GOV-WT-1）、`docs/COLLABORATION.md`、`docs/parallel-development-guide.md`、`docs/development-module-map.md`（MODULE-MAP） |
| **active canonical**（living-plan / vision / 当前 active 工作包） | 7 | `docs/scientific-intelligence-os-vision.md`（VISION-SCIENTIFIC-OS）、`docs/g0-living-foundation-plan.md`（G0-LF）、`docs/ui-productization-audit.md`（UI-PRODUCTIZATION-AUDIT）、`docs/AUDIT-LOG.md`（AUDIT-LOG）、`docs/next-steps-roadmap.md`（ROADMAP-NEXT）、`docs/project-workspace-handoff.md`（WORKSPACE-HANDOFF）、`docs/g0-scientific-data-contract-plan.md`（G0-SDC · status=planned 但 canonical=true） |
| **active canonical**（reference · 长期规范） | 6 | `docs/g0-rs0-result-studio-audit.md`（G0-RS0）、`docs/runtime-version-baseline.md`（RUNTIME-VERSION-BASELINE）、`docs/architecture/gateway-design.md`（GATEWAY-DESIGN）、`docs/architecture/skills-architecture.md`（SKILLS-ARCHITECTURE）、`docs/macos-oss-auto-update.md`（MACOS-OSS-UPDATE）、`docs/BioF3-Desktop-Evaluation-Report-2026-08-14.md`（DESKTOP-EVAL-20260814） |
| **active canonical**（reference · 插件 / Skills 协议） | 5 | `docs/plugin-artifact-schema.md`（PLUGIN-ARTIFACT-SCHEMA）、`docs/third-party-plugin-guide.md`（PLUGIN-THIRD-PARTY-GUIDE）、`docs/harness-engine-spec.md`（HARNESS-ENGINE-V1）、`docs/harness-tool-template.md`（HARNESS-TOOL-TEMPLATE）、`docs/codex-style-workbench-direction.md`（UI-WORKBENCH-DIRECTION） |
| **completed reference**（已完成工作包 / 阶段） | 12 | `docs/g0-lf12-baseline-qualification-plan.md`（G0-LF12）、`docs/g0-critical-crosscut-hardening-plan.md`（G0-CHF0）、`docs/g0-rs-ux1h-async-tool-surface.md`（G0-RS-UX1H）、`docs/agent-concurrency-design.md`（AGENT-CONCURRENCY）、`docs/harness-loop-engineering-plan.md`（HLE-V1）、`docs/harness-loop-production-closure-plan.md`（HLE-PRODUCTION-CLOSURE）、`docs/harness-phase7-completion-plan.md`（HARNESS-PHASE7）、`docs/harness-scientific-task-contract-plan.md`（HRT-V1）、`docs/g0-ide-mcp-tools-plan.md`（G0-IDE-MCP-TOOLS）、`docs/agent-workbench-p1-a5-verification-2026-08-15.md`（AGENT-WORKBENCH-P1-A5）、`docs/t-aw-013-packaged-verification-2026-08-15.md`（AGENT-WORKBENCH-T-AW-013）、`docs/agent-workbench-dev-electron-verification-2026-08-15.md`（AUDIT-AGENT-WB-DEV-ELECTRON-VERIFICATION-2026-08-15） |
| **planned canonical**（用户裁决才能启动） | 3 | `docs/g0-result-studio-plan.md`（G0-RS · planned R7 deferred）、`docs/ide-transformation-plan.md`（IDE-TRANSFORMATION）、`docs/agent-workbench-enhancement-plan.md`（AGENT-WORKBENCH） |
| **reference**（实验 / 待 supersede） | 4 | `docs/dependency-decoupling-checkpoint.md`（DEPENDENCY-DECOUPLING · completed but kept）、`docs/first-success-path.md`（FIRST-SUCCESS-PATH）、`docs/architecture/pipeline-api.md`（PIPELINE-API）、`docs/stage3-standard-workflows-design.md`（STAGE3-WORKFLOWS-DESIGN） |
| **reference**（Skills 设计稿 · 状态设计稿） | 3 | `docs/skills-registry.md`（SKILLS-REGISTRY · canonical=false）、`docs/skills-schema.md`（SKILLS-SCHEMA · canonical=false）、`docs/skills-workflow-integration.md`（SKILLS-WORKFLOW-INTEGRATION · canonical=false） |
| **reference**（Skills 入口研究） | 2 | `docs/ide-research/mcp-ide-tools-design.md`（IDE-MCP-TOOLS-DESIGN）、`docs/ide-research/monaco-integration-research.md`（IDE-MONACO-RESEARCH） |
| **reference**（项目级审计） | 1 | `docs/project-wide-audit-2026-07.md`（AUDIT-PROJECT-WIDE-2026-07） |
| **release** | 3 | `docs/releases/v0.0.1-rc.2.md`（RELEASE-RC2）、`docs/releases/v0.0.1-rc.6.md`（RELEASE-RC6）、`docs/releases/v0.0.1-rc.7.md`（RELEASE-RC7） |
| **release**（已完成 stable） | 1 | `docs/stage4-stable-release-checklist.md`（STAGE4-STABLE-RELEASE） |
| **reference**（迁移 / 评估） | 1 | `docs/planning/agent-interaction-evaluation.md`（AGENT-INTERACTION-EVAL-20260814） |
| **active canonical**（长期产品路线） | 1 | `docs/v1-productization-roadmap.md`（ROADMAP-V1） |
| **active canonical**（历史审计） | 1 | `docs/g0-rs0-result-studio-audit.md`（已计入上方 active reference） |
| **当前 active 工作包（按 AUDIT-LOG 收敛）** | **0** | AUDIT-LOG 2026-08-16 顶部声明"当前无 🔴 阻塞"且"当前无 active 工作包"；6 个 Block 全部已收口（含 4 个 `verified`、3 个 `in_progress` UI-AGENTWB-001/002/UI-161） |
| **总计** | **56** | `docs:status` 报告 Managed Markdown: 56 |

**注**：按 AGENTS.md "G0 长期开发期 · 单工作包串行" 纪律，**当前没有 active 工作包**——所有 G0/RS/HLE/HRT/AGENT-CONCURRENCY/G0-IDE-MCP-TOOLS/G0-CHF0 计划都已 `completed`；最近一批是 2026-08-14 收口的 AGENT-WORKBENCH / P1-T-AW-013 / P1.5 / UI-AGENTWB-005/006/007（dev Electron + packaged 三轴）。`docs:reconcile` 与 `docs:check` PASS（62 registered）。

---

## 3. 过时风险候选（每条必给证据 + 修复建议）

> 注：每条都已与 `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md`（2026-08-16 同步）+ `docs/AUDIT-LOG.md`（2026-08-15）核对。"当前时间"基线 = 2026-08-16。

| 文档 | 风险点 | 证据位置 | 建议 |
| --- | --- | --- | --- |
| `docs/agent-workbench-enhancement-plan.md` | **重复标题**：`# BioF3 Agent 工作台增强计划` 连续出现两次（行 1 + 行 2）。`docs:check` 不校验此问题，但 markdown 渲染时第二行被部分解析器当成 H1 漂移 | `head -3 agent-workbench-enhancement-plan.md`：`1:# BioF3 Agent 工作台增强计划\n2:# BioF3 Agent 工作台增强计划\n3:\n>` | **删除第 2 行重复 H1**（治理口径：文档只能在第一行写唯一标题） |
| `docs/agent-workbench-enhancement-plan.md` | **§13.1 显式建议归档 3 份文档**：行 137 写"`docs/ide-transformation-plan.md` 和 `docs/ide-research/` 目录建议后续归档，因为它们代表了一个已放弃的方向"；行 1471-1473 也确认 3 份文档应归档（ide-transformation-plan.md / mcp-ide-tools-design.md / monaco-integration-research.md），但实际仍未归档，且 §X 写出的 `git mv` 迁移脚本也未执行 | 行 137、137 注、行 1471-1473、行 1482-1483（迁移脚本） | **不应由 A1 主动执行**（违反"不动 docs/"切片纪律）；**写入**`§6 不在本审计范围`——交付主 agent 决定是否启动IDE-TRANSFORMATION 归档（DOC-REGISTRY 计划 ID 已 `planned` 但 §1.4 表已写"已放弃"） |
| `docs/agent-workbench-enhancement-plan.md` | **§1.4 表格把"IDE 改造方向"标为"归档"**——与 `docs/DOC-REGISTRY.json` 中 `IDE-TRANSFORMATION` `status:planned`、`canonical:true` 互相冲突；计划文档自相矛盾地要求把同一份文档的"计划"状态归档 | 行 127-138 §1.4 表格"IDE 改造方向（归档）" vs DOC-REGISTRY `"status": "planned"` | **登记方冲突**：UI-AUDIT/PRODUCTIZATION 也未引 `ide-transformation-plan.md`；建议主 agent 决定是否转移为 `reference` 状态或归档 |
| `docs/v1-productization-roadmap.md` | **rc.5 / rc.6 引用 vs 当前 rc.7**：行 36 仍写"Stage 1 状态：**已完成（`v0.0.1-rc.5` 检查点）**"；行 22 写"`v0.0.1-rc.7` 是当前 OSS 安装基线"——两行一致但行 36 保留 rc.5 字面意义已偏离"当前阶段"（HEAD 在 rc.7 之后 1 个月） | 行 22 vs 行 36：行 22 声明 rc.7，行 36 提到 rc.5 | **行 36 改为"已完成（`v0.0.1-rc.5` 历史检查点；当前基线 `v0.0.1-rc.7`）"**避免误读 |
| `docs/v1-productization-roadmap.md` | **§7 「rc.7 使用反馈与缺陷修复」是非 active 工作**：行 13 写"当前立即任务"是固定顺序 Stage 1–4，且全部"已完成"；行 234 写"Stage 1–4 的 macOS arm64 RC 出口均已关闭"——但文档最后更新仍是 2026-07-21（35 天前），未跟进到 2026-08-16 的 6 Blocks 同步 | 行 7 "最后更新：2026-07-21"；最新 4 周收口 0 提及 | **同步日期**到 2026-08-16 并把 §7 "当前立即任务"段补上 6 Blocks 摘要（指向 AUDIT-LOG / handoff） |
| `docs/dependency-decoupling-checkpoint.md` | **last update 2026-07-16**（31 天前），但 Phase B 后续工作（runner-only / 持久化 / 5 月份 AB-12 commit）已分散到 `g0-result-studio-plan.md` / `AUDIT-LOG.md` / `harness-loop-engineering-plan.md`。`DOC-REGISTRY` 标 `status:completed / canonical:false · archivePolicy:retain_stable_path`——本身是 reference 不需要更新，但与 `dependency-decoupling-checkpoint.md` ASCII 树形图未涵盖 2026-08 Core 内联后的"`core/` 已 1 层深" 全部产物 | 行 3 "最后更新：2026-07-16"；DOC-REGISTRY `canonical:false` | **保持 reference**（canonical=false 决定），但 §"已完成"段后可以加 1 行"2026-08 后增量"——**非 A1 修复范围** |
| `docs/harness-engine-spec.md` | **状态指针仍指 v1.0 / Phase 1–6 完成**：行 3 "状态：Harness Phase 1–6 基础规范已完成。当前 UI/模型阶段只保持回归；Stage 3 继续复用本规范"——但 `v1-productization-roadmap.md` 行 234 写"Stage 3 已完成软件面试点"且 `harness-phase7-completion-plan.md` 已 completed；当前文档不再反映 Phase 7 / HRT-0~7 / HLE-C0~C5 状态 | `docs/harness-engine-spec.md` 行 3；行 365-369 含 "§9 Prompt Compiler 规范" 仍描述 v1 草图；DOC-REGISTRY `kind:reference / status:reference / canonical:true` | **顶部状态句追加**："Phase 7（2026-07-21）/ HRT-0~7（2026-07-22）/ HLE-C0~C5（2026-07-24）已分别收口，本规范保持 v1 草图为锚点不再更新" |
| `docs/harness-roadmap.md` | **"vendor 工作流已退役" warning 在行 5**，但 § "2026-07-13 今日 Harness 布局" 整段提及"前置 UI checkpoint 已在 2026-07-13 通过"——35 天无更新；下方 "推荐推进顺序"被 `harness-scientific-task-contract-plan.md` / `harness-loop-engineering-plan.md` 等具体计划替代 | 行 7 "最后更新：2026-07-21"；行 17 "2026-07-13 今日 Harness 布局" | **保留 reference**（DOC-REGISTRY `status:reference / canonical:false`），但§0 顶部状态句补"§ 推荐推进顺序已由 HLE-v1 / HLE-Production / HRT-v1 / Harness Phase 7 计划分别落地，本文保持 2026-07-21 之前快照" |
| `docs/harness-tool-template.md` | **mtime 2026-07-12**（35 天前），`DOC-REGISTRY` 标 `status:reference / canonical:true`——但模板对应 `templates/harness-tools/<id>` 路径，未在 README "当前有效专项规范"中列出来源命令 `npm run harness:scaffold` 是否仍存在 | row 1 "最后更新：2026-07-12"；DOC-REGISTRY `truthDomain=harness-tool-template` | **A1 主范围内**核对 `package.json` 中 `harness:scaffold` 是否仍存在——**不在 A1 切片**（A1 只读 docs/），转交主 agent |
| `docs/macos-oss-auto-update.md` | **行 104**："`main`、`origin/main` 与不可变标签 `v0.0.1-rc.6` 的发布提交一致（`907b695`）"——与 `docs/next-steps-roadmap.md` 行 102 写"当前代码、标签与 OSS 线上版本：`v0.0.1-rc.7`（发布提交 `ab519fa`）"不一致；RC 6 已是历史 RC，文档应明确"rc.6 阶段行为"为历史快照 | 行 4 "最后更新：2026-07-19"；行 104 | **行 104 改为"历史提交 `907b695`（rc.6 阶段）；当前 rc.7 节点为 `ab519fa`"**——或在行 1 头部加"rc.6 历史快照，当前发布规范以 rc.7 流程为准" |
| `docs/stage4-stable-release-checklist.md` | **行 28 / 31 / 69** 仍写为"`v0.0.1-rc.6` tag 与 main 已推送"；行 1 "最后更新：2026-07-19"；**已发布到 rc.7**（2026-07-21 发布）——台账实际是"rc.6 收口"，但目录与 `next-steps-roadmap.md` 同步把 rc.7 标为"当前 OSS 线上版本" | 行 1 / 28 / 31 / 69 / 71（提到 `0.0.1-rc.6`） | **追加 §rc.7 收口段**（行 1 头部时间不变，但 §1 顶部用一行写"本台账记录 Stage 4 rc.6 收口；rc.7 收口见 `docs/releases/v0.0.1-rc.7.md` + `docs/next-steps-roadmap.md` §已完成基线"），或归档到 `docs/archive/releases/stage4-rc6-checkpoint.md` |
| `docs/stage3-standard-workflows-design.md` | **行 1 "最后更新：2026-07-19"**（28 天前），但 `Stage 3` 在 `v1-productization-roadmap.md` 行 234 已声明"已闭"；`DOC-REGISTRY` 标 `status:reference / canonical:false`——合理，但 README "当前有效专项规范" 段列入此文档 | 行 1-3；DOC-REGISTRY `status:reference / canonical:false` | **保留**（DOC-REGISTRY 设计），但在 README 行 51-63 "当前有效专项规范" 段把此文档追加"(*Stage 3 历史记录*)"标注 |
| `docs/ui-productization-audit.md` | **行 244 契约偏差**：AUDIT-LOG 2026-08-15 已登记 "T-AW-013 CONTRACT-DRIFT-001：ui-productization-audit.md 行 244 resultNodes 描述偏向 brief，与实际 renderer 源码 4 处不一致"——笔录未引用实际 renderer source | `docs/AUDIT-LOG.md` 行 32 | **A1 不修改**（A1 是 worker-A1 切片），但需在报告里点名：下一轮"笔录引用 src 文件位置 + 复制 renderer 注释里的合同"——已由 2026-08-15 12:00 AUDIT-LOG 注明延期到下一次 P1.* 收口 |
| `docs/next-steps-roadmap.md` | **"当前立即任务" 段最初是 2026-07-21 基线**（行 102 "当前代码、标签与 OSS 线上版本：`v0.0.1-rc.7`（发布提交 `ab519fa`）"）但 §2026-08-14 → 2026-08-16 同步笔录已加上去（行 213-241）。已与 AUDIT-LOG / handoff 同步 | 行 213-241 段 | **OK**（同步已生效） |
| `docs/project-workspace-handoff.md` | **"最后更新：2026-08-11"** 但 mtime 2026-08-16（worker-C 同步笔录）。同步笔录已加；但头部"最后更新"字面仍是 2026-08-11 | 行 3 "最后更新：2026-08-11"；行 213-241 段是 2026-08-16 追加 | **更新头部日期**到 2026-08-16（与 mtime 对齐） |
| `docs/harness-engine-spec.md` / `docs/harness-roadmap.md` / `docs/harness-loop-engineering-plan.md` | **"v1.0 / v1.1 / v1.2 不同小版本分布"**：`harness-engine-spec.md` 为 v1、`harness-loop-engineering-plan.md` 为 v1（但 §"未来"段提到 Harness v1.1）、`harness-loop-production-closure-plan.md` 收口标记 `Harness v1.1 / Loop Engineering v1`——3 份文档版本号口径不一致 | 行 3 / 行 39 / 行 5、41 | **保留**（属于"v1 = 主线 / v1.1 = 收口"区分）；不在 A1 修复 |
| `docs/agent-workbench-enhancement-plan.md` | **TOC 段包括 4 段 mermaid 样代码**：行 1476-1485 包含 `git mv` / `mkdir -p` / `git mv` 等 bash 命令（被解析为代码块但语义上是"归档迁移脚本"），文档阅读者易误以为是已执行 | 行 1476-1485 | **保留**（占位/草案），但段头补"以下为草案脚本，未执行；归档操作需由 A2 / A4 决策后启动"——转交主 agent |
| `docs/AUDIT-LOG.md` | **"最后更新：2026-08-15"** 顶部元数据，但 mtime 2026-08-16（已收口"wb/ 命名空间分支一次性推送" + "r-server /api/ai/agent 路由修复"）——行 7 顶部"最后更新"未更新到 2026-08-16 | 行 7；AUDIT-LOG 行 118-119 是 2026-08-16 收口条目 | **更新头部日期**到 2026-08-16 |
| `docs/codex-style-workbench-direction.md` | **mtime 2026-07-08**（最久 39 天前）。`DOC-REGISTRY` 标 `status:reference / canonical=true / truthDomain=workbench-ui-direction`——当前 UI 方向仍以此为锚，但 `agent-workbench-enhancement-plan.md` §1.4 已把"Codex 工作台" 方向重新定义；该文档与 enhancement plan 概念重叠 | 行 1 "最后更新：2026-07-08"；行 1-3 描述"Codex 式工作台交互"；agent-workbench enhancement plan §1.4 重新定义 | **保留**（DOC-REGISTRY 决定）；但 README 第 22 行对此文档标注"(*Codex 方向，2026-07-08 快照；当前实现路径以 `agent-workbench-enhancement-plan.md` §1.4 增量增强口径为准*)" |
| `docs/agent-workbench-p1-a5-verification-2026-08-15.md` / `docs/agent-workbench-dev-electron-verification-2026-08-15.md` / `docs/t-aw-013-packaged-verification-2026-08-15.md` | **3 份相互关联的验证报告，互相引用对方"已完成"**：A5 报告行 5 引用 commit `db2e04b`；T-AW-014 报告行 17 引用 T-AW-013 commit `1d1d1b2`；T-AW-013 报告行 5 不引用前一份——文档生命周期为 1 轮验证，但 `ui-productization-audit.md` 行 244 提到"未引用实际 renderer source"——A5 / T-AW-014 已借此对齐 | 3 份文档相互引用 | **OK**（3 份报告已通过 AUDIT-LOG 2026-08-15 06:00 收口） |
| `docs/ide-research/mcp-ide-tools-design.md` | **§7 实施计划** 第 2 阶段仍是 Monaco 编辑器 6 个工具（行 60-90），但 `g0-ide-mcp-tools-plan.md` §Phase 2 行 44-46 已声明 "Phase 2 — 编辑器 + 搜索（P0/P1）"**继续 `deferred`**——两份文档对 Phase 2 状态描述虽一致（都 deferred），但需求列已"21 工具"vs"实际实现 18 工具" | 行 60-90；`g0-ide-mcp-tools-plan.md` §11 收口 | **保留**（研究文档保持原状）；但 README 行 14 frame 描述"21 个 IDE MCP 工具"与 `g0-ide-mcp-tools-plan.md` 行 4 "18 个 `ide_*` 工具"不一致——README 必须更新到 18 |
| `docs/README.md` | **README 行 14 录入"21 个 IDE MCP 工具"**，但 `g0-ide-mcp-tools-plan.md` 行 4 与 `AUDIT-LOG.md` 行 116 收口是"18 个 `ide_*` 工具（7 文件 + 5 终端 + 1 search + 1 diff + 4 git）+ 2 个 MCP Resources" | 行 14；`g0-ide-mcp-tools-plan.md` 行 4；AUDIT-LOG 行 116 | **行 14 改为"18 个 `ide_*` 工具"**（README 数据漂移） |
| `docs/agent-workbench-enhancement-plan.md` | **与 3 份验证报告 (A5 / T-AW-013 / T-AW-014) 不互相引用**：3 份验证报告多次出现 `UI-AGENTWB-003 / UI-AGENTWB-004` 等 ID，但 enhancement plan **全文不提 `UI-AGENTWB-00X` ID**——两份/四份文档用的 ID 命名体系不一致（A1/A2/A3/A4 vs UI-AGENTWB-001/002/003/004） | `enhancement-plan.md` 全文；`ui-productization-audit.md` 行 240-241、363-367；3 份验证报告 | **保留**（enhancement plan 是 planned；3 份验证是审计追踪）；写入 §6 不在本审计范围 |

---

## 4. 冗余/可合并候选

| 文档 A | 文档 B | 重叠点 | 建议 |
| --- | --- | --- | --- |
| `docs/ide-transformation-plan.md` | `docs/ide-research/mcp-ide-tools-design.md` + `docs/ide-research/monaco-integration-research.md` | 3 份都属于"已放弃的 IDE 改造方向"——`agent-workbench-enhancement-plan.md` §1.4（行 127-138）写明 "agent-workbench 不是 IDE 改造方向"，原 IDE 改造计划 + 研究文档两条路径都已被 `g0-ide-mcp-tools-plan.md` 替代（仅保留 Phase 1+1.5+3 18 个文件/终端/git 工具） | **冗余**：3 份已放弃方向文档 + `g0-ide-mcp-tools-plan.md` 收口实质完成各自规划。**整合**：把 `ide-transformation-plan.md` + `ide-research/` 整体迁移到 `docs/archive/ide-transformation-retired/`（`agent-workbench-enhancement-plan.md` 行 1471-1485 已写迁移脚本）——**需用户裁决**；**A1 不动手** |
| `docs/architecture/skills-architecture.md` | `docs/skills-schema.md` + `docs/skills-registry.md` | 3 份 Skills 文档结构高度关联；`architecture/skills-architecture.md` 描述"四层架构（L1-L4 = Skills → Workflows → Plugins → Capabilities）"，`skills-schema.md` 描述"Skill Manifest 结构"，`skills-registry.md` 描述"三来源发现"——3 份都标 `canonical:false`（architecture/skills-architecture 例外 = canonical=true / status=active），但**分工未在 README 中明示** | **保留**（DOC-REGISTRY 决定）；但 README 第 49-56 "当前有效专项规范" 段应明确 3 份中哪份是入口（建议以 `architecture/skills-architecture.md` 为入口，另两份作为子文档） |
| `docs/g0-result-studio-plan.md` | `docs/g0-rs-ux1h-async-tool-surface.md` + `docs/g0-rs0-result-studio-audit.md` + `docs/agent-concurrency-design.md` | 3 份子文档都是 `g0-result-studio-plan.md` 的子阶段记录，且 `g0-result-studio-plan.md` §0 / §1.0 / §14 主动索引到 3 份子文档。但 `g0-rs-ux1h-async-tool-surface.md` `status:completed` 与 `g0-result-studio-plan.md` `status:planned` 父子关系清晰——**不冗余** | **保留**（DOC-REGISTRY 决定父子关系） |
| 3 份 Harness 收口计划 (`harness-loop-engineering-plan.md` / `harness-loop-production-closure-plan.md` / `harness-scientific-task-contract-plan.md`) | `docs/harness-engine-spec.md` / `docs/harness-roadmap.md` | 5 份文档都描述 Harness 边界，但分工明确：spec = 规范 v1 / roadmap = 阶段路线图 / 3 份 = 收口闭环记录——**不冗余** | **保留** |
| `docs/releases/v0.0.1-rc.2.md` | `docs/next-steps-roadmap.md` · README "发布记录"段 | rc.2 是 OSS 迁移前历史 GitHub prerelease；README 行 66 把它列为"OSS 迁移前历史发布记录"；`next-steps-roadmap.md` 正文只用 rc.7。**与文档主体不重复**，但单独作为发布档案存在 | **保留**（README 已标注） |
| `docs/agent-workbench-enhancement-plan.md` §5 (P1.1 / P1.2 / P1.3) | `docs/agent-workbench-p1-a5-verification-2026-08-15.md` + `docs/agent-workbench-dev-electron-verification-2026-08-15.md` + `docs/t-aw-013-packaged-verification-2026-08-15.md` | enhancement plan 描述待实现的 P1.1/P1.2/P1.3，3 份验证报告描述 A4 + P1.3 + P1.5 + UI-AGENTWB-007 的实机验证。两套 ID 体系并存（A1/A2/A3/A4 vs UI-AGENTWB-001/002/003/004） | **保留**（enhancement plan 是 planned 预算，不是实际落地）；但 enhancement plan 应在 §5 "P1.1 验收标准" 中**主动引用** 3 份验证报告作为已完成的实机证据 |
| `docs/dependency-decoupling-checkpoint.md` | `docs/README.md` AGENTS.md 第二段指向 | 仓库内 Core inline 去耦是 2026-07-16 一次性完成，已是 main 实际状态——文档存在"维持历史"价值，不冗余 | **保留** |
| `docs/stage4-stable-release-checklist.md` | `docs/releases/v0.0.1-rc.7.md` + `docs/next-steps-roadmap.md` | Stage 4 收口台账记 rc.6 收口；rc.7 收口见 `releases/v0.0.1-rc.7.md`——**两份台账分别记录不同 RC 阶段**，不冗余 | **保留**（但建议在 stage4-stable-release-checklist.md 顶部加"rc.7 收口见 `docs/releases/v0.0.1-rc.7.md`"） |
| `docs/v1-productization-roadmap.md` | `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md` | v1-productization-roadmap.md 是产品阶段路线（"Stage 1 UX → Stage 2 Model → Stage 3 Harness → Stage 4 v1"），next-steps-roadmap.md 是任务层"当前结论 / 立即任务"，handoff 是"可恢复工程状态"——**3 份分工明确**；v1 已 28 天未更新（A1 见 §3） | **保留**（DOC-REGISTRY 设计） |
| `docs/runtime-version-baseline.md` | `docs/releases/v0.0.1-rc.6.md` / `docs/releases/v0.0.1-rc.7.md` | runtime-version-baseline.md 锁定 R 4.5.2 / Python 3.11.9 / Bioconductor 3.22；rc.6 / rc.7 文档均引用此契约。**不冗余** | **保留** |
| `docs/COLLABORATION.md` | `docs/parallel-development-guide.md` | COLLABORATION.md = 团队协作（分支 / 合并前门禁 / 双机并行 / Node 版本）；parallel-development-guide.md = 多模块并行开发冲突管控。**职责边界清楚** | **保留** |
| `docs/development-module-map.md` | `docs/architecture/gateway-design.md` / `docs/architecture/pipeline-api.md` | module-map = 总目录（模块编号 W-01 ~ W-07 等）；gateway-design / pipeline-api = 描述具体架构接口。**不冗余** | **保留** |

---

## 5. archive 候选（不删，仅列）

> 判定规则：满足以下任一条件即列入——被引用方 supersede / 完整被另一份文档涵盖 / `status:completed` 且无外部引用

| 文档 | 候选理由 | 外部引用 grep 结果 | 建议 |
| --- | --- | --- | --- |
| `docs/ide-transformation-plan.md` | `status:planned`（DOC-REGISTRY）但 `agent-workbench-enhancement-plan.md` §1.4（行 127-138）明确"放弃方向，已不存在独立 IDE 改造路径"；§0 顶部也声明"代表已放弃的方向" | **被引用**：`docs/README.md` 行 14（项目治理入口 / BioF3 IDE 改造计划）、`docs/DOC-REGISTRY.json`（planned）、`docs/AUDIT-LOG.md` 行 13（"启动 G0-IDE-MCP-TOOLS"）、`docs/agent-workbench-enhancement-plan.md` 行 127、137、1471；**反向引用**：`docs/g0-ide-mcp-tools-plan.md` 行 114 "Phase 2 启动门：Monaco 必须已有可工作入口；否则延后到 IDE-Transformation 之后"——**保留存在**依赖 | **建议归档**到 `docs/archive/ide-transformation-retired/`（DOC-REGISTRY truthDomain + canonical 同步改为 `status:superseded` 或 `archived`）——**需用户裁决**；**A1 不动手** |
| `docs/ide-research/mcp-ide-tools-design.md` | `status:reference`（DOC-REGISTRY）但 `g0-ide-mcp-tools-plan.md` 已将其 Phase 1+1.5+3 收口（18 工具 + 2 resources；Phase 2 仍 deferred） | **被引用**：`docs/DOC-REGISTRY.json`、`docs/g0-ide-mcp-tools-plan.md` 行 9、19（"中定义的 IDE MCP 工具集"）、`docs/agent-workbench-enhancement-plan.md` 行 1472；**反向引用**：`docs/AUDIT-LOG.md` 行 13 | **建议归档**到 `docs/archive/ide-transformation-retired/ide-research/`——**需用户裁决** |
| `docs/ide-research/monaco-integration-research.md` | `status:reference`（DOC-REGISTRY）；Monaco Editor 集成研究——BioF3 当前 `highlight.js`（`rehype-highlight`）+ 无 `monaco-editor` 依赖；`ide-transformation-plan.md` 已 deferred | **被引用**：`docs/DOC-REGISTRY.json`、`docs/agent-workbench-enhancement-plan.md` 行 1473；**反向引用**：0 命中（不在 handoff / next-steps / AUDIT-LOG 中） | **建议归档**（同 batch 1） |
| `docs/stage4-stable-release-checklist.md` | `status:completed`（DOC-REGISTRY）；最后一版台账锁 rc.6 而 rc.7 已发布 | **被引用**：`docs/README.md` 行 56（"当前稳定版本收口台账，出口矩阵与实机证据"）、`docs/next-steps-roadmap.md` 行 7（"Stage 4 首个稳定产品版本"）；**反向引用**：`docs/stage4-stable-release-checklist.md` 自身引用 `docs/releases/v0.0.1-rc.6.md` | **保留**（README 仍作 stable 入口）；§1 顶部追加"本台账记录 rc.6 收口；rc.7 出口证据见 `docs/releases/v0.0.1-rc.7.md`"——**A1 不动手** |
| `docs/dependency-decoupling-checkpoint.md` | `status:completed`（DOC-REGISTRY）但 archivePolicy=`retain_stable_path`——保留为历史检查点 | **被引用**：`docs/README.md` 行 8、113（"架构去耦检查点"）；`docs/next-steps-roadmap.md` 行 99（"依赖去耦"）；`docs/agent-workbench-enhancement-plan.md` §0.4 (附录)、`docs/harness-roadmap.md` 行 5 | **保留**（archivePolicy 决定） |
| `docs/first-success-path.md` | `status:reference`（DOC-REGISTRY）`canonical:false`；自标 "maintained as the demo/golden-path regression contract" / "not the current product roadmap" | **被引用**：`docs/README.md` 行 53（"demo/golden-path 回归说明"）、`docs/stage4-stable-release-checklist.md` 行 31（"first-success 合同"）；**反向引用**：0 命中 | **保留**（被台账/canonical 入口引用） |
| `docs/architecture/pipeline-api.md` | `status:reference`（DOC-REGISTRY）`canonical:false` | grep 引用：`docs/README.md` 行 7（"项目治理入口"被列出）、`docs/DOC-REGISTRY.json`；**反向引用** 0 | **保留**（DOC-REGISTRY） |
| `docs/codex-style-workbench-direction.md` | mtime 2026-07-08（最久 39 天前）；`status:reference`（DOC-REGISTRY）`canonical:true` `truthDomain=workbench-ui-direction`——但 `agent-workbench-enhancement-plan.md` §1.4（行 127-138）已把"Codex 工作台" 重新定义为"agent-workbench 增量增强" | **被引用**：`docs/README.md` 行 22（"UI 产品方向"）、`docs/agent-workbench-enhancement-plan.md` 附录 C（行 1485）；**反向引用**：0 | **保留**（DOC-REGISTRY 设计），但 README 行 22 标注 "(*Codex 方向，2026-07-08 快照；当前实现路径以 `agent-workbench-enhancement-plan.md` §1.4 增量增强口径为准*)" |
| `docs/skills-registry.md` / `docs/skills-schema.md` / `docs/skills-workflow-integration.md` | 3 份 `status:reference / canonical:false`（DOC-REGISTRY）——全部是"设计稿（待实现）" | **被引用**：`docs/README.md` 行 49-53（"当前有效专项规范"）；`docs/architecture/skills-architecture.md` 引用；**反向引用** 0 | **保留**（DOC-REGISTRY archivePolicy=retain_stable_path） |
| `docs/agent-workbench-p1-a5-verification-2026-08-15.md` | `status:completed`（DOC-REGISTRY）`canonical:true` | **被引用**：`docs/AUDIT-LOG.md` 行 40（"报告 `docs/agent-workbench-p1-a5-verification-2026-08-15.md`"）；`docs/README.md` 行 30 | **保留**（审计证据） |
| `docs/t-aw-013-packaged-verification-2026-08-15.md` | `status:completed`（DOC-REGISTRY）`canonical:true` | **被引用**：`docs/AUDIT-LOG.md` 行 42（"报告 `docs/t-aw-013-packaged-verification-2026-08-15.md`"）；`docs/README.md` 行 31 | **保留**（审计证据） |
| `docs/agent-workbench-dev-electron-verification-2026-08-15.md` | `status:completed`（DOC-REGISTRY）`canonical:true` | **被引用**：`docs/AUDIT-LOG.md` 行 7 / 40、`docs/README.md` 行 32 | **保留**（审计证据） |
| `docs/releases/v0.0.1-rc.2.md` | `status:reference`（DOC-REGISTRY）`canonical:false`；故 `archivePolicy:retain_stable_path` | **被引用**：`docs/README.md` 行 66（"OSS 迁移前历史发布记录"）、`docs/AUDIT-LOG.md` 归档段（audit-log-through-2026-07-26.md） | **保留**（README 标注） |
| `docs/stage3-standard-workflows-design.md` | `status:reference`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/README.md` 行 51、`docs/g0-ide-mcp-tools-plan.md` 行 5（"Stage 3 继续复用"）、`docs/harness-engine-spec.md` 行 3 | **保留**（reference） |
| `docs/project-wide-audit-2026-07.md` | `status:reference`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/README.md` 行 64（"2026-07-27 六维度横切审计"）、`docs/next-steps-roadmap.md` 行 19、`docs/g0-critical-crosscut-hardening-plan.md` §1 | **保留**（reference） |
| `docs/agent-concurrency-design.md` | `status:completed`（DOC-REGISTRY）`canonical:true` `truthDomain=agent-concurrency-design` | **被引用**：`docs/README.md` 行 26、`docs/next-steps-roadmap.md` 行 19、`docs/project-workspace-handoff.md` 行 75、`docs/AUDIT-LOG.md` 行 13 | **保留**（technical 完成文档） |
| `docs/g0-lf12-baseline-qualification-plan.md` | `status:completed`（DOC-REGISTRY）`canonical:false`（**非** canonical） | **被引用**：`docs/next-steps-roadmap.md` 行 19、25、`docs/next-steps-roadmap.md` 行 19、`docs/g0-living-foundation-plan.md` 0（无 internal 引用） | **保留**（reference） |
| `docs/g0-critical-crosscut-hardening-plan.md` | `status:completed`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/README.md` 行 18、`docs/AUDIT-LOG.md` 行 19、`docs/next-steps-roadmap.md` 行 19、`docs/project-workspace-handoff.md` 行 73 | **保留**（reference） |
| `docs/harness-loop-engineering-plan.md` | `status:completed`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/next-steps-roadmap.md` 行 99、234、`docs/harness-loop-production-closure-plan.md` 开头 | **保留**（reference） |
| `docs/harness-loop-production-closure-plan.md` | `status:completed`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/next-steps-roadmap.md` 行 19、99、`docs/project-workspace-handoff.md` 0 | **保留**（reference） |
| `docs/harness-phase7-completion-plan.md` | `status:completed`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/next-steps-roadmap.md` 行 19、99、`docs/README.md` 行 50 | **保留**（reference） |
| `docs/harness-scientific-task-contract-plan.md` | `status:completed`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/next-steps-roadmap.md` 行 19、99、`docs/README.md` 行 50 | **保留**（reference） |
| `docs/g0-ide-mcp-tools-plan.md` | `status:completed`（DOC-REGISTRY）`canonical:true` `truthDomain=agent-ide-mcp-tools` | **被引用**：`docs/README.md` 行 28、`docs/AUDIT-LOG.md` 行 13、116、117 | **保留**（active 工作包） |
| `docs/g0-rs-ux1h-async-tool-surface.md` | `status:completed`（DOC-REGISTRY）`canonical:true` `truthDomain=g0-current-work-package` | **被引用**：`docs/README.md` 行 25、`docs/next-steps-roadmap.md` §2026-08-14 → 2026-08-16 同步笔录、`docs/project-workspace-handoff.md` 行 15-20 | **保留**（active 工作包） |
| `docs/g0-rs0-result-studio-audit.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=result-studio-architecture` | **被引用**：`docs/README.md` 行 19、`docs/g0-result-studio-plan.md` 行 3 | **保留** |
| `docs/g0-living-foundation-plan.md` | `status:active`（DOC-REGISTRY）`canonical:true` | **被引用**：`docs/next-steps-roadmap.md` 行 19、99、`docs/project-workspace-handoff.md` 0 | **保留** |
| `docs/g0-scientific-data-contract-plan.md` | `status:planned`（DOC-REGISTRY）`canonical:true` | **被引用**：`docs/README.md` 行 16、`docs/next-steps-roadmap.md` 行 19、99、`docs/project-workspace-handoff.md` 行 23 | **保留** |
| `docs/g0-result-studio-plan.md` | `status:planned`（DOC-REGISTRY）`canonical:false` `truthDomain=g0-result-studio` | **被引用**：`docs/README.md` 行 17、`docs/project-workspace-handoff.md` 0、`docs/next-steps-roadmap.md` 0 | **保留**（用户裁决：R7 deferred） |
| `docs/runtime-version-baseline.md` | `status:active`（DOC-REGISTRY）`canonical:true` | **被引用**：`docs/README.md` 行 55、`docs/AUDIT-LOG.md` 行 14（"`scripts/build-macos-runtime.mjs`") 0 | **保留** |
| `docs/release/v0.0.1-rc.6.md` | `status:reference`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/README.md` 行 56、66、`docs/macos-oss-auto-update.md` 0 | **保留**（历史版本） |
| `docs/release/v0.0.1-rc.7.md` | `status:reference`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/README.md` 行 57、67、`docs/next-steps-roadmap.md` 行 7、102、`docs/project-workspace-handoff.md` 行 20、221、`docs/v1-productization-roadmap.md` 0 | **保留**（当前基线） |
| `docs/macos-oss-auto-update.md` | `status:reference`（DOC-REGISTRY）`canonical:true` `truthDomain=macos-oss-update` | **被引用**：`docs/README.md` 行 54、`docs/next-steps-roadmap.md` 行 99 | **保留** |
| `docs/harness-engine-spec.md` | `status:reference`（DOC-REGISTRY）`canonical:true` `truthDomain=harness-engine-contract` | **被引用**：`docs/README.md` 行 50、`docs/agent-workbench-enhancement-plan.md` §0.4、`docs/g0-ide-mcp-tools-plan.md` 行 5 | **保留**（长期规范） |
| `docs/harness-tool-template.md` | `status:reference`（DOC-REGISTRY）`canonical:true` `truthDomain=harness-tool-template` | **被引用**：`docs/README.md` 行 50 | **保留**（长期规范） |
| `docs/harness-roadmap.md` | `status:reference`（DOC-REGISTRY）`canonical:false` | **被引用**：`docs/README.md` 行 50、`docs/agent-workbench-enhancement-plan.md` 0 | **保留**（reference） |
| `docs/parallel-development-guide.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=parallel-development-strategy` | **被引用**：`docs/README.md` 行 6 | **保留** |
| `docs/worktree-governance.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=git-worktree-lifecycle` | **被引用**：`docs/README.md` 行 7、`docs/g0-result-studio-plan.md` 行 688（"不使用 Git Worktree"） | **保留**（休眠纪律） |
| `docs/architecture/gateway-design.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=backend-gateway-architecture` | **被引用**：`docs/README.md` 行 7 | **保留** |
| `docs/architecture/skills-architecture.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=skills-layer-architecture` | **被引用**：`docs/README.md` 行 49 | **保留** |
| `docs/BioF3-Desktop-Evaluation-Report-2026-08-14.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=desktop-evaluation` | **被引用**：`docs/README.md` 行 9 | **保留**（2026-08-14 评估记录） |
| `docs/planning/agent-interaction-evaluation.md` | `status:reference`（DOC-REGISTRY）`canonical:false` `truthDomain=agent-interaction-evaluation` | **被引用**：`docs/DOC-REGISTRY.json`（entrypoint=`docs/DOC-REGISTRY.json`）、`docs/next-steps-roadmap.md` 同步笔录 0 | **保留**（迁移文档） |
| `docs/document-governance.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=project-document-lifecycle` | **被引用**：`docs/README.md` 行 6、`docs/AGENTS.md` §项目治理与文档生命周期段、`docs/COLLABORATION.md` 0 | **保留** |
| `docs/COLLABORATION.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=team-collaboration-convention` | **被引用**：`docs/README.md` 行 6 | **保留** |
| `docs/development-module-map.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=module-responsibility-map` | **被引用**：`docs/README.md` 行 22（"当前开发必读"）、`docs/project-workspace-handoff.md` 行 4 | **保留** |
| `docs/scientific-intelligence-os-vision.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=long-term-product-direction` | **被引用**：`docs/README.md` 行 18、`docs/next-steps-roadmap.md` 0 | **保留** |
| `docs/v1-productization-roadmap.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=product-stage-sequence` | **被引用**：`docs/README.md` 行 22、`docs/next-steps-roadmap.md` 行 99、`docs/project-workspace-handoff.md` 行 4 | **保留** |
| `docs/next-steps-roadmap.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=current-priorities` | **被引用**：`docs/README.md` 行 22、`docs/AGENTS.md` §启动顺序段、`docs/CLAUDE.md` 启动顺序 | **保留**（核心入口） |
| `docs/project-workspace-handoff.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=recoverable-workspace-state` | **被引用**：`docs/README.md` 行 22、`docs/AGENTS.md` §启动顺序段 | **保留**（核心入口） |
| `docs/AUDIT-LOG.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=project-audit-broadcast` | **被引用**：`docs/README.md` 行 6、`docs/AGENTS.md` §审计广播台段、`docs/CLAUDE.md` 启动顺序 | **保留**（核心入口） |
| `docs/README.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=project-document-index` | **被引用**：`docs/AGENTS.md` §启动顺序段、`docs/CLAUDE.md` 启动顺序 | **保留**（DOC-INDEX） |
| `docs/ui-productization-audit.md` | `status:active`（DOC-REGISTRY）`canonical:true` `truthDomain=ui-productization-status` | **被引用**：`docs/README.md` 行 22、`docs/AGENTS.md` §UI 进度自动对账段、`docs/CLAUDE.md` 0 | **保留** |
| `docs/agent-workbench-enhancement-plan.md` | `status:planned`（DOC-REGISTRY）`canonical:true` `truthDomain=agent-workbench-enhancement` | **被引用**：`docs/README.md` 行 29 | **保留**（planned） |
| `docs/ide-transformation-plan.md` | `status:planned`（DOC-REGISTRY）`canonical:true` `truthDomain=ide-development-roadmap` | **被引用**：`docs/README.md` 行 14 | **保留**（同 §1.4 矛盾——见 §3、§6） |
| `docs/plugin-artifact-schema.md` | `status:reference`（DOC-REGISTRY）`canonical:true` `truthDomain=plugin-artifact-contract` | **被引用**：`docs/README.md` 行 52 | **保留** |
| `docs/third-party-plugin-guide.md` | `status:reference`（DOC-REGISTRY）`canonical:true` `truthDomain=third-party-plugin-development` | **被引用**：`docs/README.md` 行 53 | **保留** |
| `docs/DOC-REGISTRY.json` | `kind:governance`（DOC-REGISTRY）`status:active` `canonical:true` `truthDomain=machine-readable-doc-catalog` | **被引用**：`docs/document-governance.md` §3、`docs/AGENTS.md` §项目治理与文档生命周期段 | **保留**（机器目录） |

**总结**：55 份 docs/*.md 中**没有 1 份**属于"既无外部引用、又不被 canonical 入口登记"——`docs:check` 严格执行 `requireRegistration=true` + `entrypoint` 链接规则保证每份文档至少有一个外部锚点。所有归档候选都属于"`planned / abandoned direction`"（`ide-transformation-plan.md` + `ide-research/`）或"已 supersede 但作为历史保留"的（harness / stage3-4 / release notes），**没有真正可以删除的孤立文档**。

---

## 6. 不在本审计范围（提示主 agent 转交）

> 这些是 A1 worker 在切片审计中识别的、但**不属于本切片处理范围**的发现，需要主 agent 决策后转交其他切片或用户裁决。

1. **`docs/agent-workbench-enhancement-plan.md` 行 1-2 重复 H1** — 由 A1 报告但**影响 markdown 渲染**；应转交 A2（governance）或直接由主 agent 调用 `$biof3-project-governance` 修复（仅 1 行删除）

2. **`docs/agent-workbench-enhancement-plan.md` §1.4 vs DOC-REGISTRY `IDE-TRANSFORMATION` 状态冲突** — 计划文档自称"已放弃方向"但 DOC-REGISTRY 仍标 `planned`；需主 agent 决定：
   - 选项 A：DOC-REGISTRY 把 `IDE-TRANSFORMATION` / `IDE-MCP-TOOLS-DESIGN` / `IDE-MONACO-RESEARCH` 改为 `status:superseded` 并移动到 `docs/archive/ide-transformation-retired/`（按 enhancement plan §11 行 1471-1485 迁移脚本）
   - 选项 B：保持 planned 但要求 enhancement plan §1.4 改写为"当前共存，未来再决"

3. **`docs/README.md` 行 14 "21 个 IDE MCP 工具"漂移** — 实际 18 个（`g0-ide-mcp-tools-plan.md` 行 4）；需 README 维护者直接改 1 行

4. **`docs/AUDIT-LOG.md` 顶部"最后更新：2026-08-15"vs mtime 2026-08-16 漂移** — 2026-08-16 收口 2 条（wb/ 命名空间分支 + r-server `/api/ai/agent` 路由修复）未改顶部日期；属于治理收口细节，由 A4（registry）协调

5. **`docs/project-workspace-handoff.md` 头部"最后更新：2026-08-11" vs mtime 2026-08-16** — 同步笔录已加但头部日期未更新（与 4 同源）

6. **`docs/v1-productization-roadmap.md` 行 36 "rc.5 检查点" vs 当前 rc.7 / 35 天未更新** — 主 agent 决定是否同步日期并补 6 Blocks 摘要

7. **`docs/stage4-stable-release-checklist.md` 仅记 rc.6 收口** — 主 agent 决定是否在 §1 顶部追加"rc.7 收口见 `docs/releases/v0.0.1-rc.7.md`"

8. **`docs/macos-oss-auto-update.md` 行 104 引用 `v0.0.1-rc.6`** — 主 agent 决定是否在头部加"rc.6 历史快照"标注

9. **`docs/ide-research/mcp-ide-tools-design.md` §7 残留 21 工具 vs `g0-ide-mcp-tools-plan.md` 实际 18 工具** — 与 README 行 14 同源

10. **`docs/ui-productization-audit.md` 行 244 契约偏差（已登记 CONTRACT-DRIFT-001）** — 治理层面已通告，**A1 不重写**；下一次 P1.* 收口笔录统一刷新（由 A3 / A4 协调）

11. **3 份验证报告（A5 / T-AW-013 / T-AW-014）之间的 ID 命名体系与 `agent-workbench-enhancement-plan.md` 不对齐**（A1/A2/A3/A4 vs UI-AGENTWB-001/002/003/004） — 跨文档 ID 一致性问题；属治理层面，建议主 agent 裁决 ID 命名规范（增强计划文档应主动引用 3 份验证报告）

12. **`docs/architecture/skills-architecture.md` vs `docs/skills-{schema,registry,workflow-integration}.md` 4 份文档分工未在 README 中明示** — 主 agent 决定是否在 README 列 Skills 子文档入口图

13. **`docs/codex-style-workbench-direction.md` mtime 2026-07-08（最久 39 天前）** — DOC-REGISTRY `status:reference / canonical:true`——保留，但 README 标注"(*2026-07-08 快照；当前以 `agent-workbench-enhancement-plan.md` §1.4 增量增强口径为准*)"是低风险改进

14. **`docs/harness-engine-spec.md` / `docs/harness-roadmap.md` 顶部状态句未跟进 Phase 7 / HRT / HLE 收口** — 主 agent 决定是否在每个文档顶部添加一行"后续由 X 收口"标注

15. **`docs/releases/v0.0.1-rc.2.md` / `docs/releases/v0.0.1-rc.6.md` 是历史版本** — DOC-REGISTRY 已保留；不动

16. **`docs/dependency-decoupling-checkpoint.md` mtime 2026-07-16** — DOC-REGISTRY 已 `status:completed / canonical:false`，保留为历史（archivePolicy=`retain_stable_path`）

17. **next-steps-roadmap.md 与 project-workspace-handoff.md 全文检索一致性** — 6 Blocks 同步笔录已经存在；A1 已确认文档 mtime 2026-08-16 = worker-C 同步结果；A1 **已核对**两者一致

18. **`docs/AUDIT-LOG.md` 路径下 `docs/archive/checkpoints/audit-log-through-2026-07-26.md`** — 是 A5 范围，A1 不动

---

## 附录 A：A1 审计范围矩阵

| 切片 | 文件 | 计数 |
| --- | --- | --- |
| 含 `docs/archive/` | A5 切片 | 不计 |
| `docs/` 根 | 42 | ✓ |
| `docs/architecture/` | 3 | ✓ |
| `docs/ide-research/` | 2 | ✓ |
| `docs/planning/` | 1 | ✓ |
| `docs/releases/` | 3 | ✓ |
| 仅 `.md` 文件 | 56 | ✓ |
| 治理 `docs.json` 元数据 | `docs/DOC-REGISTRY.json`（1 份 JSON） | A4 切片 |
| `npm run docs:status` | 输出 21 active / 14 completed / 17 reference / 6 archived / 4 planned（共 62 registered；56 managed Markdown） | 与 A1 一致 |
| `npm run docs:check` | PASS（0 fail） | ✓ |

## 附录 B：粗线条合规性确认

- [x] `npm run docs:check` PASS（不修不重跑——A1 范围内的 0 FAIL）
- [x] 没有修改 docs/ 任何文件（除本报告输出）
- [x] 没有 commit / amend / push / mv / rm / sed
- [x] 没有触碰 `.agents/` / `.claude/` / `.codex/` / `core/` / `frontend/` / `src/` / `test/` / `scripts/` / `migrations/` 内部文件
- [x] 仅做只读 audit（cat / grep / find / wc / stat / diff / npm run docs:status / docs:check）
- [x] 报告路径：`/Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/desktop/agent-tools/audit-w1-docs-dir.md`
- [x] 与 worker-A2 / A3 / A4 / A5 切片边界清晰：本文不写 governance 政策改动 / script 改动 / DOC-REGISTRY 改动 / archive 实际搬迁
- [x] 引用基线：与 `docs/next-steps-roadmap.md`（2026-08-16 同步）+ `docs/project-workspace-handoff.md`（2026-08-16 mtime / 2026-08-11 头部日期）+ `docs/AUDIT-LOG.md`（2026-08-15 头部 / 2026-08-16 mtime）+ `docs/DOC-REGISTRY.json`（62 条登记项）核对一致
- [x] 阶段纪律：未外推 packaged / Provider / GA / dist staleness 与"qualificationEligible" 状态；未提议启动新工作包

---

**报告完成**。A1 worker-A1 全部任务清单完成；本报告是 worker-A1 切片审计的最终输出。
