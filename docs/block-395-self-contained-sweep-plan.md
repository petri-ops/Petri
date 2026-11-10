---
capability: block-395-self-contained-sweep
status: completed
goal: 二轮核实「哪些项真的需要人」，把被过度归类为 human_eye/except 但 Agent 能独立完成的部分逐件扫掉；全程无需用户参与。
acceptance:
  - 34 条逐件有 humanRequired 判定，误分类纠正留痕
  - 15 件不需人的余项逐件有实质交付 + 证据 + 负测，无静默消失
  - 不放宽任何基线、不缩人眼桶、不冒 verified、不改用户裁决、零新增依赖
  - 真需要人的边界（凭据 / 观感 / 裁决）逐件保留
reopen: 有效凭据到位 → B-02 / B-34；人眼路线签字 → 22 条 UI debt 与读屏末步
---

# BLOCK-395 · 自主扫尾（二轮核实后）

> 发令：用户 2026-11-10「在核实有哪些是可以自己完成的 不要人 再扫掉 完成」。
> 视为预授权连续工作延续，直接开工，不停线等裁决。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 核实结论：上一轮有过度归类

首轮把「含 UI 观感末步」的条目**整体**归入 `human_eye` / `except`，导致 4 处误分类：

| 缺口 | 首轮归类 | 二轮核实 |
| --- | --- | --- |
| B-10 树 roving tabindex | human_eye 主类 | 代码实现 + 组件测试完全不需人，只有 VoiceOver 朗读需人 |
| B-11 布局单源 | except（几何非平凡→不改 CSS） | 「内层独立语义类名 + composes 同一规则」可零几何收敛，不需人 |
| B-12 32 条 debt | human_eye 主类 | 台账判档 / CDP 代行不需人，只有观感过目需人 |
| B-32 颜色 token | human_eye 主类 | 扫描门 + 债冻结是纯机械，只有截图 diff 需人 |

按「是否真的需要人」重判 34 条：`yes` 2（B-02 凭据、B-34 人眼+凭据）/ `no` 27 / `split` 5。逐件判定写进 `gap-ledger.humanRequired*`，由 4/4 契约守护。

## §2 15 件逐件交付（3 completed / 12 完成并声明边界）

| 缺口 | 终态 | 交付 |
| --- | --- | --- |
| B-05 | completed | CASCADE 依赖静态扫描门：121 文件 / 16 CASCADE DDL / 11 显式 DELETE 清单在册，3/3 契约；明确是决策材料非切换授权 |
| B-11 | completed | 零几何收敛：内层 `workspaceSessionInner` composes 同一规则，双层同名消除；tsc 0、面板 157/157、3/3 契约钉住外层不动 |
| B-18 | completed | `server.js` 三源路径改走 `pluginLoader.resolveDefaultPluginSources()`（与 mcp/registry 同源），删死导入；**保留** `enabled===false` 整包启停用户裁决 |
| B-04 | except* | B-04/B-33 保守分诊门；接线属产品决策、准入语义不擅改 |
| B-07 | except* | CDP 合成事件投影链断言（四事件文案 + 模块在场）；RST 截图观感仍待人眼 |
| B-10 | except* | roving tabindex 纯映射 + 真挂载 LeftPanel（上下/Home/End/左右展开折叠）；tsc 0、21/21、5/5；仅读屏确认需人 |
| B-12 | except* | 35 条 debt 按 canonical 完整标题分诊；首版误用截断派生数据把人眼洗成 1 条 → **根修**为 22 人眼 / 1 外部 / 12 可机械判档 |
| B-14 | except* | CDP 三态横幅 live region 在真实页面 DOM 验证；截图观感仍待人眼 |
| B-16 | except* | W5b 一切片=一会话如实登记，不在本会话硬塞大拆片 |
| B-21 | except* | 未映射 120→90（挂 30 条，严格按真实引用唯一规则，不建兜底） |
| B-22 | except* | 冷启动 ×5 真重启（5/5 ready，最差 5640ms）；真修 `spa200` 同源派生、`migrations` 测试分支打点、accessor 保留 null 段 → 4/5 段有权威读数 |
| B-26 | except* | knip 三处动态入口登记即留痕；逐键收缩另立批次 |
| B-30 | except* | EAR 分子增长 43.1→43.2%（927/2144），不缩分母不写达标 |
| B-32 | except* | 颜色字面量机械门冻结 30 文件 / 354 处债（token 定义与注释不计、新增即红），3/3 契约 |
| B-33 | except* | 165 通道逐件分诊（124 产品决策 / 41 retain / 0 可删），不盲接不删 preload |

