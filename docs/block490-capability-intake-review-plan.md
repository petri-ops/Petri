---
capability: block490-capability-intake-review
status: planned
kind: reference
truthDomain: block490-capability-intake-review
entrypoint: docs/README.md
goal: capability-intake（能力扩展承接）Agent skill 的独立立项评审稿——把用户随时提出的外部能力扩展需求（一句话 / 文档链接 / 资料库引用）标准化为「接收→解析→理解拆解→内化→候选登记→排队」的可复用工作流，全程记录源信息出处与版权归属；本稿只列 D1–Dn 待裁决项、不启动实施、不建 skill 文件、不改运行时。
acceptance:
  - 本稿为 planned 前置评审材料（TASK-FORM-TAXONOMY「立项评审稿」形态）；D1–D8 已于 2026-11-18 由用户裁决「全按评审稿推荐选项」逐项 ruled（见 §4 裁决留痕），不代答、不擅改
  - 不启动工作包、不占 active 串行槽位、不新建 .agents/skills/capability-intake 目录与发现桥（留实施包）；开工另需 active 槽位空出 + 显式发令（当前 BLOCK-486 占槽，见 §8）
  - 零运行时写面、零产品依赖、零观感代签；三件套登记（本稿 + DOC-REGISTRY + README + AUDIT-LOG）
---

# BLOCK-490 · capability-intake 能力扩展承接 skill 立项评审稿（planned / 待裁决）

> **发令**：用户 2026-11-18 裁决「可以的 按照你的建议来 先出一份独立立项评审稿（plan）」；前序 Jev 对本模块落地形态单一建议=CAPABILITY-INTAKE-SKILL confidence=0.60（advice-only）。
> **形态归类**：`TASK-FORM-TAXONOMY` §1「能力沉淀→制度化」+ §3「立项评审稿」（大面需逐项裁决、未到启动）——humanizer（第一次）、image-to-editable-ppt（第二次）已构成同类第 2 次出现，触发 governance「Convert recurring defects into gates」的制度化时机。
> **本稿边界**：只做评审——列清范围、D1–Dn 裁决项、验收预期、依赖与风险。**不是开工令**：D 项未裁决前不建 skill、不接发现桥、不写门禁脚本、不改任何运行时。

## 1. 背景与动机

近几轮用户连续提出外部能力内化需求（humanizer 写作保真内核、image-to-editable-ppt 机制图转可编辑 PPT），每次都重复一遍「抓取资料 → 判版权 → 拆能力 → 对标 Petri 魂 → 登记候选 → 排队」的人工流程。本模块把这套反复动作固化为 Agent skill，使后续大量类似请求有统一承接路径，且出处与版权全程可追溯。

## 2. 范围（实施包预期，非本稿交付）

1. **Agent skill**：canonical `.agents/skills/capability-intake/SKILL.md` + 三发现桥（`.codebuddy/skills/`、`frontend` 无关；`.claude/skills/` 同名 symlink，Windows 须真 symlink、`hygiene:check` 守护）。
2. **输入解析**：一句话 / 文档链接 / 资料库引用三种形式的识别与结构化解析规则。
3. **内化流水线**：接收 → 解析 → 能力原子化 → 缺口对照 → Petri 形态设计 → 依赖裁决 → 候选登记 → 评审稿 → provenance → 排队。
4. **版权 provenance**：append-only 台账 + `license_unknown` fail-closed。
5. **门禁**：provenance 字段完整性、发现桥真链、篡改负测（HK-01 红绿）。

## 3. 非范围（exclusions）

- 不自动立项启动（G0 硬纪律：启动需用户发令）；只自动登记候选 + 出评审稿。
- 不新建产品 Skill（`resources/skills/`）、不接 MCP 工具、不写运行时代码。
- 不引入任何外部依赖 / 生图 API / 下载器；版权只登记不代裁决。
- 不替代 `petri-project-governance`（形态路由、立项检查单仍由它管）与 `petri-dev-infra`（模板、工具仍由它管）——本模块是它们的上游"接需求"层，不造第二套治理。
- 不碰并行 WIP（BLOCK-483 C-55 P1 的 plan/证据/helpers/impact-map）与用户 untracked 资产；不外推 G1+。

## 4. 裁决项（D1–D8，2026-11-18 已 ruled）

> **裁决留痕**：用户 2026-11-18 原话「全按评审稿推荐选项」——逐项采纳下表推荐项（加粗选项），不代答、不擅改。裁决≠开工：实施仍受 §8 active 槽位硬门约束。

