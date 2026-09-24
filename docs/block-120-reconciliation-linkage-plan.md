# BLOCK-120-RECONCILIATION-LINKAGE — 终态对账 v2：条目级归属（todo 条目 ↔ 子任务 linkage）

- 状态：active（P0-LAUNCH）
- 队列：全局待办 BK-03（`docs/pending-work-backlog.md` 推进队列头；用户裁决「继续冲」=按队列逐个推进）
- 上游：终态对账 v1（2026-09-21 交付，`helpers/agent-reconciliation.js` 粗粒度口径，诚实边界=「条目级归属对账待数据模型补 linkage 后另裁」）；BLOCK-97 todo_write（条目自带 id）；BLOCK-49 spawn 链（params JSON 落库）；BLOCK-119 加映 3（goals 链路=本包模板）

## 1. 勘察结论（P0，file:line）

- todo 条目**已有 id**：`agent-tools/todo-tools.js` `normalizeTodoItems`（id 模型可声明或默认序号，≤64 字符）；清单快照=task_events 的 `tool_call(todo_write)` 事件重放（整单幂等替换），无独立表。
- 子任务 params=JSON 列：`spawn-agent-tools.js` `launchSubAgent` 落 `params.goals`（加映 3 先例）——`todoRefs` 走同一根线，**零 migration**。
- 对账挂点：`agent-runner.js` 终态块（~:971-989）已读「最近 todo 快照」+ `listChildAgentTasks`（返回完整 params）——v2 所需数据全部现成。

## 2. 方案（声明制 linkage，纯 additive）

1. `spawn_agent` / `followup_task` 增可选参数 **`todoRefs: string[]`**（≤5 条、单条 ≤64 字符=todo id 同界）：「本子任务对应任务清单的哪些条目」。
2. spawn 时对照当前运行最近 todo 快照校验：**未登记 id 丢弃 + 工具结果如实回传**（不阻断派发）；有效 refs 落 `params.todoRefs`。
3. 对账 v2（`agent-reconciliation.js` 同签名扩展）：failed/cancelled 子任务按 `params.todoRefs` 反查清单条目，**已标记 completed 的条目**→ 条目级失真明细（itemId/content/childStatus）；有明细=kind `item_level_mismatch`（message 点名条目内容），无 linkage=回退 v1 粗粒度 kind（**向后兼容**）。清单非全 completed 时维持 v1 语义=不出提示。
4. agent_status message 文本承载明细（v1.5 先例，零前端改动）。

## 3. 预登记裁决项（按推荐先行留痕，可逆）

- **D-1 声明制**：linkage 由模型 spawn 时显式声明（工具描述引导）；不做自动文本匹配（todo 内容↔子任务相似度=不可靠造第二真相）。
- **D-2 未知 id=丢弃+回传**：refs 指向快照外 id 时丢弃该 ref 并在工具结果注明；不整单拒绝（typo 一票否决派发过狠）。
- **D-3 子任务书不注入 todoRefs**：对账归因是父侧观测面；子侧上下文保持精简。
- **D-4 混合场景**：有 linkage 的子任务出条目级明细，无 linkage 的维持 v1 总数口径，二者并存于同一 notice。
- **D-5 followup 继承**：不传 todoRefs 继承原子 refs（显式覆盖优先），镜像 goals 语义。

## 4. 非范围（exclusions）

- 不改 todo_write 工具本体与清单持久化（事件重放机制不动）；不做子任务失败自动改写清单（v1 红线：不改写、不阻断）；零前端改动；零 migration；不做反向归属（子任务→多条目之外的图结构）；不做 UI 面新组件。

## 5. 验收门禁

1. 契约：`block49-spawn-agent-tools` 增 normalizeTodoRefs fail-closed / params.todoRefs 落库 / 未知 id 丢弃回传 / followup 继承 / 工具 schema 含 todoRefs。
2. 契约：`block109-reporting-reconcile` 增 v2 条目级失真（linked failed child + completed item → item_level_mismatch 点名内容）/ 无 linkage 回退 v1 kind / linked 但子任务正常=无提示 / 清单非全 completed=null；既有 v1 回归 0 红。
3. 定向 test:changed 0 红 + closeout 十门全绿。
4. 实机真 spawn 轮：模型声明 todoRefs → params 落库 + 终态对账跑通无假阳性（失败分支语义由契约承载，与 BLOCK-119 加映 3 同证据等级）；证据落 `acceptance/block-120/`。

## 6. 完成语义

`completed`=P1 契约全绿 + P2 实机 + closeout 十门 + canonical 回写（本 plan 收口节/backlog BK-03 翻 ✅/roadmap/handoff/AUDIT-LOG）。PoC 失败语义（模型侧声明率过低致条目级对账不可观测）=诚实收缩：契约与机制保留、观察声明率、不硬凑实机阳性。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 收口（2026-09-24 当日，提交 15b22e12 + 收口笔）

- **P1 交付**：spawn-agent-tools 三处接线（normalizeTodoRefs/`latestTodoIds` 快照对照/`resolveTodoRefs` 丢弃回传）+ params.todoRefs 落库 + 对账 v2（item_level_mismatch/回退 v1）+ followup 继承覆盖 + 工具 schema 双定义 + agent-runner 对账点注释翻新。
- **门禁**：block49 契约 19/19（+7）+ block109-reconcile 13/13（+4）+ test:changed 0 红 + closeout 十门全绿（抓真归因=block34 v5.6 断言存量漂移，基线对照证伪非本包引入，已同步 v5.18 动词契约 12/12；test:changed 首跑分类冲突=acceptance/block-120/ 未登记 impact-map，补 block120 规则收口）。
- **P2 实机**（证据 `acceptance/block-120/live.json`）：真模型按工具描述自觉声明 `todoRefs:['1']` 且落子任务 params；clean 轮 reconciliation 事件=0（零假阳性）；失败分支语义由契约承载（与加映 3 同证据等级）。
- **Dogfood**：output:judge 对本包收口声明首判 fit=2.94→RETRY（带判词），按门语义重写后复判 fit=3.67=PASS——评判门三态闭环在自家收口上完整行使。
- **D-1~D-5 全按推荐落定**（声明制/丢弃回传/子任务书不注入/混合口径/继承覆盖）。遗留=生产声明率与条目级命中率按观察期累计（并入 BK-02 观察盘点口径）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
