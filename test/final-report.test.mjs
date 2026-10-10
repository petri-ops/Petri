import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {materializeFinalReport} = require('../core/petri-server/helpers/final-report');

test('materializeFinalReport creates a self-contained HTML delivery artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-final-report-'));
  try {
    fs.writeFileSync(path.join(dir, 'plot.png'), Buffer.from('image-bytes'));
    fs.writeFileSync(path.join(dir, 'report.html'), '<html><head></head><body><img src="plot.png"><a href="data.csv">data</a></body></html>');
    fs.writeFileSync(path.join(dir, 'data.csv'), 'a,b\n1,2\n');
    const result = materializeFinalReport({
      outputDir: dir,
      generatedAt: '2026-07-14T00:00:00.000Z',
      transformHtml: (html) => html.replace('<body>', '<body data-theme="dark">'),
    });
    const html = fs.readFileSync(path.join(dir, result.fileName), 'utf8');
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /petri-final-report-generated-at/);
    assert.match(html, /data-theme="dark"/);
    assert.match(html, /href="data.csv"/);
    assert.deepEqual(result.embeddedAssets, ['plot.png']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
