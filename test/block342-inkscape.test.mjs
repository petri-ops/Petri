import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { probeInkscape, inkscapeStatus, buildArgs, ACTIONS, runInkscapeAction } from '../core/petri-server/helpers/inkscape.js';
import { tool_svg_inkscape } from '../core/petri-server/agent-tools/svg-tools.js';

describe('BLOCK-342 切片5 Inkscape 协处理器（探针与守卫）', () => {
  after(() => {
    delete process.env.PETRI_INKSCAPE_BIN;
  });

  it('探针：env 指向不存在的 bin → 诚实 available:false + hint', () => {
    const s = probeInkscape({ PETRI_INKSCAPE_BIN: '/nonexistent/inkscape-fake' });
    assert.equal(s.available, false);
    assert.match(s.hint, /PETRI_INKSCAPE_BIN/);
  });

  it('探针：env 指向真实可执行文件 → available + source=env', () => {
    const s = probeInkscape({ PETRI_INKSCAPE_BIN: process.execPath });
    assert.equal(s.available, true);
    assert.equal(s.source, 'env');
    assert.equal(s.bin, process.execPath);
  });

  it('inkscapeStatus：默认环境返回稳定形态（本机未装 → available:false）', () => {
    delete process.env.PETRI_INKSCAPE_BIN;
    const s = inkscapeStatus();
    assert.equal(typeof s.available, 'boolean');
    if (!s.available) assert.ok(s.hint);
  });

  it('ACTIONS 白名单与 buildArgs：布尔/文字转路径走 --actions，PDF 走导出参数', () => {
    assert.deepEqual([...ACTIONS].sort(), ['difference', 'export-pdf', 'intersection', 'text-to-path', 'union']);
    assert.equal(buildArgs('export-pdf', '/a.svg', '/a.pdf').join(' '), '--export-type=pdf --export-filename=/a.pdf /a.svg');
    assert.ok(buildArgs('union', '/a.svg', '/b.svg')[0].includes('select-all:objects;union'));
    assert.ok(buildArgs('text-to-path', '/a.svg', '/b.svg')[0].includes('select-all:texts;object-to-path'));
  });

  it('runInkscapeAction：缺席时 inkscape_unavailable（诚实拒绝，不假装执行）', () => {
    const before = process.env.PETRI_INKSCAPE_BIN;
    process.env.PETRI_INKSCAPE_BIN = '/nonexistent/inkscape-fake';
    runInkscapeAction({ action: 'union', svgAbs: '/x.svg', outAbs: '/y.svg' }, (e) => {
      assert.equal(e.code, 'inkscape_unavailable');
      if (before === undefined) delete process.env.PETRI_INKSCAPE_BIN; else process.env.PETRI_INKSCAPE_BIN = before;
    });
  });

  it('tool_svg_inkscape：缺席 → inkscape_unavailable（503 语义），不碰文件', () => {
    const before = process.env.PETRI_INKSCAPE_BIN;
    process.env.PETRI_INKSCAPE_BIN = '/nonexistent/inkscape-fake';
    tool_svg_inkscape({ filePath: 'whatever.svg', action: 'union' }, { projectId: 'p_none' }, (result) => {
      assert.equal(result.error, 'inkscape_unavailable');
      assert.equal(result.available, false);
      if (before === undefined) delete process.env.PETRI_INKSCAPE_BIN; else process.env.PETRI_INKSCAPE_BIN = before;
    });
  });
});
