---
capability: block505-review-prompts
status: active
phase: MATERIAL
goal: 核对点执行提示词集（用户发令「针对每一个核对的点给提示词——输入提示词后工作产出，我再来核对」）——BLOCK-503 清单的每个核对点配一段可整块复制的自包含提示词，喂给执行 agent 后产出可核对的产物（真实演练/截图/DOM 读数/报告，落 acceptance/block503-outputs/），用户核对产物后再回裁决口令；全部提示词自带环境纪律与诚实边界（不代签 verified）。
acceptance:
  - BLOCK-503 清单每个核对点（甲1-3/乙1-9，H 系列合理并批）各有自包含提示词：先读指针+操作步骤+证据落盘路径+诚实边界（截图不可得如实标注、不写 verified）
  - 提示词遵守环境纪律（9223 离屏禁 PETRI_TEST_ONSCREEN、跑完 kill、零新依赖、不碰用户资产）
  - 产出统一落 acceptance/block503-outputs/<item>/，核对口径=用户看产物回 BLOCK-503 口令
  - docs 门禁 + closeout 定向 + 六件套 + commit/push
reopen: 产出形态不满足核对需要时修订对应提示词；新核对点入清单时补提示词
supersedes: 无（BLOCK-503 清单的执行层配套；清单仍是核对项与裁决格式的真源）
---

# BLOCK-505 · 核对点执行提示词集（2026-11-19）

> **用法**：每段提示词整块复制给执行 agent → 它产出工作产物（统一落 `acceptance/block503-outputs/<item>/`）→ 你核对产物 → 按 [BLOCK-503 清单](./block503-human-eye-review-checklist-2026-11-19.md) 口令回裁决。
> **统一纪律（已写进每段）**：9223 离屏（禁 `PETRI_TEST_ONSCREEN`）、跑完 kill、截图不可得如实标 `screenshot_unavailable` 不凑证据、全程不写 verified 不代签（核对签字是我的事）、零新依赖。
> **中断重试语义（2026-11-19 补，因模型流式停滞多次出现）**：每段提示词**幂等**——中断/中止后直接重发同段即可；产出路径固定（`acceptance/block503-outputs/<item>/`），重跑先读已有产物核完整性再续剩余步骤，不重头不重复计费性操作（occt/ffmpeg 腿重跑前先核已有帧图）。错峰约定：跑 closeout/test:changed/quality:perf 等重门禁前确认另一 agent 空闲（双 agent 并发时 CPU 大户与模型流式互相放大停滞）。
> **根因核实（2026-11-19 三层现读，推翻 TUN 假设）**：Clash 运行内核第 0 条=open.bigmodel.cn DIRECT、全局 Merge 已含 deepseek/sensenova DIRECT（2026-11-11 裁决）、shell NO_PROXY 已让产品聊天流绕过 Clash——三层豁免全部在位，**无可补规则；停滞=直连状态下 deepseek 对超大上下文请求的中途停摆**（同位重复出现佐证）。处置=①「先读大文档再执行」类提示词拆两步降低单次 prefill（本集提示词已按此设计，重跑前先核已有产物）②反复停滞时切 sensenova/本地渠道对照 ③provider 侧问题报渠道方。产品纵深防御已在工作：看门狗 90/60 两段+零可见输出自动重试一次（model-gateway.js:408 + llm-client.js:87）。

## P-甲1 · C-56 手册真实改写演练（产出=改写产物供核对）

