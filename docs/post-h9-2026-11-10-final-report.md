---
capability: post-h9-2026-11-10-final-report
status: reference
goal: 第四轮全量评估与优化蓝图 K0–K7 全程序总收口报告；十一维六列终验复评、32 条缺口逐件终态、证据分级披露、WIP 与外部依赖如实登记。
acceptance:
  - 十一维六列复评差值逐条归因到提交或读数，不回溯调参
  - 32 条缺口逐件终态，无静默消失，U/E/V/W 边界不冒充完成
  - 未跑 / 跳过 / 复用证据逐项标注
  - WIP 保留状态与外部依赖逐项列明
reopen: 有效 provider 端点恢复 / 用户人眼签字 / U 类裁决下达后按 §6 补腿条件重开对应项
---

# 第四轮全量评估与优化 · K0–K7 总收口报告（2026-11-10）

> 发令：用户 2026-11-10「按 docs/post-h9-optimization-blueprint-2026-11-10.md 从 K0 到 K7 全部推完，直到总收口」，显式预授权连续工作、全程零参与；不设工作量上限，但设**证据上限**。
> 结论一句话：**八个阶段全部按单包串行收口，32 条缺口逐件定终态；十一维四升七平零降、达标 5/11；但真实任务 8/8、人眼签字、ADMISSION/FK 裁决与 W5b 结构性重构客观未闭合，全部如实标注，未写 verified/completed/qualified。**
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §0 事实基线与启动校准

| 项 | 蓝图写作时 | 本次运行时（`a33a53cc` 起） |
| --- | --- | --- |
| HEAD | `6dc6ae86` | 启动时 `a33a53cc`（BLOCK-395 收口），总收口前逐笔前进 |
| 并发 WIP | 10 M + 20 untracked、写入者活跃 | **0 M**，untracked 10 项（9 项受保护用户资产 + 蓝图原件），H10 已由其 owner 收口 |
| 两红门 | `ui:audit:check` / `quality:lint` FAIL | 当场 PASS；归零原因=owner 收口，非本程序修复，不冒充本包通过 |
| AUDIT-LOG | 无 🔴/🟢 未决 | 确认无 🔴/🟢；81KB 建议级提示由 `audit:compact` 自稳 |
| 活跃串行槽位 | 空 | 每阶段唯一 active work-package（BLOCK-396～403），逐阶段收口后再开下一个 |

按蓝图 `reopen` 条款以当前读数重建基线，K0 未空等、未代改他方文件。

**蓝图声明校准（4 处，原文 untracked 零触碰，勘误落 canonical 台账）**：
1. §0.2/§2.2/§3「400/800 档与 100 档同为 7202 节点」有误：100 档 `allNodes=3052`，真正相同的是 `convRowMatches` 100/400/800 同为 500（plateau）。
2. §2.1/§3 K-10「goals 未接线 / viewer 能力位全 false」已被后续代码推翻（goals 经 `agent-orchestration.js:208` 汇编；viewer 12 档 10 个 true 位）。
3. §4 K1「熔断挂 cost-cap.js」不准：该文件只是设置面，真熔断在 `loop-orchestrator.js:749-765`；K-08「MCP 计量盲区」经实证为**范畴错误**（链上零 LLM，接线会污染单表账本并推翻既有裁决）。
4. §1.2「凭据 0 key / presets=0 / 出网仅 401」不准：本机 keychain 凭据实际在位、4 个 chat presets；真实障碍是特定 provider 端点 TCP `ETIMEDOUT`。

## §1 八阶段收口总览

