# BLOCK-520 P2 证据 · 控制闭环（2026-11-25）

> 发令：Orca bb8dddaf dispatch msg_0271c5b15599（owner 预批 P1 后确认 P2）。
> 本波仅 P2（OB-008/009），第 9 项外部监督器 U 材料保持 pending_user_ruling（裁决1：只告警不重启、不开工）。
> 裁决2：decisionVerifier 默认 null 不变；裁决3：逐波发令。
> G0 开发期常态 · 不外推 packaged/Provider/GA。owner dev 实例（3000/3001）零触碰。

## §1 核码纠偏（C-32/C-43 先核真源）

| 方案稿口径 | 实时核码真值 | 处置 |
|---|---|---|
| goal-verifier 全库无调用 | `verifyGoalCompletion` 仅定义在 agent-tools/goal-verifier.js:28，零调用成立；loop 已有 decisionVerifier 投票位（BLOCK-335），默认 null | 加**可选 goalVerifier 钩子**进终止判定点，默认未传零变化；不改 decisionVerifier null |
| OB-009 ready 替 isReady 轮询 | `waitForBackendHealthy`（src/main.js:521）1s 轮询 /api/health，两调用点（测试实例 90s / 普通 20s）；`backend-health.js` 的 isReady 是状态计算非轮询 | 加 ready-signal 显式事件 + 轮询 fallback（fail-open），不动 isReady 语义 |

## §2 HK-01 红绿先行（test/block520-p2-control.test.mjs）

红 3/4（goal-verifier 纯函数契约本就成立），绿 4/4：
- OB-008：纯函数产物证据判定（good=verified / bad 四 reasonCode）；loop 终止判定识别 `typeof goalVerifier === 'function'`；agent-runner `decisionVerifier = null` 不变（裁决2 机械守护）。
- OB-009：ready-signal onReady/signalReady/isReady/getReadyInfo/reset 契约（含 off 退订）；main.js waitForBackendHealthy 接 ready 事件且 `setTimeout(resolve,1000)` 轮询 fallback 保留。

## §3 实现摘要

- OB-008：`goal-verifier.js` 加 `createGoalVerifier({goals,todos})` 工厂（绑静态目标+运行期证据，返回与 decisionVerifier 同构 verdict）；`loop-orchestrator.js` config 加可选 `goalVerifier`，终止判定点（complete/finalize）观测调用并 emit `goal_verdict` 事件（**不改写 decision**——改默认/改终止语义属行为裁决，待主人）；`agent-runner.js` 透传；`spawn-agent-tools.js` 有 goals/todoRefs 时构造（无目标=null 零变化）。默认全程未传 = 零行为变化。
- OB-009：新建 `core/shared-backend/ready-signal.js`（纯内存事件广播，有界 fail-open）；`waitForBackendHealthy` 命中 /api/health 即 `signalReady(port)` 广播，并发等待者经 `onReady` + `Promise.race` 立即唤醒，轮询 fallback 保留。

## §4 验证结果

- HK-01 契约 4/4 pass；loop/P0 回归 13/13 pass。
- 静态门：见提交记录（lint/types/secret/arch/silent-catch/docs/ui-audit）。
- 零新依赖；owner 实例零触碰；观感零代签（本波无 UI 呈现改动）；第 9 项未开工；提交留本地、push 等口令。
