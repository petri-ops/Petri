---
capability: agent-maturity
goal: BLOCK-157 = 成熟度蓝图 W1 波整波承载（KNW-1 Skills 可见性 / KNW-2 渐进披露 / CAP-1 MCP 粒度审批 / DIST-1 插件启停）；用户发令「开冲到W1波末」+ 波内零停顿（蓝图 §3.4），波末三出口断言全绿
acceptance:
  - KNW-1：skill_discover/skill_get 投影进 agent-tools 静态注册表（76→78，retrieval/none/R0 全档可用）；实机 agent 自主发现并引用一个产品 skill
  - KNW-2：技能索引常驻注入 system prompt（有界 ≤12 条/截断诚实）；skill_get 兼作正文触发加载通道（prompt 内容有界）；契约=注入块格式/预算/空清单零注入
  - CAP-1：mcp-projection 读 annotations.readOnlyHint——true 投影为 retrieval/none/R1（read/plan 档 policy allow），无注释保守维持 execution/R2（D4 默认不变）；夹具 readOnly 工具实机全链
  - DIST-1：installed.json 增 enabled 标志（装=启用默认，存量缺省=启用零破坏）+ 核心加载器尊重（run_tool 清单/执行与 MCP listToolsForMCP 不注册停用件）+ 货架 UI 开关；验收=停用即不注册、启用免重装
  - 波末：三出口断言（agent 自主引 skill / 只读 MCP 低档可用实机链 / 插件停用不注册启用免重装）+ closeout 门禁全绿 + 蓝图/backlog 状态回写
reopen: 波内零停顿条款（蓝图 §3.4）——预裁决缺省即生效波报复认；单阶段测试红→修复重跑不算停顿；整波范围改判需用户裁决
status: completed
---

# BLOCK-157：成熟度蓝图 W1 波（Skills 在场 + MCP 粒度审批 + 插件启停）

> 立项：2026-10-10。用户发令「开冲到W1波末」（承接同日蓝图落档 + 「波内 我需要 0 停顿」裁决）。
> 蓝图锚点：[g0-agent-maturity-blueprint.md](./g0-agent-maturity-blueprint.md) §2④③⑤ / §3.2 W1 行。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 波次范围与执行序

| 序 | 种子 | 波内定位 | 核心交付 |
| --- | --- | --- | --- |
| P1 | KNW-1 | 队列头 | `agent-tools/skill-tools.js`（discover/get 双 handler，懒加载 SkillRegistry 单源）+ `tool-defs/skill.js` 新域 + facade/registry 接线 + 动词册/fixture 登记 + 计数钉 76→78 |
| P2 | KNW-2 | 承接 P1 | agent-runner 注入技能索引常驻块（有界诚实）+ skill_get 正文触发加载（prompt 截断预算） |
| P3 | CAP-1 | 独立 | mcp-projection 契约按 annotations 分级 + fixture 增 readOnly 工具 + projection/policy 契约测试 |
| P4 | DIST-1 | 独立 | installed.json enabled 标志 + core plugin-loader 尊重（run_tool/MCP 投影）+ IPC set-enabled + 货架开关 |

## 2. 设计裁决（波内零停顿：主代理按蓝图 §3.4 三原则缺省，波报复认）

- KNW-1 不投影 skill_execute（执行面 v1 维持 Skills 页显式触发 + 外部 MCP 客户端通道；模型只读手册不自动执行——渐进披露红线，执行自动化的产品语义另裁）。
- KNW-2 注入点=agent-runner 动态段（不进 system-prompt.js 静态缓存，避免技能装卸后缓存失真）；空清单零注入；预算：≤12 条 × 描述 ≤100 字符，整块 ≤2200 字符，超界截断带标记。
- CAP-1 分级判据只用 `annotations.readOnlyHint === true`（MCP 官方字段）；destructiveHint 不降档只保底；无注释=execution/R2 保守默认（D4 语义零漂移）。
- DIST-1 停用语义=「不注册」（run_tool 清单/执行/MCP listToolsForMCP 全部不出现），非「卸载」；存量 installed.json 无 enabled 字段=启用（零迁移零破坏）；启停切换与装卸同 UX（需重启生效的提示如实标注）。

## 3. 非范围

- skill_execute 自动执行链、技能参数化执行 UI（KNW-3 斜杠命令为 W2）。
- MCP destructiveHint 细粒降档、server 级信任配置（C-EXT-1 剩余面=W3 CAP-5⇄DIST-3）。
- 插件启停的 Electron 主进程 env 恢复面（若 P4 勘察发现主进程装载与 core 面耦合超预期，如实收缩至 core 面并登记 rider）。

## 4. 波末出口判据（三断言）

