export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'https://biof3.com/';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) return trimmed;
  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function isBioF3LocalReportUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return isLocalHost && /\/api\/tools\/file\/[^/]+\/(?:final-)?report\.html$/i.test(url.pathname);
  } catch {
    return false;
  }
}
