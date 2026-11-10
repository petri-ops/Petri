---
capability: block-394-agent-side-remaining-work
status: completed
goal: 按用户 2026-11-10 发令，把 34 条缺口台账里分类为 Agent 可开工的 23 条逐件实质交付，全程无需用户参与；不扩范围、不改用户裁决、不放宽基线。
acceptance:
  - 23 条逐件有实质交付（代码 / 机械门 / 台账 / 证据）或如实登记不可达原因，无静默消失
  - 每批拆前拆后同套定向绿；红门修根因，不靠放宽阈值凑绿
  - W5b 一切片=一会话 + 拆前拆后同套绿；大拆片按切片独立收口
  - 零新增依赖、零第二真相、零用户资产触碰、零阶段跃迁
reopen: 有效模型凭据到位 / 人眼路线签字 / 用户裁决档位变更（均不在本包范围）
---

# BLOCK-394 · 23 条 Agent 可开工项自主收口

> 发令：用户 2026-11-10「好的 那就确定一下 把 23 条是 Agent 开工 自主性搞完 不需要的我参与」。
> 视为显式预授权连续工作（不逐项请示、不停线等裁决）；工程判断下放主代理并逐项留痕。
> **终态：completed（12 项出口判据全达成 + 11 项 Agent 侧做完并如实声明末步边界）**。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围（来自 gap-ledger 的机械分类，不凭印象）

| 批次 | 条数 | 缺口 |
| --- | ---: | --- |
| A 机械债 | 11 | B-06 / B-08 / B-17 / B-21 / B-23 / B-24 / B-26 / B-29 / B-30 / B-31 / B-33 |
| B 工程项 | 7 | B-03 / B-04 / B-13 / B-16 / B-18 / B-20 / B-25 |
| C 实机栈 | 5 | B-07 / B-09 / B-11 / B-14 / B-22 |

不含：`human_eye` 4（B-10/12/32/34）、`credential` 1（B-02）、`user_decision` 1（B-05）、`none` 5（B-01/15/19/27/28）。

## 2. 执行纪律

- 单工作包串行，三批按 A→B→C 推进；每批拆前基线 + 拆后同套定向绿 + 独立证据目录 `acceptance/post-s7-2026-11-10/h9/`。
- 红绿先行：新门先写负测再实现；patch vs refactor 判断在动既有代码前做并留痕。
- 五类证据各归其位：行为测试 / 机械门禁 / DOM 与实机 / 人眼观感 / 真实任务成功。
  B-07、B-11、B-14 的**末步**人眼过目不代答，只交付 Agent 可代行部分并标 `pending_human_eye`。
- 保护边界：10 项 untracked 用户资产零触碰（gate:user-assets 守）；零新增依赖；不新建 executor/Job/Artifact/Workflow/项目状态/UI truth/DB 连接源/插件源解析器/评分器/通知中心；不改既有用户裁决（workspace_exec 默认放行、MCP trust 与 capability token 两轴分离、G0 阶段纪律）。
- 实机腿一律无窗口 dev 栈（后端 :3001 隔离副本 + vite :3000）+ 9223 **默认离屏**，禁 `--onscreen`。

## 3. 逐件交付台账（随推进更新）

