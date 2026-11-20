# Petri Desktop 项目系统评估 R2（2026-11-20）

> 口径：全部现读真源，不凭记忆。断言均可回溯到路径/行号/命令输出。
> 基准：HEAD=`c3242e8c`（R1 基准 `abfeea76` → 前进 2 commit：R1 报告落档 `834aa562` + 评估提示词落档 `c3242e8c`）。
> 分支 `main` 与 `origin/main` 完全同步（`rev-list --left-right --count` = `0 0`）；单 worktree。
> 范围 In：视觉升级全链（A0–A4 / V1 / V1-U / V5 / B / V2–V4 / 造型 / 国风水印）+ 其治理与门禁面。
> 范围 Out：G1+（Provider / 公证 / GA / packaged）、他包 WIP 内容、用户资产、观感代签。
> 性质：专项结论型——零产品代码改动、零依赖、零台账状态翻转、不替他包收口。
> 门禁原始输出与退出码：`gates/exit-codes.tsv` + `gates/*.log`（本轮现采）。

---

## 1. 执行摘要

**一句话结论**：视觉升级全链在「主题交付」层面确已收口（19 commit、14 主题、各包 HK-01 红绿留证），但**R1 的「已全链收口」结论过于乐观**——本轮现读发现 ① A0 裁决的身份面在**默认态仍不可见**（默认 accent 仍是 `teal`）② 视觉链自身引入并已提交 **2 处 code-size 棘轮超标 + 1 处设计基线契约红**，且 A2 台账把它误归为「HEAD 存量」③ R1 的 P0 水印并发冲突**未闭环且证据恶化**（极简版自身实机 `allPass:false`、4 张已提交 PNG 被删、9223 实例遗留）。

**四维评分（判据见 §3/§4/§5/§6）**

| 维度 | 分 | 一句话判据 |
|---|---|---|
| D1 进度 | **3** / 5 | COMPLETION-PLAN 6 期中 5 期交付（83%），但核心出口「身份面在真实高频面可见」未达 + V0 基线契约红 + 3 个 active 槽位登记漂移 |
| D2 交付质量 | **2** / 5 | 扩展 10 门现读 **5 PASS / 5 FAIL（50%）**；其中 code-size 与 design-context 契约红属**本轮引入且已提交**；A2 GATE-LEDGER 归属误判 |
| D3 风险与阻碍 | **2** / 5 | 1 起 P0 并发冲突跨轮未闭环（证据受损）+ 6 项 P1（含 3 项 breaking U 类裁决逾期）+ 7 项 P2 |
| D4 资源与协作 | **2** / 5 | 33 项脏文件全部可归类，但 10 项终版未裁；9223 测试实例遗留 30+ 分钟违反 kill 纪律；7 条失败任务未收口；AUDIT-LOG 107KB 超阈未 compact |
| **总分** | **9 / 20（45%）** | R1 未打分 → **本轮为首个量化基线，无趋势可比**（§9.d） |

**三个最关键发现**

1. **裁决与默认态脱节**：A0 用户裁决「B 青瓷·墨主 accent + A 宣纸·朱砂点睛」，但 `prefCache.ts:102` 默认返回 `'teal'`，`accents.ts:55-60` 对 teal **移除** `data-accent`/`data-surface` → 身份色板与四档和声**只有用户手动切档才可见**。三个身份 token 在组件面消费 **0 处**（`custom.css` 内 30 处）。这正是 COMPLETION-PLAN 诊断的「素材加了界面没变」的**残留根因，V5/B 收口后仍未解决**。
2. **本轮自己制造的红被记成别人的**：`Icon.tsx` 744→774（A2 `908e561c`）→783（造型 `c3fcfe20`），基线 744 未重打；`custom.css` 1301→1314（A0/A1 `0dd3a8aa`）→1408（V5）→1476（B）→1485（造型），字节 49517>39709。而 `acceptance/a2-identity-atoms/GATE-LEDGER.md:32` 写「code-size …非 A2 文件面」——**Icon.tsx 正是 A2 改的文件**。
3. **并发方的方案从未实机通过，却覆盖了已验证版本的文件**：`acceptance/cultural-watermark/live-minimal/cultural-watermark-live-darwin.json` = `allPass:false`（`vite_bundle_ready` FAIL「极简单线 CSS 未在强制 reload 后 12 轮内生效」+ `cdp_socket_not_open`）；同时 4 张已提交 live PNG 被删（`D`），未跟踪的 `watermark-contract.test.ts` 5 tests 全绿但**锚的是未接线的死代码**。

---

