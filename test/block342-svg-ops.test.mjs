/**
 * BLOCK-342 W1 P1 — span 改写引擎契约（红绿先行：测试先落盘并跑红，再实现转绿）。
 *
 * 只钉机制（plan §2）：
 *  - 解析：保留原始文本的 span 树（注释/CDATA/PI/DOCTYPE/命名空间/单引号/实体一律原样）。
 *  - 零操作零 diff：ops=[] ⇒ 输出逐字节等于输入。
 *  - 改动局部性：任一 op 只动目标元素 span 内的字节，span 外逐字节相同。
 *  - 定位器：{id} / {path:number[]} 双端确定性解析；找不到 svg_target_not_found。
 *  - 冲突安全：expectedSha 与当前文本不符 ⇒ svg_hash_mismatch（人修正不被覆盖）。
 *  - 安全：script/foreignObject/on 事件属性/javascript: 链接 ⇒ svg_unsafe_markup；sanitizeSvg 脱敏其余字节不动。
 *  - 白名单 op：set_attr / remove_attr / set_style / set_text / insert / remove / move，之外 svg_op_not_allowed。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = require(path.join(ROOT, 'core/petri-server/helpers/svg-ops.js'));

// 科研出图形态（matplotlib/Illustrator 导出家族）：命名空间、单引号、CDATA、注释、实体、自闭合。
const FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with matplotlib (https://matplotlib.org/) -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="120" height="80" viewBox="0 0 120 80">
  <defs>
    <clipPath id="p1a2b">
      <rect x="0" y="0" width="120" height="80" />
    </clipPath>
  </defs>
  <style type="text/css"><![CDATA[
    .tick { stroke: #333; }
  ]]></style>
  <sodipodi:namedview id="namedview1" inkscape:zoom="1.2" />
  <g id="axes">
    <text id="title" x="60" y="20" text-anchor="middle" font-family='Helvetica'>Tom &amp; Jerry</text>
    <rect id="bar" x="10" y="40" width="20" height="30" fill="#4c72b0"/>
  </g>
</svg>
`;

/** 统一走工具层包装（svg_edit 也消费它）：不抛、稳定 code。 */
function run(text, ops, options) {
  return svg.applyOpsSafe(text, ops, options);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

function elementById(text, id) {
  return svg.parseSvg(text).elements.find((el) => el.id === id);
}

test('BLOCK-342 P1 解析：元素树保留 path/id/span，注释与 CDATA 不进元素清单', () => {
  const parsed = svg.parseSvg(FIXTURE);
  const tags = parsed.elements.map((el) => el.tag);
  assert.ok(tags.includes('svg'));
  assert.ok(tags.includes('clipPath'));
  assert.ok(tags.includes('text'));
  assert.ok(tags.includes('rect'));
  // 注释 / CDATA / PI / DOCTYPE 不是元素
  assert.ok(!tags.some((t) => t.startsWith('!') || t.startsWith('?')), tags.join(','));

  const title = parsed.elements.find((el) => el.id === 'title');
  assert.deepEqual(title.path, [3, 0], `path=${JSON.stringify(title.path)}`);
  assert.equal(title.tag, 'text');
  assert.equal(FIXTURE.slice(title.start, title.start + 5), '<text');
  assert.equal(FIXTURE.slice(title.end - 7, title.end), '</text>');

  const root = parsed.elements[0];
  assert.deepEqual(root.path, []);
  assert.equal(root.tag, 'svg');
  assert.ok(FIXTURE.slice(0, root.end).endsWith('</svg>'), FIXTURE.slice(root.end - 12, root.end));

  // 畸形文档：解析失败必须给出 svg_parse_error（工具层不再猜）
  assert.throws(() => svg.parseSvg('<svg><g></svg>'), (e) => e.code === 'svg_parse_error');
});

test('BLOCK-342 P1 raw text：style/script 内部 `<` 不打断解析（科研导出 CSS 兜底）', () => {
  const text = '<svg><style>g > text { content: "<"; }</style><text id="t">a</text></svg>';
  const parsed = svg.parseSvg(text);
  const style = parsed.elements.find((el) => el.tag === 'style');
  assert.ok(style, 'style 元素应被解析');
  assert.ok(style.text.includes('content'), style.text);
  assert.equal(parsed.byId.get('t').tag, 'text');
});

test('BLOCK-342 P1 定位器：{id} 与 {path} 双端一致；找不到 svg_target_not_found', () => {
  const byId = run(FIXTURE, [{ op: 'set_attr', target: { id: 'bar' }, name: 'width', value: '21' }]);
  assert.equal(byId.ok, true, JSON.stringify(byId));
  assert.ok(byId.text.includes('width="21"'));

  const byPath = run(FIXTURE, [{ op: 'set_attr', target: { path: [3, 0] }, name: 'x', value: '61' }]);
  assert.equal(byPath.ok, true, JSON.stringify(byPath));
  assert.ok(byPath.text.includes('x="61"'));

  const missing = run(FIXTURE, [{ op: 'set_attr', target: { id: 'ghost' }, name: 'a', value: 'b' }]);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'svg_target_not_found');

  const missingPath = run(FIXTURE, [{ op: 'set_attr', target: { path: [9] }, name: 'a', value: 'b' }]);
  assert.equal(missingPath.code, 'svg_target_not_found');

  const both = run(FIXTURE, [{ op: 'set_attr', target: { id: 'bar', path: [3, 1] }, name: 'a', value: 'b' }]);
  assert.equal(both.code, 'svg_target_invalid');
});

