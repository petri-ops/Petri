---
capability: petri-master-charter
status: active
goal: 确立 Petri 全局稳定总蓝图——把既有 canonical 权威层级明示为一张稳定的顶层导航图，穷尽索引全部在册工作面（能力域/方向纲/执行蓝图/候选池/裁决与签字），声明全局稳定层与变更评估，使任何 Agent 与用户都能一眼看到"全局有哪些摊子、以谁为准、没有遗漏"
acceptance:
  - 明确全局核心目标/范围边界/关键原则/约束条件，并锚定到既有 canonical 真源（不重定义、不造第二真相）
  - 穷尽索引全部在册工作面：9 类 kind、active/planned 顶层文档、执行蓝图波次、候选池、待裁决/待人眼
  - 明确稳定性要求：全局冻结项清单 + 变更评估流程 + 冲突解决规则
  - 建立完整性自检机制（可从 registry + state + canonical 现读复算，证明无遗漏）
  - 本文件=canonical 顶层导航（kind=reference），不启动工作包、不改运行时、默认行为不变
---

# Petri 全局稳定总蓝图（Master Charter · 2026-11-17）

> 用户裁决原话（2026-11-17）：「摊子铺的有点大 如果你漏掉了什么 我也不知道 你能否详细稳定下来呢 应该不仅仅是3D的内容 全局总蓝图」。
> 用户裁决原话（2026-11-25 · item 39）：「做」（阶段口径对齐文档）+「按通用 agent 重写」（G1 之后规划方向；科研路线归 bio 领域包自己的规划）。据 charter §5.2 触发条件①用户显式裁决，留痕本次变更。
> **本文件的性质（关键）**：Petri 的稳定顶层**早已存在**——愿景宪章、产品路线图、G0 永久基础、文档优先级链。本文件**不重造顶层、不替代任何 canonical**，而是做三件事：① 把分散在既有 canonical 里的稳定顶层**明示为一张图**；② **穷尽索引**当前所有在册工作面，回答"摊子有多大、有没有漏"；③ 声明**全局稳定性规则与冲突解决**。凡本文件与任一 canonical 冲突，以该 canonical 为准并同批修正本文件。

## 0. 为什么需要这份文件 / 它不做什么

- **做**：全局导航、稳定性锚、完整性对照表、冲突仲裁指引。
- **不做**：不定义新方向（愿景说了）、不排新产品阶段（路线图说了）、不决定当前任务（next-steps/blueprint 说了）、不改任何工作包状态（registry 说了）、不镜像各域细节（各专项 plan 说了）。
- **第二真相红线**：本文件所有"事实"均以**指针 + 状态快照**形式给出，并标注"现读口径与复算命令"；它本身不是任何事实的权威源。

---

## 1. 全局稳定层（冻结 · 长期不变）

### 1.1 文档权威优先级链（源自 `scientific-intelligence-os-vision.md` §1，冻结）

```text
长期方向与原则：scientific-intelligence-os-vision.md（长期方向宪章）
  ↓
产品阶段：v1-productization-roadmap.md（Stage 1→2→3→4 串行）
  ↓
当前工作：next-steps-roadmap.md（指针）+ next-work-blueprint-2026-11-16.md（执行 W1–W11）
  ↓
工程恢复：project-workspace-handoff.md（active/WIP/下一包）
  ↓
专项实施：当前工作包 plan + 验收证据（acceptance/）
```

**规则**：冲突时上层胜出；长期愿景与工程条件冲突时，不跳阶段出口直接实现远期架构（愿景 §1.1）。

### 1.2 长期北极星（源自愿景 §2，冻结）

> 建设一个**本地优先、证据驱动、可复现、可审阅、可随研究持续演化**的 Scientific Intelligence OS。

### 1.3 G0 永久基础（源自 `g0-living-foundation-plan.md` §1，冻结）

> G0 不是被 G1 替代的阶段，而是**永久存在的 Living Foundation**；G1～G6 只能建立在 G0 之上，任何上层能力破坏执行真相/科学诚信/持久化/复现/安全/兼容性即不得发布。

### 1.4 产品个性纪律（源自 AGENTS.md，冻结，改动需用户裁决）

