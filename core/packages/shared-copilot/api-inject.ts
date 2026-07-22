/**
 * @biof3/shared/api-inject — 平台 API 注入点
 *
 * 渲染层组件（如 ActResultCard）需要
 * getApiPrefix + getToken，但这两个函数各前端实现不同（教程站走 Docusaurus authClient，
 * 桌面版走 @/lib/authClient）。依赖反转：shared 不 require 任何前端，前端启动时注入。
 *
 * 用法（前端 boot 时）：
 *   import { configureApi } from '@biof3/shared/api-inject';
 *   configureApi({ getApiPrefix: () => '/api', getToken: () => localStorage.getItem('token') });
 */

let _getApiPrefix: () => string = () => '/api';
let _getToken: () => string | null = () => null;

export function configureApi(opts: {
  getApiPrefix?: () => string;
  getToken?: () => string | null;
}) {
  if (opts.getApiPrefix) _getApiPrefix = opts.getApiPrefix;
  if (opts.getToken) _getToken = opts.getToken;
}

export function getApiPrefix(): string {
  return _getApiPrefix();
}

export function getToken(): string | null {
  return _getToken();
}
