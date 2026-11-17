# Petri 下一阶段超级总蓝图（Projection / Index · 2026-11-17）

## 0. 定位与权威边界

本文件是**跨计划投影与执行索引**，不是第二份 canonical 计划，不启动工作包，不改变产品行为。

- **权威真源**：
  - `docs/next-work-blueprint-2026-11-16.md`：active living-plan，W1–W11 总纲；
  - `docs/3d-authoring-domain-blueprint-2026-11-17.md`：3D 专项规划材料（当前他方 WIP / planned）；
  - `docs/gen-ui-data-plane-evaluation-2026-11-17.md`：W11 Gen UI 决策材料（当前他方 WIP / active reference）；
  - `docs/AUDIT-LOG.md`：阶段广播与工作包 plan 锚点；
  - `docs/pending-work-backlog.md`：候选池与队列投影；
  - `docs/DOC-REGISTRY.json`：active / planned / completed 状态真相。
- **本文件作用**：把上述真源按“清账 → 裁决 → 工程包 → 接续包 → 候选”投影成一张执行视图。
- **冲突规则**：与 canonical 不一致时，以 canonical 为准；本文件必须同批回写修正。
- **状态**：`planned / index / non-canonical`；不占串行槽位。

### 0.1 权威边界矩阵

| 事实 | 唯一权威 | 本文件权限 | 冲突处理 |
|---|---|---|---|
| W1–W11 波次、living-plan 状态 | `docs/next-work-blueprint-2026-11-16.md` | 只读投影排序 | 以 living-plan 为准，修正本文件 |
| 3D 蓝图内容、U-3D 裁决状态 | `docs/3d-authoring-domain-blueprint-2026-11-17.md` | 只读引用 | 以 3D 专项蓝图为准 |
| W11 路径、差距、推荐 | `docs/gen-ui-data-plane-evaluation-2026-11-17.md` | 只读引用 | 以 Gen UI 评估为准 |
| 工作包启动 / completed / closed | `docs/DOC-REGISTRY.json` + 对应 plan | 不登记、不改状态 | 以 registry 为准 |
| 阶段广播、裁决留痕 | `docs/AUDIT-LOG.md` | 只在同提交追加本文件落档记录 | 不覆盖既有广播 |
| 候选池编号与状态 | `docs/pending-work-backlog.md` | 只在同提交追加 C-54 行 | 以后备表为准 |
| 里程碑预测、依赖图、风险视图 | 本文件 | 可维护 projection | 不得反向改写 canonical |

### 0.2 非第二真相自检

- 本文件**没有** `kind: living-plan`、`kind: work-package` 或 `status: active` 的 plan frontmatter；
- 本文件**没有**注册为新的 canonical 文档；
- 本文件**没有**工作包 Plan ID，不进入 `DOC-REGISTRY.json` 的 active / planned 工作包集合；
- 本文件**不授权**任何工作包启动，启动仍须用户发令 + 原 work-package launch checklist；
- 本文件只生成“下一阶段怎么看、怎么排”的执行投影，所有状态变化必须回写权威真源。

当前 active 工作包：无。  
串行槽位：空。  
他方 WIP 零触碰：`acceptance/block-332/ui-ledger-triage.json`、`docs/DOC-REGISTRY.json`、`docs/README.md`、`docs/next-work-blueprint-2026-11-16.md`、`docs/3d-authoring-domain-blueprint-2026-11-17.md`、`docs/gen-ui-data-plane-evaluation-2026-11-17.md`。

---

## 1. 北极星与排序原则

### 1.1 北极星

让单工作包串行槽位**始终有高准备度、可收口、不空转的工作**，同时让高价值但高前置的工作在等待期完成裁决与探针。

### 1.2 五条排序权重

1. **前置清晰度**：材料和裁决门越齐备越优先。
2. **解锁效应**：先做能消除后续不确定性的小前置。
3. **落魂程度**：命中本地主权、证据自证、治理透明、场景锚越多越优先。
4. **风险与依赖**：零新依赖优先；外部依赖先裁决。
5. **体量**：用户动作与小清账不占串行槽位，可与工程包错峰。

### 1.3 一句话读法

> 用户清账 → 3D 依赖/立项裁决 → W11 Gen UI 首包 → 3D 首包 → W10 规划大纲 → C-53 UI 设计质量 → 候选池长期项。

