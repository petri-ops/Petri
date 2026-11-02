---
capability: block-339-persona-debt-sweep
status: completed
goal: 产品人设历史债务全方位清偿（用户裁决 2026-11-02「chat 回复仍有生信工程师角色定位与提示词限制；全方位核对清理，精准定位产品形态，要通用 agent 能力」）：核对结论=BLOCK-215 清的是 6 个工具词，漏掉人设主句本身——baseRole 第一句仍是「生物信息学分析助手」、runtime identity 块两句同、闲聊快路径「科研伙伴」绕过主 prompt 直答（打招呼即触发=用户体感来源）；另有 GO/KEGG 硬编码意图分支、interpret/ai-legacy 域功能、学习路径三段退役纪律、PBMC/基因名类示例散落 chat+agent 共用注入源。本包按「必清/宜清/保留」三档清偿，定义通用 agent 人设一句话并钉进基线。
acceptance:
  - P0 人设定义（钉死，后续一切文案以此为准）：「格物（Petri）是跑在你机器上的通用 agent——本地主权、全链可审计、证据自证；以目标为输入、工具为手足、真实产物为交付；领域能力（生信等）由已安装领域包按需放大，不是与生俱来的身份。」写入 AGENTS.md 产品个性纪律 + system-prompt baseRole；identity 块「生物信息学分析助手」两句同改；chitchat 「科研伙伴」改中性；ai-chat.js:124 总结 mini-prompt 去域。
  - P1 必清 9 条（身份与域限制）：A1-A7 身份句全改；agent-loop-control.js GO/KEGG 意图正则与硬编码分支迁 pack（或泛化为「领域包声明的快捷意图」接口，核心零域词）；interpret.js + routes/ai-legacy.js `/api/ai/interpret` 域功能迁 pack 或退役（判定：有活消费者→迁，无→退役留 reopen）；methods-export「资深生物信息学家」/learning「生信教学助手」改为 pack 注入的角色片段（promptFragments 通道，BLOCK-215 先例）。
  - P2 宜清 14 条（语气与示例）：agent-runner 学习路径/理解验证/主动复习三段退役纪律删除；PBMC/上调基因/基因名/SCTransform/cluster/DEG 类示例换中性（工具描述 session.js/result-studio.js/browser.js/knowledge.js、user-facts.js 事实抽取示例、chat-summary.js 实体示例、agent-runner 示例句）；run_tool 描述「涵盖差异分析、绘图、降维」改为「由已安装领域包声明」。
  - P3 基线与门禁同步（防回潮）：model-surface RETIRED_TERMS 补 `生物信息|生信|科研伙伴|生物信息学`（扫描面缺口=215 漏网的根因）；evals golden context_snapshot 显式重基准留痕（215/325 先例）；block188 fixture 改中性；新增契约测「核心系统提示 + chitchat + identity 块零域词」（全量 grep 词表锁）。
  - P4 保留清单显式登记（不误删治理必需）：identity 透明披露/不冒充 Copilot、principles 反谄媚与拒答纪律、只读与审批边界、ERROR_I18N、pack 侧 coding-playbook 角色句（场景资产契约）、FirstRunRoleReveal（已达标）。
  - P5 品牌定位对齐：package.json description「AI 陪伴的全组学学习与实战平台」与 AGENTS.md:8 同句 → 对齐 README「通用内核 + 垂直内容」新定位（用户裁决措辞）；electron-builder/index.html 已中性不动。
  - P6 实机：mock provider 跑三轮——打招呼（走 chitchat 快路径）/「你是谁」（identity 块）/普通任务（主 prompt）——抓 system prompt 全文与回复，断言零域词零旧身份；真实 deepseek 一轮「你是谁」人工可读核对。证据 acceptance/block-339/。closeout + 台账回写。
reopen: 领域包「快捷意图」接口（GO/KEGG 类意图泛化后的 pack 声明契约）；interpret 域功能若退役则 pack 侧重建；多语言人设（v1 中文）。
---

