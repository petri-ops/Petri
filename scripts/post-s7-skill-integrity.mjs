#!/usr/bin/env node
/**
 * scripts/post-s7-skill-integrity.mjs — B-29 内置 Skill 摘要单点（sha256 占位转正）。
 *
 * 现状：resources/skills/manifest.json 11 条 built-in skill 的 artifacts.*.sha256 全是 null，
 * 因为 url 是 `built-in://skills/<id>`（本地目录，没有可下载 tarball）。null 不是错误，
 * 但**等于没有完整性证据**：目录内容被改了无人知道。
 *
 * 本脚本计算每个内置 skill 目录的内容摘要（文件相对路径 + 内容，按路径排序后逐段喂 sha256），
 * 写入 manifest 的 `integrity.builtinSha256` 字段（**不改 sha256 字段语义**：
 * 它仍表示「下载产物摘要」，对 built-in 恒为 null 是正确语义），并支持 --check 校验漂移：
 *   - 目录内容变了而 manifest 没重算 → 红；
 *   - 登记条目与目录不一一对应 → 红；
 *   - 手工把 sha256 写成非 null（伪造下载产物摘要）→ 红。
 *
 * 不新建第二真相：integrity 字段直接写在同一份 manifest 内，由本脚本唯一写入。
 * 用法：node scripts/post-s7-skill-integrity.mjs [--write|--check] [--json]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'resources/skills');
const MANIFEST = path.join(SKILLS_DIR, 'manifest.json');

const SKIP = new Set(['manifest.json', '.DS_Store']);

function collect(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(abs, rel));
    else out.push({ rel, bytes: fs.readFileSync(abs) });
  }
  return out;
}

export function builtinDigest(dir) {
  if (!fs.existsSync(dir)) return null;
  const h = crypto.createHash('sha256');
  for (const f of collect(dir)) {
    h.update(f.rel); h.update('\0'); h.update(f.bytes); h.update('\0');
  }
  return h.digest('hex');
}

export function evaluateSkillIntegrity(manifest, digests) {
  const issues = [];
  const skills = manifest.skills || {};
  const checked = [];
  for (const [id, entry] of Object.entries(skills)) {
    const current = digests[id];
    if (!current) { issues.push(`${id}: 内置目录不存在或不可读`); continue; }
    // 下载产物摘要对 built-in 必须是 null（不许伪造）
    for (const [platform, artifact] of Object.entries(entry.artifacts || {})) {
      if (artifact?.url?.startsWith('built-in://') && artifact.sha256 !== null) {
        issues.push(`${id}/${platform}: built-in 产物 sha256 非 null（伪造下载摘要）`);
      }
    }
    const recorded = entry.integrity?.builtinSha256;
    if (!recorded) issues.push(`${id}: 缺 integrity.builtinSha256（未重算）`);
    else if (recorded !== current) issues.push(`${id}: 内容摘要漂移（目录改了未重算 / manifest 被手改）`);
    checked.push({ id, digest: current, recorded: recorded || null });
  }
  const extra = Object.keys(digests).filter((id) => !Object.prototype.hasOwnProperty.call(skills, id));
  if (extra.length) issues.push(`目录有未登记 skill：${extra.join(', ')}`);
  return { ok: issues.length === 0, issues, checked };
}

function realDigests() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const digests = {};
  for (const id of Object.keys(manifest.skills || {})) {
    const d = builtinDigest(path.join(SKILLS_DIR, id));
    if (d) digests[id] = d;
  }
  return { manifest, digests };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { manifest, digests } = realDigests();
  if (process.argv.includes('--write')) {
    for (const [id, entry] of Object.entries(manifest.skills || {})) {
      if (digests[id]) entry.integrity = { ...(entry.integrity || {}), builtinSha256: digests[id] };
    }
    manifest.integrityNote = 'builtinSha256 = 目录内容稳定摘要（scripts/post-s7-skill-integrity.mjs --write 唯一写入）；sha256 字段仍表示下载产物摘要，built-in 恒为 null。';
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`[skill-integrity] --write ${Object.keys(digests).length} 条内置摘要入册`);
  } else {
    const r = evaluateSkillIntegrity(manifest, digests);
    if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else if (r.ok) console.log(`[skill-integrity] PASS — ${r.checked.length} 条内置 skill 内容摘要一致`);
    else { console.error('[skill-integrity] FAIL：'); for (const i of r.issues) console.error(`  - ${i}`); }
    process.exitCode = r.ok ? 0 : 1;
  }
}
