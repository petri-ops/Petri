---
capability: q6-rem
goal: 把母纲 §6.5 第 9 行 Q6-REM 的七项余项逐项与现有批注契约（result-annotation-contracts / 015 迁移 / store / 路由 / 前端镜像）及工具面（agent-tools、pack 桥、Office 预览、速记板、选区动作条）对账，判定哪些项在不引入未定义依赖、不破坏既有契约的前提下可独立闭环，哪些需补前置、哪些阻塞；据此产出可串行执行的阶段计划与销项清单。
acceptance:
  - 对账矩阵覆盖母纲 §6.5 第 9 行全部七项，每项给出「现状证据（文件:行）→ 契约对应 → 工具面对应 → 可验证性 → 依赖完整性 → 分档结论」，不得以计划文本代替实码核对。
  - 分档四类可复核：A 可安全闭环 / B 需补前置 / C 阻塞 / D 已兑现销项；每项判定依据与阻断因素分开写，不得把「没做」写成「阻塞」。
  - 前置条件写成可验收的判据（谁改、改什么、怎么证明），不写「需要进一步设计」这类空转措辞。
  - 未提交 WIP（5 文件）如实登记为跨切面阻断，明确「不动、不覆盖、不代提交」；其造成的红测以实测输出为证。
  - 销项两处必须回写母纲 §6.5 与 UI 台账口径（C13 速记板本体、UI-546 实机腿），不得只在本包内声明。
  - 收口时 `npm run docs:check`、`npm run ui:audit:check` 绿；实现阶段另需定向测试 + 隔离 9223 实机腿（截图不可得按 `unavailable` 如实标注）。
reopen: 画笔（freehand）几何契约 v2；pack iframe 批注窄桥（待契约冻结 + 安全边界评审）；马赛克真脱敏/导出遮蔽；撤销重做跨会话；速记条目删除时批注级联清理（当前为孤儿行）；文本/段落/行锚点随文档改动的失效检测（段落序号与表格行序都会漂移）；iWork 容器批注（无可锚文本）；Office 版面级渲染（新依赖须先过依赖检查单）；速记板跨设备同步；G1+。
status: completed
---

# BLOCK-254 · Q6-REM 余项对账与闭环判定

用户发令：「明确项目当前范围后，下一步启动 Q6-REM。首先系统核对母纲中所有未完成项与现有批注契约及工具面之间的对应关系……据此判定哪些剩余项具备安全闭环条件……按可行性分类汇总。」（2026-10-24）

本包当前阶段 = **completed**（P0 对账 + P1–P8 全部交付，证据见 §9）；C 档（画笔、pack iframe 桥）与三项 reopen 见 frontmatter，另立契约包处理。

## 0. 当前范围与前置状态（2026-10-24 实测）

| 项 | 事实 | 来源 |
| --- | --- | --- |
| 阶段 | G0 长期开发期；`qualificationEligible: false` 是常态事实 | `AGENTS.md` §当前阶段纪律 |
| 分支 | `main`，领先 `origin/main` 31 笔（不推送） | `git status --short --branch` |
| active 工作包 | 无（BLOCK-253 已 `completed`） | `docs/AUDIT-LOG.md` / handoff |
| 母纲队列 | §6.5 第 8 行 Q5-REM `partial completed`；第 9 行 Q6-REM 待开工 | `docs/qoder-essence-absorption-plan.md:675-695` |
| **未提交 WIP** | **5 文件**：`core/shared-backend/result-annotation-contracts.js`、`frontend/src/lib/annotations.ts`、`components/annotations/{AnnotationBar.tsx, AnnotationOverlay.tsx, AnnotationOverlay.module.css}` —— CSS 注释自称 `BLOCK-254 Q6-REM`，但**仓内无对应 plan/registry/台账** | `git diff --stat` |
| WIP 后果 | `node --test test/block219-result-annotations.test.mjs` **实测红**（`ANNOTATION_KINDS` 期望三元组，实际五元组） | 本会话实测输出 |

**WIP 处置纪律**：该 WIP 视为「已在树上的起点」，本包**不覆盖、不回滚、不代提交**。它把 `text` / `mosaic` 两个 kind 加进了契约白名单与渲染层，但未同步测试、未定义语义（见 §3 B-1）、未登记。P1 第一步即处置该红测（补断言而非删断言）。

## 1. 对账方法与口径

- **母纲余项来源**：`docs/qoder-essence-absorption-plan.md` §6.5 第 9 行（2026-10-22 对账版）。
- **契约面**：`core/shared-backend/result-annotation-contracts.js`（词汇/上限/归一化单一源）→ `src/migrations/015_result_annotations.sql`（列形状）→ `result-annotation-store.js`（读写唯一入口）→ `core/petri-server/routes/result-studio/annotations.js`（REST）→ `frontend/src/lib/annotations.ts`（镜像 + prompt 构造）。
- **工具面**：`agent-tools/tool-defs/*`（Agent 可见 schema）+ `tool-metadata.js`（readOnly/风险档）、`PackSurfaceFrame.tsx`（pack 桥四型消息）、`office-file-preview.ts` + `OfficePreviewPane.tsx`（Office 渲染形态）、`ScratchpadPanel.tsx`（速记面）、`SimpleChat/selectionActions.ts`（选区动作条）。
- **可验证性口径**：能写「确定性断言 + 可复跑命令」才算可验证；只能靠人工观感的一律降档并在 §4 写明。
- **分档定义**：
  - **A 可安全闭环** = 零新依赖、零迁移（或纯加性枚举）、契约语义不变、既有测试可保持绿（补断言即可）。
  - **B 需补前置** = 可做，但必须先落一条可验收的前置（契约维度、语义声明或 scope 扩展），否则做出来是不诚实或不可验证的功能。
  - **C 阻塞** = 前置本身是契约版本升级或新安全边界，属独立工作包，不塞进本包。
  - **D 销项** = 母纲文本已过时，实物已完成，动作只是回写。

