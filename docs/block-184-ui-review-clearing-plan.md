---
capability: ui-productization
goal: BLOCK-184 = UI 过目清偿批——台账 in_progress 存量按「代行评估批 + 人眼最小集」分层收口翻 verified，解锁用户终审瓶颈（三方评估共识 C3：病因已从能力缺失转为确认与兑现缺失，本批即兑现批）。用户裁决「按照我们项目内部的规范 是不是应该建立plan」+「继续」（2026-10-15，批准立项文书；发令待显式确认）
acceptance:
  - P0 清点与栈前置：ui:audit:check + 台账 in_progress 全量复扫锁定清偿集合（预估 12 条：UI-457/466/467/468/469/470/471/481/482/501/503/504；UI-487 经 2026-10-15 复核已 verified 剔除，以实跑为准）；dev 栈重拉（2026-10-15 实测 3000/3001/9222 全不在听；后端 agent-ws.js 已改码，须杀 3001 PID 或整栈重启）
  - P1 代行评估批：可脚本化项 CDP 真浏览器走查（UI-466/467/468/469/470/471/481/482 等），每条产出证据包=截图+断言 JSON+可复跑探针命令，落 acceptance/block-184/；走查断言设计借鉴 ZCode testid 合同文档与「UI 清空前权威层先记录唯一去向」不变量（reference/ZCode，模式借鉴零代码拷贝，Apache-2.0 合规）
  - P2 人眼最小集（用户实机窗口）：UI-501 编排图画布节点挂载（dock 收起时序竞争无法自动化断言）/UI-503 继续分析菜单人工触发/UI-457 表单过目/UI-504 联邦双机实测段——双机环境不可用时 UI-504 按 CP-16 先例分档登记，不硬翻
  - P3 抓真修复：代行走查发现的真缺陷按 UI-496~509 代行批先例当场修复+复验（小修随批入台账；超范围的另立工作包，不扩 scope）
  - 门禁：docs:check/ui:audit:check/tsc/test:changed 全绿；台账翻转逐条留痕（in_progress→verified（代行评估）或 verified（用户过目），沿用 U-02/03/04 与 UI-496~509 先例口径）
reopen: 双机环境不可用则 UI-504 分档挂起待环境；清偿过程中新增 in_progress 项入下一批
status: completed
---

# BLOCK-184 — UI 过目清偿批（代行评估 + 人眼最小集）

- 状态：`completed`（2026-10-16 整包收口：P1 代行批 26/26+4 分档全绿、P2 人眼最小集 4 条处置完毕〔1 verified + 3 环境分档〕、closeout 十三门绿；接管 CodeBuddy 在制续跑，抓真八处全为探针侧缺陷产品码零改动；详见 §8 收口笔录）
- 用户裁决原话：「按照我们项目内部的规范 是不是应该建立plan」+「继续」（2026-10-15，批准立项文书）+ 发令口径（2026-10-15，预授权整批执行）
- 来源：2026-10-15 全方位评估（software-company 专家团架构/产品双线 + ZCode/Codex 参照精读），综合研判落 `/.workbuddy/memory/2026-10-15-expert-synthesis.md`（仓外工作记忆，不入 docs 治理）
- 关联先例：UI-496~509 代行评估批（9c34d181）/U-02/03/04 代行口径/BLOCK-181 evals harness（走查探针基建）/BLOCK-183（HEAD=1e73233f，干净树）

## 1. 立项自检（产品个性纪律问句）

「这个能力的形态与 ZCode/Codex 的差别在哪？」——本批零产品代码，形态差异在**证据自证的终审分层**：可脚本化项走 CDP 代行（证据包=截图+断言 JSON+可复跑探针，任何人可重放复核）；主观审美/双机项才进人眼最小集（4 条）。治理透明=每条翻转都有证据包可审计，不出现「口说 verified」；本地可审计=探针落 acceptance/ 仓内。ZCode 的 testid 合同与「唯一去向」不变量只作断言设计参照（模式借鉴），不长成新框架。

## 2. 范围（清偿集合，以 P0 实跑为准）

