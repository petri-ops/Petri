# BLOCK-511 · S5 入口归位证据（2026-11-24 · 纯文档）

## 子项

- **5.1** `AGENTS.md` 删除 14 处会漂移规模数字（72 个 .js / 686 行 / 84k / 162 个 / 317 个 / 1664 行 / 1300+ 项 / 十一门等），改为现读命令（`find | wc -l` / `wc -l` / `npm run closeout` 输出）。`frontend/AGENTS.md` 修正 7 处不存在路径（删除 single-cell/spatial/figcode/admin/mdx 旧树、copilotContext.tsx→.ts、single-cell/_store.ts→conversationRunStore.ts）。纪律条文零改动。
- **5.2** `docs/next-steps-roadmap.md` 末尾指针改指 `remaining-work-plan-2026-11-23.md`；`DOC-REGISTRY.json` 中 REMAINING-WORK-PLAN kind `reference→living-plan`；`npm run state` 现列出该常驻计划。过期「串行 active=BLOCK-454」表述随历史链搬移归档，现文不再含。
- **5.3** 新增 `scripts/roadmap-compact.mjs`（复用 handoff-compact-core 的 compactHandoffLines + audit-log-compact 的 chooseArchiveTarget，幂等；`npm run roadmap:compact`）。现读：`roadmap:compact` 85 条、`handoff:compact` 57 条历史链原文搬移到 `docs/archive/checkpoints/next-steps-roadmap-through-2026-11-21.md` / `project-workspace-handoff-through-2026-11-21.md`（零改写）；两现文各只留最近 1 条。
- **5.4** 根 `README.md` 定位段对齐 BLOCK-339 钉死人设一句话；Quick Start 对齐 BLOCK-457 唯一入口（Electron main 自起后端，禁双 spawner）；版本表述改「G0 开发期，版本以 package.json 为准」；门数改现读命令。`CHANGELOG.md` 顶部补 Unreleased 指向 `docs/README.md` 与 `DOC-REGISTRY.json`。
- **5.5** `docs/AUDIT-LOG.md` 当前待处理项表头后补分隔行、最近处理记录补表头+分隔行、移除错位分隔行（纯格式）。`npm run state` 与 `npm run audit:compact` 解析正常（compact 淘汰 3 行链+1 行记录，表格结构完好）。

## 出口门禁

- `docs:check` PASS(666) / `ui:audit:check` PASS / `hygiene:check` PASS。
- docs:check 曾因 roadmap compact 后两个 registry entrypoint 文档失去直链而红；已在 roadmap 补「历史执行入口」直链（非当前指针），复验绿。

## 决策工具

- `test:suggest -- --supply=cloud`（S5 规划前）：suggestions=[]（零建议）。
- `doc:suggest -- --supply=cloud`（S5 台账回写前）：suggestions=[]（零建议）。
