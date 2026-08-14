// ============================================================
// TextRenderer — default fallback renderer for ResultNode.
// Wraps node.payload in a <pre> so plain text / markdown-ish
// responses keep their original formatting. Future renderers
// (table/chart/image) will be registered in ./index.ts when
// P1.2 / P1.3 land.
// ============================================================

import type { ResultNode } from '../types';

export function TextRenderer({ node }: { node: ResultNode }) {
  const raw = node.payload;
  const text =
    typeof raw === 'string'
      ? raw
      : raw === null || raw === undefined
      ? ''
      : (() => {
          try {
            return JSON.stringify(raw, null, 2);
          } catch {
            return String(raw);
          }
        })();

  return (
    <pre
      data-testid="result-renderer-text"
      data-result-id={node.id}
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'inherit',
        fontSize: 'inherit',
      }}
    >
      {text}
    </pre>
  );
}