## 2. 进度跟踪表

窗口 `0dd3a8aa^..HEAD` = **21 commit**（19 视觉链 + 2 评估/提示词落档）。

| 主题 | commit/证据 | 状态 | 验收锚点 |
|---|---|---|---|
| A0 身份转译裁决 + aesthetic-atlas 项目化 | `0dd3a8aa` / `acceptance/a0-identity-translation/ruling.json` | completed | 消费测试 12/12；裁决 append-only |
| A1 色板 token 化 | `0dd3a8aa` / `acceptance/a1-identity-palette/` | completed（**出口未达**） | HK-01 红→绿 4/4；但组件面消费 0 处（§1 发现 1） |
| A2 造型图标原子 | `908e561c` / `acceptance/a2-identity-atoms/` | completed（**带红未清**） | HK-01 6/6；Icon.tsx +30 行超基线未重打 |
| A3 排版留白 | `279b15b8` / `acceptance/a3-editorial-rhythm/` | completed | HK-01 5/5 + 邻域 39 tests |
| A4 观感预审（含 round3 / 四档） | `57b3dd5f`/`03f767e7`/`01bbfb7d` | completed | UI-717 静态+交互+四档观感 verified（9223 边界内） |
| V1 配色稀缺化 | `c8cd5e0a` / `acceptance/v1-accent-scarcity/GATE-LEDGER.md` | completed（U 残留） | accent 356→316，`targetMet=false` 诚实未达 |
| V1-U 语义收敛 | `c0bdb122` | completed | accent 316→269（c53 现读 269 一致） |
| V5 四档和声 | `a6e06bff` / `acceptance/v5-harmony-accents/` | completed（**默认不可见**） | 实机 17/17；四档注册于 `accents.ts:26-30` |
| U 裁决材料（骨架随档） | `ee71cca1` / `acceptance/u-skeleton-per-accent/U-DECISION-MATERIAL.md:4` | **pending_user_ruling（状态漂移）** | 用户已裁决 B 且已执行，材料 status 未 flip |
| B 骨架随档 + 模糊根因修复 | `62b1a9e6`/`1963f9d8` | completed | 实机 14/14；弱化字八组 ≥4.5:1（最弱 4.64/6.50） |
| V2/V3/V4 收尾 | `d75444cb` / `acceptance/v234-layer-detail/` | completed | leftPanelWrap 合并、`;;` 清零、评分卡 3.6→4.1 |
| 造型形态语义层级 | `c3fcfe20` / `acceptance/form-grammar/` | completed（**带红未清 + 审美未签**） | 实机 7/7；custom.css/Icon.tsx 再增未重打基线 |
| 国风水印（四轮迭代） | `af9de2e1`→`ea42724a`→`c95c2a26`→`abfeea76` | completed（**终版未裁**） | AI 版实机 12/12；审美 in_progress 不代签 |
| COMPLETION-PLAN V0 基线冻结（补做） | `acceptance/block465-c53-p0p1/design-baseline.json` | **红（未达）** | `test/c53-design-context-pack.test.mjs` 2 fail（§3） |
| R1 评估 + R2 提示词落档 | `834aa562`/`c3242e8c` | completed | 本文件即 R2 产出 |

**母纲/蓝图位置（现读）**：Q-MATRIX `docs/qoder-essence-absorption-plan.md:318` = ✅74 · 🟡21 · 🔴0 · ⛔7 = **102 点**，§6.5 串行队列清零；`docs/next-work-blueprint-2026-11-16.md` W1–W8 ✅ 已完成、W9 部分需裁决、W10/W11 候选；竞争力纲 `docs/agent-competitiveness-program.md` frontmatter `status: planned`（六波 CP-1~CP-19 未启动）。
**UI 台账机械读数**（`collectDesignBaseline().uiDebt` 现读）：sections 503 / uniqueIds 494 / verified 453 / debt 38（liveMissing 15 + blocked 23）/ closed 12；最大编号 UI-717。

---

## 3. 交付质量清单（门禁逐项现读）

**提示词 §2.4 必跑 7 门 = 5 PASS / 2 FAIL（71%）；本轮另加 3 门质量棘轮 → 扩展 10 门 = 5 PASS / 5 FAIL（50%）。**

