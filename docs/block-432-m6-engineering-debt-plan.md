# BLOCK-432 · M6 工程债务与体验（A–F 六组，组内串行）

> 前置：M5=BLOCK-431 completed（8 项判据层 done / 生产接线 done-partial）。唯一审计输入：
> `acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md` §4-M6 / §2 各维发现。
> 用户 2026-11-11 预授权连续工作裁决（见 `docs/m-blueprint-2026-11-11-program.md`）。

## 组内串行约定

本包是 M6 唯一 active work-package；A→B→C→D→E→F 六组**按序逐组收口**（同一时间只有一
组进行中），每组各有当次证据与逐件终态，落在 `acceptance/m-blueprint-2026-11-11/m6/<组>/`。

## 六组范围与边界

| 组 | 改进点 | 映射 | 本包交付 / 边界 |
| --- | --- | --- | --- |
| A 结构单源 | IPC 三真相、28 文件绕桥迁移、resolveDataDir/readConfig 单源、12 环逐环消亡、三矩阵共用 schema | M-17/M-21/M-22/M-23/M-70 | 三矩阵共用 schema **只读对账门** + IPC 三真相只读视图；迁移/消亡标 `done-partial`（涉及跨模块重构与拆前拆后同套绿基线） |
| B 巨型文件 | SimpleChat / tools-executor / project-workspace / scene3d 逐刀拆（每刀 ≤−100 行） | M-15 | 本包**零拆分**，登记 `W` + `done-partial`：4 个文件虽非在制 WIP，但拆刀须逐会话带 BLOCK-92 拆前拆后同套绿基线，且 `code-size` 锚点重打属基线动作；不提前批量改 |
| C 静默与日志 | 412 静默 catch 扩口径 + 分域下降表、console 分级与渲染层脱敏 | M-16/M-19 | **只读**分域下降表（按 `test/silent-catch-baseline.json` 现取，零改写基线）+ 分级/脱敏判据（复用 M5 `redactLog`） |
| D 体验 | focus-visible 12 文件/16 声明清零、断点消费面、设置页剩余分区、对比度观感路线 | M-24/M-41/M-43/M-44 | CSS/设置面板均属在制 WIP ⇒ **W 类零触碰**；自动生成 E 类人眼测试路线，保持 `pending_human_eye`，不代答 |
| E 功能可用 | 165 通道逐件分诊、browser_act / worktree_remove / 默认执行目标、P3 存储键、capability-map evidence-tier | M-01～M-05 | **只读**逐件分诊表（依 `surface-matrix.json` 现取，保留 owner，零改写台账）+ 结构/行为双列判据；真消费接线标 `done-partial` |
| F 文档与依赖 | docs/README 分类导航、4 套 ledger 视图、Skill 清单统一、workspaces 评估、typescript U 类材料 | M-25/M-29/M-60～M-67 | README 分类导航材料 + Skill 清单一致性只读对账 + typescript 双版本 **U 类决策材料**（`pending_user_ruling`，不改默认） |

## 关键工程裁决（逐项留痕）

- **零放宽基线**：`eslint-suppressions` / knip 330 / silent-catch 412 / code-size 86605 / arch-cycles 12 /
  perf / EAR / UI 台账 debt 35 全部不重打、不上调、不缩分母。组 C/B 只出只读视图与材料。
- **W 类零触碰**：89 M + 68 ?? 在制 WIP（含 `frontend/src/App.tsx`、多个 `.module.css`、
  设置面板、`acceptance/ui-design-assessment-2026-11-11/`、`assets/`）逐件登记 owner 归属，
  零触碰、零 stage、零提交。组 D 的 CSS/focus 与组 B 的 `project-workspace` CSS 邻近面尤其守住。
- **U/E/V/W 不代答**：typescript 双版本、ADMISSION、FK、虚拟列表依赖等出决策材料且状态
  `pending_user_ruling`；22 条人眼与对比度观感自动生成测试路线且 `pending_human_eye`；
  CVE 联网与真实 Provider `external-blocked`；在制 WIP 登记 owner。
- 不改 `MAX_AGENT_ITERS=Infinity` / `workspace_exec` 默认放行 / ADMISSION / FK / MCP 计量 /
  主题 / 中栏既有裁决；零新增依赖；零 G1+ 外推。

## 验收门

- `node scripts/m-blueprint-m6-debt-gate.mjs --check`（六组判据 + 植入必红负测）。
- `node --test test/m6-engineering-debt.test.mjs`（HK-01 红→绿）。
- `npm run gate:arch-cycles` / `gate:code-size` / `gate:silent-catch` / `quality:knip:check` /
  `skills:check` / `docs:check` / `ui:audit:check` / `closeout`（读数如实）。

## 完成语义

六组各有当次证据、逐件终态与零放宽/零撤销裁决/零新增依赖才标 completed；
未达证据上限项标 `done-partial` / `W` / `U` / `E` / `V` + 补腿条件，M7 gap-ledger 终态化，
不用文档措辞升级运行时结果。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 收口笔录（2026-11-11 · BLOCK-432 / COMPLETED，六组终态均 done-partial / W / U / E）

**交付（A→F 组内串行）**：六组全部为**只读视图 / 判据 / 决策材料**，零改写基线。A 三矩阵共用 schema 只读对账 + IPC 三真相视图（168 通道现取）；B 4 个 >1000 行巨型文件只读清单、零拆分；C 静默 catch 分域下降表（412 处 / 102 文件可复算）；D W 类零触碰 + 4 步人眼测试路线（`pending_human_eye`、签字槽全空）；E 168 通道逐件只读分诊（结构·行为双列）；F U 类一页材料（`pending_user_ruling`、不改默认）+ Skill 清单只读对账。HK-01 9/9；`gate:m6-debt` PASS 0 issues；lint 0；逐组证据=`acceptance/m-blueprint-2026-11-11/m6/<组>/`。

**门禁实况（不写全绿）**：`docs:check` 577 / `ui:audit:check` / `gate:code-size` / `gate:arch-cycles` / `gate:silent-catch` / `quality:knip:check` / `skills:check` 七门当次全绿；`test:changed` 1497 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；`closeout` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：`silent-catch` 412 / knip 330 / code-size 86605 / arch-cycles 12 / UI debt 35 / perf 基线全部零改写；`surface-matrix.json` 起始即在制 WIP（M），本包只读；4 个巨型文件 git diff 0 行；零新增依赖 / 零触碰在制 WIP / 零 stage 零提交 / 零撤销既有裁决 / 零 G1+ 外推。

**六组终态（无一组冒充 done / verified）**：A/C/E/F `done-partial`、B `W + done-partial`、D `W + pending_human_eye`、F 含 `pending_user_ruling`。U/E/V/W 四类逐件在册、不计入完成数，M7 gap-ledger 终态化。补腿条件逐组见 `m6-evidence.json:groups[].closureCondition`。

**六维度评审**：无 P1；六组终态如实登记，未用文档措辞升级运行时结果。ocr 本轮未做（可选外部工具、未装/未配置），按 skill 降级如实声明。

**证据**：`acceptance/m-blueprint-2026-11-11/m6/`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
