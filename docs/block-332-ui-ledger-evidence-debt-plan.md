---
capability: block-332-ui-ledger-evidence-debt
status: completed
goal: 把 UI 台账的「证据债」从不可计数变成可管理：①用段首状态解析给出可信计数（替代 grep -c）；②把已有裁决但状态字段没落的条目改正；③给台账装状态契约与债上限棘轮，防止新条目悄悄堆债。补各条目的实机腿按分诊结果另立批次，不在本包。
acceptance:
  - 测量腿 scripts/ui-ledger-triage.mjs → acceptance/block-332/ui-ledger-triage.json：台账 451 段 / 442 唯一 id；verified 411 / closed 11 / live-missing 6 / blocked 23；unknown 0；同 id 双开 0；债 = live-missing + blocked = 29。
  - 状态契约 test/ui-ledger-status-contract.test.mjs 4/4：段首合法状态词（verified/in_progress/cancelled/superseded）/ 同 id 至多一段未闭合 / 债上限棘轮（6+23）/ 证据与台账同构可回读。
  - 状态规范化 13 处（§3 逐条列明，全部有台账内既有裁决原话支撑，不新增判断）。
  - npm run ui:audit:triage 一键复现测量；impact-map 登记 block332 规则。
reopen: 逐条实机补腿（分诊表 live-missing 6 条 + blocked 中环境触发项）按批次另立包；同 id 双段（UI-458/459/460/470）属于历史编号复用，台账内已声明「去重留后续轻量批」，本包不重建历史段。
---

# BLOCK-332 — UI 台账证据债分诊与状态规范化

状态：**completed（2026-11-02 当日立项当日收口）**
truthDomain：`block-332-ui-ledger-evidence-debt`
canonical 入口：本文件

## 1. 裁决来源

用户 2026-11-02「行的 按照建议推进」——承接上一批收口时 `next:suggest` 的单一建议 `ui-evidence-debt`（Jev 不可用 `jev_unavailable:no_key`，按队列序兜底，已如实标注）。

## 2. 为什么先量：`grep` 数出来的债是假的

`grep -c in_progress docs/ui-productization-audit.md` = **218**。按段首状态解析 = **29 条真正未闭合**。差异三处：

1. 历史「最后更新」链行里也写 `in_progress`，但它们不是条目状态；
2. 段首存在两种叠加写法：`**in_progress（…）**` 与 `in_progress → **verified（…）**`，后者按"最后一次出现"才是真值；
3. 同一 id 可能有多段（UI-185 曾有 **6 段**、UI-458/459/460/470 各有 2 段），按段计数虚高。

台账自己在 2026-10-25 就登记过「UI 台账精确状态计数待单独规范化」。本包把这句待办变成机械面。

**实测（`npm run ui:audit:triage`，证据 `acceptance/block-332/ui-ledger-triage.json`）**：

| 桶 | 段数 | 含义 |
| --- | --- | --- |
| verified | 411 | 已验收 |
| closed | 11 | 已判销 / 已被取代（cancelled + superseded） |
| live-missing | 6 | 实现完成、依赖已齐，**可补实机腿** |
| blocked | 23 | 依赖未齐或依赖外部条件 |
| unknown | **0** | 段首无合法状态词（台账缺陷，门禁即红） |

债 = live-missing + blocked = **29**；同 id 双开 = **0**。（2026-11-02 BLOCK-333 补腿后：UI-639a 翻 verified → live-missing 6→5、债 29→28，棘轮已下调）

## 3. 状态规范化（13 处，全部有台账内既有裁决支撑）

| 条目 | 原状态 | 新状态 | 依据（台账内原文） |
| --- | --- | --- | --- |
| UI-185（主体段） | `active`（无合法词） | `superseded` | 「2026-10-30 RW-02 d 档改判：审阅面已由 UI-204/249 系列承接，本笔录降级为历史参考」 |
| UI-185 PHASE 1/2/3（4 段） | 无 / 表格内 in_progress | `superseded` | 同上（历史阶段笔录） |
| UI-185 综合笔录 | 改判说明在括号内 | `superseded` | 同上 |
| UI-197 | `active` + 判销说明 | `cancelled` | 「判销 2026-10-30 RW-02 d 档：审阅模式已由 UI-204/228/229 承接」 |
| UI-505 | `in_progress` + 判销说明 | `cancelled` | 「判销 2026-10-30 RW-02 d 档：仓库卫生棘轮条目非 UI 面，knip 门禁数据即证据」 |
| UI-524 | `in_progress` | `verified` | 「RW-02 d 档改判：纯判定层抽离零可见行为变化，组件测试即证据，移出 UI 实机腿验收域」 |
| UI-485 | `in_progress` | `verified` | 「RW-02 d 档改判：机械改名非单点可见 UI 面，theme-token-contract 17/17 即证据载体」 |
| UI-461 | 无状态词 | `verified` | 条目自带「守卫 3/3 + 相关 170/170 + tsc 0，UI 面零视觉/交互变化」 |
| UI-200 | `active`（无合法词） | `in_progress` | 本轮核对：`CodeMirrorDiffView.tsx` 已投产（`ReviewMode.tsx` 引用）+ 组件 8/8，缺实机过目 |
| UI-595 | 「降档 b」叙述（无状态词） | `in_progress` | 条目自带「降档 b：组件级 62/62 已锚，待图像 artifact 在结果面打开」 |

