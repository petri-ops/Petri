---
capability: analysis-chain-correctness
goal: BLOCK-146 分析执行链正确性与 pack 对账——让本机（Windows）第一次发起分析（界面或 agent）就跑得对：bundle 平台解析正确、依赖缺失可归因、required file 输入 fail-fast、域校验覆盖主执行路径、主仓与 pack 仓多因子契约不漂移（契约测试锚内容指纹，漂移红而非 skip）
acceptance:
  - 三轨红绿先行（HK-01）：每项新行为契约先落失败测试再实现，红→绿证据（测试名+两轮输出摘要）随收口笔录留痕
  - A 轨#8：平台解析根修（capability-bundles 按 process 推导缺省平台，win32 不再命中 macos-arm64；显式 option 覆盖保留）+ installTarGzBundle manifest 平台三元组校验；Windows 上 r-enrichment 解析为 unknown 拒绝下载（契约测试实证）
  - A 轨#9：插件必需 bundle 未就绪时，结构化失败原因（bundleId/status/error+可行动中文指引，对照 tool-dependencies.js missingPackagesMessage 范式）并入 job 失败文案，不再只进 console.warn；可选 bundle 的合法回退语义不变
  - A 轨#4：required file 型输入路径不存在时 fail-fast（「输入 X 路径不存在: <path>（需本地绝对路径）」形态），run-plugin-script.js:191 静默 continue 消除
  - B 轨#7：域校验（小数 counts/重复基因名等既有规则）在 agent run_tool / UI 表单的主执行路径触发——复用 upload-domain-validation 单源不复制第二份真相；HTTP multipart 既有路径行为不变
  - C 轨#10：test/deseq2-multifactor-design.test.mjs 锚 pack 仓 deseq2.R 内容指纹——契约漂移红而非 skip；Rscript 检测与 app 运行时解析口径对齐（先探后改，改动留痕）
  - C 轨#6：本机 pack 仓（D:\1.WorkDir\gewu-pack-bio）补齐 D3 R 侧 parse_design_terms 多因子（直收 ~ batch + condition、单列向后兼容、preflight 逐项 fail-closed），对照 desktop 契约 scientific-task-planner.js designFormula/designTerms；pack 仓本地提交（BIO-4 惯例不推送，hash 留痕）；R 侧真实跑通验证，Rscript 不可用则如实登记边界不编造
  - 统一门禁：test:changed + quality:secret/arch/lint/types 全绿；收口 closeout 十一门（主代理集成提交后）
reopen: bundle「必需性」静态判据若后续出现第二插件形态需求再泛化；#11/#12（B9 表单下拉/demo 数据）与 A2 工作台三条属审视批后续批次，按序列另立项
status: completed
---

# BLOCK-146 分析执行链正确性与 pack 对账（审视批裁决首批）

## 1. 背景与裁决溯源

- 源头：2026-10-08 双视角全面审视工作流（dwfrun-6724f75c）——十角度（通用平台 A1~A5 × 生信垂直 B6~B9 × 共底 C10）95 条发现，每角度独立换眼复核（确认 79 / 降级 1 / 低影响判读 15），高影响 12 条全部 file:line 级实证；主代理另抽验 3 条最承重发现全部坐实；output:judge PASS。
- 裁决：6 个优化批次序列（详见审视报告卡片「双视角全面审视与优化裁决报告」），本包为序列之首。
- 发令：用户经 /workflow 裁决「开」（2026-10-08），即本批立项发令。
- 本批定位：G0 优化阶段·正确性批——不新增功能面，修复「第一次发起分析就跑不对」的执行链缺陷。

## 2. 范围（三轨）

| 轨 | 审视发现 | 内容 | 主文件面 |
| --- | --- | --- | --- |
| A 平台与归因 | #8/#9/#4 | bundle 平台解析根修 + manifest 平台校验；bundle 结构化失败并入 job 文案；required file 输入 fail-fast | core/shared-backend/capability-bundles.js、core/biof3-server/mcp/registry/run-plugin-script.js、core/biof3-server/helpers/tools-executor.js |
| B 域校验主路径 | #7 | validateDomainUploads 规则接入 agent run_tool/UI 主执行路径（单源复用） | tools-executor.js / run-plugin-script.js 暂存段 + upload-domain-validation.js（只读复用） |
| C pack 对账闭环 | #6/#10 | 契约测试锚 pack 内容指纹（漂移红非 skip）+ Rscript 检测修正；本机 pack 仓补齐 parse_design_terms 多因子 | test/deseq2-multifactor-design.test.mjs + ../gewu-pack-bio/plugins/deseq2/scripts/deseq2.R |

执行序：A → B 串行（A/B 共享 tools-executor.js 与 run-plugin-script.js 文件面，避免并行互踩）；C 与 A/B 并行（文件面互斥：pack 仓 + 独立测试文件）。

## 3. 非范围

- A2 工作台三条（#1 决策键错位 / #2 未决 hunk 静默提交 / #3 键盘焦点零反馈）与 B9 两条（#11 表单下拉 / #12 demo 数据最后一公里）：属审视批后续批次，不在本包。
- G1+ 事项（Provider/packaged 公证/GA）按 G0 纪律不外推。
- 不改 HTTP multipart 直跑路径既有语义（B 轨只加不改）。
- 不新增依赖；不动 pack 仓 deseq2 之外的插件。
- pack 仓不推送远端（BIO-4 双端对账惯例，收口时 hash 对账留痕）。

## 4. 实现形态

