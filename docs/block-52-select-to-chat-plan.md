# BLOCK-52 — 选中即引用：文件内容/生信图 → 对话微调闭环

> 状态：`planned`（候选，待用户裁决启动；当前 active 为 NONE，BLOCK-51 审计修复包亦为 planned 排队中）
> 立项日期：2026-09-03（用户裁决「按这个方案立项并固化成 plan 文档」）
> truthDomain: `block-52-select-to-chat`
> 战略对齐：product-strategy-review-2026-09.md——P1/P2 属底座交互升级，P3 属生信旗舰第一块体验拼图；观察期裁决下两个方向都不浪费

## 1. 背景

用户观察到的优质产品体验：右侧文件区任何内容（文字选中 / 图片）都可以添加到对话输入框，作为下一次提示词的一部分。换到生信场景：**分析出的图想微调，直接对着图告诉智能体快速改好**——选中即引用，把「定位成本归零」。

架构洞察：BioF3 的生信图不是普通图片，是 **artifact**（有 job 血统 / revision / 参数历史 / contextToken）。引用图 ≠ 截图发给 AI 看像素，而是**把 provenance 一起引用进来**——agent 走真正的「改参数 → 新 Revision → 重跑」链路，这是通用 agent（只能视觉猜谜）做不到的。

### 1.1 交互链路三段拆解

```
① 选中（感知层）              ② 引用（传递层）               ③ 微调（执行层）
──────────────────           ──────────────────            ──────────────────
文字：selection API           引用块进 composer              agent 拿 artifact
+ 浮动"+"按钮/右键菜单    →   带来源（path:行号          →   上下文 → result-edit
图片：悬浮引用图标            / artifact:revision 元数据）    链路改参重跑出新 Revision
```

**关键设计**：引用生信图时，composer 装的不只是图片本体，而是 `图 + artifact/job/revision 元数据` 的引用卡片——模型一眼知道「这是 volcano-plot job#47 的 revision#3，参数空间里有 logFC\_threshold」，微调即精准打击。

## 2. 现有资产盘点（复用率极高）

| 需要的能力          | 已有资产                                                                                      | 状态                 |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| 文件引用提取         | `frontend/src/lib/chat-file-references.ts`（extractFileReferenceCandidates，SimpleChat 已消费） | ✅ 在用               |
| 图片进 composer   | `frontend/src/components/copilot/SimpleChat/attachments.ts`（拖拽/粘贴通道已有）                    | ✅ 在用               |
| 编辑器→聊天跳转       | pendingScrollContext（BLOCK-22/42，UI-194 verified）——反向链路已通                                 | ✅                  |
| artifact 上下文绑定 | `result_studio_context` 工具 + contextToken（G0-RS-P3 资产）                                    | ✅ 后端已备             |
| 模型看图           | `read_image` vision 工具（registry 已注册）                                                      | ✅                  |
| 自然语言改参重跑       | P4R-3 Composer → ChangeSet 链路                                                             | ✅ experimental 已实现 |

**缺口 = 第①段选中捕获的交互 chrome + 引用块 UI + 串联胶水**。

## 3. 阶段划分

### P1 — 文字选中引用（纯前端，0 新 IPC）

+ 预览区（WorkspaceFilePreview）/ CodeMirror 编辑器内 `selection` → 浮动「引用」按钮（或右键菜单项）

+ 点击 → composer 出现引用块：`📄 path:L42 「选中文字…」`，随下一条消息发送

+ 引用块可删除；同 composer 可多引用并存（与既有 attachment 并列）

+ 实现锚点：chat-file-references.ts 扩展（selection 级而非全文级）+ SimpleChat composer 引用条 UI

### P2 — 图片/结果图引用（含 artifact 元数据）

+ 文件预览图片 / Result Studio 图悬浮「引用」图标 → 点击进 composer

+ composer 引用卡片：缩略图 + 来源行（job 名 / revision / 关键参数摘要）

+ 需一个小 IPC：按图片 artifact 路径查归属（job/revision/参数摘要）——只读，走既有 resolveArtifact 类通道或新增轻量只读 IPC（实施时按最小面定）

+ 发送时：图片作为 attachment（既有通道）+ 结构化元数据进消息 context（模型可见）

### P3 — 微调闭环（旗舰时刻）

+ P2 引用图 + 用户自然语言「把点大小调大、加个标题」

+ agent 经 contextToken 绑定该 artifact → `result_changeset_create_in_context` 改参 → 重跑 → 新 Revision 出图

+ 验收即端到端：选中一张真实分析图 → 一句话 → 新图出现