---

## 2. 总览：六档工作序列

| 档位 | 工作 | 形态 | 是否占串行槽位 | 前置 | 当前动作 |
|---|---|---|---|---|---|
| 第 0 档 | UI-706/707 观感签字、E/H 类签字槽、post-h9 D5 处置、4 条失败后台任务 | 用户清账 + Agent 对账 | 否 | 用户/owner | 可随时做；Agent 不代签 |
| 第 1 档 | 3D 依赖与立项裁决 `U-3D-D1/D2/D3` | 小决策材料 | 否 | 依赖检查单 | 当前 Jev 首选，建议先写材料 |
| 第 2 档 | W11 Gen UI 数据面首包 P0–P2 | 工程包 | 是 | U-G2/G3/D8 发令 | 准备度最高，首个工程包候选 |
| 第 3 档 | 3D 造物域 P0–P1 | 工程包 | 是 | 第 1 档 + GLB extras 探针 | 高价值、高前置，接续 W11 |
| 第 4 档 | W10 规划大纲 | 规划/对账 | 视子项 | 用户显式裁决 | 先做闭环对账，不自动开工 |
| 第 5 档 | C-53 UI-DESIGN-QUALITY P0–P1 | 候选工程包 | 是 | 用户裁决提前 | 已落档，排队中 |
| 第 6 档 | C-50、C-45、C-47、MIGRATION-IDEMPOTENT | 候选池 | 是/视形态 | 场景或缺陷触发 | 短期不处理 |

---

## 3. 第 0 档：清账视图

### 3.1 用户动作

- UI-706 / UI-707 观感签字；
- E-01 树测试、E-02 人眼 debt、E-03 SUS / UMUX-Lite；
- H-01～H-08 UI 程序增量人眼项；
- post-h9 D5：原件取回或裁决从 registry 摘除；
- 3D / W11 相关 U 类裁决授权。

### 3.2 Agent 可清账动作

- 4 条失败后台任务用 `npm run task:status` / `task:wait` 对账；
- 记录历史失败原因与是否已解决；
- 不删除用户数据，不伪造成功。

### 3.3 完成判据

- 用户签字日期、覆盖断言、结论齐全；
- 未签字项仍写 `pending_human_eye`；
- `docs:check` 的 post-h9 红被用户裁决处置或有明确 deferred 留痕；
- 后台任务不再悬挂。

---

## 4. 第 1 档：3D 依赖与立项裁决

### 4.1 范围

产出一份小体量 reference / 决策材料，覆盖：

- `U-3D-D1`：是否引入 sand3d（`bpy` 重依赖）；
- `U-3D-D2`：是否引入 three-live 外部 MCP；
- `U-3D-D3`：3D 蓝图是否立项、首包范围与波次归属。

每项按依赖检查单回答：

1. 是否不可替代；
2. 许可证与维护度；
3. 影响面；
4. 退出成本；
5. 引 / 不引 / 隔离探针 / 自研替代建议。

### 4.2 为什么先做

- 这是 3D 整条线硬前置；
- 零产品行为变化；
- 小体量，可解除第 3 档不确定性；
- 当前 Jev 单一建议：3D 依赖裁决，confidence 约 0.85。

### 4.3 完成判据

- 三个 U 项各有现状、候选、风险、推荐、状态；
- 用户逐项裁决；
- 裁决回写决策材料和 AUDIT-LOG；
- 未裁决前不安装、不引包、不改 package manifest。

---

## 5. 第 2 档：W11 Gen UI 数据面首包

### 5.1 目标

把表达面从 `::visualize` HTML fragment 沙箱演进到“catalog 契约 + JSON spec 受控渲染”，但双形态并存、不替代。

### 5.2 前置

- U-G1：立项入队，已完成；
- U-G2：路径选择，推荐 A（借形自实现 mini spec 引擎，零新依赖）；
- U-G3：首包范围，推荐 P0–P2；
- D8：用户开工发令。

### 5.3 首包范围

- P0：catalog / spec 契约最小切片；
- P1：受控渲染路径；
- P2：审计单元与治理契约投影。

### 5.4 非目标

- 不退役 HTML 沙箱；
- 不重写 artifact-plane；
- 不触碰 Result Studio 资格线；
- 不引入新依赖。

### 5.5 完成判据

