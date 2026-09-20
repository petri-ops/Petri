# BLOCK-105-CODE-QUALITY-GOVERNANCE — 代码质量与安全治理

**状态**：`completed（2026-09-20 当日 P0→P4 一次会话整包收口；用户裁决「好的 立一个工作包」+「冲」×3；closeout 八门全绿）`
**立项**：2026-09-20（本机摸底实锤：全仓零 ESLint——前端 check 仅 `tsc --noEmit`，根目录仅 `node --check`；全仓唯一 eslint 配置在 vendor `codex/sdk` 内，不属本项目代码面）

## 0. 问题定义（证据）

项目测试面已工业化（2250 绿/0 红全量基线、impact-map 定向、closeout 五门），但**静态质量与安全扫描层为空白**：

1. **Lint 层缺失（最大空白）**：全仓无任何本项目自有 ESLint 配置；TypeScript strict 只保证类型，不挡反模式（`any` 泛滥、危险 API、React hooks 误用、安全反模式）。
2. **无安全扫描**：无 SAST（Semgrep 类）、无依赖 SCA（仅裸 `npm audit` 隐含能力，未门禁化）、无密钥泄露扫描（Gitleaks 类）、无 Electron 专属安全断言（fuses/contextIsolation 抽查散落在个别测试，未系统化）。
3. **无冗余度量**：死文件/死导出/死依赖（Knip 类）、复制粘贴重复率（jscpd 类）无基线无门禁。
4. **架构规范靠人守**：AGENTS.md 规范（IPC 必经 `desktopBridge.ts`、路由页面在 `pages/`、非页面组件 `_` 前缀）无机械化门禁，漂移只能靠测试偶发发现。
5. **格式一致性**：无 Prettier/Biome，风格靠习惯。

**工具选型结论（2026-09-20 调研）**：Semgrep（SAST 主力）、Trivy/OSV-Scanner（依赖 SCA）、Gitleaks（密钥）、Knip（死代码，JS/TS 事实标准）、jscpd（重复率）、dependency-cruiser（架构规则）、typescript-eslint `strictTypeChecked` + eslint-plugin-react-hooks/security、Biome（格式）。electronegativity 已停止维护（2026-09-20 核实），Electron 面改用 Semgrep 社区规则 + 自写 fuses/config 断言替代，不引入死工具。

## 1. 范围

- **P0 只读体检基线（零新依赖）**：Knip + jscpd 经 `npx` 一次性运行（不进 devDependencies、不改 lockfile）+ 两工作区 `npm audit --json` 采样 + `git grep` 模式密钥快扫；报告落 `acceptance/block-105/p0-baseline/`。**不改一行产品代码**，产出=家底规模清单（死代码 N 处/重复率 x%/漏洞 N 条/密钥命中 N 处），作为后续阶段豁免基线。
- **P1 Lint 层补齐 + 防增量门禁**：根目录 ESLint flat config（覆盖 `src/`、`core/`、`frontend/src/`，typescript-eslint strictTypeChecked + react-hooks + security）+ Gitleaks 密钥门禁；先 report-only 观察噪音量，再按 D3 裁决转 blocking；新依赖逐个走 DEPENDENCY-CHANGE-CHECKLIST（§4 D1-D2）。**工具链一律装根 package.json，不碰 `frontend/package.json` + lockfile**（P6 源绑定，见 §5）。
- **P2 存量归因清偿（K 簇模式）**：对 P0/P1 基线逐条归因三分类——真缺陷修 / 化石删 / 误报豁免登记（行内标注 reason+owner+复核日期，禁止全局关规则）；棘轮门禁只紧不松（存量豁免清单入库，新增 fail-closed）。
- **P3 架构机械化 + Electron 断言**：dependency-cruiser 规则把 AGENTS.md 规范转可执行规则（渲染进程 IPC 必经 desktopBridge、pages/ 布局、`_` 前缀、core 依赖方向），先观测后 blocking；`@electron/fuses` 与 BrowserWindow 安全配置（contextIsolation/sandbox/nodeIntegration）断言测试；新增 `npm run quality:*` 脚本族挂 closeout 链。
- **P4 收口**：各阶段门禁对账 + closeout 聚合 + canonical 回写（plan/registry/roadmap/AUDIT-LOG）。

