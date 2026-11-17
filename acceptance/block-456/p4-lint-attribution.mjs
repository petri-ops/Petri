import { execFileSync } from 'node:child_process';

const files = process.argv.slice(2);
const OLD = process.env.OLD_REV || '90a60df6';
const NEW = process.env.NEW_REV || '51b2ad7d';

function gitShow(rev, f) {
  try {
    return execFileSync('git', ['show', `${rev}:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function lintStdin(content, f) {
  if (content == null) return { w: 0, e: 0, note: 'absent' };
  try {
    const out = execFileSync('npx', ['eslint', '--stdin', '--stdin-filename', f, '-f', 'json'], {
      input: content, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true,
    });
    return parse(out);
  } catch (err) {
    if (err.stdout) return parse(err.stdout);
    return { w: 0, e: 0, note: 'lint-error: ' + String(err.message).slice(0, 120) };
  }
}

function parse(out) {
  try {
    const r = JSON.parse(out);
    const msgs = (r[0]?.messages || []).filter((m) => !/File ignored/.test(m.message || ''));
    return {
      w: msgs.filter((m) => m.severity === 1).length,
      e: msgs.filter((m) => m.severity === 2).length,
      rules: msgs.filter((m) => m.severity === 1).map((m) => m.ruleId),
    };
  } catch {
    return { w: 0, e: 0, note: 'parse-error' };
  }
}

let totalDelta = 0;
for (const f of files) {
  if (/\.(css|md|json)$/.test(f)) continue;
  const before = lintStdin(gitShow(OLD, f), f);
  const after = lintStdin(gitShow(NEW, f), f);
  const delta = after.w - before.w;
  totalDelta += delta;
  if (delta !== 0 || after.e > 0) {
    console.log(`${delta >= 0 ? '+' : ''}${delta}  ${f}  (old W${before.w} → new W${after.w}, E${after.e})`);
    if (delta > 0) {
      const count = {};
      for (const r of after.rules || []) count[r] = (count[r] || 0) + 1;
      const oldCount = {};
      for (const r of before.rules || []) oldCount[r] = (oldCount[r] || 0) + 1;
      for (const [r, n] of Object.entries(count)) {
        const d = n - (oldCount[r] || 0);
        if (d > 0) console.log(`    ${r} +${d}`);
      }
    }
  }
}
console.log('TOTAL production-domain warning delta from commit:', totalDelta);