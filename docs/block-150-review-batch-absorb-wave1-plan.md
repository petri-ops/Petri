---
capability: review-absorb-wave1
goal: BLOCK-150 审视吸收批·第一波——把审视报告中已具体点名的中低影响发现按域收拢落地：平台 6（queuePosition/失效流/持久化失败三项前端消费、TOOL_METADATA 漂移 2 处、HEAVY_TOOLS 死链、/m 页 token-in-URL）+ 生信 5（四插件 R 缺包守卫、go-kegg 三源矛盾、data-management 英文键、DataManagement 话术、caveat 因果点破）+ 内核盲性 2（compare 面领域词中立化、报告图 demo URL 兜底）
acceptance:
  - 每项先验证现状（146-149 可能已顺手修复，已修的记 notes 销号不重复做）
  - 行为契约项红绿先行（队列位显示/失效流刷新/token 拔除/R 守卫）；纯文案项（英文键/话术/caveat）以现有测试回归覆盖
  - 定向门禁：test:changed + quality:types/lint/secret/arch 全绿 + 前端定向；closeout 十一门（集成提交后）
  - pack 仓改动（R 守卫）本地提交不推送（BIO-4 惯例）
reopen: A1 深水区（会话恢复合并语义）、A4 成果面七条、B7 解读层其余条目——待下一波或随对应域批
status: completed
---

# BLOCK-150 审视吸收批·第一波（审视序列第 5 波）

## 1. 背景

- 源头：双视角审视（dwfrun-6724f75c）确认 79 条中未被 146-149 收口的中低影响条目；本波取「报告与各评审 scope 中已具体点名、可独立验证」的 13 条；明细全量在用户报告卡片，后续波次按卡片续收。
- 发令：用户「继续」（2026-10-09），接续「按顺序直接推进」授权模式。
- 定位：既有功能打磨——消费链补全、死链清理、领域盲性、文案品质；零新功能面。

## 2. 范围（三轨 13 项）

| 轨 | 项 | 来源锚点 |
| --- | --- | --- |
| A 平台 | ①queuePosition 前端消费（PL-3 交付了响应字段，任务墙/工具行不显示队列位）②Jobs Wall 消费终态失效流（BLOCK-126 交付失效事件，任务墙零消费）③message_persist_failed 呈现（持久化失败用户无感）④CONTRACTS×TOOL_METADATA 漂移 2 处修齐（agent-tools/registry.js vs tool-metadata.js）⑤HEAVY_TOOLS 死链 9 个清理（agent-tools/learning.js 引用不存在的重工具）⑥/m 页任务 SSE token-in-URL 拔除（BLOCK-132 拔了主链漏了 /m） | 审视 A1/A3/A5 复核 scope 实证条目 |
| B 生信 | ⑦volcano-plot/go-kegg/gsea/deseq2 四插件 R 缺包守卫（deg-standardizer/expression-qc 已有，对照补齐；pack 仓）⑧go-kegg plugin.json+environment.json 三源矛盾收敛 ⑨data-management.js 英文键中文化（:45-52/:61/:68）⑩DataManagement 话术（:61）⑪B7 caveat 因果点破（散点 caveat 有命中数没点破因果——ScientificInteractionViewer caveat 段） | 审视 B8/B9/B7 scope |
| C 内核 | ⑫compare 面领域词中立化（display.tsx ScientificDifference/ResultStudioChangeSetPanel:460-489/result-scientific-compare:85-134 的 gene/padj 示例与文案改领域盲形态——契约=成果面方向文档 §2 渲染层领域盲）⑬report viewer 报告图 demo URL 缺位兜底（deseq2-report-template 引用图缺失时的占位与说明） | 审视 C10/B7 scope |

## 3. 非范围

- A1 深水区（会话恢复合并语义）、A4 成果面七条、B7 解读层其余条目、A3 enum/隐藏动作——下一波或随对应域批。
- 不新增依赖；pack 仓不推送；G1+ 不外推。

## 4. 实现形态

dynamic workflow 三轨并行（文件面互斥：A=frontend copilot/任务墙+agent-tools+mobile 路由；B=pack 仓+data-management+ScientificInteractionViewer；C=result-studio compare 面+report 模板读取）→ 每轨先验证现状（已修销号）→ 红绿实现 → 独立评审（P1 必修）→ 统一门禁（红了即修 ≤2 轮）。工作流内不提交，主代理终审集成。

## 5. 验收与证据

红绿证据（行为项）+ 现状验证记录（全部 13 项逐条）+ 定向门禁 + closeout 十一门（集成后）；证据落 acceptance/block-150/；台账五件回写；pack 仓 hash 对账留痕。

## 6. 风险与边界

- ①②③消费链涉及 real-time 事件接线：复用 petriEvents/既有 SSE 通道，不新建通道；失效流已有后端事件源（BLOCK-126），前端接线即可。
- ⑤HEAVY_TOOLS 死链：确认引用面后删除或修正列表（取舍留痕）；tool-metadata 漂移 2 处以单源校准为准（哪侧为真读代码定）。
- ⑥/m 页 token 拔除：对齐 BLOCK-132 主链方案（token 出 URL）；若 /m 页依赖 token 认证无替代通道，如实登记边界不硬拆。
- ⑦R 守卫对照 deg-standardizer.R:60-66 范式；deseq2.R 本波不加（刚重放过 parse_design_terms，守卫随下一 pack 波）。
- ⑫中立化只动示例文案与注释，不改行为契约（compare 契约测试保绿）。

## 7. 完成语义

13 项逐条「已修/已销号（已修）」双态清账 + 评审 P1 清零 + 门禁绿 + 主代理集成提交 + closeout 十一门 PASS + 台账五件回写。第一波收官后剩余卡片条目续波。

## 8. 收口笔录（2026-10-09 当日立项当日收口）

- **13/13 双态清账**（dwfrun-bfc725e3 三轨并行；⑫ 首版零落地被评审 P1 抓真后补做并复核通过——display.tsx 四标签中立化+classifyDeg 注释钉边，零行为变更）：A 平台 6 项全 fixed（三项前端消费接线+漂移修齐+死链清理+/m 页 token 拔除）；B 生信 5 项全 fixed（pack 三插件守卫+go-kegg 收敛+主仓文案三件）；C 内核 2 项全 fixed（中立化+报告图兜底）。
- **评审 P1=1（⑫ 零落地）→ 补做复核通过；P2 携带两条如实登记**：/m 页流切换竞态（帧分发无 taskId 守卫）归下一波 A5 域批；agent-approval 实测 14/14（自述 15/15 口径误以本笔录为准）。pre-existing RS6 存量败 1 非本波引入。
- **门禁**：统一五门全绿 + closeout 十一门 PASS（code-size 棘轮随消费链新代码 R-2 重锚）；Minor-6 impact-map 缩进集成批顺手修。
- **提交**：主仓 9dcdb5c9（26 文件，UI-469 台账 in_progress 同步）+ pack 仓 6a5ef8a（8 文件，本地不推送 BIO-4）。
- **边界**：实机走查待（UI-469）；剩余卡片条目（A1 深水区/A4 七条/B7 解读层/A3 enum、/m 竞态）归下一波。
- 证据=acceptance/block-150/evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA。