---
capability: rw-02-ui-evidence-pack-write-bridge
goal: 两线并行——A) UI 台账 71 条存量 in_progress 按四档分诊清偿（CDP 代行取证 / 条件腿如实保留 / 人眼最小集集中一次 / 无证据链判销改判，禁止批量翻绿）；B) C-44 pack iframe 写桥前置（selection/revisions restore-replay/annotations/export 四类写操作白名单 + 上下文快照 + ack/审批与过期 + 项目归属 + pack 缺失/停用/版本不匹配回退，沿用既有 UI action/审批通道）。
acceptance:
  - 方向级验收 = 按执行纲 docs/remaining-work-execution-plan.md §3.2 执行；本 plan 是其立项展开。
  - 门禁级验收 = §5 门禁清单收口逐项对账（分诊表落 backlog/台账 + 每条四档处置留痕 + 可翻账条目翻 verified + 写面各一条真实写链 + 审批过期/权限拒绝/恢复）。
  - 证据级验收 = 翻 verified 只认仓内可核产物；人眼档（c）只产出测试路线与集中过目清单，确认必须出自人；不凑证据、不伪造实机断言。
status: active
---

# RW-02-UI-EVIDENCE-PACK-WRITE-BRIDGE 执行计划

最后更新：2026-10-30（**里程碑：B 线 completed + A 线 7/13 a 档 verified + d 档 28 条处置 + b 档 18 条注记 + c 档清单产出**。B 线=写桥契约 5/5+宿主 6/6+实机 9/9（70a4f230）；A 线 a 档已翻 verified=UI-598/543/596/462/303/594/331（rw02-ui-evidence-live 11/11）。**下一会话第一个动作**=A 线 a 档剩余 6 条（UI-248/301/385/484/595/638）——需种子管线（review diff 上下文/spawn 数据/task_events/结果面解析），每条先读台账断言目标再写探针；探查结论与逐条依据在 acceptance/rw-02-ui-evidence/triage.json。收口前置=A 线清零（a 档翻完或如实降档）。恢复协议：读本 §4.1 分诊表 + triage.json → 核对 git log → 续探针。）

## 0. 发令与授权留痕

- **用户裁决（2026-10-30）**：「能否一次性搞定所有内容呢 不需要我的参与」= RW-01~06 六包串行全量预授权发令（预授权连续工作模式，2026-09-20 先例）。RW-01 已 completed。
- 人眼档（c）硬线：确认必须出自人——本包把 UI-501/503/504/457 及全部 c 档打包成**一份集中过目清单**（一次栈窗口），留待用户一次性确认；清单与测试路线本包产出。

## 1. 范围（in scope）

- **A 线（证据债）**：71 条 in_progress 四档分诊（a=CDP 批量代行取证翻账 / b=条件型实机腿如实保留触发条件 / c=人眼最小集集中一次 / d=无证据链按 P0 对账先例判销改判）；a 档经 dev-verify flow 批量取证翻 verified；旧探针 block298/299 只保留历史身份，当前契约探针按 BLOCK-300/303 之后语义重建。
- **B 线（C-44 写桥）**：pack iframe 写操作四类（selection / revisions restore-replay / annotations / export）白名单 + 上下文快照 + ack/审批与过期 + 项目归属校验 + pack 缺失/停用/版本不匹配回退；沿用既有 UI action/审批通道，**不建第二审批链**。
- UI 台账同步：每条处置同提交更新 docs/ui-productization-audit.md。

## 2. 非范围（exclusions）

- 不用新 UI 覆盖证据债；不为翻 verified 补拍形式化截图。
- C-35~C-43 候选产品包（C-43 画笔 v2 等）——本包只交付 C-44 写桥前置。
- G1+（packaged/Provider/GA）；R 运行时依赖的条件腿如实保留 deferred。

## 3. 依赖与前置

- RW-01 completed（成果面四线已接；UI-638 面板发现腿并入本包 A 线 a 档清偿）。
- BLOCK-236 只读数据桥（packTabData）+ BLOCK-217 pack UI actions host + BLOCK-243 审批契约 v2 = B 线复用基座。
- dev 栈：9223 离屏实例 + 主栈 :3001（证据批走主栈，隔离语义按 RW-01 先例）。

## 4. 设计裁决（探查回填）