| 门 | 命令 | 退出码 | 结果 | 失败归属 |
|---|---|---|---|---|
| docs | `npm run docs:check` | 0 | **PASS**（662 文档）；附警告 AUDIT-LOG 107KB>50KB | — |
| ui-audit | `npm run ui:audit:check` | 1 | **FAIL**「工作区包含 UI 改动但未同步台账」 | **工作区并发 WIP 触发**（检查器读 `git diff --name-only HEAD`，`scripts/check-ui-productization-audit.mjs:1276`）；台账文件本身干净 → **非 HEAD 提交红** |
| hygiene | `npm run hygiene:check` | 0 | **PASS**（97 项残留只报告不代删） | — |
| ui-a11y | `npm run gate:ui-a11y` | 0 | **PASS** 八态 32/32、focus 缺口 12/16 ≤ 冻结、对比度 32 对 **0 违规** | — |
| c53 | `node scripts/c53-visual-consistency.mjs --check` | 0 | **PASS** `ok:true`、accentTotal 269、sourceCommit=`c3242e8c` | — |
| test:changed:list | `npm run test:changed:list` | 2 | **FAIL** 工具错误：`ui-error-classification-stall references missing test errorMessages.test.ts` | **HEAD 存量**（`test/impact-map.json:9772` 裸文件名；真实文件在 `frontend/src/components/copilot/errorMessages.test.ts`） |
| types | `npm run quality:types` | 0 | **PASS** tsc 0 error | — |
| code-size | `npm run gate:code-size` | 1 | **FAIL 30 条 / 16 文件**（9 行超标 + 5 字节超标 + 16 指纹漂移） | **混合**：Icon.tsx / custom.css = **本轮视觉链引入且已提交**；其余 = 他包 HEAD 存量（明细下表） |
| user-assets | `npm run gate:user-assets` | 1 | **FAIL** tracked `scripts/backfill-artifact-chain.mjs` | **HEAD 存量**（R1 已记，未清） |
| silent-catch | `npm run gate:silent-catch` | 1 | **FAIL** `core/petri-server/helpers/lesson-store.js` 2 处 > 基线 0 | **HEAD 存量**（EVO-2 引入，R1 已记） |

**code-size 超标归属明细（逐 commit 行数现读）**

| 文件 | 基线 | 现读 | 归属 commit |
|---|---|---|---|
| `frontend/src/components/icons/Icon.tsx` | 744 | **783** | `908e561c`(A2)→774、`c3fcfe20`(造型)→783 = **本轮** |
| `frontend/src/styles/custom.css` | 1301 行 / 39709 字节 | **1485 行 / 49517 字节** | `0dd3a8aa`(A0/A1)→1314、`a6e06bff`(V5)→1408、`62b1a9e6`(B)→1476、`1963f9d8`→1478、`c3fcfe20`→1485 = **本轮** |
| `frontend/src/components/workspace-panels/LeftPanel.tsx` | 851 | 972 | `ae4ffd74`（UI-715 右键菜单）= 他包 |
| `core/petri-server/agent-tools/workspace-tools.js` | 1605 | 1619 | 他包存量 |
| `core/petri-server/agent-runner.js` | 1143 | 1153 | 他包存量（EVO 链） |
| `core/packages/shared-config/config-schema.js` | 1153 | 1156 | 他包存量 |
| `frontend/src/lib/electron.d.ts` | 1032 | 1051 | 他包存量 |
| `frontend/src/components/desktop/TitleBar.module.css` | 995 行 / 22596 字节 | 996 / 22698 | 他包存量 |
| `project-workspace.module.css` / `simple-chat.css` | 176885 / 132675 字节 | 177240 / 132723 | 他包存量 |

**定向契约（本轮补跑，R1 未跑）**

| 契约 | 结果 | 归属 |
|---|---|---|
| `test/c53-design-context-pack.test.mjs` + `test/c53-visual-consistency.test.mjs` | **17 tests / 15 pass / 2 fail** | **本轮引入的 HEAD 红**：`uiDebt` 读数漂移——冻结 sections 509/uniqueIds 500/debt 36/liveMissing 13/verified 461/consistent false，现读 503/494/38/15/453/true。台账在水印批（`abfeea76` 等）更新后未重生成 `design-baseline.json` + `design-context.json` |
| 视觉链前端契约 4 files（HarmonyAccents / SurfaceDimension / CulturalWatermark / watermark-contract） | **24 tests 全绿** | 绿；但 `watermark-contract.test.ts` 锚未接线文件（§4 P0-1） |

**红→绿证据链完整性**：A1/A2/cultural-watermark 等包 `hk01-red.txt` + `hk01-green.txt` 在盘（HK-01 纪律执行良好）；**缺口**＝① 极简水印版只有红证据（`allPass:false`）却覆盖了已验证版本的文件 ② 4 张已提交 live PNG 在工作区被删（可从 HEAD 恢复，未恢复）③ code-size / design-context 两处红**无任何包笔录登记**。

