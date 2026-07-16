// BioF3 桌面版原生 shell — 环境与 API 工具
// 替代 Docusaurus 版的 authClient.ts / getApiPrefix 等

// 桌面版恒为 true（这个前端只在桌面版跑）
export const IS_DESKTOP = true;

function backendApiBase(language: 'r' | 'python'): string {
  const config = typeof window !== 'undefined' ? window.biof3Desktop?.backendConfig : undefined;
  if (language === 'python') return config?.pythonApiBase || 'http://localhost:3004/api';
  return config?.rApiBase || 'http://localhost:3001/api';
}

export function getApiPrefix(language: 'r' | 'python' = 'r'): string {
  return backendApiBase(language);
}

export function getComputeApiPrefix(): string {
  return backendApiBase('r');
}

export function getPlatformApiPrefix(): string {
  return backendApiBase('r');
}
