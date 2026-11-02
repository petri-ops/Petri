---
capability: block-337-governance-runtime
status: planned
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
- 登记状态：**planned**；队列建议 336 → 337 → 334 收口 → 335（335 是本包的第一个重度用户：改自己时治理规则即其工作教养）
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
