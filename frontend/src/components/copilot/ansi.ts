// ============================================================
// ansi — UI-315 终端块输出 ANSI 解析（零依赖，SGR 子集）。
//
// 真实命令输出（git diff --color、ls --color、构建工具）常带 ANSI
// 转义序列：裸显示会是一堆乱码文本。这里把 SGR 颜色/字重/下划线
// 解析为带 class 的文本片段（CSS 上色），其余转义序列（光标移动、
// OSC 标题等）直接剥除。
// ============================================================

export interface AnsiSpan {
  text: string;
  /** 组合的样式 class（term-bold / term-ul / term-dim / term-c0..term-c15），空串表示无样式 */
  cls: string;
}

/** 16 色 ANSI → 终端块色板（与 .sc-tool-term 的暗色底协调）。 */
const FG_CLASSES = [
  'term-c0', 'term-c1', 'term-c2', 'term-c3',
  'term-c4', 'term-c5', 'term-c6', 'term-c7',
  'term-c8', 'term-c9', 'term-c10', 'term-c11',
  'term-c12', 'term-c13', 'term-c14', 'term-c15',
];

// CSI 终止字节范围；SGR 是以 m 结尾的序列。
const CSI_RE = /\x1b\[([0-9;:?<=>\s]*[ -/]*[@-~])/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const SINGLE_ESC_RE = /\x1b[@-Z\\-_]/g;

interface TermStyle {
  fg: number | null; // 0-15（已折算 30-37/90-97），null = 默认
  bold: boolean;
  dim: boolean;
  underline: boolean;
}

function styleToClass(style: TermStyle): string {
  const parts: string[] = [];
  if (style.bold) parts.push('term-bold');
  if (style.dim) parts.push('term-dim');
  if (style.underline) parts.push('term-ul');
  if (style.fg !== null) parts.push(FG_CLASSES[style.fg]);
  return parts.join(' ');
}

/** 应用一段 SGR 参数到当前样式（就地修改）。 */
function applySgr(style: TermStyle, paramsText: string): void {
  // 38;5;n / 38;2;r;g;b / 48 系列等扩展色本终端块不支持，跳过整个参数组。
  const raw = paramsText.split(/[:;]/).map((v) => Number.parseInt(v, 10));
  const params = raw.map((v) => (Number.isFinite(v) ? v : 0));
  let i = 0;
  while (i < params.length) {
    const code = params[i];
    if (code === 0) {
      style.fg = null; style.bold = false; style.dim = false; style.underline = false;
    } else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 4) style.underline = true;
    else if (code === 22) { style.bold = false; style.dim = false; }
    else if (code === 23) style.underline = false; // 非 ITALIC（本终端不用斜体）
    else if (code === 24) style.underline = false;
    else if (code === 39) style.fg = null;
    else if (code >= 30 && code <= 37) style.fg = code - 30;
    else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
    else if (code === 38 || code === 48) {
      // 扩展色：38;5;n / 38;2;r;g;b —— 前景跳过参数组（背景一律忽略）
      if (code === 38) {
        if (params[i + 1] === 5) i += 3;
        else if (params[i + 1] === 2) i += 5;
        else i += 1;
      }
    }
    i += 1;
  }
}

/**
 * 把带 ANSI 转义的终端文本解析为带样式 class 的片段。
 * 非颜色类转义（光标移动/OSC）直接剥除；纯文本输入返回单片段。
 */
export function parseAnsiToSpans(text: string): AnsiSpan[] {
  if (!text) return [];
  // 先剥 OSC 与非 SGR 的 CSI/单字符转义
  const cleaned = text
    .replace(OSC_RE, '')
    .replace(CSI_RE, (match, body: string) => (body.endsWith('m') ? `\x1b[${body}` : ''))
    .replace(SINGLE_ESC_RE, '');
  if (!cleaned.includes('\x1b')) return [{ text: cleaned, cls: '' }];

  const spans: AnsiSpan[] = [];
  const style: TermStyle = { fg: null, bold: false, dim: false, underline: false };
  let buffer = '';
  const flush = () => {
    if (buffer) {
      const cls = styleToClass(style);
      spans.push({ text: buffer, cls });
      buffer = '';
    }
  };
  const re = /\x1b\[([0-9;:?<=>\s]*[ -/]*[@-~])/g;
  let lastIndex = 0;
  for (let m = re.exec(cleaned); m !== null; m = re.exec(cleaned)) {
    // 转义序列之前的文本按当前（旧）样式成段；随后新样式才对后续文本生效
    buffer += cleaned.slice(lastIndex, m.index);
    lastIndex = m.index + m[0].length;
    flush();
    if (m[1].endsWith('m')) applySgr(style, m[1].slice(0, -1));
  }
  buffer += cleaned.slice(lastIndex);
  flush();
  return spans.filter((span) => span.text.length > 0);
}
