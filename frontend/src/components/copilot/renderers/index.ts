// ============================================================
// Renderers — batch registration entry point.
//
// ResultCardRenderer itself only pre-registers `text` (the safe
// fallback) at module load; everything else (table / chart /
// image) is registered through registerDefaultRenderers() so a
// consumer can opt in by importing this module once. Today this
// module is imported only by tests — SimpleChat extraRenderers
// injection is intentionally deferred to a later phase so the
// renderer registry stays a pure contract layer.
// ============================================================

import { registerRenderer } from '../ResultCardRenderer';
import { TableRenderer } from './TableRenderer';
import { TextRenderer } from './TextRenderer';

export function registerDefaultRenderers(): void {
  // `text` is already pre-registered inside ResultCardRenderer so
  // the card always has a fallback. Re-registering here keeps the
  // registration site uniform for future audit (listRegisteredRendererTypes).
  registerRenderer('text', TextRenderer);
  registerRenderer('table', TableRenderer);
}

export { TableRenderer, TextRenderer };
