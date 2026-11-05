# BLOCK-357 收口报告 — 货架 detour 与能力地图

- 日期：2026-11-05
- 依据：`docs/block-357-shelf-and-capability-map-plan.md` / `docs/next-tasks-2026-11-05.md` B-2 + B-3
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## 1. 四个 detour：逐件裁决，不伪造直连

复核 `acceptance/block-352/shelf-matrix.json`：21 项 `17 available / 4 detour / 0 shell`。四个 detour **全部是外部依赖**，本仓无直连修复路径：

| 插件 | 卡点 | 裁决 | 清偿触发 |
| --- | --- | --- | --- |
| `sample-metadata-validator` | demo 输入组合与生产形态差异，脚本 `Process exited with code 1` | `keep-with-detour` | 插件仓修脚本与 demo 输入后真跑通过 |
| `go-kegg` | `r-enrichment` capability bundle 下载 HTTP 404 → `provision_failed` | `keep-with-detour` | bundle 可下载且 provision 成功 |
| `gsea` | 同上（同源） | `keep-with-detour` | 同上 |
| `deseq2` | pack 仓 R 脚本语法错（**C-46**），兄弟仓不在本仓工作区 | `keep-with-detour` | C-46 获 pack 仓授权并修复 |

裁决落 `acceptance/block-357/detour-rulings.json`，每条含理由、绕路步骤、清偿触发条件、复判时点、关联票。

**如实声明**：本包**未把 4D 清零**（`directPathCreated=0`、`removed=0`、`downgradedToShell=0`）。计划 §4 曾以「矩阵 21A/0D/0S 或每个 D 带裁决」为验收，取后者——逐件保留并写清触发条件。不批量下架、不为清零删有用能力（总纲 §7）。零空壳保持。

## 2. 用户向能力地图（生成器，非手写文档）

- `scripts/block357-capability-map.mjs` → `docs/capability-map.md`（**自动生成，勿手改**）
- 数据源：`acceptance/functional-audit-2026-11-04/surface-matrix.json`（115 工具 / 168 IPC / 285 路由）
- 按**能力域**组织（17 个域），不按工具名罗列；含「使用条件」（访问档 / 审批 / 平台 / 外部资源）、「已知限制」（矩阵 P1/P2/P3 实时数值）、「怎么查更细」
- 确定性输出（只用 `matrix.generatedAt`，不取当前时间）→ 可复跑比对
- 越界宣称守卫 `assertNoOverclaim`：拦截「可发布 / 已发布 / GA 可用 / Provider 矩阵已验证 / 对外服务可用」

## 3. 当次证据

`test/block357-shelf-and-map.test.mjs` **8/8 绿**：

- 裁决集合与矩阵 detour 集合完全一致（不漏项）
- 每条有理由 / 绕路步骤 / 清偿触发条件，且 `removed=0`
- 零空壳保持（`17A/4D/0S`、`allJudged=true`）
- 生成器确定性、覆盖全部 17 域且数字来自矩阵、G0 边界声明在场
- **负测**：越界宣称被守卫拦截
- **负测**：磁盘产物与生成器输出一致（防手改）

## 4. 门禁

`docs:check` · `docs:reconcile` · `quality:surface` · `quality:ear` · `quality:perf` · `knip` · `types` · `lint` · `closeout` 16 门。

## 5. DoD

4 条裁决 + 能力地图生成器 + 产物 + 报告落盘；台账回写；registry → completed；总纲 §5 填行；显式路径提交。**未启动 G1、未碰 C-46 / C-47 / O-1。**
