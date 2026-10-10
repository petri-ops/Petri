---
capability: bio-delivery
goal: 生信垂直交付能力从「单点插件 + 信息密度不足 + 链不可见」收敛到企业级水位——分析能跑成链、结果会看会读、输入显式可信
acceptance:
  - 各阶段按种子立项后以对应 BLOCK/UI 验收为准（阶段表出口判据）
  - Goal 线整体收口时：bulk 主链（校验→QC→DEG→富集）端到端 dev Electron verified + 结果查看具备专业信息密度（点选带数值/可搜索/可组合筛选）+ lineage 用户可见
reopen: 用户裁决启动任一阶段时按立项检查单开包；解冻范围（BIO-4）与领域深化池（BIO-7）逐项需用户显式裁决
status: completed
---

# G0-BIO — 生信垂直交付能力 Goal 线

> 立项：2026-09-28。用户裁决（原话）：「行！现在就是分成 通用agent平台和垂直领域的生信平台两个视角了 接下来就是具体的执行更新迭代 是否要做两个大的计划 尽可能的考虑全面 用于后面两个大部分的工作推进」——
> 与 [`g0-platform-goal-plan.md`](./g0-platform-goal-plan.md) 成对创建，源自同一次「结果与分析链路企业级交付差距评估」（垂直领域视角部分）。
> **本 Goal 线吸收候选池 C-15**（结果闭环路径扩展，重开条件=「用户裁决方向回摆生信旗舰倾斜」——本次两 Goal 立项即触发）与 **C-12**（scrna_standard 路径，转本线 BIO-7 池）。
> 形态：**Goal 线**（TASK-FORM-TAXONOMY §3，先例 G0-RS P0-P7）。治理定位同 G0-PLATFORM：规划深度在本计划，全局推进序在
> [`pending-work-backlog.md`](./pending-work-backlog.md)，立即任务在 [`next-steps-roadmap.md`](./next-steps-roadmap.md)；单工作包串行不变，阶段启动照常过立项检查单。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话目标

让生信用户在这台产品上**能跑成链、会看结果、读得懂结论、输入显式可信**——把已做实的可信底座（artifact truth / provenance / revision 血统 / 实体选择契约）兑现成垂直领域的日常工作流。

## 2. 背景：差距地图（2026-09-28 垂直视角评估证据摘要）

### 2.0 结构性事实：可用分析面接近单点

BLOCK-83 P4（2026-09-12）领域中立化后，生信分析全部迁至兄弟仓 `petri-pack-bio`（domain-pack）。当前装载状态：

- pack 15 个插件中**仅 deseq2 活跃**（`petri-pack-bio/plugins/installed.json` 单条）；其余 14 个在 `plugins.dormant/` 冻结（2026-09-15 用户裁决）。
- pack 另有 **17 个 R 脚本未接线**（desktop 侧 `core/petri-server/tool-scripts/` 已删，registry legacy 条目走 `getToolConfig` 拼空路径 → "Script not found"，`helpers/tools-executor.js:642-656,1262-1267`）；5 个 Python 工具（scVI/空间组四件套）**只有纸面声明无脚本**。
- HEAVY_TOOLS 白名单 14 个重操作工具中 13 个生信工具，**只有 deseq2 当前有活跃插件通道**。
- 领域覆盖：Bulk RNA-seq 主链设计完整（validator→QC→deseq2→standardizer→volcano→go-kegg/gsea，模板 `bulk-rna-core` 在 `core/shared-backend/agent-workflow.js:325-375`）但**只有 deseq2 通电**；scRNA 全冻结；蛋白组/代谢组/甲基化/ATAC 零覆盖；空间组纸面。
- design formula 被收窄为单列名（`petri-pack-bio/plugins/deseq2/scripts/deseq2.R:168` 拼 `~ <col>`），**多因子设计 `~ batch + condition` 不支持**。
- 平台面：域插件原型仅声明 macos-arm64 platformSupport；Windows 侧真实分析链依赖域包交付（当前开发机即 Windows）。