---

## 4. 问题清单（分级 · 逐条可执行）

> 分级按提示词 §4；R1 跟进卡未闭环者按 §6.b **自动升级一级**（U 类的 P0 表示「裁决逾期」，**不改变「不裁不动」红线**）。

| 编号 | 分级 | 现象 | 证据 | 影响 | 建议动作 | 前置条件 | 归属 |
|---|---|---|---|---|---|---|---|
| **P0-1** | P0（R1-P0 未闭环·恶化） | 水印两方案并存且终版未裁：工作区 `watermark.css`/`GlobalWatermark.tsx` = 极简候选1（12% 墨 uniform stroke），但 `main.tsx` 渲染 AI 版 → 极简版是**未接线死代码**；极简方自身实机 `allPass:false`；4 张已提交 PNG 被删；9223 实例遗留 | `frontend/src/main.tsx:11-12,20`；`acceptance/cultural-watermark/live-minimal/cultural-watermark-live-darwin.json`；`git status` 4×`D`；`ps` pid 85626/85629 etime 30:39，CDP page `localhost:3000/?test=1`；mtime 21:01–21:05（现读 22:51，105 分钟无写入） | 交付版本不确定；已验证证据在工作区丢失；绿测试掩护死代码；测试实例占资源/可能上屏 | **建议留 AI 版**（唯一有实机 12/12 绿证据者）：恢复 4 张 PNG（`git checkout HEAD -- acceptance/cultural-watermark/live/`）→ 极简版三文件回退 HEAD → 未跟踪契约测与 `live-minimal/` 移交其 owner 或归档 → kill 9223 | **用户裁决终版**（破坏性回退需授权） | 水印两并发会话 |
| **P0-2** | P0（R1-P1 升级·裁决逾期） | 断点档位 17→≤4 的具体档值 + JS/CSS 单源常量未裁 | `acceptance/ui-visual-upgrade-2026-11-20/VISUAL-UPGRADE-PLAN.md` §9.3 | V2 布局单源无法收口；响应式档值散落 | 出决策材料（现读 17 档分布 + 推荐 4 档值）→ 用户回「行/不行」 | 用户裁决 | 视觉链 U 类 |
| **P0-3** | P0（R1-P1 升级·裁决逾期） | 状态色三套并存（`--petri-success` / `--petri-status-success` / `--petri-status-success-fg`）合并属 breaking | 同上 §9.4 | 状态语义双源，主题切换易漂移 | 出合并映射表 + 消费点清单 → 用户裁决 | 用户裁决 | 视觉链 U 类 |
| **P0-4** | P0（R1-P1 升级·裁决逾期） | 目标分 `targetPerDimension=4.4` 是否采纳为门槛未裁 | 同上 §9.2；现读评分卡 4.1 | 无门槛则「达标」无判据，V4 复评口径悬空 | 建议采纳 4.4 为**方向性门槛**（现读 4.1，缺口 0.3 明示）→ 用户回「行/不行」 | 用户裁决 | 视觉链 U 类 |
| **P1-1** | P1（R1-P2 升级） | code-size 30 条违规，其中 Icon.tsx / custom.css 属本轮引入；A2 台账误归为「非 A2 文件面」 | `gates/gate-code-size.log`；逐 commit 行数见 §3；`acceptance/a2-identity-atoms/GATE-LEDGER.md:32` | 棘轮失效（只减不增被破）；收口笔录可信度受损 | 独立小票：造型/A2 增量重打基线（`--write`）+ 更正 A2 台账归属行；他包超标移交 owner | 单独立项（不混入评估） | 视觉链 + 他包 |
| **P1-2** | P1（新） | 设计基线契约 2 fail：`uiDebt` 冻结读数与现读台账漂移；且 `captureContext` 断言把「BLOCK-465 仍 active」写死 | `gates/v0-baseline-contracts.log`；`test/c53-design-context-pack.test.mjs:37-38,45,98`；registry BLOCK-465 = `completed/CLOSED` | V0 基线冻结项实为红；**直接重生成会撞第 38 行断言**（契约漂移第④类） | 重生成 `node scripts/c53-design-baseline.mjs` + 同步把第 38 行改为中性判据（不锚具体包名）→ 复跑 17/17 | 独立小票（契约演进） | 视觉链台账批 |
| **P1-3** | P1（新·U 类 breaking） | A0 裁决的身份面默认不可见：默认 accent `teal` → 移除 `data-accent`/`data-surface`；身份 token 组件面消费 0 处 | `frontend/src/themes/prefCache.ts:102`；`accents.ts:55-60`；grep 消费计数 0（`custom.css` 内 30） | 用户实际看到的界面 ≠ 已裁决的品牌身份；A1/V5/B 三包成果默认态不可感知 | 建议：默认档改 `celadon-ink` + 旧配置迁移（显式选过 teal 者保留），符合用户「把重复设置写进默认」偏好 → **需用户裁决**（改默认属 breaking） | 用户裁决 | 视觉链 A0/V5 |
| **P1-4** | P1（新） | 3 个 `kind=work-package` 槽位仍 `active`，但 phase 均 MATERIAL 且已交付 → 违反「单工作包串行」 | `docs/DOC-REGISTRY.json`：BLOCK-503/505/506；三者 frontmatter `status: active / phase: MATERIAL`；AUDIT-LOG 有交付行（:99,:117,:119） | 恢复者误判有 3 个在制包；串行纪律失真 | 状态归位批：三包 registry + frontmatter → `completed`（材料交付完成态），同步 README/roadmap/handoff | 独立小票（纯文档） | 治理 |
| **P1-5** | P1（R1 §3.3 未闭环） | `U-DECISION-MATERIAL.md` status 仍 `pending_user_ruling`，而方案 B 已裁决并执行 | `acceptance/u-skeleton-per-accent/U-DECISION-MATERIAL.md:4,53`；`acceptance/u-skeleton-per-accent/RULING.md` | 待裁清单虚高；消费测试锚过期状态 | flip 为 ruled（附 RULING 指针）或归档 + 同步消费测试 | 独立小票 | 视觉链 U 类 |
| **P1-6** | P1（R1-P2 升级） | `test:changed` 工具错误 exit 2（裸文件名） | `gates/test-changed-list.log`；`test/impact-map.json:9768,9772` | 定向测试入口不可用 → 收口链 fail-fast，所有包被迫手工收窄 | 把 `errorMessages.test.ts` 改为完整相对路径 | 独立小票 | HEAD 存量（impact-map owner） |
| **P1-7** | P1（R1-P2 升级） | `gate:user-assets` 把 tracked 脚本判违规 | `gates/gate-user-assets.log` | 收口链红；保护清单与索引不一致 | `git rm --cached scripts/backfill-artifact-chain.mjs`（磁盘保留）或从保护清单摘除（需 owner 裁决） | owner 确认 | HEAD 存量 |
| **P1-8** | P1（R1-P2 升级） | silent-catch：`lesson-store.js` 2 处 > 基线 0 | `gates/gate-silent-catch.log` | 自进化链失败不可见（与「可信即能力」定位冲突） | 三分法处置：真缺陷修（失败要可见）/ 误报豁免留注释 | 独立小票 | EVO-2 |
| **P1-9** | P1（R1-P2 升级） | 7 条 open/failed 后台任务未收口 | `npm run state`：a4r3-backend(exit1/SIGTERM)、wait-507-commit(exit2)、build-v004(exit1)、ecs-feed-rebuild(exit1)、block405-l1(exit1)、block404-lint-ledger2(exit1)、block404-lint-ledger(exit143) | 任务账失真；失败原因无人认领 | `task:status --prune-days N` 清历史 + 逐条标注归属/关闭理由 | 独立小票 | 治理 |
| **P2-1** | P2（新） | AUDIT-LOG 107KB > 50KB 阈；archive 有**未提交** compact 输出（11 行 @08:02:03Z）+ 未跟踪旋转档 | `gates/docs-check.log` 警告；`git diff docs/archive/checkpoints/audit-log-through-2026-11-20.md`；`?? …r20261120T130842Z.md` | 广播台超阈；compact 输出与 AUDIT-LOG 不同步（EVO 行两处并存） | 由治理批统一跑 `audit:compact` 并**同批提交** archive；本轮**未跑**（避免卷入他方未提交 WIP，如实登记偏差） | 治理批裁决 | 治理 |
| **P2-2** | P2（新） | 测试实例生命周期无机械守护：9223 遗留 30+ 分钟 | `ps`/`lsof` 现读；`test/live-window-policy.test.mjs` 只扫 `PETRI_TEST_ONSCREEN` 字面量 | 违反「跑完立即 kill」；源码门禁对遗留进程是盲区 | 给 `start-test-instance.sh` 加 TTL/退出 trap，或 dev-verify runner 收尾统一 kill | 独立小票 | dev-infra |
| **P2-3** | P2 | 工作区 33 项脏（11 M + 4 D + 18 ??），含用户资产与 tmp 残留 | `git status --short` 全量；`hygiene:check` 97 项报告 | 归属可识别但终版未裁者 10 项；tmp 目录长期滞留 | 分类处置：水印 10 项随 P0-1、他包证据 13 项移交 owner、用户资产 6 项零触碰、tmp 2 项由 owner 清 | 各 owner | 多包 |
| **P3-1** | P3（只登记不启动） | 产品候选 C-35~C-44 + 竞争力纲六波 CP-1~CP-19 + QODER 母纲 🟡21 点 | `docs/agent-competitiveness-program.md`（planned）；`docs/qoder-essence-absorption-plan.md:318` | 主线外延，需逐包发令 | 维持候选池，按用户发令逐个立项 | 用户发令 | 产品 |

