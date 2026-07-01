// BioF3 桌面版原生 shell — 环境与 API 工具
// 替代 Docusaurus 版的 authClient.ts / getApiPrefix 等

// 桌面版恒为 true（这个前端只在桌面版跑）
export const IS_DESKTOP = true;

// API 前缀：桌面版 r-server 在 :3001，py-server 在 :3004
// Electron 主进程会把这两个端口暴露给渲染进程
export function getApiPrefix(language: 'r' | 'python' = 'r'): string {
  if (language === 'python') {
    return 'http://localhost:3004/api';
  }
  return 'http://localhost:3001/api';
}

export function getComputeApiPrefix(): string {
  return 'http://localhost:3001/api';
}

export function getPlatformApiPrefix(): string {
  return 'http://localhost:3001/api';
}
