// BLOCK-346 方向1 — xlsx 钉住预览解析器（ZIP + sheet1 XML，只读 sheet1）。
import { describe, expect, it } from 'vitest';
import { readXlsxPreview } from './xlsxPreview';

/** 构造 store 模式（不压缩）的最小 ZIP，仅测试用。 */
function buildStoreZip(files: Array<{ name: string; text: string }>): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = enc.encode(f.text);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(8, 0, true); // method = store
    dv.setUint32(18, data.length, true); // compressed size
    dv.setUint32(22, data.length, true); // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    chunks.push(local);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true); // method store
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length;
  }

  const centralStart = offset;
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out.buffer;
}

const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"><v>42</v></c><c r="B2"><v>3.14</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>内联文本</t></is></c><c r="C3"><v>7</v></c></row>
</sheetData></worksheet>`;

const SHARED = `<?xml version="1.0"?><sst><si><t>样本</t></si><si><t>表达量</t></si></sst>`;

describe('readXlsxPreview（BLOCK-346 方向1）', () => {
  it('解析 sheet1：共享字符串 / 数值 / inlineStr / 跳列补空', async () => {
    const buf = buildStoreZip([
      { name: 'xl/worksheets/sheet1.xml', text: SHEET },
      { name: 'xl/sharedStrings.xml', text: SHARED },
    ]);
    const parsed = await readXlsxPreview(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.rows[0]).toEqual(['样本', '表达量']);
    expect(parsed!.rows[1]).toEqual(['42', '3.14']);
    // C3 有值、B3 缺 → B 位置补空串
    expect(parsed!.rows[2]).toEqual(['内联文本', '', '7']);
    expect(parsed!.truncated).toBe(false);
  });

  it('行列超限时截断并标记 truncated', async () => {
    const buf = buildStoreZip([
      { name: 'xl/worksheets/sheet1.xml', text: SHEET },
      { name: 'xl/sharedStrings.xml', text: SHARED },
    ]);
    const parsed = await readXlsxPreview(buf, { maxRows: 2, maxCols: 2 });
    expect(parsed!.rows.length).toBe(2);
    expect(parsed!.truncated).toBe(true);
  });

  it('非 ZIP / 缺 sheet1：返回 null（调用方保留「打开原文件」出口）', async () => {
    expect(await readXlsxPreview(new TextEncoder().encode('not a zip').buffer)).toBeNull();
    const noSheet = buildStoreZip([{ name: 'word/document.xml', text: '<x/>' }]);
    expect(await readXlsxPreview(noSheet)).toBeNull();
  });
});
