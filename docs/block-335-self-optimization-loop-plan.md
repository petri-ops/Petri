---
capability: block-335-self-optimization-loop
status: completed
goal: 任务推进闭环 v1（用户裁决 2026-11-02 升级定位：「自动推进任务需求，用户只验收结果」；改自己是第一个用例）：判据驱动的驾驶员——loop 每轮 decision 不再只由模型自报，结构化验证结果（test:changed --report / evals:gate / judge 读数）参与判定，跑偏在验证红的那一刻被抓住而非用户验收时；第一个用例=让 Petri 的 agent 对 Petri 自身仓库（worktree 副本）做小改动后，自己跑验证门禁 → 结构化判定 ready/blocked/failed → 失败自动回滚 checkpoint；执行载体=工作流脚本（宿主侧注入 verify/checkpoint 原语），验证=evals-harness 隔离后端 + test:changed --report JSON，回滚=workspace-checkpoint 共享层（新增 petri-server 薄 REST）；放权坡道 observe 档护航首批任务。
acceptance:
  - P0 判据驱动驾驶员（升级核心）：loop-orchestrator 的 iteration decision（complete|block|wait|continue|retry，loop-checkpoint.js:236-258）接入「验证器投票」——complete 声明必须附结构化验证结果（verify 原语产出），验证红则强制 retry（上限）或 block，模型自报 complete 不再单独有效；跑偏判据=验证红/预算超/同指纹循环（loop_guard 已有）三者任一；用户入口=一道需求进、推进过程可见（journal 时间线）、终态 ready 附 diff 与证据等验收。契约测：模型自报 complete 但验证红 → 不得终态 ready。
  - P1 基座补齐：workspace-checkpoint 加 petri-server 薄 REST（create/rollback/list，ref 持久化进 journal 而非仅进程 Map）+ 工作流宿主侧 `verify` 原语（直 require test-affected `--report` JSON + evals-gate 报告，映射 loop 词汇 complete|block|wait → ready|blocked|needs_restart）+ `checkpoint` 原语。契约测红绿。
  - P2 闭环脚本：`resources/workflows/self-optimize.mjs`（phase：checkpoint → agent 改动 → verify → 判定 → 失败 rollback / 成功留改动）+ 预算硬顶（maxAgents/maxSteps/timeout）+ journal 每 phase 落 ref/报告路径。dryRun 预估可跑。
  - P3 自指隔离：项目 workspace_path 指向 Petri 仓库 `git worktree` 副本（worktree-governance §3～§8 重开条件由本包触发并走正式流程——不临时另立简化流程）；改动域 v1 限定「不需重启即可验证的面」（scripts/ test/ frontend vitest evals 判据），需重启的面判 `blocked(needs_restart)` 如实留人工。
  - P4 实机：隔离后端 + mock provider 跑一个真实小任务（如 lint 清偿/文档回写）全链：checkpoint→改→verify 绿→保留；再跑一个故意注入失败的任务：verify 红→自动 rollback→工作树与 checkpoint 树逐字节一致。证据落 acceptance/block-335/。
  - P5 放权坡道护航：首批自优化任务的 exec/write 走 observe 档（BLOCK-323 复盘面可见每一步"本可自动执行"），复盘后人工升级；closeout + 台账回写。
reopen: 自动选题（从审计台/lint 基线/失败归因自动出题，v1 人工给题）；判据第二层=judge 质量读数（需 Jev 密钥）；需重启面的自重启能力（headless petri-server 无自重启 REST；Mac restart-dev-stack 等价脚本待补）；LLM-as-judge 质量读数接入判定（evals --judge real 模式需 Jev 密钥）；多任务队列/自动选题（v1 只做人工给题的单任务闭环）。
---

# BLOCK-335-SELF-OPTIMIZATION-LOOP — 任务推进闭环 v1（自优化为首个用例）计划

