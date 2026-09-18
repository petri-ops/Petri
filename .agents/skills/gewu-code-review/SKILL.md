---
name: gewu-code-review
description: Use when reviewing code changes, diffs, or commits; auditing a module for contract drift, second sources of truth, silent failures, or patch stacking; grading finding severity; or writing a review or audit report. Use before declaring a substantial work-package deliverable done. 评审代码/审查 diff/质量把关/审计报告/判断该打补丁还是该重构时使用。
---

# Gewu Code Review（代码评审）

评审目标不是挑错，是抓"未来的事故"：契约漂移、第二真相、静默失败。每条发现都要能落到 file:line。

## 评审维度（按优先级排序）

1. **契约一致性**——文档/台账/类型声明描述的行为 vs 源码实际行为。教训（CONTRACT-DRIFT-001）：引用 src 文件位置 + 复制源码里的合同原文，不写"建议关注"式泛泛描述。
2. **单一真相**——是否创建了第二套 executor/Job/Artifact/Workflow/项目状态/UI truth；是否绕开既有 registry/门禁/桥直连。
3. **失败语义**——错误是否 fail-closed；静默吞错（空 catch）；async/sync 误用（getAsyncDatabase 同步误用教训）；资源清理（listener/poller/句柄/socket）。
4. **测试有效性**——断言走真实链路还是手工注入掩盖断链（BLOCK-64 mapper 教训：测试手工注入让映射漏字段永不暴露）；测试测行为还是测实现。
5. **边界与安全**——路径白名单、参数数组 spawn（无 shell 拼接）、IPC sender 守卫、重操作两段式确认门。
6. **死代码与残留**——重构删干净没有（BLOCK-17 死代码教训）、空壳预留、临时文件；**补丁堆积**——本次改动是否是对同一处的又一次叠加补丁（条件摞条件/特例套特例/绕开既有抽象），命中即触发「补丁 vs 重构」前置判断：要么给出吸收进单一结构的 scoped 重构方案（带行为基线——改前改后同套定向测试绿），要么如实登记重构候选留痕；不批准无判断的再垫一层。

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

## AI 跑查（OpenCodeReview，可选外部工具）

收口评审前可用 OpenCodeReview CLI（`ocr`，npx 免装，Apache-2.0）对本次 diff 做一轮 LLM 跑查，产出作为六维度评审的**输入证据**，不替代评审本身。

- **命令**：收口深查 `npx -y @alibaba-group/open-code-review@latest review --from <包起点sha> --to HEAD --effort high -f json -o <仓库外路径>.json`；日常快筛 `--commit <sha>`（默认 effort medium）。报告须引用 session id 或 JSON 路径留痕
- **消费规则**：ocr 的 severity 只是参考，不是本 skill 的 P1/P2——拟采纳的发现仍须回读源码核对到 `file:line` + 合同原文方可入报告（三要素规则不变）；不采纳的发现如实标注"误报"留痕
- **降级纪律**：ocr 未安装 / 未配置 key / 网络或模型失败 → 跳过跑查并在报告开头如实声明"本轮未做 AI 跑查及原因"，不阻塞收口；ocr 永不作为 closeout 门禁项（closeout 门禁是秒级确定性步骤，分钟级 LLM 步骤性质不合）
- **已知边界**：默认过滤 `*.test.*`（测试面不在跑查范围，测试有效性仍靠维度 4 人工）；工具只读 diff 不写仓库（配置与会话落用户主目录 `~/.opencodereview/`，2026-09-09 实测被审仓库 git status 前后一致）
- 跑查发现的缺陷类重复 ≥2 次时，按上方"回归→门禁转化"规则转化为机械门禁；转化不免除后续跑查

## 独立性

本 skill 自包含：六维度、严重度分级、转化规则、报告模板全部在本文件夹内，执行不要求读取任何外部文件。AI 跑查（ocr）是可选外部工具，缺失时按其节降级，不影响本 skill 其余部分执行。
