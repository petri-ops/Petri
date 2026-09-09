---
name: gewu-dev-infra
description: Use Gewu development infrastructure when starting or resuming a session, before claiming a work-package closeout, verifying UI work against the dev Electron stack, checking workspace hygiene, authoring or validating product Skills, or delegating tasks to subagents. Self-contained toolkit bundled in this folder scripts, templates, principles, and a PORTING guide for reuse in other repos.
---

# Gewu Dev Infra（开发基础设施 · 自洽工具包）

把重复的开发实践固化成机械门禁；只固化流程与判据，永不固化状态类事实（状态只活在 canonical 文档）。

## 本文件夹就是资产的 canonical 家（拷走即复用）

```
.agents/skills/gewu-dev-infra/
├── SKILL.md                        # 本文件：流程入口
├── PORTING.md                      # 跨仓库复用指南（拷贝 + package.json 接线 + 可移植性矩阵）
├── scripts/                        # workspace-state / hygiene-check / closeout-gates（位置无关）
├── dev-verify/                     # lib.cjs 四原语 + run.cjs 注册表 + flows/ + _template.cjs
├── templates/delegation-contract.md# 子 Agent 委派任务书模板
└── references/PRODUCT-PRINCIPLES.md# 产品原则参考（非 canonical；canonical=AGENTS.md+governance skill）
```

仓库内由 `package.json` 接线：`npm run state / hygiene:check / closeout / verify`；产品 Skill 工具 `skills:check/scaffold` 是产品轨道（`scripts/skill-scaffold.mjs`），不在本包内。

## 开始或恢复会话

- 先跑 `npm run state`：分支/WIP、AUDIT-LOG 未决（🔴 先处理、🟢 评估）、active 工作包。
- 输出与 canonical 文档冲突时以 canonical 文档为准；本命令是聚合呈现，不是第二真相源。

## 宣称收口之前

- 跑 `npm run closeout`（hygiene → docs:check → ui:audit:check → test:changed，fail-fast）；当前工作包有专项门禁时用 `--gate <npm-script>` 挂上。
- 门禁全绿是收口的必要条件不是充分条件：canonical 回写（work package / roadmap / handoff / AUDIT-LOG / ui-audit 台账）仍按治理纪律单独完成。
- 属于其他线/并行包的红旗如实登记归属，不得表述为本包通过。

## dev 栈上验证 UI 工作

- 前置：dev Electron 以 `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"` 在跑（fnm Node 24）；后端代码变更后必须重启 dev Electron。
- 从 `dev-verify/flows/_template.cjs` 拷贝新建 flow，用 `dev-verify/lib.cjs` 原语组装断言（pollTargets / filterPageTargets+selectPageTarget / evalJs / screenshotPng / createRun），跑 `npm run verify -- <flow>`；清单 `npm run verify -- --list`。
- 主窗判定按项目树+右栏探测，不信任 visibilityState（BLOCK-68 教训）；证据 JSON/PNG 落 `acceptance/`，断言不可编造。

## 保持工作区干净

- `npm run hygiene:check` 报告死符号链接与临时残留；它只报告不代删，处置由人裁决。
- 未跟踪的在制文件是别的包的 WIP 时只列出，绝不清理、绝不误入本包提交。

## 编写产品 Skill（resources/skills/）

- `npm run skills:scaffold -- --scaffold <id> --name "<名称>"` 生成骨架 → 在 `resources/skills/manifest.json` 登记 → `npm run skills:check` 全绿。
- 两条轨道不要混：产品 Skill（`skill.json`，服务应用运行时 skill-registry）住 `resources/skills/`；Agent 实践资产（`SKILL.md`，服务 AI Agent）住 `.agents/skills/`。

## 委派子 Agent 工作

- 按 `templates/delegation-contract.md` 填任务书；哪个区块填不满，说明该任务还不该委派。
- 子 Agent 的完成声明不构成收口：主 Agent 复核 diff + 复跑验证命令后才可集成宣布。

## 复用到其他仓库

读 [PORTING.md](./PORTING.md)：整目录拷贝 → package.json 四行接线 → 按可移植性矩阵处理降级项。原则速查见 [references/PRODUCT-PRINCIPLES.md](./references/PRODUCT-PRINCIPLES.md)（非 canonical）。
