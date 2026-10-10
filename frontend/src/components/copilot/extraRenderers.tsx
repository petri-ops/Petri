// ============================================================
// SimpleChat extraRenderers — opt-in bridge between the
// SimpleChat assistant message stream and the ResultCard /
// ResultCardRenderer pipeline introduced in P1.1 / P1.2 / P1.3.
//
// This module owns the A4 contract surface only:
//   1. A feature flag hook (`useExtraRenderersFlag`) that resolves
//      `window.petriAgentFlags.agentWorkbenchFlags.getExtraRenderers()` first, then
//      the localStorage key for the standalone development SPA, and
//      defaults to **off** when neither source enables it.
//   2. A tolerant `parseAssistantResultNodes` parser that turns
//      a raw `message.meta.resultNodes` payload into a typed
//      `ResultNode[] | null`. Any shape error collapses to
//      `null` so the caller can fall back to the existing
//      markdown renderer without surfacing an error.
//   3. A self-contained `<AssistantResultNodes>` component that
//      renders the parsed list through `ResultCardRenderer`.
//      It accepts no flags of its own; the parent decides when
//      to mount it (i.e. only when the flag is on AND the parser
//      returned a non-empty list).
//
// The module does NOT mutate any existing renderer, does NOT
// change the top-level message type, and does NOT introduce any
// new dependency. SimpleChat imports from here once; the rest of
// the renderer registry (P1.2 table / P1.3 chart + image) keeps
// registering renderers as it already does.
// ============================================================

import { useEffect, useState } from 'react';
import type { ResultNode, ResultNodeType, ResultCardVariant } from './types';
import { ResultCardRenderer } from './ResultCardRenderer';
import { registerDefaultRenderers } from './renderers';

const LS_KEY = 'petri.simplechat.extraRenderers';

const ALLOWED_TYPES: ReadonlyArray<ResultNodeType> = ['text', 'table', 'chart', 'image'];
const ALLOWED_VARIANTS: ReadonlyArray<ResultCardVariant> = [
  'default',
  'success',
  'warning',
  'error',
  'info',
];

/**
 * Read the feature flag synchronously. Lives outside React so the
 * caller can pick a default without forcing a re-render on every
 * keystroke inside the storage event loop.
 *
 * The bridge exposes `getExtraRenderers()` as a synchronous method
 * rather than a property because Electron 30's `contextBridge` freezes
 * getter accessors on the renderer side, which would otherwise pin the
 * value to a one-time snapshot taken at first access. Calling the method
 * on every read returns the live value held in the preload closure.
 */
export function resolveInitialFlag(): boolean {
  if (typeof window === 'undefined') return false;

  const bridgeFlags = window.petriAgentFlags?.agentWorkbenchFlags;
  if (bridgeFlags && typeof bridgeFlags.getExtraRenderers === 'function') {
    return bridgeFlags.getExtraRenderers() === true;
  }

  try {
    return window.localStorage.getItem(LS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function readExtraRenderersFlag(): boolean {
  return resolveInitialFlag();
}

/**
 * React hook that subscribes the active flag value. Re-reads on
 * focus so a developer toggling the key in DevTools gets the new
 * value on the next conversation mount without a hard reload.
 */
export function useExtraRenderersFlag(): boolean {
  const [flag, setFlag] = useState<boolean>(() => readExtraRenderersFlag());
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setFlag(readExtraRenderersFlag());
    const unsubscribe = window.petriAgentFlags?.agentWorkbenchFlags?.onChange?.(refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      unsubscribe?.();
    };
  }, []);
  return flag;
}

function isResultNodeType(value: unknown): value is ResultNodeType {
  return typeof value === 'string' && (ALLOWED_TYPES as ReadonlyArray<string>).includes(value);
}

function isResultCardVariant(value: unknown): value is ResultCardVariant {
  return (
    typeof value === 'string' && (ALLOWED_VARIANTS as ReadonlyArray<string>).includes(value)
  );
}

function isValidResultNode(value: unknown): value is ResultNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== 'string' || node.id.length === 0) return false;
  if (!isResultNodeType(node.type)) return false;
  if (typeof node.title !== 'string' || node.title.length === 0) return false;
  if (typeof node.createdAt !== 'string' || node.createdAt.length === 0) return false;
  // payload is intentionally untyped at this layer (the per-type
  // renderer enforces the structural contract); we only require the
  // field to exist so downstream renderers can distinguish a
  // missing payload from an explicit null.
  if (!('payload' in node)) return false;
  if (node.subtitle !== undefined && typeof node.subtitle !== 'string') return false;
  if (node.meta !== undefined && typeof node.meta !== 'string') return false;
  if (node.variant !== undefined && !isResultCardVariant(node.variant)) return false;
  return true;
}

/**
 * Validate a raw `meta.resultNodes` payload. Returns the typed
 * list only when **every** entry passes the per-node guard and the
 * overall shape is an array; otherwise returns `null` so the caller
 * can fall back to the existing markdown renderer without showing
 * any error to the user.
 */
export function parseAssistantResultNodes(value: unknown): ResultNode[] | null {
  if (!Array.isArray(value)) return null;
  const out: ResultNode[] = [];
  for (const entry of value) {
    if (!isValidResultNode(entry)) return null;
    out.push(entry);
  }
  return out;
}

/**
 * Render a parsed ResultNode list. The component is a pure leaf:
 * it assumes the flag + parser already cleared the way, and never
 * touches the rest of SimpleChat's state. Console debug line lets
 * a developer confirm in DevTools that the injection fired without
 * dragging in any telemetry SDK.
 */
export function AssistantResultNodes({ nodes }: { nodes: ResultNode[] }): React.ReactElement {
  // Lazy default registration: even if SimpleChat never imports
  // `./renderers`, a developer who flips the flag from the DevTools
  // console still gets the full registry (text + table + chart +
  // image) without restarting Electron. Idempotent — registering
  // twice is a no-op.
  registerDefaultRenderers();

   
  console.debug('[simplechat] resultNodes injected', {
    count: nodes.length,
    types: nodes.map((node) => node.type),
  });

  return (
    <div className="sc-extra-result-nodes" data-testid="sc-extra-result-nodes">
      {nodes.map((node) => (
        <ResultCardRenderer key={node.id} node={node} />
      ))}
    </div>
  );
}

export const EXTRA_RENDERERS_STORAGE_KEY = LS_KEY;