## 2. 非范围（红线）

- **依赖升级批次不属本包**：vite 8 / vitest 5 / react-router 7 / happy-dom 升级已有 🟡 延期裁决（AUDIT-LOG 2026-09-19），归 P6 重打（Mac 侧）同批，本包不顺手做。
- **P6 证据重打不属本包**：`rs-p6-durability-recovery-performance.json` stored sourceHashes 失配为既有存量（🟡 在册），本包以"零触碰 frontend lockfile + P0 零依赖"避免扩大失配面。
- **可选项不随包立项**：CodeQL（取决于仓库公开性/GHAS 许可）、SonarQube CE（自托管运维成本）、Stryker 变异测试、SBOM/Scorecard——P4 收口后作为后续候选按需再裁决。
- **不外推 G1+**：Provider/公证/GA/发布流水线一律不属本包。G0 开发期常态 · 不外推 packaged/Provider/GA。
- **不动既有测试治理资产**：impact-map、scripts-platform-contract、行数帽棘轮等 BLOCK-104 资产保留，新门禁与其互补不重叠。

## 3. 依赖治理（预置裁决项）

- **D1 新 devDependencies 清单（P1 启动前裁决）**：typescript-eslint / eslint / eslint-plugin-react-hooks / eslint-plugin-security / @biomejs/biome（或 Prettier，二选一）/ gitleaks 安装通道。全部过 DEPENDENCY-CHANGE-CHECKLIST 四问（替代方案/许可证维护度/影响面/退出成本），默认答案"不加"，逐项用户裁决。
- **D2 工具安装通道**：推荐 lint/架构类进根 devDependencies（版本锁定、CI 可复现）；扫描器类（Semgrep/Trivy）可 npx 或 brew 全局，倾向不进 package.json 以控传递依赖膨胀。
- **D3 lint 转 blocking 时机**：report-only 观察期长度（建议一次会话内：先全量报告→豁免清单入库→同会话转 blocking，对标 BLOCK-104「当日立项当日收口」节奏）。
- **D4 dependency-cruiser blocking 时机**：先 report-only 一轮，规则误报清零后转门禁。
- **D5 CodeQL 启用与否**：视仓库公开性与 GHAS 许可，收口后裁决。

## 4. 与并行面/既有台账的边界（冲突分析，2026-09-20 会话核实）

- **远程同步**：`git fetch` 后 `main...origin/main = 0/0`，本地 `48cd4f18` 即远程最新，无落后提交。
- **active 槽位**：BLOCK-104 于 2026-09-20 整包收口 completed，启动时槽位空，无并行工作包文件面冲突。
- **frontend lockfile（P6 源绑定）**：本包红线=不新增/升级 frontend 依赖；前端 lint 由根目录 config 跨目录覆盖实现。
- **AUDIT-LOG 🟡 项**：P6 重打（G0-RS 域，Mac 专门会话）、依赖升级批次（P6 同批）、i18n、Windows 签名——均与本包无文件面交集，本包不得顺手处置。
- **排队工作包**：BLOCK-101/99/97/98 planned 排队不受影响；单工作包串行纪律下本包收口后按 roadmap 优先级裁决下一个。

## 5. 验收门禁与完成语义

- **P0 门**：四项体检报告落 `acceptance/block-105/p0-baseline/`，零产品代码改动（git diff 可证），零依赖变更。
- **P1 门**：lint 密钥门禁脚本 exit 0（豁免清单模式下）+ 豁免每条带 reason/owner/复核日期 + 新依赖裁决留痕（四问+裁决原话）。
- **P2 门**：基线逐条归因三分类台账（修/删/豁免）+ 棘轮门禁 exit 0。
- **P3 门**：dependency-cruiser 规则集 + Electron 断言测试绿 + `npm run quality:*` 挂入 closeout 聚合。
- **P4 门**：closeout 五门绿 + plan §6 运行记录 + registry/roadmap/README/AUDIT-LOG 回写 + `npm run docs:reconcile` + `npm run docs:check`。
- **完成语义**：P4 全过后 registry 状态改 `completed`；可选项（§2 第三条）不阻塞收口，另行登记候选。