## 2. 逐项对账矩阵

| # | 母纲余项 | 实码现状（证据） | 契约对应 | 工具面对应 | 可验证性 | 依赖完整性 | 分档 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | E5 **文字**（图形文字框） | WIP 已加 `text`：契约 `ANNOTATION_KINDS`、前端镜像 `:18-29`、`AnnotationBar.tsx:151-152` 提示、`AnnotationOverlay.tsx:128-130` 渲染 `textContent`、CSS `:139-142` | 枚举加值；015 `kind TEXT NOT NULL DEFAULT 'region'` 已容纳；`comment` 必填天然等价于文本正文 | kind 经 `useAnnotationSession` → `useArtifactAnnotations` → client → REST 通路 BLOCK-238 已贯通，工具条按常量 `map` 自动出现 | 可：契约测（kind 接受）+ 组件测（渲染/列表标签）+ 实机（选文本→拖框→存→见） | **完整**（仅缺测试与锚点文案） | **A** |
| 2 | E5 **马赛克** | WIP 已加 `mosaic`：CSS `:144-147` 用 `backdrop-filter: blur(8px)` + `color-mix` 底色 | 同上，零迁移 | 同上；但**无降级路径**（不支持时不提示） | 弱：只能断言 `data-kind` 与计算样式，无法像素级断言「已遮蔽」 | **语义缺失**：未定义遮蔽边界（屏显？导出？Agent？），未声明即构成虚假脱敏承诺 | **B** |
| 3 | E5 **画笔**（freehand） | 零实现；`AnnotationOverlay.tsx:69-95` 只产 rect；`annotations.ts:98-110` 只回四元组 | **不兼容**：`rect_json TEXT NOT NULL`、`normalizeAnnotationRect` 强制四元、`MIN_ANNOTATION_SIDE` 双侧约束；点序列无处存 | 无（无绘制器、无简化器、无命中测试） | 可（有几何即可测） | **缺契约前置**：需 `points/path` 字段 + 采样/简化 + 越界策略 + 与 rect 互斥规则 → `ANNOTATION_CONTRACT_VERSION` 升 2 | **C** |
| 4 | E5 **撤销重做** | 零实现；`store.deleteById` 是硬 `DELETE`（`result-annotation-store.js:160-164`），无软删、无操作史 | 无需改表即可做「创建撤销」（pending 取消已有 `cancelPending`） | 无 undo 栈 | 可（交互断言） | **语义缺失**：撤销范围（本轮/近 N 次/跨会话）、删除撤销的补偿形态（re-create 新 id 还是软删）未定；选软删即需迁移 | **B** |
| 5 | **文本选中批注** | 生产者**已就绪**：`selectionActions.ts:74-78` 「批注」可见但 `disabled: true` + `TEXT_ANNOTATION_UNAVAILABLE_REASON`；`SelectionQuoteDetail` 带 path/startLine/endLine/text | **表达能力缺口**：批注只有 `rect` + `page`；无行号锚点列；`normalizeAnnotationRect` 使无 rect 的文本锚点无法入库 | 消费面已有（composer 引用 / 速记）；渲染面缺「行内高亮 + 列表」形态（现只有覆盖层） | 可（锚点存取 + 命中 + prompt 文本） | **缺契约前置**：`rect` 在文本锚点 kind 下可空 + 锚点列（或复用 `file_path` + 行号）→ 需迁移 018 或 `rect_json='[]'` 策略；且须与 #1 的 `text` 语义分开命名 | **B** |
| 6 | **C13 速记板**（母纲写「与 Q2 合并」） | **本体已交付**：BLOCK-246 P1（迁移 016 + `scratchpad-store.js` + `routes/scratchpad.js` + `ScratchpadPanel` + 唯一 ContextItem 通道 + 来源会话/文件），实机 19/19 | 已落 016 | 已落 composer 面板 + 引用 | 已验 | — | **D（销项）** |
| 7 | **C13 速记板图片批注** | `ScratchpadPanel.tsx:147-149` 只渲染 `<img>` 缩略图；无大图、无批注宿主 | **归属缺口**：`ANNOTATION_SURFACES` 只有 `result-artifact / workspace-file`；速记条目无 scope 表达 | 需可打开大图 + 复用 `AnnotatableImagePane` 的宿主形态 | 可 | **缺 scope 前置**：新增 surface（如 `scratchpad-entry`）+ `annotationScopeOf` 分支 + 上限计数口径，否则批注无法归属 | **B** |
| 8 | **PPTX/DOCX/XLSX 批注** | 预览**已存在**：`office-file-preview.ts` 抽 docx 段落文本 / xlsx 首表 80 行 / pptx slide 文本；`OfficePreviewPane.tsx` 渲染文本流与表格；`AnnotationBar.tsx:75-82` 在这些面诚实显示不支持原因 | **语义不匹配**：现有渲染无版面几何，rect 落点随容器宽度漂移，同一 docx 两种宽度不可复现 | 无批注入口（诚实降级已成立） | 可（若走文本锚点） | **依赖 #5**：文本锚点契约落地后可锚「段落序号 / 行·列」；走版式渲染则需新依赖（须过依赖检查单，默认不加） | **B** |
| 9 | **pack iframe 批注窄桥** | 桥只有四型：下行 `petri:surface-context` / `petri:ui-action`，上行 `petri:ready` / `petri:ui-action-result`（`PackSurfaceFrame.tsx:69-154`）；`petri-pack://<packId>` 独立 origin + sandbox | 无批注消息类型；坐标语义归属未定（pack 容器 DOM？宿主叠加层？） | 无 | 可（契约测 + 夹具 pack 实机） | **缺两项前置**：① 批注 kind/几何契约冻结（#1/#2/#3/#5 都会改）；② 写权限边界（pack 能写哪些 scope、是否需要 `pack.json` 能力声明） | **C** |
| 10 | **Agent 批注读取工具** | **零实现**；批注进上下文的唯一通道是 `buildAnnotationTaskPrompt` → `copilotAsk`（用户显式「加入任务」） | 读面已就绪：`listByScope` / `countByScope` / 项目隔离 | 落点明确：`agent-tools/tool-defs/<域>.js` 加 schema + `tool-metadata.js` 标 readOnly/R1 + 执行读 store | 可：Node 契约测（scope 隔离/上限/脱敏）+ 只读档位断言 | **完整**（零 UI 依赖、零迁移、零新依赖） | **A** |
| 11 | **UI-546 实机腿** | **已完成**：BLOCK-252（2026-10-24）亮/暗各 23/23，`acceptance/ui-546/`，UI-546 `verified`；ellipse/arrow 创建/保存/列表/REST 全绿 | — | — | 已验 | — | **D（销项）** |