- 立项裁决：用户 2026-11-02「立项 自优化闭环」（承接同日问答「当前的 petri 可以用来优化自己吗」）
- 登记状态：**planned**；队列=334 收口 → **338 stall 看门狗（稳定性优先）** → 336 worktree → 337 治理运行时 → 本包（消费 336/337；338 根治的 hang 是本包驾驶员的地基）
- 唯一真相域：本文件（block-335-self-optimization-loop）
- 文件面隔离：本包触碰 core/petri-server 的 workflow/checkpoint/routes 与 scripts/、resources/workflows/、test/；与 BLOCK-334 的前端 work-surface/workspace-panels 域零交叠。

## 1. 定位（立项自检问句）

**2026-11-02 升级**：用户追问「Petri 是否具备自动推进任务需求的能力、用户只要验收」——核对结论=零件全有（plan/todo/goal/spawn/workflow/evals/resume/retry）、总装缺（没有判据驱动的驾驶员，跑偏无判据）；本包即总装层。与 ZCode/Codex 的差别：它们的驾驶循环是黑盒自报，Petri 的驾驶员由结构化验证投票（验证红=跑偏，机械可判），且推进过程 journal 可见、终态附证据。改自己只是第一个用例——ZCode/Codex 改自己的仓库和改任何仓库没区别——不知道改坏了没有。Petri 的差别形态：**改动 → 验证 → 结构化判定 → 回滚**是一条本地可审计的闭环（journal 血缘每 phase 留 ref 与报告路径），且首批任务走放权坡道观察档——"让 agent 改自己"这件最需要信任的事，恰好用 Petri 刚建好的信任机制护航。不建第二执行器：agent() 唯一经 launchSubAgent，验证经既有 evals-harness/test-affected，回滚经既有 workspace-checkpoint。

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

1. ~~**worktree 重开**：worktree-governance 休眠纪律的重开条件由本包触发——需用户确认"为自优化闭环重开 worktree 纪律"。~~ **已关闭（2026-11-02 BLOCK-336 收口）**：基础设施已交付并回写治理——[`worktree-governance.md`](./worktree-governance.md) §2 状态转「infrastructure ready (v1)」、§2.1 列明 v1 边界（§5 仅端口约定、§7 缺 Artifact 检查）；本包直接消费 `createProject({ worktreeOf })` 项目层副本，不再需要单独重开裁决。
2. **首批任务清单**：v1 人工给题；~~建议首题=lint 存量收缩一批~~ **已采纳（2026-11-03）**：用户发令「继续按照你的建议推进」→ 首批题=**lint 存量收缩一批**（低风险、可机械验证；judge 读数仍需 Jev 密钥，不挡开工）。


## 5. 收口记录（2026-11-03：P0-P5 整包完成，当日立项当日收口）

**P0 判据驱动驾驶员**：决策瀑布抽纯函数 `core/petri-server/helpers/loop-decision.js`（`decideIterationOutcome`，优先级与原实现逐条对齐）+ loop-contract 新增 `VERIFY_RED_RETRY / VERIFY_RED_BLOCK / VERIFY_RESTART_REQUIRED` 三原因码。**验证器投票**：runLoop config 增 `decisionVerifier`；模型自报 complete 前先投票——验证红 → 强制 retry（连续上限 2）→ block；`needs_restart`（改动域越出可验证面）→ block 留人工；验证器缺席/故障/`unavailable` = 无投票（现状语义零变化，故障不伪装成红也不伪装成绿）。接线链：agent-runner runAgentLoop 参数 → loopConfig → spawn-agent-tools launchSubAgent `verify` spec（随任务落库）→ `createDecisionVerifier`。

