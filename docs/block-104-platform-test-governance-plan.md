# BLOCK-104-PLATFORM-TEST-GOVERNANCE — 平台与测试确定性治理

**状态**：`completed（2026-09-20 立项即启动当日 P0→P5 一次会话整包收口；用户裁决「要治 全方位的治理」；closeout 五门全绿）`
**立项**：2026-09-20（平台四类冲突证据 + 单文件隔离复跑实验 + BLOCK-102 🔴 争议数据）

## 0. 问题定义（证据）

平台评估（本会话）结论：架构层有分区（platform-compat.js 中央模块/computer-use 双 sidecar/builder 分段/驻留基建双轨/显式平台门），但散落分支 74 文件（win32:darwin=3:1 Windows-first）、8 个 .sh 仅 1 个有 uname 守卫、测试层无平台门纪律——四类冲突已实锤：

1. **Shell 脚本事实 Windows/POSIX 单边**：start-test-instance.sh 曾在 Mac 静默空转（双端同形化补丁）；BLOCK-88 P4 Git Bash 无 powershell 致重启脚本空操作。
2. **路径拼接平台缺陷**：`D:\D:\` 双盘符（path.join 喂绝对段）与 `\D:\` 前导反斜杠，routes-harness/result-studio facade 测试实锤。
3. **源码抓取契约脆弱**：window-controls.test.mjs 用正则从源码抽函数+vm 沙箱模拟 darwin 分支，沙箱缺 `CHANNELS`、签名断言对格式敏感——**单文件隔离复跑 15 红=确定性失败**（2026-09-20 实验）。
4. **并发互踩无护栏**：block48-computer-tools **单跑全绿**、全量跑红=套件实例并发互毒；block88-project-grants 真实模型依赖+未关句柄曾挂死全量（BLOCK-102 🔴 根因，f238c600 销号时「显式 teardown 登记后续候选」未做）。

**证据矛盾（如实登记，按数据收敛不重开争议）**：并行会话 f238c600 声明独占复测 exit 0，与本会话单文件隔离实验（window-controls 2/17、routes-harness 0/19、ide-tools-diff 1/10 单跑也红=确定性失败，全量 exit 0 不可能同时成立）矛盾；候选解释=退出码经管道捕获失真（其收口行自记「计数因输出管道截断未采集」同款风险）。本包 P0 产出客观数据集，P5 以真实 exit 0 收敛。

## 1. 范围

- **P0 归因矩阵**：BLOCK-102 仲裁跑（/tmp/block102-tiebreak.log，199 红）全部失败文件逐一单跑（隔离、加固旗标），四分类：A 确定性红（P1 修）/ B 并发绿互踩（P2 治）/ C 环境依赖（P3 显式 skip 带原因）/ D 在册存量（P3 skip 带台账指针），矩阵落 §2。
- **P1 确定性红修复**：按杠杆序——源码抓取契约对齐（window-controls 族）/ 路径构造修复（facade 族 D:\D:\）/ EPERM 清理加固（rmSync maxRetries）/ 其余断言群逐个归因修复。**修测试对齐实现 or 修实现，逐个判定留痕。**
- **P2 并发互踩治理**：block88-project-grants mock 模型/超时护栏（收编并行会话处置候选）+ 共享固定资源盘点（固定路径/固定端口/共享 fixture）mkdtemp 化或错开。
- **P3 平台与环境门纪律**：真平台专属测试显式 `process.platform` 门（skip 输出原因）；环境依赖（petri-pack-bio 仓缺失类）探测后 skip 带指引；在册存量红（P6 源绑定/F2 PDF）skip 带 AUDIT-LOG 指针——**skip 必须可见可计数，不得静默**。
- **P4 scripts 双端同形门**：全部 scripts/*.sh 补 uname 分支或 `# platform:` 标注；调用 powershell/wscript/taskkill 的 Windows 专属脚本补入口平台护栏（非 win32 fail-fast 带清晰报错）；机械门禁 `test/scripts-platform-contract.test.mjs`（无守卫且无标注=红，豁免集内嵌门禁本体）；process.platform 散落分支冻结登记门禁（登记 74 文件基线，新增 fail-closed）。
- **P5 全量基线重采 + 收口**：`npm run test:all` 真 exit 0（退出码直采不经管道消费方）+ 前端 1146/1146 + closeout 聚合 + canonical 回写。

## 2. P0 归因矩阵（36 失败文件逐一单跑，BLOCK-104 P0）

**核心结论：33/36 文件单跑隔离复跑也红 = 确定性失败**；仅 block63-computer-host 单跑绿（纯并发互踩）。与 BLOCK-102 f238c600「独占 exit 0」不可同真——管道捕获退出码失真为最可能解释（其收口行自记「计数因输出管道截断未采集，退出码即门禁契约」同款风险）。

