# 审计广播台历史归档 · through 2026-10-20

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-20（**W8 收尾第二轮（BLOCK-211 第八批）：领域包到位复看 → C-33 销号；W8 自决项全部完成**）：兄弟仓 `petri-pack-bio` 检出 ⇒ `npm run skills:check` **14/14 PASS**（此前 5 红消失）、后端以 `PETRI_PLUGINS_DIR=<pack>/plugins` 启动后 `GET /api/tools/catalog` **count=7**、`preflight` 三态如实（deg=available；sc/go=missing_deps 且缺失清单逐项可读）；`PETRI_PACK_DIRS` 补 **5/5** 契约测（此前零断言）；UI-527 pack-present 复探 **2/2**（三卡真实三态）。**UI-526 根因更正**：pack 已到位但 `r.installed=false`（R 运行时未安装，Python 可用）⇒ 仍无产物 ⇒ 保持 `in_progress`。W8 仍非工程可自决=双机 riders/BK-08（deferred）与 i18n（D-04 deferred）⇒ **不宣称阶段 4 出口完全达成**。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-20T16:46:40.762Z -->
最后更新：2026-10-20（**BLOCK-214 Q-DOMAIN P1 completed（closeout 十三门 PASS）：生信 Skills 去核**）：3 个生信 skill 从核心迁入 `petri-pack-bio/skills`；核心 built-in 11；pack `provides.skills`；skill-registry `loadPackSkills()`（source=pack，内置>pack>已安装，卸载/停用清理）；`skills:check` 11+3 PASS；`block214-pack-skills` 5/5 + 邻域 32/32 + 产品路径 14/11 + 9223 双态 4/4·2/2；UI-529 verified（dev Electron 边界内）。knip 新 flow 按动态入口定性后 245 键。P2/P2b/P4 仍 planned。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-20T17:23:09.713Z -->
最后更新：2026-10-20（**BLOCK-215 Q-DOMAIN P2a completed（closeout 十三门 PASS）：核心 Prompt 去生信化**）：核心 `agent-runner.js`/`system-prompt.js` 移除 DESeq2/Seurat/单细胞/FigCode 生信示例/结果页单细胞控制；新增 `pack-prompt-fragments`，只从已安装/启用 pack 的 `promptFragments/` 注入，pack 缺失/停用零注入；block215 3/3、prompt 邻域 52/52、domain-neutrality 改善 13 处后下调基线、golden context_snapshot 显式重打 `dfc9be7b…→6f891fe…` 且复跑一致、evals:gate smoke 回归 0。P2-UI/P2b/P4 仍 planned。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T00:06:51.206Z -->
最后更新：2026-10-20（**BLOCK-216 Q5 统一工作面 host completed（closeout 十三门 + 9223 live 19/19）**）：core+pack surface 注册表/稳定 tab 状态机/pack views·resultSurfaces·uiActions 贡献投影 + `petri-pack://` 独立 origin/生成文件·计划·证据面 + 文件管理器显示 IPC；block216 7/7 + 前端 Q5 46 项 + test:changed 266/266；实机抓真两处（多 tab 只显示×、OOPIF/文件空态 visibility 泄漏）已修。边界=终端分屏 E9 deferred、P2-UI/P2b 未做、E1/E4/H3/H4/B3 部分。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T00:53:02.691Z -->
最后更新：2026-10-20（**BLOCK-217 Q-DOMAIN P2-UI completed（closeout 十三门 + 9223 live 8/8）**）：核心 act 去生信/FigCode（只保留 rename_project/dataset/analysis、update_analysis_params、open_tool、ui_action）；pack `uiActions` 动态描述 + 执行校验 + 前端 host 分发/ack；删除 sc*/figcode 遗留字段；domain-neutrality 下调 15 处。block217 9/9 + block151 5/5 + 前端 8/8 + test:changed 213/213 + 9223 live 8/8；UI-531 verified（dev Electron 边界内）。边界=真实生信动作随 P2b pack 结果面提供；live ack 用合成 token（ack 成功链由隔离测试覆盖）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T01:24:12.723Z -->
最后更新：2026-10-20（**BLOCK-218 Q-DOMAIN P2b 垂直切片 completed（closeout 十三门 PASS；真实 job live rider）**）：result mode 主 body 由 pack `resultSurfaces` iframe 渲染（图/表/文本/report 源码 + truth/revision），核心保留 context bar/composer 与 code/compare/history 过渡面；只读有界数据桥（4MB 图/2MB 文本/200×50 行）；pack 缺失/不匹配 core-transitional。packResultData 5/5 + resultSurfaceHost 5/5 + CenterPanel 2/2 + pack 页面契约 2/2 + test:changed 191/191 前端；UI-532 in_progress（dev DB tool_jobs=0，无真实结果 job 实机腿）。边界=高级 tab 仍核心过渡。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T02:05:13.912Z -->
最后更新：2026-10-20（**BLOCK-219 Q6 批注 host completed（closeout 十三门 PASS；9223 live 13/13）**）：通用 annotation host——`result_annotations` 旁路元数据（归一化 0..1 坐标/页号/作者/时间/评论；单 scope ≤200 条；项目隔离）+ PDF 页定位盒与图像批注层 + 「加入任务」经 `petri:copilot-ask` 单一通道；批注不写原始产物（实机哈希前后一致）。证据=`block219-result-annotations` 12/12 + 前端 42/42 + test:changed Node 744 项 0 红/前端 30 文件全绿 + `acceptance/block-219/`（13/13）；UI-533 verified（dev Electron 边界内）。边界=六种图形工具/文本批注与速记板/Office/pack iframe 面批注 reopen。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T02:51:56.288Z -->
最后更新：2026-10-20（**BLOCK-220 Q-DOMAIN P3 垂直切片 completed**）：删除化石 `core/shared-backend/tool-registry.js`（458 行/10 个内联生信工具/零消费；单一注册源=pack `registry/tool-registry.json` 驱动的 `petri-server/tool-registry.js`）+ pack 新契约 `provides.methods`（`citations`/`toolLabels` 纯数据，pack 0.1.1→0.2.0）+ `pack-methods.js` 只读有界装载器 + `methods-export.js` 接线与诚实降级（无 pack 无引文）。证据=block220 13/13 + 真实 pack 根集成 13 类型/13 标签/0 warning + 域中性基线 261→208 处（`tool-registry.js` 归零）+ test:changed Node 315 项 0 红。reopen=`_pythonEquivalent` 脚本模板/`artifact-profiles`/`agent-workflow`/`learning`/`result-*-tools`。plan=docs/block-220-qdomain-p3-methods-plan.md §8。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T03:28:05.965Z -->
最后更新：2026-10-20（**BLOCK-221 Q8 垂直切片 completed**）：MCP 服务级治理——①**修真实缺陷**：`GET /api/mcp/servers` 曾把解密后的 env 明文（第三方 token）下发渲染进程，现只回 `envKeys`/`envCount`；②服务级策略 store `mcp-server-policy.json`（`{trust, allow, block}`，读侧 fail-closed、写侧 404/400 + diagnostics）；③投影求值 block 优先 → allow 白名单 → 默认全允许；④`GET/PUT /api/mcp/servers/:id/policy` + 清单 `policy` 摘要。证据=block221 9/9 + MCP 邻域 40/40 + 前端 extensions/hooks 145 项全绿。reopen=trust 降档接审批（随 Q1）/OAuth/懒加载/深链安装/四 hint/货架 UI 操作面。plan=docs/block-221-q8-mcp-governance-plan.md §5。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T03:50:47.777Z -->
最后更新：2026-10-20（**BLOCK-222 Q9 垂直切片 completed**）：错误兜底粒度从「整页」降到「一段 UI」——新增 `SegmentBoundary`（`data-segment` 标注、`resetKey` 变化自动恢复、重试、复制诊断含失败态、上报器抛错不反噬），挂载结果面预览段与工作区文件预览段；插件产出的异形数据崩预览时，结论区/truth 面/上下文条仍可用。证据=SegmentBoundary 5/5 + 邻域前端 24 文件 170 项全绿 + theme 17/17 + types 0。reopen=轮次/工具卡/应用级边界、错误落盘、通知/托盘/退出摘要/模型选择器/电脑控制。plan=docs/block-222-q9-segment-boundary-plan.md §5。G0 开发期常态 · 不外推 packaged/Provider/GA。