### 2.1 结果解读面：可信度 95 分，专业信息密度不及格

强项（不重做，只在其上补）：稳定实体 ID 选择契约（点选/框选/图例全解析为基因 ID，持久化防截断说谎）、服务端权威排序/过滤、Revision/ChangeSet 血统改参、诚实 trust 徽章。

单点信息密度缺口（用户每天碰）：

| 生信刚需 | 现状证据 |
| --- | --- |
| 点火山图看基因名+log2FC+padj | selection 只带实体 ID 不带数值（`frontend/src/lib/artifact-selection.ts:94-119`）；hover title 只有基因 ID（`ScientificInteractionViewer.tsx:383`） |
| 火山图定位指定基因（TP53） | 无搜索无高亮，只能去表格 contains（`:329-398`） |
| 显著性阈值线（padj=0.05，lfc=±1） | 无参考线（`:358-359` 只有坐标轴） |
| 全量点交互（2 万基因） | **限 250 点且是文件前 250 行非 top 显著基因**（`core/petri-server/routes/result-studio/interaction.js:243-248`） |
| 组合筛选 `padj<0.05 AND lfc>1` | UI 只有单字段 contains（`:147-152`）；**filter 协议已支持 eq/lt/gt 未做控件**（`artifact-selection.ts:78-87`） |
| 数值专业格式（科学计数/有效位/右对齐） | 原样字符串渲染（`:298`） |
| 热图聚类树 + z-score 色标 | 无 dendrogram、无图例刻度、min-max 红蓝固定（css `:42-45`） |
| 复制/导出选中行 | 无，selection 只喂 Agent |
| PNG 缩放平移 | Lightbox 仅全屏 contain 无 zoom/pan（`frontend/src/components/ui/Lightbox.tsx:32-39`） |
| 结果旁看样本分组 | 无视图；分组藏在 coldata_info.csv 产物与报告一行字（report-template.html:70-73） |
| 静态 CSV 预览 | 仅前 24 行（`ResultArtifactShell.tsx:819`） |
| 中文产物名 | manifest label GBK mojibake（block121 实测 job 的 manifest.json） |

### 2.2 解读层断链

- `/api/ai/interpret` 有 **10+ 分析类型的解读模板**（deg/enrichment/trajectory/空间组学，`core/petri-server/helpers/interpret.js:181-339`）但**前端零调用**（遗留 web 路由）。
- 现行链路：按钮拼 prompt 走 Agent 对话（`CenterPanel.tsx:179-182`），但 Agent 的 `result_summary` 只读工具**只能看到主表前 6 行×8 列**（`core/petri-server/agent-tools/result-summary-tools.js:145-153`）——「Copilot 引用真实基因/数字」（BLOCK-121 已验证的路径）受制于极窄真值窗口。

### 2.3 工作流面：链在库里，用户看不见

- **QC→DEG→富集血缘图已完整入库**（`result_workflow_graphs` 含 nodes/edges/dependsOn/hash，`core/shared-backend/result-workflow-graph.js:519` 从 Job/Revision/Selection 真值投影）但**前端零消费、无暴露端点**——数据侧零缺口，纯投影工作。
- 上游喂下游三条路径全经 Agent 中介（plan/bind_artifact 对话链 / selection→`result_enrichment_from_context` / BLOCK-52 引用改参）；**selection 下游硬编码仅 go_kegg**（`core/petri-server/agent-tools/result-selection-tools.js:432`）。
- DEG 阈值改动下游级联重跑**只支持 2 个直接子节点**（`core/shared-backend/result-scientific-rerun.js:6-9`：go-kegg/volcano-plot）。
- compare 限 ChangeSet 边界（编辑前后），不能任选两次 run 对比。

### 2.4 输入侧：显式性缺失 + 领域校验真空