- 契约测试 + 受控渲染测试；
- 新旧双形态并存回归；
- 证据落 `acceptance/w11-gen-ui-data-plane/`；
- AUDIT-LOG / registry / UI 台账（如有 UI 面）同批回写。

---

## 6. 第 3 档：3D 造物域 P0–P1

### 6.1 目标

把 3D 从 Skill/工具堆砌，升级为“工具包 + Skill 包 + viewer 包、内核零改动”的造物域。

### 6.2 前置

- 第 1 档 D1/D2/D3 已裁决；
- 依赖路线明确（引入 / 隔离探针 / 自研替代）；
- GLB extras schema 探针方案明确。

### 6.3 P0：可行性探针

- 隔离环境临时安装（若用户允许）；
- 导出带 revolute / prismatic 关节的 GLB；
- 实测 extras schema；
- 验证到 Scene IR v0 的映射；
- 输出探针报告与 IR 契约草案。

### 6.4 P1：领域首包 L0/L1/L2

- 3d-authoring Skill；
- geometry runner wrapper + guard-ack；
- Scene IR 归一器 + 校验器；
- 一个可动装配端到端跑通。

### 6.5 完成判据

- Scene IR v0 契约测试；
- 可执行样例与 digest 证据；
- 失败降级诚实；
- 不动通用内核。

---

## 7. 第 4 档：W10 规划大纲

范围：

- POST-H9 优化蓝图；
- 竞争力纲；
- QODER 吸收。

当前判断：

- 后两者经大纲核对可能已闭环，但 canonical registry 仍显示 planned；
- 必须先做正式状态对账，再决定是否关闭或另立子包；
- 不因“口头判断闭环”自动改 registry。

---

## 8. 第 5 档：C-53 UI-DESIGN-QUALITY

### 8.1 当前状态

- 已落档为 `planned / queued`；
- plan 锚：AUDIT-LOG C-53 条目；
- 队列锚：pending-work-backlog C-53；
- 不 active，不启动。

### 8.2 计划

- P0 启动准备 / 基线冻结；
- P1 设计上下文包硬化；
- P2 IA 与高频路径；
- P3 视觉一致性；
- P4 响应式与可访问性；
- P5 性能与可信状态；
- P6 产品设计 Skill v1.1；
- P7 收口与人眼验收。

### 8.3 启动条件

- 用户显式裁决提前，或前面的 0–4 档完成后自然轮到；
- 他方 WIP owner 收口后再决定是否落 governed plan 文档；
- 不自行开包。

---

## 9. 第 6 档：长期候选池

| 候选 | 内容 | 重开条件 |
|---|---|---|
| C-50 | 跨机 7×24 中心调度 / Linux 服务器化 | 用户明确团队共享 / 常驻节点 / Web 一等入口场景，BLOCK 立项 |
| C-45 | 上下文裁剪破坏 tool 消息配对 | 缺陷票发令 |
| C-47 | 文件树分页观察项 | 实机观察触发 |
| MIGRATION-IDEMPOTENT | 迁移幂等 | 明确补丁场景与发令 |

---

## 10. 依赖图

```text
用户清账（第0档）
        ↓
3D 依赖/立项裁决 U-3D-D1/D2/D3（第1档）
        ├──────────────→ W11 前置 U-G2/G3/D8 ──→ W11 P0-P2（第2档）
        ↓
3D P0 探针（第3档）
        ↓
3D P1 领域首包（第3档）
        ↓
W10 规划对账（第4档）
        ↓
C-53 UI 设计质量 P0-P1（第5档，可用户裁决提前）
        ↓
长期候选池（第6档）
```

关键说明：

- 第 0 档可与任何工程阶段错峰，但不占串行槽位；
- 第 1 档是第 3 档硬前置，也是 Jev 当前首选；
- 第 2 档可与第 1 档的准备并行，但真正开工只占一个串行槽位；
- 单工作包串行，不开第二个 active package。

---

## 11. 里程碑与时间线（相对估算）

> 时间为规划单位，不是承诺；每项启动都要用户发令。