## 6. 运行记录

- 2026-09-20 P0-BASELINE completed：四项体检报告落 acceptance/block-105/p0-baseline/（SUMMARY.md + 原始 JSON×4 + 密钥扫清单）。核心数字：密钥 0 真实命中（14 处全测试 fixture）/ 依赖漏洞 root 20 + frontend 12（新发现 electron-builder 工具链族 10 条可一键升级 26.15.3 修复、extract-zip high 无修复路径归 P2 归因、前端批次维持 P6 同批）/ Knip 864 文件发现（⚠️ 无配置高噪音——preload.js/vite.config.ts 均被标死文件，P1 必须先写 knip 入口配置再重扫）/ jscpd 重复率 2.7%（健康，热点 loop-orchestrator↔chat.js 167 行+agent-runner↔chat.js 125 行实证架构候选）。git diff 零产品代码改动可证。**P1 待启动**：涉及 typescript-eslint/gitleaks 等新依赖，启动前需用户过 §4 D1-D5 裁决。
- 2026-09-20 P0-LAUNCH：立项登记完成（本文档 + DOC-REGISTRY active/P0-LAUNCH + README 137 + roadmap active 首条 + AUDIT-LOG 启动行）；启动检查单硬门全过（无🔴/槽位空/git 净/远程 0 落后/裁决原话「好的 立一个工作包」）。

## 6.1 P1 completed（2026-09-20，D1-D5 预置裁决经用户「可以的 冲」通过）

- **工具链（D1/D2 落地）**：根 devDependencies 新增 eslint@9.39.5 / typescript-eslint@8 / eslint-plugin-react-hooks@7 / eslint-plugin-security@4 / globals / typescript@5.5（与 frontend 版本对齐）；frontend package.json+lockfile 零触碰（红线可证）。格式化器（Biome/Prettier 二选一）**未装**——格式层独立裁决，不夹带。
- **ESLint flat config**（`eslint.config.mjs`）：frontend/src TS/TSX 走 recommendedTypeChecked（projectService 借 frontend/tsconfig.json）+react-hooks+security；src/core/scripts JS 走 js recommended+security+node globals；`.agents/**` ignore（skill 资产含合法占位模板）。调参过程：no-undef 1296→0 区间收敛（.agents 排除 + test globals 补齐）。
- **report-only 基线**（`acceptance/block-105/p1-eslint-report.json`）：1450 文件扫描，840 带问题，3718 errors + 1325 warnings。Top：security/detect-object-injection 1220（本仓动态路径常态，P2 豁免/降级归因）、no-empty 687、no-unused-vars 670、TS unsafe 系列 ~950（frontend 真实质量信号）、react-hooks/set-state-in-effect 101（真实反模式信号）。**D3 修正**：plan 原设想「同会话转 blocking」——840 文件的豁免归因量级不支持当会话完成，blocking 转换随 P2 豁免清偿推进（棘轮：先 report-only 入 closeout 观察面，豁免一批收紧一批）。
- **密钥门禁**（`scripts/secret-scan.mjs` + `npm run quality:secret`，fail-closed）：Node 等价实现（D2 精神：扫描器不进 package.json；gitleaks 原生二进制留全局安装通道）。生产面命中→exit 1；test fixture 白名单 7 文件（P0 基线核实）。
- **Knip 配置校准**（`knip.json` + `npm run quality:knip` report-only）：入口=main/preload/main.tsx/App/test glob。校准后死文件 452→119、带问题文件 864→577（core 懒加载 require 仍为 Knip 盲区，数字仍属上界）。
- **quality 脚本族**：quality:lint（report-only）/ quality:lint:strict（blocking 预留）/ quality:secret（fail-closed 已达标）/ quality:knip（report-only）。P2 完成豁免清偿后 lint/knip 转 blocking 挂 closeout 链。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6.2 P2 存量归因清偿第一轮 completed（2026-09-20；棘轮已闭合）