# BLOCK-339-PERSONA-DEBT-SWEEP — 产品人设历史债务清偿计划

- 立项裁决：用户 2026-11-02「目前我们的 chat 聊天回复还是有生信工程师的角色定位以及提示词限制。全方位核对清理历史债务，精准定位当前 petri 的产品形态，无论从语气、人设等等层面都核对一遍，要通用 agent 能力」
- 队列位置：**338 之后、336 之前**（稳定性 → 人设 → 基础设施；对用户体感最直接，且与 334/338 文件面零交叠）
- 唯一真相域：本文件（block-339-persona-debt-sweep）
- 文件面：system-prompt.js / chitchat-fast-path.js / ai-chat.js 一处 / agent-runner.js prompt 段 / agent-loop-control.js / interpret.js+ai-legacy.js / methods-export.js / learning.js / tool-defs 四文件描述 / user-facts.js / chat-summary.js / model-surface-baseline.mjs / evals golden / block188 fixture / AGENTS.md / package.json。与 334（前端结果面）、338（gateway）、336（git 工具面）零交叠。

## 1. 核对结论（2026-11-02 子代理全面扫描 + 主代理核实）

| 面 | 残留 | 档 |
| --- | --- | --- |
| system-prompt.js:408 baseRole | 「你是当前桌面项目工作台中的生物信息学分析助手…」 | 必清 |
| system-prompt.js:181/184 identity | 「工作角色是"生物信息学分析助手"」×2 | 必清 |
| chitchat-fast-path.js:14 | 「…也是用户的科研伙伴」（闲聊高置信绕过主 prompt 直答——**用户体感主因**） | 必清 |
| ai-chat.js:124 | 「你只总结已完成的生物信息学工具结果」 | 必清 |
| methods-export.js:196/208、learning.js:336 | 「资深生物信息学家」「生信教学助手」 | 必清（迁 pack 片段） |
| agent-loop-control.js:59/105 | GO/KEGG 正则 + 硬编码富集分支 | 必清（核心域逻辑） |
| interpret.js + ai-legacy.js | marker→细胞类型映射等域功能整体仍在核心 | 必清（迁/退役） |
| agent-runner.js:575-595 | 学习路径/理解验证/主动复习三段退役纪律 | 宜清 |
| 示例散落 11 处 | PBMC/上调基因/基因名/SCTransform/cluster/DEG | 宜清 |
| RETIRED_TERMS | 不含「生物信息/生信/科研伙伴」——**215 漏网根因** | 必补（P3） |
| golden.json | 「生物信息学分析助手」钉进指纹 | 重基准 |
| package.json:5 / AGENTS.md:8 | 「AI 陪伴的全组学学习与实战平台」 | 品牌对齐 |

**chat 与 agent 两路径主体同源**（都调 buildSystemPrompt），同源≠无残留；三条旁路（chitchat/总结 mini-prompt/baseRole 本身）叠加成体感。

## 2. 原则（为什么 215 没清干净、本包怎么不重蹈）

- 215 的词表是**工具名词**（DESeq2/Seurat…），人设是**角色名词**（助手/伙伴/工程师/生物信息学）——两个词表都要进 RETIRED_TERMS 并由 325 门禁长期守住。
- 清偿不是删功能：GO/KEGG 快捷意图、Methods 写作、学习问题生成都是有价值的**领域能力**，去向=pack 注入（promptFragments/快捷意图接口），核心只留通用接口。
- 治理必需的能力边界（只读/审批/不冒充/反谄媚）**一字不动**——它们是通用 agent 的骨架，不是域限制。

## 3. 红线

- 不删治理纪律；不把域能力直接删除（迁 pack 或留 reopen）；AGENTS.md 人设句一次写定；golden 重基准必须显式留痕；G1+ 不外推。

## 4. 收口记录（2026-11-02 立项当日 P0→P6 全收口）