- dynamic workflow：三轨实现员（A→B 串行、C 并行）+ 独立评审（P1 修复后方可收口）+ 统一门禁（红了即修，最多两轮）。
- 红绿先行（HK-01）：每项行为契约先写失败测试，再最小实现转绿；豁免面（pack R 侧脚本本体）以 desktop 契约测试 + R 侧冒烟替代。
- **工作流内不提交**：主仓与 pack 仓改动均留工作区，主代理终审 diff 与验证证据后集成提交（仓库既有形态）。
- 工作流运行期间主仓工作区不净 → auto-sync 按判据 SKIP 属预期，收口提交推送后自愈。

## 5. 验收与证据

- 红绿证据：三轨 TrackResult 携带（测试名+两轮输出摘要）。
- 定向门禁（workflow 内统一跑）：`npm run test:changed` + `npm run quality:secret` + `npm run quality:arch` + `npm run quality:lint` + `npm run quality:types`。
- 收口门禁（主代理集成提交后）：`npm run closeout`（十一门 fail-fast）。
- pack 对账：pack 仓本地提交 hash + deseq2.R 指纹断言红→绿证据；Mac 侧 3f3c5e8 与本机提交的关系在收口台账对账说明。
- R 侧验证：Rscript 可用则跑多因子冒烟（~ batch + condition 真实 R 执行）；不可用则边界如实登记，收口笔录注明待 Mac 侧或装 R 后复验。
- 证据落 `acceptance/block-146/`（收口时由主代理整理）。

## 6. 风险与边界

- 跨仓编辑：C 轨在 ../gewu-pack-bio（本工作区外）改 deseq2.R——限定该文件与必要 manifest，改动不推送。
- bundle 平台键集合以 index 实测为准：若 index 无 windows-x64 键，正确行为=unknown 拒下载（fail-closed），不是造键。
- 「bundle 必需性」判据：实现员读 ensureBundlesForPlugin 语义后定（插件声明依赖+平台匹配），取舍在 notes 留痕；拿不准从紧（fail 优于静默回退）。
- Rscript PATH 与 app 运行时 R 解析口径差异：先探明 app 如何解析 R 路径（运行时配置/环境变量），测试检测向其对齐；探不明则只加指纹锚不动检测，边界留痕。
- 域校验触发面识别：若输入无域语义标注机制，按在册插件输入名白名单（deseq2 counts/metadata 等）起版，设计取舍留痕，后续泛化走 reopen。

## 7. 完成语义

三轨交付 + 独立评审 P1 清零 + 统一五门绿 + 主代理终审集成提交 + closeout 十一门 PASS + 台账五件回写（plan/DOC-REGISTRY/backlog/roadmap/AUDIT-LOG）+ pack 仓本地提交对账留痕。R 侧若受 Rscript 边界限制，验证边界如实登记不冒充通过。

## 8. 收口笔录（2026-10-08 当日立项当日收口）

- **三轨交付**（dwfrun-7b79e0fa，A→B 串行 / C 并行）：A=#8 平台解析根修（deriveHostPlatform 宿主推导 + getBundleDescriptor 携带解析平台 + installTarGzBundle 平台三元组拒装 bundle_platform_mismatch；win32 不再命中 macos-arm64，resolve null→unknown 拒下载）+ #9 formatRequiredBundleFailure 单源（agent/MCP 与 HTTP 两路径并入 job 失败文案，markJobFailed 'dependencies' + 释放槽位）+ #4 required file fail-fast（中文可操作消息，非 required 跳过语义不变）；B=#7 域校验主路径化（_runPluginScript 暂存段后单源复用 validateDomainUploads，agent run_tool/UI 表单/远程分派同覆盖，HTTP multipart 零改动 400 对照钉住）；C=#10 pack 指纹锚（deseq2.R 缺 parse_design_terms 即红而非 skip）+ Rscript 检测对齐 RExecutor.binPath + #6 本机 pack 仓 D3 重放（8e6055e）。
- **红绿先行全留痕**：#8 17红→24/0；#9+#4 6红→8/8；#7 2红→5/5；#10 指纹锚红→2 pass/7 skip/0 fail。定向回归 61/61+17/17。
- **独立评审 P1=0**；P2 三条处置在案：①新契约测试 impact-map 登记（集成落定：block146 生产文件规则随 feat 提交 + block146-evidence 证据规则）②R 侧零机器执行边界如实保留（本机 Rscript 三处确无，RExecutor.binPath=null 与 app 同源；deseq2.R 仅代码级复查，待 Mac 侧/装 R 后复验，7 诚实 skip）③平台→键映射三份副本登记重构候选（deriveHostPlatform / build-r-bundle / plugin runtime.js，一致性契约测试可后续补）。
- **集成加映（主代理终审阶段）**：pack 仓 D2 死链退役本机同步（70e37fe：17 条 TOOLS script 置空走插件通道 + RETIREMENT-LOG 留痕，镜像 Mac 5589026 意图）——根因=Windows pack 克隆停在 db6be21 缺 Mac 本地退役提交，tool-registry-script-links 在本机恒红；顺手清债=impact-map +block145-evidence（BLOCK-145 收口带入 acceptance/block-145/ 漏登记）。
- **门禁**：统一五门（secret/arch/lint/types 绿；test:changed 首轮红=上述 pack 环境红，同步后绿）+ closeout 十一门 PASS（code-size 棘轮随 #9 新行为契约重锚：tools-executor 2091→2101 走 --write 登记，R-2 机制先例）。
- **pack 对账**：本机 70e37fe（D2 同步）+ 8e6055e（D3 重放）本地不推送（BIO-4 惯例）；Mac 侧 5589026/3f3c5e8 与本机为同意图双端实现，对账以测试契约（tool-registry-script-links + deseq2-multifactor-design 指纹锚）为准。
- 证据=acceptance/block-146/evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA。