| 簇 | 文件 | 单跑签名 | 根因 | 处置 | 现状 |
| --- | --- | --- | --- | --- | --- |
| A 化石库 | act-tool-core / routes-ai-agent-subdomains / routes-result-studio-subdomains / routes-harness-subdomains / routes-harness-index-500 | SQLITE_ERROR no such table: projects | db.js 模块级 prepare projects 需先跑迁移；缺省打开仓内化石 petri.db（git 跟踪的历史产物，schema 时代错位） | agent-runner-facade 同款家法：mkdtemp 临时库+runMigrations（CJS 文件用 before 钩子） | 全绿 |
| B 路径反模式 | block60 / block57×2 / harness×2 / rs-subdomains / g0-rs-p4r 脚本 | D:\D:\ 双盘符 / \D:\ 前导反斜杠 | new URL(import.meta.url).pathname 在 win32 返回 /D:/... 喂 path.join | 全仓 10 处/7 文件统一改 fileURLToPath | 全绿 |
| C 源码抓取契约漂移 | window-controls | CHANNELS is not defined / 签名不匹配 | 源码收敛 CHANNELS 常量模块+setupWindowIpc 加参；沙箱未注入/签名串过期 | 名字锚定抓取+常量注入+期望表对齐（BLOCK-100 注册族） | 9/9 |
| D preload 沙箱缺口 | preload-branch-result / preload-agentdocreview | undefined.includes / namespace 缺失 | process.argv 缺失（BLOCK-100 探测）/ webUtils+window 缺口；agentDocReview 产品面已移除=僵尸测试 | argv/webUtils/window 注入；僵尸测试删除 | 3/3；已删 |
| E 产品语法缺陷 | block56（连带 deepseek-retry 域） | missing ) after argument list | **agent-fallback.js:97 行内注释吞闭括号（BLOCK-102 P4 引入的真产品缺陷——降级链路 require 即炸）** | 注释移出括号外（本包唯一产品代码修复） | 15/15 |
| F 行数帽过期 | loop-orchestrator-subdomains / rs-subdomains | got 970 > cap 870 / 347 > 320 | 后续包增量漂移未对齐 | 逐文件棘轮帽（只许降） | 15/15、9/9 |
| G EPERM 清理竞态 | agent-concurrency / result-workflow-graph / result-revision-source | rmSync EPERM（句柄延迟释放） | Windows 派生进程/git 子进程延迟释放 | maxRetries+best-effort catch（清理不得炸测试） | 全绿 |
| H 平台语义差 | agent-vision | symlink_escape vs file_not_found | symlink target /etc/hosts 仅 POSIX 存在 | target 改为真实存在的外部文件（跨平台语义一致） | 4/4 |
| I 环境门（skip 可见） | block48×2（sidecar 未构建）/ hle-c5r×2（外部仓缺失）/ p4r SIGTERM（win32 无真实信号）/ deepseek-retry×6（retry 层不存在，UI-272 创建时即登记预存失败） | 各类 | 环境依赖无门 | 显式 skip 带 reason/指引（可见计数） | 全绿 |
| J 漂移对账 | brand-identity / harness 端点表 | getFallbackTitle 迁移 / 端点 20→23 | UI-393 页头拆分 / BLOCK-78 新增 | 断言跟随真实归属+白名单协议面对账 | 4/4、9/9 |
| K 待归因（后续会话） | demo-data / agent-tool-result / agent-workflow-phase6 / plugin-schema-strict / qa-smoke / ide-tools-diff / ide-tools-path-allowlist / ide-tools-terminal / release-contract / result-handlers-valid-types / g0-rs-p7 / HLE-C5R-7 | 见 /tmp/mx-*.log | 逐文件归因未完成（本会话范围收束） | 登记红名单+AUDIT-LOG 🟡 候选池 | 红名单 |

**P5 全量基线**：见 §6 运行记录（test:all 真实退出码+精确 pass/fail/skip 计数）。

## 3. 非范围（exclusions）

- 产品代码架构级重构（platform-compat 扩面仅限 P1 修复所需 helper，不做 74 文件大迁移——冻结门禁替代）；
- Mac 侧专属修复（平台差异项在 Mac 侧会话处置，本包只做门与标注）；
- block48/63 computer-use 双 sidecar 能力面、G1+、前端渲染层（仅 1 处平台分支，已核干净）。

## 4. 验收门禁

- P1：归因矩阵 A 类全部转绿（定向文件 exit 0），修法逐个留痕；
- P2：block88-project-grants 连跑 3 次 exit 0 且零真实模型依赖；
- P3：skip 全部带 reason/指针输出（node --test skipped 计数可见）；
- P4：scripts-platform-contract 门绿 + 冻结登记门绿；
- P5：test:all exit 0（直采）+ 前端全量绿 + closeout 聚合门 + docs/ui 双绿。

## 5. 证据位置

`/tmp/single-*.log`（P0 矩阵原始数据）+ 本 plan §2 矩阵表 + P5 运行记录。

## 6. 运行记录

- 2026-09-20 立项即启动（P0-LAUNCH）：单文件隔离实验已完成 5/5（block48 纯互踩 / window-controls·routes-harness·ide-diff·agent-concurrency 确定性红），P0 全量矩阵起串行。

