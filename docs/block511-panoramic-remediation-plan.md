---
capability: block511-panoramic-remediation
status: active
phase: S0-LAUNCH
goal: 全景评估一次性修复包（用户发令「开始 PANORAMIC-REMEDIATION-2026-11-24」／「一次性搞定，要没问题的搞定」）——按 acceptance/project-panoramic-assessment-2026-11-24/ASSESSMENT.md §2/§3/§4/§8 的已核证缺陷与门禁/入口漂移，六阶段严格串行修复，HK-01 红绿先行、零新依赖、主文件只做薄接线并净减行；「没问题」高于「做完」，任一项 3 轮不过即停在阶段边界、保持已提交部分全绿并报卡点。
acceptance:
  - S1 正确性修复 1.1-1.5 全部 HK-01 红→绿，test:changed 除已登记存量红外零新增红，独立提交
  - S2 W5a / gate:code-size / gate:tracked-consistency 绿，推送后 gh 确认 CI 至少一次全绿，独立提交
  - S3 block405-l1-security / g0-chf0-http / env-coordinator-trusted-origins / block239-mcp-oauth / block258-mcp-tail 与新增安全测试全绿，quality:secret 绿，独立提交
  - S4 CSP 单测 + 首屏静态扫描 + tsc 0 + theme-token 契约绿，dev Electron 实机腿（零 CSP 违规/SSE 与聊天流/3D 卡展开、three 独立 chunk），独立提交
  - S5 docs:check / ui:audit:check / hygiene:check 绿，独立提交
  - S6 closeout:full 全绿（存量红逐条归属）、test:all:sharded --all 留存原始输出、dev Electron 实机腿汇总、REMEDIATION.md 逐项对照、六件套回写
reopen: 任一修复回归、CI 再次出现红门、或实机暴露新缺陷时按证据重开
supersedes: 无（PANORAMIC-ASSESSMENT 的修复执行包）
---

# BLOCK-511 · 全景评估一次性修复包（2026-11-24）

> **发令**：用户「开始 PANORAMIC-REMEDIATION-2026-11-24」=「一次性搞定，要没问题的搞定」。本提示词即预授权：范围内改动连续推进、不必逐项再问；没写的范围一律不做。
> **基线报告**：`acceptance/project-panoramic-assessment-2026-11-24/ASSESSMENT.md`（四域只读评审 + 主代理逐条读证据行核证，5 条 P1 + 7 条 P2）。
> **证据目录**：`acceptance/panoramic-remediation-2026-11-24/`。

## 1. 范围与阶段（严格串行，上一阶段出口全绿并提交后才进下一阶段）

- **S1 正确性修复**：§2 第 1/2/4/5/10 项——流重试正文重复、缓存清理 fail-open、Cmd+Q 退出守卫、排队消息挂载清空、require 路径与漂移门。出口：HK-01 全绿 + test:changed 零新增红 + 独立提交。
- **S2 门禁自洽**：W5a 清红、测试入口递归、去个人绝对路径、gate:tracked-consistency、棘轮上调留因、CI 静态门禁。出口：W5a / code-size / tracked-consistency 绿 + CI 全绿 + 独立提交。
- **S3 本机边界与加固**：§2 第 3/6/7/8/9 项——请求边界、工作区文件读取与 file:open-path、命令风险可见性、Express 错误处理、web_fetch 重绑定。出口：安全测试全绿 + quality:secret 绿 + 独立提交。
- **S4 端口与首屏**：§2 第 11/12 项——CSP 按实际端口生成、首屏 3D/graph 懒加载。出口：HK-01 CSP 单测 + 静态扫描 + tsc/theme 绿 + dev Electron 实机腿 + 独立提交。
- **S5 入口归位**（纯文档，只改事实性数字与指针、不改纪律条文）：AGENTS.md、roadmap/registry 指针、过期更新链归档、README/CHANGELOG、AUDIT-LOG 表格格式。出口：docs/ui/hygiene 绿 + 独立提交。
- **S6 总验证与收口**：closeout:full、test:all:sharded、实机腿汇总、REMEDIATION.md、六件套回写、NEXT-STEP-BRIEF。

## 2. 非范围与红线