## 3. 分档汇总

### A 档 · 可安全闭环（3 项）

| 编号 | 项 | 闭环形态 | 判定依据 |
| --- | --- | --- | --- |
| A-1 | E5 文字（`text`） | 收编现有 WIP：补 kinds 断言 + text 专项（渲染/落库/列表标签/锚点文案）+ 实机一条 | 枚举加性、015 列已容纳、创建通路 BLOCK-238 已贯通；唯一缺口是测试与文案 |
| A-2 | Agent 批注读取工具 | 新增只读工具（`readOnlyHint`/R1），按 projectId + surface scope 读，有界返回 | store/路由/契约全就绪，无 UI 依赖；风险面只有「只读边界」与「上限」 |
| A-3 | UI-546 销项 | 母纲 §6.5 与 UI 台账口径回写（不写代码） | 证据已入库且 `verified` |

### B 档 · 需补前置（5 项）

| 编号 | 项 | 前置（可验收判据） | 阻断因素 |
| --- | --- | --- | --- |
| B-1 | E5 马赛克（`mosaic`） | **已落地（P3）**：单一措辞源 `MOSAIC_DISCLOSURE` + `mosaicTaskNote(n)`；三处消费（hint / overlay title / prompt 尾部，仅在有马赛克时） | 前置已清：遮蔽边界声明写死 + 能力缺失可见降级 + 反向措辞守卫；剩余仅实机视觉取证（P8） |
| B-2 | 撤销重做 | **已落地（P4）**：`MAX_ANNOTATION_UNDO=10` + `appendUndoAction` 有界栈，只做「本次会话 + 当前 scope + 最近 10 次创建/删除」；删除的补偿是**按原内容重建（新 annotationId）**，`undoActionLabel` 如实写明「重建为新条目」；**redo 明确非范围**（不对称补偿上做 redo 会形成 id 漂移链），并有反向守卫测试阻止导出 redo 面 | 前置已清：边界写死在 lib 单一源 + 交互测试；不引入软删列 / 零迁移 |
| B-3 | 文本选中批注 | **已落地（P5）**：新 kind `text-selection` + `anchor{kind:'text-range',startLine,endLine,startColumn,endColumn,quote,language}`，与 `rect` **契约级互斥**（文本锚点不收 rect/page、区域批注不收 anchor；锚点只允许 `workspace-file`）；迁移 **018** 只加一列 `anchor_json`（015 建表语句逐字节不变）；前端选区动作条「批注」按「有路径+有行号+有出口」解禁，无行号视图保持可见但禁用并给出具体理由 | 前置已清：契约/store/迁移/前端镜像/选区锚点/工具条 text 模式/文件预览接线全通；**不做行内高亮**（v1 只做列表 + 行号定位，见 §9 诚实边界） |
| B-4 | 速记板图片批注 | **已落地（P6）**：新 surface `scratchpad-entry` + `entryId` 身份（与 filePath/artifactId/revisionId 契约级互斥），`annotationScopeOf` 新增分支，上限沿用同一 `MAX_ANNOTATIONS_PER_SCOPE`；迁移 **019** 只加 `entry_id`；速记面板缩略图改为可打开大图并复用 `AnnotatableImagePane`（同一条批注通道），条目与宿主都无项目时如实禁用并说明 | 前置已清：surface/scope/迁移/路由/工具/面板全通；实机证据留 P8 |
| B-5 | Office 批注 | **已落地（P7）**：复用 P5 锚点并加**单位**维度（`unit: line/paragraph/row`，缺省 line）——docx/pptx/odt/odp 锚段落序号、xlsx/ods 锚表格行号；`OfficePreviewPane` 按段落渲染并给「批注」按钮、表格行首给行批注按钮；宽度/窗口变化不影响复现（序号与排版无关）；**不引入任何版式渲染依赖** | 前置已清：契约加性字段 + 会话/条/提示全通；iWork 清单形态与「段落序号随文档改写漂移」留 reopen |