- **无表单式执行面**：分析面板「运行」只向 agent 发消息「请运行「X」分析」（`frontend/src/components/workspace-panels/RightPanel.tsx:246-255`）；用户不能显式指定「用哪个矩阵+哪个 metadata」；审批卡只能批准不能编辑参数（`ApprovalCard.tsx`）。
- 领域校验**声明而不执行**：`core/shared-backend/artifact-profiles.js:96-157` 声明了 `petri.counts-matrix.v1`（feature_ids_unique/counts_non_negative_integer）与 `petri.sample-metadata.v1`（sample_overlap_required/condition_not_missing）规则，但核心消费只到「id 已注册+type 匹配」（`agent-workflow.js:251-256`）；执行者 sample-metadata-validator 插件休眠——**当前上传路径只有通用 CSV 嗅探**（`tools-executor/result-files.js:291-348`）。
- 显式参数面仅剩两个：Skills 页 optional 表单（required 仅文字列出，`SkillDetail.tsx:221-223`）+ Result Studio 上下文编辑（改参而非发起）。

### 2.5 参数领域语义（亮点 + 一处收窄）

- **亮点保留**：parameterImpacts 四级分级（presentation/data/scientific/workflow）+ 保护字段下限（design/contrast 列为 SCIENTIFIC_FIELDS，`result-edit-intent.js:8-28,64-130`）+ 三段 preflight 防呆（design 列不存在硬失败/contrast 校验/每条件≥2 重复，`deseq2.R:107-133`）+ 「contrast 必须来自 validator 禁止 Agent 猜」（`scientific-task-planner.js:107-140`）。
- 收窄：多因子 design 不支持（§2.0）；无 TPM/FPKM 独立归一化工具；无 edgeR/limma 备选（skill.json 声明了 method 选项但无实现）。

## 3. 阶段划分（工作包种子）

> 同 G0-PLATFORM §3 规则：每阶段=未来独立工作包，启动顺序由用户在 backlog 逐个裁决，交织原则见 §4。

| 阶段 | 名称 | 一句话范围 | 预估形态 | 依赖 |
| --- | --- | --- | --- | --- |
| BIO-1 | 结果信息密度包 | 数值 tooltip + 基因搜索定位 + 阈值线 + 组合筛选控件 + 数值格式化 + Lightbox zoom/pan | UI 批（可单会话闭环） | 无 |
| BIO-2 | 交互上限与降级链 | 250 点改 top-N 显著语义 + 静态 24 行统一服务端分页 + 热图窗口扩展 + mojibake 修复 | BLOCK 小包 | 无 |
| BIO-3 | Lineage 可视化 + 继续分析显式化 | workflow graph 投影端点 + 前端 DAG/面包屑 + 「用此结果继续」入口 + selection 下游白名单扩展（gsea/volcano） | BLOCK | 无（**吸收 C-15 前半**） |
| BIO-4 | bulk 主链解冻 | validator/QC/deg-standardizer/go-kegg/gsea/volcano-plot 从 dormant 恢复 + 17 断链脚本处置 + Windows 平台支持声明 | BLOCK（**吸收 C-15 后半；依赖 PL-1**） | G0-PLATFORM PL-1 |
| BIO-5 | 输入显式化与领域校验执行化 | run_tool 输入契约投影成表单 + 上传路径执行 counts-matrix/metadata profiles 规则 | BLOCK | BIO-4（validator 插件在链上） |
| BIO-6 | 解读层接线 | `/api/ai/interpret` 模板接前端 + `result_summary` 真值窗口扩容（有界） | BLOCK 小包 | 无 |
| BIO-7 | 领域深化池 | 多因子 design（✅ 已交付：BLOCK-145 D3 deseq2.R parse_design_terms 真实 R 跑 19/19 + BLOCK-146 C 轨本机重放 pack 8e6055e——2026-10-08 对账批标注） / edgeR·limma / 热图聚类·z-score / scRNA 链解冻（**吸收 C-12**）/ TPM·FPKM / 任意两 run 对比 / 多组学 | 候选池性质，逐项裁决 | BIO-4 + PL-1 |

