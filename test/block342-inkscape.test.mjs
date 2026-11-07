import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { probeInkscape, inkscapeStatus, buildArgs, ACTIONS, runInkscapeAction } from '../core/petri-server/helpers/inkscape.js';
import { tool_svg_inkscape } from '../core/petri-server/agent-tools/svg-tools.js';

describe('BLOCK-342 切片5 Inkscape 协处理器（探针与守卫）', () => {
  after(() => {
    delete process.env.PETRI_INKSCAPE_BIN;
  });

  it('探针：env 指向不存在的 bin → 绝不冒认 env bin；缺席时诚实 unavailable + hint', () => {
    // BLOCK-375（S0）契约追新（ea68f5cd / BLOCK-345 后本机装有 Inkscape 1.4.4）：
    // 探针设计=env 优先、其后常见安装路径——env bin 不可执行时继续扫路径候选。
    // 机器无关的不变量=坏 env bin 绝不会被选中（source 不得为 'env'）；
    // 全部候选缺席时 available:false + hint（hint 提到 PETRI_INKSCAPE_BIN）。
    const s = probeInkscape({ PETRI_INKSCAPE_BIN: '/nonexistent/inkscape-fake' });
    assert.notEqual(s.source, 'env', '不可执行的 env bin 不得被选中');
    if (!s.available) assert.match(s.hint, /PETRI_INKSCAPE_BIN/);
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

  it('ACTIONS 白名单与 buildArgs：1.4 实名 path-*（BLOCK-345 实机抓真）+ PDF/文字走导出参数', () => {
    // BLOCK-375（S0）契约追新：ea68f5cd（BLOCK-345）实证 1.4 actions 表只有
    // path-union/path-difference/path-intersection（旧名静默中断假 changed）；
    // select-all 枚举无 objects/texts，用 no-groups。
    assert.deepEqual([...ACTIONS].sort(), ['difference', 'export-pdf', 'intersection', 'text-to-path', 'union']);
    assert.equal(buildArgs('export-pdf', '/a.svg', '/a.pdf').join(' '), '--export-type=pdf --export-filename=/a.pdf /a.svg');
    assert.equal(buildArgs('union', '/a.svg', '/b.svg')[0], '--actions=select-all:no-groups;path-union;export-filename:/b.svg;export-do');
    assert.equal(buildArgs('text-to-path', '/a.svg', '/b.svg')[0], '--export-text-to-path');
    assert.equal(buildArgs('text-to-path', '/a.svg', '/b.svg')[1], '--export-filename=/b.svg');
  });

  it('runInkscapeAction：缺席时 inkscape_unavailable（诚实拒绝，不假装执行）', () => {
    // BLOCK-375（S0）hermetic 化：BLOCK-345 后本机装有真实 Inkscape，env 坏 bin 会
    // 回退路径候选真实执行 → 断言依赖机器环境且异步活动越过测试边界。
    // 改注入缺席探针（args.status 缝，与 ctx.db 同风格），机器无关。
    runInkscapeAction({ action: 'union', svgAbs: '/x.svg', outAbs: '/y.svg', status: { available: false, hint: '未检测到 Inkscape；安装后重启，或设 PETRI_INKSCAPE_BIN 指向可执行文件' } }, (e) => {
      assert.equal(e.code, 'inkscape_unavailable');
      assert.match(e.message || '', /PETRI_INKSCAPE_BIN/);
    });
  });

  it('tool_svg_inkscape：缺席 → inkscape_unavailable（503 语义），不碰文件不触 DB', () => {
    // BLOCK-375（S0）hermetic 化：注入缺席探针（ctx.inkscapeStatus 缝）——
    // 探针前置语义=缺席时不触 DB（不 resolveProject），环境无关。
    let dbTouched = false;
    tool_svg_inkscape({ filePath: 'whatever.svg', action: 'union' }, {
      projectId: 'p_none',
      inkscapeStatus: () => ({ available: false, hint: '未检测到 Inkscape；安装后重启，或设 PETRI_INKSCAPE_BIN 指向可执行文件' }),
      get db() { dbTouched = true; return {}; },
    }, (result) => {
      assert.equal(result.error, 'inkscape_unavailable');
      assert.equal(result.available, false);
      assert.equal(dbTouched, false, '缺席拒绝不得触 DB');
    });
  });
});