- 人设：格物（Petri）= 本地主权、全链可审计、证据自证；以目标为输入、工具为手足、真实产物为交付；领域能力由已安装领域包按需放大。
- 魂：通用 agent 能力（编排/知识/工具/模型计量/可靠性五维）为主线核心；本地主权；可信与透明即能力；场景资产为放大器。
- 立项自检问句：「这个能力的形态与 ZCode/Codex 的差别在哪？本地可审计/治理透明/证据自证体现了吗？」——防照抄，不砍通用主线。

### 1.5 工程不变量（冻结）

| 不变量 | 来源 |
|---|---|
| `run_tool → tool_job → artifact truth`；UI 不造第二套状态真相；模型层不绕过确认/审计；Harness 不建第二执行器 | `v1-productization-roadmap.md` §2 |
| 单工作包串行；同一时间一个 active 包、一个进行中阶段 | `document-governance.md` §2.1 |
| IPC 必经 desktopBridge / 通道注册表；MCP 工具单一注册处；前端 TS strict、禁 zustand | `AGENTS.md` 架构要点 |
| G0 开发期常态：`qualificationEligible:false` 是常态，不外推 packaged/Provider/GA | `AGENTS.md` 阶段纪律 |

---

## 2. 全局范围边界（冻结）

### 2.1 范围内（Petri 关心的全部面）

| 面 | 权威真源 | 当前性质 |
|---|---|---|
| 长期方向 / 愿景 | `scientific-intelligence-os-vision.md` | active vision |
| 产品阶段路线 | `v1-productization-roadmap.md` / `next-steps-roadmap.md` | active roadmap |
| G0 永久基础 | `g0-living-foundation-plan.md` | active living-plan |
| 行业竞争力八维 / CP 包 | `agent-competitiveness-program.md` | planned vision（CP-1~22 已闭环） |
| Qoder 对标母纲 Q-MATRIX | `qoder-essence-absorption-plan.md` | planned vision（§6.5 清零） |
| 成果面 artifact-plane | `artifact-plane-direction.md` | reference 方向文档 |
| 当前执行蓝图 | `next-work-blueprint-2026-11-16.md` | active living-plan（W1–W11） |
| 全局待办队列 | `pending-work-backlog.md` | active roadmap（历史快照降级） |
| 工程恢复状态 | `project-workspace-handoff.md` | active handoff |
| 审计广播 | `docs/AUDIT-LOG.md` | active audit |
| 文档/Worktree 治理 | `document-governance.md` / `worktree-governance.md` | active governance |
| UI 产品化台账 | `ui-productization-audit.md` | active reference |
| 设计宪章 | `design-charter.md` | reference（稳定规范） |
| 3D 造物域稳定顶层 | `3d-authoring-domain-charter.md` | active canonical charter（本轮新增） |
| 跨计划执行投影 | `acceptance/.../SUPER-BLUEPRINT.md`（C-54） | non-canonical 投影 |

### 2.2 范围外（明确不纳入本 charter 决策）

- ~~任何 G1+（Provider 矩阵 / 公证签名 / GA / 远程发布 / dist staleness）——G0 阶段不启动、不视为缺口~~（2026-11-25 失效：主人裁决进 G1，按 `acceptance/g1-execution-plan-2026-11-24/EXECUTION-PLAN.md` 六序推进；本项从范围外移除，但对外动作与外部采购仍逐项等主人发令）；
- 通用 3D 引擎自研、神经文生 3D、把引擎引进渲染进程（3D charter §2.2）；
- Result Studio 资格线上调（维持 implemented_unverified / experimental、RS-P7 deferred）；
- 第二套执行器 / 第二真相文档 / 第二套 canonical 计划。

---

## 3. 全局关键原则（冻结）

1. **权威单一**：每类事实只有一个 canonical 真源；本 charter 与其派生文档均指针化，不复制事实。
2. **分层稳定**：稳定顶层（§1）与可演进实施层（§4）物理分离；后者可变、前者冻结。
3. **冲突上层胜出**：文档链冲突按 §1.1 优先链仲裁；域 charter 与其派生冲突按域 charter 仲裁；本 charter 自身冲突按对应 canonical 仲裁。
4. **证据等级诚实**：dev/packaged 边界内 verified 为当前最高证据；观感 pending_human_eye 不代签；未跑的门不冒充通过。
5. **单线程可恢复**：单工作包串行；WIP 零触碰；每步可从 registry + state + 证据恢复。
6. **零依赖默认**：新增依赖默认"不"，需 DEPENDENCY-CHANGE-CHECKLIST 四问 + 用户裁决。
7. **借形不改魂**：对标产品的形可借，Petri 的魂（本地主权/治理透明/证据自证/场景锚）不丢。