### C 档 · 阻塞（2 项，本包不做）

| 编号 | 项 | 阻断实质 | 建议方向 |
| --- | --- | --- | --- |
| C-1 | E5 画笔（freehand） | rect-only 几何契约无法表达点序列；需 `ANNOTATION_CONTRACT_VERSION` 升 2 + 采样/简化/越界策略 + 与 rect 互斥规则，属独立契约包 | 单列 `Q6-ANNOTATION-CONTRACT-V2` 候选，先定几何再谈画笔 |
| C-2 | pack iframe 批注窄桥 | 契约未冻结 + 坐标语义归属未定 + 需新写权限边界（pack 不能任意写 scope） | 待 #1/#2/#3/#5 全落定后开桥；届时必须补 `pack.json` 能力声明与宿主侧校验 |

### D 档 · 销项（2 项）

- **C13 速记板本体**：母纲「与 Q2 合并」已由 BLOCK-246 兑现（实机 19/19）。
- **UI-546 实机腿**：已由 BLOCK-252 完成并 `verified`。

> 说明：母纲 §6.5 第 9 行把这两项与未完成项并列，属**台账滞后**而非功能缺口。回写口径见 §6。

## 4. 跨切面阻断与约束

| 编号 | 约束 | 影响 | 处置 |
| --- | --- | --- | --- |
| G-1 | 未提交 WIP 使 `test/block219-result-annotations.test.mjs:342` 红（实测） | 任何阶段都不能宣称「绿基线」；closeout 会红 | P1 首步：补 kinds 五元组断言 + 新增「`mosaic` 被接受」用例 + 保留未知 kind 拒绝用例；**不删断言、不回滚 WIP** |
| G-2 | 离屏截图在部分 flow 超时（BLOCK-253 已记录） | 视觉证据可能 `unavailable` | 实机腿预置降级规则：断言 JSON 为主证据，截图缺失如实标注，不伪造 |
| G-3 | 马赛克无法像素级证明「已脱敏」 | 验收措辞风险 | 验收只认「屏显形态 + 明确声明」，禁止写「已脱敏 / 已遮蔽敏感信息」 |
| G-4 | 批注契约即将被 #1/#2/#5 修改 | pack 桥与画笔若提前开工会返工 | C 档两项在本包内不动，避免二次改契约 |

## 5. 阶段计划（P1 起，串行）

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P0 对账** | 本文件 §0–§6 | 本文件落地 + registry/README/roadmap/handoff/AUDIT-LOG 登记 |
| **P1** | G-1 红测处置 + A-1 文字收编（测试/文案/实机） | `block219` 契约测全绿；text 专项断言；实机一条（选文本→存→列表「文本」） |
| **P2** | A-2 Agent 批注读取工具 | Node 契约测（scope 隔离/上限/只读档位）+ 工具计数回归 |
| **P3** | B-1 马赛克语义 + 降级 | 遮蔽边界声明落地；降级分支测试；文案断言 |
| **P4** | B-2 撤销重做（会话内补偿栈） | 边界写死 + 交互测试（创建撤销/删除撤销） |
| **P5** | B-3 文本锚点契约 + 文本选中批注 | 契约测（锚点 kind 无 rect 可入）+ 行内高亮渲染 + 选区动作条「批注」解禁 |
| **P6** | B-4 速记板图片批注 | 新 surface scope 测试 + 大图批注实机 |
| **P7** | B-5 Office 锚点批注（依赖 P5） | 段落/行列锚点测试；宽度变化不影响复现 |
| **P8** | 实机腿汇总 + closeout 十三门 + canonical 回写 | 亮/暗实机全绿（或截图 unavailable 如实）；十三门 PASS |

**C 档（画笔 / pack 桥）不在本包阶段内**：写入 `reopen` 与 §6 候选，不占 P 阶段。

> **执行记录（2026-10-24/25）**：P1–P7 与 **P8（实机腿 + closeout 十三门 + canonical 回写）全部完成**，证据见 §9；本包 **completed**。B 档五项全部闭环，C 档（画笔、pack 桥）留 `reopen` 另立契约包。

## 6. 母纲与台账回写口径

1. §6.5 第 9 行改为：`Q6-REM（active · BLOCK-254）`——已销项=F1 C13 速记板本体、F2 UI-546 实机腿；A 档=文字 / Agent 读取工具；B 档=马赛克语义 / 撤销 / 文本锚点 / 速记图片批注 / Office 锚点；C 档=画笔 / pack 桥（另立契约包）。
2. UI 台账：本包产生的界面改动逐条登记（文字批注已落 `UI-546` 语义外延，另开条目记 `text`/`mosaic`；实机未跑前一律 `in_progress`）。
3. `docs/next-steps-roadmap.md` 与 `docs/project-workspace-handoff.md` 只写「active=BLOCK-254 / 当前阶段=P0 完成、P1 待开工」，不复述分档明细（明细以本文件为唯一源）。

## 7. 非范围