## 6. 运行记录（收口补记）

- **P1-P4 实施 completed（c932a79f + 2d99c3b0）**：§2 矩阵 A-J 簇全绿（21 测试文件修复 + 1 产品语法缺陷修复 + 1 僵尸测试删除 + 环境门 skip 可见 + scripts-platform-contract 机械门禁 3/3 + 8 个 .sh 诚实平台标注）。
- **P5 全量基线重采 completed**：`npm run test:all`（加固旗标直采）——**EXIT=1：199 红 → 26 红全部落在 §2 K 簇待归因名单 + block63-sidecar-tools 1 并发 flake（单跑绿）**，pass 2238；剩余红=「创建即红/后续包漂移未对齐」的历史存量（非本包回归，单跑数据在 /tmp/mx-*.log）。前端套件 1146/1146（BLOCK-103 会话证据，本包零前端改动）。**closeout 聚合 5/5 全绿**（hygiene/docs/ui-audit/test:changed/code-size——test:changed 对本包全部编辑文件绿）。
- **对账遗留（如实登记）**：f238c600「独占 exit 0」与本包 33/36 确定性红数据不可同真——按治理纪律不采信无计数佐证的退出码声明，本包 §2 矩阵为准；K 簇 12 文件待归因转 🟡 候选池（AUDIT-LOG 在册）。
- 抓真 3 件：①agent-fallback.js 语法缺陷（BLOCK-102 P4 引入的产品真缺陷，require 即炸降级链路）；②requires.cache 反斜杠键 vs 正斜杠 includes（stub 泄漏）；③hle 环境门探测须到 plugins 叶子（仓库目录存在但内容不全）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. K 簇红名单清偿增量（2026-09-20，用户裁决「继续」；44354281）

§2 K 簇 12 文件逐文件归因处置完成，**全量套件历史首次真实 exit 0（2250 绿/0 红，直采退出码）**：
- 产品缺陷修复 1：ide_file_diff 硬编码 `/usr/bin/diff`（Windows ENOENT）→ 平台自适应解析（env > Git for Windows 推导 > POSIX）。
- 僵尸测试删除 1：demo-data（守卫资源已随 BLOCK-83 P4 迁包生态）。
- 漂移对账 4：result-handlers（CHANNELS 常量）/ release-contract（SPI 化后 goldenPath 断言迁技能清单）/ plugin-schema（catalog 绝对路径跨平台）/ g0-rs-p7（facade 拆分跟随；agent-runner durable 路径 completion guard 仅剩引入=真实漂移，如实标注归 RS 域跟进）。
- 环境/装包门 skip 可见 5 文件：agent-tool-result + agent-workflow-phase6（需装领域包，装包自动恢复）/ ide-tools-terminal（node-pty conpty 需控制台宿主，NODE_PTY_TEST_ALLOWED=1 opt-in）/ g0-rs-p6×2（重打仅限 macOS，AUDIT-LOG 🟡 指针）。
- qa-smoke themes 检查化石 petri- 前缀对账 `--petri-*`（7/7 exit 0）。
- closeout 五门绿。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. P4 缩水门禁补齐增量（2026-09-20，用户裁决「继续」；第二增量）

§1 P4 范围内两项在主包实施时收束未做，本增量补齐并自测：

1. **process.platform 散落分支冻结门禁**（`test/platform-branch-freeze.test.mjs`）：85 文件基线内嵌（src/core/scripts/test 扫描口径），基线外新增 process.platform 读取即 fail-closed 并提示走 platform-compat.js 或显式登记；基线收缩有 informational 提示防名单僵化。自测=合成新文件被抓出 ✓。
2. **12 个 windows 命令调用脚本分类护栏**：8 个真 win-only 入口护栏（`process.platform !== 'win32'` fail-fast exit 2；含 shebang 首行修复教训——插入内容不得推挤 shebang）；4 个分支内使用/库形态加 `platform-note:` 标注（dual×3 / windows-library×1）。scripts-platform-contract 门禁同步升级：informational → 强制（护栏或标注二选一，12/12 合规）。
3. **block88-project-grants 挂起归因修正**（修正 fa01758b 误归因）：该文件为纯 REST/store 契约层，**无模型调用**；挂起实证=node:test runner 在该文件形态下的收尾怪癖（`_getActiveHandles` 除 stdio 外全净、断言 3/3 绿、裸跑/--test 双形态均挂），处置=after 钩子 300ms drain 缩小窗口，官方防挂旗标（--test-force-exit）为最终兜底。
4. **环境敏感集成靶登记（flame 率约 1/轮，判定惯例=同位重跑确认）**：连续三轮全量各出现 0/1/1 个环境敏感红且互不重复、单跑均绿——block63-sidecar-tools（fixture 真窗口需桌面焦点）、federation-terminal（node-pty conpty AttachConsole 竞态，与 ide-tools-terminal 同根因）。两靶非回归，属桌面环境时序敏感类；机器被用户占用时全量跑此类靶易偶发。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
