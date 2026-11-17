/**
 * Petri Server — thin bootstrap（BLOCK-457 P2 单一所有权防线）
 *
 * 职责只有一件事：先把端口占住，再放行 server 主体。
 *
 * 缺陷史（docs/block-457-dev-single-backend-ownership-plan.md §0）：旧 server.js
 * 先 require 全部业务模块、最后才 listen——模块加载期副作用（initSchema /
 * agent-task-store 启动清扫 / 插件装配）在**每个**绑不上端口的后端上都完整执行。
 * 2026-11-17 实机：wrapper+main 双 spawner 下，僵尸 boot 每 30s 清扫一次共享库，
 * 把健康后端 in-flight 任务误标「服务重启，Agent 任务中断」（当日 749 boot /
 * 734 EADDRINUSE / 4 任务误杀，与 interrupted_at 毫秒级对账）。
 *
 * 现契约：端口绑不上 → 单行日志 + exit 77，一行 DB 都不碰；绑定成功 → 把已持有
 * 的 net.Server 直接交给 server-main（listen({ handle })，零「释放→重绑」竞窗），
 * 并写入 PETRI_INSTANCE_ID（/api/health 身份字段，main.js 探活 attach 判据）。
 */

const crypto = require('crypto');
const { getBackendPort } = require('../../src/main/env-coordinator');
const { tryBindPort, PORT_IN_USE_EXIT_CODE } = require('./port-guard');

const PORT = getBackendPort('r');

(async () => {
  const handle = await tryBindPort(PORT);
  if (!handle) {
    // 单行、无堆栈：绑定失败是**预期内的永久失败**（已有后端在场），不是异常。
    // supervisor 以 exit 77 识别为 no-retry（BLOCK-457 P2），不再 30s 循环。
    console.error(`[port-guard] :${PORT} already in use — single-instance guard, exit ${PORT_IN_USE_EXIT_CODE} (no module loaded, zero DB side effects)`);
    process.exit(PORT_IN_USE_EXIT_CODE);
  }
  // 每 boot 实例身份：/api/health 暴露（instanceId/pid/dataDir），
  // Electron main 据此判定 attach 还是 spawn（BLOCK-457 P3）。
  process.env.PETRI_INSTANCE_ID = crypto.randomUUID();
  // 端口已安全持有，此刻才放行 server 主体（全部业务模块 require 在此之后）。
  require('./server-main')(handle);
})().catch((e) => {
  // bootstrap 自身不许有堆栈噪音：任何意外都单行诚实退出。
  console.error('[port-guard] bootstrap failed:', e && e.message ? e.message : e);
  process.exit(PORT_IN_USE_EXIT_CODE);
});