- 画笔几何契约 v2、pack iframe 批注窄桥（C 档，另包）。
- 马赛克真脱敏/导出遮蔽、批注合成图导出。
- 撤销重做跨会话、批注版本历史。
- Office 版面级渲染（引入新依赖须先过 `DEPENDENCY-CHANGE-CHECKLIST`，默认不加）。
- 速记板跨设备同步、i18n。
- G1+（Provider / 公证 / packaged 发布）一律不提不做。

## 8. 完成语义

- `completed` = A 档全闭环 + B 档前置全部落地且实现完成 + 实机腿（或如实 `unavailable`）+ closeout 十三门 PASS + 母纲/台账回写。
- `partial` = A 档闭环、B 档部分落地：必须逐项写明哪项没做、为什么，不得用「后续推进」掩盖。
- 本包**不因 C 档未做而阻塞收口**：C 档属独立契约包，收口时如实列入 `reopen` 即可。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. 执行记录

### P1（2026-10-24）— G-1 清红测 + A-1 文字批注收编

| 项 | 交付 |
| --- | --- |
| G-1 | `test/block219-result-annotations.test.mjs` 的 kinds 断言由三元组改五元组，未知 kind 用例改用 `freehand`（画笔仍是明确拒绝值，不能靠加枚举混入）；**未删断言** |
| A-1 契约 | 新增 `BLOCK-254 A-1 — 文字/马赛克批注经 store 落库并按 kind 回读（零迁移）`：走真实 SQLite store，断言两种 kind 落库/回读/共享 scope 上限计数 |
| A-1 前端 | `AnnotationOverlay.test.tsx` 增「文字正文渲染在框内、马赛克不把说明画在遮挡区」；`AnnotationBar.test.tsx` 增五档选择 + 列表标签；`annotations.test.ts` 增 kinds 契约镜像与缺省回落 |
| A-1 文案 | `AnnotationBar` comment 输入 placeholder 按 kind 分支：文字=「要显示在框内的文字」、马赛克=「仅屏显模糊，不会修改原图」——把遮蔽边界写进用户可见文案 |
| 顺带清偿 | `AnnotationOverlay.module.css` 的 `font-size: 11px` 是裸 px，踩中主题 token 契约棘轮 → 改 `var(--petri-font-size-sm)`；该文件 1 处小字号按先例（UI-523 RunStatsBar）登记进 `RATCHET` 并注明「图内注释，非正文性小字」 |

**证据**：`node --test test/block219-result-annotations.test.mjs` **14/14**；前端 `annotations` 13 + `AnnotationBar` 10 + `AnnotationOverlay` 8 = **31/31**；`theme-token-contract` **17/17**；`quality:types` 0。

### P2（2026-10-24）— A-2 Agent 批注读取工具

| 项 | 交付 |
| --- | --- |
| 实现 | 新 `core/petri-server/agent-tools/result-annotation-tools.js`：只读、有界（≤20 条 / 硬顶 50 / 单条评论 400 字 / 总预算 6000）、最近优先、projectId 必填 fail-closed |
| 接线 | `tool-defs/session.js` schema（`projectId` 必填）+ `tool-metadata.js`（readOnly / low / 无需审批）+ `registry.js` handler 与 `contract('analysis','none','R1',['project.database'],500)` + `tool-events.js` 活动标签 + fixture 与前端动词/图标注册表 |
| 计数回归 | 静态工具总数 84 → **85**（`agent-tool-registry` / `block116` / `block157` / `tool-activity-labels` 四处同步并注明 BLOCK-254 +1） |
| 测试 | 新 `test/block254-result-annotations-tool.test.mjs` **8/8**：缺 projectId 拒绝 / scope 校验 / 最近优先与截断 / limit 硬顶与非法值 / 空 scope 诚实态 / 锚点坐标渲染 / 真实 store 跨 project·跨 revision 隔离 / 注册面（schema + readOnly + sideEffect=none） |

**诚实边界**：工具只返回批注旁路元数据（形状/页/百分比/评论），**不含** artifact id、绝对路径或原始像素；prompt 里仍声明「原始产物未被修改」，与「加入任务」通道同一口径。

### P3（2026-10-24）— B-1 马赛克遮蔽边界

| 判据 | 落地形态 |
| --- | --- |
| ① 仅屏显 | 单一措辞源 `MOSAIC_DISCLOSURE`（`frontend/src/lib/annotations.ts`）：固定写「只是屏显遮蔽，不是脱敏；原图与产物文件不会被修改」，四处消费——工具条 hint、覆盖层 `title`、`buildAnnotationTaskPrompt` 尾部声明、comment 输入 placeholder |
| ② 能力缺失可见降级 | `supportsBackdropFilter(probe?)` 可注入探测（前缀实现也算支持、探测抛错回落 false）；`AnnotationBar` 一次 `useMemo` 探测，不支持时 hint 改「当前环境不支持模糊，将改用不透明色块（仍仅屏显，不是脱敏）」并带 `data-mosaic-fallback="true"`；CSS 侧 `@supports not ((backdrop-filter…) or (-webkit-…))` 退化为 `--petri-bg-elevated` 不透明色块 + 虚线边框，**不静默失效** |
| ③ 加入任务不得暗示脱敏 | `buildAnnotationTaskPrompt` 仅在批注集**真有马赛克**时追加 `mosaicTaskNote(n)`（「其中 n 条为「马赛克」标记：…请勿把遮蔽区域当作已移除的敏感信息」）；无马赛克零噪声。反向守卫断言声明里不得出现「已脱敏 / 已打码 / 已遮蔽敏感 / 已移除」 |

