---
capability: agent-maturity
goal: BLOCK-163 = 成熟度蓝图 W3 波整波承载（天花板收尾 12 单元：ORC-3/ORC-4/CAP-3/MDL-1/MDL-2/DIST-3⇄CAP-5/DIST-5/MDL-3/MDL-4/KNW-5/KNW-6/DIST-4）+ 蓝图五层画像对账；用户发令「开冲到W3波末」+ 波内零停顿；波末=蓝图达成判据对照（§7）
acceptance:
  - ORC-3：wait_agent 事件驱动聚合（终态事件回调替代 1s 轮询热路径；轮询兜底保留），行为等价+聚合延迟下降
  - ORC-4：spawn 派生与 run_tool workflow 的恢复语义共用一个查询门面（编排统一第一刀；血缘 DAG 渲染共用既有）
  - CAP-3：MCP client 支持 streamable HTTP 传输（零新增依赖，SDK 既有 transport）+ 连接健康面（状态/工具数/最近错误透出）
  - MDL-1：上下文窗口解析零盲区（未知模型配置兜底+诚实标注，不再静默 0）
  - MDL-2：token 计数按模型校准系数（usage 回传对照自愈），预算误差有界
  - DIST-3⇄CAP-5：插件 manifest permissions 六词表（缺省全权存量零破坏；未知词拒装；越权即拒）+ 安装确认展示
  - DIST-5：领域包更新体验（清单版本比对+一键更新）
  - MDL-3：anthropic vision 原生轨实现（协议转换单测；真机验证依赖 anthropic 渠道=诚实边界）
  - MDL-4：成本/用量面板（usage 归因按模型/角色聚合，数据源 io-transcripts/usage 回传）
  - KNW-5：记忆治理面（facts 列表+单条遗忘+摘要清除，管理 API 已有补 UI）
  - KNW-6：知识检索命中→相关技能建议（citations 事件挂点）
  - DIST-4：打包卫生债（electron-builder 陈旧引用清偿+resources/skills 纳入 extraResources）
  - 波末：蓝图 §2 五层画像逐项对照（达成/G1+ 出籍两态）+ closeout 门禁 + 台账回写
reopen: 波内零停顿条款（蓝图 §3.4）；MDL-3 真机验证依赖 anthropic 渠道=外部条件不属停顿；整波范围改判需用户裁决
status: completed
---

# BLOCK-163：成熟度蓝图 W3 波（天花板收尾 12 单元 + 蓝图对账）

> 立项：2026-10-10。用户发令「开冲到W3波末」（承接 W1/W2 同日收口；编号顺延=160/161/162 均被占用）。
> 蓝图锚点：[g0-agent-maturity-blueprint.md](./g0-agent-maturity-blueprint.md) §3.2 W3 行。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 执行序（12 单元；括号=独立件可插队）

P1 ORC-3 → P2 ORC-4 → P3 CAP-3 → P4 MDL-1 → P5 MDL-2 → P6 DIST-3⇄CAP-5 → P7 DIST-5 → P8 MDL-3 → P9 MDL-4 → P10 KNW-5 → P11 KNW-6 → P12 DIST-4 → 波末对账。

## 2. 设计裁决（波内零停顿，蓝图 §3.4 三原则）

- ORC-3：进程内事件订阅（spawn-agent-tools 自持 emitter，agent-task-store 终态写入点回调通知——不与 BLOCK-162 在制的 agent-task-store.js 文件面交叉）；wait_agent 等待期间挂回调、超时与取消语义保持；轮询代码路径保留为兜底（事件丢失自愈）。
- ORC-4 第一刀=恢复语义共用：`run_tool` workflow 状态重建（op=status/next）与 spawn 子任务查询收敛为一个编排查询门面 `helpers/orchestration-query.js`（二者字段投影共用，行为等价）；血缘 DAG 渲染共用既有 /lineage 不另起。
- CAP-3：传输字段 `transport: 'stdio'(缺省)|'http'`；http 走 SDK StreamableHTTPClientTransport 动态 import（零新增依赖）；连接健康=既有 statuses 扩 recentError/connectedAt/toolCount 透出（MCP 货架卡片已显示，补最近错误列）。
- MDL-1/2：`model-context-windows` 第四优先级后追加「用户 settings 覆盖」；0→诚实标注走现有前端「—」展示不动，预算侧 0 触发的静默跳过改为保守缺省（settings 未配置时用 32k 保守值+warn）；MDL-2 系数表 `model-token-ratios.js`（按 model 子串匹配，缺省 1.0；usage 对照自愈：累计偏差 >25% 时收敛系数）——均为 additive。
- DIST-3⇄CAP-5 权限六词表（预裁决）：filesystem:read / filesystem:write / network / process:spawn / runtime-install / data:demo；manifest 无 permissions=全权（存量零破坏）；未知词拒装；越权即拒（执行器 preflight 校验）。
- DIST-5：pack 清单（远程 manifest）版本 > 已装 → 更新徽标 + 一键「更新」（重走 installPath 覆盖装）。
- MDL-3：anthropic provider 补 image_url→base64 content block 转换（复用 vision-inline 的 parts 形状）；真机验证依赖 anthropic 渠道=外部条件（单测协议转换，实机标注边界）。
- MDL-4：新增 GET /api/ai/usage/summary（io-transcripts usage 聚合按 model/role/day）+ 设置面成本节。
- KNW-5：管理 API 已有（routes/ai-memory.js）→ 设置面记忆节：facts 列表+单条删除+摘要清除。
- KNW-6：knowledge_search 结果挂点追加 `suggestedSkills`（按命中文档 category/tags 映射内置技能 id，纯映射零模型）。
- DIST-4：electron-builder.yml 删除 built-in-plugins 陈旧引用 + extraResources 增 resources/skills。

## 3. 非范围

- ORC-4 全量编排统一（DAG 化派生图等）留 v2；CAP-3 SSE 过时传输不做；MDL-3 真机矩阵=渠道依赖；KNW-6 模型语义映射（纯规则映射 v1）。

## 4. 波末判据

蓝图 §2 五层画像逐项对照：24 种子中已收口者对齐收口证据；MDL-3 真机验证与确认 UI 弹卡等 rider 如实标注；G1+ 画线项出籍。closeout 门禁（残红归属并行会话如实）+ 台账回写（蓝图五层画像对账段/backlog/AUDIT-LOG/README/注册表）。

## 7. 收口笔录

（波末填写）
