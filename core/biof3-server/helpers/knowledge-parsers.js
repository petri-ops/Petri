/**
 * helpers/knowledge-parsers.js — BLOCK-69 P1 文本族解析器注册表
 *
 * D2/D5：按扩展名路由的解析器注册表；P1 只收文本族（0 新依赖——全部 utf-8 文本直读）。
 * PDF / Office / 图像 / 音视频 / 数据库直读属 P3/P4，未注册的扩展名 fail-closed 拒绝
 * （文档状态 failed + error，不静默当文本读）。
 *
 * 「设定特定解析工具」= 本注册表按扩展名 → 解析器映射；P3+ 在此扩展。
 */

const IMAGE_EXTENSIONS = new Set(); // P3：图像经 dashscope-vision 描述化索引
const AUDIO_EXTENSIONS = new Set(); // P4：DashScope ASR

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.rst', '.log',
  '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.xml', '.html', '.htm',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.r', '.rmd', '.ipynb',
  '.sh', '.bash', '.zsh', '.bat', '.ps1', '.sql', '.css', '.java', '.c', '.h', '.cpp', '.hpp',
  '.go', '.rs', '.rb', '.php', '.lua', '.pl', '.m', '.swift', '.kt', '.scala',
]);

// P3/P4 明确登记但未实现：拒绝时给出诚实指引
const PLANNED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff',
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.avi', '.mkv',
  '.sqlite', '.db',
]);

function extOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot).toLowerCase() : '';
}

/**
 * 解析器注册表：扩展名 → { kind, parse }。
 * parse(buffer, { name }) → { text, kind, note? }；throw 即 fail-closed。
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
];

/**
 * 按文件名路由解析器。未注册 → throw（fail-closed，绝不静默当文本读）。
 * @returns {{ text: string, kind: string, note?: string }}
 */
function parseDocument(buffer, name) {
  const ext = extOf(name);
  if (PLANNED_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_planned_not_implemented:${ext}（该格式解析属 P3/P4，本期未实现）`);
  }
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_unsupported:${ext || '无扩展名'}（P1 文本族之外）`);
  }
  for (const parser of PARSERS) {
    if (parser.kinds.includes(ext)) {
      const out = parser.parse(buffer, { name });
      return { text: String(out.text || ''), kind: parser.kind, note: out.note };
    }
  }
  throw new Error(`knowledge_parser_missing:${ext}`);
}

function isSupportedExtension(name) {
  const ext = extOf(name);
  return TEXT_EXTENSIONS.has(ext) && !PLANNED_EXTENSIONS.has(ext);
}

/** createDocument 入口检查：计划内未实现（P3/P4）与完全不支持分别给出诚实错误。 */
function checkSupported(name) {
  const ext = extOf(name);
  if (PLANNED_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_planned_not_implemented:${ext}（该格式解析属 P3/P4，本期未实现）`);
  }
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`knowledge_parser_unsupported:${ext || '无扩展名'}（P1 文本族之外）`);
  }
}

module.exports = {
  TEXT_EXTENSIONS,
  PLANNED_EXTENSIONS,
  parseDocument,
  isSupportedExtension,
  checkSupported,
  extOf,
};