```text
开始 C-56 手册演练。先读 docs/AUDIT-LOG.md 头部与 docs/c56-paper-writing-manual-draft-2026-11-19.md 手册全文，然后严格按手册 §6 三栏对照 + §5 F 类六检查 + §7 未覆盖清单，对下面这段测试文本执行一次真实改写演练：

「随着深度学习技术的快速发展，基于预训练模型的方法被广泛进行了研究。综上所述，该方法具有重要的理论意义和应用价值，为后续研究奠定了坚实的基础。实验表明模型性能得到了显著提升，准确率达到了98.7%。（注：本句数字为演练夹具）」

要求：①输出三栏对照表（原句→改写句→保真说明）②F 类逐项命中报告（F1-F6 每项标注命中位置与改写）③数字锁定校验清单（98.7% 必须逐字符保持并列入清单）④〈未覆盖清单〉。落 acceptance/block503-outputs/jiia1-c56-rewrite.md + 会话内全文。红线：只动我给的文本，不碰任何仓库文件；零新依赖；不写 verified。
```

## P-甲2 · 两来源 license 补抓（产出=license 证据）

```text
开始 capability-intake license 补抓。先读 docs/AUDIT-LOG.md 头部、.agents/skills/capability-intake/SKILL.md 与 acceptance/capability-intake/provenance.jsonl（append-only 纪律）。对台账两行 license_unknown=true 的来源（github.com/blader/humanizer 与 github.com/op7418/Humanizer-zh）：用 web_fetch 分别抓取仓库主页与 LICENSE 文件（如存在），如实记录 license 类型与 license_source；按 append-only 追加更正行（不改写原行）；抓不到 LICENSE 就保持 license_unknown=true 并如实标注 not_found。落 acceptance/block503-outputs/jia2-license-report.md（两源对照表）。红线：零新依赖；不克隆仓库、不复制受版权内容正文；不写 verified。
```

## P-甲3 · SUS/UMUX-Lite 问卷草案（产出=问卷供核对）

```text
开始 E-03 问卷草案。先读 docs/AUDIT-LOG.md 头部与 docs/ui-design-ia-decision-material.md §6。产出中文 SUS 十题 + UMUX-Lite 三题问卷各一份（面向本产品日常使用场景措辞），附建议采样方式（样本量/渠道/时机）与计分口径。落 acceptance/block503-outputs/jia3-sus-questionnaire.md。红线：只产出问卷文档，不接入任何外部平台、零新依赖、不写 verified。
```

## P-乙0 · 环境准备（所有乙组提示词的前置，一次即可）

```text
准备核对环境。按 .agents/skills/petri-dev-infra/SKILL.md「dev 栈就绪判定三面齐」纪律：cd 到仓库根后跑 scripts/restart-dev-stack.sh（三面齐=vite :3000 + 后端 :3001 + CDP pages，认编排器 stdout 指纹）；再 bash scripts/start-test-instance.sh（9223 离屏，禁 PETRI_TEST_ONSCREEN）。就绪判定=三面齐 + 9223 可连。跑完所有乙组核对后：lsof -ti :9223 | xargs kill 终止测试实例。任何一步失败如实标注并停，不凑环境。
```

## P-乙1 · UI-710 SceneSpec 证据面板 + 双形态互达（产出=截图+读数）

```text
核对 UI-710 产出。前置：乙0 环境已就绪（9223 可连）。先读 docs/AUDIT-LOG.md 头部与 docs/block463-3d-p3-presentation-plan.md。用 CDP 在 9223 实例：①构造/装载含 joints 的 SceneSpec 场景（可用 model3d/runs/ 下既有 GLB 产物或走 agent 工具链生成）②打开项目工作区右栏证据面板（joints/provenance/verifierResults 三段各截图）③从 compose 卡片触发 Result Studio 跳转，跳转前后各截图。截图落 acceptance/block503-outputs/yi1-ui710/（≥4 张）+ findings.json（面板三段 DOM 在场布尔+跳转路由读数）。跑完 kill 9223。红线：截图不可得如实标 screenshot_unavailable；不写 verified；零新依赖。
```

## P-乙2 · UI-709 Gen UI compose 渲染（产出=截图+读数）