**证据**：`annotations` **17/17**（新增 4 条：措辞反向守卫、note 带条数、prompt 有/无马赛克两态、能力探测四态）× `AnnotationBar` **11/11**（新增能力双分支）× `AnnotationOverlay` **8/8**（`title` 含边界声明）= **36/36**；`theme-token-contract` **17/17**（CSS 只新增 token 引用）；`quality:types` 0；`test:changed` EXIT=0（Node 955/949/0 fail + 前端 36 文件）。

**诚实边界**：`@supports` 降级分支与真 Chromium 视觉双形态**未做实机取证**——CSS 分支由主题契约 + 组件测覆盖，视觉证据留给 P8 实机腿；因此 UI-562 仍 `in_progress`，不升 `verified`。

### P4（2026-10-24）— B-2 撤销边界

**边界（写进代码而非注释，可被测试钉住）**

| 维度 | 判定 | 落点 |
| --- | --- | --- |
| 生命周期 | 仅本次会话内存栈，刷新/重挂即失效 | `useAnnotationSession` 的 `undoState`，不落库、不加列 |
| scope | 仅当前 scope；identity 一变视为空栈（同 pending 纪律，不靠 effect 清空） | `UndoSnapshot.identity` 与 `identity` 比对 |
| 深度 | 最近 10 次（`MAX_ANNOTATION_UNDO`），最旧的补偿被丢弃 | `appendUndoAction` 纯函数（非法上限回落默认） |
| 动作 | 只有 `created` / `deleted` 两类 | `AnnotationUndoAction` |
| 删除补偿 | **按原内容重建，生成新 annotationId**；按钮 title 如实写「重建为新条目」 | `undo()` 调 `store.add(...)` |
| redo | **非范围**：不对称补偿上做 redo 会形成 id 漂移链 | 反向守卫测试断言模块不导出任何 `redo` 面 |
| 入栈纪律 | 补偿动作本身不入栈（撤销删除后不能再撤销同一动作） | `undo()` 内部直调 store，不经 `remove`/`submitComment` |

**证据**：`annotations` **21/21**（新增 4 条：有界截断、非法上限回落、文案区分、无 redo 导出）× `AnnotationBar` **12/12**（栈空不渲染 / title 说明 / 点击回传）× `AnnotatableImagePane` **4/4**（新增 2 条端到端：保存→撤销发 `DELETE /annotations/<id>` 并清按钮；删除→撤销发 `POST` 且 payload 的 rect/comment/kind/color 与原一致、撤销后不再可撤销）= 批注邻域 **45/45**；`quality:types` 0；`quality:lint` 0 error；`test:changed` EXIT=0（Node 955/949/0 fail + 前端 36 文件）。

**诚实边界**：撤销栈是**前端补偿**，不是服务端事务——若撤销删除的 `POST` 失败，原批注不会自动回到列表（错误经既有 `error` 通道如实展示，用户可重试）；跨会话/跨设备撤销不存在。实机腿仍留 P8。

### P5（2026-10-24）— B-3 文本锚点契约 + 文本选中批注

**契约（互斥是硬约束，不靠调用方自觉）**

| 维度 | 判定 |
| --- | --- |
| 新 kind | `text-selection`（与图形 `text` 分开：一个锚在行范围，一个画在图上的文字框） |
| 锚点形状 | `{kind:'text-range', startLine, endLine, startColumn?, endColumn?, quote, language?}` |
| 互斥 | 文本锚点**不收** `rect` / `page`；区域批注**不收** `anchor`；任一越界即 `rect_unexpected` / `anchor_unexpected` / `page_unexpected` |
| 面约束 | 锚点只允许 `surface='workspace-file'`（结果产物是图像/PDF，没有文本行）→ `anchor_surface_invalid` |
| 有界 | 行号 1..1e6、列 0..1e5、`quote` ≤500 字、`language` ≤40 字；endLine ≥ startLine、同行 endColumn ≥ startColumn |
| 存储 | 迁移 **018** 只 `ALTER TABLE ... ADD COLUMN anchor_json TEXT`；015 建表语句**逐字节不变**；文本批注 `rect_json='[]'`，区域批注 `anchor_json IS NULL` |
| 读取 | `parseRect` 对 `'[]'` 返回空数组（不伪造 0×0 框）；坏 `anchor_json` 按「无锚点」降级，不让脏行毁整页列表 |

**前端**

- `TextAnchor` 类型镜像 + `ArtifactAnnotation.anchor` + `rect: number[]`（可为空）。
- `describeAnnotationAnchor` 优先报行号：单行「第 12 行」、区间「第 12–15 行」。
- `buildAnnotationTaskPrompt` 对锚点批注报行号，**不编造 `(0%,0%,0%×0%)`**。
- `selectionAnchor(text, source)`：无行号返回 `null`（不伪造 `startLine: 1`）；`quote` 按 500 字截断。
- `buildSelectionActions({ charCount, annotate })`：批注按「有路径 + 有行号 + 宿主有出口」解禁；不可用时用**具体理由**（缺路径 / 该视图无行号 / 该面不支持），不再是一句笼统的「暂不支持」。
- `AnnotationBar mode='text'`：不渲染绘制开关/形状/颜色，只留列表 + 撤销 + 加入任务 + 评论输入。
- `WorkspaceFilePreview`：文本族（text / json / markdown）挂 `ConnectedAnnotationBar mode="text"` + 同一个 `useAnnotationSession`（scope = workspace-file）；图片/PDF 面零改动，避免同 scope 被拉两次。