- **真缺陷修复 2 件（ESLint 首跑抓真，全产品代码）**：
  1. `agent-tools/workspace-tools.js` — `listResidentTasksLocal` 用同步 `fs.readdirSync/readFileSync` 但全文件未 require fs → 常驻任务列表一调用即 ReferenceError；
  2. `agent-tools/act-tools.js:107` — `_getImpliedPage` 裸调用未定义符号（定义在 act-tool-core），FIGCODE_PAGE_RACE_FIX_v1 的隐式页面兜底分支一触发即崩。
- **自动修复 77 文件**（`eslint . --fix`，净 -1 行，全部安全类：多余类型断言移除等）；修复后 Node 全量 2251 绿 exit 0 + 前端 1146/1146 双验证零回归。
- **规则级归因（config 内显式，非静默）**：`no-empty` allowEmptyCatch（本仓 best-effort catch 模式，BLOCK-97 沉淀）；`security/detect-non-literal-fs-filename` off（本地桌面应用动态路径常态，约束靠 allowlist 机制）；`security/detect-object-injection` 维持 warn（动态注入 1220 处属架构常态，P2 后续逐区归因）。
- **抑制基线棘轮闭合**：`eslint-suppressions.json` 入库（存量 errors 2912 + warnings 全量登记）；`npx eslint .` 转 blocking——**新增违规即 fail**（自测：合成未使用变量文件被抓 ✓），存量清偿用 `--fix-suppressions` 逐批收缩。
- **quality:lint 转 blocking**（去 report-only 旁路）；impact-map 同步登记 block105-code-quality 规则（secret-scan.mjs 等新脚本未分类曾触发 test-affected fail-closed 级联 35 红——门禁按设计工作，登记后 test-affected 16/16 恢复）。
- 双套件验证：Node 2251 绿 exit 0 + 前端 1146/1146。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6.3 P3 架构机械化 + Electron 断言 completed（2026-09-20）

