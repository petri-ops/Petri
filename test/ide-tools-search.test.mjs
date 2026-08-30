// test/ide-tools-search.test.mjs
// Phase 2 search operation: ide_file_search_text MCP tool end-to-end tests
// Reference: G0-IDE-MCP-TOOLS Phase 2 (search)
//
// Run: node --test test/ide-tools-search.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dirname, '..', 'core', 'biof3-server');

const ideTools = await import(
  pathToFileURL(resolve(CORE, 'mcp/ide-tools/index.js')).href
);
const { _rawHandlers } = ideTools;
const H = _rawHandlers;

// helper: 构造包含若干行的文件
function seedCorpus(tmp, name, lines) {
  const filePath = `${tmp}/${name}`;
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return filePath;
}

test('ide_file_search_text finds matches across files', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-search-`);
  seedCorpus(tmp, 'a.txt', [
    'alpha line',
    'this contains BIOF3_TOKEN in the middle',
    'beta line',
  ]);
  seedCorpus(tmp, 'b.md', [
    'preface',
    'another BIOF3_TOKEN here',
    'trailing',
  ]);

  const res = H.ide_file_search_text({
    path: tmp,
    pattern: 'BIOF3_TOKEN',
  });
  assert.equal(res.ok, true, `search failed: ${res.error}`);
  assert.equal(res.count, 2, `expected 2 matches, got ${res.count}`);
  assert.equal(res.truncated, false);
  assert.equal(res.matches.length, 2);
  for (const m of res.matches) {
    assert.ok(typeof m.file === 'string' && m.file.length > 0);
    assert.ok(typeof m.line === 'number' && m.line >= 1);
    assert.ok(typeof m.column === 'number' && m.column >= 1);
    assert.ok(m.text.includes('BIOF3_TOKEN'));
    assert.ok(Array.isArray(m.context));
  }
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_search_text rejects empty pattern', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-search-`);
  const noPattern = H.ide_file_search_text({ path: tmp, pattern: '' });
  assert.equal(noPattern.ok, false);
  assert.match(noPattern.error, /pattern must be a non-empty string/);

  const whitespace = H.ide_file_search_text({ path: tmp, pattern: '   ' });
  assert.equal(whitespace.ok, false);
  assert.match(whitespace.error, /pattern must be a non-empty string/);

  const missing = H.ide_file_search_text({ path: tmp });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /pattern must be a non-empty string/);

  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_search_text rejects out-of-allowlist path', () => {
  const res = H.ide_file_search_text({
    path: '/etc',
    pattern: 'root',
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);

  // ~/.ssh 也应当被 deny-segment 拒绝
  const ssh = H.ide_file_search_text({
    path: `${os.homedir()}/.ssh`,
    pattern: 'ssh-rsa',
  });
  assert.equal(ssh.ok, false);
});

test('ide_file_search_text respects maxResults cap (truncates)', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-search-`);
  // 在一个文件中放 5 行匹配
  const lines = [];
  for (let i = 0; i < 5; i += 1) lines.push(`match line ${i}`);
  seedCorpus(tmp, 'many.txt', lines);

  // 要求只返回 2 个
  const res = H.ide_file_search_text({
    path: tmp,
    pattern: 'match line',
    maxResults: 2,
  });
  assert.equal(res.ok, true);
  assert.equal(res.count, 2, `expected 2 matches, got ${res.count}`);
  assert.equal(res.truncated, true);
  assert.equal(res.matches.length, 2);

  // 要求超过硬上限 1000：应被截断到 1000（且 truncated=true）
  const huge = H.ide_file_search_text({
    path: tmp,
    pattern: 'match line',
    maxResults: 5000,
  });
  assert.equal(huge.ok, true);
  assert.equal(huge.count, 5, 'all 5 corpus matches should fit under hard cap');
  // 用户传入 >1000 也应标记 truncated（wasCapped 路径）
  assert.equal(huge.truncated, true);

  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_search_text with context returns surrounding lines', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-search-`);
  seedCorpus(tmp, 'ctx.txt', [
    'before-1',
    'before-2',
    'TARGET_LINE',
    'after-1',
    'after-2',
  ]);

  const res = H.ide_file_search_text({
    path: tmp,
    pattern: 'TARGET_LINE',
    context: 2,
  });
  assert.equal(res.ok, true, `search failed: ${res.error}`);
  assert.equal(res.count, 1);
  const m = res.matches[0];
  assert.equal(m.text.trim(), 'TARGET_LINE');
  assert.ok(Array.isArray(m.context));
  assert.ok(
    m.context.length >= 2,
    `expected >=2 context lines, got ${m.context.length}`
  );
  // context 中应包含 before/after 行
  const ctxText = m.context.map((c) => c.text).join('\n');
  assert.ok(ctxText.includes('before-1') || ctxText.includes('before-2'));
  assert.ok(ctxText.includes('after-1') || ctxText.includes('after-2'));
  // context 元素结构
  for (const c of m.context) {
    assert.ok(typeof c.line === 'number');
    assert.ok(typeof c.text === 'string');
  }

  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_search_text filePattern restricts to glob', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-search-`);
  seedCorpus(tmp, 'note.txt', ['TOKEN in txt']);
  seedCorpus(tmp, 'note.md', ['TOKEN in md']);

  const onlyTxt = H.ide_file_search_text({
    path: tmp,
    pattern: 'TOKEN',
    filePattern: '*.txt',
  });
  assert.equal(onlyTxt.ok, true);
  assert.equal(onlyTxt.count, 1);
  assert.ok(onlyTxt.matches[0].file.endsWith('.txt'));

  const onlyMd = H.ide_file_search_text({
    path: tmp,
    pattern: 'TOKEN',
    filePattern: '*.md',
  });
  assert.equal(onlyMd.ok, true);
  assert.equal(onlyMd.count, 1);
  assert.ok(onlyMd.matches[0].file.endsWith('.md'));

  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_search_text fixed-strings mode (regex=false)', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-search-`);
  seedCorpus(tmp, 'fixed.txt', [
    'plain text',
    'a.b.c pattern', // 正则下 . 是元字符；fixed-strings 下应字面命中
    'no match',
  ]);

  // regex=true 时，模式 "a.b.c" 应只命中 'a.b.c' 这一行（不能匹配 'axxbbxc' 之类）
  const regexMode = H.ide_file_search_text({
    path: tmp,
    pattern: 'a.b.c',
    regex: true,
  });
  assert.equal(regexMode.ok, true);
  assert.equal(regexMode.count, 1);

  // regex=false 时同样应命中 'a.b.c' 那一行
  const fixedMode = H.ide_file_search_text({
    path: tmp,
    pattern: 'a.b.c',
    regex: false,
  });
  assert.equal(fixedMode.ok, true);
  assert.equal(fixedMode.count, 1);

  fs.rmSync(tmp, { recursive: true });
});
