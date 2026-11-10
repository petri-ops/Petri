---
capability: block-394-agent-side-remaining-work
status: active
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
| （开工中，逐批回填） | | | |

## 4. 收口

`docs:check` + `ui:audit:check` + 定向 `test:changed` + 专项门 + `closeout`；干净树跑 `closeout:full` 一次；canonical 同批回写；未达证据不写 verified/completed。

G0 开发期常态 · 不外推 packaged/Provider/GA。
