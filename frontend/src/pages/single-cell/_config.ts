// ============================================================
// Shared config — no dependencies on other scrna modules
// ============================================================

import { getPlatformApiPrefix, getComputeApiPrefix } from '@/lib/authClient';

/** Projects / datasets / analyses CRUD → platform */
export function getApiPrefix(): string {
  return getPlatformApiPrefix();
}

/** Submit analysis / replot → Dell r-compute */
export function getComputePrefix(): string {
  return getComputeApiPrefix();
}
