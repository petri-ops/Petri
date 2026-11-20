---
capability: user-preferences
goal: 把 Petri 历史裁决与已固化规范里的用户偏好，按维度系统整理成可定稿清单，供用户逐条裁决；定稿后才升格为偏好 canonical。本文件本身不改任何纪律本体。
acceptance:
  - 7 维度逐条列现状+定稿建议+裁决状态+证据路径
  - 5 项待裁决空白显式列出；未定稿条目不进纪律本体
reopen: 用户逐条裁决（采纳/改字/删除）后把确认条文升格 canonical；本文件保持 reference 作为定稿材料
status: reference
---

> **定稿状态：已裁决（2026-11-20）**。用户逐条给出口径：4.4 emoji 不滥用且呈现有质感、中英文混排与标题按钮句式按「名词短语标题/动词短语句」采纳；3.5/3.6 升为跨 UI 审美通则；6.3 升为工程通则；5.2/5.3/5.5/5.6 全采纳；冲突优先级=文字少优先；**新增「输出简洁」偏好**（最高优先）。定稿条文已升格 `AGENTS.md` §用户偏好 canonical。下表保留作为证据与推导链。

# 用户偏好定稿清单（候选 · 待逐条裁决）

> 来源：2026-11-20 用户「系统性从不同角度列出，我来定稿」。三路取证：①视觉/布局/文案 ②人设/交互/agent 行为 ③AUDIT-LOG 与 UI 台账历史裁决原话。
>
> **怎么读这张表**：每条给「现状」（仓库里已经生效的原话或机械门）+「定稿建议」（我提炼成一句话的可裁决条文）+「裁决状态」：
> - `已固化` = 已由原话/机械门锁定，列出仅供确认，**不需要你再裁决**
> - `建议采纳` = 从多处原话归纳、逻辑上成立，建议你直接点头或改字
> - `需裁决` = 有分歧/空白/新维度，必须你定
>
> 定稿方式：你逐条给「采纳 / 改字 / 删除」，我把确认后的条文升格到 `AGENTS.md` 偏好段并登记 canonical；未确认的保持候选，不进纪律。

---

## 维度 1 · 产品身份与差异化（魂）

| # | 现状（原话/证据） | 定稿建议 | 状态 |
|---|---|---|---|
| 1.1 | 「格物（Petri）是跑在你机器上的通用 agent——本地主权、全链可审计、证据自证；以目标为输入、工具为手足、真实产物为交付；领域能力由已安装领域包按需放大，不是与生俱来的身份。」`AGENTS.md:37-39`（BLOCK-339 钉死，改动需裁决） | 保持原文，作为一切文案的身份基准 | 已固化 |
| 1.2 | 「避免成为另一个 Zcode 或者 codex 呀 保留自己的特色 借鉴他们的优点」`AGENTS.md:33-35`；升格为 X5「差别形态自检」`docs/agent-experience-design-principles.md:58` | 对标只借「形」（交互范式/质感/审批 UX），凡借必答「本地可审计/治理透明/证据自证体现在哪」，答不出不做 | 已固化 |
| 1.3 | 「agent 的通用能力仍旧是最核心的开发重点，它也应该突出自己的优势，不仅仅是增加数据资产」`docs/agent-competitiveness-program.md:13` | 通用能力（编排/知识/工具/模型计量/可靠性）是主线，议程不因对标收缩；领域资产是放大器不是身份 | 已固化 |

## 维度 2 · 本地主权与可信（卖点形态）

| # | 现状 | 定稿建议 | 状态 |
|---|---|---|---|
| 2.1 | 本地主权 = agent 本体全链跑在用户机器、断网可用、无厂商中继、全链可审计 `AGENTS.md:41` | 任何新能力默认本地执行、零外发；需要外发必须显式确认 | 已固化 |
| 2.2 | EVO 全链反复出现「纯本地零外发/不进开发治理链」`docs/evo-harness-self-evolution-plan.md` | 「越用越好用」的自进化闭环必须本地、可查可删、不回传 | 建议采纳 |
| 2.3 | 实机证据文化：`verified` 必须有截图/断言背书，不编造 `docs/ui-design-acceptance-checklist-v1.md:34,79` | 宣称通过必须有可复现证据；无证据如实标注 unavailable | 已固化 |

## 维度 3 · 视觉 / 布局 / 信息密度

