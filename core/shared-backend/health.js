/**
 * Petri shared backend — Health Shape (BLOCK-520 P1 / OB-005)
 *
 * 四端点同 shape：status/service/timestamp/readiness/liveness/details。
 * 语义：liveness=进程能应答（恒 true，能进来就活着）；readiness=依赖就绪
 * （调用方探测 DB/执行器等并传入）。status 由 readiness 派生，additive 兼容
 * 既有字段——各端点 spread 本 shape 后再补自己的历史字段，前端零改动。
 */

function buildHealthShape({ service = 'petri', readiness = true, details = {} } = {}) {
  const ready = readiness !== false;
  return {
    status: ready ? 'ok' : 'degraded',
    service: String(service),
    timestamp: new Date().toISOString(),
    readiness: ready,
    liveness: true,
    details: details || {},
  };
}

module.exports = { buildHealthShape };
