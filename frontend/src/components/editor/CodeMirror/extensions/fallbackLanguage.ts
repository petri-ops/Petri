/**
 * UI-395 后继 — 通用保底语法高亮（零依赖）。
 *
 * 用户裁决「常见格式都要有，保底用通用代码高亮」：未装语言包的扩展名不再纯白，
 * 由一个轻量 StreamLanguage tokenizer 提供基础着色——字符串 / 行注释（// # --）/
 * 块注释（/* *\/）/ 数字 / 常见关键字 / 大写开头类型 / 函数调用名。
 * 已有专属语言包（js/ts/py/json/md/yaml）时不经过此路径。
 */

import { StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

const COMMON_KEYWORDS = new Set([
  // 流程/声明（C 系 + 脚本族通吃）
  'function', 'func', 'fn', 'return', 'if', 'else', 'elif', 'for', 'while', 'do', 'end',
  'var', 'let', 'const', 'class', 'struct', 'interface', 'type', 'enum', 'impl', 'trait',
  'import', 'export', 'from', 'package', 'use', 'require', 'module', 'include', 'using',
  'new', 'this', 'self', 'super', 'async', 'await', 'yield', 'defer', 'go',
  'try', 'catch', 'finally', 'throw', 'raise', 'rescue', 'ensure',
  'switch', 'case', 'match', 'default', 'break', 'continue', 'pass',
  'extends', 'implements', 'public', 'private', 'protected', 'static', 'final', 'abstract',
  'in', 'of', 'is', 'not', 'and', 'or', 'as', 'with', 'typeof', 'instanceof', 'delete', 'void',
  // 字面量
  'true', 'false', 'null', 'nil', 'none', 'undefined', 'True', 'False', 'None',
]);

const fallbackStream = StreamLanguage.define({
  name: 'petri-fallback-common',
  token(stream) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (ch === undefined) {
      stream.next();
      return null;
    }

    // 字符串：' " `
    if (ch === '"' || ch === "'" || ch === '`') {
      stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '\\') {
          stream.next();
          continue;
        }
        if (c === ch) break;
      }
      return 'string';
    }

    // 行注释：// # --
    if (ch === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (ch === '/' && stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (ch === '-' && stream.match('--')) {
      stream.skipToEnd();
      return 'comment';
    }
    // 块注释：/* */
    if (ch === '/' && stream.match('/*', false)) {
      stream.next(); stream.next();
      while (!stream.eol()) {
        if (stream.match('*/')) break;
        stream.next();
      }
      return 'comment';
    }

    // 数字
    if (/[0-9]/.test(ch)) {
      stream.eatWhile(/[0-9a-fA-FxXbBoO._]/);
      return 'number';
    }

    // 标识符
    if (/[\w$]/.test(ch)) {
      stream.eatWhile(/[\w$]/);
      const word = stream.current();
      if (COMMON_KEYWORDS.has(word)) return 'keyword';
      if (stream.peek() === '(') return 'variableName'; // 函数调用名
      if (/^[A-Z]/.test(word)) return 'typeName';
      return null;
    }

    stream.next();
    return null;
  },
});

/** 未识别格式的通用保底高亮 extension。 */
export function createFallbackLanguage(): Extension {
  return fallbackStream;
}
