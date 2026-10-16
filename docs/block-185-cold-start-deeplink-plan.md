---
capability: ui-productization
goal: BLOCK-185 = 冷启动深链修复批——TTFS 产品化程序（评估报告 §5.1 阶段 1 ②）拆三串行批的第一批。修冷启动（整页 reload / Electron 重启）时深链路由归零竞争，兑现「用户从深链回到他离开的地方」。用户裁决「按照你的推荐来 冲」（2026-10-16，批准 D1/D2/D3 推荐 + 拆三串行 last-url 归本批）。
acceptance:
  - P1 last-url 持久化：扩展窗口状态存储通道（复用 _window-manager.js 位置记忆同一 store）新增 lastUrl 字段，启动时若上次为白名单本地 SPA 路由则恢复；安全红线=只恢复 localhost:3000/* 本地路由，绝不恢复任意外部 URL
  - P2 SPA 两竞争修复：Race A（useWorkspaceOpenEffects.ts 一次性消费置位在异步打开前）改「成功后置位+失败可重试」；Race B（project-workspace.tsx 冷启动后端未就绪静默归零）加后端就绪退避重试（照 welcome.tsx:100-132 已验证退避姿势，不重造）
  - P3 实机验收：CDP 双场景——①带 ?job= 整页 reload → URL 保持 + 结果页打开；②Electron 重启 → 恢复上次深链路由；落 acceptance/block-185/
  - 门禁：docs:check/ui:audit:check/tsc/quality:lint/quality:types/test:changed 全绿 + 实机双场景断言；红绿先行（先写复现竞争的失败用例再修）
  - 完成语义：深链在「SPA 内导航 / 整页 reload / Electron 重启」三态均保持；last-url 恢复有白名单门；无新增第二路由真相
reopen: 无
status: completed
---

# BLOCK-185 — 冷启动深链修复批（TTFS 程序 ② 第一批）

- 状态：`completed`（2026-10-16 整包收口：P1 last-url 持久化 + P2 SPA 两竞争 + P3 live 冒烟全交付；closeout 十三门全绿；决策逻辑全进机械门〔coldStartRetry 6 测 + main-window-state 6 测〕+ CDP 冒烟 4/4）
- 用户裁决原话：阶段 1 首包选「TTFS 产品化批」→ 范围切分选「拆三串行批，last-url 归入深链批」→ 立项骨架「按照你的推荐来 冲」
- 来源：评估报告 [Petri-Desktop-Evaluation-Report-2026-10-15.md](./Petri-Desktop-Evaluation-Report-2026-10-15.md) §5.1 阶段 1 ②；冷启动深链归零竞争缺陷登记于 [pending-work-backlog.md](./pending-work-backlog.md) BIO-3/UI-455 行（SPA 内保持已 verified，冷启动重载归零=独立缺陷仍登记）
- TTFS 程序拆批：本批=①深链修复；后续串行=②遥测端点化批、③onboarding 黄金路径批（各独立立项）

## 1. 立项自检（产品个性纪律问句）

「本地可审计 / 治理透明 / 证据自证体现了吗？」——last-url 恢复带**白名单门**（只恢复本地 SPA 路由，拒任意外部 URL）= 本地主权下的安全边界自证；深链三态保持用 CDP 实机双场景断言 = 证据自证；不引第二路由真相、复用既有窗口状态通道 = 单一真相。借 ZCode「六步 onboarding + 深链」之形，长 Petri 自有形态（last-url 白名单门 + 退避重试复用既有姿势）。

## 2. 范围（勘察已定位行号，2026-10-16 P0）

| 项 | 落点 | 类型 |
| --- | --- | --- |
| Race A 一次性消费不重试 | `frontend/src/pages/project-workspace/useWorkspaceOpenEffects.ts:84-110`（`:104-107` 置位在 `handleOpenResult` 之前） | 小修 |
| Race B 冷启动后端未就绪静默归零 | `frontend/src/pages/project-workspace.tsx:772-808`（`:799` catch → `:804-807` 归零）+ 归零执行点 `:358-361/:365` | 小修 |
| last-url 架构根因 | `src/main/_window-create.js:211-221`（恒 loadURL 根）+ 无持久化（对照 `src/main/_window-manager.js:126-134` 位置记忆） | 中（新建持久化通道） |

## 3. 非范围（红线）

- **不碰遥测**：funnel 埋点接线 / TTFS 度量口径 = 第二包（遥测端点化批）
- **不做 onboarding**：黄金路径引导 / 首次成功标记 = 第三包
- **不动 task_events 30 天清扫**（`agent-task-store.js:317-343`）：与本批无关
- **不引第二路由真相**：last-url 复用既有窗口状态 store，不新建平行持久层
- **不恢复外部 URL**：last-url 白名单只放行本地 SPA 路由，安全面 fail-closed
- **G1+ 不外推**：不触碰 packaged/Provider/GA

## 4. 执行方案

- **P0 勘察**：已完成（三子面现状 + 行号定位，见 §2）
- **P1 last-url 持久化**：窗口状态 store 加 `lastUrl`（仅记录白名单内本地路由）→ `_window-create.js` 启动读 lastUrl 命中则 loadURL 该路由，否则落 `/`；写入点=主窗导航时持久化当前本地路由
- **P2 SPA 两竞争**：红绿先行——先写复现用例（一次性消费失败不重试 / 后端未就绪归零）→ Race A 改成功后置位 + 失败重试；Race B 加退避重试（复用 welcome.tsx 姿势）
- **P3 实机验收**：CDP 双场景（reload 带 ?job= 保持 / Electron 重启恢复 last-url），证据落 acceptance/block-185/
- **P4 收口**：closeout 全链 + 五件套回写

## 5. 决策点（已裁决，留痕）

- **D1 last-url 存哪**（用户批准推荐）：复用 `_window-manager.js` 窗口位置记忆同一 store 加 `lastUrl`；安全红线=白名单本地 SPA 路由，拒任意外部 URL
- **D2 SPA 竞争修法**（用户批准推荐）：Race A 成功后置位+失败可重试；Race B 后端就绪退避重试（照 welcome.tsx:100-132 已验证姿势，不重造）
- **D3 验收判据**（用户批准推荐）：CDP 双场景（reload ?job= 保持+结果页打开 / Electron 重启恢复深链），acceptance/block-185/

## 6. 回退路径与并行隔离

- 回退：last-url 恢复异常 → 降级落 `/`（现状行为），不阻塞；退避重试超时 → 诚实空态不静默
- 并行隔离：本批触碰面=`useWorkspaceOpenEffects.ts` + `project-workspace.tsx` + `src/main/_window-create.js` + 窗口状态 store + 新探针 + 台账；当前无其他 active 包，零交叠
- 环境纪律：last-url 属主进程改动 → 实机前整栈重启（`restart-dev-stack.sh`，走 9223 测试实例）

## 7. 收口笔录（2026-10-16）

- **交付**：P1 last-url 持久化（`_main-window-state.js` 纯函数安全门 + `computeStartupLoadUrl` 三分支决策 + `_window-create.js` 接线，测试实例按设计禁用恢复护 CDP 探针）；P2 SPA 两竞争（Race B `handleOpenResult` 改用 `coldStartRetry.retryOnThrow` 退避原语、Race A 一次性消费失败清标记可重试，`handleOpenResult` 返回 `Promise<boolean>`，CenterPanel/RightPanel prop 类型随宽）。
- **验证分层（诚实边界）**：决策逻辑全进机械门——`coldStartRetry.test.ts` 6 测（抛错续跑/ok=false 即停/序号取代中止/卸载中止）+ `block185-main-window-state.test.mjs` 6 测（路由抽取/开放重定向拒绝/fs 往返/启动三分支）；CDP live 冒烟 4/4（`block185-p3-live.mjs`，主进程 loadURL 不破坏启动 + 深链端到端不崩 + reload 路由保持，`acceptance/block-185/` allPass=true，2 截图）。**未 live 验证项如实登记**：last-url 真机重启恢复（测试实例按设计禁用，恢复决策由纯函数单测覆盖）+ 后端未就绪时序竞态（需 kill 后端在就绪窗口 reload 才能确定复现，由退避原语单测覆盖）——二者留作用户真窗 spot-check，不冒充 live 已验。
- **复发缺陷转门禁**：冷启动 fetch 竞态系第三次（welcome.tsx UI-373/UI-369 同族），抽 `coldStartRetry.ts` 共享原语 + 单测，后续冷启动读路径可复用。
- **台账**：UI-455 加映行补登（55bb305 走 feat(block-185) 轨无 UI-###，LEGACY 双集豁免对账）；impact-map 登记 `block185-cold-start-deeplink`（生产文件）+ `block185-deeplink-probe`（governance 探针）；code-size 基线随 project-workspace.tsx 合法增量（+11 行）重打。
- **closeout 十三门全绿**（audit:compact/hygiene/docs/ui-audit/test:changed/code-size/arch-cycles/css-modules/secret/arch/lint/types/knip）。
- **TTFS 程序余量**：本包=①深链修复；后续 ②遥测端点化批、③onboarding 黄金路径批各独立立项待用户裁决。
