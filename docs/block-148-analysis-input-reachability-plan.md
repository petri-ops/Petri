---
capability: analysis-input-reachability
goal: BLOCK-148 B9 分析输入可达性批——让「上传过的文件都能被选到、新手第一条链一键试跑」：①表单文件下拉与上传白名单一致（.csv/.tsv/.txt/.rds/.rda/.xlsx/.h5/.hdf5/.gz）且子目录可选、同名不同目录用 path 消歧 ②demo 数据最后一公里接通（7 插件 demo-data 端点与 demoDataUrl 契约字段已在，前端零消费→一键载入）
acceptance:
  - 两项红绿先行（HK-01）：先失败测试再实现，红→绿证据随收口笔录留痕
  - #11 下拉契约：白名单与上传面单源对齐（不复制第二份清单——从上传白名单同源推导或共享常量）；子目录文件可选（tree 递归/带参，后端 files.js:162 单层 readdirSync 改造）；option value 用完整 path（消同名歧义），显示名可带相对目录
  - #12 demo 载入：复用 demoDataUrl 契约字段与 /api/tools/demo-data 端点（零新端点）；分析入口提供「用示例数据试跑」路径——demo 文件落工作区后即可被 #11 的下拉选到；不复制 demo 数据本体
  - UI-457 联动：参数配置表单实机过目并入本批验收（用户过目或 dev-verify flow 二选一，未过目前 UI-457 台账不翻 verified）
  - 定向门禁：test:changed + quality:types/lint/secret/arch + 前端定向测试全绿；closeout 十一门（集成提交后）
reopen: 文件浏览器完整树 UI 化（懒加载/搜索）属后续；demo 数据集扩充属 BIO-7 池
status: completed
---

# BLOCK-148 B9 分析输入可达性批（审视批序列第 3 批）

## 1. 背景与裁决溯源

- 源头：双视角审视（dwfrun-6724f75c）B9 角度高影响发现 #11/#12（换眼复核确认）；剩余工作地图（dwfrun-25f8657a）三批价值主线之二。
- 发令：用户 2026-10-08「按顺序直接推进 尽可能的走远」批量发令；BLOCK-147 收口后接续。
- 定位：生信垂直·新手第一链可达性——传了选不到、想试试没入口，两个断点一次接通。

## 2. 范围（两项，文件面高度重叠串行实现）

| 项 | 审视发现 | 内容 | 主文件 |
| --- | --- | --- | --- |
| 表单下拉可达性 | #11 | 白名单与上传面一致（单源）；子目录可选（后端 tree 递归/带参）；value 用 path 消歧 | AnalysisLaunchPanel.tsx:38/65/123、core/petri-server/routes/files.js:106/162、前端 tool-catalog.ts |
| demo 一键载入 | #12 | 前端消费 demoDataUrl 契约字段 + /api/tools/demo-data 端点，「用示例数据试跑」把 demo 文件落工作区 | AnalysisLaunchPanel.tsx（或分析入口邻近组件）、tool-catalog.ts:55 既有类型、tools-platform.js:308 既有端点（只读复用） |

## 3. 非范围

- 完整文件树 UI（懒加载/搜索/收藏）——后续批。
- demo 数据集内容扩充——BIO-7 池域。
- 不新增后端端点；不改上传白名单本身（以它为基准对齐下拉）。
- G1+ 不外推；不新增依赖。

## 4. 实现形态

- dynamic workflow：单实现员串行两项（文件面重叠禁并行，红绿先行）→ 独立评审（P1 必修）→ 统一门禁（红了即修 ≤2 轮）。
- 工作流内不提交，主代理终审后集成提交。
- 若 UI 文案/样式触碰 CSS：走 token 纪律（同 BLOCK-147 批先例），theme-token-contract 入门禁。

## 5. 验收与证据

- 红绿：#11 下拉白名单/子目录/path 值契约测试（红=现状只列顶层 csv/tsv）；#12 demo 载入接线测试（红=现状零消费）。
- 定向门禁：`npm run test:changed` + `quality:types/lint/secret/arch` + 前端定向 +（若触 CSS）theme-token-contract。
- UI-457：实机过目（analyze tab 展开 deseq2 配置→选文件→按参数运行）或 dev-verify flow；未过目台账维持 in_progress。
- 收口 closeout 十一门 + 台账五件回写；证据落 `acceptance/block-148/`。

## 6. 风险与边界

- tree 递归深度：工作区目录可能有深层产物（results/jobs/*/output）——递归须有界（深度上限）且排除明显产物目录（或仅展开 data/ 类输入目录），取舍留痕 notes；避免下拉被数千中间产物淹没。
- 白名单单源：上传白名单在后端 files.js，下拉在前端——共享常量放哪一层（后端投影进 tree/目录端点响应，或前端 lib 常量双写+契约测试锚一致）由实现员定，禁止无锚双写。
- demo 落工作区的命名冲突：重名加后缀或按插件子目录落，取舍留痕。

## 7. 完成语义

两项交付 + 评审 P1 清零 + 统一门禁绿 + 主代理终审集成提交 + closeout 十一门 PASS + 台账五件回写 + UI-457 过目状态如实登记。序列下一批（A5 隧道诚实化 + 平台域修补批，含 PL-D2=30 天落地）接续。

## 8. 收口笔录（2026-10-08 当日立项当日收口）

- **两项交付**（dwfrun-68fb5ea8，曾因 provider 限额 1308 中断一次、Resume 续跑）：#11 白名单单源投影（UPLOAD_FILE_EXTENSIONS→tree inputExtensions→前端零第二份清单）+recursive=1 有界递归（深度3/排除产物目录/500 条 truncated）+path 消歧；#12 demo 一键载入（demoDataUrl 信号+既有端点+BLOCK-90 分片落盘，demo-data/<toolId>/ 命名空间）。
- **评审 P1=0；P2 三条集成批全修**：impact-map 登记（block89 规则）/ 409 残缺自愈（fs/delete 后重传一次，三形态契约测试 4/4）/ truncated 诚实提示（treeTruncated 下传）；Minor sortDirents 一字修（目录优先排序生效）。
- **门禁**：统一门禁绿 + closeout 十一门 PASS；波折如实两条——①workflow 门禁 test:changed 首轮 exit=1=评审员与门禁并行跑测试互踩（干净树复跑 exit=0 坐实）；②ui:audit 首轮抓真 UI 编号缺失 → UI-467 台账补正 amend 同提交（in_progress，实机走查待）。
- **红绿**：#11 Node 5红→7/7、前端 5红→9/9；#2x demo 契约 4/4；test:changed Node 387/0。
- **边界**：plugins 目录本机不存在，demo 端点真实数据流端到端未实跑（契约级已锚）；UI-457 维持 in_progress 待用户过目（本批增量注记在案）。
- 证据=acceptance/block-148/evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA。