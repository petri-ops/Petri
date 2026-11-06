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
 * - stripLeakedToolMarkup(text)：一次性清洗——只有「标记 + 内部工具调用格式」
 *   才算泄漏块并从标记处截断；用户正文里作为字面量出现的 DSML 标记（例如
 *   讲解 tokenizer 的文档）必须原样保留，不得整段丢弃。
 * - createDsmlStreamGuard()：流式增量清洗器——标记可能跨 chunk 分裂，扣留
 *   尾部可能是标记前缀的字符待下一个 chunk 判定；一旦确认命中泄漏，后续
 *   所有 delta 全部吞掉（poisoned）。flush() 在流结束时放行扣留的尾巴，
 *   因为此时不可能再有跨 chunk 的标记前缀，丢尾等于丢用户可见的字。
 *
 * 已知边界（诚实登记）：流式通道无法可靠区分「用户正文里的字面量标记」与
 * 「上游泄漏块」，仍按安全优先清洗；需要 provider 层协议级区分才能根治。
 */

// 标记形态：开/闭边界字符（< 或 ｜）+ 1~2 个竖线（| 或 ｜）+ 可选 / + DSML
// + 1~2 个竖线 + 尾边界（> 或 ｜）。覆盖 <|DSML|>、<|/DSML|>、｜｜DSML｜｜、
// <｜DSML｜> 等半角/全角混合变体。
const DSML_MARK_RE = /(?:<|[｜])[|｜]{1,2}\/?DSML[|｜]{1,2}(?:>|[｜])/;
// 标记可能由这些字符组成（用于识别「部分前缀」）
const DSML_MARK_CHARS = /[<|｜>/DSML]/;
// 最长形态 ｜｜/DSML｜｜ = 10 字符；扣留上限取 11，保证「部分前缀」永不构成完整标记
const HOLD_BACK_MAX = 11;

// 真正的泄漏块：标记之后紧跟 invoke / parameter / tool_calls 等内部调用格式，
// 或紧跟另一个 DSML 标记（连续标记串）。孤立的标记只是用户正文里的字面量。
const DSML_TOOL_CALL_HINT = /^\s*(?:invoke|parameter|tool_calls|function|commentary|assistant\s+to=|(?:<|[｜])[|｜]{0,2}\/?DSML)/i;

function leakMarkIndex(text) {
  const s = String(text == null ? '' : text);
  const match = DSML_MARK_RE.exec(s);
  if (!match) return -1;
  const after = s.slice(match.index + match[0].length);
  return DSML_TOOL_CALL_HINT.test(after) ? match.index : -1;
}

function stripLeakedToolMarkup(text) {
  const s = String(text == null ? '' : text);
  const idx = leakMarkIndex(s);
  return idx === -1 ? s : s.slice(0, idx);
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
      // 流已结束：扣留的尾巴不可能是「跨 chunk 的标记前缀」，原样放行，不丢用户的字。
      return rest;
    },
  };
}

module.exports = { stripLeakedToolMarkup, createDsmlStreamGuard };
