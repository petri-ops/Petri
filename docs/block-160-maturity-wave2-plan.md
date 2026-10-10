---
capability: agent-maturity
goal: BLOCK-160 = 成熟度蓝图 W2 波整波承载（ORC-2 动态审批粒度 / ORC-1 用户规则层 / KNW-3 斜杠命令 / CAP-2 env 密文化 / KNW-4⇄DIST-2 共轨）；用户发令「开冲到W2波末」+ 波内零停顿（蓝图 §3.4），波末五出口断言全绿
acceptance:
  - ORC-2：动态审批两维（系统破坏命令首 token + 敏感路径模式）对 mutating 调用生效，命中 deny+guardKey；ctx.dynamicGuardAcks 统一确认通道；实机参数/路径级案例
  - ORC-1：用户规则三字段（匹配器 path-glob/command-token + 动作 require-ack/deny + 作用域）rules.json 持久化 + REST CRUD + 设置面列表增删改；规则命中真实拦截实机
  - KNW-3：composer `/` 斜杠菜单双来源（产品 Skills + run_tool 模板），选中注入结构化执行意图；实机双来源单入口
  - CAP-2：mcp-servers.json env 值落盘加密（aes-256-gcm+本地密钥），存量明文迁移自愈，落盘零明文
  - KNW-4⇄DIST-2：SKILL.md 格式兼容导入（复用 D7 目录导入管线）+ MCP 配置文件导入；外部技能导入即用
  - 波末：五出口断言 + closeout 门禁 + 蓝图/backlog 状态回写
reopen: 波内零停顿条款（蓝图 §3.4）——预裁决缺省即生效波报复认；整波范围改判需用户裁决
status: active
---

# BLOCK-160：成熟度蓝图 W2 波（动态审批 + 用户规则 + 斜杠命令 + env 密文 + SKILL.md 导入）

> 立项：2026-10-10。用户发令「开冲到W2波末」（承接 W1 同日收口 + 波内零停顿条款）。
> 蓝图锚点：[g0-agent-maturity-blueprint.md](./g0-agent-maturity-blueprint.md) §2②③④⑤ / §3.2 W2 行。
> 编号注：BLOCK-159 已由并行会话（手机远程传输）占用，本波顺延 160；文件面互认隔离（对方唯一交叉 projectionDataBridges.ts 行区不相交、本波 W2 不触该文件）。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 波次范围与执行序

| 序 | 种子 | 核心交付 |
| --- | --- | --- |
| P1 | ORC-2 | policy 纯函数新增 `evaluateDynamicGuards`：系统破坏命令首 token 维度（format/mkfs/dd/diskpart/fsutil/cipher/vssadmin/bcdedit/shutdown 等）+ 敏感路径模式维度（系统目录/凭证目录），mutating 调用命中 → deny+guardKey；`ctx.dynamicGuardAcks` 统一确认通道（ORC-1 与未来确认 UI 共用） |
| P2 | ORC-1 | helpers/agent-user-rules.js（rules.json 读缓存）+ policy 规则层判定（first-match：deny / require-ack→ack 通道）+ REST /api/ai/agent-rules CRUD + 设置面规则列表 |
| P3 | KNW-3 | composer `/` 斜杠菜单：双来源（产品 Skills + run_tool 模板）、选中注入结构化执行意图、不跳页 |
| P4 | CAP-2 | mcp-settings env 值 aes-256-gcm 加密落盘（本地密钥文件），存量明文读迁移、写必加密 |
| P5 | KNW-4⇄DIST-2 | SKILL.md front-matter 兼容（目录导入管线识别 SKILL.md 合成 skill.json）+ MCP 配置 JSON 文件导入（id 去重合并） |

## 2. 设计裁决（波内零停顿：主代理按蓝图 §3.4 三原则缺省，波报复认）

- ORC-2 维度选择=系统级破坏命令（**不含 rm/del 等常规命令**——rm 构建产物属日常操作，静态黑名单已兜底最坏面；用户需更严由 ORC-1 规则自配）+ 敏感路径（系统目录与凭证目录子串模式）。MCP 半边 v1 诚实边界：MCP 工具参数无标准路径字段，动态维度仅覆盖显式 path 字段的内建工具，MCP 全量参数扫描留 v2。
- ORC-2 命中语义=deny（取最严），guardKey 回显 + 指引文案；`ctx.dynamicGuardAcks`（Set）为统一「用户已确认」通道，require-ack 类规则命中时若 ack 集含规则键则放行（reason=user_rule_acked）。确认 UI（前端弹卡）为 rider，v1 不做。
- ORC-1 规则判定置於静态闸之后、动态维度之前（first-match 先到先判，与领域 hook 同语义）；规则文件 `$BIOF3_LOCAL_DATA_DIR/agent-rules.json`，读缓存 fail-soft（缺文件=零规则零行为）。
- CAP-2 机制偏离登记：预裁决写「Electron safeStorage」，实际 mcp-settings IO 在 core 进程（无 Electron API）→ 改用 core 侧 aes-256-gcm + `$BIOF3_LOCAL_DATA_DIR/keys/mcp-env.key` 本地密钥（效果等价：落盘零明文；机制差异波报复认）。
- KNW-3 v1=文本模板注入（选中后向 composer 输入框填充结构化提示模板），BLOCK-139 式结构化 chip 注入留 v2（范围从紧）；run_tool 模板数据源走既有 run_tool 目录面。
- KNW-4 SKILL.md 兼容=受限 front-matter 解析（name/description，零 YAML 依赖，HK-04 解析器同思路）；插件导入不随批（商店通道 BLOCK-158 已退役、pack 对话框已在），DIST-2 剩余面收敛=SKILL.md 兼容 + MCP 配置导入。

## 3. 非范围

- 动态防护确认 UI 弹卡（ack 通道已在，UI 为 rider）、MCP 参数全量扫描、规则表达式/正则/优先级编排、参数语义分析。
- composer 结构化 chip 注入通道（KNW-3 v2）、远程技能市场（C-EXT-2 维持 deferred）。

## 4. 波末出口判据（五断言）

1. 动态审批生效：full 档实机 `format`/敏感路径案例被动态防护拦截（deny+guardKey）。
2. 用户规则命中真实拦截：配置 deny 规则后同调用被拒（reason=user_rule_denied）。
3. composer `/` 双来源单入口：技能与模板同菜单可选可注入。
4. mcp-servers.json env 落盘零明文（加密往返+存量迁移）。
5. 外部 SKILL.md 目录导入即用（发现/读取/执行面同内置技能）。

证据落 `acceptance/block-160/`；收口笔录回写本文件 §7 + 蓝图 §2 状态注记 + backlog 翻格。

## 5. 门禁

逐阶段红绿 + 定向测试 + tsc（触前端）；波末 closeout 门禁 + 实机探针五断言。

## 7. 收口笔录

（波末填写）