| 阶段 | BLOCK | 交付核心 | 门禁 |
| --- | --- | --- | --- |
| K0 判据校准与可信起点 | 396 | 三条判据作废重立（12 篡改负测）、九组读数单源 JSON、lint∩hygiene 联动门、WIP owner 表 0 未知、README status 对账、32 条终态台账基座 | closeout PASS + **干净树 closeout:full ×3，19 门全绿 0 SKIP** |
| K1 通用 agent 主线兑现度 | 397 | K-08 误判校准（不接线/不污染账本，真实 callTool 行为断言 + 11 负测）、K-09 U 类材料、K-10 防回退、165 通道机械分诊 | 29 契约全绿 + closeout PASS |
| K2 服务端数据面 | 398 | 红绿先行（5 红→15 绿）、具名上限常量 10 文件 15 行收编、additive `hasMore/nextCursor` 信封 + >100 条 HTTP 行为 3/3、复合索引查询计划命中、拆前 HEAD 快照 18/18 + 拆后 18/18 | closeout PASS |
| K3 用户可感知体验 | 399 | 四事件反向契约 22/22、内联样式债棘轮门（55 色 + 5 zIndex 冻结）、B-11 布局防回退、debt 35 机械分诊、E/L 材料、UI 台账同批回写不增债 | lint 红门删死导入根修（`3db14806`）后 closeout 全绿 |
| K4 架构去补丁 | 400 | 源码扫描契约只减不增棘轮门、插件源解析面单源防回退、三树版本只读对账（typescript 漂移检出）、H10 8 证据 tracked 校准、W5b 六刀材料 | 19 契约全绿 + closeout PASS |
| K5 性能与证据门禁化 | 401 | 严格证据元数据门（无例外）、DOM 阈值纯函数门（植 2 万必红）、三矩阵/165 通道/EAR 对账、显式 perf 5/5 证据、EAR 962/2179=44.1% 如实报 | 22 契约全绿 + closeout PASS |
| K6 安全与边界纵深 | 402 | **PiP 四项基线红绿先行**（加名单必红→补 `sandbox/webSecurity` 转绿 3/3）、窗口名单覆盖门、ADMISSION/FK/IPC U 类材料 | 14 契约全绿 + closeout PASS |
| K7 真实任务终验与总收口 | 403 | 真实任务当次取数（凭据/出网/两次有界超时时间线）、32 条全终态、十一维六列复评、证据披露、本报告 | 14 契约全绿 + 干净树 closeout:full |

## §2 十一维六列终验复评

口径沿用蓝图 §0.3：5=当前证据下可长期托重，1=核心链路不可信；**无证据扣分而不是给分**。前五列逐字沿用 canonical，第六列由本程序当次提交与读数归因，**不回溯调参**。

| 维度 | 评估时 | NSO 后 | S7 复核 | H7 终验 | 本次复核(H9 蓝图) | **终验** | 目标 | 差值归因（逐条） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 功能完整性 | 4.2 | 4.3 | 4.4 | 4.4 | 4.4 | **4.4** | 4.7 | 平。16 域 facade / 168 通道 / MCP 单入口未动；K1 校准 goals 已汇编、viewer 能力位已接线（非新增能力）；K2 additive 信封不改默认 100；8 任务 ETIMEDOUT 未完成不给分 |
| 性能表现 | 3.5 | 3.8 | 3.8 | 3.9 | 3.9 | **3.9** | 4.5 | 平。K0 作废三条失真判据、K5 perf 显式 5/5 + DOM 阈值纯函数门；但 K2 会话真分页、K5 判据入门禁、T7 自然长任务属 L/V 未闭合 |
| 代码质量 | 3.3 | 3.6 | 3.7 | 3.9 | 4.0 | **4.1** | 4.5 | +0.1。5 个新机械门各带负测（lint∩hygiene、内联债、源码扫描、证据元数据、PiP 安全断言）；`3db14806` lint 红门删死导入零放宽基线 |
| 可维护性 | 3.2 | 3.5 | 3.6 | 3.7 | 3.7 | **3.7** | 4.4 | 平。K2 具名常量纯重构（拆前后各 18/18）、K4 插件源防回退；五巨型文件未拆、装配面两处、3 族扫描契约未换行为断言，按 W5b 挂起 |
| 可扩展性 | 4.2 | 4.5 | 4.5 | 4.5 | 4.5 | **4.5** | 4.8 | 平。单入口/注册制零改动；未新增零消费声明位、未建第二 IPC 包装器，三矩阵同源仍挂 W5b |
| 安全性 | 3.4 | 4.0 | 4.2 | 4.3 | 4.3 | **4.4** | 4.6 | +0.1。K6 补齐最后一个未覆盖创建点：PiP `sandbox/webSecurity` 显式达标并纳入名单，4 个创建点四项基线全覆盖 + 漏配/漏登记负测；ADMISSION/FK 维持既有裁决 |
| 用户界面与交互体验 | 3.7 | 3.7 | 3.8 | 4.0 | 4.1 | **4.1** | 4.6 | 平。K3 四事件反向契约、布局防回退、debt 35 分诊；暗色对比/读屏/长内容三态人眼未签字、颜色未 token 化、focus trap 未做，不冒 verified |
| 错误处理与边界情况 | 3.1 | 3.5 | 3.7 | 3.9 | 3.9 | **4.0** | 4.6 | +0.1。K0 fail-closed 判据裁决器、K1 计量误判校准、K5 五类不冒充门、K6 创建点断言；8 处空 catch 未清零、四事件 Toast 历史未接、64MB 单入口未收编 |
| 测试覆盖 | 3.7 | 4.1 | 4.2 | 4.3 | 4.4 | **4.5** | 4.7 | +0.1。新增 169 项契约测试（100+ 篡改负测）、每阶段定向 `test:changed` 全绿、K0 干净树 `closeout:full ×3`；全量 `test:all:sharded` 三段未跑，升幅受限 |
| 文档完善度 | 4.3 | 4.5 | 4.6 | 4.7 | 4.7 | **4.7** | 4.8 | 平。8 份独立 plan + 5 份 U/E/V/L 决策材料全部登记 registry/README，每阶段六件套同批回写；AUDIT-LOG 仍 >50KB 建议阈、136 归档候选本轮零归档 |
| 依赖与架构合理性 | 3.7 | 3.9 | 4.0 | 4.0 | 4.0 | **4.0** | 4.6 | 平。全程零新增依赖、三套 lock 未动、typescript 双版本漂移只读检出（U 类）、12 环/330 键/巨型文件基线零放宽；W5b 结构性重构仍挂起 |

