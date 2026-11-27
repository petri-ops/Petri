/**
 * QODER-J2 — 技能自进化建议「忽略」账本（2026-11-23）。
 *
 * 独立 JSON 账本（不写 lessons.status——下次 distill 会用 excluded.status 覆盖导致忽略被撤销）。
 * 落点 <userData>/skill-suggestion-prefs.json，口径与 skill-prefs.js 同（PETRI_USER_DATA_DIR / ~/.petri）。
 * 零新依赖、读面每次落盘重读（文件即真相）、写面 fail-closed。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dataPaths = require('./data-paths.js');

const FILE = 'skill-suggestion-prefs.json';
const FINGERPRINT_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

function prefsPath() {
  return path.join(dataPaths.resolveDataDir(), FILE);
}

function loadIgnored() {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    const ignored = parsed && parsed.ignored && typeof parsed.ignored === 'object' ? parsed.ignored : {};
    const clean = {};
    for (const [fingerprint, entry] of Object.entries(ignored)) {
      if (!FINGERPRINT_RE.test(fingerprint) || !entry || typeof entry !== 'object') continue;
      Object.defineProperty(clean, fingerprint, {
        value: {
          at: typeof entry.at === 'string' ? entry.at.slice(0, 40) : '',
          reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 200) : undefined,
        },
        writable: true, enumerable: true, configurable: true,
      });
    }
    return clean;
  } catch {
    return {};
  }
}

function ignoreSuggestion(fingerprint, reason) {
  const key = String(fingerprint || '');
  if (!FINGERPRINT_RE.test(key)) return { ok: false, error: 'invalid_fingerprint' };
  const ignored = loadIgnored();
  const entry = { at: new Date().toISOString(), ...(reason ? { reason: String(reason).slice(0, 200) } : {}) };
  Object.defineProperty(ignored, key, { value: entry, writable: true, enumerable: true, configurable: true });
  try {
    const target = prefsPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify({ version: 1, ignored }, null, 2)}\n`, 'utf8');
    return { ok: true, fingerprint: key };
  } catch (error) {
    return { ok: false, error: 'write_failed', message: String(error && error.message || error).slice(0, 200) };
  }
}

function unignoreSuggestion(fingerprint) {
  const key = String(fingerprint || '');
  if (!FINGERPRINT_RE.test(key)) return { ok: false, error: 'invalid_fingerprint' };
  const ignored = loadIgnored();
  if (!Object.prototype.hasOwnProperty.call(ignored, key)) return { ok: true, fingerprint: key, removed: false };
  Reflect.deleteProperty(ignored, key);
  try {
    fs.writeFileSync(prefsPath(), `${JSON.stringify({ version: 1, ignored }, null, 2)}\n`, 'utf8');
    return { ok: true, fingerprint: key, removed: true };
  } catch (error) {
    return { ok: false, error: 'write_failed', message: String(error && error.message || error).slice(0, 200) };
  }
}

module.exports = { loadIgnored, ignoreSuggestion, unignoreSuggestion };