**P1 基座**：`helpers/verify-host.js`（两步形态：`--report` 取改动域 + `--run` 真跑门禁，退出码以 --run 为准——**实机抓真：单跑 --report 分支只写报告不跑门禁 = 假绿**；kind ∈ test-affected | evals-gate；改动域越出 `scripts/test/frontend/docs/resources/acceptance/evals/.agents` 前缀 → restartRequired）+ `helpers/checkpoint-host.js`（复用 shared workspace-checkpoint；**force 语义新增**：闭环 checkpoint 先于改动，干净树也要拿 HEAD 回滚锚点；回滚显式 ref，已回滚条目二次回滚 fail-closed）+ workspace-checkpoint 薄 REST 三端点（/api/data/projects/:id/checkpoints create/list/rollback）+ workflow 宿主第七/八原语 `verify` / `checkpoint`（deps 注入；**journal 行 kind 字段被载荷 kind 覆盖的抓真**——验证器种类改名 verifierKind）。

**P2 闭环脚本**：`resources/workflows/self-optimize.mjs`（checkpoint → agent(verify spec + accessMode full + observe 护航) → verify → ready 保留 / 红回滚显式 ref）；sandbox 扫描通过；journal 每 phase 落 ref/verdict。

**P3 自指隔离**：实机腿经 `createProject({ worktreeOf })`（336 生产路径）建 Petri 仓 worktree 副本 ×2；worktree 的 node_modules 用软链 + 主仓 `.git/info/exclude` 兜底（**实机抓真：gitignore 'node_modules/' 带斜杠不匹配 symlink，ls-files --others 会把它混进改动域**）。

**P4 实机（`scripts/block335-self-optimize-live.mjs`，17/17 allPass，`acceptance/block-335/block335-self-optimize-live-darwin.json`）**：L1 GREEN（tier=workflow-primitives）：真 worktree + 真 checkpoint（HEAD 锚点）+ 真两步 verify（7.5s，真 changedFiles）→ ready 保留改动；L2 RED（tier=full-rest-loop）：真 REST workflow → 真 spawn → 真 runAgentLoop（mock 上游 + workspace_write 工具真写）→ 验证红（未映射文件 → exit 2）→ 闭环回滚 → **工作树 vs checkpoint 树零 diff**（checkout 会把 checkpoint 内文件写进 index，porcelain 'A' 属恢复语义，验收口径=树内容逐字节一致）；L3 P5 observe：workspace_write 走 observe 档 → policy_observations 落账 hits=1。**环境抓真：Bash 沙箱对 /var/folders 下派生进程的文件读取被虚拟化（脚本读成空文件 → node 静默 exit 0 → verify 假绿）——实机腿 dataDir/worktree 必须落仓库内临时目录（真实部署 worktree 在用户数据目录不受此影响）**。

**P5 放权坡道护航**：首批任务 agent-rules `path-glob ** → observe`（写面不拦截、复盘面可见），实机腿 L3 断言观察行落账。

**门禁**：335 契约 **8/8** · loop/contract/checkpoint/workflow 邻域 250/250 + 集成 98/98 · `test:changed` 1508 项 17 红（14=P4 配置中心门控家族既有 🟡 + p6 脏树自愈 + loop-fixtures pack 环境红 🟡 + branch-freeze 已登记）· 实机 17/17 · closeout 十三门（随包收口）。**首批题已真跑（2026-11-03，用户「继续按照你的建议推进」发令；提交 4d581110）**：worktree 副本 + checkpoint HEAD 锚点 → 7 条清偿（5×no-async-executor 包裹变换 + 2×control-regex 码点判定，含 1 条非抑制的真实 warning）→ 两步 verify → 回灌主仓 prune → 基线 311→304、lint 0 error、closeout PASS。**实机发现两处**：①直接 eslint 会应用抑制基线——静默≠违规消失，化石普查必须 --no-suppressions 对照；②prune 必须配 --no-cache（缓存跳过未变更文件→检测不到未使用条目）。**执行期事故**：未提交文件被未知机制回退一次 + 5 个悬空空壳 stash 条目（🔴 待归因，AUDIT-LOG）；经验=未提交工作落盘即提交。下一批候选=src/core 域 299 条（触及需重启面，待闭环 needs_restart 路径落地后重启任务线）。G0 开发期常态 · 不外推 packaged/Provider/GA。


## 6. Reopen 记录（2026-11-03：P7 needs_restart 路径 + lint verify kind + src/core 域收缩任务线；用户「继续按照你的建议推进」发令）

