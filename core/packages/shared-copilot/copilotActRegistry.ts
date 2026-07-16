// ============================================================
// Copilot Act Registry — Phase 4 extensibility framework
// ============================================================
//
// This module lets feature authors register custom "act" handlers that
// the AI Copilot can invoke through the generic `act_generic` tool.
//
// Why: each new website capability used to require three places of
// hand-written code (server-side dispatcher, ACT_PAGE_REQUIREMENTS,
// frontend onToolResult). Now you only register **once** here, and the
// AI automatically discovers + can call your handler.
//
// Safety: AI can only call handlers that are explicitly registered here
// (whitelist). The AI never executes free-form code. The server enforces
// the same whitelist via the published `act-registry.json`.
//
// Registration (typical): pages/components call `registerCopilotAct({...})`
// at module load time. The module is auto-imported by `src/theme/Root.tsx`
// so every page boot includes the full registry.

export type CopilotActResult = void | { ok?: boolean; error?: string };
export type CopilotActHandler = (payload: unknown) => CopilotActResult | Promise<CopilotActResult>;

export interface CopilotActDefinition {
  /** Stable id — must match what the LLM sends. snake_case_with_underscores */
  id: string;
  /** What this action does, shown to the LLM */
  description: string;
  /** Required pages this act can run on. '*' means anywhere; an array enumerates. */
  pages?: string[] | '*';
  /** JSON-Schema-lite for payload. Keys → human description. */
  payloadSchema?: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      description: string;
      required?: boolean;
    }
  >;
  /** Example payload to teach the LLM how to call this */
  example?: Record<string, unknown>;
  /** The actual handler invoked on the client when the AI fires this act */
  handler: CopilotActHandler;
}

interface RegistryEntry extends CopilotActDefinition {
  registeredAt: number;
}

const _registry = new Map<string, RegistryEntry>();
let _stableSnapshotJson: string | null = null;

export function registerCopilotAct(def: CopilotActDefinition): void {
  if (!def || !def.id || typeof def.handler !== 'function') {
    console.warn('[copilot-registry] invalid registration', def);
    return;
  }
  if (_registry.has(def.id)) {
    console.warn(`[copilot-registry] act "${def.id}" already registered — overwriting`);
  }
  _registry.set(def.id, { ...def, registeredAt: Date.now() });
  _stableSnapshotJson = null;
  // Expose to runtime introspection / debug overlays
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__copilotActRegistry = Object.fromEntries(
      Array.from(_registry.entries()).map(([k, v]) => [
        k,
        {
          id: v.id,
          description: v.description,
          pages: v.pages,
          payloadSchema: v.payloadSchema,
          example: v.example,
        },
      ])
    );
  }
}

export function getCopilotAct(id: string): RegistryEntry | undefined {
  return _registry.get(id);
}

export function listCopilotActs(): Omit<CopilotActDefinition, 'handler'>[] {
  return Array.from(_registry.values()).map(({ handler: _h, registeredAt: _t, ...rest }) => rest);
}

/**
 * Stable JSON snapshot suitable for sending to the server.
 * Excludes the `handler` function (not serializable).
 */
export function getRegistrySnapshot(): string {
  if (_stableSnapshotJson) return _stableSnapshotJson;
  const obj = listCopilotActs().reduce<Record<string, Omit<CopilotActDefinition, 'handler'>>>(
    (acc, d) => {
      const { handler: _h, ...rest } = d as any;
      acc[d.id] = rest;
      return acc;
    },
    {}
  );
  _stableSnapshotJson = JSON.stringify(obj);
  return _stableSnapshotJson;
}

/**
 * Invoke a registered handler by id. Used by CopilotChat.onToolResult when
 * the server fires `actType: 'generic'`.
 */
export async function invokeCopilotAct(
  id: string,
  payload: unknown
): Promise<{ ok: boolean; error?: string }> {
  const entry = _registry.get(id);
  if (!entry) {
    return { ok: false, error: 'unknown_handler:' + id };
  }
  try {
    const r = await entry.handler(payload);
    if (r && typeof r === 'object' && 'error' in r && r.error) {
      return { ok: false, error: String(r.error) };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errMsg(e) };
  }
}

// ============================================================
// Server sync — POST the snapshot to /api/ai/act-registry on boot
// ============================================================

import { errMsg } from './error';
import { getApiPrefix } from './api-inject';

function _authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const t = localStorage.getItem('biof3_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

let _lastUploadAt = 0;
const _UPLOAD_THROTTLE_MS = 60_000; // at most once per minute

/** Push the current registry snapshot to the server. */
export async function uploadActRegistry(): Promise<{ ok: boolean; count?: number }> {
  if (typeof window === 'undefined') return { ok: false };
  if (Date.now() - _lastUploadAt < _UPLOAD_THROTTLE_MS) return { ok: true };
  _lastUploadAt = Date.now();
  try {
    const snapshot = listCopilotActs().reduce<Record<string, unknown>>((acc, d) => {
      const { handler: _h, ...rest } = d as any;
      acc[d.id] = rest;
      return acc;
    }, {});
    const resp = await fetch(getApiPrefix() + '/ai/act-registry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeader() },
      body: JSON.stringify({ snapshot }),
    });
    if (!resp.ok) return { ok: false };
    const data = await resp.json();
    return { ok: data.status === 'ok', count: data.count };
  } catch {
    return { ok: false };
  }
}
