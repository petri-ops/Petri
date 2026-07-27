/**
 * G0-RS-P4R-2 — which central mode is showing, and which may be offered.
 *
 * The plan asks for four mutually exclusive modes: Result, Code, Compare and
 * History. Only one of them has an implementation, and the plan itself assigns
 * two of the others elsewhere:
 *
 *   result   — the artifact body. The only mode with a surface today.
 *   code     — needs a revision source projection. None of the 23 routes in
 *              routes/result-studio.js provides one; §P4R-5 owns building it.
 *   compare  — has zero writers in frontend/src. Every consumer spells the
 *              check `result || compare`, and its only expression was a
 *              data-mode attribute no stylesheet selects, so it has always
 *              rendered identically to result.
 *   history  — needs the version switcher, which §P4R-4 owns.
 *
 * So this module deliberately does NOT make four modes work. It makes the
 * container honest: exactly one mode is active, and a mode with no surface
 * behind it is not offered. An entry that switches to a view identical to the
 * one you are already in is worse than an absent entry — it costs the user a
 * click to learn nothing, and it makes the stage look finished when three
 * quarters of it is not built.
 *
 * P4R-4 and P4R-5 each turn their mode on by supplying its capability, not by
 * editing this logic.
 */

export type ResultMode = 'result' | 'code' | 'compare' | 'history';

export const RESULT_MODES: readonly ResultMode[] = ['result', 'code', 'compare', 'history'] as const;

/**
 * What the surrounding system can actually do right now. Each flag is a real
 * capability, not a feature toggle: it answers "does a surface exist", so the
 * container cannot be made to offer something that has no implementation.
 */
export interface ResultModeCapabilities {
  /** A revision source projection route exists (P4R-5). */
  canProjectSource?: boolean;
  /** A version switcher exists to drive history (P4R-4). */
  canSwitchVersions?: boolean;
  /** A comparison surface distinct from `result` exists. */
  canCompare?: boolean;
}

/**
 * The modes that may be offered, in display order.
 *
 * `result` is always present — it is the reason the surface exists.
 */
export function availableResultModes(
  capabilities: ResultModeCapabilities = {},
): ResultMode[] {
  const available: ResultMode[] = ['result'];
  if (capabilities.canProjectSource) available.push('code');
  if (capabilities.canCompare) available.push('compare');
  if (capabilities.canSwitchVersions) available.push('history');
  return available;
}

/**
 * Resolve the mode to render.
 *
 * A requested mode that is not available falls back to `result` rather than
 * rendering an empty or duplicate view. This is what makes `?mode=compare`
 * typed into the address bar harmless: today it lands on the result, which is
 * what it always showed anyway, instead of implying a surface exists.
 */
export function resolveResultMode(
  requested: string | null | undefined,
  capabilities: ResultModeCapabilities = {},
): ResultMode {
  const available = availableResultModes(capabilities);
  return available.includes(requested as ResultMode) ? (requested as ResultMode) : 'result';
}

/**
 * Is exactly one mode active?
 *
 * The container's core invariant, stated so it can be asserted rather than
 * assumed. The plan requires the centre to hold one mode at a time instead of
 * stacking the four vertically.
 */
export function isSingleActiveMode(
  active: ResultMode,
  rendered: readonly ResultMode[],
): boolean {
  return rendered.length === 1 && rendered[0] === active;
}
