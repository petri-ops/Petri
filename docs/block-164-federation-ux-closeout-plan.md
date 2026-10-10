---
capability: mobile-gateway
goal: BLOCK-164 = 联邦协作体验收口（委托入口可自足 / 回流本地可查 / 在线态自动化）；用户裁决「需要立包」（承接 2026-10-10 联邦完善度盘点：链路双真机已验证，缺入口与回流的 UX 收口）
acceptance:
  - W1 委托入口可自足：agent 可用 federation_list_peers 工具列协作节点（名称/署名/在线态/对我授权的项目）与已授权项目清单——模型不再需要用户提供 gpeer_* ID；delegate 工具错误文案指向该工具；契约=工具注册+输出形状+空节点诚实态
  - W2 委托回流本地可查：联邦委托历史视图（数据真值=conversations origin='federation-delegation'，includeFederated 通道已有）——委托方 UI 一处可见全部委托会话（状态/标题/时间/进入会话）；不做跨端深链（对端鉴权边界，另裁）
  - W3 节点在线态自动化：后端定时探活（默认 60s，unref）刷新 lastProbe/lastSeenAt——面板在线点与成员在线窗成为真值，不再依赖手动点探；探活失败静默降级不刷错误风暴
  - 门禁：定向红绿（工具契约/视图数据面/探活节流）+ 邻域（federation/联邦既有测试）+ tsc 0 + docs/ui 门禁 + quality 链；实机 riders=双实例或真机走查
reopen: 范围改判需用户裁决；grants 全路由强制（D5 deferred）与跨端深链维持不在范围
status: completed
---

# BLOCK-164 — 联邦协作体验收口（三断点闭合）

- 状态：`planned`（并行插队批：唯一 active 槽位被 BLOCK-160 占用，用户显式裁决「需要立包」插队在案，文件面隔离见 §3；收口翻 completed）
- 立项动因：2026-10-10 联邦完善度盘点（全仓+台账+双真机证据全面排查）——链路真（60 条双真机断言全绿、UI 9 条 8 verified），但三个体验断点使两名真实用户今天无法日常互派工作。**对标结论**：P2P 桌面↔桌面+署名+项目授权形态无同类（Codex Cloud Tasks/Copilot coding agent 为中心化云委托；ZCode 远程=SSH attach 无协作面）——三断点正是厂商中继服务带来的体验，需本地自建。

## 1. 范围（三波，逐波可独立收口）

### W1 委托入口可自足（解盘点断点 1【高】）
- 新 agent 工具 `federation_list_peers`（federation-tools.js + tool-defs 注册）：输出节点清单（peerId/名称/署名/在线态/lastProbe 陈旧度）+ 我的哪些项目已授权给谁；空节点诚实态「尚未配对任何协作节点」。
- `delegate_to_gewu_node` 错误文案改指向：peerId 未知时提示「先用 federation_list_peers 查询」。
- 不做：composer 表单/选择器（UI 形态另裁）；工具不新增敏感面（只读聚合既有 peers/grants 数据）。

### W2 委托回流本地可查（解断点 2【中高】）
- 联邦委托历史视图：数据真值 = conversations `origin='federation-delegation'`（BLOCK-88 已落库，includeFederated 通道已有）——委托方一处列出全部委托会话（标题含「来自工程师 X」/状态/时间/点击进入会话）。
- 宿主侧已有角标（UI-419 verified）不动；本波补的是**委托方**的历史列表入口。
- 不做跨端深链（对端鉴权与投影 URL 拼接涉及 token 传递，另裁）。

### W3 节点在线态自动化（解断点 3【中】）
- 后端定时探活：60s（unref）逐 peer probe（复用既有 probe 逻辑），刷新 lastProbe/lastSeenAt；失败静默（记 lastError 不刷错误风暴）；面板在线点/成员 2min 窗自动变真值。
- 顺带：fed: 作业的 mapToolJob 友名映射（UI-422 在册候选，小项搭车）。

## 2. 对标定位（立项依据，2026-10-10 查证）

