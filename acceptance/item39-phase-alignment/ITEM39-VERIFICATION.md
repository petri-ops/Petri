# item 39 · 阶段口径对齐 + 通用 agent 重写 —— 核真记录（2026-11-25）

> 发令：Orca 1bcd88ef dispatch msg_9ff95131f005（主人 11-25 裁决 item 39：两步纯文档包）。
> 纪律：A–J 任何一条与真源不符，以真源为准并在回报里纠正兴奋。本件=核真留痕，不改产品代码/运行时/WIP/兄弟仓。

## §1 A–J 核真结论

| 条 | 兴奋描述 | 核真结论 |
|---|---|---|
| A | AGENTS.md 仍写长期 G0、提前进 G1 越权；尾注 G0 常态 | ✅ 属实（`AGENTS.md:10,12,16,25-27,31`） |
| B | charter §2.2 G1+ 范围外、§5.1 冻结、§7 停 v1.0 | ✅ 属实（`:93,173,219`） |
| C | remaining-work frontmatter phase:G0、A2 仅 BLOCK-520 | ✅ 属实（frontmatter + `:24-28`） |
| D | roadmap 尾注 G0 常态 | ✅ 属实（最后更新 2026-11-21 尾注） |
| E | g0-living 头 establishing vs 正文 902 行 qualified+maintained | ✅ 属实（头 `状态：establishing`；`## 28 当前行动` 永久 qualified+maintained） |
| F | vision 最后更新 2026-07-23、§10 G1–G6 科学阶梯、无通用 agent/领域包 | ✅ 属实（头 + `:395,405,468`；全文 grep 无「通用 agent」「领域包」） |
| G | 三套 G1 定义并存 | ✅ 属实（vision §10；maturity-blueprint §6/§7.1 `:161,183`；g1-execution-plan 序列4） |
| H | 签名/公证口径矛盾；双 Provider 挂外部依赖而主人日常用真模型 | ✅ 矛盾属实（`v1-productization-roadmap.md:193`「不作为必需条件」 vs EXECUTION-PLAN 序列5 前置）；后者需做裁决材料（主人用真模型属实，EXECUTION-PLAN `:59` 仍写外部依赖） |
| I | harness 队列余项：A1 扩面待令、队列7第二波 38513bc09 待集成、B2 收尾、B3 观察态 | ⚠️ **部分纠正**：真源 harness 文档 `:80-92` 显示**队列 5.5 D1（43983eef2）、队列 7 第一波（854c006b6）、第二波（38513bc09）均已 Done**，B2=大部分已修·收尾项、B3=观察态·未触发（`:30-31`）。「38513bc09 待集成」表述不准——该笔已 Done 只是未 push/未并主线（独立分支），收尾项按此口径登记。A1 扩面待令属实。 |
| J | G0 视觉资格门诚实红、主人 11-24 裁接受不补拍、处置仍挂着 | ⚠️ **需纠正**：真源 AUDIT-LOG `:170`（2026-11-24 B 类裁决）明确「G0 distinctStates 判据 HK-01 3/3 绿+实机诚实红（5PNG/4唯一，**已批准不补拍**）；证据 `acceptance/g0-distinct-states-ruling/`」——**已裁决落地**，不是「仍挂着」；老条目 `:151` 是历史待评估记录，按留痕纪律保留不覆盖。 |

## §2 第一步范围（阶段口径对齐）

- AGENTS.md 两层事实（G0 永久 maintained / G1 进行中）+ 六序现状 + 边界改写 + 尾注。
- charter 按 §5.2：记录主人裁决原话日期、§2.2/§5.1 失效项更新、§7 追加 v1.1。
- remaining-work plan：phase 改正、新增「下一阶段统一清单」（G1 余步 + I 各项 + J 收口），H 两项做裁决材料。
- 顺手修 D/E 漂移；三件套回写（DOC-REGISTRY/README 入口/AUDIT-LOG）。

## §3 第二步范围（通用 agent 重写）

- vision §10：G0 不动、G1 对齐 11-24 执行规划、G2+ 通用 agent 内核+领域包、科研路线一句指针归 bio 包、NOW/NEXT/LATER/RESEARCH 与 §11 对齐、旧到新映射表、旧阶梯留痕。
- 北极星句/文件名是否改：**不做主，做单一建议+一句理由的裁决材料**。
- 人设一句话（BLOCK-339）不动；不外推成砍科研能力。

## §4 红线

不改产品代码/运行时、不动 WIP（DOC-REGISTRY 与 harness 文档的既有未提交改动原样保留）、不动兄弟仓、不翻 qualificationEligible、诚实红不伪造不补拍、观感零代签。提交留本地，门禁绿后按 11-24 常规放行授权逐批 push、回执留痕。
