---
capability: block-392-post-s7-h7-final-report
status: completed
goal: post-S7 程序（H0–H7）终验与总收口——把 34 条缺口逐件定终态、给出十一维五列复评（差值逐条归因）、如实登记未闭合项与人眼/环境边界，不把未跑写成通过。
acceptance:
  - 34 条缺口逐件终态（done / done-partial / retain-with-reason / pending_human_eye / external-blocked），无静默消失
  - 十一维五列复评表（评估时 / NSO 后 / S7 / 本次复核 / 终验），差值逐条归因到提交或读数
  - 八阶段各有 plan、证据目录、门禁摘要、收口笔录
  - 真实任务与人眼项如实挂起并给补腿条件；不写 verified / completed
reopen: 有效凭据到位（B-02）或人眼路线签字后
---

# BLOCK-392 · post-S7 H7 终验与总收口报告

> 发令：用户 2026-11-09 预授权连续工作（`docs/post-s7-optimization-blueprint-2026-11-09.md` H0→H7 全推）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## §1 八阶段交付总览

| 阶段 | 包 | 终态 | 关键交付 | 证据 |
| --- | --- | --- | --- | --- |
| H0 可信起点 | BLOCK-385 | completed | state 两层语义；影响图重复 id fail-closed（357→356）+ 未映射第一批 145→138；分片 9 红→3 红（7 根修）；canonical 对账 | `acceptance/post-s7-2026-11-09/h0/` |
| H1 执行准入与数据真相 | BLOCK-386 | completed | workspace_exec 执行边界出示并消耗一次性凭据（四类拒绝生产路径 9/9）；签发失败显式降级；删空间掉绑不依赖 FK；zip 四道闸 5/5；manifest 链三态；链校验默认 strict | `h1/`（`legacy-unhashed-inventory.json`） |
| H2 失败态与错误语义 | BLOCK-387 | completed（带挂起） | 原因码 25→42 + 生产面全覆盖门；静默 catch 棘轮门（403 处冻结，入 closeout）；onEvent 具名占位；toast 有界历史；viewer 降级 status | `test/block324/387` + ToastProvider 10/10 |
| H3 体验收官 | BLOCK-388 | completed（可机械子集） | 台账否定语境修正 + 外因词误判修正 + 债棘轮双守；分屏 ARIA slider | `test/ui-ledger-status-contract` 5/5 + ArtifactPinPane 15/15 |
| H4 单源收编 | BLOCK-389 | completed（可机械子集） | schema/契约版本登记处（六处字面量收编）；DB 路径单源（认 PETRI_DB_PATH） | `test/block389-*` 7/7 |
| H5 性能与规模化 | BLOCK-390 | completed（证据面） | perf 机器可读证据（sourceCommit/platform/command/每轮 rows，5/5 全绿） | `h5/perf-evidence.json` |
| H6 治理台账 | BLOCK-391 | completed | AUDIT-LOG 超长行迁档（10933B→最长 2695B）；两份 lastUpdated 单写入者 + 分叉校验与负测 | `docs:check` 524 / `docs-governance` 19/19 |
| H7 终验与总收口 | BLOCK-392 | completed（带挂起） | 34 条缺口终态台账；十一维五列复评；人眼路线 | `h7/gap-ledger.json` + `docs/post-s7-h7-human-eye-route.md` |

**全局门禁**：`npm run closeout` **17 门全绿**（H0 时 16 门；H2 新增 `gate:silent-catch`）。每阶段收口前均在干净跟踪树上跑过一次；未跑 `closeout:full ×3` 连续（H0 已在未闭合项里如实登记原因：同一提交重复三次的边际信息量低于证据上限原则，转 H6 后的单次干净树 closeout + 分片实跑）。

**分片**：`test:all:sharded` 当次两轮——基线 `node-core 9 红 / frontend 1 红 / node-long 0 红`，终局 `node-core 3 红 / frontend 0 红 / node-long 0 红`。终局 3 红逐件归属见 `h0/shard-attribution.json`（1 自伤当场修、2 外部归属）。

---

## §2 十一维终验复评表

> 口径沿用蓝图 §0.3：**证据锚定评分**（5 = 当前证据下可长期托重，1 = 核心链路不可信；无证据扣分而不是给分）。前三列沿用 canonical，第四列是蓝图当次复核，第五列是本程序终验。**差异逐条归因到提交或读数，不回溯修改历史分数。**