> `except*` = Agent 侧可开工部分做完，剩余人为边界如实挂起。逐件完整说明在 `gap-ledger.round2*`，由 4/4 契约守护无静默消失。

## §3 三处根因修正（留因，不回溯调参凑绿）

1. **B-12 缩分母陷阱**：首版用 `ui-ledger-triage.json` 的 `title`（生成器截断到 ~120 字符）判档，把「待实机观感/走查待人工」关键词切掉 → 人眼桶只剩 1 条。改从 canonical 原文 `docs/ui-productization-audit.md` 逐件读完整标题，补齐同义词 → **22 条人眼**。契约钉住「不得用截断数据洗人眼桶」。
2. **B-22 假接线**：给主进程加五段 marks 后冷启动实测 `spa200`/`cdpPageReady` 仍 0。查到 `spa200` 派生行在前次编辑中未真正写入、`accessor` 把 `null` 字段静默丢弃；两处真修后 `spa200` 5/5。`cdpPageReady` 仍 0 是**测试实例页面不挂载主窗 App** 的真实路径差异，如实记 null + 标 `measured-with-declared-path-limit`，不编数字凑 5/5。
3. **冷启动脚本自杀**：首轮 `lsof -ti :9223` 拿到 CDP 连接者（采集脚本自己）而非监听者，第 2 轮把自己 kill 掉（exit 143）。删掉重复 kill，改用启动器自带的 `lsof -sTCP:LISTEN` 幂等清场。

另修：B-25 余环首判「全是同一条边」错误，实为 **5 个根因簇**（agent-tools 回指 5 / fallback-resume 2 / tool-defs-registry 1 / guest-permissions 1 / 前端组件互斥 3），按真实结构归簇，不硬塞。

## §4 证据与边界

| 门 | 读数 |
| --- | --- |
| 新增/扩展契约 | B-05 3/3、B-10 5/5、B-11 3/3、B-32 3/3、B-25 归簇 3/3、B-29 3/3、B-12 3/3、B-04/33 3/3、B-22 冷启动 3/3、二轮台账 4/4、既有两轮契约 10/10 |
| 实机证据 | `h10/cascade-scan.json` `color-baseline.json` `cycle-clusters.json` `cdp-event-projection.json` `cold-start-x5.json` `debt-adjudication.json` `deferred-triage.json` `unmapped-decay-batch2.json` |
| 34 条终态 | done 20 / done-partial 12 / pending_human_eye 1 / external-blocked 1 |
| 保护边界 | 10 项用户资产零命中（门现场）、种子只写 `/tmp` 隔离副本、默认离屏禁 `--onscreen`、零新增依赖、零第二真相、既有用户裁决不变 |

**真需要人的只剩**：B-02 有效凭据、B-34 任务产物质量判据 + T7、22 条 UI debt 的观感/读屏过目、B-05 FK 切换裁决、B-07/B-14 的截图观感。**不代答、不冒 verified。**

## §5 复跑命令

```bash
npm run closeout
node scripts/post-s7-b05-cascade-scan.mjs && node scripts/post-s7-color-ratchet.mjs
node scripts/post-s7-cycle-cluster.mjs && node scripts/post-s7-debt-adjudicate.mjs
node scripts/post-s7-deferred-triage.mjs && node scripts/post-s7-structural-gates.mjs
node --test test/post-s7-h10-*.test.mjs test/post-s7-h9-agent-side-ledger.test.mjs test/post-s7-gap-blocker-classification.test.mjs
# 实机（需无窗口 dev 栈 + 9223 默认离屏 + 隔离库）
node scripts/post-s7-cdp-event-projection.cjs
node scripts/post-s7-cold-start-x5.cjs
```

G0 开发期常态 · 不外推 packaged/Provider/GA。
