/**
 * Event-loop and request-timing probe for Result Studio performance work.
 *
 * The probe is off unless PETRI_PERF_PROBE=1. While off every exported function
 * is a no-op so production request handling keeps its current cost.
 *
 * Nothing here records result content, request bodies, query strings, absolute
 * paths or credentials: request timings are keyed by a route template only.
 */

const { monitorEventLoopDelay } = require('node:perf_hooks');

const RESOLUTION_MS = 10;
const MAX_ROUTES = 64;
const MAX_SAMPLES_PER_ROUTE = 256;
const MAX_BLOCKS = 128;

let histogram = null;
let routes = new Map();
let blocks = [];
let startedAtMs = 0;

function envEnabled() {
  return process.env.PETRI_PERF_PROBE === '1';
}

function isProbeActive() {
  return histogram !== null;
}

/** Start sampling. Idempotent; returns whether the probe is now active. */
function enableProbe({ force = false } = {}) {
  if (!force && !envEnabled()) return false;
  if (histogram) return true;
  histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  startedAtMs = Date.now();
  return true;
}

function disableProbe() {
  if (histogram) histogram.disable();
  histogram = null;
  routes = new Map();
  blocks = [];
  startedAtMs = 0;
}

function resetProbe() {
  if (!histogram) return false;
  histogram.reset();
  routes = new Map();
  blocks = [];
  startedAtMs = Date.now();
  return true;
}

/**
 * Collapse a concrete request path into a route template so job, project,
 * revision and file identifiers never reach the snapshot.
 */
function redactRoute(pathname) {
  if (typeof pathname !== 'string' || !pathname) return '/other';
  return pathname.split('/').map((segment) => {
    if (!segment) return segment;
    // Already an Express route param (e.g. :jobId): carries no identity and its
    // name is informative, so keep it rather than collapsing it to :id.
    if (segment.startsWith(':')) return segment;
    if (/^[a-z][a-z0-9-]*$/i.test(segment) && segment.length <= 24 && !/\d/.test(segment)) return segment;
    if (/\.[a-z0-9]+$/i.test(segment)) return `:file${segment.slice(segment.lastIndexOf('.'))}`;
    return ':id';
  }).join('/') || '/other';
}

function percentileOf(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentileOf(sorted, 0.5),
    p95: percentileOf(sorted, 0.95),
    max: sorted.length ? Number(sorted[sorted.length - 1].toFixed(3)) : null,
  };
}

/** Record one completed request. Called from an env-gated middleware only. */
function recordRequestTiming({ method, route, status, ttfbMs, totalMs }) {
  if (!histogram) return;
  const key = `${String(method || 'GET').toUpperCase()} ${redactRoute(route)}`;
  let entry = routes.get(key);
  if (!entry) {
    if (routes.size >= MAX_ROUTES) return;
    entry = { route: key, count: 0, statuses: {}, ttfb: [], total: [] };
    routes.set(key, entry);
  }
  entry.count += 1;
  const statusKey = String(status || 0);
  entry.statuses[statusKey] = (entry.statuses[statusKey] || 0) + 1;
  if (Number.isFinite(ttfbMs) && entry.ttfb.length < MAX_SAMPLES_PER_ROUTE) entry.ttfb.push(ttfbMs);
  if (Number.isFinite(totalMs) && entry.total.length < MAX_SAMPLES_PER_ROUTE) entry.total.push(totalMs);
}

/** Record a discrete stall observed by the tick monitor. */
function observeBlock(lagMs) {
  if (!histogram || !Number.isFinite(lagMs) || lagMs <= 0) return;
  if (blocks.length >= MAX_BLOCKS) blocks.shift();
  blocks.push({ lagMs: Number(lagMs.toFixed(1)), atMs: Date.now() - startedAtMs });
}

function snapshotProbe() {
  if (!histogram) return { enabled: false, eventLoop: null, requests: [], blocks: [] };
  // An empty histogram reports sentinel values (min is int64 max, mean is NaN)
  // rather than throwing, so report nothing instead of a fabricated sample.
  const empty = histogram.count === 0;
  const toMs = (ns) => (!empty && Number.isFinite(ns) ? Number((ns / 1e6).toFixed(3)) : null);
  return {
    enabled: true,
    windowMs: Date.now() - startedAtMs,
    eventLoop: {
      resolutionMs: RESOLUTION_MS,
      samples: histogram.count,
      minMs: toMs(histogram.min),
      meanMs: toMs(histogram.mean),
      p50Ms: toMs(histogram.percentile(50)),
      p95Ms: toMs(histogram.percentile(95)),
      p99Ms: toMs(histogram.percentile(99)),
      maxMs: toMs(histogram.max),
    },
    requests: [...routes.values()]
      .map((entry) => ({
        route: entry.route,
        count: entry.count,
        statuses: entry.statuses,
        ttfbMs: summarize(entry.ttfb),
        totalMs: summarize(entry.total),
      }))
      .sort((a, b) => (b.totalMs.max || 0) - (a.totalMs.max || 0)),
    blocks: [...blocks],
  };
}

module.exports = {
  RESOLUTION_MS,
  envEnabled,
  isProbeActive,
  enableProbe,
  disableProbe,
  resetProbe,
  redactRoute,
  recordRequestTiming,
  observeBlock,
  snapshotProbe,
};
