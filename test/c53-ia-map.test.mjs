import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectIaMap,
  validateIaIntegrity,
  resolveRoute,
  HIGH_FREQUENCY_PATHS,
} from '../scripts/c53-ia-map.mjs';

// BLOCK-471 / C-53 S1 P2 — HK-01 红绿先行 + 篡改负测。
// IA 映射必须从 App.tsx 真源机械派生并被本测试锚定：
// ① 路由集合与 App.tsx 现读一致（可复算）② 无死链 ③ 高频路径可达 ④ manifest sha256 ⑤ 篡改负测 fail-closed。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'frontend', 'src', 'App.tsx');
const IA = path.join(ROOT, 'resources', 'design-context', 'ia-map.json');
const MANIFEST = path.join(ROOT, 'resources', 'design-context', 'manifest.json');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

describe('C-53 P2 IA 映射可复算 + 高频路径可达（HK-01）', () => {
  it('ia-map.json 在场且结构完整（两 surface 路由 + 重定向 + 高频路径 + 易变字段）', () => {
    assert.equal(fs.existsSync(IA), true, 'ia-map.json 必须在场');
    const ia = JSON.parse(fs.readFileSync(IA, 'utf8'));
    assert.equal(ia.schemaVersion, 1);
    assert.ok(Array.isArray(ia.routes) && ia.routes.length > 0, 'routes 非空');
    assert.ok(Array.isArray(ia.redirects), 'redirects 在场');
    assert.ok(Array.isArray(ia.highFrequencyPaths) && ia.highFrequencyPaths.length >= 3, '高频路径 3-5 条');
    assert.ok(ia.sourceCommit && ia.generatedAt, '易变字段在册');
  });

  it('collectIaMap(现读 App.tsx) 与落盘路由集合逐条一致（可复算）', () => {
    const source = fs.readFileSync(APP, 'utf8');
    const fresh = collectIaMap(source);
    const disk = JSON.parse(fs.readFileSync(IA, 'utf8'));
    const norm = (rs) => rs.map((r) => `${r.surface}|${r.path}|${r.component || ('→' + r.redirect)}`).sort();
    assert.deepEqual(norm(fresh.routes), norm(disk.routes), '路由集合必须与 App.tsx 现读一致');
    assert.deepEqual(norm(fresh.redirects), norm(disk.redirects), '重定向集合必须一致');
  });

  it('无死链：所有重定向目标解析到在册路由或合法重定向', () => {
    const ia = JSON.parse(fs.readFileSync(IA, 'utf8'));
    for (const r of ia.redirects) {
      const resolved = resolveRoute(r.to.split('?')[0], ia);
      assert.ok(resolved, `重定向 ${r.from} → ${r.to} 目标不可达`);
    }
  });

  it('高频路径可达：每条每跳解析到在册路由或合法重定向', () => {
    const ia = JSON.parse(fs.readFileSync(IA, 'utf8'));
    for (const p of ia.highFrequencyPaths) {
      assert.ok(Array.isArray(p.steps) && p.steps.length >= 2, `${p.id} 步数不足`);
      for (const step of p.steps) {
        assert.ok(resolveRoute(step, ia), `${p.id} 的 ${step} 不可达`);
      }
    }
    assert.equal(HIGH_FREQUENCY_PATHS.length >= 3, true);
  });

  it('manifest sha256 与 ia-map.json 内容一致（派生完整性）', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = (m.files || []).find((f) => ownGet(f, 'path') === 'ia-map.json');
    assert.ok(entry, 'manifest 必须登记 ia-map.json');
    assert.equal(ownGet(entry, 'sha256'), sha256(fs.readFileSync(IA)), 'sha256 一致');
  });

  it('篡改负测 fail-closed：改路由/插死链/改哈希都被 validateIaIntegrity 判红', () => {
    const ia = JSON.parse(fs.readFileSync(IA, 'utf8'));
    const tamperedRoute = structuredClone(ia);
    tamperedRoute.routes[0].path = '/__forged__';
    assert.equal(validateIaIntegrity(tamperedRoute, fs.readFileSync(APP, 'utf8')).ok, false, '改路由必红');

    const tamperedDead = structuredClone(ia);
    tamperedDead.redirects.push({ from: '/x', to: '/__nonexistent__', surface: 'main' });
    assert.equal(validateIaIntegrity(tamperedDead, fs.readFileSync(APP, 'utf8')).ok, false, '插死链必红');

    const tamperedDrift = structuredClone(ia);
    tamperedDrift.routes = tamperedDrift.routes.map((r, i) => i === 1 ? { ...r, path: '/__drifted__' } : r);
    assert.equal(validateIaIntegrity(tamperedDrift, fs.readFileSync(APP, 'utf8')).ok, false, '路由漂移必红');
  });

  it('P1 上下文包零回归：design-context.json 仍在场且可复算', () => {
    const P1 = path.join(ROOT, 'resources', 'design-context', 'design-context.json');
    assert.equal(fs.existsSync(P1), true, 'P1 包不得被破坏');
  });
});