- **D1 分诊判据**（盘点探查进行中，回填 §4.1 逐条表）。
- **D2 写桥白名单形状**：扩既有冻结契约 `core/shared-backend/pack-annotation-bridge-contract.js`（批注窄桥→四类写操作）。pack 侧权限仍由 pack.json `provides.resultSurfaces[].writes` **显式声明、宿主校验**（C-44 红线「写权限不得由 pack 侧自宣」=宿主校验声明，非 pack 运行时自宣）；消息统一上行 `petri:pack-write`（requestId + kind ∈ annotation|annotation-delete|selection|revision-restore|revision-replay|export）+ 下行 `petri:pack-write-result`；既有 `petri:annotation-write/delete` 作为 annotation kind 的别名保持兼容。
- **D3 审批/ack 复用**：pack 发起的写是**用户在 pack 面上的操作代理**（非 agent 动作）→ 走 host 侧 requestId 短 TTL + 去重（act-ack 同型纪律），落到既有核心 REST（selection.js / revisions.js replay+restore / annotations.js / methods-export）由核心自身授权（canAccessProject / projectContext write）把关——**不建第二审批链**；agent 发起的 export 仍走 generate_methods 既有 gates。
- **D4 项目归属**：projectId/conversationId 由 host 注入快照（pack 只能写自己 surface 绑定的项目），pack 消息里的归属字段一律忽略（防越权声明）。
- **D5 版本门**：resultSurfaces.writes 声明带 `bridgeVersion`（本包=1）；host 对 pack manifest 的 resultSurfaces 版本做最小版本校验，不满足按「未声明写能力」回退（写动作不出现）。
- **D6 回退**：pack 停用/缺失 → scheme.js 404 已兜底 + resultSurfaceHost core-transitional 回落已存在；写桥在停用/回退态直接不挂消息监听（写动作不可达）。

## 4.1 A 线分诊表（P1 盘点探查回填，2026-10-30）

**实测 62 条**（台账旧口径 71 = 含 UI-448 加映 v15-v28 已整批 verified 与旧 G0 RS P 系）。四档计数：**a=13 / b=18 / c=3 / d=28**。逐条表与依据落 `acceptance/rw-02-ui-evidence/triage.json`（分诊执行契约）。关键更正：UI-457 已 verified（2026-10-16）、UI-587 已 verified（压感 reopen 由 UI-595 承接）；**人眼最小集=UI-443/445/501 三条**（RW 纲旧引用的 503/504 实为 b 档数据前置）。

- **处置规则**：a 档 → 本包批量 CDP 取证 flow 翻 verified；b 档 → 台账补「触发条件」显式注记（数据/环境/第二机/R 运行时），如实保留 in_progress 不算失败；c 档 → 本包产出**集中过目清单+测试路线**（末尾交付用户一次栈窗口确认）；d 档 → 逐条判销/改判回写台账（判销依据引用既有证据或台账自述）。
- **D1 裁决定型**：d 档 28 条中 UI-448 加映 12 条整批判销（同因同注记）；其余逐条改判（退役承接/非 UI 面改判/证据链断裂按 P0 先例标「补证据后再翻」）。

## 5. 门禁（收口逐项对账）

| # | 门禁 | 预期 |
| --- | --- | --- |
| G1 | 分诊表落 backlog/台账，四档处置逐条留痕 | 零悬空 in_progress（a 翻 verified / b 保留条件 / c 留集中清单 / d 判销改判） |
| G2 | a 档 CDP 批量取证 flow | 断言 N/N allPass，证据 acceptance/rw-02-ui-evidence/ |
| G3 | B 线写桥红绿契约（白名单/快照/审批过期/回退） | 先红后绿 |
| G4 | 四类写面各一条真实写链 + 审批过期/权限拒绝/恢复实机 | 断言 N/N，证据 acceptance/rw-02-pack-write-bridge/ |
| G5 | closeout 十三门 | PASS |
| G6 | canonical 回写（台账/backlog/RW 纲/AUDIT-LOG/README） | 完成 |

## 6. 阶段划分

- P0 立项（本轮）→ P1 A 线分诊 + a 档批量取证 → P2 B 线写桥契约红绿 → P3 写桥实现 + 实机 → P4 closeout + 回写。预期跨多会话（1–2 周量级，预授权连续推进）。
