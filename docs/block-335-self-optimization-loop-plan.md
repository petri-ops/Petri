---
capability: block-335-self-optimization-loop
status: planned
goal: 自优化闭环 v1：让 Petri 的 agent 对 Petri 自身仓库（worktree 副本）做小改动后，自己跑验证门禁 → 结构化判定 ready/blocked/failed → 失败自动回滚 checkpoint；执行载体=工作流脚本（宿主侧注入 verify/checkpoint 原语），验证=evals-harness 隔离后端 + test:changed --report JSON，回滚=workspace-checkpoint 共享层（新增 petri-server 薄 REST）；放权坡道 observe 档护航首批任务。
acceptance:
  - P1 基座补齐：workspace-checkpoint 加 petri-server 薄 REST（create/rollback/list，ref 持久化进 journal 而非仅进程 Map）+ 工作流宿主侧 `verify` 原语（直 require test-affected `--report` JSON + evals-gate 报告，映射 loop 词汇 complete|block|wait → ready|blocked|needs_restart）+ `checkpoint` 原语。契约测红绿。
  - P2 闭环脚本：`resources/workflows/self-optimize.mjs`（phase：checkpoint → agent 改动 → verify → 判定 → 失败 rollback / 成功留改动）+ 预算硬顶（maxAgents/maxSteps/timeout）+ journal 每 phase 落 ref/报告路径。dryRun 预估可跑。
  - P3 自指隔离：项目 workspace_path 指向 Petri 仓库 `git worktree` 副本（worktree-governance §3～§8 重开条件由本包触发并走正式流程——不临时另立简化流程）；改动域 v1 限定「不需重启即可验证的面」（scripts/ test/ frontend vitest evals 判据），需重启的面判 `blocked(needs_restart)` 如实留人工。
  - P4 实机：隔离后端 + mock provider 跑一个真实小任务（如 lint 清偿/文档回写）全链：checkpoint→改→verify 绿→保留；再跑一个故意注入失败的任务：verify 红→自动 rollback→工作树与 checkpoint 树逐字节一致。证据落 acceptance/block-335/。
  - P5 放权坡道护航：首批自优化任务的 exec/write 走 observe 档（BLOCK-323 复盘面可见每一步"本可自动执行"），复盘后人工升级；closeout + 台账回写。
reopen: 需重启面的自重启能力（headless petri-server 无自重启 REST；Mac restart-dev-stack 等价脚本待补）；LLM-as-judge 质量读数接入判定（evals --judge real 模式需 Jev 密钥）；多任务队列/自动选题（v1 只做人工给题的单任务闭环）。
---

# BLOCK-335-SELF-OPTIMIZATION-LOOP — 自优化闭环 v1 计划

- 立项裁决：用户 2026-11-02「立项 自优化闭环」（承接同日问答「当前的 petri 可以用来优化自己吗」）
- 登记状态：**planned**（BLOCK-334 结果宿主统一 active 在制；单工作包串行纪律——334 收口后本包顶队列头发令，不并行）
- 唯一真相域：本文件（block-335-self-optimization-loop）
- 文件面隔离：本包触碰 core/petri-server 的 workflow/checkpoint/routes 与 scripts/、resources/workflows/、test/；与 BLOCK-334 的前端 work-surface/workspace-panels 域零交叠。

## 1. 定位（立项自检问句）

ZCode/Codex 改自己的仓库和改任何仓库没区别——不知道改坏了没有。Petri 的差别形态：**改动 → 验证 → 结构化判定 → 回滚**是一条本地可审计的闭环（journal 血缘每 phase 留 ref 与报告路径），且首批任务走放权坡道观察档——"让 agent 改自己"这件最需要信任的事，恰好用 Petri 刚建好的信任机制护航。不建第二执行器：agent() 唯一经 launchSubAgent，验证经既有 evals-harness/test-affected，回滚经既有 workspace-checkpoint。

## 2. P0 勘察结论（2026-11-02 子代理只读探查，接口已锚定）

| 基座 | 现状 | 本包动作 |
| --- | --- | --- |
| evals-harness | `spawnIsolatedBackend({root,tmpDir,mode})`→隔离后端；`runGoldenTask` 17 种确定性判据；`evals:gate` exit 0/1/2 | 复用，不改 |
| test:changed | `--report <path>` 写 schema 校验 JSON；exit 0/1/2（2=未映射≠fail-closed） | verify 原语消费 JSON；exit 2 映射 blocked |
| closeout | fail-fast 聚合器，无 JSON（stdio inherit） | v1 不进闭环（各子门禁 JSON 面已够）；收口仍由人工/closeout 跑 |
| workspace-checkpoint | `createCheckpoint/rollbackToCheckpoint/listCheckpoints`，plumbing 无副作用；**仅 Electron IPC 面**；登记表=进程内存 Map | 加 petri-server 薄 REST；ref 持久化进 journal，回滚显式传 ref |
| workflow-runner | 六原语 + phase/resume/journal/预算；沙箱禁 require/fetch；默认 503 需 `PETRI_WORKFLOW_ENABLED=1` | 宿主侧 deps 注入 `verify`/`checkpoint` 原语（照 `recipe` 先例）；闭环期间开 env |
| goal | 无自驱动循环（schedule 预算闸） | 不作载体；可挂预算 |
| 终态词汇 | loop `decision∈complete|block|wait`；judge `PASS/RETRY/ESCALATE` | 判定器复用，不造新词 |
| 自指 | createProject 接受任意 workspace_path，无禁自指校验；`.git` 为敏感段天然隔离对象库；后端无自重启 REST | worktree 副本 + 隔离后端验证 + 只改不重启 |

## 3. 红线

- 不建第二执行器/第二验证器/第二快照机制；不在 agent 正文里自报 ready（结构化对账，agent-reconciliation 教训）。
- 改动域 v1 排除需重启面；worktree 创建严格走 worktree-governance §3～§8（本包即其重开条件成立点，需用户确认重开）。
- 首批任务 observe 档；不自动选题（人工给题）；预算硬顶；失败回滚后工作树与 checkpoint 树逐字节一致为验收。
- G1+ 不外推。

## 4. 撞裁决点（发令前须定）

1. **worktree 重开**：worktree-governance 休眠纪律的重开条件由本包触发——需用户确认"为自优化闭环重开 worktree 纪律"。
2. **首批任务清单**：v1 人工给题；建议首题=lint 存量收缩一批（低风险、可机械验证）。
