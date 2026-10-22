# 审计广播台历史归档 · through 2026-10-21

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-21（**BLOCK-223 Q9 续项垂直切片 completed**）：系统通知（回合完成/失败/等待审批；窗口聚焦抑制 + 3s 去重 + 点击聚焦）+ 托盘最小化（`closeToTray` 默认 false，关窗=隐藏）+ 退出摘要（后端 `GET /api/app/activity-summary` 五类计数 → 取消 / 最小化到托盘 / 停止并退出；守卫先于既有 `before-quit` 消费者注册）。证据=block223 9 项 + 前端 12 项 + 9223 离屏 live 16/16（亮/暗截图）+ closeout 十三门 PASS；注册表 89→91 键。reopen=模型选择器深度/电脑控制 sidecar/崩溃同意/首启揭示/通知中心/摘要逐项操作。plan=docs/block-223-q9-desktop-shell-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T05:36:14.529Z -->
最后更新：2026-10-21（**BLOCK-224 Q9 续项（D1+D2）completed**）：模型选择器深度——目录状态诚实（加载中/发现失败/缺密钥/已隐藏逐行可见）+ 每模型可见性/上下文/默认思考档；`useAiSettings` 消费 `credential_status` 并记录逐 profile 发现失败；菜单抽 `ModelMenu`、设置控件抽 `ModelSelectorControls`（SimpleChat 2136 / DesktopSettingsPanel 670，棘轮不增）。证据=前端 31/31 + 后端 3/3 + 9223 离屏 live 9/9 + lint 0 error/types 0。D4 Auto 留下一刀。plan=docs/block-224-q9-model-selector-depth-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T06:31:51.247Z -->
最后更新：2026-10-21（**BLOCK-225 Q9 D4 Auto completed**）：按任务/附件每轮解析模型（有图→vision 绑定/能力；否则 agent 绑定/tools；回落当前），`userPrefs.autoModel` 默认 false；菜单开关+解析预览、composer「自动」；`ModelChip` 抽出，SimpleChat 保持 2142 行。证据=前端 33/33 + 配置基线 4/4 + 9223 离屏 live 8/8 + types/theme/code-size PASS。reopen=复杂度分级/成本权重/审计落盘/覆盖确认。plan=docs/block-225-q9-auto-model-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T07:19:14.760Z -->
最后更新：2026-10-21（**BLOCK-226 Q9 通知中心/免打扰 completed**）：标题栏铃铛+未读徽章+通知列表（回合终态/待审批留痕）；`userPrefs.quietHours`（空=关，跨午夜）只抑制系统 toast、应用内仍记录；面板向左展开避免右缘裁切。证据=前端 62/62 + Node 13/13 + 9223 离屏 live 11/11 + theme/types/code-size PASS。reopen=点击跳转/系统历史/审批穿透/声音/类型开关。plan=docs/block-226-q9-notification-center-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T08:50:30.659Z -->
最后更新：2026-10-21（**BLOCK-227 Q9 K9 首启角色揭示 completed**）：欢迎页一次性浮层三卡（分析数据/写代码/整理知识）+ 显式「开始使用」，`userPrefs.roleRevealSeen` 落盘；读取失败不展示。证据=前端 7/7 + 配置基线 4/4 + 9223 离屏 live 7/7（亮/暗截图）+ theme/types/lint/code-size PASS。reopen=分步引导/数据导入/动画/重播/插画。plan=docs/block-227-q9-onboarding-role-reveal-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T09:48:36.377Z -->
最后更新：2026-10-21（**BLOCK-228 Q9 K2 崩溃同意/本地提示 completed**）：crashReporter 仅本地（不上传）+ session-health 异常退出检测 + dump 文件名清单 + `crashNotice`（默认 true）+ 标题栏下方横幅（打开目录/知道了）。证据=Node 7/7 + 前端 2/2 + 9223 离屏 live 5/5（亮/暗截图）+ theme/types/lint/code-size PASS。reopen=minidump 栈解析/上传/崩溃率/版本聚合。plan=docs/block-228-q9-crash-consent-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T10:34:56.028Z -->
最后更新：2026-10-21（**BLOCK-229 E7 电脑控制（Windows 边界内）completed**）：.NET 8 SDK + sidecar/axfixture 构建成功；host 只读 status + 后端 `status/probe` + 设置面板（权限提示/测试连接）；控制动作仍走 `computer_*` + 完全访问 + ackToken。证据=路由 2/2 + 面板 2/2 + 9223 离屏 live 6/6（亮/暗截图）+ types/lint/theme/code-size PASS。reopen=macOS 构建/权限、PiP、真实 click/type 端到端。plan=docs/block-229-e7-computer-use-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T10:43:48.933Z -->
最后更新：2026-10-21（**BLOCK-230 Q-DOMAIN P4 第一片 completed**）：modality 默认 `general`；pack `provides.modalities` 扩展值（归一/上限/非法 diagnostic，仅 modality 的包保留）；未知回落 general，存量不迁移。证据=Node 4/4 + REST 实机 6/6 + closeout。**不是完整 P4**：权限通用化/域中性归零/RS 保真/导出联邦基线仍 reopen。plan=docs/block-230-qdomain-p4-modality-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T11:26:42.478Z -->
最后更新：2026-10-21（**BLOCK-231 进程层后台任务看门狗 completed**）：新增便携 `dev-task-runner`（run/wait/status）——日志 + `<id>.status.json`（pid/状态/退出码）落 `.petri-dev-user-data/task-runs/`；`task:wait` 124=超时、125=runner 丢失（未知≠成功）；`npm run state` 增加运行/失败任务对账；SKILL 改为「通知是加速器、exit.json 才是真相」。证据=契约测 4/4 + npm 脚本冒烟。G0 开发期常态。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T12:09:00.285Z -->
最后更新：2026-10-21（**BLOCK-233 Q-DOMAIN P4-C S1 tool 元数据单一源 completed**）：删除 `tools-executor` 19 项标签表与 `result-files` CSV/大小白名单，改读 pack 注册表；pack 补 go-kegg/gsea + `csvValidation`/一列声明（0.2.1）；域中性 **201→179 处 / 100→85 键**。证据=红绿 5 红→14/14 + pack 死链守卫 1/1 + test:changed 460 pass/0 fail + closeout 十三门；唯一行为对齐=maftools 上限 100→200MB（随 pack 声明）。**下一片=S2 demo/artifact profiles**。plan=docs/block-233-qdomain-p4c-tool-metadata-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-21（**BLOCK-232 Q-DOMAIN P4-B 权限通用化 completed**）：`single-cell`/`spatial` 专属 gate 收敛为通用 `data` 资源权限，两键保留 legacy 别名；`/api/run` = `tools|data`；零迁移、本地 admin 零变化。证据=红绿 7 红→11/11 + REST 实机 3/3（admin 404 非 403）+ test:changed 320 pass/0 fail + closeout 十三门。实机抓真=存量 `/api/auth/me` 500 已登记 🟡；**下一包=P4-C 域中性分片**。plan=docs/block-232-qdomain-p4b-permissions-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T13:31:23.400Z -->
最后更新：2026-10-21（**BLOCK-234 P4-C S4 completed；包仍 active**）：methods Python 等价模板（8 类）+ 报告引文（13 条）下沉 pack 0.2.5；核心改为有界装载 + 占位符渲染，无包诚实降级。证据=block234 4/4 + block220 13/13 + test:changed 426 项 0 红 + closeout 十三门；域中性 **143→103 处 / 68→60 键**。**下一阶段=S5 result/RS**。plan=docs/block-234-qdomain-p4c-tail-plan.md §9。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T15:43:42.904Z -->
最后更新：2026-10-21（**BLOCK-234 P4-C S5 completed；包仍 active**）：result/RS 科学语义下沉 pack `provides.scientificProfiles`（compare/rerun/cohort/planner/selection/heavy/interpret；pack 0.2.6）；核心只留有界引擎与不变量，无包诚实降级。证据=block234 6/6 + compare/rerun/replay/changeset/selection/approval/planner 定向全绿 + test:changed 1039 项 0 红 + Jev 追加 56/56 + closeout 十三门；域中性 **103→48 处 / 60→27 键**。**下一阶段=S6 前端/桌面 + 兼容白名单**。plan=docs/block-234-qdomain-p4c-tail-plan.md §10。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T23:51:47.154Z -->
最后更新：2026-10-21（**BLOCK-235 Q-DOMAIN P4-D 立项 active**）：P4 余项收口——`dataModelExtensions` additive 扩展契约（pack 新增 artifact 类型/字段，canonical SDC-0 profile 不可覆盖）+ 导出/联邦域中性基线；域中性保持 11 处 / 6 键 compat。单工作包串行。plan=docs/block-235-qdomain-p4d-datamodel-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-21（**BLOCK-234 P4-C S6 completed；BLOCK-234 completed**）：前端/桌面 37 处领域词清零；剩余 11 处 / 6 键登记为显式兼容白名单（compat：permissions/guest/modality/schema/runtime-bundle/security-extension，每条带 category/owner/reason，门禁断言逐键一致）；pack 0.2.7 `provides.examplePrompts`；h5 家族前缀保留 h5ad 行为。证据=domain-neutrality 3/3 + block234 示例卡 3/3 + 前端 33/33 + test:changed 1238 项 0 红 + Jev 追加 67/67 + closeout 十三门 + output:judge PASS。域中性 **48→11 处 / 27→6 键**。**无 active 工作包；下一包需用户发令**。plan=docs/block-234-qdomain-p4c-tail-plan.md §11。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-22T00:39:12.015Z -->
最后更新：2026-10-21（**BLOCK-235 P4-D completed；无 active 工作包**）：`dataModelExtensions` additive 扩展契约——pack 可新增 artifact 类型/字段，扩展先过 SDC-0 校验，canonical 6 profile 不可覆盖；导出/联邦域中性基线（general 会话导出、扩展 artifact 类型 manifest 保真、联邦 grants/文件透传）落地。证据=block235 6/6 + 基线 4/4 + test:changed 443 项 0 红 + closeout 十三门 + output:judge PASS；域中性保持 11 处 / 6 键 compat。**下一包需用户发令**。plan=docs/block-235-qdomain-p4d-datamodel-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-22T01:05:52.910Z -->
最后更新：2026-10-21（**BLOCK-236 收口**）：P2b 全量 tab 迁移第一批——`resultSurfaces[].tabs` 契约 + 只读有界桥 + host 按 tab 路由与失败回落 + pack `renderTab`（0.2.1，lineage/revisions-source 两面，history 因无端点未声明）。证据=11 条单测 + 定向回归 41 文件 318 项 + types 0 + knip PASS + theme 17/17。**边界**：`test:changed` 对本批空转（树干净）、pack tab 页无实机腿、lineage 字段未实机核对。plan=docs/block-236-qdomain-p2b-full-tabs-plan.md §6。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-21（**BLOCK-236 Q-DOMAIN P2b 全量 tab 迁移立项 active（P0-LAUNCH）**）：第一批只读三面——`resultSurfaces[]` 增 `tabs` 声明（白名单 lineage/history/revisions-source）+ 只读数据桥（lineage ≤200 节点/≤400 边、history ≤100 条、源码 ≤200KB）+ `CenterPanel` 按 tab 路由（未命中一律回落核心过渡面并标注）+ pack 三面表格渲染。非范围=compare/selection/annotations/methods/export/lineage 图形态/真实 job 实机腿。plan=docs/block-236-qdomain-p2b-full-tabs-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-21（**P0 台账对账 completed**）：①UI 台账 41 条 `in_progress` 逐条给判定——5 条凭仓内证据翻 `verified`（block-61 brand-live 8 断言 / block-46 两张截图 / block-78 两卷 13+10 断言 / block-79 5 断言 / ui-481 截图），23 条只有代码与单测线索、4 条声称实机但无产物、3 条证据引用失效、6 条含「退役」语义但非本条被替代——**全部原地留 note，不越纪律升级**；②backlog 6 行 legacy planned 全部销号/改判（W7、PL-1 由包交付；BIO-2/3 由 UI 覆盖；BIO-4 已随 BLOCK-121/138 实机跑通）；③竞争力总纲 W6 改判 **partial**（CP-19 已交付，CP-16/17/18 未立项）。证据=`docs/ui-productization-audit.md` §P0 台账对账小结 + backlog 顶部对账行。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-22T01:49:27.560Z -->
最后更新：2026-10-21（**BLOCK-238 Q6 图形批注创建入口 completed；无 active 工作包**）：补齐工具条三档形状 + kind 经 session/hook/REST 落库 + draft 预览 + 列表形状标签；红绿 5 红→25/25 + 邻域 42/42 + Node 13/13 + types 0 + closeout 十三门 + output:judge PASS。UI-546 `in_progress`（无实机腿）；治理补票=先行三笔提交不改写。plan=`docs/block-238-q6-graphic-annotation-entry-plan.md` §6。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-21（**BLOCK-236 第二批收口**）：compare 只读面接管——`changeSetId` 取自 `resultEditProgress`（原「缺上下文」判断被实码推翻）+ 桥 compare 分支（files ≤200）+ 路由 `compare→compare` + pack `0.2.2` 四列比较视图。**selection 明确不迁**（写面=治理边界）。证据=类型 0 错 + `lib/workSurface`/host 41 项绿。边界=无实机腿、compare 字段未实机核对（UI-545 in_progress）。G0 开发期常态 · 不外推 packaged/Provider/GA。
