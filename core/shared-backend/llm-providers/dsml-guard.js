/**
 * llm-providers/dsml-guard.js — 模型内部工具调用标记泄漏清洗。
 *
 * 背景（UI-265 实机观察）：DeepSeek 偶发把内部 DSML 工具调用标记
 * （`<|DSML|>invoke name="…" … <|/DSML|>`）当正文 content 输出，而不是走
 * tool_calls 通道，导致标记原文泄漏到聊天区与持久化历史。这类标记永远
 * 不是合法的用户可见内容，因此在 provider 层单点清洗：
 *
 * - stripLeakedToolMarkup(text)：一次性清洗——从首个 DSML 标记起整段截断
 *   （泄漏块之后不会恢复合法正文，整块都是模型内部格式噪音）。
 * - createDsmlStreamGuard()：流式增量清洗器——标记可能跨 chunk 分裂，
 *   扣留尾部可能不完整的 `<`…`<|/DSML|` 前缀待下一个 chunk 判定；一旦
 *   确认命中泄漏，后续所有 delta 全部吞掉（poisoned）。flush() 在流结束
 *   时补发被扣留的非标记尾部。
 */

const DSML_MARK_RE = /<\|\/?DSML\|>/;
// 两个标记：开 <|DSML|>（8 字符）、闭 <|/DSML|>（9 字符）
const DSML_MARKS = ['<|DSML|>', '<|/DSML|>'];
// 扣留长度 = 最长标记 - 1，让「部分前缀」永不构成完整标记
const HOLD_BACK_MAX = 8;

function stripLeakedToolMarkup(text) {
  const s = String(text == null ? '' : text);
  const match = s.search(DSML_MARK_RE);
  return match === -1 ? s : s.slice(0, match);
}

// 尾部若为任一标记的前缀（如 "<"、"<|"、"<|DS"、"<|/DS"），返回该后缀长度
function trailingPartialMarkLength(s) {
  for (let keep = Math.min(HOLD_BACK_MAX, s.length); keep >= 1; keep -= 1) {
    const tail = s.slice(s.length - keep);
    if (DSML_MARKS.some((mark) => mark.startsWith(tail))) return keep;
  }
  return 0;
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
      return rest;
    },
  };
}

module.exports = { stripLeakedToolMarkup, createDsmlStreamGuard };
