#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block232-permissions-live — BLOCK-232 P4-B 权限通用化实机腿。
 * REST-only、无写入：本地 admin 仍绕过 data gate（未知写路由 404 而非 403），读面不受影响。
 * 非 admin 拒绝分支由 test/block232-permissions-generalization.test.mjs 覆盖
 * （桌面 localIdentity 恒为 admin，实机无法构造非 admin 身份）。
 * 注：`GET /api/auth/me` 在 standalone backend 存量 500（db helper 装配缺陷，前端零消费），
 * 已单独登记 AUDIT-LOG，不作为本包判据。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-232');

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

module.exports = {
  id: 'block232-permissions-live',
  description: 'BLOCK-232 P4-B 实机腿：本地 admin 零变化（data gate 放行）+ 读面不变',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    const health = await rest('GET', '/health');
    assert('R1_backend_health', health.ok, JSON.stringify({ status: health.status }));

    // data 写 gate 已切到通用 `data`：admin 必须穿过 gate 落到路由层（404 而非 403）。
    const probe = await rest('POST', '/data/__permission_probe__', {});
    assert(
      'R2_admin_bypasses_data_gate',
      probe.status === 404,
      JSON.stringify({ status: probe.status, data: probe.data }),
    );

    const list = await rest('GET', '/data/projects');
    assert('R3_data_read_path_unchanged', list.ok, JSON.stringify({ status: list.status }));
  },
};