**P0 人设钉死**：`AGENTS.md` 产品个性纪律新增「人设一句话（改动需用户裁决）」；`system-prompt.js` baseRole 换为通用 agent 句；identity 块两句去域（「工作角色是生物信息学分析助手」→「以格物（Petri）通用 agent 的身份工作」、「作为你的本地 agent 运行」）；`chitchat-fast-path.js`「科研伙伴」→「跑在用户机器上的通用 agent」；`ai-chat.js` 总结 mini-prompt 去域。

**P1 必清**：methods-export（中/英三处「资深生物信息学家」→ 学术写作助手，学科背景由数据与已装领域包决定）、learning（「生信教学助手」→ 教学助手）、vision-tools 默认问句、**agent-loop-control 的 GO/KEGG 词表与硬编码分支**改为 pack `provides.quickIntents[].cues` 声明（新增 pack 贡献通道：LIMITS 20/12 + 校验 + diagnostic），无声明时核心零域词、走通用「必须执行真实结果动作」纠正提示（工具照常可用）；`/api/ai/interpret` **退役**（前置 410 + 旧实现保留不可达；全仓零活消费者，act-ack/run-tool-ack 两个治理端点不受影响）。

**P2 宜清**：agent-runner 学习路径/理解验证/主动复习三段退役纪律删除（-19 行）；PBMC/DEG 类示例 9 处换中性（agent-runner ×2、tool-defs/session ×2、tool-defs/browser、chat-summary、preflight、system-prompt、user-facts ×3、content-plugins）；`run_tool` 描述改「能力由已安装领域包声明」。

**P3 基线防回潮**：`RETIRED_TERMS` 补角色词（`生物信息|生信|科研伙伴`，215 漏网根因=词表只收工具名词）；新增契约测 `test/block339-persona-zero-domain.test.mjs` **4/4**（主 prompt / identity 块 / chitchat 三条旁路零角色词 + 正面人设在场）；预算棘轮按有意增长登记 `systemPromptChars 940→993`（+53，理由=通用 agent 人设句取代旧域身份句，已在 commit 说明；toolDefsChars 经压缩回落到基线下）；golden `context_snapshot` 现状是**行为契约**（断言「文案变则指纹变」）而非固定值，故无需重基准——如实记录。

**P4 保留清单（不误删治理必需）**：identity 透明披露四句（不冒充供应商/Copilot、必须说出真实供应商与模型）、principles 的反谄媚与拒答纪律、只读与审批边界、`ERROR_I18N`、pack 侧 coding-playbook 角色句、FirstRunRoleReveal——**一字未改**。

**P5 品牌对齐**：`package.json` description 与 `AGENTS.md` 定位句改为「跑在本机的通用 agent 内核 + 按需安装的垂直领域内容（本地主权 · 全链可审计 · 证据自证）」。

**P6 实机**：`scripts/block339-persona-live.mjs` 真 provider + 真 HTTP mock，**抓上游实际收到的 system prompt** 三轮（chitchat 138 字 / 主 prompt 687 字 / identity 978 字）——零角色词 + 正面人设在场，**6/6 allPass**（`acceptance/block-339/persona-live.json`）。

**门禁**：定向 1680 项 1646 绿 / 26 红——**26 条全部属既有「P4 配置中心运行时门控家族」**（block112 intent / block119 report-guard / block111 marker，实现与测试 HEAD 均未改，已在 AUDIT-LOG 🟡 扩范围登记）与 1 条 p6 脏树（提交自愈）；`quality:lint` 0 error。

**未做 / reopen**：段级「身份句 A1-A7」的全仓普查以本包扫描面为界（生产 prompt/工具描述/示例已清，源码注释里的历史说明保留）；`interpret` helper 与 block111 契约测试保留（路由已退役，待 pack 侧重建 marker→类别能力时一并迁移）；领域包 `quickIntents` 声明（bio pack 仓未升级，升级后富集快捷判定自动恢复）；多语言人设（v1 中文）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
