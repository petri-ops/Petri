# item 86 部分（verify:clean + arch-cycles 修绿）— 验收证据（2026-11-27）

## 范围声明

本批只覆盖 item 86 两个不搭界项：verify:clean 一条命令 + arch-cycles 门修绿。
快照测试归 seat 的 88 第二波，不在本批。Acceptance 只证明其契约声明的范围。

## 1. verify:clean（把 CI 的严格性搬到本地）

- `scripts/verify-clean.mjs` + `npm run verify:clean` + AGENTS.md 开发命令登记。
- 流程：脏树预检拒绝（exit 2，不代 stash）→ 临时目录 `git clone --local`（HEAD 全新 checkout，
  零本机 node_modules/增量缓存）→ npm ci（根+frontend，`--skip-install` 供自测）→
  逐门执行（默认 = desktop-ci 工作流等价集：11 静态门 + platform 5 文件 + harness:check/phase6 +
  工具单测 8 文件 + 前端 tsc + build:spa；`--gates` 可收窄/自定义）→ 失败即停打印输出尾部（exit 1）→
  清理临时目录（`--keep` 排查）。
- HK-01 自测（`test/item86-verify-clean.test.mjs`，红4→绿4）：
  - HK-86-6 干净 fixture 目录跑通（克隆→假门→PASS→临时目录清理断言）
  - HK-86-7 脏 fixture 跑红（exit 2 + 点名脏文件 + 不创建临时目录断言）
  - HK-86-8 干净目录门失败 → 如实红并报出门名
  - HK-86-9 默认门清单 = CI 等价集（防漂移钉，逐成员断言）

## 2. arch-cycles 修绿（真解耦，零豁免）

基线 13 环（11 现存 + 2 已消亡）→ **0 环**；forbidCycles 规则照跑，无 pathNot/ignore 豁免。

| 族 | 环 | 解法 |
| --- | --- | --- |
| A | agent-runner → agent-tools/index → {interceptor,tool-defs,tool-execution} → registry → spawn-agent-tools → agent-runner | spawn-agent-tools 反向 require 改 `helpers/kernel-registry.js` locator（组合根注册/消费方 get，未注册 fail-fast） |
| B | agent-runner → agent-fallback（→ routes/ai-agent/resume）→ agent-runner | agent-fallback/resume 默认分支改 locator（deps 注入优先语义不变） |
| C | goal-tools → automation-store → registry → goal-tools | automation-store 内置名单改 locator（registry 加载即注册） |
| D | registry ↔ tool-defs | tool-defs 纯数据化：getToolDefs 删除，单一实现归位 registry.getProviderToolDefs（index barrel 兼容转出；8 个测试导入同步改） |
| E | guest-permissions ↔ permissions | 纯契约面（MODULE_KEYS/DEFAULT_PERMS/解析/归一化）抽 `helpers/permissions-contract.js`，图单向化 |
| F | PetriOpenFileDevBridge 自环 | 自引用 re-export 改同模块直出 default |
| G | FileTreeItem ↔ FileTreeList | 组件并入 FileTreeItem.tsx（逐字未动），原文件 barrel re-export，导入路径不变 |

- 值岗断言双钉：`test/post-s7-h9-cycle-decay.test.mjs`（基线 13→0 收紧，回退即红）+
  `test/item86-kernel-registry.test.mjs` HK-86-4（源码级禁反向 require agent-runner/registry）
  + HK-86-5（真加载组合根后 locator 命中，含 DB 自举）。
- HK-01 红绿：locator 测试红5→绿5；环解耦后 cruise 现存环 11→0。
- 测试假件迁移：block93-agent-roles / block49-phase2-tools 的 require-cache 假件注入改向 locator
  显式注册**同一假件**（记录调用、不触真实模型语义不变）；block93-role-prompt 为真链路测试，
  显式加载组合根。

## 顺笔修两例上游错位（被更早的门挡住未暴露，如实登记）

1. item84（9048486a8）把 `acceptance/item84-3d-fallback/**` 误入 impact-map **tests** 数组 →
   test:changed 解析即红；移回 patterns。
2. post-s7-h9-cycle-decay 钉 12 而基线实 13（11-24 起红，被 closeout 前置门挡住）→ 本批一并收紧到 0。

## 门禁证据（CI 等价，2026-11-27 本地）

- 11 静态门全绿：docs:check ✅ · ui:audit:check ✅（同批 UI 台账登记零观感变化）· quality:secret ✅ ·
  quality:arch ✅ · quality:lint ✅（0 errors）· quality:types ✅ · gate:code-size ✅
  （--allow-grow 留因：agent-runner +4=组合根注册接线）· gate:css-modules ✅ · gate:arch-cycles ✅
  （0 环）· quality:knip:check ✅ · gate:tracked-consistency ✅
- platform：35 测 33 绿 2 live-skip；harness:check ✅ + phase6 64 绿 + 工具单测 106 测 104 绿 2 skip
- 前端：frontend check（tsc）✅ + build:spa ✅ + project-workspace 邻域 17 文件 105/105
- core 邻域：spawn/权限/调度/orchestration 24 文件 222/222；`test:changed` 2014 测 1996 绿 /
  **11 红经 base 回退（stash→5493dfda0 复跑）全部存量**：capability-bundles ×3、配置注册表冻结、
  approval-request-store、block171-guard-ack、silent-catch（schema.js 52>51，item88 存量）、
  TTS D1/D2、P6、W5a——非本批引入、未放宽任何门。
- 本批曾引入 3 红，均当批修复：domain-neutrality d7（--update + compat 白名单登记 legacy
  权限键别名搬移）、agent-runner 行棘轮（重锚 1038→1042 留因 + code-size --allow-grow 同因）、
  UI 台账缺登记（补记零观感变化批注）。

## 真跑首验（verify:clean 对本仓完整三跑，坑与修均留钉）

1. 第一跑：门「ci」红——resolveGateSteps('ci') 的 if/else 链推完 11 静态门后未 continue，
   字面量 'ci' 又落 npm script 兜底（仓内无此脚本）。修=递归 pushPreset 展开；HK-86-10 补钉
   （默认 17 步/无字面量预设名/static=11/ci≡默认）。
2. 第二跑：门「frontend check (tsc)」红——显示名被当 script 名直传 npm run。修=script 字段与
   显示 name 分离（check @frontend）+ 去 --silent 保失败可见；HK-86-10 补 script/prefix 断言。
3. 第三跑：**PASS——全新 checkout 上 17 步全绿（98.7s，npm ci 根+frontend，零本机脏状态依赖）**：
   11 静态门 + platform（node --test 5 文件）+ harness:check/phase6 + 工具单测（8 文件）+
   frontend tsc + build:spa。

两次真跑各暴露一个单元自测测不出的集成坑且均当跑修复留钉——正是 verify:clean 存在的价值实证。

## 约束遵守 / 待办

- 基座 merge-base = 5493dfda0（=origin/main HEAD，0/0 分叉）；零触碰 copilot/**、workspace-panels/**
  （LeftPanel 环上游已消亡，未触碰该领地）、build/afterPack.js；未 push。
- 分支 codex/item86-verify-clean-arch-cycles，三提交：291eede32（主批）/ 79800bc1c（ci 预设修）/
  04cce90de（frontend script 分离修）。