test('BLOCK-342 P1 零操作零 diff：输出逐字节等于输入', () => {
  const r = run(FIXTURE, []);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.text, FIXTURE);
  assert.equal(r.changed, false);
  assert.equal(r.beforeSha, sha256(FIXTURE));
  assert.equal(r.afterSha, r.beforeSha);
  assert.deepEqual(r.applied, []);
});

test('BLOCK-342 P1 改动局部性：set_attr 只动目标元素 span 内字节', () => {
  const target = elementById(FIXTURE, 'bar');
  const r = run(FIXTURE, [{ op: 'set_attr', target: { id: 'bar' }, name: 'fill', value: '#cc0000' }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.text.includes('fill="#cc0000"'));
  const prefix = commonPrefix(FIXTURE, r.text);
  const suffix = commonSuffix(FIXTURE, r.text);
  assert.ok(prefix >= target.start, `prefix=${prefix} 必须 >= 目标起始 ${target.start}`);
  assert.ok(r.text.length - suffix <= target.end, '改动尾部越出目标 span');
  // 其余科研结构逐字节保留
  assert.ok(r.text.includes('<![CDATA['));
  assert.ok(r.text.includes('xmlns:inkscape'));
  assert.ok(r.text.includes('<!-- Created with matplotlib'));
  assert.ok(r.text.includes('Tom &amp; Jerry'));
  assert.ok(r.text.includes("font-family='Helvetica'"));
});

test('BLOCK-342 P1 set_attr：新增 / 覆盖 / 删除；引号风格保留；设同值零变化', () => {
  const added = run(FIXTURE, [{ op: 'set_attr', target: { id: 'bar' }, name: 'data-role', value: 'series' }]);
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.ok(added.text.includes('data-role="series"'), added.text);
  assert.ok(/data-role="series"\s*\/>/.test(added.text), `新增属性必须落在自闭合收尾前：${added.text}`);
  assert.ok(added.text.includes('fill="#4c72b0"'), added.text);

  const single = run(FIXTURE, [{ op: 'set_attr', target: { id: 'title' }, name: 'font-family', value: 'Arial' }]);
  assert.equal(single.ok, true);
  assert.ok(single.text.includes("font-family='Arial'"), '单引号风格必须保留');

  const same = run(FIXTURE, [{ op: 'set_attr', target: { id: 'bar' }, name: 'fill', value: '#4c72b0' }]);
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(same.text, FIXTURE);

  const removed = run(FIXTURE, [{ op: 'remove_attr', target: { id: 'bar' }, name: 'fill' }]);
  assert.equal(removed.ok, true);
  assert.ok(!removed.text.includes('fill="#4c72b0"'));
  assert.ok(removed.text.includes('<rect id="bar" x="10" y="40" width="20" height="30"/>'), removed.text);
});

test('BLOCK-342 P1 set_style：键值合并 / null 删键 / 新建 style 属性', () => {
  const merge = run(FIXTURE, [{
    op: 'set_style', target: { id: 'bar' }, props: { fill: '#ff0000', stroke: null },
  }]);
  assert.equal(merge.ok, true, JSON.stringify(merge));
  assert.ok(merge.text.includes('style="fill:#ff0000"'), merge.text);

  const withStyle = run(FIXTURE, [{
    op: 'set_style', target: { id: 'bar' }, props: { opacity: '0.5' },
  }]);
  assert.ok(withStyle.text.includes('style="opacity:0.5"'), withStyle.text);

  const edit = run(merge.text, [{
    op: 'set_style', target: { id: 'bar' }, props: { fill: '#00ff00' },
  }]);
  assert.ok(edit.text.includes('style="fill:#00ff00"'), edit.text);

  const drop = run(merge.text, [{
    op: 'set_style', target: { id: 'bar' }, props: { fill: null },
  }]);
  assert.ok(!drop.text.includes('style='), drop.text);

  const bad = run(FIXTURE, [{ op: 'set_style', target: { id: 'bar' }, props: { 'bad key': 'x' } }]);
  assert.equal(bad.code, 'svg_op_invalid');
});

test('BLOCK-342 P1 set_text：转义安全；容器元素拒绝；自闭合改写为开闭标签', () => {
  const r = run(FIXTURE, [{ op: 'set_text', target: { id: 'title' }, text: 'A & B <C>' }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.text.includes('>A &amp; B &lt;C&gt;</text>'), r.text);
  assert.ok(r.text.includes('<text id="title"'), r.text);

  const hasChild = run(FIXTURE, [{ op: 'set_text', target: { id: 'axes' }, text: 'x' }]);
  assert.equal(hasChild.ok, false);
  assert.equal(hasChild.code, 'svg_set_text_on_container');

  const selfClosing = run(FIXTURE, [{ op: 'set_text', target: { id: 'bar' }, text: 'x' }]);
  assert.equal(selfClosing.ok, true, JSON.stringify(selfClosing));
  assert.ok(selfClosing.text.includes('>x</rect>'), selfClosing.text);
});

test('BLOCK-342 P1 insert / remove / move：结构内定位与层序', () => {
  const inserted = run(FIXTURE, [{
    op: 'insert', parent: { id: 'axes' }, index: 0, markup: '<circle id="dot" cx="5" cy="5" r="2" />',
  }]);
  assert.equal(inserted.ok, true, JSON.stringify(inserted));
  const afterInsert = svg.parseSvg(inserted.text);
  const axes = afterInsert.elements.find((el) => el.id === 'axes');
  assert.equal(axes.children[0].id, 'dot', '插入必须落在 index 位置');
  assert.equal(axes.children[1].id, 'title');

  const appended = run(FIXTURE, [{
    op: 'insert', parent: { id: 'axes' }, index: 'end', markup: '<circle id="tail" cx="1" cy="1" r="1" />',
  }]);
  const axesTail = svg.parseSvg(appended.text).elements.find((el) => el.id === 'axes');
  assert.equal(axesTail.children[axesTail.children.length - 1].id, 'tail');

  const removed = run(FIXTURE, [{ op: 'remove', target: { id: 'bar' } }]);
  assert.equal(removed.ok, true);
  assert.ok(!removed.text.includes('id="bar"'));

  const moved = run(FIXTURE, [{ op: 'move', target: { id: 'bar' }, parent: { id: 'axes' }, index: 0 }]);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  const afterMove = svg.parseSvg(moved.text);
  const axesMoved = afterMove.elements.find((el) => el.id === 'axes');
  assert.equal(axesMoved.children[0].id, 'bar');
  assert.equal(axesMoved.children[1].id, 'title');
  assert.equal(afterMove.elements.filter((el) => el.id === 'bar').length, 1, 'move 后不得残留副本');

  const rootRemove = run(FIXTURE, [{ op: 'remove', target: { path: [] } }]);
  assert.equal(rootRemove.ok, false);
  assert.equal(rootRemove.code, 'svg_remove_root');

  const intoSelf = run(FIXTURE, [{ op: 'move', target: { id: 'axes' }, parent: { id: 'axes' }, index: 0 }]);
  assert.equal(intoSelf.code, 'svg_move_into_self');

  const badIndex = run(FIXTURE, [{ op: 'insert', parent: { id: 'axes' }, index: 99, markup: '<circle id="x" />' }]);
  assert.equal(badIndex.code, 'svg_op_invalid');

  const twoElements = run(FIXTURE, [{ op: 'insert', parent: { id: 'axes' }, index: 0, markup: '<circle /><circle />' }]);
  assert.equal(twoElements.code, 'svg_op_invalid');
});

test('BLOCK-342 P1 冲突安全：expectedSha 不符 ⇒ svg_hash_mismatch', () => {
  const stale = run(FIXTURE, [{ op: 'set_attr', target: { id: 'bar' }, name: 'width', value: '99' }], {
    expectedSha: 'deadbeef',
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'svg_hash_mismatch');
  assert.equal(stale.actual, sha256(FIXTURE));
  assert.equal(stale.text, undefined, '冲突时不得返回改写后的文本');

  const fresh = run(FIXTURE, [{ op: 'set_attr', target: { id: 'bar' }, name: 'width', value: '99' }], {
    expectedSha: sha256(FIXTURE),
  });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
});

test('BLOCK-342 P1 安全：script / foreignObject / on* / javascript: ⇒ svg_unsafe_markup', () => {
  const cases = [
    { op: 'insert', parent: { id: 'axes' }, index: 'end', markup: '<script>alert(1)</script>' },
    { op: 'insert', parent: { id: 'axes' }, index: 'end', markup: '<foreignObject><b>x</b></foreignObject>' },
    { op: 'insert', parent: { id: 'axes' }, index: 'end', markup: '<rect onclick="alert(1)" />' },
    { op: 'insert', parent: { id: 'axes' }, index: 'end', markup: '<a href="javascript:alert(1)"><text>x</text></a>' },
    { op: 'set_attr', target: { id: 'bar' }, name: 'onclick', value: 'alert(1)' },
    { op: 'set_attr', target: { id: 'bar' }, name: 'href', value: 'javascript:alert(1)' },
    { op: 'set_style', target: { id: 'bar' }, props: { fill: 'url(javascript:alert(1))' } },
  ];
  for (const op of cases) {
    const r = run(FIXTURE, [op]);
    assert.equal(r.ok, false, `应当拒收：${JSON.stringify(op)}`);
    assert.equal(r.code, 'svg_unsafe_markup', `${JSON.stringify(op)} → ${r.code}`);
  }

  const unknown = run(FIXTURE, [{ op: 'rewrite_entire_file', target: { id: 'bar' } }]);
  assert.equal(unknown.code, 'svg_op_not_allowed');
});

test('BLOCK-342 P1 sanitizeSvg：剥离危险面，其余字节保持', () => {
  const dirty = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
  <!-- keep me -->
  <script type="text/javascript">if (a < b) alert('x')</script>
  <foreignObject width="10" height="10"><b>html</b></foreignObject>
  <a xlink:href="javascript:alert(2)"><text id="t">ok</text></a>
  <rect id="r" x="1" y="2" onclick="steal()" fill="#123456" />
</svg>
`;
  const r = svg.sanitizeSvg(dirty);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!/<\s*script/i.test(r.text), r.text);
  assert.ok(!/foreignObject/i.test(r.text), r.text);
  assert.ok(!/onload\s*=/i.test(r.text), r.text);
  assert.ok(!/onclick\s*=/i.test(r.text), r.text);
  assert.ok(!/javascript:/i.test(r.text), r.text);
  // 其余字节保持
  assert.ok(r.text.includes('<!-- keep me -->'));
  assert.ok(r.text.includes('fill="#123456"'));
  assert.ok(r.text.includes('<text id="t">ok</text>'));
  assert.ok(r.text.includes('<?xml version="1.0"?>'));
  assert.ok(r.removed.length >= 5, JSON.stringify(r.removed));

  // 干净文件：零改动（不制造 diff）
  const clean = svg.sanitizeSvg(FIXTURE);
  assert.equal(clean.ok, true);
  assert.equal(clean.text, FIXTURE);
  assert.deepEqual(clean.removed, []);

  // 畸形文档：fail-closed，绝不把未脱敏文本当已脱敏
  const broken = svg.sanitizeSvg('<svg><g></svg>');
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'svg_parse_error');
});

test('BLOCK-342 P1 inspectSvg：元素清单（tag 过滤 / limit / 文本节选）与安全标记', () => {
  const list = svg.inspectSvg(FIXTURE);
  assert.equal(list.ok, true, JSON.stringify({ ok: list.ok, code: list.code }));
  assert.equal(list.rootTag, 'svg');
  assert.ok(list.total >= 6, `total=${list.total}`);
  assert.ok(!list.unsafe.any);

  const texts = svg.inspectSvg(FIXTURE, { tag: 'text' });
  assert.equal(texts.elements.length, 1);
  assert.equal(texts.elements[0].id, 'title');
  assert.ok(texts.elements[0].textPreview.includes('Tom &amp; Jerry'), texts.elements[0].textPreview);

  const limited = svg.inspectSvg(FIXTURE, { limit: 2 });
  assert.equal(limited.elements.length, 2);
  assert.ok(limited.truncated);

  const dirty = svg.inspectSvg('<svg><script>alert(1)</script><rect id="r" onclick="x"/></svg>');
  assert.equal(dirty.unsafe.script, true);
  assert.ok(dirty.unsafe.eventAttrs >= 1);

  const broken = svg.inspectSvg('<svg><g></svg>');
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'svg_parse_error');
});

test('BLOCK-342 P1 多 op 顺序应用：后一 op 看到前一 op 的结果', () => {
  const r = run(FIXTURE, [
    { op: 'set_attr', target: { id: 'bar' }, name: 'width', value: '22' },
    { op: 'set_attr', target: { id: 'bar' }, name: 'height', value: '33' },
    { op: 'set_text', target: { id: 'title' }, text: 'Revenue' },
  ]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.text.includes('width="22"'));
  assert.ok(r.text.includes('height="33"'));
  assert.ok(r.text.includes('>Revenue</text>'));
  assert.equal(r.applied.length, 3);
  assert.ok(r.afterSha !== r.beforeSha);

  // 中途失败不留部分结果（无写入面时调用方无法据此误判）
  const partial = run(FIXTURE, [
    { op: 'set_attr', target: { id: 'bar' }, name: 'width', value: '22' },
    { op: 'set_attr', target: { id: 'ghost' }, name: 'x', value: '1' },
  ]);
  assert.equal(partial.ok, false);
  assert.equal(partial.code, 'svg_target_not_found');
  assert.equal(partial.text, undefined);
});