---

## 5. 风险与阻碍

- **U 类未决（不裁不动）6 项**：断点档值（P0-2）、状态色合并（P0-3）、目标分 4.4（P0-4）、**默认身份面（P1-3·本轮新增）**、`sc-access-btn` 橙红是否随和声（A4 已标边界）、全局 focus 单源 88 处（V234 登记 deferred）。
- **breaking 点**：改默认 accent（影响全体用户视觉）、状态色 token 合并（消费点广）、断点档值收敛（布局重排）——三者均需决策材料 + 用户口令。
- **外部依赖**：`image_gen` 为水印 AI 版唯一出图通道（Figma/Penpot MCP 未连接）；Jev cloud 本轮**可用**（`doc:suggest` 返回 model 供给读数，与旧记忆「云不可用」不符，以现读为准）。
- **观感零代签状态（守住）**：UI-717 四档观感 verified（A4 预审闭环，用户「可以的 冲」授权）；**造型 / 国风水印审美仍 `in_progress`**，无偏好裁决不代签；E 类人眼槽 `humanEyeSigned:false`（design-context pack 边界断言绿）。
- **最大阻碍**：P0-1 未裁决前，任何水印相关改动都会继续互相覆盖；本轮评估因此**零触碰**该三文件。

---

## 6. 资源与协作评估

