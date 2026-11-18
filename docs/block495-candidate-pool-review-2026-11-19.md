---
capability: block495-candidate-pool-review
status: completed
phase: CLOSED
goal: W3 候选池转正评审（BLOCK-492 plan §3 W3 · 无人值守提示词 §5 S3）——候选池各条产出一页可裁决评审材料（现状/候选/风险/推荐/影响面/退出成本），状态一律 pending_user_ruling，不启动任何实现；启动与否归用户发令。
acceptance:
  - 六组候选逐条六段材料：C-45 / MIGRATION-IDEMPOTENT / BLOCK-490 / 母纲 C-35~C-40 / C-50 / C-56
  - 现状以仓库实况核对为准（含「候选已消亡」判定：C-45 已由 BLOCK-355 完成、C-35~C-40 已由 BLOCK-264 完成——W3 预设滞后于实况，如实钉死）
  - 状态一律 pending_user_ruling；零实现启动 / 零新依赖 / 观感零代签 / 不碰 G1+
  - 他方 WIP 零触碰（pending-work-backlog.md 原件、block490 评审稿原件、gateway-design.md 均只指不改）
  - docs 门禁 + closeout 定向 + 六件套回写 + commit/push
reopen: 用户对任一候选发令启动时，按该候选的推荐路径立项 BLOCK；候选池新条目入池时补录
supersedes: 无（评审材料=决策辅助，不改任何候选的 canonical 登记；backlog/registry 仍是登记真源）
---

# BLOCK-495 · W3 候选池转正评审材料（2026-11-19 现读）

日期：2026-11-19 · 执行依据：[`block492-full-work-execution-plan.md`](./block492-full-work-execution-plan.md) §3 W3 · 登记真源：[`pending-work-backlog.md`](./pending-work-backlog.md)（历史快照+活行）+ DOC-REGISTRY + `npm run state`

> **核对总结论（先读）**：W3 预设六组候选中，**两组已在早前包完成（候选消亡）**：C-45=BLOCK-355（2026-11-05）、C-35~C-40=BLOCK-264（十包连打，C-41~C-44 同批）——BLOCK-492 plan §3 W3 的这两项是登记滞后于实况，非新待办。**真候选四项**：MIGRATION-IDEMPOTENT / BLOCK-490 / C-50 / C-56，全部维持 pending_user_ruling，不启动。

## 1. C-45 · 工具消息配对熔断裁剪修复

- **现状**：**已消亡（BLOCK-355 完成，2026-11-05）**。BLOCK-348 T7 实锤的「裁剪破坏 tool 消息配对→provider 400」已修：`message-trimmer.js` 单元化裁剪（assistant(tool_calls)↔tool 链原子拾取，:71-95）+ `dropOrphanToolMessages` 防御层（:161-176，BLOCK-355 C-45 注记）；回归测试 `test/block355-trimmer-atomicity.test.mjs` 本包复跑 6/6 绿。backlog ✅ 行（C-45【2026-11-05 完成（BLOCK-355）】）。
- **候选**：无剩余——候选已闭环，仅存「回归面」由既有测试长期守护。
- **风险**：无（历史修复已有测试锚；若未来 trimmer 重构，测试即红线）。
- **推荐**：**关闭该候选**（无需用户动作；本材料仅把消亡事实钉进 W3 波次记录）。
- **影响面**：0（零改动）。
- **退出成本**：0。
- **状态**：`completed-elsewhere（BLOCK-355）· 无待裁决点`。

## 2. MIGRATION-IDEMPOTENT · 桌面 021 迁移与自愈补列幂等缺口

- **现状**：**真候选（AUDIT-LOG 🟡 2026-11-17 在册，未修）**。缺口机制（本包复核）：`core/petri-server/db.js:75` 加载期调 `ensureProjectWorktreeColumn`（`helpers/project-worktree.js`：PRAGMA 查列→缺则 `ALTER TABLE projects ADD COLUMN worktree_of TEXT`，**不记 schema_migrations**）；`src/migrations/021_project_worktree_of.sql` 裸 ALTER（runner 事务包裹、按 MAX(version) 判应用）。无头栈（dev-verify 直接 `node server.js`）先开旧库→自愈补列不记账→桌面壳 migration-runner 判 applied=20<21→021 重放→duplicate column 拒启。2026-11-17 实机案底=本机核实列定义一致后**手工补记 v21 解锁**（dev 数据零改动）；BLOCK-457 单一 spawner 根治后暴露面收窄，但无头验证流（`node server.js`）仍可触发。
- **候选**：①自愈补列成功后补记 `schema_migrations` v21（自愈升级为等效迁移，最小修）；②021 迁移幂等化（runner 层加列前 PRAGMA 预检跳过，SQL DDL 无法条件化，需 runner 或改 JS 迁移）；③仅登记例外+dev 流程规避（headless 流程文档加「先跑桌面壳」约束）。
- **风险**：①改动最小但把「自愈」与「迁移」两套语义进一步耦合（自愈承担记账=隐式迁移，需防版本跳跃误记——若库还在 v15，补列后记 v21 会跳过 16~20）；②runner 预检通用化更干净但触碰迁移内核，回归面大；③不修则新机/dev 流程仍可能复现（非破坏性，可手工解锁）。
- **推荐**：**候选①收窄版**——自愈补列成功后仅当 `MAX(version)===20`（即恰差 021 一版）才补记 v21，其余版本态不记（防跳版误记）；配 HK-01 契约测（自愈后 runner 重放 021 必须零错）。小体量（1 票内）。
- **影响面**：`helpers/project-worktree.js`（+10 行级）+ 新契约测试 + `src/migrations/` 零改动；影响所有含旧库的无头验证流。
- **退出成本**：低——单点函数+测试，可整体 revert。
- **状态**：`pending_user_ruling`（启动须发令立项）。

