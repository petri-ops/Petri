#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block117-layasupply-live — BLOCK-117 P2 实机腿
 * （本地 Laya 供给真跑：设置页同通道切换 → 真实意图路由决策 → 台账记账 Laya → 还原）。
 *
 * 前置：dev 后端运行中（:3001；intent-route 已在配置文件启用态）+ 本地 laya_decide serve
 * 运行中（:8765）。供给切换走 PUT /ai/decisions/provider——与设置页「决策模型接口」保存
 * 同一通道（D-B provider 可替换性设计）；原配置文件由本 flow 先备份后原样还原
 * （API 打码红线：真实 key 不可经 API 取回，故还原走文件级）。
 *
 * 断言：
 *   B1 供给切换生效（GET /config provider.baseUrl=本地）；
 *   B2 真实决策经本地供给落账：recent 行 point=intent-route 且 model 含 'laya' 且 degraded=0；
 *   B3 还原后 GET /config provider.baseUrl 回到原值（无残留）。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-117');
const LAYA = { baseUrl: 'http://127.0.0.1:8765', apiKey: 'local-laya-no-external-call', model: 'laya-typed-decisions' };
const TASK_TIMEOUT_MS = Number(process.env.BLOCK117_TASK_TIMEOUT_MS || 120_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

module.exports = {
  id: 'block117-layasupply-live',
  description: 'BLOCK-117 P2 实机腿：本地 Laya 供给真跑（PUT 切换→意图路由落账 laya→文件级还原）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // B0-pre — 健康前置：本地供给可达；备份原配置文件（含真实 key，还原唯一途径）。
    // 路径必须对齐 dev 后端进程的数据面（restart-dev-stack.sh 沉淀：BIOF3_LOCAL_DATA_DIR
    // 指向 .biof3-dev-user-data/data），而非本 flow 进程 cwd 推导的默认路径。
    const health = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null);
    assert('B0_laya_serve_ready', !!health && health.ready === true, `health=${JSON.stringify(health)}`);
    const configFilePath = process.env.BIOF3_DECISION_CONFIG_PATH
      || path.join(process.cwd(), '.biof3-dev-user-data', 'data', 'decision-config.json');
    const originalRaw = fs.readFileSync(configFilePath, 'utf8');
    try {
      // B1 — 供给切换（设置页同通道）+ 回读打码视图确认
      const put = await rest('PUT', '/ai/decisions/provider', LAYA);
      assert('B1_provider_switched', put.ok && put.data?.status === 'ok', `put=${put.status} ${JSON.stringify(put.data).slice(0, 120)}`);
      const cfg = await rest('GET', '/ai/decisions/config');
      assert('B1b_provider_visible', cfg.ok && cfg.data?.provider?.baseUrl === LAYA.baseUrl,
        `provider=${JSON.stringify(cfg.data && cfg.data.provider)}`);

      // B2 — 真实触发意图路由（chitchat 类消息），经本地 Laya 供给落账
      const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: '嗨，在忙吗？' }] });
      if (!sub.ok || !sub.data?.taskId) throw new Error(`提交失败：${sub.status} ${JSON.stringify(sub.data).slice(0, 150)}`);
      const deadline = Date.now() + TASK_TIMEOUT_MS;
      let terminal = null;
      while (Date.now() < deadline) {
        await sleep(1200);
        const t = await rest('GET', `/ai/agent/task/${encodeURIComponent(sub.data.taskId)}/meta`);
        const status = t.data && (t.data.agentStatus || t.data.agent_status);
        if (['completed', 'done', 'failed', 'cancelled'].includes(status)) { terminal = status; break; }
      }
      assert('B2_task_reaches_terminal', terminal !== null, `terminal=${terminal}`);
      await sleep(1500); // best-effort 异步记账缓冲

      const recent = await rest('GET', '/ai/decisions/recent?limit=20');
      const rows = (recent.data && recent.data.decisions) || [];
      const layaRow = rows.find((r) => r.point === 'intent-route'
        && typeof r.model === 'string' && r.model.includes('laya') && Number(r.degraded) === 0);
      assert('B2b_laya_row_logged', !!layaRow,
        `recent intent-route models=${JSON.stringify(rows.filter((r) => r.point === 'intent-route').map((r) => r.model))}`);
      assert('B2c_choice_recorded', !!layaRow && layaRow.choice != null, `choice=${layaRow && layaRow.choice}`);

      var layaEvidenceRow = layaRow;
    } finally {
      // B3 — 文件级还原（API 取不回真实 key；原样写回=零残留）
      fs.writeFileSync(configFilePath, originalRaw);
      const cfgAfter = await rest('GET', '/ai/decisions/config');
      assert('B3_provider_restored', cfgAfter.ok && cfgAfter.data?.provider?.baseUrl !== LAYA.baseUrl,
        `provider=${JSON.stringify(cfgAfter.data && cfgAfter.data.provider)}`);
    }

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block117-layasupply-live.json'),
      JSON.stringify({ layaRow: layaEvidenceRow, switchedTo: LAYA.baseUrl, restored: true }, null, 2));
    lib.log(`本地 Laya 供给真跑落账：point=${layaEvidenceRow.point} model=${layaEvidenceRow.model} choice=${layaEvidenceRow.choice} latency=${layaEvidenceRow.latencyMs}ms；配置已还原`);
  },
};
