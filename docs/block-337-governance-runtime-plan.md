---
capability: block-337-governance-runtime
status: completed
goal: 治理运行时化 + 并行协议（用户裁决 2026-11-02「需要的」）：把 AGENTS.md / petri-project-governance 等"给外部 agent 看的操作规程"转译为 Petri agent 的运行时能力——项目打开即自动装载治理规则包、单包串行与并行互斥由 registry truthDomain 机械校验（不相交自动放行并行、相交自动排队）、收口判定硬绑 closeout 门禁、台账由工作流 phase 自动落账；违规由放权坡道拦截而非文档劝诫。终态：规则文档只留判断标准与价值边界，工程规则由软件自带。
acceptance:
  - P0 引擎/规则包分离（用户追问 2026-11-02「面对不同开发任务和项目是否通用？只写生信流程呢」）：机制（装载/校验/拦截/落账/收口判定）与规则条目严格分离，规则以「项目类型规则包」形态存在并按工作区特征自动识别挂载——受治理软件仓（含 DOC-REGISTRY/AGENTS.md→软件工程治理包）/ 生信分析项目（含 pack 声明或 counts、fastq 等数据→bio pack 规则：数据不可变、QC 门、复现留痕；复用 BLOCK-214~220 pack 通道）/ 普通代码仓（仅 .git→轻量默认：checkpoint+测试绿才完成）/ 空白探索（零规则，放权坡道兜底）；规则包可叠加、可关、可自定义（用户加一条规则进 pack 不动引擎）。验收=同一引擎对三类工作区各挂载正确规则包且互不泄漏（Petri 开发规则绝不出现在生信项目里），契约测红绿。
  - P1 规则源抽取：治理 skill 四件（governance/dev-infra/code-review/css-theme）按「可机械执行 / 判断标准 / 价值边界」三分类逐条盘点表（acceptance/block-337/rule-triage.json），可机械项落 `resources/skills/petri-governance-runtime/`（Petri 产品 skill 形态，规则条目结构化 JSON + 人可读 SKILL.md）。
  - P2 自动装载：项目 workspace_path 命中「含 DOC-REGISTRY.json 的受治理仓库」时自动挂载治理 skill + 注入未决 AUDIT-LOG 🔴/🟢 项为开工前置（system-prompt 动态段，CK-04 预算内）；非受治理仓零变化。
  - P3 并行协议（机械互斥）：registry 新增 `touchSurface`（文件面 glob）+ `sharedBaselines`（test/knip/lint/model-surface 基线）；`helpers/parallel-contract.js` 纯函数：两 active 包 truthDomain 不相交 ∧ touchSurface 不相交 ∧ 不双改 sharedBaselines → 放行并行，否则排队；docs:check 新增门（active>1 时必过）；合并顺序规则=先收口先合、后者 rebase 重跑门禁（写进 closeout 判定）。
  - P4 收口硬判定：workflow 新增 `closeout` 宿主原语（复用 336/335 的 verify 原语链）——completed 声明必须附 closeout 全绿 + 台账回写 diff；不绿即 blocked，不可宣称。
  - P5 自动落账：收口 phase 自动生成 NEXT-STEP-BRIEF 固定块 + AUDIT-LOG 行 + handoff 恢复要点（模板化，人可读视图不变），人只改判断与裁决。
  - P6 实机：Petri 仓库作为工作区打开 → 治理 skill 自动在场 → 两个人造 active 包（不相交/相交）各一轮并行校验 → 一次完整收口 phase 自动落账与人工手写逐字段对账。证据 acceptance/block-337/。
  - P7 自我边界三防线（用户追问 2026-11-02「工作属性认知有局限，怎么保证容纳万物」；回答=不追求容纳，追求「被没预见的场景撞上时不坏、能学」）：①**引擎无知**——内核零业务词汇，契约测扫描引擎源码不得含任何规则包词表（包/QC/PR/closeout 等）；②**空规则合法且默认**——未识别工作区=零规则+放权坡道兜底，agent 全功能可用，规则是后置沉淀不是前置要求；③**规则候选沉淀与退化**——坡道观察数据聚合「重复模式」（同类项目里反复执行/反复被拦/每次都跑的验证步）进复盘面供确认入包；规则条目带 origin: observed|authored 与命中/误拦计数，误拦率超阈自动降级为观察档等人复盘（规则能长出来也能退化，规则包不只增不减）。验收=三防线各有契约测；一个全新类型工作区（无任何识别特征）走通零规则全链。
