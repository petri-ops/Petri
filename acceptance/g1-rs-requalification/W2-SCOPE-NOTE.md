# G1 首包 W2 · heatmap + affected-subgraph 核码与范围说明（2026-11-25）

> 发令：Orca msg_d454636afdef（W1 本体完成成立，按序开 W2）。
> 本件=核码结论 + 范围边界，**不改产品代码、不声称 W2 完成**。

## §1 核码真源

| 子项 | 现状 | 位置 |
|---|---|---|
| manual→Agent heatmap | `heatmap_manual_then_ai_edit` 是 P7 五个 REQUIRED_TASKS 之一（`core/shared-backend/result-studio-qualification.js:12`）；历史 P5 证据（`rs-p5-scientific-editing.json`）引用的 `resources/built-in-plugins/gene-correlation/` **本仓已不存在**（find 零命中，BLOCK-83 迁包删除） | 插件实际在**兄弟仓** `../petri-pack-bio/plugins.dormant/gene-correlation`（休眠态）与 `../BioF3-workspace/gewu-pack-bio/plugins.dormant/gene-correlation` |
| affected-subgraph lifecycle | 已有真实规划：`core/shared-backend/result-edit-intent.js:240,336` 基于 workflow DAG BFS 算 `affectedNodeIds`/`affectedScope='workflow_subgraph'`，fail-closed（缺 DAG 报 `workflow_dag_missing`）；`result-changeset-service/{projections,materialize}.js`、`result-replay-service/cohort-package.js` 消费 | **本仓代码**，可本机推进 |
| historical alternative compare | REQUIRED_TASKS 第五项，`result-studio-repository.js` 有 restore/replay 门 | 本仓代码 |

## §2 范围边界与需 owner 裁决的点

- **affected-subgraph lifecycle**：本仓已有实现，W2 本机可做的是「把它从内部 helper 提升为可观测产品契约」（HK-01 纯函数/状态机 + fixture 集成 + dev Electron trace），属 patch/轻 refactor，可在包内推进。
- **heatmap manual→Agent**：插件在**兄弟仓休眠态**，本仓无 heatmap 工具（grep 零命中）。要成真实产品契约须激活/迁移领域包——属**跨仓外部依赖**，按发令「卡外部真值如实挂账不硬凑」+ governance 检查单未勾选项不就绪，**不擅自改兄弟仓**。
- 这是**范围裁决点**（非判据决策点）：请 owner 只回「行/不行」。

**最合理建议（原方案，已被 owner 裁决更新）**：W2 先做本仓可独立验证的 affected-subgraph lifecycle 契约（HK-01 红绿 + 既有门零放宽）；heatmap 子项如实挂账，标注「依赖兄弟仓 petri-pack-bio 的 gene-correlation 从 plugins.dormant 激活，属跨仓外部真值，到位后另立子包」，不伪造本仓已有 heatmap 契约。理由=W2 目的本体之一（affected-subgraph）本机可完成且与 W1 同构，heatmap 跨仓需 owner 授权才能动兄弟仓。

> **owner 裁决更新（2026-11-25 · 原话「b heatmap 跟包走」· 派令 msg_ef23501c425e）**：上述「等兄弟仓激活另立子包」表述**作废**——那把决定权留在了错误的地方。新归属：heatmap 子项**从 G1 内核资格矩阵移除**，heatmap 证据归 **bio 领域包 `petri-pack-bio` 自己激活时的验收**，非内核 G1 要求；依据=领域包架构原则（领域能力是放大器不是身份）+ 历史 P4R-5 已 4/4 验过该链（不冒充资格，也不阻塞内核 G1）。执行边界：**不激活兄弟仓、不动 petri-pack-bio**，何时做 heatmap 验收归包自己的计划。W2 的 affected-subgraph 契约照常成立，heatmap 子项不再是本包「挂账未决」，而是「归包走」的清晰归属。

## §3 边界

- 不改 `qualificationEligible`、不翻资格、历史 P5 证据不冒充 G1 资格（其引用的 gene-correlation 路径已失效，正是诚实边界的实证）。
- 19 WIP/frogfish 零触碰、owner 实例零触碰、观感零代签、push 等放行。
