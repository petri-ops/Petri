# BLOCK-103-KNOWLEDGE-SPACE-UX — 知识空间页产品化重设计（布局与内容）

**状态**：`completed（2026-09-19 立项即启动当日 P0→P5 一次会话整包收口；用户裁决「立个新的block 重新优化这里的内容」；台账 UI-426 verified）`
**立项**：2026-09-19（用户截图反馈 + 现状代码勘察 + BLOCK-99 收口后实况对账）
**用户裁决（立项来源）**：用户原话「知识空间这里的布局很不好用呀　你能从产品的角度　立个新的block 重新优化这里的内容吗 无论是布局还是内容」（附 /knowledge 页截图：0 篇空态 + DashScope 未配置警告 + 右侧管理会话台常驻）。

---

## 0. 产品分析（现状证据）

现状 = BLOCK-69（管理面迁出）+ BLOCK-94（Pro 六面）+ BLOCK-99（多空间+管理会话台）三期功能叠加的**能力堆叠形态**，不是产品形态。截图与代码逐条对账出七条体验问题：

| # | 问题 | 证据（file:line / 截图区域） |
| --- | --- | --- |
| P-01 | **空态无引导**：0 篇文档的新用户看到的最大元素是「配置 DashScope key…当前无法启用」警告；三问（这是什么/该做什么/为什么用不了）无结构化回答；警告纯文本无「去设置」动作 | KnowledgeSpacePanel.tsx:335-339；截图中部 |
| P-02 | **管理会话台常驻 1/3 宽**：380px 固定列，0 篇文档时是全页最无内容却最占宽的区域；专注管理文档时被挤压 | KnowledgeConsoleChat.module.css:21-27（consoleCol flex 0 0 380px） |
| P-03 | **信息三重重复**：页头「知识空间·全局知识库·启用后对话自动检索」→ 面板头「默认知识空间·启用后对话自动检索」→ 切换器「默认知识空间（0 篇）」三层说重叠的话 | index.tsx:42-43 + Panel:322-326 + Switcher:109-112 |
| P-04 | **单列垂直堆叠无层级**：警告×4 种 / 切换器 / 状态行 / 工具栏 / 粘贴框 / 上传报告 / 批量条 / 文档列表 / 检索测试全部单列；核心内容（文档列表）被挤出首屏；调试工具（检索测试）常驻页尾 | Panel:314-674 渲染序 |
| P-05 | **状态可见性弱**：「未启用」是小按钮非 switch；「0 篇文档 · 0 篇就绪」纯文本；摄取队列深度无视觉权重 | Panel:360-377 |
| P-06 | **上传入口不显性**：空态文案说「拖入」但空态框不是视觉化 dropzone，无主 CTA | Panel:514-517 |
| P-07 | **文案工程师视角**：「检索测试」「摄取中」「就绪」等术语直出，无用户语言 | Panel:613, 373-374 |

## 1. 范围（scope）

纯前端 `/knowledge` 页信息架构重设计，零后端改动：

1. **页壳重构**：状态条（切换器内联 + 真 switch 启用开关 + 就绪/摄取中/失败徽章）统一替代 P-03 三重头部；通知收敛为带动作的卡片组（DashScope 缺 key →「去设置」跳 /settings；模型变更 → 引导重建索引）。
2. **双页签**：「文档库」（默认，核心）与「检索预览」（原「检索测试」，工具页签）——文档列表回到首屏中心。
3. **Hero 空态**：大 dropzone + 双 CTA（上传文档/粘贴文本）+ 支持格式说明；有文档时恢复工具行+列表。
4. **管理会话台折叠抽屉**：对标 UI-417 SideChatDock 交互（右缘常驻把手 + ~380px overlay 滑出 + Esc/外点/再点收起 + localStorage 记忆），默认收起；KnowledgeConsoleChat 内部零改动。
5. **组件拆分**（台账线 700 棘轮方向=净减）：KnowledgeSpacePanel（678 行）→ 页壳数据所有者 + `KnowledgeDocLibrary`（文档库页签：工具行/hero/列表/预览/批量/粘贴，交互局部状态内聚）+ `KnowledgeSearchProbe`（检索页签：自持检索状态）。
6. **文案产品化**：P-07 逐条（检索测试→检索预览；状态徽章化；动作按钮化）。

## 2. 非范围（exclusions）

- 零后端/REST/事件契约改动（`gewu:knowledge-console-sync`、spaces/documents 端点原样消费）。
- KnowledgeConsoleChat / useKnowledgeConsole 内部能力零改动（只动容器与显隐）；SimpleChat.tsx 零触碰（BLOCK-99 红线延续）。
- 不做多空间数据模型/绑定语义变更（BLOCK-99 已收口）；不做嵌入多 provider / sqlite-vec（BLOCK-94 §8 延续）；不做上传格式族扩展（P4 线）；不做 i18n 抽离（🟡 在册待裁决）；不做手机投影专属布局；G1+ 全部不外推。

## 3. 交互裁决项（预置推荐先行留痕，对标 BLOCK-94 §7 / BLOCK-98 §5 先例；用户可随时推翻）