| 项 | 现读 | 判定 |
|---|---|---|
| 工作区脏度 | 33 项 = 11 M + 4 D + 18 ??；分类：水印争议 10 / 他包证据 13 / archive compact 2 / 用户资产 6 / tmp 2 | 归属可识别率 **33/33 = 100%**；终版未裁 10 项 |
| 并发冲突 | 1 起（水印），写入窗口 21:01–21:05，现读 22:51 → **105 分钟静默**；未检出其他 agent CLI 进程（仅 Qoder 宿主 + 长活 codex 代理） | 冲突**暂停但未裁决**；不能据此认为已解决 |
| 进程/端口 | dev 栈健康：vite :3000(pid 59604) + backend :3001(pid 59882) + 主窗 CDP :9222(pid 59657)，编排器 `dev-electron.js` 在跑（3h22m）；**另有 9223 测试实例 pid 85626/85629 遗留 30:39** | 三面齐绿；测试实例违反 kill 纪律（P2-2） |
| 后台任务 | 35 条中 7 条 open/failed（最新 a4r3-backend 20261120-0918 exit1/SIGTERM） | 未收口（P1-9） |
| 证据可追溯 | 14 个视觉链主题各有 `acceptance/` 目录；HK-01 红绿文件在盘 | 主题级 **14/14**；但 4 张 committed PNG 工作区被删 + 极简版只有红证据 → 证据链**有缺口** |
| 治理流程执行 | AUDIT-LOG 超阈未 compact；archive compact 输出未提交；3 槽位登记漂移；A2 台账归属误判 | 流程纪律**执行率下降**，是本轮 D4 扣分主因 |

---

## 7. 改进建议（按 ROI 排序）

