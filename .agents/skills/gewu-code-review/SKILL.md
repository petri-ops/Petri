---
name: gewu-code-review
description: Use when reviewing code changes, diffs, or commits; auditing a module for contract drift, second sources of truth, or silent failures; grading finding severity; or writing a review or audit report. Use before declaring a substantial work-package deliverable done. 评审代码/审查 diff/质量把关/审计报告时使用。
---

# Gewu Code Review（代码评审）

评审目标不是挑错，是抓"未来的事故"：契约漂移、第二真相、静默失败。每条发现都要能落到 file:line。

## 评审维度（按优先级排序）

1. **契约一致性**——文档/台账/类型声明描述的行为 vs 源码实际行为。教训（CONTRACT-DRIFT-001）：引用 src 文件位置 + 复制源码里的合同原文，不写"建议关注"式泛泛描述。
2. **单一真相**——是否创建了第二套 executor/Job/Artifact/Workflow/项目状态/UI truth；是否绕开既有 registry/门禁/桥直连。
3. **失败语义**——错误是否 fail-closed；静默吞错（空 catch）；async/sync 误用（getAsyncDatabase 同步误用教训）；资源清理（listener/poller/句柄/socket）。
4. **测试有效性**——断言走真实链路还是手工注入掩盖断链（BLOCK-64 mapper 教训：测试手工注入让映射漏字段永不暴露）；测试测行为还是测实现。
5. **边界与安全**——路径白名单、参数数组 spawn（无 shell 拼接）、IPC sender 守卫、重操作两段式确认门。
6. **死代码与残留**——重构删干净没有（BLOCK-17 死代码教训）、空壳预留、临时文件。

## 严重度分级（沿仓库既有惯例）

- **P1 必修**：契约破坏 / 数据正确性 / 安全边界 / 生产路径回归——修复后方可收口
- **P2 强烈建议**：可靠性、性能、可维护性的实质影响——可登记候选，须留痕
- **Minor / Nit**：风格、命名、注释——不阻塞，顺手或择机

不确定的发现标 ⏳ 待验证，不武断定性；跳过某维度须写明原因。

## 证据规则

- 每条发现：`file:line` + 现象（引用源码合同原文）+ 建议修法，三者缺一不成立
- 结论不许超出证据；"看起来完成"不构成评审通过
- **回归→门禁转化（内嵌规则，无需外部文件）**：同一类缺陷第二次出现——无论是 commit 修复、评审发现还是实机验收抓获——必须转化为机械门禁项（定向测试 / harness 检查 / dev-verify flow），并在门禁自身内写明映射关系。判据：重复 ≥2 次 + 后果隐性滞后 + 可机械化，三条全中才转化；一次性事故与状态类事实不转化

## 产出与时机

- 报告格式见 `references/REVIEW-REPORT-TEMPLATE.md`（表行式：结论先行、每条发现三要素）
- 时机：跨模块契约 / 新增 IPC 面 / 安全面 / 大体量包，收口前先评审；单会话小增量可自评但须自查本文件六维度

## 独立性

本 skill 自包含：六维度、严重度分级、转化规则、报告模板全部在本文件夹内，执行不要求读取任何外部文件。