- 不碰 G1+（Provider 矩阵、公证签名、GA、远程发布、dist staleness）。
- 不重开既有裁决：风险命令命中清单仍「默认放行 + 可见」；MCP 命令白名单仍只在显式设环境变量时生效。
- 修复包零可见界面观感变化；一旦出现即停下报告。
- 零新依赖；新增逻辑落新子模块，主文件只做薄接线并净减行（loop-orchestrator 基线 1674、src/main.js 920、SimpleChat.tsx 1944）。
- 共享台账每次写入前重新读取最新内容、只做追加式修改；提交显式路径，禁止 `git add -A` / `git add .`；push 前先 fetch，origin/main 前进时仅在无他人未提交跟踪改动下 rebase，禁止 stash/checkout/reset 他人改动。
- 工作树中 19 项未跟踪 WIP 属他包/用户资产，零触碰、不纳入本包提交。

## 3. 基线红绿（S0 现读，收口对照）

| 门 | 基线 | 归属 |
|---|---|---|
| docs:check | PASS (665) | — |
| ui:audit:check | PASS | — |
| hygiene:check | PASS | — |
| quality:secret | PASS | — |
| quality:arch | PASS | — |
| quality:lint | PASS | — |
| quality:types | PASS | — |
| gate:css-modules | PASS | — |
| gate:arch-cycles | PASS | — |
| test:changed | PASS (Node 228/228 + 前端 6/6) | — |
| gate:code-size | FAIL（7 行：SimpleChat.tsx 1952>1944 行数+指纹、simple-chat.css 5494>5469 行数+指纹+字节、src/main.js 925>920 行数+指纹） | QODER-A2/L5 11-23 增长未重打基线，本包 S1/S2 清 |
| quality:knip:check | FAIL（2 新增：`exports::src/ipc/utility-host.js::ACTIVE`、`shutdownUtilityHosts`） | 待归属，本包 S2 核 |
| W5a（nso-w5-impact-coverage） | FAIL（3 个已入库测试未挂规则：p6-driver-iframe-probe / p6-pack-scheme-privileges / utility-host-decision） | 存量，本包 S2.1 清 |

原始输出：`/tmp/panoramic-baseline/*.log`（S6 前归档入证据目录）。

## 3.1 S2 测试入口补全留因（2026-11-24）

- **删除 `test/pipeline.test.js`**：该文件 365 行，全部依赖 `../core/gateway/pipeline`（`executePipeline` / `PipelineError`）。现读 `core/gateway/` 目录已不存在（OSS 解耦/架构迁移后生产代码删除，见 `docs/dependency-decoupling-checkpoint.md`），测试无对应生产代码、无法修好，按提示词「已无对应生产代码的删除并在 plan 留因，不得用 skip 掩盖」删除，非 skip 掩盖。
- **保留并挂规则**：`test/block67-node-agent-fs.test.js`（依赖 node-agent/workspace-gateway 均在，37 有效断言 + 1 darwin BSD find 显式 skip 属既有平台分支）、`test/scripts/check-ui-productization-audit-exit-2.test.mjs`、`test/scripts/dev-launch-state.test.mjs`（依赖脚本均存在）三件验证有效，挂入对应 impact-map 规则。

## 3.2 S3.5 web_fetch 重绑定遗留登记（2026-11-24）

- `core/petri-server/helpers/web-fetch-policy.js:303-317` 逐跳 `resolveHostAddresses` 校验通过后才 `fetchImpl(parsed.url)`；因 `fetchImpl` 为可注入参数（block247 / qoder-l1l2-wiring 契约），把连接钉在校验 IP 上要么改用 `node:https`+`lookup` 重写入口（破坏注入契约与 TLS SNI/证书校验），要么引入新依赖（违反零新依赖）。按提示词「做不到零新依赖又不破坏这些测试，就保持现状并登记为遗留，不得削弱现有防护」——**保持现状**：逐跳重校验/私网拒绝/重定向记账全部保留，DNS 重绑定间隙登记为遗留。不做半吊子 pin-IP，不削弱现有防护。

## 4. 验证节奏与决策工具

- 每修复点 HK-01 红绿先行；定向测试优先（`test:changed` / `node --test` / `test:files --prefix frontend`），全量门留 S6。
- 决策工具到点即跑：规划定向测试前 `test:suggest`、台账回写前 `doc:suggest`、失败归因 `block114-failure-triage`、下一步 `next:suggest`、收口声明 `output:judge`；结果如实附交付说明（零建议不是故障）。
- Jev 计数取 `npm run decision:session` 分段口径，每次收尾重跑取双数字。

G0 开发期常态 · 不外推 packaged/Provider/GA。
