---
capability: block-389-post-s7-h4-single-source
status: completed
goal: 把「同一事实写了两份」的两处结构性复制收成单源（schema/契约版本、DB 路径解析），并如实挂起必须按 W5b 一切片一会话推进的大拆片，避免在连续工作模式里用互相污染的证据冒充拆分完成。
acceptance:
  - schema/契约版本有唯一登记处，六个原字面量点全部改为引用，单边升版即红
  - intent 域版本保持独立（BLOCK-379 双版本域澄清不被误并）
  - DB 路径解析单源：branch-db 委托 resolveDbPath，认 PETRI_DB_PATH；三态（显式/回落/fail-fast）有契约
  - 大拆片 / 插件源三处 / 环与 knip / 源码扫描契约：逐项写明为何不在本包做与补腿条件
reopen: 启动正式 W5b 切片会话（一个切片=一个会话，拆前拆后同套定向绿）
---

# BLOCK-389 · post-S7 H4 单源收编（可机械验证子集）

> 发令：用户 2026-11-09 预授权连续工作。上游 §4 H4（B-16 / B-17 / B-18 / B-19 / B-20 / B-24 / B-25 / B-26 / B-31）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 交付

| 项 | 缺口 | 交付 |
| --- | --- | --- |
| 版本单源 | B-17 | 新增 `core/shared-backend/schema-versions.js`（4 个常量：artifactTruth / studio 契约 / delivery manifest / tool 契约）；六个原字面量点全部改为引用（`artifact-truth.js`、`result-studio-contracts.js`、`delivery-manifest.js`、`agent-tools/{registry,tool-execution,plugin-loader}.js`） |
| 版本契约 | B-17 | `test/block389-version-single-source.test.mjs` 3 条：四消费方一致 / 六点无独立字面量（源码扫描）/ intent 域保持独立（number vs string 双形态 + 不并入登记处） |
| DB 路径单源 | B-19 | `src/database/branch-db.js:getDatabasePath()` 改为委托 `resolveDbPath(process.env)`——认 `PETRI_DB_PATH`，与 core 侧同源；两者皆无时保持 fail-fast |
| DB 路径契约 | B-19 | `test/block389-db-path-single-source.test.mjs` 4 条：显式优先 / dataDir 回落 / fail-fast / 与 core same-env-same-result |

## 2. 挂起项与理由（不冒充完成）

| 项 | 缺口 | 为什么不在本包 | 补腿条件 |
| --- | --- | --- | --- |
| 五个巨型文件大拆片（loop-orchestrator 1579 / SimpleChat 2079 / workspace-tools 1605 / project-workspace 1221 / ReviewMode 1429） | B-16 | **W5b 纪律**：一切片=一会话、拆前拆后同套定向绿。连续工作模式下多切片共享同一批基线证据会互相污染，属「用噪声冒充证据」 | 每切片独立会话：先跑该文件定向测试取拆前基线 → 抽段 → 同套绿 → `gate:code-size` 只减不增 + 行数锚随交付刷新 |
| 插件源三处装配 → 单一 `loadPlugins(sourcePlan)` | B-18 | 三处分别承载 MCP registry / server 启动 / 插件管理器，收敛要先定 sourcePlan 形状并改三个调用方，属结构性重构（非本包可单点验证） | 先出三处装配差异表 + sourcePlan 契约，再单会话改 |
| 源码扫描契约换行为断言 | B-20 | 每份扫描契约背后是一个行为面（release-contract / 二次真相等），替换必须逐个建立等价行为断言，是切片活 | 按文件列清单，一次一个文件：先加行为断言 → 再删 includes |
| 13 存量环按簇消亡 / knip 动态入口 / 三套依赖树 | B-25 / B-26 / B-24 | 依赖与环的收敛会改 module 边界，必须单独立项 + 全量回归；在本程序内做会把「单源收编」和「架构改道」混成一批 | 逐簇：先 `--update` 记录当前环，再改一处依赖方向，跑 `quality:arch` + `gate:arch-cycles` |
| lint 2312 warnings 分域棘轮 / css 白名单 13→11 | B-31 | warnings 抑制基线是安全网，收缩要分域（测试面/生产面）且每域都要负测守护 | 分域统计当前基线 → 设只减上限 → 每域清零后 `--suppress-all` 重扫入库 |

## 3. 证据

| 门 | 读数 |
| --- | --- |
| `test/block389-version-single-source.test.mjs` | 3/3 |
| `test/block389-db-path-single-source.test.mjs` | 4/4 |
| `test/nso-w2-db-single-source.test.mjs` + `test/db-singleton.test.mjs`（邻域） | 34/34（含影响图两条） |
| `npm run closeout` | 17 门全绿 |

## 4. 完成语义

`completed`（可机械验证子集：两处单源 + 两族契约）。大拆片与环/依赖/源码扫描按 W5b 与依赖改道理由挂起，条件写明。

G0 开发期常态 · 不外推 packaged/Provider/GA。