+ 依赖：P4R 链路当前 experimental，本包实机验证时暴露的缺陷如实登记（不就地大修）

### 门禁与验收

+ 每阶段定向 vitest（引用块渲染 / 元数据卡 / 删除交互）+ tsc + `docs:check` + `ui:audit:check`

+ P1/P2 dev Electron 实机（CDP 选中→引用→发送全链路断言，截图入 acceptance）

+ P3 实机跑一次真实微调闭环，证据 `acceptance/block-52/`

+ 新 UI 编号按台账纪律同提交登记

### P1 实施落点（2026-09-03 verified）

+ 事件通道：`frontend/src/lib/events.ts` `selectionQuote`（SelectionQuoteDetail：projectId/path/name/startLine/endLine/text）

+ 编辑器命令面：CodeMirror `types.ts` `EditorSelectionInfo` + `EditorApi.getSelection()`（`useCodeMirrorEditor.ts` 实现，空选区返 null）

+ 生产端：`project-workspace.tsx` WorkspaceFilePreview 工具栏「引用到对话」按钮——selectionchange 跟踪容器内选中态控制可用性、onMouseDown preventDefault 防点击丢选区、CM 选区优先带行号 / Markdown 渲染视图退回 DOM selection（无行号）；三个 WorkspaceFilePreviewBridge 挂 editorRef

+ 消费端：`SimpleChat.tsx` selectionRefs 状态 + 事件订阅（ownsCopilotAsk 拥有者 / 跨项目丢弃）+ composer 引用条 chips（可删除 / 上限 8 / 同源去重）+ `sendWithRefs`（blockquote 前缀合并，成功清空 / 守卫拦截保留，Enter 排队同携带）+ `simple-chat.css` 引用条样式（与附件区同一视觉语言）

+ 纯函数：`SimpleChat/selectionReferences.ts`（8000 字符截断 / 位置标签 / 消息合成 / chip 文案）+ `selectionReferences.test.ts` 6 用例

+ 台账：UI-280（verified）；证据：`acceptance/block-52/p1-live-check.json` + `p1-send-with-reference.png`

## 4. 非范围

+ 视觉框选截图（box-select 区域截图引用）——留候选

+ 跨多 artifact 批量引用 / 引用历史管理

+ P4R 链路本身的资格提升（维持 experimental 边界，只做消费侧）

+ 0 新 npm 依赖

+ 不动 BLOCK-51 范围文件（chat.js / resume.js / loop-orchestrator / message-trimmer 接线 / plumber 清理）

## 5. 风险与对策

| 风险                                 | 对策                                                       |
| ---------------------------------- | -------------------------------------------------------- |
| selection 浮动按钮与 CodeMirror/预览区事件冲突 | P1 先做右键菜单项（低冲突），浮动按钮视效果追加                                |
| 图片 artifact 归属查询无现成只读通道            | P2 实施时盘点 result-handlers 既有 IPC；确无可走 preload 新增只读方法（最小面） |
| 元数据进消息 context 的形状漂移               | 复用既有 ExtractContext（chat-file-references）模式扩展，不新造协议      |
| P3 依赖的 P4R 链路 experimental 缺陷      | 实机暴露如实登记增量候选，不阻塞 P1/P2 收口                                |

## 6. 进度记录

+ 2026-09-03 P0（planned 登记）：用户裁决立项；方案源自「选中→引用→微调」交互讨论（产品体验观察 × 生信微调场景）；资产盘点确认复用率极高（6 项已有资产，缺交互 chrome 与胶水）；本计划落盘并注册 DOC-REGISTRY；排队于 BLOCK-51 之后，启动由用户裁决。

+ 2026-09-03 P0（active 启动）：BLOCK-51 收口（c118e201）释放 active 槽位，用户裁决「继续」启动本包；P1 文字选中引用先行（纯前端 0 新 IPC）；DOC-REGISTRY / roadmap / AUDIT-LOG 同步 active。

+ 2026-09-03 P1 收口（verified）：实现全链路（事件通道 / CM getSelection / 预览工具栏按钮 / SimpleChat 引用条 + sendWithRefs）；门禁 vitest 33/33 + tsc 0 + docs:check 199 + ui:audit:check；dev Electron 实机 5 断言全 PASS（含真实鼠标拖选带行号 + 真实发送模型复述引用内容），证据 `acceptance/block-52/`；台账 UI-280 verified。范围外既有缺陷如实登记：AgentStreamDisconnected（copilotClient.ts SSE 传输层，回复完整到达后断线，与本改动无关，候选另立增量）。下一步：P2 图片/结果图引用。