1. **裁决水印终版 + 清场（P0-1）**——做什么：用户一句「留 AI 版」即可解锁回退/恢复/kill 三步。为什么：唯一跨轮未闭环 P0，且正在损坏已验证证据。预期收益：`ui:audit` 转绿（工作区 UI 改动消失）、证据链复原、并发破坏终止。**成本最低、收益最大**。
2. **一个「视觉链带红清偿」小票（P1-1 + P1-2）**——做什么：重打 Icon.tsx/custom.css 基线 + 重生成 design-baseline/pack + 修第 38 行过期断言 + 更正 A2 台账归属。为什么：两处红都是本轮自己造的，且都会让后续每个包的 closeout fail-fast。预期收益：code-size 与 design-context 契约转绿，收口链恢复可用。
3. **默认身份面裁决（P1-3）**——做什么：出「默认档改 celadon-ink + 旧配置迁移」一页决策材料。为什么：否则 A0/A1/V5/B 四包成果对用户默认不可感知，等于白做。预期收益：视觉升级从「素材入库」变成「用户看得见」。
4. **治理归位批（P1-4 + P1-5 + P2-1）**——做什么：三槽位 completed、U 材料 flip、AUDIT-LOG compact 同批提交。为什么：纯文档、零风险，恢复「单工作包串行」与广播台可信度。预期收益：会话恢复不再误判在制包。
5. **存量红清偿批（P1-6~P1-9）**——做什么：impact-map 裸文件名、user-assets 索引、silent-catch、失败任务账。为什么：这四项让每个包收口都要手工绕过。预期收益：closeout 定向链恢复全绿。
6. **测试实例 TTL 守护（P2-2）**——做什么：给启动器加退出 trap / TTL。为什么：同类遗留已第二次出现（源码门禁盲区）。预期收益：离屏纪律机械化，不再靠自觉。

---

## 8. 下一步计划（递进 · 区分发令与自推）

| 序 | 动作 | 前置 | 验收 | 谁启动 |
|---|---|---|---|---|
| 1 | 水印终版裁决 + 并发清场（恢复 4 PNG / 回退极简三文件 / kill 9223 / 同步台账） | **用户裁决终版** | `ui:audit:check` exit 0；`git status` 无水印争议项；9223 无监听 | 需用户发令（破坏性回退） |
| 2 | 视觉链带红清偿小票（code-size 基线 + design-baseline 重生成 + 契约断言演进 + A2 台账更正） | 1 完成（避免同批冲突） | `gate:code-size` exit 0；`c53-design-context-pack` 17/17 | 需用户发令立项；立项后 Agent 可自推 |
| 3 | 三个 breaking U 类决策材料（断点 / 状态色 / 目标分）+ 默认身份面材料 | 无（纯材料，零代码） | 四份材料各含**单一推荐 + 一句理由**，status=pending_user_ruling | **Agent 可自推**（材料不改动产品） |
| 4 | 治理归位批（503/505/506 槽位 + U 材料 flip + AUDIT compact） | 无 | `docs:check` PASS 且 AUDIT-LOG <50KB；registry active work-package = 0 | 需用户发令（涉他包状态） |
| 5 | 存量红清偿批（impact-map / user-assets / silent-catch / 任务账） | 2 完成 | 四门逐一 exit 0 或如实降级登记 | 需用户发令立项 |
| 6 | 造型 / 水印审美预审闭环 | **用户给偏好标准或口令** | ≤3 轮逐条判据 + 截图 → verified（否则维持 in_progress） | 需用户授权 |
| 7 | 产品候选（C-35~C-44 / CP-1~CP-19 / QODER 🟡21） | 用户逐包发令 | 每包独立 closeout | 需用户发令 |

**Jev 单一建议（现跑）**：`npm run next:suggest` → **水印终版裁决与并发清场**（confidence **0.56**）。与本文序 1 一致。
（工具注意：`--candidates` 按 `|` 分隔；首次用逗号被当单候选原样回显，已用正确格式重跑。）

---

## 9. 复盘跟进机制

**a. R1 跟进卡状态复述（开场必做，已执行）**

| R1 卡 | R1 分级 | 本轮状态 | R2 分级 |
|---|---|---|---|
| 水印并发冲突 | P0 | **open·恶化**（极简版实机红 + 4 PNG 被删 + 9223 遗留） | P0-1（维持） |
| 断点档值 17→≤4 | P1 | open（未裁） | **P0-2（升级）** |
| 状态色三套合并 | P1 | open（未裁） | **P0-3（升级）** |
| 目标分 4.4 门槛 | P1 | open（未裁） | **P0-4（升级）** |
| U-DECISION-MATERIAL status 收口 | R1 §3.3 | open（仍 pending） | P1-5 |
| test:changed 裸文件名 | P2 | open（exit 2 复现） | **P1-6（升级）** |
| user-assets tracked 误判 | P2 | open（FAIL 复现） | **P1-7（升级）** |
| silent-catch | P2 | open（2>0 复现） | **P1-8（升级）** |
| code-size 指纹漂移 | P2 | open·**扩大**（30 条，含本轮引入超标） | **P1-1（升级）** |
| 7 个失败后台任务 | P2 | open（7 条 unchanged） | **P1-9（升级）** |
| 视觉审美复审 | R1 §3.4 | 部分（UI-717 verified；造型/水印 in_progress） | 序 6（需授权） |

