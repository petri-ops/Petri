# YI-REST-CLOSURE 预期表（采证前签发 · 审查对照用）

> 签发：Agent 2026-11-20（用户授权委托「你来审结果、对结果负责」）。每条判据在采证前冻结；审查=对照本表逐条 pass/fail。推翻权在用户。

## P1 审阅面实拍（真实 git 项目 + 未提交变更）

| # | 判据 | fail 何时重拍 |
|---|---|---|
| P1-1 | 审阅面打开且列出真实变更文件（≥1 个文件行，非空态） | 无变更文件→换项目/确认变更态 |
| P1-2 | diff 区为 CodeMirror 渲染：`.cm-editor` 在场 + `cm-merge-b`/`cm-changedLine`/`cm-insertedLine` 至少一类行可见 | 纯文本 diff→fail |
| P1-3 | 亮色截图 1 张 + 暗色截图 1 张，行号对齐、高亮可辨 | 高亮错乱/暗色不可读→fail |
| P1-4 | 读数：变更文件数、changedLine/insertedLine 计数 | — |

## P2 H-06 九文件补腿

| 文件 | 预期 | 造不出场景时的处理 |
|---|---|---|
| CodeReviewDrawer.module.css | P1 场景下 Tab/focus 到达，fv=true 且 outline 非 none | 场景不可造→retain-with-reason |
| ReviewMode.css | 同上 | 同上 |
| CodeMirrorEditor.module.css | diff 区 CodeMirror 内聚焦元件 fv=true | 同上 |
| KnowledgeConsoleChat.module.css | 知识页控制台输入类元件聚焦 | 控制台需会话→retain |
| McpPolicyEditor.module.css | 扩展页 MCP 策略编辑态聚焦元件 | 编辑入口找不到→retain |
| extensions/styles.module.css | 扩展页任意归属元件聚焦（倒排反查按 dev-id） | 0 命中→retain |
| home.module.css | /projects 页（≥2s 等待 chunk）归属元件聚焦 | 仍不注入→retain |
| AnnotationBar.module.css | 需可标注 artifact（图/PDF pane）→仅当既有 artifact 可开 | 无 artifact→retain（如实标注需真实分析任务） |

## P3 E-01 代理走查（五步，每步全新鲜状态）

| 步 | 任务 | 预期 |
|---|---|---|
| 1 | 首屏入口清单 | reload 后可见入口枚举（≥3 个左栏项+标题钮） |
| 2 | 找到分析项目库 | ≤3 击到达（/projects 或工作台视图等效，如实记录路由语义） |
| 3 | 审阅当前工作树变更 | ≤3 击，右栏 tab 形态+真实 diff（P1 场景） |
| 4 | MCP 服务货架 | ≤3 击，aria-selected=MCP 服务 |
| 5 | 改键盘快捷键 | ≤3 击，快捷键节标题在场 |
- 汇总判据（代理走查替代口径）：五步全达且均 ≤3 击；「真人 ≥80%/≥70% 统计」以 n=1 Agent 代理留因替代，用户亲走可推翻。

## P4 乙9 视频终审（21.9s 成片）

| # | 判据 |
|---|---|
| P4-1 | ffprobe：时长 21.9s±0.5、1280×720、有音频流且音画时长 skew <0.5s |
| P4-2 | 抽帧（2s 间隔≈11 张）：无黑帧/花屏，画面内容与科普主题连贯 |
| P4-3 | 字幕烧录：中段至少 3 帧含清晰中文字幕、无截断 |
| P4-4 | 镜头切换：帧间过渡自然（我逐帧审，主观项标注置信度） |

## P5 UI-711 复核

| # | 判据 |
|---|---|
| P5-1 | assertion.json：L1 stall 文案在场=true、L2 无 Python 误导=true |
| P5-2 | 截图含「模型响应暂时停滞，正在自动恢复」 |
| P5-3 | 复核 through：分类规则置于 network/python 规则前的代码事实（git 读） |

## P6/P7 产物判据

- 回写批：每条签字记录含日期+覆盖断言+证据路径+审定层标注（Agent 审定·用户委托）；docs:check+ui:audit:check PASS。
- 契约演进：重算不再 throw；消费测试断言更新为部分已签语义；HK-01 全绿。
- 清偿提交批：只含各已完成批次的登记行+证据目录，commit message 逐批归属。
- chart 定性：给出「数据形态问题/渲染缺口」二选一定性+代码依据+修复路径。
