---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W7 波「Agent Skill 知识面」——CP-20 SKILL.md 常驻双格式注册+声明式依赖（KNW-4 导入通道扩展，候选③转正）/CP-21 依赖自检与安装治理（preflight 探测+审批留痕+Skills 页状态面）/CP-22 首批通用技能包迁移（Obsidian 九技能转写，CLI 族挂依赖声明）
acceptance:
  - CP-20：双格式同注册表可发现（skill.json 契约 + SKILL.md 常驻）；frontmatter 依赖字段（os/requires.bins/install）过 skills:check 扩展校验
  - CP-21：带外部依赖技能实机走通「探测→审批→安装→可用」链；安装动作审批留痕可查
  - CP-22：w7-live 实机 discover→get→按手册产出全链留痕（acceptance/block-176/）
  - closeout 十三门绿 + 总纲 §4 W7 行回写
reopen: 任一 CP 出口断言未达即该 CP 返工；波内零停顿条款沿用 W1~W5 先例（发令时确认行使）
status: completed
---

# BLOCK-176 — 竞争力总纲 W7 波（Agent Skill 知识面）

## 0. 来源与授权

- 总纲：[`agent-competitiveness-program.md`](./agent-competitiveness-program.md) §4-W7（本批扩纲）。
- 用户裁决：2026-10-12 演示 ZCode Obsidian 官方插件（纯 SKILL.md 技能包+外部 CLI）后裁决「**我觉得应该加加到 petri 并且应该是作为主要的功能之一**」+ AskUserQuestion 答复「**W7 先行（推荐）**」（W6 顺延）。
- 候选转正：roadmap 研究候选池③「skill 声明式依赖三件套」（2026-09-06 登记自 OpenClaw 对标解剖：SKILL.md frontmatter 携带 `os` 平台门控 + `requires.bins` 二进制探测 + `install` 配方）由 CP-20 承接，候选行出籍注记。
- 发令状态：**planned**——唯一 active 槽位现被 W5（BLOCK-175，并行会话在制）占用；W5 收口腾出槽位后本波顶队列头发令（用户裁决「W7 先行」= W7 优先于 W6，不打断 W5 在制工作）。

## 1. 防重复开发盘点（先勘察后动手）

- **KNW-1/KNW-2（BLOCK-157）**：`skill_discover`/`skill_get` agent 工具与渐进披露（有界投影+8000 字符正文预算）已交付——本波零重建，直接复用通道。
- **KNW-4（BLOCK-160 P5）**：SKILL.md 受限解析导入已存在（`core/shared-backend/skill-registry.js` 零 YAML 依赖解析 frontmatter name/description，导入时合成 skill.json+prompts/system.md 落库）——CP-20 是把「导入即合成」扩展为「**常驻双格式注册 + 依赖字段语义**」，不重建解析器。
- **visualize/coding-playbook**：内置 agent-facing skill 先例（BLOCK-166）——CP-22 迁移的对齐形态。
- **审批留痕链**：CP-21 对齐 BLOCK-171 CP-2 guard-ack 既有装置，不建第二确认通道。

## 2. 范围

- **CP-20 skill 格式 v2·声明式依赖**：
  - skill-registry 支持双格式常驻注册：既有 skill.json 契约不动；SKILL.md 目录可直注册（保留 KNW-4 合成通道为安装面行为）。
  - frontmatter 新增依赖字段并进注册表面：`os`（平台门控）、`requires.bins`（二进制探测清单）、`install`（安装配方，含命令与说明）。
  - `skills:check`（scripts/skill-scaffold.mjs）扩展：双格式校验 + 依赖字段结构校验。
- **CP-21 依赖自检与安装治理**：
  - skill 可用性 preflight：按 `requires.bins`/`os` 探测本机状态，输出 可用/缺依赖/待装 三态（缺什么如实报告）。
  - 安装动作治理：执行 `install` 配方须走审批确认+留痕（对齐 guard-ack/审批记录链）；未批准不执行。
  - Skills 页状态可视化：技能卡显示依赖三态。
- **CP-22 首批通用技能包迁移**：
  - Obsidian 九技能转写为 Petri 形态（类别扩 coding/notes 与 coding/extract）：生成类五（obsidian-markdown/mermaid-visualizer/excalidraw-diagram/json-canvas/obsidian-bases）直接迁；CLI 三（obsidian-cli/defuddle/knap）挂 `requires.bins`+`install` 配方；setup 转写为 preflight 说明性技能。
  - 可视化技能的产出指引与 Gen UI 模板优先节打通（mermaid/图表类指向既有模板节）。

## 3. 非范围（红线）

