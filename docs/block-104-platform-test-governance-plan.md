# BLOCK-104-PLATFORM-TEST-GOVERNANCE — 平台与测试确定性治理

**状态**：`active（2026-09-20 用户裁决「要治 全方位的治理」立项即启动；上下文=用户问「Windows/Mac 部署代码是否有明确区分还是会冲突」+ 本会话平台现状评估 + 全量套件确定性/并发双缺陷实锤）`
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
- **P3 平台与环境门纪律**：真平台专属测试显式 `process.platform` 门（skip 输出原因）；环境依赖（gewu-pack-bio 仓缺失类）探测后 skip 带指引；在册存量红（P6 源绑定/F2 PDF）skip 带 AUDIT-LOG 指针——**skip 必须可见可计数，不得静默**。
- **P4 scripts 双端同形门**：全部 scripts/*.sh 补 uname 分支或 `# platform:` 标注；调用 powershell/wscript/taskkill 的 Windows 专属脚本补入口平台护栏（非 win32 fail-fast 带清晰报错）；机械门禁 `test/scripts-platform-contract.test.mjs`（无守卫且无标注=红，豁免集内嵌门禁本体）；process.platform 散落分支冻结登记门禁（登记 74 文件基线，新增 fail-closed）。
- **P5 全量基线重采 + 收口**：`npm run test:all` 真 exit 0（退出码直采不经管道消费方）+ 前端 1146/1146 + closeout 聚合 + canonical 回写。

## 2. P0 归因矩阵（运行记录补记）

（P0 执行后填）

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