- **reopen 判据**：首批题真跑发现 src/core 域收缩会触发 needs_restart（改动域越出可验证面）+ worktree 内全量测试验证撞 p6 源绑定与环境墙——闭环对「源码域任务」缺一条诚实路径：needs_restart 判定落地 + 逐任务适配的 verify kind。
- **P7-1 verify kind 'lint'**：verify-host 增第三 kind——`--report` 取改动域 + `node node_modules/eslint/bin/eslint.js <changedFiles> --no-cache` 只对改动文件跑同源配置（worktree 内全仓 lint 有 type-aware 环境伪影 40 errors，改动域 scoped lint 无此问题）；退出码 0 → ready。
- **P7-2 needs_restart 闭环语义**：self-optimize 判定升级为三态——`ready` 保留 / `blocked` 回滚 / **`ready+restartRequired` → `needs_restart` 保留改动不回滚**（改动经 lint 验证有效但测试面在主仓 closeout 兜底，闭环不伪造 ready）。
- **P7-3 src/core 域 lint 收缩真跑**：16 条基线条目（no-control-regex ×11 全部码点化 / no-unused-vars ×2 契约名豁免保留 / no-var-requires 失效规则条目清除 / no-undef ×1 补 node:url import / loop-orchestrator 契约名豁免保留）经闭环跑（checkpoint → 修复 → verify lint → ready → 回灌主仓 closeout）。
- **本切片不做**：require-await 测试域 ~150 条（下一批，机械但需逐类型注解调整）；react-hooks 域 ~100 条（真重构，独立任务线）；detect-object-injection 未覆盖面 ~2100（warning 级，工具域语义护理）。

### §6.1 P7 真跑收口（2026-11-03 同日完成；提交 66acd02d + 75f688b8）

- worktree + checkpoint 锚点（7c8c8f80）→ 16 条修复 → **verify kind lint ready（5.3s scoped eslint，9 改动文件，restartRequired=true 如实）** → 回灌主仓 → lint 0 error、test:changed 752 项全绿 → closeout PASS。
- 实机抓真：①worktree 内 eslint 不认 `--no-suppressions` 旗标（flat config 后移除）；②修复后基线留 16 条未使用条目 → lint exit 2 如实暴露「修复未完成」，prune 后才 ready——验证器语义正确；③worktree 全仓 lint 有 40 个 type-aware 伪影 → scoped eslint 设计成立。
- needs_restart 语义实跑验证：restartRequired=true 时闭环保留不回滚（若走 workflow 全链，outcome=needs_restart 留人工 closeout——契约 10/10 钉死）。


### §6.2 lint 任务线第二片（2026-11-03 同日完成；提交 6639f97a + 8ce6ca01）

- **require-await 测试域第一轮 69 条清偿**（6 文件：WorkspaceSummaryCard 22 / copilotMarkdown 12 / LeftPanel 11 / useKnowledgeConsole 11 / branchBridge 8 / useTerminalTabs 5）：codemod 机械变换（括号平衡表达式箭头 `async (p) => ({X})` → `(p) => Promise.resolve({X})`，Promise.resolve 包裹保持类型逐字不变）+ 27 处逐型手工（标量 `Promise.resolve(true)`、显式 `Promise<Envelope>`、act 同步回调、mockImplementation 块体、多行三元包裹）。
- **随片抓真三处**：①`satisfies` 谓词在 Promise.resolve 包裹后落到外层（TS1360 ×6）——移入 resolve 括号内；②`await act(() => {...})` 同步重载返回非 Thenable（await-thenable ×3）——act 同步形式去外层 await；③worktree 内 type-aware lint 环境伪影 1917 errors（vitest 类型经 symlink 不可解析）——**前端文件的 lint 权威判定在主仓，worktree 内仅做行为验证（vitest）**。
- **账目**：基线 293→234（-59 净收缩）；vitest 69/69 全绿；types 0 error；closeout PASS。
- **任务线余量**：require-await 测试域尾批 ~40 条（1-2 条/文件 × 22 文件，逐文件碎片型）；react-hooks 域 ~100 条（真重构独立线）；detect-object-injection 未覆盖面 ~2100。


