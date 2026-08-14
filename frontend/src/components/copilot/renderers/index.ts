// ============================================================
// Renderers — batch registration entry point.
//
// Today only TextRenderer is in the registry; ResultCardRenderer
// falls back to it when no entry matches node.type. Future P1.2
// (table) and P1.3 (chart / image) implementations will call
// registerRenderer() from here so consumers can opt in by
// importing this module once.
// ============================================================

import { registerRenderer } from '../ResultCardRenderer';
import { TextRenderer } from './TextRenderer';

export function registerDefaultRenderers(): void {
  registerRenderer('text', TextRenderer);
}

export { TextRenderer };
