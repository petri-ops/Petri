/**
 * Gewu Desktop — Office / iWork / OpenDocument inline preview
 *
 * Office Open XML (`.docx`, `.xlsx`, `.pptx`) and OpenDocument (`.odt`, `.ods`,
 * `.odp`) are zip containers. iWork (`.pages`, `.numbers`, `.keynote`) uses a
 * non-standard structure but is also a zip. Bioinformatics binary data
 * containers (`.RData`, `.rds`, `.h5ad`, `.loom`) are NOT zips; we surface them
 * through a metadata card only.
 *
 * The renderer downloads the workspace file URL via the existing controlled
 * `desktopBridge.files.openWorkspaceFile` plumbing (no native deps) and feeds
 * the resulting ArrayBuffer into `unzip` from `unzipit`. We extract a small
 * structural summary so users see real content inside the right Files panel:
 *
 *  - docx: paragraphs of `word/document.xml` + first embedded image
 *  - xlsx: first sheet rows using shared strings + first sheet image
 *  - pptx: joined text of `slide*.xml`
 *  - odt / ods / odp: paragraphs / rows via `content.xml`
 *  - iWork: directory listing of contained resources (Apple's format is
 *           indexable but not spec-stable enough to render here)
 *  - everything else: metadata card with size, mtime, suggested openers
 */

import { unzip, type ZipEntry } from 'unzipit';

export type OfficePreviewKind =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'pages'
  | 'numbers'
  | 'keynote'
  | 'rtf'
  | 'epub'
  | 'rdata'
  | 'rds'
  | 'h5ad'
  | 'loom'
  | 'h5'
  | 'hdf5'
  | 'mtx'
  | 'binary';

export interface OfficePreviewSheetRow {
  cells: string[];
}

export interface OfficePreviewSheet {
  name: string;
  rows: OfficePreviewSheetRow[];
}

export interface OfficePreviewAsset {
  name: string;
  mimeType: string;
  url: string;
  byteLength: number;
}

export interface OfficePreviewModel {
  kind: OfficePreviewKind;
  title: string;
  /** Plain-text body when the format has a textual source. */
  text?: string;
  /** First sheet when the format is xlsx/ods/numbers. */
  sheet?: OfficePreviewSheet;
  /** Inline images that the parser surfaced. */
  assets?: OfficePreviewAsset[];
  /** Container entry names when we cannot decode content. */
  contents?: string[];
  /** Total size in bytes (from the source response, when available). */
  byteLength?: number;
  /** When the parser decided the file is not previewable after all. */
  fallback?: { reason: string };
}

interface FetchedResource {
  buffer: ArrayBuffer;
  byteLength: number;
}

