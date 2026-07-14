export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'https://biof3.com/';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) return trimmed;
  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function isBioF3LocalBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function getBrowserViewportSize(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}
