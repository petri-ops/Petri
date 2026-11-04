/**
 * xlsxPreview — BLOCK-346 方向1：xlsx/xlsm 钉住快照的二维预览。
 *
 * 为什么写在渲染侧而不是后端加端点：
 *   钉住快照本来就是前端 `fetch(snapshot.url)` 取文件（同源、已鉴权），
 *   再加一条预览端点等于重复一次鉴权 + 多一套缓存，收益为零。
 *
 * 实现范围（**只做预览，不做解析器**）：
 *   - ZIP：只解 EOCD → 中央目录 → 目标条目（支持 store=0 与 deflate=8）
 *   - 解压：浏览器原生 `DecompressionStream('deflate-raw')`
 *   - XML：只读 `xl/worksheets/sheet1.xml` 与 `xl/sharedStrings.xml`
 *   - 单元格：`t="s"`（共享字符串）/ `inlineStr` / 数值与公式缓存值
 *
 * **明确不支持**：多 sheet、样式、合并单元格、日期序列号转换、公式重算。
 * 遇到不支持的结构一律**降级返回 null**（调用方保留「打开原文件」出口），
 * 绝不伪造数据 —— 预览宁可没有，不能是错的。
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export interface XlsxPreview {
  rows: string[][];
  /** 是否因超限被截断（行/列）。 */
  truncated: boolean;
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readU16(view: DataView, offset: number): number { return view.getUint16(offset, true); }
function readU32(view: DataView, offset: number): number { return view.getUint32(offset, true); }

/** 解析 ZIP 中央目录（只取需要的三个条目）。 */
function listZipEntries(buffer: ArrayBuffer): ZipEntry[] | null {
  const view = new DataView(buffer);
  const len = buffer.byteLength;
  // EOCD 在末尾，注释最长 65535
  const minPos = Math.max(0, len - 65535 - 22);
  let eocd = -1;
  for (let i = len - 22; i >= minPos; i -= 1) {
    if (readU32(view, i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = readU16(view, eocd + 10);
  let offset = readU32(view, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > len || readU32(view, offset) !== CEN_SIG) return null;
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const nameLen = readU16(view, offset + 28);
    const extraLen = readU16(view, offset + 30);
    const commentLen = readU16(view, offset + 32);
    const localHeaderOffset = readU32(view, offset + 42);
    const nameBytes = new Uint8Array(buffer, offset + 46, nameLen);
    const name = new TextDecoder().decode(nameBytes);
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 取出条目原始字节（未解压）。 */
function readEntryRaw(buffer: ArrayBuffer, entry: ZipEntry): Uint8Array | null {
  const view = new DataView(buffer);
  const off = entry.localHeaderOffset;
  if (off + 30 > buffer.byteLength) return null;
  if (readU32(view, off) !== 0x04034b50) return null;
  const nameLen = readU16(view, off + 26);
  const extraLen = readU16(view, off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const size = entry.compressedSize;
  if (dataStart + size > buffer.byteLength) return null;
  return new Uint8Array(buffer, dataStart, size);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const Decompression = (globalThis as unknown as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (typeof Decompression === 'undefined') return null;
  try {
    const stream = new Decompression('deflate-raw');
    const writer = stream.writable.getWriter();
    // TS 5.7 Uint8Array 泛型化：write 需要 BufferSource，slice() 归一为 ArrayBuffer 支撑
    void writer.write(data.slice());
    void writer.close();
    const ab = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

async function readEntryText(buffer: ArrayBuffer, entry: ZipEntry): Promise<string | null> {
  const raw = readEntryRaw(buffer, entry);
  if (!raw) return null;
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method === 8) {
    const inflated = await inflateRaw(raw);
    return inflated ? new TextDecoder().decode(inflated) : null;
  }
  return null;
}

/** sharedStrings.xml → 文本数组（`<si>` 内所有 `<t>` 拼接）。 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    const ts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
    out.push(ts.join(''));
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** "A1" → 列索引 0；异常返回 -1。 */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref || '');
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[], maxRows: number, maxCols: number): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let truncated = false;
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    if (rows.length >= maxRows) { truncated = true; break; }
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const attrs = cm[1] ?? cm[3] ?? '';
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const idx = ref ? columnIndex(ref) : cells.length;
      if (idx < 0 || idx >= maxCols) { truncated = true; continue; }
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? '';
      let value = '';
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        const si = Number(v);
        value = Number.isInteger(si) ? (shared[si] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1])).join('');
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return { rows, truncated };
}

/**
 * 解析 xlsx 为二维字符串数组（sheet1）。任何不支持/损坏结构返回 null。
 */
export async function readXlsxPreview(
  buffer: ArrayBuffer,
  { maxRows = 200, maxCols = 40 }: { maxRows?: number; maxCols?: number } = {},
): Promise<XlsxPreview | null> {
  const entries = listZipEntries(buffer);
  if (!entries) return null;
  const sheet = entries.find((e) => /^xl\/worksheets\/sheet1\.xml$/i.test(e.name));
  if (!sheet) return null;
  const sharedEntry = entries.find((e) => /^xl\/sharedStrings\.xml$/i.test(e.name));
  const sheetXml = await readEntryText(buffer, sheet);
  if (!sheetXml) return null;
  const sharedXml = sharedEntry ? await readEntryText(buffer, sharedEntry) : null;
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const parsed = parseSheet(sheetXml, shared, maxRows, maxCols);
  if (parsed.rows.length === 0) return null;
  return parsed;
}