> 注记（2026-10-01）：BIO-3 出口判据（「DAG 或面包屑」）已由 UI-455（打开链）+UI-456（血缘条）满足；**DAG 画布形态升级归属成果面系列 BLOCK-138**（见 [`artifact-plane-direction.md`](./artifact-plane-direction.md) 切片 B），BIO-3 P2「继续分析显式化」仍在原位推进——防重复开发。

### 阶段出口判据（摘要）

- **BIO-1**：实机走查——火山图点选显示基因名+log2FC+padj；输入基因名可定位高亮；阈值线按插件参数（lfc_cutoff/padj_cutoff）绘制；表格可组合 `padj<0.05 AND |lfc|>1` 筛选；padj 列科学计数法；Lightbox 滚轮缩放。组件测试 + theme 门禁绿。
- **BIO-2**：plot backing limit 语义=「top 显著 N」可配置并如实标注截断口径；静态 CSV 预览走服务端分页（复用 table/query 通道）；manifest 中文 label 无 mojibake（编码链修复+回归钉）。
- **BIO-3**：前端可见 QC→DEG→富集血缘（DAG 或面包屑，数据来自权威 graph 表非前端拼装）；「用此结果继续分析」显式入口落 selection 下游（≥2 个工具）；bind_artifact 链路回归零断。
- **BIO-4**：`bulk-rna-core` 模板整链（validator→QC→deseq2→standardizer→volcano→go-kegg/gsea）dev Electron 端到端跑通（BLOCK-121 flow 扩展版）；Windows 侧同样跑通或平台支持声明如实；dormant 恢复范围按用户裁决留痕。
- **BIO-5**：发起分析可显式选输入（矩阵+metadata）且选择进 params 留痕；上传 counts 矩阵时执行非负整数/重复基因名/样本对齐校验，违例 fail-closed 带可操作提示。
- **BIO-6**：结果页可一键解读（走既有模板或 Agent 扩容真值）；`result_summary` 可见行数有界提升且截断口径如实。
- **BIO-7**：池条目逐项立项时定。

## 4. 与 G0-PLATFORM 的依赖与交织原则

1. **PL-1 → BIO-4 硬依赖**（长任务预算）。解冻前必须先统一执行语义。
2. BIO-1/BIO-2/BIO-3/BIO-6 均无平台依赖，可即刻启动——这四项是「体感最快」的一组。
3. 交织建议 v1（供裁决，非预设）：BIO-1 → PL-2 → BIO-2 → BIO-3 → PL-1 → BIO-4 → PL-3 → BIO-5 → BIO-6 →（PL-4/5/6 穿插）→ BIO-7 池。
4. 与产品方向先例的关系：2026-09-26 用户曾裁决「通用编码 harness 为主线、垂直扩展让位」（C-15 登记语）；本次两 Goal 成对立项=双视角并立，推进序仍逐项裁决，本计划不预设「垂直优先」为既定事实。

## 5. 待裁决项登记

| # | 事项 | 裁决点 |
| --- | --- | --- |
| BIO-D1 | dormant 解冻范围（BIO-4） | 最小=bulk-rna-core 链 6 插件 vs 扩展=wgcna/scrna 系；逐个还是成批 |
| BIO-D2 | 17 个断链 R 脚本处置 | 插件化接线 vs 明确退役（registry 条目清除）；涉及 skills:check C-20 存量 6 红的基准归属 |
| BIO-D3 | Windows 平台支持 | 域包平台声明补 win32 的验证深度（本地实测 vs 声明级） |
| BIO-D4 | interpretation 供给形态——**已裁决（2026-09-30 用户授权主代理裁）=形态 (b) 统一并入 Agent result_summary 链（单一解读真相）**：解读入口 prompt 锚定 result_summary 有界真值（UI-459 实装），遗留 /api/ai/interpret 模板路由留 reference 不接前端不删；更宽真值窗口（50+ 行）的专属投影通道仍随本裁决后续另评估 | 裁决记录=UI-459 台账+本行 |
| BIO-D5 | 多因子 design（BIO-7 池首项） | R 公式语法暴露程度与防呆深度 |

