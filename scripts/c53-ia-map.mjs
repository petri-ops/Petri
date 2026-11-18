#!/usr/bin/env node
/**
 * scripts/c53-ia-map.mjs — BLOCK-471 / C-53 P2：IA 与高频路径机械盘点。
 *
 * 纯函数 collectIaMap(appSource) 从 App.tsx 现读解析两 surface 的 <Route> 与 <Navigate> 重定向，
 * HIGH_FREQUENCY_PATHS 从现读拓扑推导（不臆造页面），落 resources/design-context/ia-map.json；
 * --check 只重算不写盘。沿 P1（c53-design-baseline.mjs）先例。
 *
 * 用法：node scripts/c53-ia-map.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'frontend', 'src', 'App.tsx');
const IA = path.join(ROOT, 'resources', 'design-context', 'ia-map.json');
const CHECK = process.argv.includes('--check');

// 高频路径从现读拓扑推导（每步须能在 routes/redirects 中解析；测试守护，不臆造页面）。
export const HIGH_FREQUENCY_PATHS = Object.freeze([
  Object.freeze({ id: 'HFP-1', name: '首问直达工作区', steps: Object.freeze(['/', '/project/:projectId/*']) }),
  Object.freeze({ id: 'HFP-2', name: '项目管理进入工作区', steps: Object.freeze(['/projects', '/project/:projectId/*']) }),
  Object.freeze({ id: 'HFP-3', name: '工作区到代码评审', steps: Object.freeze(['/project/:projectId/*', '/review']) }),
  Object.freeze({ id: 'HFP-4', name: '扩展中心技能/插件', steps: Object.freeze(['/extensions', '/skills', '/plugins']) }),
  Object.freeze({ id: 'HFP-5', name: '知识空间回到工作区', steps: Object.freeze(['/knowledge', '/project/:projectId/*']) }),
]);

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

/**
 * 从 App.tsx 源码机械解析 Route/Navigate。返回 { routes, redirects, sourceLineCount }。
 * 纯函数：不读文件、不依赖 cwd、不写盘——同一 source 必得同一结果（易变字段由调用方补）。
 */
export function collectIaMap(appSource) {
  const text = String(appSource || '');
  const lines = text.split('\n');
  const routes = [];
  const redirects = [];
  // App.tsx 以 isWindowSurface 分支区分两 surface：窗口面 Route 出现在该分支之后。
  const windowIdx = lines.findIndex((l) => l.includes('isWindowSurface'));
  lines.forEach((line, i) => {
    // 重定向优先：element={<Navigate to=...>} 不算普通路由。
    const navM = line.match(/<Route\s+path="([^"]+)"\s+element=\{<Navigate\s+to="([^"]+)"/);
    if (navM) {
      const surface = windowIdx >= 0 && i > windowIdx ? 'window' : 'main';
      redirects.push({ from: navM[1], to: navM[2], surface, sourceLine: i + 1 });
      return;
    }
    const routeM = line.match(/<Route\s+path="([^"]+)"\s+element=\{<(?!Navigate)([A-Za-z0-9_]+)/);
    if (routeM) {
      const surface = windowIdx >= 0 && i > windowIdx ? 'window' : 'main';
      routes.push({ path: routeM[1], component: routeM[2] || null, surface, sourceLine: i + 1 });
    }
  });
  return { routes, redirects, sourceLineCount: lines.length };
}

/** 路径解析：先查精确路由（含通配 :param / *），再查重定向目标，最后按前缀通配匹配。 */
export function resolveRoute(target, ia) {
  const clean = String(target || '').split('?')[0];
  const routes = Array.isArray(ownGet(ia, 'routes')) ? ownGet(ia, 'routes') : [];
  const redirects = Array.isArray(ownGet(ia, 'redirects')) ? ownGet(ia, 'redirects') : [];
  const match = (pattern) => {
    if (pattern === clean) return true;
    if (pattern === '*') return true;
    const pSeg = String(pattern).split('/').filter(Boolean);
    const cSeg = clean.split('/').filter(Boolean);
    if (pSeg.length !== cSeg.length) return false;
    return pSeg.every((s, i) => s.startsWith(':') || s === '*' || s === cSeg.at(i));
  };
  if (routes.some((r) => match(ownGet(r, 'path')))) return true;
  // 重定向的 from 是合法入口（fail-closed 跳转），to 是落点——两者都算可达。
  if (redirects.some((r) => match(ownGet(r, 'from')) || match(String(ownGet(r, 'to') || '').split('?')[0]))) return true;
  return false;
}

