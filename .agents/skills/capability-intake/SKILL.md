---
name: capability-intake
description: Use when the user brings an external capability to internalize (a one-line idea, a doc/repo URL, or a knowledge-base reference) and Petri must turn it into a governed candidate — intake, parse, atomize, compare against existing skills/tools, design the Petri-native form, register the candidate, and file a review draft with full provenance and license tracking. 适用于用户提出外部能力内化（humanizer 类写作内核、机制图转 PPT 等）时的标准化承接；只登记候选+出评审稿，启动实现永远等用户发令。
---

# Capability Intake（能力扩展承接）

## Purpose

把用户随时提出的外部能力内化需求固化为一条可复算、可审计的承接流水线：**接收 → 解析 → 理解拆解（原子化）→ 内化 → 候选登记 → 评审稿**，全程记录来源与版权 provenance。本 skill 是 `petri-project-governance`（形态路由/立项检查单）与 `petri-dev-infra`（模板/工具）的**上游接需求层**，不造第二套治理。

## Hard boundaries（红线 · 违反即停）

1. **D2 边界**：只自动登记候选 + 出评审稿；**启动实现永远需用户显式发令**（G0 单工作包串行，不插队不并行）。
2. **D5 fail-closed**：`license_unknown` 时**停等用户裁决**——不猜 license、不引入、不下载；候选登记仍可进行（标注 license_unknown=true），接入动作禁止。
3. 零新依赖；外部内容**只读内化**（借形/借内核），不复制受版权保护资产（整段文本/图片/代码文件）入库。
4. 不替代既有治理链：候选登记落 backlog 候选池 + AUDIT-LOG 广播（D3），评审稿形态按 TASK-FORM-TAXONOMY。

## Intake workflow（三步最小闭环）

### Step 1 · 接收与解析

三种输入形式，全部落 provenance（见下）：

- **A 一句话**（`source_type=utterance`）：原话+时间戳留痕，版权=self-authored；抽取能力动词/对象/约束。
- **B 文档链接**（`source_type=url`）：URL+抓取时间；`web_fetch` 抓取、原文快照落 `acceptance/capability-intake/`、记 URL sha256；解析 LICENSE→`license` 字段（追不到 → `license_unknown=true`，触发红线 2）。
- **C 资料库引用**（`source_type=knowledge-ref`）：库名/文档ID/版本；走既有知识检索通道取片段+出处；第三方内容追原始 license，追不到走 D5。

### Step 2 · 理解拆解与内化设计

1. **能力原子化**：把「我想要 X」拆成原子能力清单（每个原子=可独立验收的最小能力）。
2. **缺口对照**（D6 只读比对）：对照现有 skill-registry / 工具清单——已存在的原子标注「已有（入口）」，不重复建设。
3. **Petri 形态设计**（对标不改魂自检）：每个原子回答「形态与通用 agent 的差别在哪？本地可审计/治理透明/证据自证体现了吗？」——答不出的原子标 `advice_only` 待想清楚。
4. **边界标注**：可借鉴内核 vs 不可复制资产，逐条分离。

### Step 3 · 候选登记与评审稿

1. **登记**：backlog 候选池新行（C- 编号先全表核对防撞号）+ AUDIT-LOG 🗃 广播行；状态 `planned`/`pending_user_ruling`。
2. **评审稿**：独立 plan 文档（范围/非范围/裁决点/验收预期/风险），只评不启动。
3. **provenance 台账**：append-only 追加一行到 `acceptance/capability-intake/provenance.jsonl`，字段（D4）：
   `id · source_type · uri · captured_at · author · license · license_source · sha256 · internalization_plan · license_unknown`
4. **汇报收尾**：向用户报告候选编号+评审稿指针+license 状态；**不发令、不排期**——启动等用户。

## Provenance rules

- append-only：不改写历史行；修正=追加更正行。
- `sha256`：URL/快照内容的 sha256，可复算。
- `license_unknown=true` 的行：接入类动作（安装/引依赖/运行时消费）全部禁止，直至用户裁决。
- 自建产物（本仓衍生手册/方案）标 `license=self-authored`。

## Anti-patterns（本 skill 不做什么）

- 不自动立项启动实现包（D2）；不插队、不并行、不占串行槽位。
- 不猜 license、不引入未裁决外部依赖、不下载未授权资产。
- 不复制整段外部文本/代码入库（借形不抄形）；不造第二套治理/第二真相。
- 不碰 G1+（Provider/公证/GA/packaged）。

## Closing semantics

本次承接完成的判定=①候选池行+AUDIT-LOG 广播在册 ②评审稿文档登记（registry/README）③provenance 行追加 ④用户动作清单含「启动与否待发令」。实现启动是**另一个工作包**的事，须用户显式发令。
