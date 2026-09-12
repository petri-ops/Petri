/**
 * Tool catalog channel (BLOCK-83 D4：目录提供者 SPI 的前端消费面).
 *
 * The catalog is projected by the backend from *installed plugins*
 * (`GET /api/tools/catalog`). Core no longer ships a hard-coded domain tool
 * list: with zero domain packs installed the catalog is empty and consumers
 * must render an honest empty state.
 */

import * as React from 'react';
import { getApiPrefix } from './env';

export interface CatalogInputField {
  id: string;
  label?: string;
  type: 'file' | 'select' | 'number' | 'text' | 'checkbox' | string;
  required?: boolean;
  accept?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  hint?: string;
  placeholder?: string;
}

export interface CatalogOutputDef {
  id: string;
  type: 'table' | 'plot' | 'file' | 'text' | string;
  label?: string;
  filename?: string;
}

export interface CatalogTool {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  language: 'r' | 'python' | null;
  type: string | null;
  version: string | null;
  inputs: CatalogInputField[];
  outputs: CatalogOutputDef[];
  artifacts: CatalogOutputDef[];
  estimatedMinutes: number | null;
  packages: Record<string, unknown>;
  runtime: Record<string, unknown>;
  builtAgainst: Record<string, unknown>;
  supportedPlatforms: string[];
  failureModes: unknown[];
  resultStudioAvailable: boolean;
  execution: Record<string, unknown>;
  /** 表现层；缺省由 UI 兜底。 */
  color: string | null;
  tutorialUrl: string | null;
  demoDataUrl: string | null;
  comingSoon: boolean;
}

interface CatalogResponse {
  ok: boolean;
  source?: string;
  count?: number;
  catalog?: CatalogTool[];
  error?: string;
}

const EMPTY: CatalogTool[] = [];

let _cache: CatalogTool[] | null = null;
let _inflight: Promise<CatalogTool[]> | null = null;
let _error: string | null = null;
const _listeners = new Set<() => void>();

function _emit(): void {
  for (const listener of _listeners) listener();
}

/** 拉取目录并写入进程内缓存（并发去重）。 */
export async function fetchToolCatalog(): Promise<CatalogTool[]> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const response = await fetch(`${getApiPrefix('r')}/tools/catalog`);
      if (!response.ok) throw new Error(`tool_catalog_http_${response.status}`);
      const payload = (await response.json()) as CatalogResponse;
      const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
      _cache = catalog;
      _error = null;
      return catalog;
    } catch (error) {
      _error = error instanceof Error ? error.message : 'tool_catalog_fetch_failed';
      // 失败不缓存，允许后续 reload 重试；当次调用方拿到空目录。
      return EMPTY;
    } finally {
      _inflight = null;
      _emit();
    }
  })();
  return _inflight;
}

/** 同步读取已缓存目录（未加载时为空数组）。 */
export function getCachedToolCatalog(): CatalogTool[] {
  return _cache || EMPTY;
}

export function invalidateToolCatalog(): void {
  _cache = null;
  _error = null;
  _emit();
}

function _subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/**
 * 目录消费 hook：装载即拉取一次（进程内缓存 + 跨组件共享）。
 * 无插件安装时 tools 为空数组，由调用方渲染诚实空态。
 */
export function useToolCatalog(): { tools: CatalogTool[]; loading: boolean; error: string | null; reload: () => void } {
  const snapshot = React.useSyncExternalStore(
    _subscribe,
    getCachedToolCatalog,
    getCachedToolCatalog,
  );
  const [loading, setLoading] = React.useState(_cache === null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    if (_cache === null) {
      setLoading(true);
      fetchToolCatalog().finally(() => { if (alive) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { alive = false; };
  }, [tick]);

  const reload = React.useCallback(() => {
    invalidateToolCatalog();
    setTick((value) => value + 1);
  }, []);

  return { tools: snapshot, loading, error: _error, reload };
}

/** 按 id 查目录条目（未命中返回 null，调用方须容忍缺失）。 */
export function findCatalogTool(tools: CatalogTool[], toolId: string | null | undefined): CatalogTool | null {
  if (!toolId) return null;
  return tools.find((tool) => tool.id === toolId) || null;
}

/** 登录态之外的即时查找（如弹出窗状态自举）：命中缓存，未缓存则先拉一次。 */
export async function lookupToolById(toolId: string | null | undefined): Promise<CatalogTool | null> {
  if (!toolId) return null;
  const cached = findCatalogTool(_cache || [], toolId);
  if (cached) return cached;
  const catalog = await fetchToolCatalog();
  return findCatalogTool(catalog, toolId);
}
