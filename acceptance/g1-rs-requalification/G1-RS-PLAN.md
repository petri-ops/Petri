# G1 首包 · Result Studio 重资格差距补齐 —— 立项方案（2026-11-25）

> 发令：Orca bb8dddaf dispatch msg_a345c2faa02e + 阶段二收口确认 msg_a3a9e840d4c1（owner「按已批计划推进」+「G1 首包按串行开工」）。
> 性质：G1 首包立项方案（BLOCK form, L）——**本件只立案/拆波次，不宣称任何资格**。按 `petri-project-governance` 的启动检查单与「patch vs refactor」纪律编写。
> 硬纪律：`qualificationEligible:false` 是 G0 常态非缺陷；本方案**不翻资格、不冒充 RS9/P4R/P6 历史证据为资格证据**；任何 `verified/qualified` 须 P7 唯一裁决。G1 已由 owner 显式裁决进入首包（非 Agent 主动提 G1+）。

## §1 核码真源（C-32/C-43 先核真源）

- G1-READINESS §一.1 五项差距 + §一.3 序列 4「RS 重资格 P0–P4 差距补齐（G1 首包）」，体量 L。
- g0-result-studio-plan §P7 重开条件（line1826-1830，原文引用）：①五个独立 primary operation + task-bound replay + 真实截图/重算不变量；②**selection→enrichment、manual→Agent heatmap、affected-subgraph lifecycle、historical alternative 成真实产品契约**；③双真实 Provider + packaged macOS arm64 + 六格 + literal OS reboot 连续验收窗口。**注（owner 裁决「b heatmap 跟包走」）**：本包执行时 heatmap 已从内核 G1 矩阵移除、归 bio 包激活验收；此处保留 g0-plan 原文引用仅为可追溯，不描述本包现行任务归属。
- P7 延期根因（line1824）真源：`result_enrichment_from_context` 真跑 GO/KEGG 后**自动采用 parentless baseline**，P7 要求每条任务 candidate → compare → adopt/revert → replay；既有 family/parent/adopt 不变量禁止在验收层伪造该链。
- 核码（`result-selection-tools.js:303-408`）：`tool_result_enrichment_from_revision` 走 `runTool` 真跑 + 写 lineage/workflowGraph，但**返回 executed 直接落 current，无 candidate cohort**（grep `derived-result|candidate.*cohort|parentless.*baseline` 零命中）。
- 四项卡外部真值/成本：双 Provider 真实调用（需真实 API Key/模型）、packaged 六格 + literal OS reboot（需签名/公证/真机）、Git consent UI（后端已有 opt-in，前端 trace 需评估）、历史证据不冒充（纪律项非实现项）。

## §2 波次拆分（立项检查单）

| 波次 | 范围 | 性质 | 本机可验证 | 外部依赖 |
|---|---|---|---|---|
| **W1（本包首个可开工）** | selection→enrichment **derived-result candidate cohort**：enrichment 真跑后登记为**非 current 候选**（candidate），提供 compare → adopt/revert → replay 产品链（单一 ChangeSet/Revision Truth，不新增第二套 enrichment 工具、不放宽 cohort 安全门） | **产品语义 refactor** | ✅ HK-01 纯函数/状态机 + fixture 集成 + dev Electron 边界内 trace | 无（不跑真实 Provider） |
| W2 | affected-subgraph lifecycle 同构为真实契约（**heatmap 按 owner 裁决「跟包走」已从内核 G1 移除**——证据归 bio 领域包 `petri-pack-bio` 激活验收，非内核 G1 要求） | 产品语义 refactor | ✅（affected-subgraph） | 无（heatmap 归 bio 包计划，不在本包） |
| W3 | Git consent UI（五条独立 task trace）+ historical alternative 产品契约 | 前端 + trace | ✅ 前端可测 | 真实 Git 仓库样本（本机可造） |
| W4 | 双 Provider 矩阵真实 tool calling（≥1 OpenAI-compatible） | 资格证据 | 部分 | **真实 Provider Key/模型（外部）** |
| W5 | packaged macOS arm64 六格 + literal OS reboot + 发布流水 | 资格证据 | 否 | **签名/公证/证书/真机（外部）** |
| 纪律 | 历史 RS9/P4R/P6 证据继续作 G0 开发态证据，**不冒充 G1 资格证据** | 纪律 | ✅ | 无 |

- **heatmap 归属裁决（owner 原话「b heatmap 跟包走」）**：heatmap 子项**从 G1 内核资格矩阵移除**，不再写「等兄弟仓激活另立子包」（那把决定权留在错误的地方）。新归属=**heatmap 证据归 bio 领域包 `petri-pack-bio` 自己激活时的验收**，非内核 G1 要求；依据=领域包架构原则（领域能力是放大器不是身份）+ 历史 P4R-5 已 4/4 验过该链（不冒充资格、不阻塞内核 G1）。本包**不激活兄弟仓、不动 petri-pack-bio**，那边何时做 heatmap 验收归包自己的计划。
- W4/W5 按发令「packaged/证书相关子项若卡外部真值，如实挂账不硬凑」——**挂账不启动**，待外部到位再说。
- 波次串行：W1 收口后开 W2，不并行。

## §3 波次1 的语义裁决点（需 owner 拍板）

governance「patch vs refactor」判定：candidate cohort 是**既有 concept 的第二 variant**（当前 executed 直接落 current → 新增 candidate 态与 adopt/revert 门），属 refactor 信号；且改变产品行为（enrichment 后不再自动 current，需用户采纳）。

按 owner 偏好「非判据决策点给一个最合理建议+一句理由，只回行/不行」：

- **最合理建议**：W1 在单一 ChangeSet/Revision Truth 内实现 derived-result candidate cohort，enrichment 产物登记为非 current 候选（保留自动 baseline 的既有 dev 行为为显式 `legacyAutoAdopt` 开关，默认**关**——新语义默认需 adopt）。理由=P7 重开条件§2 要求真产品契约，且「不新增第二套工具/不放宽安全门」已限定唯一形态；默认关是新语义，仅显式开关保留旧 dev 行为，避免悄悄改变现有测试预期。
- 若 owner 回「不行」并选「默认保持自动 current、仅追加 candidate 旁路」，则与 P7 条件§2 冲突，须在 canonical plan 记明资格缺口继续挂账。

**请 owner 只回：行 / 不行。** 拿「行」后按 HK-01 红绿先行实现 W1；本件先立案不实现。

## §4 边界

- 不改 `qualificationEligible`、不升 result-studio-editing 支持声明、不写「maintain false」类套话（G0 开发期常态 · 不外推 packaged/Provider/GA）。
- 不碰 19 项 WIP/frogfish；owner dev 实例 3000/3001/9222 零触碰；观感零代签。
- W1 实现时逐包回报（包号/提交/门禁/HMR），push 等放行。
