/**
 * test/docs-roll-index.test.mjs — README 按月滚动索引脚本的机械门（治理 skill
 * 「Archive or supersede documentation」滚动条款）。
 *
 * 钉住（fixtures 临时目录全离线）：
 * ①分桶：当月条目留 README，历史月迁 doc-index-YYYY-MM.md 且逐字保留；
 * ②entrypoint 改指：宿主条目文档与「链接嵌在宿主条目描述文本内」的文档
 *   （2026-10-13 README 瘦身批抓真的嵌链边缘）都按链接实际归属改指；
 * ③新索引自动注册 DOC-REGISTRY；
 * ④幂等：第二次运行零变化；
 * ⑤--check 预览（write=false）零写入。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { rollDocsIndex } = await import(
  new URL('../scripts/docs-roll-index.mjs', import.meta.url).href
);

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-roll-index-'));
  const docs = path.join(dir, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const readme = [
    '# docs entrance',
    '1. [`a-current-plan.md`](./a-current-plan.md) — 2026-11-02 当月条目，留在 README。',
    '2. [`b-old-plan.md`](./b-old-plan.md) — 2026-10-05 上月条目宿主。',
    '3. [`c-undated.md`](./c-undated.md) — 无日期条目留置。',
    '4. [`d-old-closeout.md`](./d-old-closeout.md) — 2026-09-20 另一历史月宿主，描述里嵌链 [e-embedded.md](./e-embedded.md) 与 [f-embedded.md](./f-embedded.md)。',
  ].join('\n');
  const registry = {
    schema: 'fixture',
    documents: [
      { id: 'A', path: 'docs/a-current-plan.md', kind: 'work-package', status: 'active', canonical: true, truthDomain: 'a', entrypoint: 'docs/README.md', archivePolicy: 'retain_stable_path' },
      { id: 'B', path: 'docs/b-old-plan.md', kind: 'work-package', status: 'completed', canonical: true, truthDomain: 'b', entrypoint: 'docs/README.md', archivePolicy: 'retain_stable_path' },
      { id: 'C', path: 'docs/c-undated.md', kind: 'reference', status: 'active', canonical: true, truthDomain: 'c', entrypoint: 'docs/README.md', archivePolicy: 'retain_stable_path' },
      { id: 'D', path: 'docs/d-old-closeout.md', kind: 'work-package', status: 'completed', canonical: true, truthDomain: 'd', entrypoint: 'docs/README.md', archivePolicy: 'retain_stable_path' },
      { id: 'E', path: 'docs/e-embedded.md', kind: 'work-package', status: 'completed', canonical: true, truthDomain: 'e', entrypoint: 'docs/README.md', archivePolicy: 'retain_stable_path' },
      { id: 'F', path: 'docs/f-embedded.md', kind: 'work-package', status: 'completed', canonical: true, truthDomain: 'f', entrypoint: 'docs/README.md', archivePolicy: 'retain_stable_path' },
    ],
    lastUpdated: '2026-11-01',
    documentCount: 6,
  };
  for (const doc of registry.documents) {
    fs.writeFileSync(path.join(docs, path.basename(doc.path)), `# ${doc.id}\n`);
  }
  fs.writeFileSync(path.join(docs, 'README.md'), readme);
  fs.writeFileSync(path.join(docs, 'DOC-REGISTRY.json'), JSON.stringify(registry, null, 2));
  return dir;
}

function entrypointOf(dir, id) {
  const registry = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'DOC-REGISTRY.json'), 'utf8'));
  return registry.documents.find((d) => d.id === id).entrypoint;
}

test('①②③ — 分桶迁出+嵌链改指+索引自注册', () => {
  const dir = makeFixture();
  const report = rollDocsIndex({ rootDir: dir, keepMonth: '2026-11', write: true });

  assert.equal(report.movedEntries, 2, '两个历史月宿主条目迁出');
  assert.deepEqual(report.movedMonths.sort(), ['2026-09', '2026-10']);
  assert.equal(report.indexesRegistered, 2, '两个索引文件注册');
  assert.ok(report.entrypointsRemapped >= 3, '宿主+嵌链文档改指');

  const readme = fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8');
  assert.ok(readme.includes('./a-current-plan.md'), '当月条目留在 README');
  assert.ok(readme.includes('./c-undated.md'), '无日期条目留置');
  assert.ok(!readme.includes('./b-old-plan.md'), '历史条目迁出 README');
  assert.ok(readme.includes('doc-index-2026-10.md'), 'README 挂索引链接');

  const idx10 = fs.readFileSync(path.join(dir, 'docs', 'doc-index-2026-10.md'), 'utf8');
  const idx09 = fs.readFileSync(path.join(dir, 'docs', 'doc-index-2026-09.md'), 'utf8');
  assert.ok(idx10.includes('./b-old-plan.md') && idx10.includes('2026-10-05'), '10 月索引逐字保留条目');
  assert.ok(idx09.includes('./d-old-closeout.md'), '9 月索引承接宿主条目');

  assert.equal(entrypointOf(dir, 'A'), 'docs/README.md', '当月文档 entrypoint 不动');
  assert.equal(entrypointOf(dir, 'C'), 'docs/README.md', '无日期留置文档 entrypoint 不动');
  assert.equal(entrypointOf(dir, 'B'), 'docs/doc-index-2026-10.md', '宿主条目文档改指所在索引');
  assert.equal(entrypointOf(dir, 'D'), 'docs/doc-index-2026-09.md', '9 月宿主改指');
  assert.equal(entrypointOf(dir, 'E'), 'docs/doc-index-2026-09.md', '嵌链文档①按链接归属改指（宿主行迁走后 README 已无其链接）');
  assert.equal(entrypointOf(dir, 'F'), 'docs/doc-index-2026-09.md', '嵌链文档②同上');

  const registry = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'DOC-REGISTRY.json'), 'utf8'));
  assert.equal(registry.documentCount, 8, 'documentCount 随索引注册增长');
  for (const rel of ['docs/doc-index-2026-10.md', 'docs/doc-index-2026-09.md']) {
    const idxDoc = registry.documents.find((d) => d.path === rel);
    assert.ok(idxDoc && idxDoc.kind === 'governance' && idxDoc.canonical === false, `索引 ${rel} 以 governance/canonical=false 注册`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('④ — 幂等：第二次运行零变化', () => {
  const dir = makeFixture();
  rollDocsIndex({ rootDir: dir, keepMonth: '2026-11', write: true });
  const snapshot = {
    readme: fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8'),
    idx10: fs.readFileSync(path.join(dir, 'docs', 'doc-index-2026-10.md'), 'utf8'),
    registry: fs.readFileSync(path.join(dir, 'docs', 'DOC-REGISTRY.json'), 'utf8'),
  };
  const second = rollDocsIndex({ rootDir: dir, keepMonth: '2026-11', write: true });
  assert.equal(second.movedEntries, 0, '第二次运行无待迁移条目');
  assert.equal(second.entrypointsRemapped, 0, '第二次运行零改指');
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8'), snapshot.readme, 'README 逐字节不变');
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'DOC-REGISTRY.json'), 'utf8'), snapshot.registry, 'registry 逐字节不变');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('⑤ — 预览模式（write=false）零写入', () => {
  const dir = makeFixture();
  const before = fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8');
  const report = rollDocsIndex({ rootDir: dir, keepMonth: '2026-11', write: false });
  assert.equal(report.movedEntries, 2, '预览仍报告将迁移的条目');
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8'), before, 'README 未被写入');
  assert.throws(() => fs.statSync(path.join(dir, 'docs', 'doc-index-2026-10.md')), '索引文件未落盘');
  fs.rmSync(dir, { recursive: true, force: true });
});
