# BLOCK-511 · S1 正确性修复证据（2026-11-24）

## HK-01 红绿先行（每项先红后绿）

| 修复点 | 红（修复前） | 绿（修复后） | 关键断言 |
|---|---|---|---|
| 1.1 流重试正文重复 | `block109-stream-retry` ⑥：拼接=`部分输出然后连接被掐断部分输出然后连接被掐断收尾`（重复） | 30/30（含 `block109-orchestration` 循环层契约） | 首连半截断开、重连完整重发，下发 content_delta 拼接恰好一次完整正文；`onBeforeRetry` 装载 BLOCK-508 同款 filter |
| 1.2 缓存清理 fail-open | `cache-manager-cleanup` ①查库抛错仍删、②运行中缓存被删（1/3 pass） | 3/3 | 查库抛错 report.aborted 且零删除；未终态(running/pending/queued)任务缓存保留；孤儿闲置缓存删除 |
| 1.3 Cmd+Q 退出守卫 | `quit-guard-default-prevented` 2/3（terminal app.once、无 defaultPrevented 门） | 3/3 + terminal-multisession 6/6 | 守卫拦截时后端/终端/窗口清理不触发，放行时全触发；app.on 保证真退出清理 |
| 1.4 排队消息挂载清空 | `usePromptQueue.test.ts` 挂载清空语义由缺陷复现驱动 | 4/4 | 预置 localStorage 挂载保留、切会话/项目清空、显式更新回写 |
| 1.5 require 路径与漂移门 | `ipc-relative-requires` 扩范围后抓到 src/main.js 历史漂移 + core-utils 真实漂移 | 1/1（修复后） | 扫描范围 src 全域；main.js `../`→`./` 模块级一次加载；core-utils `./platform-compat`→`../platform-compat` |

## 主文件净减行（棘轮）

- `core/petri-server/loop-orchestrator.js` 1674 → 1658（−16，重试逻辑抽 `helpers/network-retry.js`）
- `src/main.js` 925 → 920（−5，require 合并 + 注释压缩）
- `frontend/src/components/copilot/SimpleChat.tsx` 1952 → 1943（−9，队列抽 hook）
- B-16 行数锚 `--write` 重打（下调）：1658 / 1943

## 出口门禁

- HK-01 汇总：node --test 7 文件 30/30 + 前端 usePromptQueue 4/4
- quality:types 0 / quality:lint 0 error / quality:secret / docs:check 666 / ui:audit:check PASS
- gate:code-size：行数违规清零（剩指纹漂移 + simple-chat.css 属 S2.5 棘轮范围）

## 存量/归属登记（全量模式暴露，本包未触碰文件）

- tool model-surface（block113 等 4 红）：工具数 118→120 基线未更新，本包零 tool defs 改动
- W5b useGuardAck 264>220 行：本包未碰 useGuardAck
- knip 2 新增死代码（utility-host ACTIVE/shutdownUtilityHosts）：S0 基线已红
- P6 source binding：未提交改动引起，提交后消失

## 决策工具

- `test:suggest -- --supply=cloud`（S1 规划前）：suggestions=[]（零建议，非故障）
