# Petri Desktop 项目系统评估（2026-11-20）

> 口径：全部现读真源（git HEAD / AUDIT-LOG / roadmap / handoff / plan / DOC-REGISTRY / 五道门），不凭记忆。
> HEAD=`abfeea76`，分支 `main` 与 `origin/main` 同步；单 worktree。

## 0. 一句话结论
**视觉升级主线已全链收口**（A0→A4、V1/V1-U、V5、B、V2/V3/V4、造型、水印）；当前最高优先级不是再做视觉，而是 **① 解决工作区并发冲突（有另一进程在改同一批水印文件）② 清掉 ui:audit 台账红 ③ 裁决 3 个 breaking U 类点**。全局串行队列 §6.5 早已清零，无 active 真在制包。

---

## 1. 近期已完成（按主题分组，均 commit 可追）

### 1.1 视觉/审美主线（今天集中完成，共 ~12 commit）
| 主题 | 关键 commit | 落点/证据 |
|---|---|---|
| 审美 skill 项目化 | `0dd3a8aa` 前 | `aesthetic-atlas` 10 refs+audit 脚本 → `.agents/skills/` canonical + 双 symlink 桥 |
| A0 身份转译 + A1 色板 | `0dd3a8aa` | `acceptance/a0-identity-translation/` + `a1-identity-palette/`；4 身份 token 亮暗双套 |
| A2 造型图标原子 | `908e561c` | `Icon.tsx` 三原子(open-ring/offset-grid/hairline)，落 MCP 空态+active tab |
| A3 排版留白 | `279b15b8` | 欢迎页 0.04em/设置页 0.03em+中性落印位 |
| V1 配色稀缺化 | `c8cd5e0a` | accent 356→316（装饰性收敛），targetMet 诚实 false |
| V1-U 语义收敛+A4 round3 | `c0bdb122`/`03f767e7` | accent 316→269，UI-717 交互面 verified |
| 收尾计划落档 | `14516d5a` | `COMPLETION-PLAN.md`，诊断"素材加了界面没变" |
| V5 四档和声 | `a6e06bff` | `[data-accent]` 四档复用现成管道，实机 17/17 |
| U 裁决材料+B 骨架随档 | `ee71cca1`/`62b1a9e6` | `data-surface` 正交维度，四档骨架各异，实机 14/14 |
| 模糊修复+A4 四档观感 | `1963f9d8`/`01bbfb7d` | 弱化字 ≥4.5:1 转机械门禁；四档 P1–P5 全过 → 观感 verified |
| V2/V3/V4 收尾 | `d75444cb` | leftPanelWrap 合并、;; 清零、评分卡 3.6→4.1 |
| 形态语义层级 | `c3fcfe20` | seal3/icon10/card14 三档圆角，方/圆/环各有身份 |
| 国风水印（多轮） | `af9de2e1`→`abfeea76` | 从手绘 SVG→全局层→钢笔笔锋→**AI 出图原封不动**；当前 main 指向 AI 版 |

### 1.2 视觉链验收状态
- **UI-717 全量 verified**（静态面 round2 + 交互面 round3 + 四档整体观感）。
- 造型/水印的**审美**：按各包诚实标注为 `in_progress`（静态/截图只证结构，不代签）。
- accent `targetMet=false`：269 > 130，是"保留交互反馈"的裁决结果，非漏做。

### 1.3 全局产品工作（历史，非本轮）
§6.5 串行队列全清（P4-REM 最后）；NEXT-STAGE-EXPERIENCE-BLUEPRINT 八包全 completed；Q-MATRIX ~74/21/0/7。

---

## 2. 待办与未决（按严重度）

### 🔴 P0 — 工作区并发冲突（新的、最紧急）
- **现象**：另一进程持续把 `watermark.css`、`GlobalWatermark.tsx`、`cultural-watermark.cjs` 覆盖为「极简几何单线·候选1」版本；git 现读这三文件 `M`，我提交的旧 `acceptance/cultural-watermark/live/*.png` 被 `D`，对方另有 `live-minimal/`、`watermark-contract.test.ts`（`??`）。
- **影响**：`ui:audit:check` 因此红（有 UI 改动未同步台账）；两方案互相覆盖，最终版本不确定。
- **动作**：**需你确认**——停掉那个并发会话/agent，或明确最终留 AI 版还是极简版。我不能再单方面推进，否则继续互相破坏。

