// ============================================================
// Auth state management for scRNA platform
// ============================================================

import { getApiPrefix } from './_config';
import { fetchWithTimeout } from './_api';

/**
 * Guest mode — set to false in production.
 * When true: auto-login as test user on first visit, but block write operations.
 * Allows visitors to browse demo data without registering.
 */
export const GUEST_MODE = false;
const GUEST_USERNAME = 'test';
const GUEST_PASSWORD = 'test123';

export interface User {
  id: string;
  username: string;
  role: 'user' | 'admin';
}

const TOKEN_KEY = 'biof3_token';
const USER_KEY = 'biof3_user';
const GUEST_FLAG_KEY = 'biof3_guest';

// ============================================================
// Guest mode helpers
// ============================================================

/** True if current session is a guest (auto-logged-in, read-only). */
export function isGuestMode(): boolean {
  if (typeof window === 'undefined') return false;
  return GUEST_MODE && localStorage.getItem(GUEST_FLAG_KEY) === '1';
}

function setGuestFlag(on: boolean): void {
  if (on) localStorage.setItem(GUEST_FLAG_KEY, '1');
  else localStorage.removeItem(GUEST_FLAG_KEY);
}

/**
 * Auto-login as guest user. Called once on app boot when GUEST_MODE is on
 * and there's no existing token.
 */
export async function ensureGuestLogin(): Promise<User | null> {
  if (!GUEST_MODE) return null;
  const existing = getStoredUser();
  if (existing && getToken()) return existing;
  // Silent login as test user
  try {
    const data = await authFetch('/auth/login', {
      username: GUEST_USERNAME,
      password: GUEST_PASSWORD,
    });
    if (data.status === 'ok') {
      setToken(data.token);
      setStoredUser(data.user);
      setGuestFlag(true);
      return data.user;
    }
    return null;
  } catch {
    // 后端未启动/网络错误 — 返回 null，让调用方走未登录分支（只读 + LoginModal）
    return null;
  }
}

/**
 * Block write operations in guest mode. Returns true if operation should proceed,
 * false if blocked (caller should abort).
 *
 * Pass the React mouse event to position the tip at the click point.
 */
export function requireWrite(action = '此操作', e?: { clientX: number; clientY: number }): boolean {
  if (isGuestMode()) {
    import('./_GuestTip').then(({ showGuestTip }) => {
      showGuestTip(`${action}需要登录`, e);
    });
    return false;
  }
  return true;
}

// ============================================================
// Token management
// ============================================================

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

// ============================================================
// Auth API calls
// ============================================================

async function authFetch(
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const resp = await fetch(getApiPrefix().replace('/data', '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}

export async function login(
  username: string,
  password: string
): Promise<{ ok: boolean; user?: User; error?: string }> {
  const data = await authFetch('/auth/login', { username, password });
  if (data.status === 'ok') {
    setToken(data.token);
    setStoredUser(data.user);
    setGuestFlag(false);
    return { ok: true, user: data.user };
  }
  return { ok: false, error: data.error || '登录失败' };
}

export async function register(
  username: string,
  password: string
): Promise<{ ok: boolean; user?: User; error?: string }> {
  const data = await authFetch('/auth/register', { username, password });
  if (data.status === 'ok') {
    setToken(data.token);
    setStoredUser(data.user);
    setGuestFlag(false);
    return { ok: true, user: data.user };
  }
  return { ok: false, error: data.error || '注册失败' };
}

export async function fetchMe(): Promise<User | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const resp = await fetch(getApiPrefix().replace('/data', '') + '/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401 || resp.status === 403) {
      // Token definitely expired/invalid — clear and force re-login
      clearAuth();
      return null;
    }
    if (!resp.ok) {
      // Server error (5xx) or other issue — don't clear auth, use cached user
      return getStoredUser();
    }
    const data = await resp.json();
    if (data.status === 'ok') {
      setStoredUser(data.user);
      return data.user;
    }
    // Unexpected response but not auth error — keep cached user
    return getStoredUser();
  } catch {
    // Network error — don't clear auth, use cached user
    return getStoredUser();
  }
}

// ============================================================
// Get auth headers for API calls
// ============================================================

export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  if (token) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }
  // No token — return basic headers (server will reject with 401 for protected routes)
  return {
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch with auth headers + timeout + retry.
 * All admin panel API calls MUST go through this — never bare fetch().
 *
 * @param timeoutMs  Default 15s. Heavy queries (retention, usage-stats) use 30s.
 */
export async function fetchWithAuth(
  url: string,
  init?: RequestInit,
  timeoutMs = 15_000
): Promise<Response> {
  return fetchWithTimeout(
    url,
    {
      ...init,
      headers: {
        ...getAuthHeaders(),
        ...(init?.headers || {}),
      },
    },
    timeoutMs
  );
}

export function logout(): void {
  clearAuth();
  if (typeof window !== 'undefined') {
    window.location.hash = '#/login';
  }
}