| 项 | 现状摘要 | 预期路径 |
| --- | --- | --- |
| UI-466/467/468/469/470 | BLOCK-147/148/149/150/151 系落地待实机 | P1 代行 CDP 走查 |
| UI-471 | 隧道徽标三态自探活（BLOCK-152） | P1 代行（隧道环境段如实分档） |
| UI-481/482 | 插件启停粒度/投影断连横幅（BLOCK-157/159） | P1 代行；UI-482 真机段分档 |
| UI-501 | 编排图可达性已修，画布挂载待人眼 | P2 人眼（dock 收起时序竞争） |
| UI-503 | 继续分析菜单人工触发面 | P2 人眼 |
| UI-504 | 联邦镜像（双机段） | P2 人眼/双机；无环境则分档挂起 |
| UI-457 | 表单过目（2026-10-01 遗留用户待办） | P2 人眼（或可脚本化则并 P1） |

### §2 附录：P0 冻结清偿清单（2026-10-15 实跑冻结；18:15 二次复扫确认）

- **冻结集合 12 条**（`ui:audit:check` PASS + 台账全量复扫；UI-487 复核已 verified 剔除）：
  - P1 代行 CDP 走查 8 条：UI-466 / UI-467 / UI-468 / UI-469 / UI-470 / UI-471 / UI-481 / UI-482
  - P2 人眼最小集 4 条：UI-501 / UI-503 / UI-457 / UI-504
- **台账落点确认**：UI-466~471+481/482+457 为 `## UI-XXX:` 明细节（L4557~L4711 区段）；UI-501/503/504 为「最后更新」散文条目（L7~L17）；明细表 145 verified/1 not_applicable/4 cancelled，**表格行零 in_progress**——清偿翻转落明细节与散文条目状态字样。
- **P0 环境实测（18:15 复核）**：整栈重启后 3000(vite 200)/3001(catalog=7 含 deseq2)/9222(CDP)/3005(网关) 四面全就绪；dev 库 0 tool_jobs / 0 artifact_revisions——UI-469 队位段、UI-470 artifact 面段、UI-471 隧道探活段、UI-482 断连段按 plan §6 如实分档，不硬翻。
- **P1 走查姿势（实测校准三条）**：①petri-pack-bio 经扩展页 UI 一键安装（记录制，finally 卸载复原）后**杀 3001 PID 不会重生**（backend-proc-manager 无 auto-respawn）——插件注册须走整栈重启配方 `restart-dev-stack.sh`（~2-3min，vite 长活不重启）；②右栏 tab 在收起态须经标题栏「+」（aria-label=展开更多工具）菜单打开，直按 tab 词表按钮无效；③刮擦项目与临时 git 仓走 REST 播种、finally 清理。探针=`scripts/block184-p1-live.mjs`，证据=`acceptance/block-184/`。

## 3. 执行方案

- **P0 栈与清点**：`npm run dev` 重拉（3000 Vite/3001 后端/9222 CDP；先杀 3001 PID 让 supervisor 带新码）→ `npm run ui:audit:check` + 台账复扫 → 冻结清偿集合清单（预估 12 条）写入本 plan §2 附录行。
- **P1 代行评估批**：逐条 CDP 走查（复用 scripts/ui5xx-live 系探针姿势）；证据包三件套落 `acceptance/block-184/`；抓真即修（P3）；批末台账集中翻转+本 plan §6 收口笔录。
- **P2 人眼最小集**：一次栈窗口整批过目（用户授权形态待发令时确认）；UI-504 双机段无环境则分档登记（CP-16 先例：跨机实测段分档，不阻塞其余翻转）。
- **P4 收口**：closeout 门禁全绿；AUDIT-LOG/roadmap/handoff/backlog 发令时同步登记（本批 planned 态仅 registry+README，见 §5）。

## 4. 验收判据

1. 清偿集合内每条：证据包在库（P1）或用户过目确认（P2），台账状态翻转留痕；
2. 人眼最小集 4 条处置完毕（verified 或分档登记挂起）；
3. `npm run closeout` 十一门 PASS；test:changed 全绿（存量红按 bisect 归因纪律如实归属）；
4. 抓真修复逐条有红绿/复验证据；
5. 台账净效果：in_progress 存量清零或仅剩环境依赖分档项。

## 5. 显式禁项