**b. R2 跟进卡（P0/P1 逐条）**

| 卡 | 责任人 | 目标日 | 验收条件 | 状态 |
|---|---|---|---|---|
| P0-1 | 用户裁决 + 水印包 owner | 2026-11-21 | ui:audit exit 0 + 4 PNG 恢复 + 9223 无监听 | open |
| P0-2 / P0-3 / P0-4 | 用户裁决（Agent 出材料） | 2026-11-22 | 三份材料 + ruling 落档 | open |
| P1-1 / P1-2 | 视觉链 owner | 2026-11-22 | code-size exit 0 + pack 契约 17/17 | open |
| P1-3 | 用户裁决 | 2026-11-23 | 默认档裁决 + 迁移方案 ruling | open |
| P1-4 / P1-5 | 治理批 | 2026-11-22 | registry active work-package = 0 + 材料 flip | open |
| P1-6~P1-9 | 各存量 owner | 2026-11-24 | 四门 exit 0 或如实降级 | open |

**c. 复评触发**：任一 P0 关闭 / 任一 U 类裁决 / 任一门禁红转绿 / 用户发令。
**d. 评分趋势**：R1 未打分 → R2 = 首个基线（D1 3 / D2 2 / D3 2 / D4 2，总 9/20）。**R3 起记录趋势；连续两轮同维不升即列专项复盘。**
**e. 周期**：每工作包收口后一次 + 每周五定期；本轮基准 2026-11-20。角色：评估 Agent（出具）/ 用户（U 类裁决与 P0 定向）/ 包 owner（P1 债务认领）/ 评审员（抽验）。

---

## 10. 边界与诚实声明

- **不外推**：G0 开发期常态 · 不外推 packaged/Provider/GA。所有 verified 均限 dev Electron / 9223 离屏边界。
- **零代签**：造型与国风水印审美维持 `in_progress`；E 类人眼槽全空未代填；本轮未翻转任何台账状态。
- **零触碰**：水印三文件（P0-1 争议面）、他包 WIP（block462/463/472/503-outputs/stall/nso）、用户资产（`petri-logo-concepts*`、`model3d/`、`assets/`、`docs/pelican-bicycle.html`、POST-H9 蓝图）、tmp 目录。
- **未验证项**：① 极简水印版**从未实机通过**（其自身证据 `allPass:false`），本文不对其观感作任何判断 ② COMPLETION-PLAN 的 V0「19/19」口径未找到对应测试集，本文只以现读 17 tests/2 fail 为准 ③ 未跑全量 `npm run check` / `test:all:workspace`（按定向纪律），故**未验证范围＝全量套件与 G1+ 面**，不得表述为全量通过 ④ 9223 遗留实例的归属会话未能确证（未检出其他 agent CLI 进程），只登记事实不推断责任人。
- **流程偏差如实登记**：AUDIT-LOG 已 107KB>50KB，按纪律应先跑 `audit:compact`；本轮**未跑**——因 `docs/archive/checkpoints/audit-log-through-2026-11-20.md` 存在他方未提交 compact 输出（11 行），跑脚本会把该 WIP 卷入本批提交，违反「不卷入他方 WIP」红线。处置建议见 P2-1。
- **六件套回写后复跑（现读）**：本轮只写 AUDIT-LOG 头部+表行、roadmap 头部、handoff 头部三处（UI 台账未动=无 UI 改动与状态翻转；impact-map 未动=无新增生产路径，与 R1 先例一致）。回写后 `docs:reconcile` Unregistered 0 / Validation issues 0、`docs:check` **PASS(662)**（AUDIT-LOG 因本次写入增至 **109KB**，警告不阻塞）；`ui:audit:check` 复跑仍 **RED**，原因未变=工作区并发 UI 改动未同步台账（`gates/ui-audit-check-post-writeback.log`），非本轮引入。报告与 gates 证据为新增未跟踪文件，**未提交**（用户未发令 commit/push）。
- **存量红归属**：`test:changed` exit 2 / `user-assets` / `silent-catch` / code-size 中 14 文件 = HEAD 存量他包；`ui:audit` = 工作区并发 WIP 触发（非 HEAD 提交红）；**code-size 的 Icon.tsx/custom.css 与 design-context 契约 2 fail = 本轮视觉链引入且已提交**，不冒充存量、不冒充他包。
- **实现先于测试的红证据**：本轮为评估批，无实现；视觉链各包 HK-01 红绿文件在盘，唯 code-size/design-context 两处红**无红证据留痕**（属漏跑门禁，非漏留证据）。