reopen: 治理规则包的跨仓移植（PORTING 已有先例，v1 只对 Petri 自身）；判断标准（code-review 六维度）接 judge 读数作为评审判定器（需 Jev 密钥）；规则条目的用户面编辑 UI（v1 文件编辑）。
---

# BLOCK-337-GOVERNANCE-RUNTIME — 治理运行时化 + 并行协议计划

- 立项裁决：用户 2026-11-02「需要的」（承接问答：worktree 解决物理隔离、并行真瓶颈=真相同步；规则不应靠人设定文件、软件应自带工程化能力）
- 登记状态：**completed**（2026-11-03 第二批 P2/P3/P4/P5/P6/P7③ 收口，见 §3.1；第一批 P0/P1/P3 纯函数/P7①② 见 §3）；队列建议 336 → 337 → 334 收口 → 335（335 是本包的第一个重度用户：改自己时治理规则即其工作教养）
- 唯一真相域：本文件（block-337-governance-runtime）
- 文件面隔离：resources/skills/ 新包、helpers/parallel-contract.js、system-prompt 动态段、docs-governance 脚本、workflow 宿主原语；与 334 前端零交叠，与 336（git 工具面/项目层）仅共享"项目打开"钩子（接口约定后互不改对方文件）。

## 1. 三分类原则（规则文档的终态形态）

| 类 | 例 | 去向 |
| --- | --- | --- |
| 可机械执行 | 先读 AUDIT-LOG、单包串行、收口必跑门禁、事故转契约测 | **运行时化**：装载/校验/拦截，文档退役 |
| 判断标准 | code-review 六维度、css token 阶梯、评审分级 | **留 skill**：判定器读取的规则源，人可改 |
| 价值边界 | 产品魂、G0 纪律、不外推 G1+ | **留 AGENTS.md**：人定，稳定，少量 |

预期：四治理 skill ~2000 行操作规程，运行时化后留存 <1/3（判断+价值），且留存部分近乎不变。

## 2. 红线

- **引擎不得内嵌任何项目专属规则**（Petri 自己的治理规矩只是第一个规则包，不是引擎的一部分）；生信项目挂载的是 bio pack 规则，软件工程纪律对其零可见。

- 事实存储（AUDIT-LOG/handoff/registry）不消失——从人写变 agent 自动落账 + 人可读视图；单一事实源不变。
- 并行放行必须机械可判（registry 校验），不靠 agent 自觉；相交即排队，宁慢勿腐。
- 收口 completed 声明不可绕过 closeout 全绿；治理违规走放权坡道拦截（observe 档先观察）。
- 引擎永远不「预见」工作类型：新场景的正确反应是多记观察、不是报错或套用既有规则。
- G1+ 不外推。

## 3. 第一批收口记录（2026-11-02：P0 / P1 / P3 / P7①②③ · P2 prompt 层）

**P0 引擎/规则包分离（地基已立）**：新 `core/shared-backend/governance/workspace-rules.js`——**引擎零业务词**（只有谓词求值 `pathExists/globExists/gitRepo/all/any/not` + 包装载 + 规则投影），三个规则包 JSON 落 `resources/governance-packs/`（`software-governed`〔Petri 自身，detect=DOC-REGISTRY+AGENTS，priority 100，auditSource=docs/AUDIT-LOG.md〕/ `bio-analysis`〔fastq/bam/h5ad/counts 数据特征，priority 50〕/ `code-light`〔git 且无 DOC-REGISTRY，priority 10〕）；未匹配 = `blank`（零规则，合法默认）。契约测验证**互不泄漏**（软件纪律不出现在生信段、反之亦然）与优先级（Petri 仓里放了 counts.csv 仍挂软件包）。

**P1 规则源盘点**：`acceptance/block-337/rule-triage.json` **25 条**（mechanical 11 → 已落包 JSON 运行时化；judgment 9 → 留 skill；boundary 5 → 留 AGENTS.md）；新增双向不漂移契约测（盘点表 mechanical 条目必须都在包里、包内规则必须都进盘点表）。