## 6. 非范围（红线）

- 不启动 G1+ 事项——G0 开发期常态 · 不外推 packaged/Provider/GA。
- 不重做可信底座（选择契约/revision 血统/artifact truth）——只在呈现与链路可见性上补。
- 不做无观测支撑的体验重写；预览虚拟化等维持「实机观测到卡顿再动」的 C-01 纪律。
- 不绕过单工作包串行；本 Goal 不授权任何阶段自动启动；dormant 插件解冻（BIO-D1）未经裁决不得预激活。
- 不在本 Goal 内新建第二套科学解读真相（interpret 与 result_summary 必须收敛为一，见 BIO-D4）。

## 7. 台账关系

- 全局推进序：`pending-work-backlog.md`（C-15/C-12 本日改编入指向本计划；阶段种子入队时逐行登记）。
- 当前立即任务：`next-steps-roadmap.md`。
- UI 面阶段（BIO-1/BIO-2 前端部分）同提交更新 `ui-productization-audit.md`。
- 域包仓库：`D:\<workdir>\petri-pack-bio`（本 Goal 的 BIO-4 阶段主要施工面之一，跨仓改动时按其仓内治理执行）。
- 收口语义：同 G0-PLATFORM §7。

## 8. 实施记录

### BIO-6b result_summary 真值窗口有界扩容（2026-09-29 completed）

- **范围**：MAX_ROWS 6→20（3.3 倍），出口判据「可见行数有界提升且截断口径如实」达成——截断口径字段（truncated 双标志/message「前 N 行真值（共 M 行）」）均为动态量自动跟随。
- **选型留痕**：6k 字符模型投影预算内实测安全（新增**字符预算硬钉**：worst-case 20 行×8 列×24 字符完整 envelope JSON.stringify ≤6000，超限先红禁止静默放宽——度量用 JSON.stringify 与 serialize 的 fitValidJson 同口径，因 serialize require 链在测试环境拉 db 不可直调）；更宽窗口（50+ 行）需专属投影通道，**与 BIO-D4（interpret/result_summary 收敛裁决）一并定**，未擅自扩张。
- **验证**：result-summary-tool 测试 5/5（行截 20/预算钉/其余零回归）+ eslint 触碰面 0 + test:changed 分类无冲突。
- **边界**：列窗 8/单元格 24 字/表 8MB 上限不动；只读契约与「不整表倾倒」纪律维持。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. Goal 收口对账（2026-10-09 · BLOCK-153）

- **出口判据核验**：①bulk 主链（校验→QC→DEG→富集）端到端 verified=BIO-4 六件解冻实机全通（acceptance/block-129/，2026-09-29）+后续 143/145/146 链上加固；②结果查看专业信息密度=UI-452 verified（tooltip 全数值/搜索/阈值线/组合筛选）+BIO-2 交互上限契约级落地（散点 600/热图全量/CSV 分页）；③lineage 用户可见=UI-456 verified（2026-10-08 由 UI-460 走查覆盖核销，chain=3 真实跨 Job 链实机证据）。
- **种子对账**：BIO-1 verified / BIO-2 契约级全绿（perception-live 复跑落账尾巴在册）/ BIO-3 verified（P0 打开链+P1 血缘条）/ BIO-4 verified / BIO-5 契约级全绿（UI-457 过目待用户）/ BIO-6 形态 b 交付（UI-459，T5 状态门残留观察在册）/ BIO-7 池=候选池性质逐项裁决（多因子 design 已由 BLOCK-145 D3+146 C 轨交付标注，余项不动）。
- **收口后尾巴登记（不阻塞 Goal 出口）**：BIO-2 复跑落账核对、UI-457 过目、BIO-6 T5 观察——均在 roadmap/audit 台账在册；审视吸收三波余量候选（A4 两条/B7 报告模板/H 边缘三条）已入候选池 C-24。
- G0 开发期常态 · 不外推 packaged/Provider/GA。