---

## 4. 全局工作面穷尽索引（可演进层 · 完整性对照表）

> 本节回答"摊子有多大、有没有漏"。口径=2026-11-17 现读 `DOC-REGISTRY.json`：从最初 607 → 含 charter 608 → **含端到端提示词/计划登记后 610**（work-package 404 / reference 134 / living-plan 15 / audit 32 / roadmap 5 / governance 9 / release 4 / vision 4 / handoff 3）；状态 completed 449 / active 51 / reference 82 / planned 6 / archived 17 / superseded 5。复算命令见 §6，读数随登记增减属正常。**绝大多数是历史 work-package，真正在决定方向的是下面这些"活面"**——这才是"摊子"的有效边界。

### 4.1 顶层方向面（active/planned，冻结或准冻结）

| 面 | 文档 | 状态 |
|---|---|---|
| 长期方向 | `scientific-intelligence-os-vision.md` | active |
| 产品路线 | `v1-productization-roadmap.md` | active |
| 当前工作指针 | `next-steps-roadmap.md` | active |
| G0 永久基础 | `g0-living-foundation-plan.md` | active |
| 竞争力八维纲 | `agent-competitiveness-program.md` | planned（CP-1~22 闭环） |
| Qoder 母纲 | `qoder-essence-absorption-plan.md` | planned（Q-MATRIX §6.5 清零） |
| 待办队列 | `pending-work-backlog.md` | active（历史快照降级） |
| 3D 稳定顶层 | `3d-authoring-domain-charter.md` | active canonical |
| 全局总蓝图（本文） | `petri-master-charter.md` | active canonical |

### 4.2 当前执行面

| 面 | 文档 | 状态 |
|---|---|---|
| 执行蓝图 W1–W11 | `next-work-blueprint-2026-11-16.md` | active living-plan；W1–W9 收口，W10/W11 排队 |
| 跨计划执行投影 | `acceptance/.../SUPER-BLUEPRINT.md`（C-54） | 六档排序（清账→裁决→W11→3D→W10→C-53→候选池） |
| 端到端执行提示词 | `next-phase-e2e-prompt-2026-11-17.md` | 批量裁决版：A 自动 / B 攒批 / C 立即停，观感零代签 |
| 端到端执行计划 | `next-phase-e2e-plan-2026-11-17.md` | 配套任务卡 + 批次单 B-1..B-10 + 集中裁决触发/验收 |
| 工程恢复 | `project-workspace-handoff.md` | active；串行 active 包=无 |
| 审计广播 | `docs/AUDIT-LOG.md` | 无 🔴/🟢 未决 |

### 4.3 待裁决 / 待签字 / 待处置面（用户动作，Agent 不代答不代签）

| 面 | 内容 | 出处 |
|---|---|---|
| 3D 五方依赖裁决 | U-3D-D1~D5（sand3d/three-live/Polyfork/img2threejs/立项） | `3d-authoring-dependency-ruling-2026-11-17.md` |
| Gen UI 裁决点 | U-G1 已入队；U-G2 路径 / U-G3 范围待裁 | `gen-ui-data-plane-evaluation-2026-11-17.md` |
| UI 观感签字 | UI-706/707（in_progress）、E 类人眼项 | `ui-productization-audit.md` / handoff §57–61 |
| post-h9 文档 D5 | 原件取回或裁决从 registry 摘除 | `docs/AUDIT-LOG.md` D5 行；docs:check 唯一既有红 |
| U 类六项 | 已于 2026-11-16 按推荐裁决维持现状销号；翻案需重新发令 | `u-e-decision-materials-reconciliation-2026-11-16.md` §9 |

### 4.4 候选池 / 长尾面（未排期，启动需裁决+立项）

| 候选 | 内容 | 出处 |
|---|---|---|
| C-50 | 中心化控制面（执行/数据留本地） | `pending-work-backlog.md` |
| C-52 余项 | UI 设计候选池 P2–P5（参考板/动效模式） | `pending-work-backlog.md` |
| C-53 | UI-DESIGN-QUALITY P0–P7 | AUDIT-LOG / backlog / C-54 第 5 档 |
| C-45 / C-47 | 上下文裁剪配对 / 文件树分页 | C-54 第 6 档 |
| MIGRATION-IDEMPOTENT | 迁移幂等（待发令） | AUDIT-LOG BLOCK-457 留账 |
| W10 规划大纲 | POST-H9 优化 / 竞争力纲 / QODER 吸收 | `next-work-blueprint` §114 |