| ID | 裁决点 | 推荐选项（已采纳） | 状态 |
|---|---|---|---|
| D1 | skill 归属层级 | **Agent skill（`.agents/skills/`，服务主 agent 工作流）** | ruled（推荐项） |
| D2 | "自动立项"边界 | **自动登记候选 + 出评审稿，启动仍需发令** | ruled（推荐项） |
| D3 | 候选登记落点 | **backlog 候选池 + AUDIT-LOG 广播**（沿用 C-56/C-57 机制） | ruled（推荐项） |
| D4 | provenance 台账位置 | **`acceptance/capability-intake/provenance.jsonl`**（append-only，随证据走） | ruled（推荐项） |
| D5 | license_unknown 处理 | **fail-closed 停等用户裁决**（不猜、不引入） | ruled（推荐项） |
| D6 | 缺口对照的知识源 | **复用现有 skill-registry / 工具清单只读比对**（不新建能力目录） | ruled（推荐项） |
| D7 | 发现桥范围 | **仅 canonical + `.codebuddy` / `.claude` 两桥**（与现有 4 skill 一致） | ruled（推荐项） |
| D8 | 实施包形态 | **独立轻量包（一次会话可收口，AUDIT-LOG 条目即 plan）** | ruled（推荐项） |

## 5. 三种输入形式处理流程（实施预期）

**A. 一句话描述**：原话+时间戳记录（`source_type=utterance`，版权 self-authored）→ 抽取能力动词/对象/约束 → TASK-FORM 主轴三问定形态 → 能力原子化 + 现有清单缺口对照 → Petri 形态建议 + 裁决点标注 → 候选登记 + 排队。

**B. 文档链接**：URL+抓取时间记录（`source_type=url`）→ `web_fetch` 抓取、原文快照落 acceptance、存 URL sha256 → 解析 LICENSE 写 LICENSE_REGISTER（`license_unknown` 走 D5）→ 能力原子清单 → 标"可借鉴内核 vs 不可复制资产"边界 → 候选登记 + provenance（URL+sha+license+author）。

**C. 资料库引用**：库名/文档ID/版本记录（`source_type=knowledge-ref`）→ 走既有知识检索通道取片段+出处 → 第三方内容追原始 license（追不到走 D5）→ 同 B 的能力原子化与内化 → 候选登记 + provenance。

## 6. provenance 台账字段（D4 落点）

`id · source_type · uri · captured_at · author · license · license_source · sha256 · internalization_plan · license_unknown`

每个内化能力可反查来源与许可，对齐 C-52 P5 的 `LICENSE_REGISTER` + `license_unknown` 先例。

## 7. 验收门禁预期（实施包）

- **HK-01 红绿**：消费测试先红（skill 模块缺席）后绿；篡改负测（删 provenance 字段 / 翻 license_unknown / 断发现桥 → 必红）。
- **可复算**：provenance 字段完整性 + URL sha256 可重算。
- **零回归**：`skills:check`、`hygiene:check`（真 symlink）、`docs:check`/`ui:audit:check`。
- **治理**：六件套回写 + 证据落 `acceptance/`，不占 active、不启动后续。

## 8. 完成语义与开工硬门

**裁决状态**：D1–D8 已于 2026-11-18 全部 ruled（全按推荐选项）——评审稿层面的"评审"已完成。

**用户裁决（2026-11-18，串行槽位处理）**：原话「等 486 收口后再开」——选择守单工作包串行纪律，**不插队、不并行**；待 BLOCK-486 收口、串行槽位空出后，用户另发「开始 capability-intake 实施包」令方可开工。该裁决不等于自动触发，仍需显式发令。

**开工硬门（未满足则不得实施）**：按 `WORK-PACKAGE-LAUNCH-CHECKLIST` §0，实施包启动还须 ①唯一 active 串行槽位空出 ②用户显式发令开整。现读 `npm run state`（2026-11-18）：层 1 串行槽位 = **BLOCK-486（C-55 VIDEO-P2，并行 agent 在制，占唯一槽）**，AUDIT-LOG 有其 🚀/🔴 广播；本稿与实施文件面（AUDIT-LOG/DOC-REGISTRY/README）与 BLOCK-486 重叠。故裁决完成 ≠ 可开工——须待 BLOCK-486 收口、槽位空出后另发"开始 capability-intake 实施包"令，方可按 D1–D8 落地。

在此之前本模块处于 planned / 已裁决待槽位，不存在可用 skill，不会自动承接任何需求。

G0 开发期常态 · 不外推 packaged/Provider/GA。