async function fetchAsArrayBuffer(url: string, token: string): Promise<FetchedResource> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`preview fetch failed: HTTP ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return { buffer, byteLength: buffer.byteLength };
}

function detectKind(name: string): OfficePreviewKind {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'docx':
    case 'docm':
    case 'dotx':
      return 'docx';
    case 'xlsx':
    case 'xlsm':
    case 'xltx':
    case 'xlsb':
      return 'xlsx';
    case 'pptx':
    case 'pptm':
    case 'ppsx':
    case 'potx':
      return 'pptx';
    case 'odt':
      return 'odt';
    case 'ods':
      return 'ods';
    case 'odp':
      return 'odp';
    case 'pages':
      return 'pages';
    case 'numbers':
      return 'numbers';
    case 'keynote':
      return 'keynote';
    case 'rtf':
      return 'rtf';
    case 'epub':
      return 'epub';
    case 'rdata':
      return 'rdata';
    case 'rds':
      return 'rds';
    case 'h5ad':
      return 'h5ad';
    case 'loom':
      return 'loom';
    case 'h5':
    case 'hdf5':
      return 'h5';
    case 'mtx':
      return 'mtx';
    default:
      return 'binary';
  }
}

/** Strip XML tags, decode the most common XML entities. */
export function stripXml(xml: string): string {
  return xml
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{2,}/g, '\n\n')
    .replace(/^[\n\s]+|[\n\s]+$/g, '');
}

/**
 * Extract paragraph text from a `word/document.xml`-shaped doc. We grab the
 * inner text of `<w:t>` elements in document order so multi-run paragraphs are
 * stitched back together.
 */
export function extractDocxText(xml: string): string {
  const blocks: string[] = [];
  const paragraphRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  const textRegex = /<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g;
  for (const match of xml.match(paragraphRegex) || []) {
    const parts: string[] = [];
    for (const tMatch of match.matchAll(textRegex)) {
      parts.push(decodeEntities(tMatch[1] || ''));
    }
    const text = parts.join('').trim();
    if (text) blocks.push(text);
  }
  return blocks.join('\n\n');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function buildSharedStrings(xml: string): string[] {
  const result: string[] = [];
  const regex = /<si[\s>][\s\S]*?<\/si>/g;
  for (const match of xml.match(regex) || []) {
    const parts: string[] = [];
    const tRegex = /<t(?:\s+[^>]*)?>([^<]*)<\/t>/g;
    for (const tMatch of match.matchAll(tRegex)) parts.push(decodeEntities(tMatch[1] || ''));
    result.push(parts.join(''));
  }
  return result;
}

async function buildXlsxPreview(entries: Record<string, ZipEntry>): Promise<OfficePreviewModel> {
  const sharedStringsEntry = entries['xl/sharedStrings.xml'];
  const sharedStrings = sharedStringsEntry
    ? buildSharedStrings(await sharedStringsEntry.text())
    : [];
  const sheetEntry = entries['xl/worksheets/sheet1.xml'];
  if (!sheetEntry) return { kind: 'xlsx', title: '', fallback: { reason: 'sheet 缺失' } };
  const xml = await sheetEntry.text();
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\s+(?:[^>]*?\s)?(?:t="([^"]*)")?[^>]*?(?:\s*[^>]*)?>(?:<v>([^<]*)<\/v>)?(?:<\/c>)?/g;
  const rows: OfficePreviewSheetRow[] = [];
  for (const rowMatch of xml.match(rowRegex) || []) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch.matchAll(cellRegex)) {
      const cellType = cellMatch[1];
      const value = cellMatch[2];
      if (!value) {
        cells.push('');
        continue;
      }
      if (cellType === 's') {
        const idx = Number.parseInt(value, 10);
        cells.push(sharedStrings[idx] || '');
      } else {
        cells.push(decodeEntities(value));
      }
    }
    if (cells.some((c) => c.trim().length > 0)) {
      rows.push({ cells: cells.map((c) => c.trim()) });
    }
  }
  const sheetName = await resolveXlsxSheetName(entries).catch(() => 'Sheet1');
  return {
    kind: 'xlsx',
    title: sheetName,
    sheet: { name: sheetName, rows: rows.slice(0, 80) },
  };
}

async function resolveXlsxSheetName(entries: Record<string, ZipEntry>): Promise<string> {
  const workbook = entries['xl/workbook.xml'];
  if (!workbook) return 'Sheet1';
  const xml = await workbook.text();
  const match = xml.match(/<sheet\s+[^>]*?name="([^"]+)"[^>]*?sheetId="1"[^>]*?r:id="rId1"/)
    || xml.match(/<sheet\s+[^>]*?name="([^"]+)"[^>]*?r:id="rId1"/);
  return match?.[1] || 'Sheet1';
}

function buildPptxText(slideXml: string): string {
  const blocks: string[] = [];
  const textRegex = /<a:t(?:\s+[^>]*)?>([^<]*)<\/a:t>/g;
  for (const match of slideXml.match(textRegex) || []) {
    const cleaned = decodeEntities(match).trim();
    if (cleaned) blocks.push(cleaned);
  }
  return blocks.join('\n\n');
}

function buildOdtText(xml: string): string {
  const blocks: string[] = [];
  const paragraphRegex = /<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g;
  for (const match of xml.match(paragraphRegex) || []) {
    const text = stripXml(match).trim();
    if (text) blocks.push(text);
  }
  return blocks.join('\n\n');
}

function buildOdsSheet(xml: string): OfficePreviewSheet {
  const rows: OfficePreviewSheetRow[] = [];
  const rowRegex = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g;
  for (const rowMatch of xml.match(rowRegex) || []) {
    const cells: string[] = [];
    const cellRegex = /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g;
    for (const cellMatch of rowMatch.matchAll(cellRegex)) {
      const text = stripXml(cellMatch[1] || '').trim();
      cells.push(text);
    }
    if (cells.some((c) => c.length > 0)) rows.push({ cells });
  }
  return { name: 'Sheet1', rows: rows.slice(0, 80) };
}

function buildOdpText(xml: string): string {
  const blocks: string[] = [];
  const regex = /<draw:text-box\b[^>]*>([\s\S]*?)<\/draw:text-box>/g;
  for (const match of xml.match(regex) || []) {
    const text = stripXml(match).trim();
    if (text) blocks.push(text);
  }
  return blocks.join('\n\n');
}

async function loadAssets(
  entries: Record<string, ZipEntry>,
  patterns: RegExp[]
): Promise<OfficePreviewAsset[]> {
  const assets: OfficePreviewAsset[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (!patterns.some((p) => p.test(name))) continue;
    if (assets.length >= 4) break;
    const buffer = await entry.arrayBuffer();
    const mime = guessImageMime(name);
    if (!mime) continue;
    assets.push({
      name,
      mimeType: mime,
      url: imageBlobUrl(buffer, mime),
      byteLength: buffer.byteLength,
    });
  }
  return assets;
}

function guessImageMime(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'emf':
    case 'wmf':
      return 'image/x-emf';
    default:
      return null;
  }
}

const blobRegistry: string[] = [];

function imageBlobUrl(buffer: ArrayBuffer, mime: string): string {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  blobRegistry.push(url);
  return url;
}

export function revokeOfficePreviewBlobs(): void {
  while (blobRegistry.length) {
    const url = blobRegistry.pop();
    if (url) URL.revokeObjectURL(url);
  }
}

export interface OfficePreviewRequest {
  url: string;
  name: string;
  authToken?: string;
  projectId?: string;
  workspacePath?: string;
}

/** Top-level entry — returns a parsed preview model when the format is
 *  recognised, or a metadata fallback model otherwise. */
export async function loadOfficePreview(req: OfficePreviewRequest): Promise<OfficePreviewModel> {
  const kind = detectKind(req.name);
  if (kind === 'binary') {
    return { kind: 'binary', title: req.name, fallback: { reason: '不受支持的格式' } };
  }
  // Non-zip container formats always fall through to metadata.
  if (
    kind === 'rdata' ||
    kind === 'rds' ||
    kind === 'h5ad' ||
    kind === 'loom' ||
    kind === 'h5' ||
    kind === 'hdf5' ||
    kind === 'mtx' ||
    kind === 'rtf' ||
    kind === 'epub'
  ) {
    return {
      kind,
      title: req.name,
      fallback: {
        reason: '该格式使用专有或 HDF5 二进制容器，浏览器无法直接渲染，建议在系统应用或专业工具中打开',
      },
    };
  }
  const resource = await fetchAsArrayBuffer(req.url, req.authToken || '');
  let archive: Awaited<ReturnType<typeof unzip>>;
  try {
    archive = await unzip(resource.buffer);
  } catch {
    return {
      kind,
      title: req.name,
      byteLength: resource.byteLength,
      fallback: { reason: '不是有效的 zip 容器' },
    };
  }
  const entries = archive.entries;
  switch (kind) {
    case 'docx': {
      const doc = entries['word/document.xml'];
      const text = doc ? extractDocxText(await doc.text()) : '';
      const assets = await loadAssets(
        entries,
        [/^word\/media\/(?:image\d+\.(?:png|jpe?g|gif|svg|emf|wmf))$/i],
      ).catch(() => []);
      return { kind, title: req.name, text, byteLength: resource.byteLength, assets };
    }
    case 'xlsx':
      return {
        ...(await buildXlsxPreview(entries)),
        title: req.name,
        byteLength: resource.byteLength,
      };
    case 'pptx': {
      const slideEntries = Object.entries(entries)
        .filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort(([a], [b]) => {
          const ai = Number.parseInt(a.match(/slide(\d+)/)?.[1] || '0', 10);
          const bi = Number.parseInt(b.match(/slide(\d+)/)?.[1] || '0', 10);
          return ai - bi;
        });
      const parts: string[] = [];
      for (const [, entry] of slideEntries.slice(0, 30)) {
        const xml = await entry.text();
        const text = buildPptxText(xml);
        if (text) parts.push(text);
      }
      const assets = await loadAssets(
        entries,
        [/^ppt\/media\/(?:image\d+\.(?:png|jpe?g|gif|svg|emf|wmf))$/i],
      ).catch(() => []);
      return {
        kind,
        title: req.name,
        text: parts.join('\n\n'),
        assets,
        byteLength: resource.byteLength,
      };
    }
    case 'odt': {
      const content = entries['content.xml'];
      const text = content ? buildOdtText(await content.text()) : '';
      const assets = await loadAssets(
        entries,
        [/^media\/.+\.(?:png|jpe?g|gif|svg)$/i],
      ).catch(() => []);
      return { kind, title: req.name, text, assets, byteLength: resource.byteLength };
    }
    case 'ods': {
      const content = entries['content.xml'];
      const sheet = content ? buildOdsSheet(await content.text()) : { name: '', rows: [] };
      return { kind, title: req.name, sheet, byteLength: resource.byteLength };
    }
    case 'odp': {
      const content = entries['content.xml'];
      const text = content ? buildOdpText(await content.text()) : '';
      const assets = await loadAssets(
        entries,
        [/^media\/.+\.(?:png|jpe?g|gif|svg)$/i],
      ).catch(() => []);
      return { kind, title: req.name, text, assets, byteLength: resource.byteLength };
    }
    case 'pages':
    case 'numbers':
    case 'keynote': {
      const listing = Object.keys(entries).sort().slice(0, 60);
      return {
        kind,
        title: req.name,
        contents: listing,
        byteLength: resource.byteLength,
      };
    }
    default:
      return { kind, title: req.name, fallback: { reason: '尚未实现解析' } };
  }
}

/** Human-readable description for the metadata card / log lines. */
export function describeOfficeKind(kind: OfficePreviewKind): string {
  switch (kind) {
    case 'docx':
      return 'Word 文档 (OOXML)';
    case 'xlsx':
      return 'Excel 工作簿 (OOXML)';
    case 'pptx':
      return 'PowerPoint 演示 (OOXML)';
    case 'odt':
      return 'OpenDocument 文本';
    case 'ods':
      return 'OpenDocument 表格';
    case 'odp':
      return 'OpenDocument 演示';
    case 'pages':
      return 'Apple Pages 文稿';
    case 'numbers':
      return 'Apple Numbers 表格';
    case 'keynote':
      return 'Apple Keynote 演示';
    case 'rtf':
      return 'Rich Text Format 文稿';
    case 'epub':
      return 'EPUB 电子书';
    case 'rdata':
      return 'R 工作空间 (.RData)';
    case 'rds':
      return 'R 序列化对象 (.rds)';
    case 'h5ad':
      return 'AnnData (h5ad) 单细胞矩阵';
    case 'loom':
      return 'Loom 单细胞矩阵';
    case 'h5':
    case 'hdf5':
      return 'HDF5 数据集';
    case 'mtx':
      return 'Matrix Market 矩阵';
    default:
      return '二进制文件';
  }
}

/** Suggested app for system-opening. */
export function suggestedOpener(kind: OfficePreviewKind): string {
  switch (kind) {
    case 'docx':
    case 'odt':
    case 'rtf':
      return 'Word / Pages / LibreOffice';
    case 'xlsx':
    case 'ods':
      return 'Excel / Numbers / LibreOffice Calc';
    case 'pptx':
    case 'odp':
      return 'PowerPoint / Keynote / LibreOffice Impress';
    case 'pages':
      return 'Apple Pages';
    case 'numbers':
      return 'Apple Numbers';
    case 'keynote':
      return 'Apple Keynote';
    case 'epub':
      return 'Apple Books / Preview';
    case 'rdata':
    case 'rds':
      return 'R / RStudio';
    case 'h5ad':
    case 'loom':
    case 'h5':
    case 'hdf5':
      return 'h5py / Scanpy / hdfview';
    case 'mtx':
      return 'scipy.io.mmread / MATLAB';
    default:
      return '系统默认应用';
  }
}