### 4.5 质量与治理基础设施面（持续生效，不占串行槽位）

closeout 十一门 / quality:* 六门 / HK-01 红绿先行 / 棘轮基线 / hygiene / docs:check / ui:audit:check（见 `AGENTS.md` 与 dev-infra）；后台失败任务 4 条（已解决过程产物，见 `npm run state`）。

---

## 5. 稳定性要求与变更评估（全局契约）

### 5.1 全局冻结项（不可随意变更）

- §1 全部：文档优先级链、长期北极星、G0 永久基础、产品个性纪律、工程不变量；
- §2.2 仍成立的范围外项（不造第二真相、Result Studio 资格线不外推、通用 3D 自研等）——G1+ 相关项已于 2026-11-25 随进 G1 裁决移出范围外，但对外动作/外部采购仍逐项等主人发令；
- §3 七条关键原则；
- 各域 charter 的冻结项（如 `3d-authoring-domain-charter.md` §1–§4）——本 charter 统一管辖但不覆盖其内容。

### 5.2 变更评估流程（对全局冻结项）

1. **触发**：仅限 ① 用户显式裁决（阶段/方向调整）；② canonical 真源自身变更（愿景/路线图/G0 定义更新）；③ 治理/授权冲突。实现便利、阶段性简化不构成触发。
2. **影响面评估**：列出受影响的冻结项、所有需同步的派生文档、是否触及通用主线/资格线/第二真相。
3. **权威核对**：确认变更来源优先级高于被改项（按 §1.1 链）；否则拒绝。
4. **用户裁决**：保留原话与日期；Agent 不代答。
5. **三件套回写**：DOC-REGISTRY / README 入口 / AUDIT-LOG；派生文档（blueprint / 域 charter / C-54 投影）同批对齐。
6. **版本留痕**：§7 修订记录追加版本、日期、摘要、证据；旧结论不覆盖不删除。

### 5.3 冲突解决规则

| 冲突类型 | 仲裁 |
|---|---|
| 文档优先级链内冲突 | §1.1 上层胜出 |
| 本 charter 与任一 canonical 冲突 | 以该 canonical 为准，同批修正本 charter（本 charter 非事实权威） |
| 域 charter 与其派生冲突 | 以域 charter 为准 |
| C-54 投影与 canonical 冲突 | 以 canonical 为准，修正投影 |
| 用户裁决与 Agent 建议冲突 | 用户裁决优先（Jev 仅 advice） |

---

## 6. 完整性自检（如何证明"没漏"）

任何 Agent 可用现读命令复算本索引，确认无遗漏：

```bash
npm run state                      # active 包 / WIP / 未决 / 排队候选
node -e "const r=require('./docs/DOC-REGISTRY.json');const d=r.documents;const by={};for(const x of d)by[x.kind]=(by[x.kind]||0)+1;const st={};for(const x of d)st[x.status]=(st[x.status]||0)+1;console.log(d.length,by,st)"  # 文档全景
npm run docs:check                 # registry/入口/canonical 唯一性
```

自检清单（每次交付/收口核对）：
- [ ] §4.1 顶层方向面状态与 registry 一致
- [ ] §4.2 执行面 W10/W11 与 blueprint / C-54 一致
- [ ] §4.3 待用户动作项未被 Agent 代答/代签
- [ ] §4.4 候选池无遗漏、无擅自开工
- [ ] 新增 canonical 文档已登记且在本索引有位置

## 7. 修订记录

| 版本 | 日期 | 变更摘要 | 触发/证据 |
|---|---|---|---|
| v1.0 | 2026-11-17 | 初始建立——明示既有稳定顶层 + 穷尽索引全局工作面 + 稳定性契约 + 完整性自检 | 用户裁决「能否详细稳定下来……不仅仅是3D的内容 全局总蓝图」 |
| v1.1 | 2026-11-25 | 阶段口径对齐：§2.2 移除已失效的「任何 G1+ 范围外」项、§5.1 同步；按 §5.2 变更流程留痕 | 主人裁决原话「做」（阶段口径对齐）+「按通用 agent 重写」（G1 之后方向），Orca item 39 msg_9ff95131f005；核真 `acceptance/item39-phase-alignment/ITEM39-VERIFICATION.md` |

G0 永久 maintained · G1 进行中（六序按令推进）。