**P2 自动装载（prompt 层完成，调用侧待接）**：`renderGovernanceRuntimeSection` 受治理仓 → `[必须]/[判断]` 规则条目 + 包声明 `auditSource` 的未决审计前置（🔴🟢，🟡 不算前置）；blank → `''`。`system-prompt.js` 的 desktop-project 分支在 `context.workspacePath` 存在时注入（try/catch 不阻断）。契约测钉死：受治理仓注入 / **无 workspacePath 零影响 / 非受治理仓零变化**。**待接**：会话组装侧把真实 `workspacePath` 放进 context（chat/agent 的 context 组装点），接完这条线「项目打开即装载」才端到端成立。

**P3 并行互斥（纯函数完成，registry 集成待接）**：新 `helpers/parallel-contract.js`——`canRunInParallel` 三判据（truthDomain 不同 ∧ touchSurface 不相交 ∧ sharedBaselines 不相交；glob 交集只做**保守可判子集**：精确相等 / 目录前缀覆盖，单层通配不投影不判相交）+ `validateParallelSet` 全表两两校验。契约测含前缀边界反例（`core/alpha/**` 不覆盖 `core/alpha-beta/**`）。**待接**：docs-governance 脚本 active>1 时强制跑该判定 + registry 条目补 `touchSurface/sharedBaselines` 字段。

**P7 三防线**：①引擎零业务词契约测（扫 `workspace-rules.js` 源码不含 doc-registry/agents.md/closeout/fastq/counts.csv/生信 等——注释都不许）；②未识别工作区零规则不抛错；③`governance/rule-lifecycle.js` 误拦账本（hit/misfire 计数，misfires≥3 且误拦率≥0.5 自动降级 `observe`，人工复盘 `reset`，JSON round-trip）。③的 reopen=放权坡道 observe 档数据接入账本（P5 落账时接线）。

**抓真三处（契约测先红后修）**：① `loadGovernancePacks` 投影丢 `auditSource` 字段 → 审计前置静默缺席；② 账本 `recordOutcome` 以单数 outcome 为键写复数字段 → 计数全 NaN、降级永不触发；③ 审计摘要的 markdown `**` 未剥 → 前置断言不匹配（顺手改为渲染友好剥除）。

**门禁**：337 契约测 **13/13** · prompt 邻域 27/27 · `test:changed` 250 项 249 绿（唯一红=p6 脏树，提交自愈）· `quality:lint` 0 error。

**未做（后续片）**：P2 调用侧接线（context.workspacePath 数据流）/ P3 registry 集成 + docs:check 并行门 / P4 closeout 宿主原语 / P5 自动落账 / P6 实机（四类工作区 + 并行校验 + 收口落账对账）/ P7③ 坡道数据接入。

## 3.1 第二批收口记录（2026-11-03：P2 / P3 / P4 / P5 / P6 / P7③ —— 整包 COMPLETED）

**P2 调用侧接线（端到端成立）**：新 `core/petri-server/helpers/session-workspace.js`——`applySessionWorkspacePath` 从 `projects` 表派生 `workspace_path`（`db.getProject`，ssh 项目 null → 无治理上下文），**客户端传值一律覆盖/剥除**（伪造路径骗挂治理包的机械防线）；接线两点 = `routes/ai-chat.js`（chat 入口）+ `agent-runner.js` ctxForPrompt（主链/resume/子代理三路单点）；`system-prompt.js` 把 `context.governanceLedgerEntries` 透传给渲染器（P7③ 渲染侧消费）。

**P3 registry 集成 + docs:check 并行门**：`scripts/docs-governance.mjs` 的 `MULTIPLE_ACTIVE_WORK_PACKAGES` 硬失败退役，改为**并行契约机械判定**——active>1 时各条目必须声明非空 `touchSurface` + `sharedBaselines`（空数组=显式「无」，未声明即拦下），再 `validateParallelSet` 两两判定，任一冲突 → `PARALLEL_CONTRACT_CONFLICT` FAIL（相交自动排队）；首个载体 = BLOCK-337 registry 条目（touchSurface 11 globs + sharedBaselines 3 基线）；`docs/document-governance.md` §2.1 改判「串行默认，并行互斥是机械例外」。