/** 完整性判据：现读重算与落盘逐条一致 + 无死链 + 高频路径可达。 */
export function validateIaIntegrity(ia, appSource) {
  const diagnostics = [];
  const fresh = collectIaMap(appSource);
  const norm = (rs) => rs.map((r) => `${ownGet(r, 'surface')}|${ownGet(r, 'path')}|${ownGet(r, 'component') || ('→' + ownGet(r, 'redirect'))}`).sort().join('\n');
  if (norm(fresh.routes) !== norm(Array.isArray(ownGet(ia, 'routes')) ? ownGet(ia, 'routes') : [])) {
    diagnostics.push('routes 与 App.tsx 现读不一致');
  }
  if (norm(fresh.redirects) !== norm(Array.isArray(ownGet(ia, 'redirects')) ? ownGet(ia, 'redirects') : [])) {
    diagnostics.push('redirects 与 App.tsx 现读不一致');
  }
  for (const r of (Array.isArray(ownGet(ia, 'redirects')) ? ownGet(ia, 'redirects') : [])) {
    if (!resolveRoute(String(ownGet(r, 'to') || '').split('?')[0], ia)) diagnostics.push(`死链：${ownGet(r, 'from')} → ${ownGet(r, 'to')}`);
  }
  for (const p of (Array.isArray(ownGet(ia, 'highFrequencyPaths')) ? ownGet(ia, 'highFrequencyPaths') : [])) {
    for (const step of (Array.isArray(ownGet(p, 'steps')) ? ownGet(p, 'steps') : [])) {
      if (!resolveRoute(step, ia)) diagnostics.push(`高频路径 ${ownGet(p, 'id')} 不可达：${step}`);
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

function gitHead() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

function main() {
  const source = fs.readFileSync(APP, 'utf8');
  const fresh = collectIaMap(source);
  const payload = {
    schemaVersion: 1,
    generator: 'node scripts/c53-ia-map.mjs',
    sourceCommit: gitHead(),
    generatedAt: new Date().toISOString(),
    note: '模型可读 IA 映射；由 collector 从 App.tsx 现读路由派生，被 test/c53-ia-map.test.mjs 锚定。',
    routes: fresh.routes,
    redirects: fresh.redirects,
    highFrequencyPaths: HIGH_FREQUENCY_PATHS.map((p) => ({ ...p, steps: [...ownGet(p, 'steps')] })),
  };
  if (CHECK) {
    if (!fs.existsSync(IA)) { console.error('[c53:ia] ia-map.json 缺席（fail-closed）'); process.exitCode = 1; return; }
    const disk = JSON.parse(fs.readFileSync(IA, 'utf8'));
    const r = validateIaIntegrity(disk, source);
    if (!r.ok) { console.error(`[c53:ia] --check FAIL：${r.diagnostics.join('；')}`); process.exitCode = 1; return; }
    console.log(`[c53:ia] --check PASS（routes=${fresh.routes.length} redirects=${fresh.redirects.length} hfp=${HIGH_FREQUENCY_PATHS.length}）`);
    return;
  }
  fs.writeFileSync(IA, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  // manifest 同步（沿 P1 先例）：ia-map 的 sha256 由生成器自身维护，避免手算漂移。
  const MANIFEST = path.join(ROOT, 'resources', 'design-context', 'manifest.json');
  const sha = createHash('sha256').update(fs.readFileSync(IA)).digest('hex');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const entry = files.find((f) => ownGet(f, 'path') === 'ia-map.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'ia-map.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[c53:ia] ia-map.json 已写（routes=${fresh.routes.length} redirects=${fresh.redirects.length} hfp=${HIGH_FREQUENCY_PATHS.length}）；manifest sha 同步`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