| # | 现状 | 定稿建议 | 状态 |
|---|---|---|---|
| 3.1 | 字号 6 档（28/20/16/14/12/11px，body=14 默认占比≥50%，xs 仅徽标）`docs/design-charter.md:16-28`；禁裸 px `theme-token-contract.test.ts:208-238` | 只用 `--petri-font-size-*` 六档，禁新增字面 px | 已固化 |
| 3.2 | 海军蓝暗色四阶 + 亮色 zinc/纯白 purity；禁 slate 字面量、禁零定义 token、禁颜色 fallback `petri-css-theme/SKILL.md:10-27` | 颜色一律 `--petri-*` token；悬停/选中语义不混用；强调色只走 `--petri-accent*` | 已固化 |
| 3.3 | 间距 8 档 / 圆角 4 档 / z-index 8 档（Toast 最高）`theme-token-contract.test.ts:118-141`；动效 3 档 duration + 2 档 ease（150/200/300ms）`design-charter.md:48-52` | 阶梯外不新造；`prefers-reduced-motion` 豁免保留 | 已固化 |
| 3.4 | 中性:强调 ≥10:1、accent≤130、每视图强调点≤8；accent 五类语义；线条三语义、无语义 1px 细线终态 0 `design-charter.md:30-46` | 保持色彩预算；分隔优先序=留白>底色差>divider | 已固化 |
| 3.5 | 「很割裂 / 主题色保持一致 / 不要那么多线条」→ 全页只留顶栏 1 条线、色阶 3→2、accent 4→2、阅读列 720px（BLOCK-423）`audit-log-through-2026-11-11...md:12` | **少线条、单色阶、内容居中** 作为设置/内容页基调 | 建议采纳（原话是具体页，升为通则请确认） |
| 3.6 | 「简单文字少，布局和谐」（UI-716 偏好预审首例）`AGENTS.md:231`；「默认就收起，别占空间」`ui-productization-audit.md:444`；「中间栏固定宽度太宽…手机屏幕宽度更合适」`:751` | **文字精简、默认收敛、不占空间、列宽克制** | 建议采纳（你已用 UI-716 裁决过一次，可升为通用审美偏好） |
| 3.7 | 几何四块 G1-G4 + 长内容三态 L1-L3 `ui-design-acceptance-checklist-v1.md:36-56`；min-width:0 贯穿 flex/grid 链 `petri-css-theme/SKILL.md:67-77` | 布局改动「重构不追加」，单一真源，旧规则失效而非覆盖 | 已固化 |
| 3.8 | WCAG AA 正文 4.5 / 大字 3.0，不得放宽 `scripts/ui-design-a11y.mjs:43-44`；触摸目标图标 24px/标准 30px；八态 + focus-visible | 无障碍阈值是硬底线，不因偏好放宽 | 已固化 |

## 维度 4 · 文案风格

| # | 现状 | 定稿建议 | 状态 |
|---|---|---|---|
| 4.1 | 人设一句话即文案基准（见 1.1）；P1 必清 9 条生信身份 + P2 宜清 14 条语气 `block-339...plan.md:6-12` | 一切用户可见文案读起来像「通用 agent」，不带垂直领域身份 | 已固化 |
| 4.2 | 拒绝类不回击用户措辞、不臆测意图列菜单、不夹带无关话术 `block-197...plan.md:3,68,96` | 拒绝要诚实、简短、不自述规则 | 已固化 |
| 4.3 | 禁用态/空态/错误态文案须给真实原因，不静默消失 `module-state-matrix.md:31`、`ui-design-acceptance-checklist-v1.md:22-31` | 状态文案如实：说明为什么，不伪造 | 已固化 |
| 4.4 | **空白**：全仓无「禁用 emoji / 中英文混排 / 标题按钮句式模板」的裁决 | 你定：要不要禁 emoji？标题/按钮有没有固定句式？ | 需裁决 |

## 维度 5 · 交互流程与形状

| # | 现状 | 定稿建议 | 状态 |
|---|---|---|---|
| 5.1 | 「聊天对话框出来…想看再点击打开 studio」「结果卡轻量化 + 返回路径 我认可」→ chat-first / Studio-on-demand `AUDIT-LOG.md:90` | 深度面按需展开，聊天是主面；轻量摘要默认、详情点击进 | 已固化 |
| 5.2 | 「会话列表拿不到 id 不便定位」+ 点名对标 ZCode 右键菜单 → UI-715 `AUDIT-LOG.md:11` | 信息获取类操作给右键/只读入口，不藏深 | 建议采纳 |
| 5.3 | 过程/思考「运行中展开、完成后折叠」`block-107...plan.md:179`；「默认收起别占空间」`:444`；高级组默认收起 `settings-ia-simplification-design.md:51` | 过程信息默认收起、运行时才展开 | 建议采纳 |
| 5.4 | 发送/停止按钮同位置不跳动 `ui-productization-audit.md:763`；模型配置 hover 就地展开、API Endpoint 上下文档位删 `UI-706/707` | 控件位置稳定、配置就地、冗余设置项删掉 | 已固化 |
| 5.5 | 「加入任务改成加入上下文，点击发送后再启动任务」`:935`；批注带路径以便溯源 `:997` | 动作语义明确（加入≠立即执行）、可溯源 | 建议采纳 |
| 5.6 | 一键预设（Jev/Laya 按钮直接切换、省配置）`ui-productization-audit.md:5330`；一键成片、诊断一键导出 | 高频操作一键直达，减少配置步骤 | 建议采纳 |

