---
capability: block-358-filetree-pagination
status: planned
goal: 对 C-47「文件树连翻页第二次点击惰性 / 回弹」做脚本化复现与根因判定；能归因则修复，不能则如实登记不硬修。
acceptance:
  - 有可复跑的复现脚本 + 明确结论（已复现 / 未复现 + 客观原因）。
  - 若已复现：给出根因（BLOCK-96 F2 分页 × BLOCK-110 软上限脏位图 / 面板轮询竞态是否成立）+ 修复 + 回归测试。
  - 若未复现：如实登记「观察未归因」，不硬改代码、不销票。
  - closeout 16 门绿。
reopen: G1+ 项；新增功能域；C-46 / G1 / O-1；未归因前不得立修复票。
---

# BLOCK-358 — 文件树分页归因（C-47）

- 批次总纲：`docs/next-batch-program-2026-11-05.md`；依据任务卡 A-4
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## §1 立项依据

`acceptance/block-349/block349-bigdir-live-darwin.json` B3 观察：首击游标 200→400 正常，其后单击不增长，且轮询收敛可把根列表重置回第 1 页；疑似 BLOCK-96 F2 分页与 BLOCK-110 软上限脏位图 / 面板轮询收敛竞态。backlog 明确「启动条件=人工复现归因后立票」——本包用**脚本化复现**替代人工，先拿事实再决定是否修。

## §2 范围

- 读 B3 证据与文件树相关实现（分页 API、软上限、面板轮询），列出候选竞态点。
- 写可复跑复现脚本 `scripts/block358-filetree-repro.mjs`：模拟连续翻页 + 轮询收敛，记录每次游标与根列表状态。
- 判定三态：**已复现且有根因** → 修复 + 回归测试；**已复现但未归因** → 登记根因候选清单，不硬修；**未复现** → 如实登记「观察未归因 + 环境/步骤差异」，不销票。
- 产出 `docs/block-358-report.md` + 证据 `acceptance/block-358/**`。

## §3 非范围

- 不重写文件树组件 / 分页架构
- 不在未归因前做「猜测性修复」
- 不碰 C-46 / G1 / O-1，不新增功能域
- 不改 349 已终态化的 UI 证据

## §4 验收

- 复现脚本可复跑，输出每次点击的游标与根列表状态
- 结论三态之一，带证据；「已复现且有根因」时须有修复 + 回归测试 + 负测
- 未复现时 backlog 的 C-47 状态保持原样（不销票、不改启动条件）
- `closeout` 16 门绿

## §5 门禁

`test/block358-filetree-repro.test.mjs`（脚本可跑、结论 schema 合法）、`quality:surface`、`quality:types`、`quality:lint`、`docs:check`、`ui:audit:check`（若动前端）、`closeout`；新文件登记 impact-map。

## §6 风险

- GUI 交互竞态可能无法在 headless 脚本中复现 → 属预期结果，如实登记即可，不算失败
- 猜测性修复会引入回归 → §3 明确禁止
- 若复现需真实大目录（500+ 文件）→ 用 349 既有 fixture 或脚本生成，不依赖人工

## §7 DoD

复现脚本 + 三态结论 + 报告落盘；按结论决定是否修复；台账回写；registry → completed；总纲 §5 填行；显式路径提交。
