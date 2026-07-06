/**
 * Type-safe error message extraction.
 *
 * Use in catch blocks: `catch (e: unknown) { ... errMsg(e) ... }`
 * Replaces the `catch (e: any) { e.message }` pattern that spreads `any`
 * through the codebase.
 */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as Record<string, unknown>).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}
