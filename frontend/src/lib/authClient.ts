// BioF3 桌面版 auth client — 简化版
// 桌面版无登录，固定本地 admin 用户，所有模块权限全开。
// 替代 Docusaurus 版 authClient.ts 的桌面分支。

import { errMsg } from '@/lib/error';
import { getApiPrefix, getComputeApiPrefix, getPlatformApiPrefix } from '@/lib/env';

export const IS_DESKTOP = true;

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  permissions?: Record<string, boolean>;
}

const DESKTOP_USER: AuthUser = {
  id: 'local-user',
  username: 'Local User',
  role: 'admin',
  permissions: {
    docs: true,
    blog: true,
    tools: true,
    'single-cell': true,
    spatial: true,
    copilot: true,
  },
};

export { getApiPrefix, getComputeApiPrefix, getPlatformApiPrefix };

// 桌面版固定 admin，无需登录
export function getToken(): string | null {
  return 'desktop-local';
}
export function getStoredUser(): AuthUser | null {
  return DESKTOP_USER;
}
export function isLoggedIn(): boolean {
  return true;
}
export function hasModule(user: AuthUser | null, moduleKey: string): boolean {
  return true;
}
export function clearAuth(): void {}
export function logout(): void {}
export function subscribeAuth(callback: (user: AuthUser | null) => void): () => void {
  return () => {};
}
export function getCachedGuestPermissions(): Record<string, boolean> | null {
  return null;
}
export async function fetchGuestPermissions(): Promise<Record<string, boolean> | null> {
  return null;
}
export async function fetchMe(): Promise<AuthUser | null> {
  return DESKTOP_USER;
}

// login/register 桌面版不应被调用，保留 stub 防止类型缺口
export async function login(
  _username: string,
  _password: string
): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}
export async function register(_data: {
  username: string;
  password: string;
  email?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

export { errMsg };