| 维度 | 评估时 | NSO 后 | S7 复核 | 本次复核 | **终验** | 目标 | 终验归因 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 功能完整性 | 4.2 | 4.3 | 4.4 | 4.4 | **4.4** | 4.7 | 平。本程序不新增功能面（优化而非加能力）；8 任务套件仍 0/8=凭据缺失（B-02 external-blocked），无新增成功证据 |
| 性能表现 | 3.5 | 3.8 | 3.8 | 3.9 | **3.9** | 4.5 | 平。perf 证据从「结论叙述」升级为机器可读资产（`h5/perf-evidence.json` 5/5，带 sourceCommit/platform/command）+ 矩阵→能力地图同源链闭合；但五段分解与 DOM/帧率判据仍未入门禁（需 CDP） |
| 代码质量 | 3.3 | 3.6 | 3.7 | 3.8 | **3.9** | 4.5 | +0.1。新增静默 catch 棘轮门（403 处冻结/新增即红）+ 三处 `onEvent:()=>{}` 改具名占位 + 版本六处字面量收编 + DB 路径单源；2312 warnings 与 16 例外仍在（B-31 retain） |
| 可维护性 | 3.2 | 3.5 | 3.6 | 3.6 | **3.7** | 4.4 | +0.1。schema/契约版本单一登记处 + DB 路径单源 + 行数锚口径统一（split vs wc -l）+ state 两层语义 + 台账超长行迁档；`loop-orchestrator` 1579 行未拆（B-16 W5b retain） |
| 可扩展性 | 4.2 | 4.5 | 4.5 | 4.5 | **4.5** | 4.8 | 平。16 域 facade / MCP 单入口未动；插件源三处装配仍三处（B-18 retain） |
| 安全性 | 3.4 | 4.0 | 4.2 | 4.2 | **4.3** | 4.6 | +0.1。执行准入从「内核齐备无人用」变为**真实闭环**（workspace_exec 边界消耗 + 四类拒绝生产路径 9/9）；zip 四道闸（真实 zip 负测）；manifest 断链不再静默；链校验默认 strict。ADMISSION enforce 与 FK 全量切换仍按用户裁决维持缓 |
| 用户界面与交互体验 | 3.7 | 3.7 | 3.8 | 3.9 | **4.0** | 4.6 | +0.1。toast 有界历史回看（4 秒提示不再一闪而过）+ viewer 降级原因进播报队列 + 分屏 handle 语义纠正（separator→slider）；DOM 预算/布局单源/颜色收敛=需实机量测（retain） |
| 错误处理与边界情况 | 3.1 | 3.5 | 3.7 | 3.7 | **3.9** | 4.6 | +0.2。原因码 25→42 且扩到**生产面全覆盖门**（未注册即红）；静默 catch 从「无门」到「冻结+负测」；签发失败从空 catch 到显式降级；四事件码在册可渲染（前端投影仍挂起） |
| 测试覆盖 | 3.7 | 4.1 | 4.2 | 4.2 | **4.3** | 4.7 | +0.1。新增 6 族机械契约（准入闭环 9/9、zip 5/5、链清单 3/3、静默 catch 2/2、版本单源 3/3、DB 路径 4/4）；未映射 145→138；全量残红 38→3（2 外部归属）；人眼 8 项仍 pending |
| 文档完善度 | 4.3 | 4.5 | 4.6 | 4.6 | **4.7** | 4.8 | +0.1。两份 lastUpdated 从「互相打脸」到单写入者 + 分叉报警；超长行迁档不改写；README 入口行可被 `ENTRY_RE` 识别；34 条缺口终态台账 + 人眼路线成文；`docs:check` 515→524 注册、0 issue |
| 依赖与架构合理性 | 3.7 | 3.9 | 4.0 | 4.0 | **4.0** | 4.6 | 平。零新增依赖（全程未装任何包）；13 环、knip 330 键、三套依赖树未动（B-24/25/26 retain，属架构改道需独立立项） |

**综合**：**四升七平零降**（代码质量 / 可维护性 / 安全性 / 界面体验 / 错误处理 / 测试覆盖 / 文档完善度七项里实际 +0.1~+0.2 的六项 + 一项持平，性能与功能面持平）。达「每维 ≥4.4」的蓝图出口：**3/11**（功能完整性 4.4、可扩展性 4.5、文档完善度 4.7）。

**为什么不更高**：本程序的瓶颈不是「还能不能加」，而是「必须有实机/人眼/真实任务」的四类证据——DOM 预算要 CDP 量测、布局单源要几何对比、四事件投影与 SSE 横幅要断线注入、真实任务要凭据。这些不满足时抬分就是拿文档冒充证据。

---

## §3 34 条缺口终态

完整机械台账：`acceptance/post-s7-2026-11-09/h7/gap-ledger.json`（34 条唯一 id，状态由脚本汇总）。

