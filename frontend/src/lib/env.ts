// BioF3 桌面版原生 shell — 环境与 API 工具
// 替代 Docusaurus 版的 authClient.ts / getApiPrefix 等

// 桌面版恒为 true（这个前端只在桌面版跑）
export const IS_DESKTOP = true;

// BLOCK-30 P1: py-server HTTP 服务已摘除，唯一业务后端是 biof3-server；
// Python 工具在服务端经 shared-backend 执行器注册表本地执行。
// language 参数保留仅为兼容既有调用点，路由恒走同一后端。
function backendApiBase(_language?: 'r' | 'python'): string {
  const config = typeof window !== 'undefined' ? window.biof3Desktop?.backendConfig : undefined;
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