- Codex Cloud Tasks / Copilot coding agent / Cursor background agents：中心化云委托，任务列表/深链/通知体验来自厂商常驻中继；无署名/授权人际层。
- ZCode 远程功能（SSH/WSL）：单机 attach，无对等协作（全仓无 delegate/federation/peer 面）。
- 格物联邦独有位置：P2P + 自建中继 + 署名/授权；三断点=需本地自建的中继级体验。

## 3. 文件面隔离（并行插队批红线）

本包文件面：`core/biof3-server/agent-tools/federation-tools.js`、`core/biof3-server/agent-tools/tool-defs/remote.js`、`core/biof3-server/routes/federation-admin.js`、`core/shared-backend/federation-peers.js`、联邦相关前端组件（Federation*.tsx / 新委托历史视图组件）、对应 test/block164-*。**不触碰**并行包在途面（agent-tools 其余/mcp/http-transport、ui-audit 脚本、插件域）。

## 4. 非范围（exclusions）

- grants 全路由中间件级强制（D5 deferred 维持）；跨端深链；>2 节点中继拓扑；实时协同编辑；账号体系（BLOCK-88 D8 维持）；composer 委托表单（另裁）。

## 5. 验收门禁

1. `test/block164-federation-ux.test.mjs`——W1 工具契约（注册/输出形状/空态/错误文案指向）+ W2 数据面（origin 过滤/形状）+ W3 探活节流与静默降级。
2. 邻域回归：test/federation.test.mjs 等既有联邦测试全绿。
3. tsc 0 + docs:check + ui 门禁（新视图 UI-### 登记 in_progress）+ quality 链。
4. 实机 riders：双实例/真机走查（模型自主列节点→委托→历史可见）。

## 6. 收口笔录

**收口（2026-10-10，三波同日全交付；W1 提交 f5011827，W2/W3 随收口提交）**

- **W1**：`federation_list_peers` 只读工具（节点 peerId/名称/署名/在线态/对端授权项目 3s 尽力探测 + 本机授权概览；空节点配对引导）；delegate 缺参/未知 peer 文案两处指向该工具；静态工具宇宙 78→79 四处计数钉同步 + 动词图标夹具/后端/前端三面登记。
- **W2**：`GET /api/federation/delegations`（collectDelegations 聚合：task_events 中 delegate 工具 call/result 对 JOIN tasks，输出 task/peer/状态/回复头/conversationId/projectId，limit 50）；联邦面板新增「委托记录」卡（空态引导/状态标签/回复摘要/刷新；v1 边界=仅列表不做跨端深链，如实）。**实机**：端点在真实数据上聚合出 2026-09-18 BLOCK-85 双真机的历史委托记录。
- **W3**：`startPeerHeartbeat`（默认 60s unref；空清单跳过；单 peer 失败静默；BIOF3_FED_HEARTBEAT_MS=0 关闭；注入式依赖可测）。**实机**：lastProbe 由 2026-09-19（三周陈旧）自动刷新为 2026-10-10T12:41 ok:true——「在线态靠手动点探」断点闭合。
- **搭车项查证**：fed: 原始 ID 暴露面在当前代码仅 RemoteTargets 默认目标逻辑，未发现摘要卡裸 ID 渲染点——UI-422 候选维持候选（无改动需求）。
- **测试**：block164 7/7（W1×4+W2 聚合+W3 心跳×2；db 引导按 agent-concurrency 先例 runMigrations）+ 邻域 36/36 + 前端 toolActivity 16/16 + tsc 0 + lint 新文件 0 error。
- **lint 顺手清偿**：Federation.tsx 两处 react-hooks/set-state-in-effect（一处存量一处新增）改顺序 IIFE await 形态（同目录 RemoteTargets 同款过规形态）。
- **非范围留痕**：grants 全路由强制（D5）/跨端深链/composer 委托表单（plan §4）；fed: 友名映射查证后无渲染点（见上）。
- 实机 riders：双真机委托全链走查（模型自主查节点→委托→面板委托记录可见）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