| 缺口 | 终态 | 交付 | 证据 |
| --- | --- | --- | --- |
| B-03 | completed | spawn role 根修：角色块并进静态前缀，51/52 → 52/52 + 回归钉 3/3 | role-prefix.test.mjs |
| B-04 | except* | 三入口通道清单门（1 消费 / 2 显式 deferred）；凭据载体设计另立 | structural-gates 6/6 |
| B-06 | completed | 装配点 7 处冻结门；门当场发现 message-trimmer 漏项并登记 | prompt-injection-inventory.json |
| B-07 | except* | 四事件前端映射 + SSE 走既有 onAgentStatus；tsc 0、SSE 14/14；断线注入人眼末步挂起 | runHealthEvents 4/4 |
| B-08 | completed | 8 处空 catch 逐处留因，基线 403→395，负测 2/2 | silent-catch-baseline.json |
| B-09 | completed | CDP 8 档 + cv A/B：布局耗时 A=B=0.7ms 无收益 → 按判据回滚不改 CSS；判据修正为渲染耗时 | cv-ab.json + ab-evidence 4/4 |
| B-11 | except* | 三态几何 A/B：改类名会让消息区窄 74px/移 40px → 不改 CSS，登记独立切片 + 人眼 | layout-ab.json |
| B-13 | completed | 回执回看有界 20 条 + 去重 + role=log，组件测试 4→5 | ExternalImportPanel.test.tsx |
| B-14 | except* | 独立重连横幅三态（零新状态源），邻域 59/59；截图人眼末步挂起 | StreamReconnectBanner.test.tsx |
| B-16 | except* | 4 巨型文件独立行数锚棘轮；大拆片仍需 W5b 一切片一会话 | big-file-anchor.json |
| B-17 | completed | 插件侧 5 处版本字面量收编 + 单源引用扫描，6/6 | version-parity-gate.mjs |
| B-18 | except* | 三处装配差异表机械门（按职责分域）；sourcePlan 收敛需独立立项 | structural-triage.json |
| B-20 | completed | goldenPath.tool 换结构化解析，注释提及不算声明，负测 3/3 | tool-declaration.test.mjs |
| B-21 | except* | 未映射 138→120；错挂 81 条到兜底规则已当场回滚；余 120 按八簇继续 | unmapped-decay-batch.json |
| B-22 | except* | 主进程权威 marks 新增四段，五段判定器同源；7/7；冷启动 ×5 另立 | startup-five-stage.test.mjs |
| B-23 | completed | 三矩阵同源机械门（分域比对 + 时间链），5/5 | matrix-parity-gate.mjs |
| B-24 | completed | 三树对账门抓到真实 uuid 漂移 → 根修收紧声明（实装未变），4/4 | dependency-parity-gate.mjs |
| B-25 | completed | 真实消亡 1 环（类型归位），13→12、tsc 0、52/52、3/3 | arch-cycles-baseline.json |
| B-26 | except* | 三处 knip 动态入口登记；诚实：330 键中 0 命中，登记≠收缩 | knip-dynamic-entry.test.mjs |
| B-29 | completed | 11 个 sha256:null 转正为真内容摘要（唯一写入器 + 漂移负测），5/5 | skill-integrity.mjs |
| B-30 | except* | 证据入册 EAR 41.9→42.2%（不缩分母、不写达标）；45% 仍需分子增长 | quality:ear 现场 |
| B-31 | completed | lint 分域棘轮（154/36/1 双守）+ css 白名单 13→11 | lint-domain-baseline.json |
| B-33 | except* | 165 通道逐件分诊（124 接线 / 41 retain / 0 可删）；不删通道不留破坏 | ipc-unused-triage.json |

> `except*` = `completed-with-declared-exception`：Agent 侧可开工部分做完，末步人眼/读屏/独立 W5b 切片/结构性重构如实挂起，不冒 verified。逐件完整说明与证据路径在 `acceptance/post-s7-2026-11-09/h7/gap-ledger.json` 的 `agentSideDelivery` / `agentSideEvidence`，由 `test/post-s7-h9-agent-side-ledger.test.mjs` 4/4 守护。

**统计**：23 条 = completed 12 + except 11；范围外 11 条（human_eye 4 / credential 1 / user_decision 1 / none 5）未被改写。

## 5. 收口笔录（2026-11-10）

- 三批串行完成：A 机械债 11 项 → B 工程项 7 项 → C 实机栈 5 项；每批独立提交、拆前拆后同套定向绿。
- 红门修根因实例：B-03 角色块被裁剪器挤出、B-24 uuid 声明漂移、B-25 双向类型环、B-06 盘点漏项、B-20 扫描式假契约、B-22 跨轴时间轴——全部修到根，未靠放宽阈值凑绿。
- 判据设计修正 4 处（均留因）：B-09 cv 不改节点数故改用渲染耗时；B-11 几何非平凡故不改 CSS；B-16 不塞 700 行预算门改独立锚；B-18/B-33 按职责/MAIN_ONLY 分域。
- 五类证据各归其位：CDP DOM/几何/帧率断言不冒视觉绿；组件测试不冒 UI 在场；closeout 绿不冒任务成功；人眼 4 项与读屏末步保持 pending_human_eye。
- 保护边界：10 项用户资产零触碰（gate:user-assets 现场零命中）；隔离库只写 `/tmp` 副本；零新增依赖（只收紧 uuid 声明）；零第二真相；不改既有用户裁决；`--onscreen` 全程禁用（默认离屏）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 复跑命令

```bash
npm run closeout
npm run gate:user-assets && npm run gate:version-parity && npm run gate:code-size && npm run gate:arch-cycles
node scripts/post-s7-hygiene-gates.mjs && node scripts/post-s7-structural-gates.mjs
node scripts/post-s7-matrix-parity-gate.mjs && node scripts/post-s7-dependency-parity-gate.mjs
node scripts/post-s7-skill-integrity.mjs && node scripts/post-s7-big-file-ratchet.mjs
node --test test/post-s7-h9-*.test.mjs test/post-s7-gap-blocker-classification.test.mjs
# 实机 A/B（需无窗口 dev 栈 + 9223 默认离屏 + 隔离库）
PETRI_DB_PATH=/tmp/petri-h8-isolated/data/petri.db node scripts/post-s7-cv-ab.cjs
PETRI_DB_PATH=/tmp/petri-h8-isolated/data/petri.db node scripts/post-s7-layout-ab.cjs
```
