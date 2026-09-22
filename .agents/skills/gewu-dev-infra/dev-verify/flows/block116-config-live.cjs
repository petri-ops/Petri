#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block116-config-live — BLOCK-116 P4 实机腿
 * （决策配置中心：GET 全量/PUT 单接点/持久化/非法输入 400；plan §P4）。
 *
 * 前置：dev 后端含 decisions 路由已重启（config 端点与文件持久化不依赖 JEV guard env）。
 * 断言：
 *   C1 GET config → 五运行时接点在册（topic-shift 默认开）；
 *   C2 PUT intent-route threshold=0.75 → 200 且 GET 持久化读回 0.75；
 *   C3 PUT 非法 threshold=1.5 → 400；
 *   C4 PUT 未知接点 → 404；
 *   C5 还原 0.7 → GET 读回 0.7（校准默认）。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-116');

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

module.exports = {
  id: 'block116-config-live',
  description: 'BLOCK-116 P4 实机腿：决策配置中心（GET/PUT/持久化/非法输入拒绝/还原默认）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const cfg = await rest('GET', '/ai/decisions/config');
    const points = (cfg.data && cfg.data.points) || [];
    assert('C1_config_five_points', cfg.ok && points.length === 5
      && points.some((p) => p.point === 'topic-shift' && p.enabled === true),
      `points=${points.map((p) => `${p.point}:${p.enabled}`).join(',')}`);

    const put1 = await rest('PUT', '/ai/decisions/config/intent-route', { threshold: 0.75 });
    assert('C2_put_threshold_200', put1.ok && put1.data?.point?.threshold === 0.75,
      `put1=${JSON.stringify(put1.data).slice(0, 120)}`);
    const reget = await rest('GET', '/ai/decisions/config');
    const intent = (reget.data?.points || []).find((p) => p.point === 'intent-route');
    assert('C2b_persisted', intent && intent.threshold === 0.75, `persisted=${JSON.stringify(intent)}`);

    const bad = await rest('PUT', '/ai/decisions/config/intent-route', { threshold: 1.5 });
    assert('C3_invalid_threshold_400', bad.status === 400, `status=${bad.status}`);

    const unknown = await rest('PUT', '/ai/decisions/config/no-such-point', { enabled: true });
    assert('C4_unknown_point_404', unknown.status === 404, `status=${unknown.status}`);

    const restore = await rest('PUT', '/ai/decisions/config/intent-route', { threshold: 0.7 });
    assert('C5_restore_default_070', restore.ok && restore.data?.point?.threshold === 0.7,
      `restore=${JSON.stringify(restore.data).slice(0, 120)}`);

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'config-live-flow.json'),
      JSON.stringify({ points, put1: put1.data, bad: bad.status, unknown: unknown.status, restore: restore.data }, null, 2));
  },
};