**只改状态词，不改任何裁决结论、不动证据段。** 判销/改判都是台账里早已写下的结论，本包只是把它们落到可计数的字段上。

## 4. 分诊表（权威处置，脚本分桶只是启发式预分类）

**可补实机腿（live-missing 6）**

| 条目 | 补腿前提 | 处置 |
| --- | --- | --- |
| UI-639a | Model3D 工作区 + 约束 section | **已完成（BLOCK-333 实机 13/13，翻 verified）** |
| UI-475 | 未配置识图的模型 + 贴图/拖图 | dev 栈可做（需 mock 一个无 vision 的模型） |
| UI-522 | 设置面渠道导出实机产物 | 可做，需真实设置面走查 |
| UI-534 | **UI 控件未交付** → 实为交付债 | 转交付候选，不属证据债 |
| UI-595 | 需图像 artifact 在结果面打开（UI-638 同前提） | 随结果面 artifact seed 批 |
| UI-526 | **需 R 运行时（用户 2026-10 已裁决暂缓）** | 阻塞在授权，不属本轮范围 |

**仍受阻（blocked 23）按类归因**

- 需真实环境/数据（环境触发，触发即补）：UI-388（IPv6 黑洞）、UI-471（真隧道 probe）、UI-532（真实 tool_jobs seed）、UI-535（异常组件注入）、UI-458/UI-459（retention 老化数据）、UI-639（同 UI-532）、UI-522 之外的导出链。
- 需用户裁决/授权：UI-526（R 运行时暂缓）、UI-656（测试面守卫，无实机面可验）。
- 待交付（不是证据债）：UI-513、UI-521（RW-02 d 档已改判为「UI 面未交付/非可见面」）、UI-534。
- 待复核（本轮未逐条复核触发条件，**不冒充已判档**）：UI-382～UI-391 族 10 条、UI-304、UI-326、UI-331、UI-456、UI-200。

## 5. 机械门禁（防回潮）

- `npm run ui:audit:triage`：一键复现测量并落证据（只读台账）。
- `test/ui-ledger-status-contract.test.mjs` **4/4**：段首合法状态词 / 同 id 至多一段未闭合 / **债上限棘轮**（live-missing ≤6、blocked ≤23，只许下降）/ 证据与当前台账同构（防「证据是旧快照」）。
- 口径单一源：分诊逻辑只写在 `scripts/ui-ledger-triage.mjs` 并导出 `triageLedger()`，测试 import 它——不在测试里重写第二套解析。

## 6. 非范围

- **不补各条目的实机腿**：补腿按 §4 的 live-missing 与环境触发项拆批另立（每批 2–3 条，需 dev 栈与真实数据面），本包不宣称任何条目的实机结论。
- **不重建历史段**：UI-458/459/460/470 的同 id 双段属历史编号复用，台账内已声明「去重留后续轻量批」，本包只保证「至多一段未闭合」，不改写历史内容。
- 不改 `ui:audit:check`（BLOCK 门禁本体）的判定逻辑，只补状态字段。

## 7. 验收

| 门禁 | 结果 |
| --- | --- |
| `node --test test/ui-ledger-status-contract.test.mjs` | **4/4** |
| `npm run ui:audit:triage` | 451 段 / 442 id / verified 411 / closed 11 / live-missing 6 / blocked 23 / unknown 0 |
| `npm run ui:audit:check` | PASS（台账与工作区同步） |
| `npm run docs:check` | PASS |
| `npm run closeout` | 见 AUDIT-LOG 收口行 |
| 邻域回归 | `block326-audit-debt-sweep` 5/5（state/verify 槽位未被改坏） |

## 8. 完成语义

`completed`＝状态词规范化落地（13 处）+ 4/4 契约 + 测量证据在册 + 门禁全绿。**不含**任何条目的实机补腿结论；`verified` 计数只增加本轮**有台账内既有裁决支撑**的 2 条（UI-524/UI-485）与本轮核对代码+组件证据的 1 条（UI-461）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
