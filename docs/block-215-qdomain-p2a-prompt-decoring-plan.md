---
capability: qdomain-prompt-decoring
goal: Q-DOMAIN P2a — 核心 prompt 去生信化；领域指令由已安装 pack 的 promptFragments 注入；pack 缺失/停用零注入。
acceptance:
  - 核心 `agent-runner.js` / `system-prompt.js` 不再含生信指令；domain-neutrality baseline 按改善下调。
  - pack 安装时 `promptFragments/` 被渲染并追加；pack 缺失/停用 → 空字符串（零注入）。
  - prompt 邻域测试全绿；golden `context_snapshot` 显式重打并复跑一致；`evals:gate` 回归 0。
  - closeout 十三门 PASS。
reopen: P2-UI actions（需 Q5 host）；P2b Result Surface；P4 data model；剩余域中性残留。
status: completed
---

# BLOCK-215 · Q-DOMAIN P2a：核心 Prompt 去生信化

> 用户裁决：2026-10-20「开 搞完这个 之后进入波次开发」。方向=领域内容只进 pack、核心零领域硬编码。
> 方向母纲：`docs/qoder-essence-absorption-plan.md` §6-Q-DOMAIN（P2 拆为 P2a prompt / P2-UI actions）。

## 1. 范围

- 新增 `core/petri-server/helpers/pack-prompt-fragments.js`：只从**已安装/启用** pack 的 `promptFragments/*.md` 读取并渲染；pack 缺失/停用 → 空；失败 fail-open 为空，不阻断主循环。
- `agent-runner.js`：在 `appendDesktopAgentInstructions` 后追加 pack fragments；删除核心 prompt 中的生信指令（DESeq2/火山图/Seurat/单细胞/工具 ID/FigCode 生信示例/结果页单细胞控制/H5AD/RDS/测序）。
- `system-prompt.js`：去掉 GO/KEGG、GSEA、单细胞旧页面等域词，保留通用纪律。
- `petri-pack-bio/promptFragments/domain-guidance.md`：承接被移除的领域指令；`pack.json provides.promptFragments`。
- 显式重打 `evals/snapshots/golden.json`（prompt 文案变更），并下调 `test/domain-neutrality-baseline.json`。

## 2. 非范围

- **P2-UI actions**（`act` 单细胞动作/标签下沉）需要 Q5 的 UI action host，本轮不做，另立包。
- Result Studio resultSurface（P2b）、methods/learning/legacy registry（P3）、数据模型（P4）不做。
- 不改工具语义、审批链、结果真相；不新增依赖。

## 3. 验收与证据

- `test/block215-pack-prompt-fragments.test.mjs` 3/3（安装→渲染；缺失/停用→空；核心 prompt 无生信短语）。
- prompt 邻域 52/52；`evals:run --suite=golden` 1/1 + context_snapshot 重打后一致；`evals:gate` 回归 0。
- domain-neutrality：改善 13 处后 `--update` 基线，门禁 PASS。
- 证据落 `acceptance/block-215/`；closeout 十三门。

## 4. 风险

- 核心 prompt 变化会影响模型行为与静态前缀；已用 golden snapshot 显式重基准，不宣称“行为不变”。
- pack 未安装时模型失去领域指令（这是设计目标）；pack 安装后由 fragment 恢复。
- prompt fragment 是 pack 信任资产；安装/权限/审计沿用 pack 生命周期。

## 5. 收口（2026-10-20）

- **closeout 十三门 PASS**；`skills:check` 报告级 OK。
- **验证**：block215 **3/3**（安装→渲染 / 缺失/停用零注入 / 核心无生信短语）；prompt 邻域 **52/52**；domain-neutrality **改善 13 处**后 `--update` 基线；golden `context_snapshot` **dfc9be7b986a1c17 → 6f891feccdf76eb1** 显式重打并复跑一致；`evals:run --suite=golden` **1/1 PASS**；`evals:gate` smoke **回归 0**。
- **交付**：`pack-prompt-fragments` + `petri-pack-bio/promptFragments/domain-guidance.md` + `pack.json provides.promptFragments`；核心 prompt 去生信化。
- **遗留**：P2-UI actions（需 Q5 host）、P2b Result Studio resultSurface、P4 data model 仍 planned；剩余域中性残留（methods/act/plan-ui/legacy registry 等）未动。G0 开发期常态 · 不外推 packaged/Provider/GA。