### §6.3 lint 任务线第三批（2026-11-03 同日完成；提交 b4227a93）

- **require-await 尾批 50 条清偿**（24 文件，全部机械）：async 移除 + 消费面分诊——`await` 消费 = 直接去 async；**`.then` 消费 = Promise.resolve 包裹**（去 async 即崩：UsageResourcePanel fetch(...).then 实测、JobsWall listProjects(...).then、ScientificInteractionViewer query(...).then）；Response 实参括号逐处核对（RightFileTree 两处）。
- **验证**：vitest 24 文件 0 fail；types 0 error；基线 234→187（-47）。
- **任务线累计**：311→187（-124 条，40%）；余=react-hooks 域 ~100 条（真重构独立线）+ detect-object-injection 未覆盖 ~2100 + 控制字符零星。


### §6.4 事故归因（2026-11-03 同日完成；🔴→✅ 关闭）

- **回退机制归因**：`git apply --3way` 部分失败（2 文件 does not match index → patch preimage 与 index blob 不一致）在 index 留余波；后续 `git add` 对部分文件读到 index 旧 blob 而非工作树新内容。受控复现实验确认：--3way 成功路径无回退（patch 正确应用），失败路径是根因。git reflog 取证排除 git reset（4 条全在 335 会话前）/ git checkout / p6 测试链（只读 git show+rev-parse）/ checkpoint rollback（仅 worktree 内 checkout）。
- **悬空 stash 归因**：/tmp worktree 内 per-worktree stash reflog（block336/335 实机腿遗留）——worktree 目录被 rm -rf 后 `.git/worktrees/<name>/` 元数据未同步清理 → `git stash list` 短暂可见悬空引用。非产品代码缺陷，worktree 生命周期清理不完整的副产品。
- **已落地**：29 个 stale worktree 元数据全部清理（git worktree prune + 手动 rm）；2 个 /tmp 临时目录删除。
- **纪律固化为修复落点**：①未提交工作不留窗（修复→立即提交）；②多文件 patch 禁用 `--3way` 改用直接 cp + 逐文件验证（--3way 部分失败的 index 余波是根因）；③实机腿 worktree 生命周期收口必须先 `git worktree remove` 再 `rm -rf`，不可只 rm。


### §6.5 react-hooks 域 defer 决定 + lint 任务线收口（2026-11-03；用户「继续按照你的建议推进」确认 defer）

- **普查数据**：react-hooks 活违规 235 条 / 97 文件（set-state-in-effect 91 / exhaustive-deps 83 基线外 / refs 35 / immutability 15 / 其余 13）——比原估 ~100 多 2.4 倍。
- **defer 理由**：①非机械可修——`set-state-in-effect` 是"props→state 同步"的常见正确模式（React 新 lint 才标为反模式），`exhaustive-deps` 补依赖可致无限循环/双重请求；②修复需引入新抽象（自定义 hook / useMemo 派生 / 回调 ref）= 重构非收缩；③vitest 覆盖不足的组件（SimpleChat 1664 行 / project-workspace 1170 行）修复风险远大于收益。
- **策略**：**基线保留作为已知债注册表 + 有机清偿**（组件因功能开发被触碰时顺带修复该组件的 react-hooks 违规）；不设批量截止日期。
- **任务线收口**：require-await 域清零（124 条机械清偿）+ src/core 域 16 条 + 首批 7 条 = 累计基线 311→187（-40%）；任务线目标达成（机械可修域全清），react-hooks 域 defer 不影响收口。
- **登记**：基线 187 条中 react-hooks 152 条为 defer 档（有机清偿）；require-await 0 条（全清）；control-regex 0 条（全清）；其余 35 条为 detect-object-injection 等语义护理档（低优先）。
