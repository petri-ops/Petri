---
capability: candidate-packages-batch
goal: 一批收口 backlog C-35～C-44 十个候选产品包（用户「好的 开整 接下来全方位解决10个候选包」）：每个包按其 backlog 判定的形态交付（实现切片/设计包/契约包），全部走红绿测试与收口门禁。
acceptance:
  - C-35 导入应用面：apply/rollback REST（服务端重推导/前值快照/审计 jsonl）+ 首启引导清单（真实状态派生）。
  - C-36 模型侧建议：suggest-followups/polish 端点 + parseSuggestions 容错 + Auto 复杂度分级。
  - C-37 model-access 族（白名单/理由账本）+ GET/PUT + 定价缓存。
  - C-38 PiP：主进程窗口/截帧 IPC + 设置面板入口。
  - C-39 审批通知深定位：ackToken 载荷 + approvalCardFocus 事件 + SimpleChat 滚动。
  - C-40 浏览器连接器垂直切片：会话/白名单/私网硬拒/审批门 + browser_* 四工具。
  - C-41/42 设计合册：统一 pane 模型（docs/unified-pane-model-design.md）。
  - C-43 批注契约 v2：freehand/path 几何 + 迁移 020 + store 往返。
  - C-44 pack 写桥契约：消息白名单 + 权限判定骨架。
reopen: 浏览器连接器传输层接线（BrowserPanel webview 桥/native messaging）；PiP 实机腿；批注画笔前端渲染器；pane 模型 P1-P4 实现。
status: completed
---

# BLOCK-264 · 候选产品包批（C-35～C-44）

用户发令：「好的 开整 接下来全方位解决10个候选包」（2026-10-26）。

## 交付矩阵

| 包 | 形态 | 交付 | 测试 |
| --- | --- | --- | --- |
| C-35 | 实现切片 | external-import apply/rollback（重推导+快照+审计）+ OnboardingChecklist + ExternalImportPanel | Node 7/7 + 前端 8/8 |
| C-36 | 实现切片 | assistant-suggestions（followups+polish）+ suggestions 路由 + assessComplexity | Node 6/6 + 前端 11/11 |
| C-37 | 实现切片 | model-access 族（schema 19 族）+ GET/PUT + pricing 缓存 | Node 5/5 + 契约 3/3 |
| C-38 | 实现切片 | computer-use-pip（窗口/截帧/IPC 四通道 MAIN_ONLY×2）+ 面板按钮 | Node 3/3 + 面板 2/2 |
| C-39 | 实现切片 | AppNotice.ackToken + approvalCardFocus 事件 + SimpleChat scrollIntoView | Bell 7/7 |
| C-40 | 垂直切片 | browser-connector（会话/白名单/私网硬拒/ackToken 门）+ browser_* 4 工具（88→92） | Node 8/8 + 邻域 29/29 |
| C-41/42 | 设计包 | docs/unified-pane-model-design.md（四宿主测绘+契约+P1-P4） | — |
| C-43 | 契约+实现 | 契约 v2（freehand/path/抽稀）+ 迁移 020 + store path_json | block219 24/24 |
| C-44 | 契约包 | pack-annotation-bridge-contract（消息白名单+权限判定） | Node 5/5 |

## 证据

- 定向 Node 回归 **95/95**（六套 block264 + block219 + registry/labels/ipc/prerouting）
- 前端定向 **51/51**（九文件）
- types 0 / lint 0 error / theme 17/17 / code-size PASS / knip 基线更新（preload 动态入口 + TaskComplexity 测试契约）
- closeout 十三门
