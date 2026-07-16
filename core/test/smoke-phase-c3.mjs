#!/usr/bin/env node
/**
 * Phase C3 smoke — public API on biof3.com (ECS r-server via /api/r/).
 *
 *   BIOF3_URL=https://biof3.com/api/r \
 *   BIOF3_SMOKE_USER=... BIOF3_SMOKE_PASS=... \
 *   node test/smoke-phase-c3.mjs
 *
 * Optional: BIOF3_PY_URL=https://biof3.com/api/py (py-server still on Dell via frp)
 */
const BASE = (process.env.BIOF3_URL || 'https://biof3.com/api/r').replace(/\/$/, '');
const PY_BASE = (process.env.BIOF3_PY_URL || 'https://biof3.com/api/py').replace(/\/$/, '');
const USER = process.env.BIOF3_SMOKE_USER;
const PASS = process.env.BIOF3_SMOKE_PASS;

let failed = 0;
function ok(name) {
  console.log(`  ✓ ${name}`);
}
function fail(name, detail) {
  console.log(`  ✗ ${name}: ${detail}`);
  failed++;
}

async function get(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = {raw: text.slice(0, 200)};
  }
  return {status: r.status, json};
}

async function getPy(path) {
  const r = await fetch(`${PY_BASE}${path}`);
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = {raw: text.slice(0, 200)};
  }
  return {status: r.status, json};
}

async function main() {
  console.log(`[smoke-c3] r API: ${BASE}`);
  console.log(`[smoke-c3] py API: ${PY_BASE}`);

  const h = await get('/health');
  if (h.status === 200 && h.json.status === 'ok') ok('GET /health (via /api/r/health)');
  else fail('health', `${h.status} ${JSON.stringify(h.json)}`);

  // nginx: /api/r/<suffix> → backend /api/<suffix> (do NOT double /api in URL)
  const gp = await fetch(`${BASE}/public/guest-permissions`);
  await gp.json().catch(() => ({}));
  if (gp.status === 200) ok('GET /api/public/guest-permissions');
  else fail('guest-permissions', `${gp.status}`);

  if (!USER || !PASS) {
    console.log('\n  ⚠ skip login (set BIOF3_SMOKE_USER + BIOF3_SMOKE_PASS for full smoke)');
  } else {
    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: USER, password: PASS}),
    });
    const lj = await login.json().catch(() => ({}));
    if (login.status !== 200 || !lj.token) {
      fail('login', `${login.status} ${lj.error || JSON.stringify(lj)}`);
    } else {
      ok(`login as ${USER}`);
      const token = lj.token;
      const proj = await fetch(`${BASE}/projects`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      const pj = await proj.json().catch(() => ({}));
      if (proj.status === 200) ok('GET /api/projects');
      else fail('projects', `${proj.status} ${pj.error || ''}`);
    }
  }

  const pyH = await getPy('/health');
  if (pyH.status === 200 && (pyH.json.status === 'ok' || pyH.json.ok)) {
    ok('py GET /health (still Dell/frp — not C3)');
  } else if (pyH.status === 401) {
    ok('py /health reachable (401 without token — expected)');
  } else {
    fail('py health', `${pyH.status} ${JSON.stringify(pyH.json).slice(0, 120)}`);
  }

  console.log('');
  if (failed) {
    console.log(`FAILED (${failed} checks)`);
    process.exit(1);
  }
  console.log('All C3 smoke checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});