## 3. BLOCK-490 · capability-intake 能力扩展承接 Skill（D1–D8）

- **现状**：**真候选（立项评审稿已落档，D1–D8 全部 pending_user_ruling）**。评审稿=[`block490-capability-intake-review-plan.md`](./block490-capability-intake-review-plan.md)（他方/独立包条目，本材料不改其内容）；落地形态 Jev=CAPABILITY-INTAKE-SKILL 0.60 advice-only：把用户随时的外部能力扩展需求标准化为接收→解析→拆解→内化→候选登记→排队工作流，全程 provenance。
- **候选**：①按评审稿启动（建 skill 目录+发现桥+manifest，D2 关键=自动登记候选+评审稿、启动仍发令）；②先裁 D1–D8 中无争议项分批启动；③维持 planned（能力扩展需求当前仍走「用户发令→会话盘点」既有路径）。
- **风险**：①自动化登记与 G0 单包串行纪律的边界（D2 已按「登记≠启动」设计，残余风险=登记噪音增多，候选池膨胀需治理）；②skill 面新增=skills:check/registry 面维护成本；③不做则外部资料承接仍靠会话即兴，provenance 不保证。
- **推荐**：**候选②**——用户先裁 D2（自动登记+评审稿，启动仍发令）与 D8（边界），先行一个最小垂直切片（接收→登记→评审稿生成三步），跑通一轮真实需求后再裁全量 D1–D8。
- **影响面**：`resources/skills/`（新 skill）+ 发现桥两处 + skills:check 面；运行时零改（复用现成 Skill 链）。
- **退出成本**：中——skill 目录+桥可整体移除，registry 反注册；已登记候选条目是普通文档可保留。
- **状态**：`pending_user_ruling`（D1–D8 逐项，见其评审稿）。

## 4. 母纲产品包候选 C-35~C-40（K9/C14/D4/D1/E7/K4/L3）

- **现状**：**已消亡（BLOCK-264 完成，十包连打）**。backlog ✅ 行 C-35【BLOCK-264 完成】至 C-44 全绿（C-35 导入应用面+首启引导 / C-36 模型侧建议+Auto 定形 / C-37 model-access 族+定价缓存 / C-38 PiP（BLOCK-265 实机 verified）/ C-39 审批深定位 / C-40 浏览器连接器垂直切片 / C-41/42 设计合册 / C-43 批注契约 / C-44 pack 写桥）；registry BLOCK-264-CANDIDATE-BATCH notes「证据=定向 95/95+前端 51+closeout」；BLOCK-326 复核注记「C-35~C-44 池核实已全清」。
- **候选**：无剩余——该段候选池整体闭环。
- **风险**：登记滞后已造成 W3 预设失真（BLOCK-492 plan 引用旧快照）；同类滞后已两次（C-45/3D 蓝图 §10），模式=收口包完成后活行未即时翻面。已有机械门（state/registry 对账）兜底，残余=人工读旧表的 Agent 仍会踩。
- **推荐**：**关闭**；并把「读候选池先跑 `npm run state` + DOC-REGISTRY 现读」作为 Agent 纪律（本材料即执行此口径的示范）。
- **影响面**：0。
- **退出成本**：0。
- **状态**：`completed-elsewhere（BLOCK-264）· 无待裁决点`。

## 5. C-50 · 控制面中心化 / 安装版端口模型 / Linux 服务器化

