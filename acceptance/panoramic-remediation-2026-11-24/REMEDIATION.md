# BLOCK-511 · 全景评估一次性修复包收口报告（2026-11-24）

> 发令：用户「开始 PANORAMIC-REMEDIATION-2026-11-24」=「一次性搞定，要没问题的搞定」。六阶段严格串行，每阶段出口全绿并提交后推进下一阶段。
> 基线报告：`acceptance/project-panoramic-assessment-2026-11-24/ASSESSMENT.md`（5 P1 + 7 P2 + 门禁/入口漂移）。

## 一、逐项对照报告 §2（12 条已核证缺陷）

| # | 级别 | 缺陷 | 处置 | 提交 | 证据 |
|---|---|---|---|---|---|
| 1 | P1 | 流重试正文重复下发 | **已修**：`callProviderWithNetworkRetry` 加 `onBeforeRetry`，重发前装载 BLOCK-508 重放过滤器；loop-orchestrator 1674→1658（逻辑抽 `helpers/network-retry.js`） | S1 `7260a42d` | block109-stream-retry ⑥ 红→绿（拼接恰好一次）；S1-EVIDENCE |
| 2 | P1 | 缓存清理 fail-open | **已修**：查库失败即中止（aborted/零删除）、runningTaskIds 用未终态 status 填充 | S1 `7260a42d` | cache-manager-cleanup 3/3（三例红→绿） |
| 3 | P1 | 本机请求边界三缺口 | **已修**（a/b/c）：Origin:null 变更 token 门、10 条 MCP 路由挂 trusted origin、子进程 env 凭据按名剥离 | S3（本批） | block511-origin-null 7/7 + mcp-route 2/2 + child-env 3/3；S3-EVIDENCE |
| 4 | P1 | Cmd+Q 守卫拦不住后续拆除 | **已修**：三处 before-quit 先判 defaultPrevented、app.once→on | S1 `7260a42d` | quit-guard 3/3 + terminal 6/6；Cmd+Q 原生确认 OS 对话框不自动化（诚实边界） |
| 5 | P1 | 排队消息挂载即清空 | **已修**：抽 `usePromptQueue`，仅会话/项目变化时清空 | S1 `7260a42d` | usePromptQueue 4/4 + 实机 `block511-s6-queued-reload-live` 4/4（刷新后队列保留） |
| 6 | P2 | 工作区文件读取无包含校验 | **已修**：realpath 最近祖先包含校验（绝对路径/../符号链接越界拒绝），抽 path-guard 子模块 | S3（本批） | working-tree-review-file-content 7/7（三例红→绿） |
| 6b | P2 | file:open-path 可执行关联 | **已修**：30 类脚本/可执行扩展名 + 无扩展名可执行位拦截 | S3（本批） | open-path-exec-guard 3/3 |
| 7 | P2 | 命令风险可见性漏洞 | **已修**：m 标志+扩锚点、find -delete/xargs rm、逐段首 token 剥 sudo/env 赋值（处置不变=默认放行+可见） | S3（本批） | command-risk-visibility 4/4 + block160 13/13 |
| 8 | P2 | web_fetch 校验与建连分离 | **遗留（按提示词授权登记）**：fetchImpl 可注入契约 + TLS SNI，零新依赖下不能安全 pin-IP；逐跳重校验/私网拒绝全部保留，不削弱防护 | S3 plan §3.2 | block247/qoder-l1l2 16/16 保持 |
| 9 | P2 | Express async 抛错悬挂 | **已修**：asyncHandler + 全局 5xx 错误中间件，包装 model3d/mcp 无 try-catch handler | S3（本批） | async-handler 4/4 + MCP 12/12 |
| 10 | P2 | skills:execute require 路径错+漂移门盲区 | **已修**：`../`→`./` 模块级一次加载、漂移门扩 src 全域（抓到 core-utils 真实漂移） | S1 `7260a42d` | ipc-relative-requires（扩范围）1/1 |
| 11 | P2 | CSP 端口写死 | **已修**：按实际后端端口/渲染 Origin 生成，打包态恒生产 CSP | S4（本批） | csp-port 4/4 + 实机零 CSP 违规 |
| 12 | P2 | three/@xyflow 进首屏 | **已修**：3D/graph 改 lazy+Suspense 空占位，首屏静态链不触达 | S4（本批） | first-paint-lazy 2/2 + build 独立 chunk + 前端 28/28 |