### 🟠 P1 — 待裁决 U 类（breaking，不裁不动）
1. **断点档位**：17 → ≤4 的具体数值 + JS/CSS 单源常量（`VISUAL-UPGRADE-PLAN.md:206`）。
2. **状态色家族合并**：`--petri-success`/`--petri-status-success`/`--petri-status-success-fg` 三套并存，合并属 breaking（`:207`）。
3. **目标分 4.4 是否采纳为门槛**（`:205`，11-11 标 U 类）。
4. **骨架随档 U 裁决**：`U-DECISION-MATERIAL.md` status 仍 `pending_user_ruling`（材料在，方案 B 已被用户裁决并执行，但材料 status 未 flip——可收口或归档）。
- 注：`sc-access-btn` 橙红=安全状态语义不随主题，已在 A4 标注边界；如需随和声走也属 U 类。

### 🟡 P2 — 存量红与健康债（非新引入，如实登记）
- `test:changed` 裸文件名错误（impact-map `ui-error-classification-stall` → `errorMessages.test.ts` 在 HEAD 就错）。
- `gate:user-assets` 把 tracked `scripts/backfill-artifact-chain.mjs` 判违规（HEAD 存量）。
- silent-catch（EVO-2 `lesson-store.js`）、code-size 指纹漂移等 HEAD 存量；A0 门禁账已逐条记录。
- 7 个 open/failed 后台任务（多为旧 build/wait 任务）。
- 工作区大量他包 WIP（block462/463 diagnostics、block503-outputs、stall、用户资产 `petri-logo-concepts*` 等）——零触碰。

### ⚪ P3 — 产品候选（需用户裁决+立项，不进串行队列）
C-35 分步引导应用面 / C-36 模型建议自动润色 / C-37 Workspace 权限与定价缓存 / C-38 E7 PiP / C-39 审批卡深度定位 / C-40 浏览器连接器 / C-41~C-44 reopen 四项；⛔ D-05 平台与外部条件。G1+ 项（Provider/公证/GA/packaged）不改。

---

## 3. 后续计划（按优先级递进，每条可执行）

| 序 | 动作 | 前置 | 产出/验收 |
|---|---|---|---|
| 1 | **解决并发冲突**：确认停哪个会话、留哪版水印；同步 UI 台账使 `ui:audit:check` 转绿 | 用户确认 | 工作区只剩一套水印真源，ui:audit 绿 |
| 2 | **裁决 3 个 breaking U 类**（断点/状态色/目标分），各出决策材料 | 用户逐条回 | 材料 + ruling，未裁不动代码 |
| 3 | **收口 U-DECISION-MATERIAL status**（B 已执行，材料 pending 不一致） | 2 或独立 | 材料 flip 或归档，消费测试同步 |
| 4 | **视觉审美复审**（造型/水印的"高级/国风"是否签字） | 用户给偏好标准或口令 | ≤3 轮预审或用户口令 → verified |
| 5 | **清 HEAD 存量红**（test:changed 裸文件名、user-assets tracked、silent-catch） | 单独立项 | 逐门转绿或如实降级 |
| 6 | 产品候选包（C-35~C-44）按用户裁决逐个启动 | 用户发令+立项 | 每包独立 closeout |

---

## 4. 当前门禁快照（现读）
- `docs:check` PASS(662) · `ui:audit:check` **RED**（并发 UI 改动未入台账）· `hygiene:check` PASS · `ui-a11y` PASS(32/32, 0 违规) · `c53 --check` PASS。
- 契约测试：各包 HK-01 绿（15+ 个消费测试在场）；TSC 0 error（最近复验）。

## 5. 边界
G0 开发期常态 · 不外推 packaged/Provider/GA；E 类人眼槽无裁决保持 in_progress 不代签；他包 WIP 与用户资产零触碰。
