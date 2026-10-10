/**
 * helpers/knowledge-parsers.js — BLOCK-69 P1 文本族解析器注册表
 *
 * D2/D5：按扩展名路由的解析器注册表；P1 只收文本族（0 新依赖——全部 utf-8 文本直读）。
 * BLOCK-94 F2：PDF 经 pdfjs-dist legacy build 提取文本（依赖复用 UI-400 已裁决的 pdfjs-dist 4.10.38，
 * 见 BLOCK-94 plan §7.2 D2）；Office / 图像 / 音视频 / 数据库直读属 P4 线，未注册的扩展名 fail-closed 拒绝
 * （文档状态 failed + error，不静默当文本读）。
 *
 * 「设定特定解析工具」= 本注册表按扩展名 → 解析器映射；后续格式在此扩展。
 */

const path = require('path');

new Set(); // P4：图像经 dashscope-vision 描述化索引
new Set(); // P4：DashScope ASR

// BLOCK-94 F2：扫描件（无文本层）PDF 无 OCR 属 P4 线——提取为空按 knowledge_chunk_empty 诚实 failed
const PDF_EXTENSIONS = new Set(['.pdf']);

// BLOCK-94 F2：PDF 页数护栏（>500 页截断并在 note 诚实标注）
const PDF_MAX_PAGES = 500;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.rst', '.log',
  '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.xml', '.html', '.htm',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.r', '.rmd', '.ipynb',
  '.sh', '.bash', '.zsh', '.bat', '.ps1', '.sql', '.css', '.java', '.c', '.h', '.cpp', '.hpp',
  '.go', '.rs', '.rb', '.php', '.lua', '.pl', '.m', '.swift', '.kt', '.scala',
]);

// P4 明确登记但未实现：拒绝时给出诚实指引
const PLANNED_EXTENSIONS = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff',
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.avi', '.mkv',
  '.sqlite', '.db',
]);

/**
 * BLOCK-94 F2：PDF → 文本（pdfjs-dist legacy build，Node 侧动态 import）。
 * cmaps/standard_fonts 从包内目录提供（CJK 与非嵌入字体必需）。
 * 加密 PDF / 损坏 PDF：pdfjs 抛错 → 上层 fail-closed 诚实 failed。
 */
async function parsePdfBuffer(buffer) {
  const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: `file://${pdfjsRoot}/standard_fonts/`,
    cMapUrl: `file://${pdfjsRoot}/cmaps/`,
    cMapPacked: true,
  }).promise;
  const pageTexts = [];
  const pageCount = Math.min(doc.numPages, PDF_MAX_PAGES);
  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
      else if (item.str && !/\s$/.test(item.str)) text += ' ';
    }
    pageTexts.push(text.trim());
    page.cleanup();
  }
  const truncated = doc.numPages > PDF_MAX_PAGES;
  await doc.destroy();
  return {
    text: pageTexts.filter(Boolean).join('\n\n'),
    note: truncated ? `pdf:truncated_at_${PDF_MAX_PAGES}_pages` : undefined,
  };
}

function extOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot).toLowerCase() : '';
}

/**
 * 解析器注册表：扩展名 → { kind, parse }。
 * parse(buffer, { name }) → { text, kind, note? }；throw 即 fail-closed。
 * BLOCK-94 F2 起 parseDocument 为 async（PDF 解析器异步；文本解析器同步返回值兼容 await）。
 */
const PARSERS = [
  {
    kinds: ['.txt', '.log'],
    kind: 'text',
    parse: (buffer) => ({ text: buffer.toString('utf8') }),
  },
  {
    kinds: ['.md', '.markdown', '.mdx', '.rst'],
    kind: 'markdown',
    parse: (buffer) => ({ text: buffer.toString('utf8') }),
  },
  {
    kinds: ['.csv', '.tsv'],
    kind: 'tabular',
    parse: (buffer, { name }) => {
      const raw = buffer.toString('utf8');
      // 表格直读原文（表头+行）可被 FTS/向量双通道命中；不做结构化改写
      const lines = raw.split(/\r?\n/);
      return {
        text: raw,
        note: `tabular:${name || 'table'} (${lines.length} lines)`,
      };
    },
  },
  {
    kinds: ['.json', '.jsonl'],
    kind: 'json',
    parse: (buffer) => ({ text: buffer.toString('utf8') }),
  },
  {
    kinds: ['.yaml', '.yml', '.toml', '.ini', '.xml', '.html', '.htm', '.css', '.sql'],
    kind: 'structured-text',
    parse: (buffer) => ({ text: buffer.toString('utf8') }),
  },
  {
    kinds: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.r', '.rmd', '.ipynb',
      '.sh', '.bash', '.zsh', '.bat', '.ps1', '.java', '.c', '.h', '.cpp', '.hpp',
      '.go', '.rs', '.rb', '.php', '.lua', '.pl', '.m', '.swift', '.kt', '.scala'],
    kind: 'code',
    parse: (buffer, { name }) => ({ text: buffer.toString('utf8'), note: `code:${name || ''}` }),
  },
  {
    kinds: [...PDF_EXTENSIONS],
    kind: 'pdf',
    parse: (buffer) => parsePdfBuffer(buffer),
  },
];

/**
 * 按文件名路由解析器。未注册 → throw（fail-closed，绝不静默当文本读）。
 * @returns {Promise<{ text: string, kind: string, note?: string }>}
 */
async function parseDocument(buffer, name) {
  const ext = extOf(name);
  if (PLANNED_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_planned_not_implemented:${ext}（该格式解析属 P4 线，本期未实现）`);
  }
  if (!TEXT_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_unsupported:${ext || '无扩展名'}（P1 文本族 + PDF 之外）`);
  }
  for (const parser of PARSERS) {
    if (parser.kinds.includes(ext)) {
      const out = await parser.parse(buffer, { name });
      return { text: String(out.text || ''), kind: parser.kind, note: out.note };
    }
  }
  throw new Error(`knowledge_parser_missing:${ext}`);
}

function isSupportedExtension(name) {
  const ext = extOf(name);
  return (TEXT_EXTENSIONS.has(ext) || PDF_EXTENSIONS.has(ext)) && !PLANNED_EXTENSIONS.has(ext);
}

/** createDocument 入口检查：计划内未实现（P4 线）与完全不支持分别给出诚实错误。 */
function checkSupported(name) {
  const ext = extOf(name);
  if (PLANNED_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_planned_not_implemented:${ext}（该格式解析属 P4 线，本期未实现）`);
  }
  if (!TEXT_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_unsupported:${ext || '无扩展名'}（P1 文本族 + PDF 之外）`);
  }
}

module.exports = {
  TEXT_EXTENSIONS,
  PDF_EXTENSIONS,
  PDF_MAX_PAGES,
  PLANNED_EXTENSIONS,
  parseDocument,
  isSupportedExtension,
  checkSupported,
  extOf,
};
