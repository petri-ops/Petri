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

最后更新：2026-10-30（P0 立项：双探查进行中——证据债盘点 + C-44 写桥现状；骨架先行，探查回填 §2/§3。）

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

- D1 分诊判据（待探查回填：四档计数与逐条表）。
- D2 写桥白名单形状（待探查回填：四类写操作契约）。
- D3 审批/ack 复用点（待探查回填）。

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