- **不做云 marketplace/远程分发**：技能包来源=内置+用户本地目录（BLOCK-158 商店面退役先例；本地主权形态即差别化）。
- **不改 BLOCK-157 plan §2 裁决**：`skill_execute` 仍不投影给模型——「读手册→用既有工具执行」已实机验证够用（w1-live 断言①先例）。
- **不迁 Obsidian 产物格式**：.canvas/.base/.excalidraw 文件格式原样不进 Petri——迁移的是**技能形态**（触发描述+渐进披露+依赖声明），可视化产出走 Petri 自己的 Gen UI/artifact plane。
- **既有内置 skill 契约不动**：5 个既有 skill.json（deg/go/scrna/coding-playbook/visualize）零改写，双格式=并存不替换。
- **尾巴清偿（2026-10-12 追加，用户「小尾巴都搞完」授权）**：①defuddle 0.1.0 + knap 0.6.0 经 `npm install -g` 全局就位（包身份与技能语义核对后安装；w7-live 复跑 9/9，preflight 分布 13 available/1 installable）；②obsidian-cli **如实 blocked**：本机未装 Obsidian 本体，官方 CLI 随 1.12+ 应用分发——第三方同名 npm 包非官方件，装之会制造假 available，不装；装机后跑 `skill_preflight` 复核即可转 available。③W6 CP-18 roundtrip 分档同批清偿：dev 栈后端经 supervisor 重生后复跑 w6-live 8/8（PUT 12.5→读 12.5→清 0 真实留痕）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 4. 依赖与并行隔离

- 硬依赖：CP-20 ──▶ CP-21 / CP-22（总纲 §5 已登记）。
- **W5（BLOCK-175）在制隔离声明**：W5 文件面=frontend viewer 能力位+ArtifactPinPane+renderer 对账；本波文件面=core/shared-backend/skill-registry.js + core/petri-server/agent-tools/{skill-tools.js, tool-defs/skill.js} + resources/skills/ + Skills 页前端 + scripts/skill-scaffold.mjs——**零交叠**。
- 并行会话未提交面（agent-runner.js/vision-inline.js/gen-ui-prompt.js/chat.js）不在本波文件面，零触碰。

## 5. 验收门禁

| 门 | 内容 |
| --- | --- |
| 定向测试 | skill-registry 双格式/preflight 纯函数测试 + skill-tools 契约测试（估 ≥3 文件 ≥12 用例，红绿先行） |
| 专项门禁 | `npm run skills:check` 扩展后全绿 |
| 实机断言 | w7-live ≥3 断言（双格式发现 / 缺依赖技能诚实拒绝+安装审批链 / 全链 discover→get→产出留痕），证据 acceptance/block-176/ |
| 治理门 | docs:check + ui:audit:check + closeout 十三门 |

## 6. 完成语义与节奏

- 发令后 CP-20 → CP-21 → CP-22 波内零停顿（沿用 W1~W5 整波授权先例，发令时随口确认）；预期当日~次日收口。
- 收口回写：总纲 §4 W7 行 + §4.7 对账表 + roadmap + backlog + 本 plan status。

## 7. 波报（2026-10-12 收口）

- **CP-20 双格式注册**：`loadSkillFromDir` 双格式单点（skill.json 优先，缺则 SKILL.md 直装载 `loadSkillMdEntry`，`_format` 标注）；依赖三字段（os 门控/requires.bins/install 配方）经 `normalizeDependencies` 归一（别名 darwin/macos→darwin、win/windows→win32；非法 token 进 invalid fail-closed 报告），skill.json 契约 additive `dependencies` 字段同语义；`skills:check` 双格式校验（SKILL.md 目录 frontmatter name/description 必填+依赖结构+顶层 manifest format 标注核对）——14 技能（5 json+9 md）全绿。既有 5 skill.json 零改写。
- **CP-21 治理链**：`skill-preflight.js` 纯函数三态（available/installable/missing_deps）+诚实第四态 blocked_platform（注入 platform/hasBin 测试直打；运行时 which/where 探测，失败=未检出不虚报）；`skill_preflight` agent 工具（retrieval/none/R0，tool-defs 契约）+`GET /api/skills/preflight` 路由+Skills 页（extensions 货架）依赖三态徽章（探测面不可达=徽章缺省不虚报状态）；**安装治理=既有 run_cmd guard-ack 审批链**（preflight 指引明示「未批准不执行」，不建第二确认通道——plan §1 裁决兑现）。
- **CP-22 迁移**：九技能 SKILL.md 落 resources/skills/（obsidian-markdown/mermaid-visualizer/excalidraw-diagram/json-canvas/obsidian-bases 生成五；obsidian-cli/defuddle/knap 挂 requires.bins+install；obsidian-setup 转写 preflight 引导）；类别 coding/notes + coding/extract；mermaid 手册打通 Gen UI 卡片+visualize 模板优先节；不迁产物格式（.canvas/.base/.excalidraw 为数据文件，Petri 不做运行时渲染——plan §3 红线兑现）。
- **实机**：w7-live 9/9（acceptance/block-176/w7-live.json）——含 defuddle「探测(installable)→本地隔离安装(npm --prefix 临时目录，零全局污染)→复核(available)」全链真实留痕；真实全局安装留待用户授权会话（不越权）。
- **随批缺省裁决**：SKILL.md frontmatter 键用点号直书 `requires.bins:`（等价 `requires-bins` 双收）；preflight 安装不自动执行（指引+审批链，安装动作永远人审）；Skills 页徽章只在声明了 requires.bins 的技能卡显示。
- **契约**：test/block176-w7-contracts.test.mjs 8/8（归一/解析/双格式装载/真实仓发现/三态/接线源码面/manifest 标注/注册表集成）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