**证据**：`block219` **17/17**（新增 018 逐字节、锚点六类拒绝、store 往返 rect=[]/anchor 完整/与区域批注共存同一 scope）× 前端 `annotations` **23** + `AnnotationBar` **13** + `selectionActions` **12** + `WorkspaceFilePreview.textAnnotation` **1** + `AnnotatableImagePane` 4 + `AnnotationOverlay` 8；`quality:types` 0；`quality:lint` 0 error；`test:changed` EXIT=0（Node **1042** / 1032 pass / 0 fail，前端 **53** 文件全绿）。

**诚实边界**：
- **不做行内高亮**：v1 交付的是「选区 → 锚点 → 列表按行号显示 → 加入任务」，没有在正文里画高亮条；定位仍靠行号文字，不假装能做到像素级联动。
- Markdown **预览态**没有行号 → 批注按钮保持可见但禁用并说明「请切换到代码视图」；切到编辑态即可用。
- 锚点**不校验文件是否被改过**：文件内容变了行号可能漂移，`quote` 仅存原文供人核对，不在本阶段做失效检测（留 reopen）。

### P6（2026-10-24）— B-4 速记板图片批注

| 维度 | 判定 |
| --- | --- |
| 归属面 | 新增 `surface='scratchpad-entry'`，身份 = `entryId`（速记条目 id），**不再借用 filePath** |
| 互斥 | 速记面不收 `filePath` / `artifactId` / `revisionId`；反向其它面混入 `entryId` 一律 `entry_id_unexpected` |
| 必填 | `entryId` 必填（`entry_id_required`），长度 ≤300 |
| scope 判定 | `annotationScopeOf` 新增分支：`{projectId, surface, artifactId:null, revisionId:null, filePath:null, entryId}`；与产物/工作区 scope 完全不互通 |
| 上限 | 沿用同一 `MAX_ANNOTATIONS_PER_SCOPE=200`（不另开一套阈值） |
| 存储 | 迁移 **019** 只 `ALTER TABLE ... ADD COLUMN entry_id TEXT`；015/018 既有语句逐字节不变 |
| 路由 | GET 三分支：`scratchpad-entry` 缺 `entryId` → 400 `entry_id_required` |
| Agent 工具 | `result_annotations_list` 支持该面（`entryId` 参数 + 隐式判定），锚点描述为「速记图片」 |
| UI | 速记面板缩略图 → 打开大图（叠加层）→ 复用 `AnnotatableImagePane`（同一批注会话/旁路表）；条目与宿主都无项目时**不渲染批注宿主**，只给「请先在项目内重新保存这张图」的可执行说明 |

**证据**：Node `block219` **21/21**（新增 019 逐字节、速记面四类字段拒绝、store 往返与三向 scope 隔离、路由 GET 过滤与必填校验）× 前端 `ScratchpadPanel` **8/8**（新增大图打开/批注条出现/返回收起、无项目降级）= 邻域全绿；`quality:types` 0；`quality:lint` 0 error；`theme-token-contract` 17/17（新增 CSS 全 token、无新字号档）；`test:changed` EXIT=0（Node **1153** / 1140 pass / 0 fail，前端 **81** 文件全绿）。

**诚实边界**：速记图片批注与结果图/PDF 共用同一条旁路表与同一上限，但**不做**速记条目删除时级联清理批注（条目删了，批注行仍按 scope 存着且不可达 —— 属已知孤儿，登记为 reopen）；无实机腿（留 P8）。

### P7（2026-10-24）— B-5 Office 锚点批注

| 维度 | 判定 |
| --- | --- |
| 锚点单位 | `anchor.unit ∈ {line, paragraph, row}`，**缺省 `line`**（P5 行为零变化）；非法值 `anchor_unit_invalid` |
| docx/pptx/odt/odp | 按 `\n\n` 切段渲染，每段左侧「批注」→ `unit='paragraph'`、`startLine=段序号（1 起）`、`quote=该段原文` |
| xlsx/ods | 表格行首「批注」→ `unit='row'`、`startLine=数据行序号（1 起）`、`quote=整行摘要（截 500 字）` |
| 回执/描述 | `describeAnnotationAnchor` 分别说「第 5 段」「表格第 4 行」「第 12 行」——不把段落说成源码行 |
| 宽度无关 | 序号与排版无关：窗口宽度/缩放变化不影响锚点复现（这正是拒绝 rect 方案的理由） |
| 零新依赖 | 不含版式渲染库；预览仍是既有的文本抽取，只是改成可锚点化的段落/行呈现 |
| 零回归 | 没有 `onAnnotate*` 回调时（只读场景）退回原有 `<pre>` 整块形态，不渲染任何死按钮 |

**证据**：Node `block219` **23/23**（新增：单位枚举/缺省 line/段落与行透传/非法 unit 拒绝、段落与行锚点 store 往返保单位）= 全绿；前端 `annotations` **24**（新增单位文案三态）+ `OfficePreviewPane` **3**（段落按钮回传 index+quote、行按钮回传整行摘要、无回调零按钮且保留 `<pre>`）；`quality:types` 0；`quality:lint` 0 error；`theme-token-contract` 17/17；`test:changed` EXIT=0（Node **1158** / 1145 pass / 0 fail，前端 **83** 文件全绿）。

