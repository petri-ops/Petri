# 审计广播台历史归档 · through 2026-10-20

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-20（**W8 收尾第二轮（BLOCK-211 第八批）：领域包到位复看 → C-33 销号；W8 自决项全部完成**）：兄弟仓 `petri-pack-bio` 检出 ⇒ `npm run skills:check` **14/14 PASS**（此前 5 红消失）、后端以 `PETRI_PLUGINS_DIR=<pack>/plugins` 启动后 `GET /api/tools/catalog` **count=7**、`preflight` 三态如实（deg=available；sc/go=missing_deps 且缺失清单逐项可读）；`PETRI_PACK_DIRS` 补 **5/5** 契约测（此前零断言）；UI-527 pack-present 复探 **2/2**（三卡真实三态）。**UI-526 根因更正**：pack 已到位但 `r.installed=false`（R 运行时未安装，Python 可用）⇒ 仍无产物 ⇒ 保持 `in_progress`。W8 仍非工程可自决=双机 riders/BK-08（deferred）与 i18n（D-04 deferred）⇒ **不宣称阶段 4 出口完全达成**。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-20T16:46:40.762Z -->
最后更新：2026-10-20（**BLOCK-214 Q-DOMAIN P1 completed（closeout 十三门 PASS）：生信 Skills 去核**）：3 个生信 skill 从核心迁入 `petri-pack-bio/skills`；核心 built-in 11；pack `provides.skills`；skill-registry `loadPackSkills()`（source=pack，内置>pack>已安装，卸载/停用清理）；`skills:check` 11+3 PASS；`block214-pack-skills` 5/5 + 邻域 32/32 + 产品路径 14/11 + 9223 双态 4/4·2/2；UI-529 verified（dev Electron 边界内）。knip 新 flow 按动态入口定性后 245 键。P2/P2b/P4 仍 planned。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-20T17:23:09.713Z -->
最后更新：2026-10-20（**BLOCK-215 Q-DOMAIN P2a completed（closeout 十三门 PASS）：核心 Prompt 去生信化**）：核心 `agent-runner.js`/`system-prompt.js` 移除 DESeq2/Seurat/单细胞/FigCode 生信示例/结果页单细胞控制；新增 `pack-prompt-fragments`，只从已安装/启用 pack 的 `promptFragments/` 注入，pack 缺失/停用零注入；block215 3/3、prompt 邻域 52/52、domain-neutrality 改善 13 处后下调基线、golden context_snapshot 显式重打 `dfc9be7b…→6f891fe…` 且复跑一致、evals:gate smoke 回归 0。P2-UI/P2b/P4 仍 planned。G0 开发期常态 · 不外推 packaged/Provider/GA。