**综合：四升七平零降**；达标（≥4.4）**5/11**（H9 蓝图复核为 4/11，差值 +1 来自安全性 4.3→4.4，归因 K6 PiP 安全补线）。所有升分均有当次提交或读数支撑；所有未闭合项按「无证据不给分」保持平。

## §3 32 条缺口逐件终态

机械汇总（`acceptance/post-h9-2026-11-10/k7/k7-gap-terminal-states.json`，`--require-all-closed` 绿）：
**done 10 / done-partial 9 / retain-with-reason 3 / pending_user_ruling 3 / deferred 5 / pending_human_eye 1 / external-blocked 1 = 32，零 `in_progress`、零静默消失。**

| ID | 阶段 | 终态 | 依据 / 未闭合归属 |
| --- | --- | --- | --- |
| K-01 | K0/K2 | done | 旧「全量 DOM」判据作废；重立为服务端 LIMIT 100 截断被明确告知（>100 HTTP 行为 3/3） |
| K-02 | K0 | done | cv A/B 0.7ms vs 0.7ms 无收益，判据改耗时比，探针未落产品源码 |
| K-03 | K0/K5 | done | 热栈 5 轮≠冷启动 ×5 钉死（12 负测）；真 ×5 入门禁属 L |
| K-04 | K0/K5 | retain-with-reason | 九组读数单源化；perf 保持 opt-in 默认不写盘（改默认写会破坏干净树/P6 源绑定，U 类） |
| K-05 | K0 | done | 并发 WIP 已由 owner 收口；lint∩hygiene 联动门防同类第二次复发 |
| K-06 | K0 | done | 10 项 untracked 逐件归属，unknownOwnerCount=0，全程零触碰 |
| K-07 | K0 | done | README 第三轮蓝图 `active`→`completed` 与 registry 对齐，机械守护防回弹 |
| K-08 | K1 | retain-with-reason | 实证为蓝图误判：MCP 链零 LLM，接线会污染单表账本并推翻既有产品裁决 |
| K-09 | K1 | pending_user_ruling | `tools_only`/IDE `accessMode` 档位待裁决，默认放行档零改动 |
| K-10 | K1 | done | goals/viewer 已交付，只加防回退契约，不重复开发 |
| K-11 | K2 | done-partial | additive 信封 + 复合索引落地；fork 事务/读路径减负/前端更多入口归 W5b |
| K-12 | K2 | done | 具名上限常量 15 行、复合索引查询计划命中、rowid 不可索引负测 |
| K-13 | K2 | deferred | SSE 复用事件总线需独立 W5b 长连接时间轴夹具 |
| K-14 | K3 | done-partial | 代码层投影链已交付 + 反向契约；Toast 历史接线/真实 SSE 观感归 L/E |
| K-15 | K3 | pending_human_eye | debt 35 机械分诊；人眼路线签名区全空，Agent 不代答 |
| K-16 | K3 | retain-with-reason | B-11 零几何收敛已交付；改产品 CSS 需几何量测 + 人眼过目 |
| K-17 | K3 | done-partial | 内联样式债棘轮门落地；颜色值 token 化/focus trap 需人眼暗色 diff 与读屏 |
| K-18 | K4 | deferred | 五巨型文件逐刀拆分，一切片=一会话 + 拆前拆后同套绿 |
| K-19 | K4 | done-partial | 解析面三处同源防回退；装配面两处各自拼数组如实标注 |
| K-20 | K4 | done-partial | 源码扫描契约只减不增门 + release-contract 结构化校准；3 族换行为断言归 W5b |
| K-21 | K4 | done-partial | H10 8 证据 tracked、120→90 已入仓；剩余 90 归规则需 owner 裁决 |
| K-22 | K4 | deferred | 12 环真消亡 / knip 330 键精确债需结构性重构 |
| K-23 | K5 | done-partial | DOM 阈值纯函数门 + 帧时判定器；真实量测/T7/请求体占比归 L/V |
| K-24 | K5 | done-partial | 三矩阵非同源现状机械钉住；真同源改造归 W5b |
| K-25 | K5 | deferred | 165 通道逐件接线/删除需产品语义裁决（U） |
| K-26 | K5 | done-partial | EAR 962/2179=44.1% 分子真实增长、分母未缩、阈值未改；45% 目标未达 |
| K-27 | K6 | done | PiP 四项基线补齐 + 名单覆盖，红 1→绿 3/3 |
| K-28 | K6 | deferred | IPC 参数 schema / 豁免口复核 / 空 catch 扫描根 / dev 双后端各需独立切片 |
| K-29 | K6 | pending_user_ruling | ADMISSION 默认档、FK 全量切换未裁决，既有裁决不回退 |
| K-30 | K7 | external-blocked | 真实任务连续 8/8 客观拿不到（端点 ETIMEDOUT + 有界超时）；人眼签字缺席 |
| K-31 | K4 | pending_user_ruling | typescript `^5.9.3` vs `^5.5.4` 漂移只读检出，统一需用户裁决 |
| K-32 | K5 | done | 严格证据元数据门覆盖本程序全部 JSON（四字段 + 五类不冒充），历史不回填 |

