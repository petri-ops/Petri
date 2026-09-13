/**
 * 脚本主入口守卫扫描门（G0-RS-P6-REFRESH 沉淀，2026-09-13）。
 *
 * 教训：10 个验收脚本曾用 `import.meta.url === \`file://${process.argv[1]}\``
 * 判定主入口——该比较在 Windows 恒 false（argv[1] 是盘符路径，
 * import.meta.url 是 file:/// URL）→ main() 静默不执行、脚本 exit 0，
 * 门禁空转通过。规范形态：`import.meta.url === pathToFileURL(process.argv[1]).href`。
 * 本测试扫描全部 .mjs，禁止坏模式回潮。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 坏模式按字符串拼接构造，避免本文件自身被模板串插值改写
const BAD_PATTERN = 'file://' + '$' + '{process.argv[1]}' + '`';

function collectMjsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'archive') continue;
      collectMjsFiles(full, out);
    } else if (entry.name.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

test('all .mjs entry guards use pathToFileURL, not file://${argv[1]} string compare', () => {
  const scanned = collectMjsFiles(join(REPO_ROOT, 'scripts'))
    .concat(collectMjsFiles(join(REPO_ROOT, 'core')));
  assert.equal(scanned.length > 0, true);
  const offenders = scanned
    .map((file) => ({ file, src: readFileSync(file, 'utf8') }))
    .filter(({ src }) => src.includes(BAD_PATTERN))
    .map(({ file }) => file);
  assert.deepEqual(
    offenders,
    [],
    `发现 Windows 静默空转的主入口守卫（改用 pathToFileURL(process.argv[1]).href）：${offenders.join(', ')}`,
  );
});
