# BLOCK-449 · M 程序 9223 实机补腿 + 干净树三连收口（plan）

> 发令链：用户主控提示词 v1.0（一次性完整发令与预授权裁决，全程自主推进）+ AGENTS.md「预授权连续工作除外」+ Jev 不可用（`jev_unavailable:http_error:cloud`，2026-11-14 当次）确定性兜底。
> 队列对账：POST-H9 K0–K7 已由 BLOCK-396～403 收口（registry notes 明载）；竞争力纲剩余 CP 项与母纲剩余 🟡 均 U 类待裁决；BLOCK-448 P6 补腿 external-blocked（`r-enrichment` bundle HTTP 404，2026-11-14T10:47:48Z probe 复证）。
> **本包 = canonical 真相当下唯一既非 U 类、又非外部阻塞的可执行未达项：M7 §8 第 3/5 条补腿**（`acceptance/m-blueprint-2026-11-11/m7/m7-evidence.json` fiveItems M7-3 / M7-5 closureCondition）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围

| 任务 | 内容 | 对应 M7 尾巴 |
| --- | --- | --- |
| T1 | 干净树 `test:changed` 当次跑；历史三红（UI-629 W / block414 环境 / P6 W）重归因；确定性红修根因+回归断言 | M7-5 closureCondition 前置 |
| T2 | 新建 dev-verify flow：9223 离屏实例崩溃注入→重启→resume 消息序列/工具调用数逐字对齐（禁 `PETRI_TEST_ONSCREEN`，跑完立即 kill） | M7-3 实机腿（M2-live closureCondition 原文即要求 dev-verify flow 形态） |
| T3 | `npm run closeout:full` 三连，逐门读数落盘；red 逐门四类归因+处置 | M7-5 本体 |
| T4 | canonical 回写（registry/AUDIT-LOG/roadmap/handoff/M 台账增量/README 入口）+ 主控交付包 + 决策留痕 | 治理契约 |

## 2. 非范围（exclusions）

- P6 pressure 腿 / `g0:result-studio:p6:update` 重采（external 404；补腿条件维持原册，probe 时间线在 `acceptance/block-449/s0-fact-baseline.json`）。
- M2-4-db `UNIQUE(task_id,seq)` 约束（需 owner 按全量证据流程重采 perf 基线，另案）。
- G1+ 阶段一切事项；产品行为语义变更；新增依赖。
- 12 项 untracked 用户资产与受保护原件（post-h9 蓝图原件、M 程序 FULL-AUDIT/EXECUTION-PROMPT 原件）——零触碰、不提交。
- `tmp-block342-live/`、`tmp-review/` 临时残留清理（hygiene 报告项，非本包资产）。

## 3. 红线

- 零新增依赖；零放宽基线；零改既有裁决与默认语义；TS strict；渲染层 IPC 必经 `desktopBridge.ts`。
- WIP 零触碰；收口逐路径显式枚举提交，禁 `git add -A`。
- 实机：不开可见窗口；`:3000` vite + `:3001` 后端无窗栈；实机腿只在 9223 离屏跑，禁 `PETRI_TEST_ONSCREEN`，跑完立即 kill；截图失败如实标 `screenshot_unavailable`。
- 证据五类不互冒充；未跑/跳过/复用/超时如实标注；`exit 124/125 = unknown`；绝不把 SKIP/unknown 写成 PASS/verified。

## 4. 验收门禁（收口对账清单）

1. `npm run test:changed` 当次 0 未解释红（每红四类归因+处置）。
2. 新 flow 注册契约测试绿 + flow 实机执行逐字对齐 PASS。
3. `closeout:full` 三连逐门读数在册；exit 0 或每 red 归因处置。
4. `npm run docs:check` PASS + `npm run docs:reconcile` 0 issues。
5. 交付包自核脚本 0 missing；`npm run decision:session` 当次双数字。

## 5. 证据位置

- 主控交付包：`acceptance/block-449/`（s0…s5、CLOSEOUT.md、DELIVERABLES.md、evidence/）。
- M 程序侧增量证据：`acceptance/m-blueprint-2026-11-11/m7/` 下新文件（不改写 M7 原档）。

## 6. 完成语义

- 全部门禁达成 → registry `completed`（若 T2/T3 有环境类未达项则终态 `done-partial` + closureCondition 如实登记，不冒充）。
- M 程序 M7-3/M7-5 的终态随本包证据更新（M 台账精确增量行指向新证据，不改写原 fiveItems 判断的历史档）。

## 7. 节奏

一次会话收口（T1→T2→T3→T4 串行）；每任务收口过 S3.1–S3.7 自检。