| 里程碑 | 工作 | 相对周期 | 出口 |
|---|---|---:|---|
| M0 | 用户清账 + 后台任务对账 | 0.5–1 天 | 视野干净，签字状态明确 |
| M1 | 3D 依赖/立项裁决材料 | 1 天 | U-3D-D1/D2/D3 用户裁决完成 |
| M2 | W11 P0–P2 | 1–2 周 | spec 引擎最小闭环 + 双形态回归 |
| M3 | 3D P0 探针 | 2–3 天 | extras schema 与 IR 映射报告 |
| M4 | 3D P1 首包 | 1 周 | 可动装配端到端 + truth 证据 |
| M5 | W10 状态对账 | 1–2 天 | registry / audit 状态一致 |
| M6 | C-53 P0–P1 | 1 周 | 设计上下文契约与样例设计说明 |
| M7 | 候选池重排 | 0.5 天 | 下一轮排序更新 |

---

## 12. 风险登记

| 风险 | 影响 | 处置 |
|---|---|---|
| WIP owner 未收口 | 不能改 canonical registry / blueprint | 只读引用，投影文档落 acceptance |
| Jev 与用户偏好冲突 | 排序争议 | Jev 仅 advice，用户裁决优先 |
| 3D 依赖未裁决先装包 | 破坏零依赖默认 | 未裁决前禁安装、禁 manifest 变更 |
| W11 扩成替代 HTML 沙箱 | 破坏双形态并存 | 非目标写死，回归旧沙箱 |
| 3D 探针环境差异 | golden digest 平台漂移 | 以 Linux CI 为基准，Win/Mac 如实登记 |
| 人眼未签字却翻 verified | 假完成 | 观感一律 pending_human_eye |
| 超级蓝图被当第二真相 | 治理冲突 | 冲突时 canonical 胜出，本文件同批修正 |
| 多包并行导致文件冲突 | 返工 | 单工作包串行；机械例外才放行 |
| 未来 3D/Gen UI 外部成本 | 成本失控 | 本地执行优先，外部 Key 与调用需 P5-a 确认 |

---

## 13. 资源与角色建议

| 角色 | 职责 | 主要档位 |
|---|---|---|
| 用户 | U 类裁决、人眼签字、阶段发令 | 第 0/1/2/3/5 档 |
| 主 Agent | 计划维护、依赖判断、收口审查 | 全程 |
| 只读探查子 Agent | 3D extras schema、three-live / sand3d 材料核对 | 第 1/3 档 |
| Skill / 文档 Agent | 3D Skill、C-53 context pack | 第 3/5 档 |
| 前端 / Gen UI Agent | W11 spec 引擎与双形态回归 | 第 2 档 |
| QA / dev-verify | 实机腿、异常注入、证据整理 | 第 2/3/5 档 |
| 治理 owner | DOC-REGISTRY、README、next-work-blueprint、AUDIT-LOG 回写 | 全程；WIP 未清时只读 |

---

## 14. 验收与测试策略

### 14.1 清账类

- `npm run state`
- `npm run task:status`
- `npm run docs:check`
- 人眼路线签字表

### 14.2 裁决材料类

- 每项 U 有现状 / 候选 / 风险 / 推荐 / 状态；
- 用户原文裁决；
- AUDIT-LOG 回写。

### 14.3 工程包类

- 定向测试；
- `quality:types` / `quality:lint`；
- `docs:check` / `ui:audit:check`（如涉及 UI）；
- `skills:check`（如涉及 Skill）；
- dev-verify 离屏实机；
- `test:changed` 红项逐条归因。

### 14.4 完成定义

- 每个阶段单独 closeout；
- 证据落 `acceptance/<package>/`；
- U / E / V 项如实标注；
- 超级蓝图只更新投影状态，不替代阶段 plan。

---

## 15. 维护规则

1. 每次用户裁决后，更新本文件对应档位状态；
2. 每个工作包 closeout 后，更新里程碑与风险；
3. 与 canonical 冲突时，先修本文件；
4. WIP owner 收口后，把本文件的稳定结论回写 `next-work-blueprint`，并保留本文件为历史投影；
5. 每次回写在 AUDIT-LOG 留一行，禁止静默改图。

---

## 16. 当前落地状态

- 本文件=超级总蓝图投影，状态 `planned / index / non-canonical`；
- 不启动工作包；
- 他方 WIP 零触碰；
- 当前 Jev 单一建议：3D 依赖/立项裁决材料；
- 下一步若用户发令，先写第 1 档决策材料，不直接装依赖、不开工程包。

G0 开发期常态 · 不外推 packaged/Provider/GA。
