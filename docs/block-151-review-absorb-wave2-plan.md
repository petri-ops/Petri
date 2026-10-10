---
capability: review-absorb-wave2
goal: BLOCK-151 审视吸收批·第二波——收审视报告中低影响余量的三个面：A 轨会话与移动可靠（A1 深水区最小修 + /m 页流切换竞态携带项）；B 轨成果面流畅（A4 七条有界重审落地）；C 轨解读层与工具描述（B7 余量统计语义呈现 + A3 run_tool act 描述 enum/隐藏动作）
acceptance:
  - 每轨先有界重审视（只看 plan §2 锚点文件与台账，≤7 条可落地，宁缺毋滥），逐条验证现状（可能已被 146-150 顺手修，销号不重做）
  - 行为契约项红绿先行；文案/呈现项回归覆盖；A1 深水区从紧——只补守卫与行为测，不动恢复合并语义核心（mergeKeepOlderPrefix），发现需改核心即升级登记不硬改
  - 定向门禁：test:changed + quality:types/lint/secret/arch + theme-token-contract 全绿；closeout 十一门（集成提交后）
reopen: B7 报告模板内容扩充（pack 域）、A1 会话恢复核心语义重设计（若本波触发升级登记）
status: completed
---

# BLOCK-151 审视吸收批·第二波（审视序列第 6 波）

## 1. 背景

- 源头：审视（dwfrun-6724f75c）A1/A3/A4/B7 确认条余量；BLOCK-150 收口笔录携带项（/m 流切换竞态）。
- 发令：用户 2026-10-09「继续 按顺序都搞完」——批量授权剩余序列（151→152→153）。
- 定位：中低影响打磨收官波；A1 深水区按 plan 从紧（守卫与测试，非语义重设计）。

## 2. 范围（三轨，锚点为审视复核实证过的文件面）

| 轨 | 面 | 锚点 |
| --- | --- | --- |
| A 会话与移动 | A1 深水区（恢复合并/流中断/长会话一致性的守卫与测试面）+ /m 页 openTaskStream 竞态（taskId 闭包守卫 + AbortController，BLOCK-150 P2-1 携带） | SimpleChat.tsx、useConversationResume.ts（mergeKeepOlderPrefix :25-52）、copilotClient.ts:75-125、useChatStream.ts:420-467、conversationRunStore.ts、agentTaskStream.ts；core/petri-server/mobile-gateway/public/index.html |
| B 成果面流畅 | A4 七条（viewer 能力声明一致性/钉住快照/lineage 切换导航/继续分析菜单等——有界重审后落地） | ArtifactPinPane.tsx、crossJobPinSnapshot.ts、ResultArtifactShell.tsx（:180-260/:680-720/:778-808/:833-856）、LineageViewSwitch/LineageStrip/LineageGraph/lineageProjection、ContinueAnalysisMenu.tsx、CompactResultNavigator.tsx、viewerRegistry.ts、ResultStudioChangeSetPanel.tsx:420-479 |
| C 解读层+工具描述 | B7 余量（统计语义 tooltip/呈现——Scientific viewer 属合法领域域，做语义讲清不做中立化）+ A3 run_tool act 描述（enum 16 项/隐藏 12 动作的描述与披露形态） | ScientificInteractionViewer.tsx（:375-524）、interpret.js:130-210、format-scientific-value.ts；tool-defs/browser.js act 段、tool-defs/session.js run_tool、plugin-loader failureModes 面 |

## 3. 非范围

- 会话恢复核心语义重设计（mergeKeepOlderPrefix 换算法）——升级登记面。
- B7 报告模板内容扩充（pack 域）；G1+ 不外推；不新增依赖。

## 4. 实现形态

dynamic workflow 三轨并行（文件面互斥）→ 每轨有界重审视（≤7 条）→ 验证现状 → 红绿/回归修 → 独立评审（P1 必修）→ 统一门禁（红了即修 ≤2 轮）。工作流内不提交，主代理终审集成。

## 5. 验收与证据

逐条双态清账（fixed/already-fixed/skipped+理由）+ 红绿证据 + 定向门禁 + closeout 十一门（集成后）；证据落 acceptance/block-151/；台账五件回写。

## 6. 风险与边界

- A 轨深水区：行为测先行是硬门槛——凡需改 conversationRunStore/copilotClient 核心路径的项，先补行为测锁现状再最小改；改不动的升级登记。
- B 轨 A4 条目与 UI-460~465 已 verified 面重叠：只动审视点名的缺口，不翻已验收行为。
- C 轨 tooltip 文案触 CSS 走 token；enum 描述变更后 run_tool 契约测试同步。

## 7. 完成语义

三轨逐条双态清账 + 评审 P1 清零 + 门禁绿 + 主代理集成提交 + closeout 十一门 PASS + 台账五件回写。收官后接 BLOCK-152 重构候选批。

## 8. 收口笔录（2026-10-09 当日立项当日收口）

- **20 条清点：15 fixed / 1 already-fixed / 4 skipped / 0 escalated**（dwfrun-70613edf 三轨并行；A1 从紧纪律经评审复核——mergeKeepOlderPrefix 核心未动，全程守卫与行为测）：A=/m 竞态（150 携带）+lastSeq 回退+loadOlder 竞窗+mergeKeep/queue-drain 行为测锁；B=导出出口接线+钉住占位+对比图空态+死 prop 清理；C=统计语义 title 四件+act 描述对齐与三方一致契约。
- **评审 P1=0；P2 携带集成批修掉**：browser.js「5 秒内撤销」→「30 秒内」（act-tool.js:43 事实）+契约测试 /30 秒内撤销/ 钉住与 /5 秒/ 反向断言。skipped 四条留痕（跨 job 钉住静默/lineage 空态归下波；核心语义重设计非范围；Shell 三段 already-fixed）。
- **门禁**：统一五门全绿 + closeout 十一门 PASS（code-size R-2 重锚一次）。红绿亮点=loadOlder 摘守卫对照红证（守卫真实被钉）。
- **提交**：292f5f62（28 文件，UI-470 in_progress 同步）+ 5d4a13b6（棘轮重锚）。
- 证据=acceptance/block-151/evidence.json。序列下一批 BLOCK-152 重构候选批。G0 开发期常态 · 不外推 packaged/Provider/GA。