## 二、逐项对照报告 §3（门禁与工程可信度）

| §3 项 | 处置 | 提交 | 证据 |
|---|---|---|---|
| 提交不自洽（c56 测试未入库引用） | 豁免基线（owner=C-56/date/reason）+ gate:tracked-consistency 门禁 | S2 `12ac2222`+`30f05dfe` | tracked-consistency PASS 4341 引用 |
| gate:code-size FAIL | SimpleChat 1952→1943、src/main.js→920、css +25 经 --allow-grow 留因（来源 commit `16c48c6d`） | S1/S2 | gate:code-size PASS |
| 棘轮被例行上调 | code-size/knip `--allow-grow <path>=<reason>` 留因写入基线 | S2 `12ac2222` | allow-grow HK-01 3/3 |
| 测试入口漏网 | test:all 递归脚本 + shards 递归枚举；pipeline.test.js 删除留因、3 测试挂规则 | S2 `12ac2222` | shards --plan 844+8 |
| 去个人绝对路径 | PETRI_PACK_BIO_ROOT + 显式 skip | S2 `12ac2222` | 4 测试 17/17、缺路径 2 skipped |
| 全量无绿灯记录 | `test:all:sharded --all` 跑完留原始输出（见下） | S6 | summary JSON + 日志 |
| CI 覆盖极窄 | 11 静态门入 CI + timeout/concurrency；CI run `45325701839` success | S2 `12ac2222` | gh run view |
| impact-map 死 pattern | 清 29 条不存在路径的具体 pattern（清单 dead-patterns.txt） | S2 `12ac2222` | W5a 3/3 |

## 三、逐项对照报告 §4（治理与入口）

- AGENTS.md 14 处规模数字改现读命令、frontend/AGENTS.md 7 处路径修正（S5）。
- roadmap 指针改指 remaining-work-plan，registry kind→living-plan，`npm run state` 可列出（S5）。
- 过期链：roadmap 85 条 + handoff 57 条原文搬移 archive/checkpoints，各留最近 1 条；新增 roadmap-compact 幂等自稳（S5）。
- README 定位对齐 BLOCK-339 人设、Quick Start 对齐 BLOCK-457、版本以 package.json 为准；CHANGELOG 补 Unreleased（S5）。
- AUDIT-LOG 两表补表头分隔行、移除错位分隔行（纯格式，state/compact 解析正常，S5）。

## 四、实机证据汇总

- S4 `block511-s4-firstpaint-live` 10/10：零 CSP 违规（securitypolicyviolation 监听）、首屏渲染、聊天 SSE 消息可见、构建 chunk 独立。
- S6 `block511-s6-queued-reload-live` 4/4：排队追问预置 localStorage 后刷新仍在（usePromptQueue 修复实证）。
- 均 9223 离屏实例，跑完即 kill；未开可见窗口。
- Cmd+Q 原生确认对话框、MCP 连接 UI、审批卡：离屏 CDP 不可达项如实标注 not_present/单测契约背书，不伪造。

## 五、遗留与诚实边界

1. **web_fetch DNS 重绑定 pin-IP**：按提示词授权登记遗留（§2 第 8 项），零新依赖下不改。
2. **3D 产物卡「可展开」实机**：本会话无 3D artifact，flow 如实标 not_present；由 build 独立 chunk + lazy 单测背书。
3. **全量套件存量红**：tool model-surface 118→120（基线未更新）、M6-A/BUNDLE_REGISTRY 等，本包零触碰对应文件，逐条归属见 S1/S3-EVIDENCE。
4. UI-723 保留 in_progress（3D 卡未实机，债 +1，K3/K15 triage 读数已随 canonical 演进同步）；UI-722 已实机翻 verified。

## 六、收口门禁

- S1–S5 每阶段独立提交（S0 `d024b522`、S1 `7260a42d`、S2 `12ac2222`+`30f05dfe`、S3/S4/S5 本批）。
- closeout:full / test:all:sharded --all / CI 最终状态见 S6-EVIDENCE（本文件后续更新）。