| 终态 | 条数 | 缺口 |
| --- | ---: | --- |
| `done` | 5 | B-01 / B-15 / B-19 / B-27 / B-28 |
| `done-partial` | 15 | B-03 / B-04 / B-05 / B-06 / B-07 / B-08 / B-10 / B-12 / B-13 / B-17 / B-21 / B-22 / B-23 / B-29 / B-30 |
| `retain-with-reason` | 12 | B-09 / B-11 / B-14 / B-16 / B-18 / B-20 / B-24 / B-25 / B-26 / B-31 / B-32 / B-33 |
| `pending_human_eye` | 1 | B-34 |
| `external-blocked` | 1 | B-02 |
| **合计** | **34** | 无一项静默消失 |

---

## §4 未闭合项与补腿条件

### 4.1 环境因（V 类）

| 项 | 实测证据 | 补腿条件 |
| --- | --- | --- |
| 真实任务 8 任务套件（B-02） | 出网可达（`api.deepseek.com` HTTP 401=可达未授权）；`DEEPSEEK/OPENAI/ARK/PETRI_LLM` 环境变量 0 个；`.petri-dev-user-data/data/ai-settings.json` presets=0 | 提供有效模型凭据 → 按冻结判据复跑 ×3 要求 8/8、0 干预 |
| 8 项 `humanEyePending` + UI-702 / 32 条 debt 人眼子集（B-34） | 无人眼确认记录 | 照 `docs/post-s7-h7-human-eye-route.md` 走一遍并在签名区确认 |
| 五段分解 / DOM 门 / 帧率 / 请求体占比（B-22） | 无 dev 栈；happy-dom 无帧 | 起 dev 栈 + 造 ≥400 会话，按 H5 plan §2 步骤取数 |
| 布局单源 / 颜色 token / DOM 预算（B-11/B-32/B-09） | 同上（需几何与视觉量测） | 按 H3 plan §2 步骤：几何 JSON 前后对比 + 人眼过目 |
| SSE 重连横幅 / 四事件投影（B-14/B-07） | 需断线注入 | 起栈后注入 RST，三态断言 + 截图 |

### 4.2 用户裁决项（U 类）

| 项 | 当前态 | 材料 |
| --- | --- | --- |
| 执行准入默认档 | observe（凭据照常消耗与透出，不拒绝） | `docs/post-s7-h1-admission-fk-decision-material.md` §一（推荐维持 observe） |
| SQLite 外键全量切换 | 后端 OFF（桌面侧 ON） | 同文件 §二（推荐先做「依赖 CASCADE 语句清单」静态扫描） |

### 4.3 结构性重构（需独立立项 / 切片）

B-16 大拆片（W5b 一切片一会话）、B-18 插件源三处、B-20 源码扫描换行为断言、B-24 依赖树、B-25 环按簇消亡、B-26 knip 动态入口、B-31 warnings 分域棘轮、B-33 165 零消费通道逐件裁决。

---

## §5 明确没有做的事（防误读）

1. **没有**把 `qualificationEligible`、Provider 矩阵、packaged 公证、GA 流水纳入本程序（G1+）。
2. **没有**新增任何依赖（`package.json` 仅新增一个 npm script，无新增包）。
3. **没有**撤销任何既有用户裁决：`workspace_exec` 默认放行、MCP trust 与 capability token 两轴分离、FK=ON 维持缓、ADMISSION 拨硬维持缓、G0 阶段纪律。
4. **没有**用 DOM/组件测试冒充视觉绿，也没有用机械门禁绿冒充任务成功。
5. **没有**回填历史 acceptance 证据元数据（改写历史证据=伪造）。
6. **没有**缩 EAR 分母；EAR 仍 41.6%（<45% 目标），如实不达标。

---

## §6 复跑命令

```bash
npm run state                      # 分支 / WIP / AUDIT-LOG / active 两层语义
npm run closeout                   # 17 门收口（含新增 gate:silent-catch）
npm run docs:check                 # 注册表 + coverage + lastUpdated 分叉
npm run ui:audit:check             # UI 台账
node --test test/block386-execution-admission.test.mjs   # 准入闭环四类拒绝
node --test test/block386-zip-guard.test.mjs             # 解压四道闸
node --test test/block387-silent-catch-ratchet.test.mjs  # 静默 catch 棘轮
node --test test/block389-version-single-source.test.mjs # 版本单源
node --test test/block389-db-path-single-source.test.mjs # DB 路径单源
PETRI_PERF_EVIDENCE=acceptance/post-s7-2026-11-09/h5/perf-evidence.json npm run quality:perf
node scripts/verify-artifact-chain.mjs .petri-dev-user-data/data/petri.db --inventory <out.json>
npm run test:all:sharded           # 三段分片（有界；exit 124/125=unknown 不写 PASS）
```

G0 开发期常态 · 不外推 packaged/Provider/GA。