- **G1+ 不外推**：不触碰 Provider/公证/GA/签名/发布管线；
- **零产品代码**为默认：仅 P3 抓真小修随批；任何超出走查面的改动另立工作包；
- **不动全量台账**：只清本批集合，不批量翻其余 in_progress；不删除/改写历史台账行（搬移不改写纪律）；
- **canonical 台账写入边界**：本 planned 态只登记 DOC-REGISTRY+docs/README；AUDIT-LOG/roadmap/handoff/backlog 的广播与队列登记在**发令时**随 P0-LAUNCH 批次执行，不提前写第二真相；
- 证据纪律：禁纯静态推理翻 verified；禁把 dev 态证据冒充资格；截图/断言必须来自真浏览器实机链。

## 6. 回退路径与并行隔离

- 回退：代行走查连续失败/环境不可用 → 该条如实分档挂起，不阻塞批内其余条目；dev 栈异常 → 整栈重启（Electron 44.7.0 + better-sqlite3 Node ABI 注意事项见 BLOCK-168 恢复要点：勿 electron-rebuild）；
- 并行隔离：本批触碰面=UI 台账（追加行）+acceptance/block-184/+新探针脚本+P3 抓真小修文件；不与任何在制包交叠（当前无 active 包，槽位空闲）。

## 7. 发令条件

用户显式确认发令（建议口径：「按 plan 全按推荐执行，人眼最小集 4 条留我一次栈窗口过目」= 预授权整批 + 终审窗口一次性集中，沿用四批次预授权先例）。

## 8. P1 代行批收口笔录（2026-10-15）

- **结果**：`scripts/block184-p1-live.mjs` 第十一轮 **26/26 断言全绿 + 4 条 env 段如实分档**（`acceptance/block-184/block184-p1-live.json` allPass=true，截图 12 张）；P1 八条台账翻转：UI-466/467/468/469/470/481/482 → **verified（代行评估）**，UI-471（含 UI-468 加映）probe 端到端段无隧道环境**分档挂起**（plan §6 回退路径，不硬翻）。
- **接管说明**：CodeBuddy 会话首/二轮后由主代理接管续跑（用户裁决「能停掉 你来进行吗」）；接管面=只杀其探针进程（42216/45312），dev 栈与未提交资产保留。
- **抓真八处全部为探针侧缺陷，产品代码零改动（plan §5 零产品代码默认成立）**：①A 段起手态假设未安装→状态自适应；②Z 段卸载判据等确认弹层——dev 投影桥无 `uninstallPlan` 通道走退化直接卸载→改 `/api/packs/installed` API 权威核验；③finally `cdp` 作用域 ReferenceError 致清理链静默断裂；④E/G 段选择器加固（联邦弹层 toggle 反关/指挥中心双判据）；⑤Electron CDP `Target.createTarget` 页面级+浏览器级均 -32000 不支持→H 段改 9223 测试实例原地导航；⑥`clickByText` 全局文本匹配先命中 composer 快捷动作钮（「分析单细胞数据…」）致分析 tab 未开→`openRightTab` 限定 `#titlebar-tool-menu` 容器；⑦deseq2 卡定位按 `li.textContent` 误命中 deg-standardizer（描述合法提及「将 DESeq2…」）→改卡标题锚定；⑧tree 递归三重界（`TREE_RECURSIVE_MAX_DEPTH=3` root=0，500 窗先根层）致「截断提示」与「子目录可达」互斥→拆双刮擦工作区（小=消歧+demo，大=520 根文件触截断）。
- **环境复原**：批末整栈重启使 pack 卸载的后端注销生效（catalog 注销核验见收尾门禁段）；pack 起手态=未安装（与 P0 冻结时一致）。
- **余量→已处置**：P2 人眼最小集 4 条——UI-457 翻 **verified（代行评估）**（P1 截图等价人眼过目，全要素在场）；UI-501/503/504 按 plan §6 **分档挂起**（分别需真窗 spawn 视觉确认/artifact 数据/双机环境，不硬翻）。**冻结集合 12 条全闭环**（8 verified + 1 verified(P2代行) + 3 环境分档），台账 in_progress 存量仅剩环境依赖分档项。