1. 实机 agent 自主发现并引用一个产品 skill（探针真实模型轮，transcript toolCalls 含 skill_discover + skill_get）。
2. 只读 MCP 工具 read/plan 档可用且实机全链（policy 契约断言 + 夹具 readOnly 工具实机调用回流）。
3. 插件停用即不注册、启用免重装（installed.json 翻转 → 工具面消失/复现）。

证据落 `acceptance/block-157/`；收口笔录回写本文件 §6 + 蓝图 §2 状态注记 + backlog 队列翻格。

## 5. 门禁

逐阶段：红绿先行证据 + 定向测试 + tsc（触前端时）；波末：closeout 门禁 + 实机探针三断言。

## 6. 收口笔录（2026-10-10 当日整波收口 completed）

**交付**：P1 KNW-1（`a3969190`）skill_discover/skill_get 投影静态面 76→78 + P2 KNW-2（`23ad1154`）agent-runner 技能索引常驻注入（有界/空清单零注入/源码扫描接线钉）+ P3 CAP-1（`5cd195d7`）mcp-projection 读 annotations.readOnlyHint 分级（只读→retrieval/none/R1，默认 D4 零漂移）+ P4 DIST-1（`4ef6d666`）installed enabled 标志+加载器尊重+plugin:set-enabled IPC+货架开关（UI-481）。

**实机抓真修复**：插件目录跨进程拓扑脑裂（BLOCK-125 家族）——主进程装插件写 `$PETRI_LOCAL_DATA_DIR/plugins` 而 core 后端只认 `PETRI_PLUGINS_DIR || ~/Documents/Petri-Local/plugins`，装了读不到（探针插件 catalog 缺席实证）；收敛=resolveInstalledPluginsDir 单源三点接线（`cd7c58ac`，未设 env 行为零变化）。

**波末三出口断言 ALL PASS**（acceptance/block-157/wave1-live.json，真实模型 deepseek 渠道，主代理代跑实机）：①read 档 agent 自主 skill_discover+skill_get 并引用 coding-playbook（transcript toolCalls 按名实锤）；②workspace-write 档调 readOnlyHint MCP 工具原样回流 `lookup: p53… (readonly)`；③探针插件 启用在场→停用+重启消失→启用+重启复现（停用即不注册/启用免重装，catalog 8→7→8）。临时项目/探针插件已清场复原（catalog 回 7 件 pack 域）。

**门禁**：定向红绿（KNW-1 5/5 + KNW-2 5/5 + DIST-1 4/4 + CAP-1 8/8）+ 邻域回归（labels/registry/116/113/projection 57/57）+ 前端 18/18 + tsc 0 + IPC 守卫 5/5 + closeout 十一门 PASS（hygiene EOL 归一 3 文件/code-size PluginStorePanel 792→825 重锚随提交留痕/lint 抓真 2 error 清偿：plugin-loader os 残留+本包测试未用变量）+ D7 领域中立棘轮抓真（skill.js 描述「单细胞」领域词残留改中性措辞）。test:changed 103/105（2 skip 设计内）。test:suggest 立项时零建议；doc:suggest 收口零建议（http_error 降级如实）；output:judge 降级放行（http_error，如实）。

**设计偏差**（plan §2 预裁决缺省执行零推翻；补充两条）：①skill_discover 参数名 categoryFilter（provider 投影契约黑名单 collectKeys 键名防泄漏，MCP 侧不受限）；②skill 域入 DOMAIN_TOOL_DEFS 十域但不入 TOOL_FAMILIES 九域决策分类学（θ=0.80 校准契约不动，D6 宁全勿缺保守保留）。

**riders**：UI-481 插件启停开关 in_progress 待用户实机过目翻 verified；KNW-2 注入段的用户体感核验（技能索引在会话中的可见性）随日常使用观察。

**加映（UI-481 过目抓真，同日）**：用户反馈「开关没看到」——CDP 探查实证用户货架插件面=**包交付插件行**（pack 体系；OSS 商店清单不可达→商店卡片为零），P4 主件的商店安装卡片开关在用户可见面缺席。加映交付**领域包整包启停**：packs/installed.json 记录级 enabled（缺省启用）+pack:set-enabled IPC+server.js 装配循环跳过停用包（插件源与 tool-registry 注册整体不生效）+包卡片「停用/启用」按钮（与卸载并列）。红 4→4/4 绿+面板 9/9+tsc 0+CDP 实机在场断言（pack-toggle-petri-pack-bio 在场，acceptance/ui-481/pack-toggle-visible.png）；双通道语义=商店卡片开关治理 installed.json 安装源、包卡片开关治理 pack 安装源。测试钉=block157-pack-enabled（含 server 接线源码扫描守卫+IPC 双侧登记钉）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