## 维度 6 · Agent 行为与交付节奏

| # | 现状 | 定稿建议 | 状态 |
|---|---|---|---|
| 6.1 | 单工作包串行、收口后不主动开新包、不主动提 G1+ `AGENTS.md` G0 纪律 | 一次一个 active，G0 不外推 packaged/Provider/GA | 已固化 |
| 6.2 | P4「一个最合理方案 + 简短理由，不罗列多选项甩给用户」`agent-experience-design-principles.md:37`；Jev 唯一建议禁多选 `NEXT-STEP-BRIEF` | 给一个建议，禁止「或/二选一/菜单」 | 已固化 |
| 6.3 | 「不是修修补补打补丁，要彻底解决；手动重试不合理」`AUDIT-LOG.md:97`；「系统评估后彻底解决」`block510...plan.md:19` | 根因先行、拒绝补丁叠加；能自动就别让用户手动 | 建议采纳（升为通用工程偏好请确认） |
| 6.4 | 「一次性搞完」`next-work-blueprint...md:52`；任务完成必给下一步提示（固定三段+可复制口令）`NEXT-STEP-BRIEF` | 一次会话尽量闭环；交付附可执行下一步 | 已固化 |
| 6.5 | 观感签字=用户口令 OR 偏好预审闭环（2026-11-20 裁决，≤3 轮、仅呈现面、逐条判据）`AGENTS.md:231` | 已按你最新裁决写入，列出确认无变化 | 已固化 |

## 维度 7 · 实机与验收纪律

| # | 现状 | 定稿建议 | 状态 |
|---|---|---|---|
| 7.1 | 「不要屏幕出现」→ 测试窗一律离屏、不设 `PETRI_TEST_ONSCREEN`、跑完 kill `petri-dev-infra/SKILL.md` | 默认不开可见窗口，不为取证开窗 | 已固化 |
| 7.2 | 禁 `:hover` 内联截图冒充全态、禁静态分写成实机观感分 `ui-design-acceptance-checklist-v1.md:34,79` | 证据不可伪造；拿不到就标 unavailable | 已固化 |
| 7.3 | 主进程代码改动须重启 Electron（后端重启不够）+ 主窗 handler 只读契约 flow `mainwindow-handler-contract` `evo-harness-self-evolution-plan.md §13` | 主进程改动收口必跑主窗 handler 探活 | 建议采纳（本批刚沉淀，可升通则） |

---

## 裁决结果（2026-11-20 · 已定稿）

1. **4.4 文案**：emoji 不滥用、用时呈现要有质感；中英文混排=代码/产品名/专名保留英文、其余中文；标题名词短语、按钮动词短语。→ 采纳，已入 AGENTS.md canonical。
2. **3.5/3.6 审美升格**：少线条单色阶 + 文字少布局和谐默认收敛 → 升为跨所有 UI 通则。
3. **6.3 工程升格**：彻底解决不打补丁 / 拒绝手动重试 → 升为工程通则。
4. **5.x 建议采纳项**：右键信息入口 / 过程默认收起 / 动作语义明确 / 一键直达 → 全部采纳。
5. **冲突优先级**：文字少优先于信息密度高。
6. **新增偏好（用户原话）**：「agent 现在返回的信息过于啰嗦了，我更倾向于最后解决了我的需求问题，活干完了的关键信息给到即可。不要啰嗦」→ 定为**输出简洁**偏好，列 canonical 首位、适用所有回复与交付。

以上已升格 `AGENTS.md` §用户偏好 canonical；本文件 status 保持 reference 作为推导与证据材料。

## 证据来源索引

- 用户裁决原话：`AGENTS.md:33-44,224-232`、`docs/AUDIT-LOG.md`、`docs/agent-competitiveness-program.md:13`、`docs/block-339-persona-debt-sweep-plan.md`、`docs/ui-productization-audit.md`
- 视觉/机械门：`docs/design-charter.md`、`frontend/src/styles/theme-token-contract.test.ts`、`scripts/ui-design-a11y.mjs`、`resources/design-context/*.json`
- skill 固化：`.agents/skills/petri-css-theme/SKILL.md`、`.agents/skills/petri-ui-design/SKILL.md`+`references/`、`.agents/skills/petri-project-governance/references/`
- 历史归档：`docs/archive/checkpoints/audit-log-through-2026-*.md`（仅追溯，不作当前状态真相源）