**诚实边界**：**段落序号不是稳定 ID**——文档被改写后同一段落序号可能指到别的内容，`quote` 只存原文供人核对，不做失效检测；**iWork（pages/numbers/keynote）**只展示容器资源清单，没有可锚文本，故不提供批注（如实不显示按钮）；xlsx 的锚点是**数据行序号**，重排/过滤后行序会变（同属 reopen）；无实机腿（留 P8）。

### P8（2026-10-24/25）— 实机腿 + closeout 十三门 + canonical 回写

**实机腿（隔离栈 :3001/:3000/:9223 + 临时数据根，含 018/019 全部迁移；`scripts/block254-q6-rem-live.mjs` + flow `q6rem-annotations-live.cjs`）**

实机抓真：离屏窗口里**一旦本轮保存过批注，再切换文件预览就会让 CDP 会话失活**（后续 eval 连续超时）。因此按「每轮只保存一次、保存后不再切文件」分三轮，全部自然退出并落盘证据：

| 轮 | 证据 | 断言 |
| --- | --- | --- |
| `image` | `q6rem-image.json` **15/15** | A3 图像批注条 · **A4 马赛克声明**（hint「仅屏显遮蔽，不是脱敏」+ `data-mosaic-fallback`）· **A5 马赛克落库**（kind=mosaic、rect 归一化）· **A6 撤销**（title「撤销刚才的创建」→ 列表清空 + REST 空）· A7 文本面 `mode=text` 无画框开关 · A8 速记图片大图挂批注条 · A12 三个原始文件哈希不变 |
| `text` | `q6rem-text.json` **12/12** | A7 · A8 · **A9 速记图片批注落库**（`surface=scratchpad-entry` + `entryId` 逐字匹配）· A12 |
| `office` | `q6rem-office.json` **10/10** | **A10 docx 段落「批注」按钮**（2 段）· **A11 段落批注落库**（`kind=text-selection`、`anchor.unit=paragraph`、`startLine=2`、quote 含原文）· A12 |
| `image-dark` | `q6rem-image-dark.json` **12/12** | 暗色轮（`--force-dark-mode`）复跑图像面闭环 |

- docx 夹具为零依赖自造（手写 store 式 zip + CRC32），unzipit 可读。
- **诚实边界 ①**：源码选区 → 锚点那一步不在 flow 里（CodeMirror 选区由内部 state 驱动，脚本改 DOM selection 不保证同步）；该链路由 `selectionActions` 12 条 + `annotations` 24 条单测覆盖，实机覆盖的是同一条 `onAnnotate → beginAnchor → 落库` 链（Office 段落触发）。
- **诚实边界 ②**：截图如实 `unavailable`（G-2 预置降级）；马赛克不做像素级脱敏证明（G-3）。

**closeout 十三门（逐门取证）**

| # | 门 | 结果 |
| --- | --- | --- |
| 1 | audit:compact | ✅（closeout 自动执行，107KB→归档） |
| 2 | hygiene:check | ✅（抓真并修复：两个反复编辑文件的 **CRLF 漂移** → `normalize-eol --write` 归一后 PASS） |
| 3 | docs:check | ✅ PASS（410 文档） |
| 4 | ui:audit:check | ✅ PASS |
| 5 | test:changed | ✅ EXIT=0（Node 50 文件 / 前端 83 文件；closeout 内嵌跑挂起一次，单独两轮 EXIT=0 且 closeout 内已跑到前端全过，逐门补证） |
| 6 | gate:code-size | ✅ EXIT=0 |
| 7 | gate:arch-cycles | ✅ EXIT=0 |
| 8 | gate:css-modules | ✅ EXIT=0 |
| 9 | quality:secret | ✅ EXIT=0 |
| 10 | quality:arch | ✅ EXIT=0 |
| 11 | quality:lint | ✅ EXIT=0 error |
| 12 | quality:types | ✅ EXIT=0 |
| 13 | quality:knip:check | ✅ EXIT=0（抓真并定性：新实机 flow 属**动态入口**，`knip-ratchet --update` 后基线 276 键，+1） |

**收口期修复记录**：① CRLF 漂移（normalize-eol 归一 2 文件，归一后批注核心测试 31/31 + 前端 49/49 复绿）；② `test/impact-map.json` 漏登记 `scripts/block254-*.mjs` 分类（+1 规则，`test:changed` 由 exit 2 转绿）；③ knip 保留面 +1（动态入口定性）。三次都是收口门禁抓真后按既定流程修复，无绕过。

**canonical 回写**：母纲 §6.5 第 9 行 → `completed`；UI-562/563/564/565 → `verified`（各补实机证据行）；plan frontmatter → `completed`；AUDIT-LOG / roadmap / handoff / DOC-REGISTRY 同步。

### P1–P2 门禁

- `npm run test:changed`：**EXIT=0**，Node 955 / 949 pass / 0 fail（6 skip），前端 36 文件全绿，`docs:check` PASS。
- `npm run quality:types` 0；`npm run quality:lint` 0 error（1953 warning 为存量基线）；`npm run ui:audit:check` PASS；`npm run gate:code-size` PASS（24 文件 / 总 23451 行 / 基线未变）。
- 未跑：closeout 十三门（留给 P8 收口）、隔离 9223 实机腿（文字/马赛克尚无实机证据 → UI-562 保持 `in_progress`）。