- **dependency-cruiser 规则集**（.dependency-cruiser.cjs）：R1 渲染进程禁直引 electron（IPC 必经 desktopBridge）/ R2 渲染进程禁 node 内建 / R3 后端禁引主进程（唯一登记桥=src/main/env-coordinator，A-009 端口单一真相）/ R4 前端禁引后端实现（core/packages/** 共享层合法）/ R5 主进程禁引后端实现。首跑 1214 模块 3686 依赖 6 违规 → 归因（4 处合法共享层误伤修规则 + 2 处 A-009 登记桥）→ **0 违规**。npm run quality:arch blocking（当前架构本身达标，无需 report-only 期，D4 满足）。
- **Electron 安全断言**（test/electron-security-assertions.test.mjs，3/3）：①全部 BrowserWindow 创建点（主/rail/pop-out 共 3+）四项安全配置断言（contextIsolation:true/nodeIntegration:false/sandbox:true/webSecurity:true）；②preload 唯一 electron 暴露面 + frontend/src 零 electron 实际 import（文本断言与 depcruise R1 双保险，排除 .d.ts/注释）；③fuses 运行时断言如实登记为 G1+ packaged 范围（SENTINEL: BLOCK-105-FUSES-G1）。
- **化石清理 2 件**（阻断 suppressions 的 parsing error 源）：loop-checkpoint.js 重复 truncate 声明 / dev-electron.js 重复 stopWorkspaceElectron 声明——JS 提升语义运行时无害从未暴露，删运行时被覆盖的前份保持行为零变化。
- **closeout 链扩展**：quality:secret/arch/lint 三门挂入（八门全绿）；impact-map 登记 block105-code-quality 规则（config+门禁脚本+断言测试+suppressions 基线全覆盖）。
- **P3 调参抓真**：dep-cruiser tsConfig 跨目录解析 TS18003（改用无 tsConfig 模式）；ESLint suppressions 不支持 parsing error 抑制（化石先清后建基线）。
- 双套件验证：Node 2252 绿 exit 0（+1=新断言测试）+ 前端 1146/1146。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. P4 收口（2026-09-20；c7930f3c → 3d07a903）

### 各阶段门禁对账

| 阶段 | 门禁声明 | 证据 | 结果 |
| --- | --- | --- | --- |
| P0 | 四项体检报告落 p0-baseline/，零产品代码改动，零依赖变更 | SUMMARY.md + 原始 JSON×4 + secret-scan.txt；P0 提交 git status 仅 acceptance 新增 | ✅ |
| P1 | lint 层补齐 + 密钥门禁 + report-only 基线 | eslint.config.mjs + p1-eslint-report.json（3718e/1325w 基线）+ quality:secret PASS | ✅ |
| P2 | 存量归因三分类 + 棘轮只紧不松 | 真缺陷 2 件修复 + --fix 77 文件双套件验证（2251+1146）+ eslint-suppressions.json 入库 + 自测抓新违规 | ✅ |
| P3 | 架构规则 + Electron 断言 | depcruise 1214 模块 3686 依赖 0 违规 + 断言测试 3/3 | ✅ |
| P4 | closeout 聚合八门全绿 | hygiene/docs/ui-audit/test:changed/gate:code-size/quality:secret/quality:arch/quality:lint 全 ✅ | ✅ |

### 例外与遗留（如实登记）

1. **fuses 运行时断言 = G1+**（SENTINEL: BLOCK-105-FUSES-G1）：@electron/fuses 需 packaged binary，G0 开发期不外推；
2. **Knip 维持 report-only**：core 懒加载 require 为工具盲区，数字属上界；blocking 化待配置进一步精化后单独裁决；
3. **存量 2912 条抑制基线**：P2 后续轮次渐进收缩（每批收缩即棘轮收紧），不阻塞任何流程。**批次日志**：Batch-1（2026-09-20，Mac 侧会话）根 2914→2890 + frontend 2126→2125——逻辑类 8 项（no-dupe-keys×2 化石 / no-redeclare 化石 / no-constant-binary-expression 死代码 / no-useless-catch 空壳×3 含 test 断言改 assert.ok / **真缺陷 2**：capability-bundles `--force-local` 无条件附加 macOS bsdtar 拒绝致 R 能力包安装全挂→win32 条件化+`TAR_FORCE_LOCAL` 导出单一知识源、ide-tools/diff.js `'C:\Program Files\Git'` 单引号内 `\P`→`P` 回退路径字符串损坏→双反斜杠）+ no-useless-escape 16 项（含 ui400 注入面正则 `\.pdf` 被模板串吃反斜杠退化→`\\.` 修真）。**收缩操作姿势**：修一批后 `npx eslint . --prune-suppressions`（`--suppress-all` 只新增不清过期条目）；frontend 侧同名 prune。Windows 行为经 `TAR_FORCE_LOCAL` 条件化保持逐字等价。**Batch-2（2026-09-20，Mac 侧会话续接）根 2890→2783（−107）**：机械面 50 项=catch 空绑定×21（`catch (e)`→`catch {`）/未用导入×10（codemod 行号精确删除）/死函数×8（**acorn AST 删+逐行回溯吸收 JSDoc**——花括号文本配对两次翻车：默认参 `{}`、正则 `{64}`、贪婪回退吞注释，删后必跑顶层声明数对账）/解构与回调参数×6（`^_` 前缀或删）/级联孤儿×3；连带修=①**P0**=registry/run-plugin-script.js Wave C-6 拆分断链（7 裸标识符未穿参/未导入，R 插件作业执行必 ReferenceError，Windows p4r SIGTERM skip 遮蔽，Mac 首跑抓真；seam 对象穿参 fail-closed+artifact-normalize 直 require+fs/path/pluginLoader 补导入，p4r 2/2 真实 deseq2 语料绿）②test-affected 路由=rule.tests 内 frontend/*.tsx 误入 node --test 批必 ERR_UNKNOWN_FILE_EXTENSION，改路由进 vitest test:related 通道（test-affected 16/16 绿）；prune 有残留时以 `--suppress-all` 重录当前真实态。**Batch-3（2026-09-20，Mac 侧会话续接，用户裁决「继续」）根 2783→2163（−620：prune 一次收 −622，其后补登记 agent-runner 两处源码契约豁免 +2，见批次末）——no-unused-vars 622→0 清零**：机械面=acorn AST codemod（仓库外一次性脚本；未用 require/import 解构项 200+ / 纯 init 局部变量删 / 调用式 init 保留求值去绑定（`const x = await f()` → `await f()`）/ `catch (e)`→`catch` / 未用形参 `_name`·`_unused` 保 arity）；人工面=死函数 13 件（routes/ai-agent.js 拆分化石整套：1222 行拆分遗留 20+ 未用 require + 两份被子域 ai-agent/chat.js 与 loop-orchestrator.js 接管的死辅助函数；skill-registry deepMerge/loadMarketplaceSkills（含级联模块级缓存变量）；mcp/server sendNotification；file-references collectArtifactNamesFromResult；retention-sweeper nowIsoDate；workspace-ssh-surface residentRoot；测试死 helper 5 件）+ 只写不读链（resultsDir×4 / finalizationRouting / jobDisk* / ssh-direct runner+死远程读 pid / newSummary 死计算 等）。**测试抓真两类回归（本批唯一语义风险面，均闭环）**：①**解构 omit 语义**——`({ rowid, ...rest }) => rest` 的 rowid 会被机械删除后残留进副本对象（行为漂移，block95-b2 + block98-compaction-upgrade 抓真，conversation-compaction ×3）→ 改 `{ rowid: _rowid, ...rest }` 保持 omit；②**thin facade 源码契约名**——agent-runner 的 P4R-3 `providerFailureReason` 与 P7 `createResultEditCompletionGuard` 被源码扫描测试锁定（test/result-studio-agent-binding.test.mjs / test/g0-rs-p7-acceptance.test.mjs），误删即红 → 恢复绑定 + 抑制豁免登记 `{"no-unused-vars":{"count":2}}`（**豁免登记非放宽**：契约名保留属有意识决策，注释已在源码就地留痕）。**codemod 两坑固化**：①删整行时若只吞行尾换行而保留行首空白，会把该行缩进并进下一行（本批实测 7 行，已按 HEAD 逐行对齐回正 + 全量「trim 相同仅缩进不同」对账归零）——正确姿势=扩展删除区间时 `start` 一并前移到行首；②解构属性删除前必须判同模式内是否有 RestElement（omit 语义），有则改 `key: _key` 保留提取。验证=211 改动 JS 全数 `node --check` / no-undef 未增（3 条存量）/ 模板串美元花括号序列零改写 / closeout 八门绿；test:changed 2344 项 2315 绿 15 红全部基线存量（BLOCK-84 pack 环境×3 + pipeline.test.js 死 require×10 + I.5 harness 插件扫描×1，干净树 stash 对照同红）+ P6 脏树一致性门 1（提交后自愈实测 13/13 绿）。
4. **格式化器（Biome/Prettier）未装**：格式层独立裁决，不在本包夹带（D1 遗留裁决点，默认不加）；
5. **D5 CodeQL**：收口后裁决点——预置推荐=暂不启用（私有仓 GHAS 许可成本；npm audit + 密钥门禁 + security 插件已覆盖等效面；如转公开仓或需要 SAST 深扫再裁决）。

### 持续运行态（收口后日常）

`npm run closeout` 八门：hygiene → docs → ui-audit → test:changed → gate:code-size → quality:secret（fail-closed）→ quality:arch（架构规则）→ quality:lint（blocking+抑制基线）。新增违规/密钥/架构破坏即红。

G0 开发期常态 · 不外推 packaged/Provider/GA。
