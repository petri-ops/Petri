---
capability: block470-prompt-mechanization-handoff-compact
status: completed
kind: work-package
truthDomain: block470-prompt-mechanization-handoff-compact
entrypoint: docs/README.md
goal: 治理批（无产品代码）——T1 把方案 A 的「阶段收口自动落档下一阶段提示词」从 skill 纪律勾选项升为机械档（生成器脚本 + package.json 接线 + closeout --report 报告级 + HK-01 负测）；T2 优化 project-workspace-handoff.md 结构（头部历史 30 条链搬移归档、只读最近一次、正文快照刷新），仿 audit:compact 但新增 ｜ 拆分逻辑
acceptance:
  - HK-01 红绿先行（治理批工具负测即红绿证据）：生成器纯函数负测（幂等/继承边界/红线守住）+ handoff compact 纯函数负测（拆分/搬移不改写/幂等）先红后绿
  - T1：脚本读蓝图 canonical + 上一批提示词 + next:suggest advice，机械落档下一阶段提示词草案；仅 advice、不自动发令；接 closeout --report（非阻塞、不打退出码）；skills:check 不覆盖（Agent skill 资产）如实登记
  - T2：handoff 头部只保留最近 1 条交接信息（+最近 N 条链窗口），历史按 ｜ 拆分原文搬移 docs/archive/checkpoints/project-workspace-handoff-through-<日期>.md（搬移不改写、幂等）；正文快照刷新到现读；30→<10 条、体积显著下降
  - 引用面零破坏：g0 全文正则文本已不存在（核实）、两个历史脚本锚点已失效（核实）、README entrypoint 直链保留、registry 登记不变（path 不动、archive/ 排除在 managed 计数外）
  - 收口：docs:check + hygiene:check + closeout 定向全绿（perf 继承抖动 SKIPPED 如实）+ 六件套回写；零产品代码/依赖/观感代签
---

# BLOCK-470 · 提示词机械档 + Handoff 结构优化（completed / GOV-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18「补强方案 B + handoff 太大能否优化为只读最近一次」。
> **从属**：`docs/next-phase-e2e-prompt-2026-11-18-b2.md`（方案 A 基线）+ `petri-project-governance/references/NEXT-PHASE-PROMPT-HANDOFF.md`（规范 canonical）+ `scripts/audit-log-compact.mjs`（T2 自稳先例）。

## 1. 范围（scope）

**T1 · 提示词自动落档机械档**
1. 新增生成器脚本（建议 `scripts/next-phase-prompt.mjs`）+ 纯函数（如 `deriveNextPhaseDraft(inputs)`）：
   - 输入现读：`npm run state` 输出 / `docs/AUDIT-LOG.md` 头部 / 最近一份 `docs/next-phase-e2e-prompt-*.md` 的 §2 正文 / `npm run next:suggest -- --supply=cloud` 的单一建议；
   - 输出：`docs/next-phase-e2e-prompt-<date>-bN.md` 草案骨架（frontmatter + §1 盘点 + §2 七要素正文 + §3 配套），**仅 advice、不自动发令**；
   - 边界：预置裁决只继承未消耗 R 项（新裁决点标 `pending_user_ruling` 列用户动作清单）、观感零代签、计数现读不编造；
   - 幂等：目标文件已存在则不覆盖（或按约定 `-bN` 递增），不制造重复草案。
2. `package.json` 新增 `next:prompt` 脚本 + `closeout` 追加 `--report next:prompt`（报告级，非阻塞，不打退出码）。
3. HK-01 工具负测先红后绿（子进程隔离或纯函数直测）：幂等 / 继承边界 / 红线守住（观感不代签、新裁决不写 R）/ 缺输入 external-blocked 归因。

**T2 · Handoff 结构优化**
1. 新增 `scripts/handoff-compact.mjs` + `npm run handoff:compact`：
   - 从 `scripts/audit-log-compact.mjs` import `chooseArchiveTarget`（搬移不改写、脏文件重定向先例），**不改该文件一个字**（保 AUDIT-LOG 契约测试绿）；
   - 自写纯函数：把头部 `最后更新：...｜最后更新：...｜（...）` 巨行按 `｜` 拆条目（`:6` 单行 14943 字符 / 共 30 条），保留最近 1 条（+可选最近 N 条窗口），淘汰条目**原文**追加 `docs/archive/checkpoints/project-workspace-handoff-through-<被剪最新日期>.md`；
   - 幂等：无淘汰不改文件；`---` 与正文锚点（恢复顺序 / 当前事实快照 / 待办分类）原样保留。
2. 执行 compact：活跃 handoff 头部收敛为最近 1 条、正文快照从 2026-11-16 刷新到 2026-11-18 现读（S1-S5 全收口 + 方案A落地，按 handoff 既有格式写）。
3. 引用面核对（已探查）：g0 全文正则文本 HLE-C0/G0-START/LF0 在活跃文件 count=0（本就恒不满足，非本包破坏）；m-blueprint-stage-writeback 字面锚点已失效；post-h9「第一行前插」兼容（保留头部至少一行）；README :392 直链保留；registry path 不变、archive/ 排除在计数外。

## 2. 非范围（exclusions）
- 产品代码 / UI 写面 / 观感签字；改 AUDIT-LOG 契约或 audit-log-compact.mjs 本体；C-53 P2 起阶段推进；新依赖；G1+。
- 不自动发令任何 work-package；不改 registry 的 `lastUpdated`（docs:coverage 单写入者）。

## 3. 验收门禁与证据
- **G1 红绿**：T1 生成器负测 + T2 compact 负测，各先红后绿（HK-01 治理批判据侧证据）。
- **G2 机械档**：`next:prompt` 派生草案可复现、仅 advice；closeout 摘要含 next:prompt 报告行且不改退出码。
- **G3 结构**：handoff 头部 ≤ N 条、体积显著下降（30→少量）、archive 归档原文逐条在场、正文快照现读、docs:check（entrypoint 直链/计数）绿。
- **G4 治理**：closeout 定向 + 六件套回写 + 证据落 acceptance/block470/。

## 4. 完成语义
G1–G4 全绿 + 六件套 + 证据落盘。零产品代码/观感/基线放宽。perf 继承抖动 SKIPPED 如实标注不算 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口记录（2026-11-18）

T1 红→绿 6/6 + 报告级实跑（继承 7 条 R 项、仅 advice、零落盘）；T2 红→绿 7/7 + 头部链 35→1 条（34 条归档）、活跃 27KB→9.9KB、快照刷新 11-18；干跑抓真链区多行 bug 已修。docs:check(624)/hygiene 绿。证据=acceptance/block470/。零产品代码/观感/发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。