## §4 未跑 / 跳过 / 复用证据（如实标注）

- **未跑**：`test:all:sharded` 全量三段（每阶段只跑定向 `test:changed`；不写全量通过）；CDP 实机 DOM/几何/帧率/冷启动真 ×5；真实 provider 8 任务连续 3 次 8/8 与 attempt 级证据；T7 自然长任务；SSE 断线注入三态 flow；人眼路线签字与 8 项 `humanEyePending`。
- **跳过**：定向 `closeout` 中 `gate:arch-cycles` / `quality:arch` 按 BLOCK-272 域跳过语义 `SKIPPED`（**不算 PASS**）；K0 干净树 `closeout:full ×3` 已全量执行覆盖这两门（14 `--gate` + 5 固定门，0 SKIP）。
- **复用**：前五列评分沿用 canonical 评估链（属引用，不属门禁证据复用）；H8/H10 既有离屏证据只用于判据校准，未冒充本程序当次实机证据。
- **有界超时**：`evals real` 90s exit 124、`block348` 8 任务 240s exit 124，结论为 **unknown**（既非通过也非产品失败结论），时间线见 `k7/task-suite-attempt.json`。

## §5 WIP 保留状态与外部依赖

**WIP 10 项零触碰**（不代改、不暂存、不代提交、不清理）：`assets/`、`docs/pelican-bicycle.html`、`docs/post-h9-optimization-blueprint-2026-11-10.md`（发令依据）、`model3d/enclosure-...scene3d.json`、`petri-logo-concepts.miora`、`petri-logo-concepts_assets/`、`scripts/backfill-artifact-chain.mjs`、`tmp-block342-live/`、`tmp-review/`、他方 `summary-1793978091259.json`。唯一清理是本程序 K7 自产的半成品 `artifacts/traces`。

**外部依赖**：①provider 端点 `199.59.148.247:443` 可达性（V）；②用户人眼签字（E）；③U 类裁决五项：ADMISSION 默认档、FK 全量切换、165 通道逐件、typescript 双版本、perf 默认写盘策略；④W5b 结构性重构发令（五巨型文件/12 环/knip/源码扫描契约/三矩阵同源/装配面）。

## §6 补腿条件与归属