```text
核对 UI-709 产出。前置：乙0 就绪。先读 docs/AUDIT-LOG.md 头部与 docs/block461-gen-ui-compose-plan.md。在 9223 聊天会话让 agent 产出一个 visualize/compose 结构化产物（任选五 kind 之一），等渲染完成后：①compose 卡片整体截图 ②数据面 DOM 读数（compose kind/沙箱标记）。落 acceptance/block503-outputs/yi2-ui709/（≥2 张+findings.json）。跑完 kill 9223。红线：不伪造渲染产物；截图不可得如实标注；不写 verified；零新依赖。
```

## P-乙3 · UI-707 模型行悬停配置 + 设置页（产出=截图）

```text
核对 UI-707 产出。前置：乙0 就绪。先读 docs/AUDIT-LOG.md 头部与 docs/block-456-plan.md（模型行悬停配置交付包）。在 9223：①聊天模型行 hover 触发就地配置 popover（上下文窗口/思考档），截图 ②设置页模型配置区截图（IA v2 后形态）③改一档上下文值再截一张（就地下拉生效）。落 acceptance/block503-outputs/yi3-ui707/（≥3 张+findings.json）。跑完 kill 9223。红线：不改任何配置持久值（演练用临时会话）；不写 verified；零新依赖。
```

## P-乙4 · UI-706 Endpoint 主表+行详情（产出=截图）

```text
核对 UI-706 产出。前置：乙0 就绪。先读 docs/AUDIT-LOG.md 头部与 docs/block-455-model-level-capabilities-plan.md §P4。在 9223 设置页：①API Endpoint 主表截图（8 列形态）②任选一行展开行详情截图（折叠态+展开态各一张）③能力声明模型级化区域截图。落 acceptance/block503-outputs/yi4-ui706/（≥3 张+findings.json：列数读数）。跑完 kill 9223。红线：不新增/修改 Endpoint 持久数据；不写 verified；零新依赖。
```

## P-乙5 · P4 八态矩阵 32 格（产出=逐格截图矩阵+勾选表）

```text
核对 C-53 P4 八态矩阵。前置：乙0 就绪。先读 docs/AUDIT-LOG.md 头部、docs/ui-design-acceptance-checklist-v1.md §1（32 格判据）与 acceptance/block473-c53-p4-responsive-a11y/responsive-a11y-snapshot.json（12 人眼格标注）。在 9223 对 12 个人眼格逐格触发两态（如默认/hover、focus/普通）并逐格截图，产出截图矩阵目录+勾选表 md（每格：判据引用/截图路径/一致与否留待我判定——你只产出证据与「与机械判据一致性」读数，不替我判观感）。落 acceptance/block503-outputs/yi5-matrix/。跑完 kill 9223。红线：截图不可得的格子如实标 screenshot_unavailable；不写 verified；零新依赖。
```

## P-乙6 · P5 性能可信 + P6 Skill 触发链（产出=截图+读数）

```text
核对 C-53 P5/P6 观感面。前置：乙0 就绪。先读 docs/AUDIT-LOG.md 头部与 docs/block474-c53-p5-performance-trust-plan.md、docs/block475-c53-p6-skill-contract-plan.md。在 9223：①发起长回复，流式过程中截 pending 态（compose-stream-pending 占位）②完成后截 completed 态 ③构造空态/错误态各一张（断后端或空会话）④让 agent 走一次 design-brief skill 触发链（skill_discover→skill_get），截消费面。落 acceptance/block503-outputs/yi6-p5p6/（≥5 张+findings.json）。跑完 kill 9223。红线：不写 verified；零新依赖。
```

## P-乙7-A · H-01+H-02 页头 bare 与 768px（产出=两态截图组）

