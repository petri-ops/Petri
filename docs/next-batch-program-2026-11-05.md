---
capability: next-batch-program-2026-11-05
status: reference
goal: 把 docs/next-tasks-2026-11-05.md 的 8 项精准任务一次性编排成 4 个可自动推进的串行 BLOCK，并明确 3 项客观排除项；立项后逐个推完，中间不需要用户逐项确认。
acceptance:
  - 4 个包各有标准计划、registry 条目、README 入口、backlog 队列行与 impact-map 预登记。
  - 每包按「范围→实现→测试→门禁→台账回写→提交」闭环，不中途询问。
  - 排除项如实登记原因，不伪造完成、不擅自启动 G1。
reopen: C-46（pack 仓，兄弟仓不在工作区）、G1 启动（需显式发令）、O-1 屏幕观感（人工实机）、MCP 档位协商、外部请求审计。
---

# 第二批更新计划（2026-11-05 · 一次性编排）

- 依据：`docs/next-tasks-2026-11-05.md`（C-48 更新后精准任务卡，8 项）
- 用户发令原话：「直白一点说，有几个 block 要做呢，能否一次性安排好，逐个推完，中间不用问我意见」
- **本条即批量开工授权**：4 个包串行推进，包内不逐项确认；只有遇到「客观不可得」才如实登记并继续下一个包
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

---

## §1 直白答案：4 个 BLOCK

| 序 | 编号 | 名称 | 承接任务 | 主要产物 |
| --- | --- | --- | --- | --- |
| 1 | **BLOCK-355** | 上下文裁剪原子性（C-45） | A-1 + T7 回归 | `message-trimmer` 修复 + 契约测试 + T7 复跑 |
| 2 | **BLOCK-356** | 通用任务套件 v2 | B-1 | T3 判据、headless 浏览器链、T7 纳入回归 |
| 3 | **BLOCK-357** | 货架 detour 与能力地图 | B-2 + B-3 | 4 个 detour 直连、用户向能力地图生成器 |
| 4 | **BLOCK-358** | 文件树分页归因（C-47） | A-4 的归因部分 | 复现脚本 + 根因判定 + 修复或诚实降级 |

执行顺序固定：`355 → 356 → 357 → 358`，单包串行，每包收口后自动进下一个。

## §2 三项排除（客观不可自动完成，如实登记）

| 项 | 原因 | 处置 |
| --- | --- | --- |
| **C-46 pack 仓两件**（A-2） | `plugins/deseq2/scripts/deseq2.R` **不在本仓**；兄弟仓 `gewu-pack-bio` 不在工作区（已核实 `ls`/`find` 均无）。属兄弟仓授权范畴，不在本仓 `touchSurface` | 保留 backlog 待授权，不伪造修复、不创建假仓库 |
| **G1 启动裁决**（A-3） | 阶段跃迁，红线明确要求**用户显式发令**；且建议 C-45 收口后再裁决 | 本批最后复算 readiness 并输出结论，但**不启动 G1** |
| **O-1 屏幕观感 / 点击体感** | C-48 修复后进程级实机全绿，但 UI 观感不是自动化能判的 | 保留人工观察项，不立包 |

另：C-47 的「人工复现」在本批由 BLOCK-358 用脚本化复现替代——能复现则归因修复，不能则如实登记「未复现 + 原因」，不算失败也不硬修。

## §3 每包统一协议（照此执行）

```
① 读本包 plan + npm run state + git status
② node scripts/functional-surface-audit.mjs --check   # 新增 P1 阻断
③ registry planned→active + AUDIT-LOG 启动登记
④ 按计划 §2 范围实现，§4 验收逐条留当次证据（acceptance/block-3XX/）
⑤ 新增文件登记 test/impact-map.json；按总纲 §2.4 同步 sharedBaselines
⑥ 全门禁：docs:check / reconcile / ui:audit:check / quality:surface /
   quality:ear / quality:perf / knip / types / lint / closeout
⑦ canonical 回写：registry active→completed、README、roadmap、backlog、
   AUDIT-LOG 收口行、本总纲 §5 台账
⑧ 显式路径 git add（不用 -A）+ 提交
⑨ 自动进入下一包
```

红线（沿用 `docs/next-phase-program-2026-11-05.md` §7）：不扩范围、不新增功能域、不造无用 UI、不放宽检测口径凑数、不硬造成功、不复用旧清单、不做 G1+、不复活已取消四项、状态词白名单、收口必回写。

## §4 门禁基线（开工时）

`closeout` **PASS 16 门** · 矩阵 P1=0/P2=0/P3=2 · EAR 43.4% · readiness 6/6 · HEAD `a8796ed7`。

## §5 进度台账（每包收口填一行）

| 包 | 开工 | 收口 | 关键证据 | closeout | 备注 |
| --- | --- | --- | --- | --- | --- |
| 355 | 2026-11-05 | 2026-11-05 | `acceptance/block-355/t7-rerun-c45-fix.json`（T7 completed）+ `test/block355-trimmer-atomicity.test.mjs` 6/6 | PASS 16 门 | C-45 三层修复；全套重跑归 356 |
| 356 | — | — | — | — | planned |
| 357 | — | — | — | — | planned |
| 358 | — | — | — | — | planned |

---

*本总纲与 4 份计划是批量开工授权范围内的执行依据；G1 启动、pack 仓授权、人工观感确认仍属排除项。*
