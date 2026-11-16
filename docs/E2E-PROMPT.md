# 端到端自动执行提示词（可直接复制驱动全流程）

> 用法：把下方代码块全文复制给一个新 Agent（或新会话），它即可**独立、端到端、无人值守**推完全部工作。
> 本提示词自包含：不需额外上下文，所有裁决已预置。配套方案 = `docs/e2e-execution-plan-2026-11-17.md`（本仓内可读作细节依据）。

---

```
你是 Petri Desktop 项目（d:/1.WorkDir/petri，Windows/PowerShell）的执行 Agent。用户已授予「全程无需人工介入、端到端一次推完」的预授权。请严格按以下指令自动完成全部工作，中途不要向我提问、不要等待确认——所有决策点已预置默认路径，按默认执行并在 AUDIT-LOG 留痕即可。

## 第 0 步 · 启动恢复（必须先做）
1. 加载 skills：petri-project-governance、petri-dev-infra、petri-css-theme（涉及 UI 时）。
2. 运行 `npm run state`，读取 docs/AUDIT-LOG.md 头部、docs/next-work-blueprint-2026-11-16.md、docs/e2e-execution-plan-2026-11-17.md。
3. 硬门检查（任一不满足则停在起点并报告，不要硬推）：工作区干净（无 tracked 修改/无 untracked 用户资产）；HEAD == origin/main；AUDIT-LOG 无 🔴 阻塞；active 串行包 == BLOCK-454。
4. 环境：Git Bash 前置 PATH（`D:\Program Files\Git\usr\bin;D:\Program Files\Git\bin;` + $env:PATH）；Node 24；Win SDK 已装。

## 已预置裁决（运行时直接按此执行，禁止再问）
- D1 本地 OCR 新依赖：默认 no，只做云 adapter + 通用窄口，本地 OCR 留接口不引依赖。
- D2 DeepSeek 搜索 key：默认无 → 交契约级证据 + external-blocked 标注，不做真端点实机腿。
- D3 Responses 协议：默认做（先补抓官方文档 UNVERIFIED 项，抓不到则该子步 external-blocked，不硬写）。
- D4 设置页 IA：默认不插队，W1-W5 收口后再 W7。
- D5 post-h9 文档缺失红：默认保留红 + AUDIT-LOG 说明，不擅改 registry、不摘除。
- D6 设置搜索快捷键：随平台（macOS Cmd+, / Windows Ctrl+,）。
- D7 ASR/TTS：默认暂缓，不启动。
- D8 UI-703 宽表头观感：默认待用户过目，台账保持 in_progress，不代签、不阻塞。
- 唯一例外：若出现未预置的新裁决点（安全红线/用户资产/未预期破坏性操作），停下并报告——这是保护不是失败。

## 全局纪律（每步都守）
- 单工作包串行：同时只有一个 active 工作包；波次内按序，不并行开新包。
- HK-01 红绿先行：新行为契约先写失败测试再实现；纯文档/契约核实豁免。
- 门禁：实现包收口跑 npm run closeout；文档类跑 docs:check + docs:reconcile；专项门按各步声明。
- canonical 回写：每波次同提交更新六件套（plan 状态/蓝图波次/roadmap 指针/handoff/AUDIT-LOG/相关台账）。
- 失败诚实：契约抓不到→标 UNVERIFIED+external-blocked；无 key/无样本→契约级证据+external-blocked；测试红先归因（本包引入 vs Windows 存量债）再修；禁止伪造通过、禁止静默吞错、禁止改基线掩盖。
- 设计宪法（全步适用）：读 docs/agent-experience-design-principles.md——P1 体验优先但证据不可省 / P2 自主只在用户 accessMode 档内且权限只认 UI 显式档位 / P3 自动化信息获取且来源可审计·失败诚实·本地主权 / P4 方案择优可追溯可覆盖 / P5 人工介入最小化但 ask-deny·破坏性·付费必须确认 + X1-X5。
- 每步引用 docs/product-function-frontier-and-minimal-design.md 的 R1 机制显化率：新工作须声明把哪个「已实现但不可见」的存量机制变成用户可感。

## 执行序列（严格按序，逐步执行，每步按其任务卡做完再进下一步）

### W1 · vision 修通
读安装版 C:\Users\Admin\Documents\Petri-Local\ai-settings.json 与 dev 版（脱敏）对比 vision/embedding 绑定 → 定位 vision_failed:no_api_key 成因 → 若是绑定问题则修口径/指引（复用现有 OPENAI_FAMILY 归一，不新造管道）→ 加 image_url 契约测试 → 跑定向测试+types+docs:check → 证据落 acceptance/block-454/p1/ → 回写六件套 → commit+push。

### W2 · 搜索 adapter
按 docs/block-454-endpoint-contract-findings.md 的 /v1/tools/search 契约：红测试（钳位/来源标签/未配置诚实报/cost 计量）→ 实现 deepseek-search adapter 归一到现有 search 结果形状 → SearXNG 保持默认 → 定向测试+secret/arch → 证据 acceptance/block-454/p2/（无 key 标 external-blocked）→ 回写 → commit+push。

### W3 · OCR 窄口
建通用 ocr(file,options) 窄口（工具语义，不进 registerProvider capabilities）→ 红测试 → DeepSeek OCR adapter（multipart file+purpose，pages[].text + 版面标记）→ knowledge 扫描件 PDF 接入 → 按页 cost.requests + artifact 留痕 → 定向测试+knowledge 邻域+arch → 证据 acceptance/block-454/p3/ → 回写 → commit+push。

### W4 · 文件输入链
Files API（POST /files + file_id）对接 knowledge → 对话内联文件块按协议归一（Chat file / Responses input_file / Messages document）→ 契约测试 → file_id 跨会话归属校验在 win32 不空转 → 证据 acceptance/block-454/p4/ → 回写 → commit+push。

### W5 · Responses 协议
先补抓官方 /responses 完整请求形态文档（更新 findings，标 VERIFIED）→ Responses adapter → 内联 deepseek_web_search/read_url/safety_check/title 映射（safety_check 不替换本地治理）→ 契约测试（thinking/tool_use/citations/refusal 投影不丢）→ 证据 acceptance/block-454/p5/ → 回写 → BLOCK-454 标 completed（P6 暂缓不阻塞）→ commit+push。

### W7 · 设置页 IA v2
核对 UI 台账取未占用号（UI-703 已用，下一个）→ 红测试（core 5 组/深链映射/搜索可达/UpdateCard）→ 左栏 core 13→5 + 高级折叠组（治理/推理/联网/远程/快捷键/诊断/实验搜索可达）→ 全局设置搜索（复用 CommandPalette.tsx）→ 页面内 UpdateCard（复用 useAutoUpdate+app:notify）→ 按 R2 三层信息架构（目标→产物→审计）验收 → 深链映射不失效 → theme-token-contract+ui:audit+types+定向测试 → 证据 acceptance/ui-<号>/ → UI 台账新条目（观感项 in_progress 不代签）→ 回写 → commit+push。

### W9 · 遗留治理清账
npm run task:status 对账 4 条失败后台任务（确认均为已解决问题的过程产物后登记清账）→ post-h9 红按 D5 保留+AUDIT-LOG 说明 → docs:check 复核只剩既有红 → commit+push。

### W8 / W6 / W10 · 不执行但必须在最终报告列出
W8=UI-703 待你过目宽表头（不代签）；W6=ASR/TTS 暂缓缺需求；W10=规划大纲需另立包。

## 收尾（全部波次完成后）
1. 全量核对 §5.1 每波次收口检查（docs/e2e-execution-plan-2026-11-17.md）。
2. 最终报告：各波次结果 / 未执行项(W6/W8/W10)+原因 / external-blocked 清单 / 剩余既有红 / 下一步建议。
3. 更新蓝图 W1-W9 状态、roadmap 指针、handoff、AUDIT-LOG 收口行，最终 commit+push。
4. 输出固定下一步提示（Jev 单一建议 + 母纲波次 + 蓝图进展）。

## 结束条件
当 W1-W5+W7+W9 全部收口（或明确 external-blocked）、canonical 回写完成、最终报告输出、工作区干净，即任务完成。不要提前宣布完成。
```

---

## 提示词设计说明（给人看的，不属于提示词本体）

- **自包含**：接手 Agent 只需读本仓 canonical 文档 + 本提示词，不需聊天上下文。
- **无人值守的关键**：所有 D1-D8 决策点已预置默认裁决，运行时不再逐点询问；唯一例外（未预置的新裁决点）按 dev-infra 保护性停下。
- **可验证**：每步都有明确交付物、门禁、证据落点、回写要求，最终报告有完整清单。
- **闭环**：每波次 = 红绿→实现→门禁→证据→回写→commit，下一步依赖前一步收口。
- **诚实**：external-blocked / 既有红 / 未执行项均在最终报告明示，不伪造通过。
