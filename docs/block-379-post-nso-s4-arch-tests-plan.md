---
capability: block-379-post-nso-s4-arch-tests
status: completed
goal: S4 架构去补丁与测试有效性——实例化单源/contractVersion 收编/行为化合同推进；runLoop 五段拆分与 148 簇消亡按蓝图的「拆前拆后同套绿」纪律分层执行，大拆片如实分层不硬闯。
acceptance:
  - 实例化单源：三处 new Database 收编 openDatabase 工厂（db-connection-policy 唯一策略+实例化真相）
  - contractVersion 收编：三处硬编码归入对应版本注册表（intent 域/studio 域分离澄清）
  - 行为回归全绿（db-singleton/nso-w2-db-single-source/replay/changeset 族）
  - 大拆片（runLoop 五段/SimpleChat/workspace-tools）按 W5b 先例分层：切片计划留档，未执行部分如实登记
  - 148 簇消亡：按簇挂规则推进（block172 已清偿 147→145）
reopen: 拆片执行时按 BLOCK-92/W5b 基线纪律逐刀
---

# BLOCK-379 · S4 架构去补丁与测试有效性（post-NSO 蓝图 §10）

> 承载蓝图 §10。发令：用户预授权连续工作模式。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 交付对账

| 蓝图项 | 结果 | 证据 |
| --- | --- | --- |
| §10.3 实例化单源 | ✅ | openDatabase 工厂（registerDatabaseConstructor+ctor 注入，桌面/后端副本解耦）；_db-singleton（+FK ON 补声明保留）/db/connection/migration-runner 三处收编；残 count：connection.js 0 / migration-runner 0 / _db-singleton 0（余 2 处为注释） |
| §10.3 contractVersion | ✅ | repository:1071→RESULT_STUDIO_CONTRACT_VERSION；replay-service:257→String(RESULT_EDIT_INTENT_VERSION)（**澄清**：intent 域与 studio 域是两个版本注册表，S2 首版误并已纠正—— String 形态校验器契约钉死）；artifact-truth:431 ||1→?? 显式 registry |
| §10.1 runLoop 五段拆分 | ⏸ 分层 | 拆前行为基线=loop-orchestrator-subdomains 16 项+行数棘轮 1572 已锚定；五段切片=独立会话逐刀（W5b 先例：一片/会话+拆前拆后同套绿）；未硬闯 |
| §10.2 SimpleChat/workspace-tools 拆分 | ⏸ 同上 | 例外 expires 2026-12-31 在案；切片计划留档 |
| §10.6 行为测试替代源码扫描 | ✅ 部分成熟 | W5b 重试分类矩阵/token 账本单源/CP-5 锚随实现（block172 16/16 行为化）；剩余源码锚点随拆片逐刀替换 |
| §10.5 13 环消亡 | ⏸ | 棘轮在案只减不增；按簇消亡=逐包 |
| block93（S0/S1 移交） | ⏸ 专项 | 诊断深化：spawn 子链主请求 system=纯静态 1029B（角色指令+动态上下文缺席），疑模型解析链走真实配置而非测试 mock（resolution path 需实机跟踪）；独立会话专项 |

## 2. 门禁终态

db-singleton 13/13+nso-w2-db-single-source 8/8+replay 11/11+changeset/lineage 44/44+nso-b1 4/4；tsc 0。

## 3. 未清偿（分层不硬闯）

runLoop 五段切片 / SimpleChat / workspace-tools 拆分 / 13 环 / CSS 13 plain 收缩 / block93 实机跟踪——均已留切片计划与判据，逐包推进。
