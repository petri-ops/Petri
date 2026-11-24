# C-56 真实用户稿件保真改写报告（2026-11-24）

## 1. 输入与目标

- **输入**：`/Users/zhangdiandian/Documents/1.WorkDir/Petri/petri-informal-paper.md`
  （用户自有英文 informal paper，7 节：Why this matters / What Petri is / Trust you can check / Goals in, artifacts out / Skills, not baggage / Where we are）。
- **目标**：用户发令「这个开整 C-56」——按 paper-writing Skill §9 跑**真实稿件**保真改写演练。
- **口径（判据类自主，留痕）**：稿件为英文、而手册 F 类六项是**中文现象判据**（长定语/被字句/四字词排比等），按用户 11-19 裁决「中文 F 类维持、英文另批」——英文面本次按**通用保内核**执行（四保护/不编造/三栏对照/provenance/未覆盖），F 六项对英文稿标 N/A、不套用中文判据。这是最小合理扩展，不改手册、不扩 F 类定义。

## 2. §9 执行（改前完整读取已做）

全文 27 行、7 节已完整读取。**锁定段落扫描**：稿件无任何数字/单位/显著性/引用标记——数字锁定清单为空（如实标注，不编造数值）。**限制段识别**：§6 "still a research prototype / don't claim it's finished" 是负结果段，必须保留不弱化。

## 3. 四保护校验

| 保护 | 稿件现状 | 改写约束 |
|---|---|---|
| 确定程度 | "We think there's another way" / "We don't claim it's finished" | 保留 "think"/"don't claim" 限定，不升格为事实断言 |
| 归因 | 全文第一人称 "We"，观点归属作者 | 不改为无人称客观陈述（会伪造归因） |
| 完成状态 | "research prototype, developed in the open" | 保留未完成态，不写 "shipped/production-ready" |
| 数字锁定 | 无数字 | 不补造任何数字/性能声明 |

## 4. 逐句三栏对照（原句 → 改写建议 → 保真说明）

| # | 原句（§/节） | 改写建议 | 保真说明 |
|---|---|---|---|
| 1 | §1 "That's convenient, but it hides a quiet trade: your data, your tasks, and the whole chain of reasoning happen on someone else's computer." | "Convenient, yes — but it hides a trade: your data, your tasks, and the reasoning chain all run on someone else's machine." | 去 "quiet" 修饰但不改 claim；三项列举（data/tasks/reasoning）与归属（someone else's）完整保留 |
| 2 | §1 "You don't really see what happened, and you can't easily check it later." | "You cannot see what happened, nor verify it afterwards." | 合并两否定句但保留**两个否定 claim**（不可见/不可查），不弱化为 "hard to see" |
| 3 | §2 "Not a thin client, not a wrapper around a cloud API — the reasoning loop, the tools, the memory, the whole thing stays with you." | "It is neither a thin client nor a cloud-API wrapper: the reasoning loop, tools, and memory all stay on your machine." | 两个否定界定保留；四项本地组件（loop/tools/memory/whole thing）保留，"stays with you" 明确为 "on your machine"（与同段 "runs on your own machine" 一致，非新增 claim） |
| 4 | §2 "Turn off your Wi-Fi and it still works." | "It still works with Wi-Fi off." | 语序调整，离线可用 claim 不变（不扩为 "air-gapped" 等更强断言） |
| 5 | §3 "being trustworthy shouldn't be a matter of faith" | "trustworthiness should not rest on faith" | 词性转换，"shouldn't" 规范强度保留 |
| 6 | §3 "instead of asking you to believe the agent did the right thing, we hand you the receipts" | "rather than asking you to trust that the agent acted correctly, we give you the evidence" | "receipts" 隐喻→"evidence"（与同段 "evidence self-proof" 术语统一），不新增审计能力 claim |
| 7 | §3 "If something goes wrong, you can look." | "If something goes wrong, you can inspect what happened." | 补 "what happened" 是同段 "recorded and traced back" 的复述，非新 claim |
| 8 | §4 "It uses tools the way you'd use your hands — reading files, running commands, calling services" | "It uses tools as you would use your hands — reading files, running commands, calling services" | 三项工具例举逐字保留 |
| 9 | §4 "it finishes when a real artifact exists: a report, a result, a changed project." | "it finishes when a concrete artifact exists — a report, a result, or a changed project." | "real"→"concrete" 近义替换，三项产物保留；不升格为 "always succeeds" |
| 10 | §5 "Domain abilities, like bioinformatics analysis, come from optional packages you install only when you need them." | "Domain abilities — bioinformatics analysis, for example — come from optional packages you install only when needed." | 举例与"按需安装" claim 保留 |
| 11 | §6 "This is still a research prototype, developed in the open. We don't claim it's finished." | "This is still a research prototype, developed in the open; we do not claim it is finished." | **限制段原样保留**（仅 "don't"→"do not" 文体统一），未完成态与开放开发 claim 零弱化 |
| 12 | §6 "What we do claim is that the direction is worth exploring: an agent that respects where it runs, shows its work, and hands you something real." | "What we do claim is that this direction merits exploration: an agent that respects where it runs, shows its work, and hands you something real." | "we do claim" 主张边界保留；三项特征逐字保留；"worth"→"merits" 近义，强度不变 |

## 5. F 六项命中报告（英文稿不适用）

| 项 | 判定 |
|---|---|
| F1 长定语堆叠 / F2 进行时冗余 / F3 被字句堆叠 / F4 四字词排比 / F5 万能背景开头 / F6 套话收尾 | **N/A**——六项均为中文文本现象判据；英文稿按用户 11-19「英文另批」未并入本包，本批只跑通用保内核，不套中文 F 类、不扩 F 定义。 |

## 6. 未覆盖清单（不代填）

- 〈未覆盖：英文论文 F 类判据（另批未裁决）——本批不判断英文稿的 redundancy/hedging 文体问题〉
- 〈未覆盖：术语一致性表（agent/Petri/GeWu/artifact 全篇统一）需作者裁决是否另做〉
- 〈未覆盖：目标读者/投稿场景，故不判informal 语气是否合适〉

## 7. provenance 与边界

- 来源：用户自有稿件 `petri-informal-paper.md`（用户 2026-11-24 显式给路径，满足手册 §9 第 1 步）。
- 改动动机标签：四保护 + 精简冗余 + 术语统一（"receipts"→"evidence"）。
- **不落盘**：按 §9 第 7 步「确认后落盘」——本批只出三栏改写建议，不改用户原稿；逐条裁决权归作者。
- 学术判断归人：不评价 Petri 技术主张真伪，不扩写任何能力声明。

G0 开发期常态 · 不外推 packaged/Provider/GA。
