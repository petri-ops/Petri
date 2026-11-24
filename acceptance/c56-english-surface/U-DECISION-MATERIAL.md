# U 类裁决材料 · C-56 英文面 F 类判据（2026-11-24）

> 状态：**pending_user_ruling**（不启动实现、不改稿、不碰 paper-writing Skill 注册面）。
> 授权：owner 经 Orca 转达主人「C-56 英文面：不开工改稿，但把英文 F 类判据做成裁决材料供主人拍板」。
> 上游：`docs/c56-paper-writing-manual-draft-2026-11-19.md` §5（中文 F1–F6）+ 评审要点 2「英文论文是否同批覆盖」；2026-11-24 真实英文稿跑 §9 时 F 六项中文判据标 N/A 未套用（判据未定，不外推）。
> 通用保内核（四保护/不编造/三栏对照/数字锁定/限制段零弱化/provenance）**语言无关，英文稿照用**——本次裁决只决定「英文 stylistic 检查层」是否设、设哪几条。

## 一、裁决点（单一问题）

英文论文改写/润色时，除语言无关的保真内核外，是否增加一套**英文 E 类 stylistic 检查**（对标中文 F1–F6 的形态→检测特征→改写原则三栏结构）？加几条？

## 二、候选方案（三选一；附单一推荐）

| 方案 | 内容 | 代价/风险 |
|---|---|---|
| A 内核直用 | 英文稿只跑语言无关内核，零 stylistic 检查 | 最保守；英文 AI 腔（nominalization/被动堆叠/万能开头）全部漏检，润色场景价值打折 |
| **B 内核 + 英文 E 六项（推荐）** | 新增 E1–E6（见 §三），结构与中文 F 类同形：命中位置 + 改写前后对照 + 作者逐条采纳/拒绝；只作用于作者论述性 prose，Methods 术语不在打击面 | 一次裁决后该维度全走预审闭环；检测特征为启发式（可能漏/误报，作者逐条裁决兜底） |
| C 全对齐 | 中文 F 六项照译套英文 + E 六项叠加 | F1/F4（长定语堆叠/四字排比）是中文形态特有，硬译成英文判据属「无差别形态复刻」，制造噪声 |

**推荐 B**。理由：中文 F 类的本质是「把翻译腔/AI 腔压成具体、直接、有边界的学术 prose」——英文有同构现象但形态不同，按形态重立判据（E 类）比照译 F 类（C）诚实；只做内核（A）则放弃润色场景的主要价值。

## 三、英文 E 类六项候选（每项：形态 → 检测特征 → 改写原则示例）

| # | 形态 | 检测特征 | 改写原则（示例） |
|---|---|---|---|
| E1 | 名词化堆叠（nominalization chains） | 名词化链 ≥2 层（「the utilization of the implementation of X」/「for the validation of the assessment of」） | 动词化：「we used X to validate Y」 |
| E2 | 弱动词 + 名词化搭配 | conduct/perform/undertake/carry out + analysis/investigation/study/experiment | 实义动词直出：「analyzed」「measured」「simulated」 |
| E3 | 被动语态连用 | 连续 ≥2 句被动且施事缺失（方法段标准被动除外） | 主动化或学术惯用 we：「We measured three variables」 |
| E4 | 万能背景开头 | 「In recent years, … has attracted increasing attention」/「… plays an important/critical role in」开篇 | 直接给具体事实或研究缺口 |
| E5 | 套话收尾 | 「In conclusion, our findings demonstrate the great significance of…」/「paves the way for future research」收束 | 具体结论 + 具体边界（什么成立、什么未验证）——与中文 F6 同旨 |
| E6 | 冗余连接词/套话插入语 | Moreover/Furthermore/Additionally 连开 ≥3 句；「It is worth noting that / It should be noted that」高频（≥2） | 删或合并；强调改由句序与具体内容承担 |

- 六项只作用于**作者自己的论述性 prose**；Methods 段惯用被动与术语不在打击面（与中文 F 类 §5 边界注记同形）。
- 输出形态与中文一致：每项命中位置 + 改写前后对照 + 作者逐条采纳/拒绝（建议不覆盖）。
- 判据来源=英文科技写作共识（主动语态优先、去名词化、具体开头收尾——各刊 author guidelines 通用要求），非某刊专属规则；不引具体页码不编造出处。

## 四、裁决后的执行形态（获批才生效）

1. E 类以**裁决附录**并入手册 §5（标注「英文面 · 用户裁决 2026-11-24」原话留痕）；中文 F 类一字不动。
2. Skill 注册面（resources/skills + manifest + skills:check 链）是否随批升级，**另点**（属候选①，与本裁决解耦）。
3. 获批后首个英文稿改写按「内核 + E 类」跑 §9 全链；3 轮预审不过按偏好纪律停下报主人。

## 五、请主人裁决（一次口令）

- 回「B」（或 A/C）即完成本维度裁决；亦可对 E1–E6 逐条增删（如「E6 去掉」）。
- 未裁决前：英文稿改写继续只跑内核（现状不变），E 类材料仅备不发。
