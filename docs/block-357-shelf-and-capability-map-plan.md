---
capability: block-357-shelf-and-capability-map
status: completed
goal: 处置 352 遗留的 4 个 detour（需绕路）货架项，并产出面向使用者的能力地图（按任务组织、机器生成）。
acceptance:
  - 4 个 detour 逐项有直连路径或逐件下架裁决；矩阵更新且负测仍能判红。
  - 能力地图由矩阵自动生成、可复跑、纳入 docs:check，且不含超出 G0 边界的宣称。
  - closeout 16 门绿。
reopen: G1+ 第三方生态市场 / 远程技能市场；i18n / hooks；新增插件或技能；C-46 / G1 / O-1。
---

# BLOCK-357 — 货架 detour 与能力地图

- 批次总纲：`docs/next-batch-program-2026-11-05.md`；依据任务卡 B-2 + B-3
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## §1 立项依据

352 三货架 21 项全判定 **17A / 4D / 0S**（零空壳），但 4 个 detour 只有绕路步骤、无直连路径。评估报告 §3.6 另指出：文档全是工程向，**缺「当前能做什么」的用户向能力地图**——新用户/新会话无法快速判断能力边界。两者同属「可见性 / 可用性」收尾，合并一包。

## §2 范围

- 读 `acceptance/block-352/shelf-matrix.json` 与 `docs/block-352-shelf-report.md`，列出 4 个 detour 的具体卡点。
- 逐项处置：能给直连路径的补上（含可执行步骤与证据）；**不能的逐件下架或显式保留裁决**（不批量删、不为清零下架有用能力）。
- 更新矩阵与 `scripts/block352-shelf-audit.mjs` 判定逻辑；`test/block352-shelf-audit.test.mjs` 负测仍判红。
- 新建 `docs/capability-map.md`（**脚本生成，勿手改**）+ 生成脚本：从 `scripts/functional-surface-audit.mjs` 结果按**任务**组织（不按工具组织），输出「能做什么 / 需要什么条件 / 边界在哪」。
- 产出 `docs/block-357-report.md` + 证据 `acceptance/block-357/**`。

## §3 非范围

- 不新建第三方生态市场 / 远程技能市场（G1+）
- 不做 i18n / hooks、不新增插件或技能
- 不批量删除既有条目；下架需逐件裁决 + 迁移说明
- 能力地图不得宣称 GA / Provider / packaged 能力

## §4 验收

- 4 个 detour 逐项有终态（直连 / 下架 / 显式保留 + 理由），矩阵数值与报告一致
- `node scripts/block352-shelf-audit.mjs` 可复跑；造无判定条目仍判红
- `docs/capability-map.md` 可复跑生成，纳入 `docs:check`，无越界宣称
- `closeout` 16 门绿

## §5 门禁

`test/block357-shelf-and-map.test.mjs`（矩阵终态完整性、能力地图生成一致性、越界宣称拦截）、`docs:check`、`reconcile`、`quality:surface`、`knip`、`lint`、`closeout`；新文件登记 impact-map。

## §6 风险

- detour 卡点可能落在 pack 仓（C-46，本批排除项）→ 如实登记「依赖兄弟仓授权」，不伪造直连
- 下架可能破坏既有用户配置 → 逐件裁决 + 迁移说明
- 能力地图若手写会与矩阵漂移 → 强制脚本生成 + 一致性测试

## §7 DoD

4 项终态表 + 矩阵更新 + 能力地图生成器 + 报告落盘；台账回写；registry → completed；总纲 §5 填行；显式路径提交。