| 类别 | 逐项补腿条件 | 归属 |
| --- | --- | --- |
| V 凭据/出网 | provider 端点恢复 → 按冻结判据表复跑 8 任务 ×3（连续 8/8、0 干预）+ T6 波动归因 + attempt 级归因 + T7 去 `windowOverride` | 用户/环境 |
| E 人眼 | 按 `docs/post-s7-h7-human-eye-route.md` 六组实测，填签名区（确认人/日期/覆盖勾选/结论）+ 截图；8 项 `humanEyePending` 由人补判据 | 用户 |
| U 裁决 | 五份决策材料（K1/K3/K4/K5/K6）各含现状/候选/风险/推荐/证据/补腿条件；裁决前零默认语义改动 | 用户 |
| L 实机 | 活 dev 栈 + 9223 离屏 CDP：DOM 植 2 万必红、P50/P95 同批落盘、四块几何量测 + 拖到两倍/缩到一半、冷启动真 ×5、SSE 断线注入三态；离屏读数不冒充视觉绿 | 下一工作包 |
| W5b | 一切片=一会话，拆前拆后同套定向测试绿；每刀 code-size 例外只减不增、行数锚刷新 | 下一工作包 |

## §6.1 总收口六维评审（P1 抓真并修根因）

按 `$petri-code-review` 在总收口前跑全量 `test/post-h9-*.test.mjs`（183 项）自查，发现 **2 红**——定向 `test:changed` 只跑改动命中的规则，多个阶段收口时未同时命中全部契约，契约漂移滞后到总收口才暴露。三处 P1 全部修根因，无遗留：

| ID | 维度 | 现象（file:line） | 修法 |
| --- | --- | --- | --- |
| P1-1 | 契约一致性 / 测试有效性 | `post-h9-k0-criteria.mjs:49` 用字面 `LIMIT 100` 钉 K-01；K2 合法演进为 additive 信封 `LIMIT 101 + rows.slice(0,100)`（默认仍 100 条）→ 判据假红 | 改钉语义不变量「默认上限 100 + 无分页参数」，兼容两种形态；补 `conversationsDefaultPageSize` 篡改负测与正向校准断言 |
| P1-2 | 测试有效性 | `post-h9-evidence-and-ledger.test.mjs:139` 的 in_progress 负测依赖当前台账状态；K7 全部定终态后失效 | 改用 `emptyLedger()` 干净基线 + 正向断言防双向失效 |
| P1-3 | 契约一致性 | 同文件 `:168` 把 closeout 门数写死 19；新增契约门后 19→20 假红 | 改机械断言「固定 5 + `--gate` 数」并要求新门在链内 |

**回归→门禁转化**：同类「契约随实现/状态演进漂移而定向测试未拦」重复 ≥2 次 + 后果隐性滞后 + 可机械化，三条全中 → 新增 `gate:post-h9-contracts`（`scripts/post-h9-contract-suite.mjs` 无条件跑全部 11 个 post-h9 契约文件、清单为空 fail-closed），挂进 `closeout` 链。全量复跑 **185 项 0 红**，K0 九组读数（当次重新采集）的门数口径同步机械更新为 **20（固定 5 + 15 `--gate`）**。

**门数口径披露**：K0 阶段各 `*-closeout-gates.json` 记录的 19 门是当时的历史快照，按「不回填历史证据」纪律原样保留；K1–K6 定向 closeout 同为 19 门（2 门域跳过）；K7 总收口评审新增契约门后为 **20 门**。本文与 `k7-closeout-gates.json` 采用当前读数，历史证据不改写，二者差异仅来自新门接线，不是口径不一致。

本次为 Agent 六维自评；AI 跑查 `ocr` 本轮未跑（可选工具，按评审 skill 降级纪律如实声明，不阻塞收口）。证据 `acceptance/post-h9-2026-11-10/k7/k7-final-review-p1-fixes.json`。

## §7 红线自检

零新增依赖；10 项用户资产与蓝图原件零触碰；既有用户裁决（workspace_exec 默认放行、MCP trust 两轴分离、FK 维持缓、ADMISSION 维持缓、G0 阶段纪律）零回退；未新建第二 executor/Job/Artifact/Workflow/项目状态/UI truth/计量账本/事件通道/台账；五类证据（行为测试 / 机械门禁 / CDP 实机 / 人眼观感 / 真实任务成功）严格分级、零互相冒充；无证据处一律不写 verified/completed/qualified；通用 agent 主线（编排/知识/工具/模型计量/可靠性）未收缩，K1 把「模型计量」边界钉准；本地主权/全链可审计/证据自证体现在 8 份 plan、5 份决策材料、50 份带 `sourceCommit/platform/command/generatedAt` 的证据与每阶段 canonical 同批回写。

---

*本报告的全部「通过 / 全绿 / 达标」均有当次命令输出或 acceptance 证据支撑；未闭合项逐件列出归属，不为空等、不代答、不伪造。*
