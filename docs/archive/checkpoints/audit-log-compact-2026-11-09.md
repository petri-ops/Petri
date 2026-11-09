# AUDIT-LOG 自动精简归档 · 2026-11-09（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ BLOCK-325-MODEL-SURFACE-BUDGET（model-surface 尺寸预算门禁，2026-11-01；用户裁决「很棒 继续」） | 2026-11-01 | **completed（当日立项当日收口）**：scripts/model-surface-baseline.mjs（measure/compare/--update 纯函数）+ 基线 test/model-surface-baselines.json（systemPromptChars/toolDefsCount/toolDefsChars/perToolChars）+ 契约测试（预算棘轮：任何增长即红 + 退役词扫描：核心系统提示与工具定义不含 单细胞/scRNA/DESeq2/Seurat/FigCode/空间转录组）；红线=只测核心面不扫 pack 注入内容、不预设阈值（基线=现状首测）、增长必须 --update+commit 说明。非范围=token 级预算（CK-04 SECTION_CHAR_BUDGETS 已有）/前端 bundle（block141 已有）。证据=契约 4/4 + closeout 十一门 PASS；基线首测 systemPrompt=940 chars / toolDefs=104 个 56614 chars。plan=docs/block-325-model-surface-budget-plan.md | BLOCK-325 / P6-CLOSED |

<!-- audit-log-compact.mjs 追加 @ 2026-11-09T11:41:06.728Z -->
| ✅ BLOCK-328-EARLY-LOOP-GUARD（加载期守卫 + initSchema busy 重试，2026-11-02；用户裁决「行呀 开整」） | 2026-11-02 | **completed（当日收口）**：327 修复三选项中②+①落地；守卫能见度实证（持锁 3.5s → ~3456ms 告警在监听前）；重试仅在 busy_timeout 耗尽后介入；零行为变化；契约 5/5 + 邻域 13/13 + closeout PASS；存量循环加载 TDZ 登记 🟡。plan=docs/block-328-early-loop-guard-plan.md | BLOCK-328 / P6-CLOSED |
| ✅ AUDIT-LOG 🟡 工程债五项清偿（SIGTERM 不退出 / C6 判据过时 / next:suggest 不落账 / state 漏报 living-plan / verify --list 必红）completed（BLOCK-326 清偿批；用户裁决「继续冲 搞完」） | 2026-11-01 | 五项修法均在案、当日清偿：①SIGTERM teardown 捕获 httpServer 关库→close→exit(0) 2000ms 兜底 + spawn 真进程回归测试；②四 flow 补 id/description/evidenceDir，verify --list 已可跑；③workspace-state 纳入 living-plan 槽位 + **根因回写** BLOCK-322/STAGE-34 registry 翻 completed（13 包收口机械核对）④C6 夹具 mate→bond+文案对齐 scene3d 现值；⑤decision-api no_key 早退补 degraded 落账（实跑次数台账可见）。证据=test/block326-audit-debt-sweep.test.mjs 5/5 + closeout 十一门 PASS。**不含需裁决项**：mac ffmpeg 合成/dev-verify 证据文件名平台化/R 下载授权留 🟡。plan=docs/block-326-audit-debt-sweep-plan.md | BLOCK-326 / P6-CLOSED |

<!-- audit-log-compact.mjs 追加 @ 2026-11-09T11:50:21.612Z -->
| ✅ BLOCK-334 P1 宿主迁移（2026-11-02 当日收口；UI-657 verified） | 2026-11-02 | **P1-COMPLETED**：ResultsSurface 右栏宿主 + 中央四态退役 + Inspector 退役 + openResultInRail/syncResultQuery + resultRightWidth 焦点宽（不触左栏）+ 标题栏收敛 + active 透传。门禁 tsc 0/lint 0/vitest 13 文件 51/51/十门 PASS/台账契约 4/4；实机 `acceptance/block-334/block334-result-host-live-darwin.json` 11/11+png。抓真：证据债棘轮判红→补腿；D2 左栏收起与 UI-341 加映二冲突→删。plan §8 | BLOCK-334 / P1-COMPLETED |