- **D1 页签划分**：推荐双页签（文档库/检索预览）；备选单列手风琴被否——垂直堆叠正是 P-04 根因。
- **D2 会话台默认态**：推荐默认收起+把手常驻+localStorage 记忆；默认展开被否——0 文档时它是最无用区域（P-02 正是本包要修的问题）。
- **D3 空态 hero**：推荐大 dropzone+双 CTA+格式说明；缺 key 时另加「去设置」卡（navigate('/settings')）。
- **D4 启用开关**：推荐状态条内真 switch（role=switch），保留 `knowledge-toggle` testid 与 !embeddingAvailable 禁用语义（D7 诚实空态不变）。
- **D5 通知收敛**：同屏多通知合并为一张卡内分组、逐条带动作；破坏性动作两步确认门不变（BLOCK-64/BLOCK-99 D4 先例）。
- **D6 检索测试更名**：推荐「检索预览」，能力与 testid 全保留。
- **D7 block99 实机 flow 适配**：`scripts/block99-console-live.cjs` U1 断言「会话台挂载即可见+composer 可输入」——默认收起后 flow 更新为「先点把手展开再断言输入」（机械适配，U2-U5 真轮次断言不变）。

## 4. 行为基线（拆前=拆后对账，BLOCK-92 先例）

KnowledgeSpacePanel.test.tsx 八项行为断言全保留：诚实空态+开关禁用（D7）/ 文档状态与块数渲染 / 检索命中+无命中诚实提示 / 清空两步确认 / 上传逐文件错误聚合 / 粘贴入库 / 批量删除 ids 上报 / 全文预览展开+打开原文件。**导航脚手架类断言**（检索输入先点「检索预览」页签）按新结构机械更新，逐条映射留痕本 plan §8；行为语义零删减。Switcher 3/3、global-pages 冒烟、hook 6/6、面板回归 11/11 同口径保持。

## 5. 阶段与门禁

| 阶段 | 内容 | 门禁 |
| --- | --- | --- |
| P0 立项评审 | 本文件 + 登记四件套（本包启动时完成） | 启动检查单硬门 |
| P1 页壳重构 | 状态条 + 通知卡组 + 页签骨架 + 会话台 Dock（把手/overlay/记忆） | tsc 0 + theme 4/4 |
| P2 文档库页签 | KnowledgeDocLibrary 抽离：hero 空态 + 工具行 + 列表 + 预览 + 批量 + 粘贴 | 组件测试（行为基线八项） |
| P3 检索预览页签 | KnowledgeSearchProbe 抽离：检索框 + 过滤 + 命中高亮 | 同上（检索三项） |
| P4 文案与 flow 适配 | P-07 文案 + block99 flow 把手适配 | test:changed 定向 |
| P5 收口 | 台账 UI-426（编号顺延：UI-425 已被 BLOCK-102 收口补登占用，并行会话 03530c9b） + closeout 五门 + 实机（start-test-instance CDP 走查 /knowledge：状态条/页签/hero/抽屉 + 截图 acceptance/block-103/）+ canonical 回写 | closeout 5/5 + docs/ui 双绿 + 实机 allPass |

预期节奏：一次会话 P0→P5（对标 BLOCK-94/99 先例）。

## 6. 证据位置

`acceptance/block-103/`（CDP 走查 JSON + 截图）；组件/契约测试随仓。

## 7. 依赖与登记

- 依赖：无新依赖；无新 governed 文档（本 plan 即 canonical）。
- 登记：DOC-REGISTRY（本文件）+ README 135 + roadmap 排队 + AUDIT-LOG 立项行。
- 台账：UI-426 知识空间页信息架构重设计（in_progress 起，实机证据后 verified）。

## 8. 运行记录

- 2026-09-19 立项即启动（P0-LAUNCH）：产品分析 §0 定稿（七条问题截图+代码双证据）；D1-D7 预置推荐先行留痕（§3）；行为基线八项锁定（§4）。P1 页壳重构起串行。
- **P1-P4 实施 completed**：页壳重构（状态条/通知动作卡组/双页签）+ KnowledgeDocLibrary（hero 空态/工具行/列表/预览/批量/粘贴，交互局部状态内聚，切空间自动清选择集）+ KnowledgeSearchProbe（检索状态自持，「检索预览」命名）+ KnowledgeConsoleDock（把手/overlay/Esc/外点/localStorage 记忆）+ 页壳接 dock + block99 flow 把手适配 + impact-map block103 规则；--gewu-success 补暗色对（custom.css）。
- **抓真 3 件**：①hero 空态下上传报告不渲染（报告/错误块移 hero 与列表共层——空态首传立即可见，组件测试抓出）；②抽屉点击时才挂载 → useKnowledgeConsole 初始化窗内 textarea disabled（block99 flow 加就绪轮询 U1c）；③抽屉开合 localStorage 残留态污染 flow 确定性起点（flow 先清零再 reload）。
- **P5 收口 completed**：组件 17/17（行为基线八项全保留）+Switcher 3/3+global-pages 冒烟+tsc 0+theme 4/4+前端全量 1146/1146（含顺清并行收口遗留=workflowPollDelay 测试未随 BLOCK-102 P4 降频同步，修测试对齐实现）；实机=block103-knowledge-ux-live **12/12 allPass**（截图×3 acceptance/block-103/）+block99-console-live **24/24 allPass**（真轮次回归）；closeout 聚合=hygiene/docs/ui-audit 三门绿 + test:changed 85/89（4 红全为在册存量红非本包：P6 源绑定×2〔AUDIT-LOG 🔴 在册〕+F2 PDF×2〔BLOCK-99 Windows 动前基线〕，例外如实登记不表述为通过）。台账 UI-426 verified。同会话另立 🔴=BLOCK-102 P5 全量套件证据不可复现（三点半复跑 199-206 红稳定 vs 声明 exit 0；归 BLOCK-102 域专门会话，不阻塞本包）。