```text
核对 H-01/H-02。前置：乙0 就绪。先读 docs/ui-design-human-eye-route.md §3 H-01/H-02 路线原文。在 9223：①H-01：/extensions 独立页顶栏截图 vs 项目工作区顶栏截图（同窗口尺寸、亮色）②H-02：视口 769px 与 768px 两态截图（侧栏/投影抽屉），记录 data-projection 读数。落 acceptance/block503-outputs/yi7a-h01h02/（≥4 张+findings.json：bare 形态布尔+768 触发布尔）。跑完 kill 9223。红线：只截图不改 CSS；不写 verified；零新依赖。
```

## P-乙7-B · H-03+H-04 暗色 hover 与 selected token（产出=截图组）

```text
核对 H-03/H-04。前置：乙0 就绪。先读 docs/ui-design-human-eye-route.md §3 H-03/H-04 路线原文。在 9223：①H-03：暗色下对 5 类元件逐个 hover 截图（同一提亮档位核验素材）②H-04：指挥中心选中卡片在 4 主题色×亮暗共 8 态逐张截图。落 acceptance/block503-outputs/yi7b-h03h04/（≥13 张+findings.json：token 读数）。跑完 kill 9223。红线：只截图不改 CSS；不写 verified；零新依赖。
```

## P-乙7-C · H-05+H-06 对比度与焦点环（产出=元素截图+焦点记录）

```text
核对 H-05/H-06。前置：乙0 就绪。先读 docs/ui-design-human-eye-route.md §3 H-05/H-06 路线原文与 acceptance/block473-c53-p4-responsive-a11y/ 机械读数（WCAG 4.40:1 三级文字/focus 缺口 12 文件）。在 9223：①H-05：亮色下三级文字置于 subtle 表面的元素级截图（带 computed color 读数）②H-06：Tab 遍历 12 个缺口文件元件，逐个截焦点环可见性+DOM 顺序读数（VoiceOver 朗读部分如实标注 agent 不可得，留给真人）。落 acceptance/block503-outputs/yi7c-h05h06/。跑完 kill 9223。红线：读屏主观部分不代答；不写 verified；零新依赖。
```

## P-乙8 · E-01 树测试 + E-02 22 条 debt 扫描（产出=路线执行报告）

```text
核对 E-01/E-02。前置：乙0 就绪。先读 docs/AUDIT-LOG.md 头部、docs/ui-design-ia-decision-material.md §6（E-01 六步树测试判据）与 docs/e-class-human-eye-guide-2026-11-16.md（22 条索引）。①E-01：在 9223 用 CDP 走完六步任务路线，记录每步点击数与到达页（机械可测部分产出读数；真人手感部分如实标注留给真人）②E-02：对 22 条 debt 逐条定位对应 UI 面，每条截图+当前状态读数，产出扫描表（11 已 verified 项复核在场所见/9 in_progress 项截图/2 cancelled 项留因核对）。落 acceptance/block503-outputs/yi8-e01e02/（22 张+两份报告）。跑完 kill 9223。红线：不写 verified 不替我下终态结论（你产出证据与读数，判定归我）；零新依赖。
```

## P-乙9 · C-55 成片帧提取（产出=关键帧+ffprobe 读数）

```text
核对 C-55 成片。先读 docs/AUDIT-LOG.md 头部与 acceptance/block483-c55-video-p1/evidence-report.json（既有 QA 读数）。对 acceptance/block482-c55-video-p0/video.mp4（21.9s）：①ffprobe 全量技术读数（编码/分辨率/帧率/音画时长 skew）②ffmpeg 按 2s 间隔抽关键帧（约 11 张 PNG）+字幕烧录特写 1 张（取中段含字幕帧）。落 acceptance/block503-outputs/yi9-c55/（帧图+ffprobe.json）。红线：只读视频不重渲染；零新依赖（ffmpeg/ffprobe 既有）；不写 verified。
```

---

**核对口径**：每个 P 跑完后你看 `acceptance/block503-outputs/<item>/` 里的产物 → 按 [BLOCK-503 清单](./block503-human-eye-review-checklist-2026-11-19.md) 口令回裁决 → 我按台账纪律回写（内容出自你）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
