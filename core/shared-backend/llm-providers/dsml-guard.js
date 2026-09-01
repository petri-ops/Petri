/**
 * llm-providers/dsml-guard.js — 模型内部工具调用标记泄漏清洗。
 *
 * 背景（UI-265 实机观察 + 复验）：DeepSeek 偶发把内部 DSML 工具调用标记
 * 当正文 content 输出，而不是走 tool_calls 通道，导致标记原文泄漏到聊天区
 * 与持久化历史。实测出现过两种变体：
 *   - 半角：`<|DSML|>` / `<|/DSML|>`
 *   - 全角：`｜｜DSML｜｜`（U+FF5C FULLWIDTH VERTICAL LINE，tokenizer 变体）
 * 这类标记永远不是合法的用户可见内容，因此在 provider 层单点清洗：
 *
 * - stripLeakedToolMarkup(text)：一次性清洗——从首个 DSML 标记起整段截断
 *   （泄漏块之后不会恢复合法正文，整块都是模型内部格式噪音）。
 * - createDsmlStreamGuard()：流式增量清洗器——标记可能跨 chunk 分裂，扣留
 *   尾部可能是标记前缀的字符待下一个 chunk 判定；一旦确认命中泄漏，后续
 *   所有 delta 全部吞掉（poisoned）。flush() 在流结束时只放安全正文。
 */

// 标记形态：开/闭边界字符（< 或 ｜）+ 1~2 个竖线（| 或 ｜）+ 可选 / + DSML
// + 1~2 个竖线 + 尾边界（> 或 ｜）。覆盖 <|DSML|>、<|/DSML|>、｜｜DSML｜｜、
// <｜DSML｜> 等半角/全角混合变体。
const DSML_MARK_RE = /(?:<|[｜])[|｜]{1,2}\/?DSML[|｜]{1,2}(?:>|[｜])/;
// 标记可能由这些字符组成（用于识别「部分前缀」）
const DSML_MARK_CHARS = /[<|｜>/DSML]/;
// 最长形态 ｜｜/DSML｜｜ = 10 字符；扣留上限取 11，保证「部分前缀」永不构成完整标记
const HOLD_BACK_MAX = 11;

function stripLeakedToolMarkup(text) {
  const s = String(text == null ? '' : text);
  const match = s.search(DSML_MARK_RE);
  return match === -1 ? s : s.slice(0, match);
}

// 尾部若为某个标记的前缀（如 "<"、"<|"、"｜"、"｜｜DS"、"｜｜/DSML｜"），返回该后缀长度。
// 只有以 < 或 ｜ 开头的候选才可能是标记前缀，避免误扣 "DSL"、"SM" 等普通字母组合。
function trailingPartialMarkLength(s) {
  let keep = 0;
  const start = Math.max(0, s.length - HOLD_BACK_MAX);
  for (let i = s.length - 1; i >= start; i -= 1) {
    if (!DSML_MARK_CHARS.test(s[i])) break;
    keep = s.length - i;
  }
  if (!keep) return 0;
  const tail = s.slice(s.length - keep);
  return /^[<｜]/.test(tail) ? keep : 0;
}

function createDsmlStreamGuard() {
  let pending = '';
  let poisoned = false;
  return {
    push(delta) {
      if (poisoned) return '';
      pending += String(delta == null ? '' : delta);
      const hit = pending.search(DSML_MARK_RE);
      if (hit !== -1) {
        const head = pending.slice(0, hit);
        pending = '';
        poisoned = true;
        return head;
      }
      const keep = trailingPartialMarkLength(pending);
      const head = keep ? pending.slice(0, pending.length - keep) : pending;
      pending = keep ? pending.slice(pending.length - keep) : '';
      return head;
    },
    flush() {
      if (poisoned) return '';
      const rest = pending;
      pending = '';
      const hit = rest.search(DSML_MARK_RE);
      if (hit !== -1) {
        poisoned = true;
        return rest.slice(0, hit);
      }
      const keep = trailingPartialMarkLength(rest);
      return keep ? rest.slice(0, rest.length - keep) : rest;
    },
  };
}

module.exports = { stripLeakedToolMarkup, createDsmlStreamGuard };