**P4 closeout 宿主原语**：`workflow-runner.js` host 增第七原语 `closeout`（照 recipe deps 注入先例，唯一执行路径 = `deps.closeout`；verdict 不进 resume 前缀表——缓存=伪造收口）；生产 deps = `core/petri-server/helpers/closeout-host.js` 子进程跑**同一个** `closeout-gates.mjs`（不建第二套门禁判定）；`routes/ai-agent/workflow.js` 接线。verdict ready=exit 0；blocked/failed/unavailable 如实分档，journal 落 `closeout` 行。

**P5 自动落账**：`core/shared-backend/governance/closeout-ledger.js` 三块纯函数渲染（NEXT-STEP-BRIEF 固定块 8 行 / AUDIT-LOG 处理记录行 / handoff 恢复要点），缺槽位 `<待补：x>` 占位绝不编造；ledger 载荷只在 closeout 全绿时由宿主渲染并入返回值 + journal（人只改判断与裁决）。

**P7③ 坡道观察接入账本**：新 `governance/observation-bridge.js` 纯函数（`pack::rule` 全限定行喂包规则生命周期，裸 id/工具名进 `observed::` 候选命名空间；复盘 `decision='misfire'` 整行命中迁为误拦，未复盘乐观计命中）；`policy-observation-store.js` 加性 `review_decision` 列 + `listRuleObservations` + 复盘路由 decision 透传；`rule-lifecycle.js` 抽 `statusFromEntry` 单一阈值实现（账本本体与渲染侧共用）；`workspace-rules.js` 渲染侧降级 observe 的规则按 `[观察·待复盘]` 标注（未装账本零行为变化）。

**P6 实机（`scripts/block337-governance-live.mjs`，五腿 35/35 allPass，`acceptance/block-337/block337-p6-live-darwin.json`）**：L1 隔离后端 + mock 上游抓 **agent 主链**（生产主聊天路径 `/api/ai/agent`）上游实收 system prompt——四类工作区各挂正确规则包互不泄漏（sysLen 6789/6557/6465，blank 零注入）；L2 反伪造（客户端伪造 workspacePath 指向真受治理仓 → 治理段缺席 ×2）；L3 真 docs-governance 校验器不相交放行/同真相域拦截 + 真仓 `--check` 冒烟；L4 真 workflow runner + 真 closeout-host 子进程（便宜门子集 `--no_tests --gate gate:code-size`）→ ready + journal 落行 + 三块落账草稿与人工手写**逐字段相等**；L5 真 REST 复盘 `decision=misfire` → 账本桥 5 hits 迁误拦 → observe 降级 → 渲染 `[观察·待复盘]`。实机抓真五处：①探针消息太像闲聊走 chitchat 快路径绕过主 prompt（改真任务形态）；②embed 角色未绑 mock 回落真实 dashscope 网络挂起卡死链路；③chat preset 与 profile 同 id 才能被 agent 链解析（「模型配置不存在」）；④agent 主调用把静态前缀/动态上下文拆两条 system 消息，治理段在第二条（BLOCK-212 前缀缓存形态）；⑤closeout 旗标是 `--no_tests` 下划线形态。

**抓真 + 顺带修复（rider）**：`/api/ai/chat` 在 HEAD 上有既有潜伏缺陷——token_budget 的 `res.write` 先于 `setHeader` 隐式发出 200 头 → `ERR_HEADERS_SENT` → async 路由未捕获 → unhandledRejection → SSE 流永不关闭（产品主聊天已走 `/api/ai/agent`，此路径为退役遗留故未暴露）。随本包修复（setHeader+flushHeaders 前移），非本包文件面外溢登记。

**门禁**：337 契约 batch1 **13/13** + batch2 **10/10** · docs-governance **18/18** · prompt 邻域 27/27 · 实机 **35/35** · `test:changed` 159 项 158 绿（唯一红=p6 脏树，提交自愈）· lint 0 error。

G0 开发期常态 · 不外推 packaged/Provider/GA。
