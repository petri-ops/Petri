#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block230-modality-live — BLOCK-230 P4 切片实机腿。
 * REST-only：创建项目不传 modality → general；显式 single-cell 保留；未知值回落 general。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api/data';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-230');

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

module.exports = {
  id: 'block230-modality-live',
  description: 'BLOCK-230 P4 实机腿：项目 modality 默认 general / 显式保留 / 未知回落',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const created = [];
    try {
      const suffix = Date.now();
      const a = await rest('POST', '/projects', { name: `p4-default-${suffix}` });
      assert('R1_create_default_ok', a.ok && Boolean(a.data?.project?.id), JSON.stringify(a.data));
      created.push(a.data.project.id);
      const aGet = await rest('GET', `/projects/${encodeURIComponent(a.data.project.id)}`);
      assert('R2_default_is_general', aGet.ok && aGet.data?.project?.modality === 'general', JSON.stringify(aGet.data?.project?.modality));

      const b = await rest('POST', '/projects', { name: `p4-single-${suffix}`, modality: 'single-cell' });
      assert('R3_create_explicit_ok', b.ok && Boolean(b.data?.project?.id), JSON.stringify(b.data));
      created.push(b.data.project.id);
      const bGet = await rest('GET', `/projects/${encodeURIComponent(b.data.project.id)}`);
      assert('R4_explicit_preserved', bGet.data?.project?.modality === 'single-cell', JSON.stringify(bGet.data?.project?.modality));

      const c = await rest('POST', '/projects', { name: `p4-invalid-${suffix}`, modality: 'nope' });
      assert('R5_create_invalid_ok', c.ok && Boolean(c.data?.project?.id), JSON.stringify(c.data));
      created.push(c.data.project.id);
      const cGet = await rest('GET', `/projects/${encodeURIComponent(c.data.project.id)}`);
      assert('R6_invalid_falls_back_general', cGet.data?.project?.modality === 'general', JSON.stringify(cGet.data?.project?.modality));
    } finally {
      for (const id of created) {
        try { await rest('DELETE', `/projects/${encodeURIComponent(id)}`); } catch {}
      }
    }
  },
};