- **现状**：**真候选（2026-11-17 登记，仅登记不开工）**。backlog C-50 行（本材料不改其行）：安装版端口形态=回环 3001（后端）+3002（SPA 静态），异于 dev 3000+3001；后端技术上 Node/SQLite 可 headless 跑 Linux，但当前产品是单用户本机形态（loopback 绑定、desktop-local 全权限、Electron preload 桥），不能直接当多人服务器；成立的战略理由唯一=「跨机 7×24 无人值守中心调度」，形态=控制面中心化（schedule/goal/租约/重试/预算/审计）+执行面与数据面留本地，不做云端 SaaS；与 ZCode/Codex 差别形态=中心只调度与审计，执行/凭据/产物主权在本机（产品个性纪律 §魂②③ 落点）。现状锚=Q7 agent_schedules+10s runner（只本机；cron/时区/跨设备/overlap/失败重试/agent 唤醒 reopen）。
- **候选**：①立项 P0 评审包（先答「中心权限边界到哪、本地主权从哪开始」两问，产出形态裁决材料）；②缩窄首片=仅「跨设备 schedule 同步只读视图」（无中心执行）；③维持登记（等用户真实场景出现）。
- **风险**：①大包（跨模块：网关/鉴权/租约/审计，P0 评审前置）；与 G0 单机形态的主线张力（撞「本地主权」魂的风险=中心权限膨胀）；③不做则 7×24 需求继续靠本机长开+隧道现状（已有 auto-sync/隧道纪律承载，BLOCK-85 家族）。
- **推荐**：**候选③维持登记**——该候选的重开条件（backlog 原文）就是「用户明确给出场景裁决」，无场景则评审材料空转；建议用户在有真实多机/常驻需求时再裁①/②。
- **影响面**：若启动=大（控制面服务+鉴权+租约+跨设备状态；网络面新增=产品级新依赖红线区）。
- **退出成本**：高（一旦建中心面，撤回=功能下线+数据迁移）；故更应等场景再动。
- **状态**：`pending_user_ruling（登记原样）· 重开条件=用户场景裁决`。

## 6. C-56 · 论文写作/修改保真 Skill

- **现状**：**真候选（2026-11-18 规划落档，planned/queued 仅登记不开工）**。backlog C-56 行（本材料不改其行）：把外部 humanizer/Humanizer-zh 的实事保真内核（确定程度/归因/完成状态保护、不编造数据/来源/经历 + 中文 F 类 6 项检查）内化为 built-in `writing/paper-writing` 产品 Skill——取内核弃外壳（不用「去 AI 味」，改用 claim 保真对照+改写 diff+provenance+未覆盖说明）；复用现成 Skill 发现→加载→门控→治理链，零新依赖；归属长期愿景 §2 论文链路，G0 当前不建设；不进母纲 Q-MATRIX、不进 active roadmap；触发=任务识别为论文写作/修改时 skill_discover 语义匹配。
- **候选**：①启动（显式发令+canonical plan+三件套，按 backlog 行完整方案）；②先做手册内容稿（纯文档，不建 skill 注册面——手册文本可先行评审）；③维持登记。
- **风险**：①skill 注册面新增（skills:check/manifest/builtinSha256 链路维护）+ 学术判断边界（红线已预置：事实保真不可被模式命中覆写/方法结果段数字锁定只校验不改/观感归人）；②手册稿先行无风险但「内容 vs 注册面」分离评审可能产生二次返工；③不做则论文保真需求继续靠通用会话+人工检查（现状可用但无结构化保障）。
- **推荐**：**候选②先行**——用户裁决「肯定是要安排上的」（2026-11-18），方向已定；体量最小且零注册面风险的推进步=先出手册内容稿（十节形态对标 design-brief 先例）供人眼评审，认可后再裁①（注册面+发现桥+治理链一次收口）。
- **影响面**：候选②=纯新增文档（零运行时）；候选①=`resources/skills/`+manifest+skills:check 面+发现桥。
- **退出成本**：候选②≈0（删文档）；候选①=低-中（skill 反注册+桥移除，手册保留为文档）。
- **状态**：`pending_user_ruling（方向已裁「安排上」，启动时机与形态待发令）`。

## 7. W3 波次级备注

- **登记滞后模式（本波第 3 次抓到）**：C-45（BLOCK-355 已完成但 W3 预设仍列为候选）、C-35~C-40（BLOCK-264 已完成）、3D 蓝图 §10（BLOCK-493 已对齐）——治理含义：候选池「活行翻面」滞后于包收口是系统性模式；机械面（state/registry 对账门）已在，残余在「人工读旧快照」。本材料按「现读优先级：命令输出 > Git/源码 > 证据 JSON > 文档」执行，即示范。
- **不启动承诺**：本波零实现、零依赖、零注册面变更；所有「推荐」均为 advice，启动与否归用户发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- 六组候选材料齐、六段全、状态全 pending_user_ruling；两组消亡判定附实况证据指针（BLOCK-355 测试 6/6 复跑/BLOCK-264 registry notes+backlog ✅ 行）。
- docs:check PASS（647 registered）+ ui:audit:check 绿；本波零测试面变更（docs-only，无需定向测试）。
- 提交：8541aeae（立项+交付批）+ 本批（台账批）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
