#!/usr/bin/env node
/**
 * Platform split smoke — control plane vs compute.
 *
 *   BIOF3_PLATFORM_URL=https://biof3.com/api/platform \
 *   BIOF3_R_URL=https://biof3.com/api/r \
 *   BIOF3_PY_URL=https://biof3.com/api/py \
 *   BIOF3_SMOKE_USER=... BIOF3_SMOKE_PASS=... \
 *   node test/smoke-platform-split.mjs
 */
const PLATFORM = (process.env.BIOF3_PLATFORM_URL || 'https://biof3.com/api/platform').replace(/\/$/, '');
const R_API = (process.env.BIOF3_R_URL || 'https://biof3.com/api/r').replace(/\/$/, '');
const PY_API = (process.env.BIOF3_PY_URL || 'https://biof3.com/api/py').replace(/\/$/, '');
const USER = process.env.BIOF3_SMOKE_USER;
const PASS = process.env.BIOF3_SMOKE_PASS;

let failed = 0;
function ok(n) { console.log(`  ✓ ${n}`); }
function fail(n, d) { console.log(`  ✗ ${n}: ${d}`); failed++; }

async function j(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let json;
  try { json = JSON.parse(t); } catch { json = {raw: t.slice(0, 180)}; }
  return {status: r.status, json};
}

async function main() {
  console.log(`[split-smoke] platform=${PLATFORM}`);
  console.log(`[split-smoke] r=${R_API} py=${PY_API}`);

  const ph = await j(`${PLATFORM}/health`);
  if (ph.status === 200 && ph.json.status === 'ok') ok('platform GET /health');
  else fail('platform health', `${ph.status} ${JSON.stringify(ph.json)}`);

  const gp = await j(`${PLATFORM}/public/guest-permissions`);
  if (gp.status === 200 && gp.json.status === 'ok') ok('platform guest-permissions');
  else fail('platform guest-permissions', `${gp.status}`);

  const rh = await j(`${R_API}/health`);
  if (rh.status === 200 && rh.json.status === 'ok') ok('r-compute GET /health (Dell via frp)');
  else fail('r health', `${rh.status} ${JSON.stringify(rh.json)}`);

  const pyh = await j(`${PY_API}/health`);
  if (pyh.status === 200 && pyh.json.status === 'ok') ok('py-compute GET /health');
  else fail('py health', `${pyh.status} ${JSON.stringify(pyh.json)}`);

  if (!USER || !PASS) {
    console.log('\n  ⚠ skip auth (BIOF3_SMOKE_USER + BIOF3_SMOKE_PASS)');
  } else {
    const login = await j(`${PLATFORM}/auth/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: USER, password: PASS}),
    });
    if (login.status !== 200 || !login.json.token) {
      fail('platform login', `${login.status} ${login.json.error || ''}`);
    } else {
      ok(`platform login ${USER}`);
      const token = login.json.token;
      const me = await j(`${PLATFORM}/auth/me`, {headers: {Authorization: `Bearer ${token}`}});
      if (me.status === 200 && me.json.user) ok('platform GET /auth/me');
      else fail('auth/me', `${me.status}`);

      const data = await j(`${PLATFORM}/data/projects?modality=single-cell`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      if (data.status === 200 && data.json.status === 'ok') ok('platform GET /data/projects');
      else fail('data/projects', `${data.status} ${data.json.error || ''}`);
    }
  }

  const run = await j(`${R_API}/run`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-api-token': 'biof3-figcode-2026'},
    body: JSON.stringify({code: 'print(1+1)'}),
  });
  if (run.status === 200 && (run.json.status === 'success' || run.json.stdout)) ok('r POST /run (compute)');
  else if (run.json?.error === 'compute_on_dell' || run.status === 503) {
    fail('r /run', 'nginx /api/r/ hit platform — should be Dell :3001 or ECS only for enqueue');
  } else if (String(run.json?.error || '').includes('No such container')) {
    console.log('  ⚠ r /run needs R Docker on Dell — run: ./scripts/start-dell-r-compute.sh');
  } else fail('r /run', `${run.status} ${JSON.stringify(run.json).slice(0, 120)}`);

  console.log(failed ? `\nFAILED (${failed})` : '\nAll split-smoke checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });