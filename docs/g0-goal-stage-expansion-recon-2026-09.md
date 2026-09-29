# G0 Goal 阶段种子拆包勘察（2026-09-29）

> **性质与去向**：本文件是五粒种子（PL-4/PL-5/PL-6/BIO-5/BIO-6）的**拆包勘察素材**，
> 供 backlog「G0 Goal 系列」排队区展开为显式子包条目时取用——**权威计划仍在
> `docs/g0-platform-goal-plan.md` / `docs/g0-bio-delivery-goal-plan.md` /
> `docs/pending-work-backlog.md`**（本文件不构成第二真相；backlog 展开完成后本文件
> 转 archived）。三路只读勘察由 UI-451~453 会话完成（2026-09-29，用户裁决「按照你
> 的推荐来」：存量展开先行）。启动序仍按两 plan §4 交织原则由用户逐个裁决。

## 一、子包总表（11 个可裁决单元）

| # | 子包 | 一句话范围 | 形态/风险 | 关键文件 | 依赖/备注 |
|---|---|---|---|---|---|
| PL-4a | tool_jobs retention 策略 | tool_jobs 纳入 retention-sweeper（终态+时间窗），级联清 job 目录，护 public demo job | BLOCK ~200-400 行 / 中 | `jobs/retention-sweeper.js`、`helpers/tools-executor.js:171`、`server.js` 装配点 | 规避三处软引用读点（specs/lineage/truth-projection） |
| PL-4b | results 治理 UI+API | 批量删除/批量导出/占用统计 + history 分页；接上已有零消费的 storage/gc、deduplicate 端点 | BLOCK / 中 | `routes/tools-platform.js`、`helpers/result-archive.js`、`CommandCenterJobsWall.tsx` | 与 4a 共用清理原语；running 竞态用 isCancellableJob 语义 |
| PL-4c | 双轨结果 UI 收敛 | 退役 `/project/:id/results` 死路由 + ResultStudioPage（JSON dump 原型面随之消除） | 小 / 低 | `App.tsx:32,71,155`、删 `ResultStudioPage.tsx` 等 | **已是事实死路由**（零导航入口），可独立先行 |
| PL-5a | result 读写与缓存卫生 | useResultStore LRU 逐出（N=5）+ 项目删除清空；result:create 等四 IPC 载荷上限 fail-closed；getByNumber SQL 下推（消 1000 行全读+正确性边角） | BLOCK 小 / 低-中 | `hooks/useResultStore.ts`、`src/ipc/result-handlers.js`、`src/database/result-db.js` | 上限只拦写入兼容存量；version 唯一索引核实 |
| PL-5b | DOM debug 剥离 | ResultArtifactShell 六个 data-debug-* 属性 DEV 门控（已确认泄入 dist） | 微 / 低 | `ResultArtifactShell.tsx:1182-1187` | 可并入 5a 成卫生批；testid 剥离=策略决策默认保留 |
| PL-6a | job 终态补偿 | stale-running 周期对账器（heartbeat 超时 + activeToolJobs 无主→failed）兜死全部滞留路径；补三处只-warn 路径；泵吞留日志 | BLOCK / 中 | `tools-executor.js:926,990,1598,610`、`active-job.js`、`server.js` | 对账器以 activeToolJobs 有无 owner 为准防误杀长跑 |
| PL-6b | 产物 URL 去 token | revision/工具产物 URL 改短期签名或 header 化（img/a 面签名）；**排除 UI-453 拖出通道**（有 guard+主进程消费，有意为之） | BLOCK / 中 | `resultStudioClient.ts:375`、`ResultArtifactShell.tsx:197-212`、revisions.js 校验 | 签名时钟一致+过期刷新 UX；吞异常清单顺带清（8 处裸吞补注释/warn） |
| BIO-5a | 表单接线与留痕闭环 | RightPanel 接 launchPrompt+workspaceFiles（**WIP 死代码点**）；审批卡/作业卡显式显示 params | 小 / 低 | `RightPanel.tsx:252-260`、`project-workspace.tsx:848`、`ApprovalCard.tsx` | **依赖 BLOCK-131 WIP 合入**；文件清单数据源复用 tree 端点 |
| BIO-5b | 上传域校验收尾 | block131 测试跑绿+400 契约集成测；findings 可操作提示 UI；expression 前缀误伤已归一化矩阵的边界对齐 artifact-profiles | 小 / 低 | `upload-domain-validation.js:23`、`tools-executor.js:1851`、`artifact-profiles.js:96` | 同样依赖 WIP 合入 |
| BIO-6a | 解读入口接线 | 结果页一键解读——**先裁决 BIO-D4**：A) Agent+result_summary 模式（收敛红线一致）vs B) 直连 /api/ai/interpret（12 模板现成） | 小 / 低 | `ResultStudioSurface.tsx:249`、`CenterPanel.tsx:179`、（B 路线）`routes/ai-legacy.js:20` | 裁决点在 g0-bio plan §5 |
| BIO-6b | result_summary 有界扩容 | MAX_ROWS 6→20-50，受 6000 字符模型投影顶约束（缩 CELL_CHARS/按显著排序取 top 或加专属投影）；截断口径同步 | 小 / 中 | `agent-tools/result-summary-tools.js:22-26,62-85`、（可选）`tool-execution.js:242-294` | 若 BIO-D4 裁「并入 Agent」则 6b 是 6a 前置 |

## 二、勘察关键发现（影响裁决的事实）

1. **PL-4c 几乎白送**：独立结果页 `/project/:id/results` 全前端零导航入口（事实死路由），
   JSON dump 原型面（`ResultStudioPage.tsx:246-251`）随退役消除；useResultStore/resultBridge
   的唯一消费方就是它——**PL-5a 的缓存卫生问题大头也挂在这个死轨上**，4c 先行可让 5a 减半。
2. **PL-6a 的滞留路径是实打实的六条**（ssh-direct 完成写失败/双层补偿断/settleSpawn/adopt/
   调度泵静默/心跳静默），现有补偿仅「重启恢复」一层——进程存活期间无任何对账。
3. **并行 WIP（BLOCK-131）有接线死点**：前端表单（AnalysisLaunchPanel ToolLaunchForm）已写好
   但 `RightPanel.tsx:252-260` 未接第二参 launchPrompt、未传 workspaceFiles——**表单当前是
   死代码状态**（属 WIP 未完待续，非缺陷；BIO-5a 即其续刀）。
4. **PL-6b 注意**：token 均为常量 desktop-local（本机单机无秘密价值），实质收益是消除
   URL 携凭据形态；**UI-453 拖出通道的 query token 是有意设计，勿连带清除**。
5. **PL-4 量级**：本机 dev 实测 tool-jobs 仅 1 job 49K——风险在重度使用的累积（inputs 副本
   + all_results.zip 双份），非当前燃眉；与 roadmap 已点名的「RS3 交互投影」高价值包相比，
   PL-4a 的紧迫性排其后。

## 三、与其它在册项的关系

- roadmap 已点名「下一个高价值包=RS3 交互投影缺口 + label 乱码 + 冷启动竞争」——
  属积压加映，不在本表（本表只覆盖五粒种子的展开）。
- 本会话另提的候选：**PL-8 路由迁移**（createBrowserRouter+useBlocker，解锁 UI-451 P2-6
  切项目脏守卫）与**文件管理深化**（树内搜索/最近打开/固定）——尚未入册，待裁决。
- OS 对话框取证 flow（os-dialog-snapshot）已于 2026-09-29 落地入库（dev-verify flows），
  服务后续所有 OS 级交互包的验收。
