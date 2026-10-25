/**
 * notification-center — BLOCK-226 应用内通知留痕（纯前端本地）。
 *
 * 回合完成/失败/待审批都写入这里，不受系统通知偏好/聚焦/免打扰影响；
 * 最多 50 条，localStorage 持久化，未读计数供标题栏徽章使用。
 */

export type AppNoticeKind = 'turn_completed' | 'turn_failed' | 'approval_required' | 'schedule_reminder';

export interface AppNotice {
  id: string;
  kind: AppNoticeKind;
  title: string;
  body: string;
  conversationId?: string;
  projectId?: string;
  createdAt: string;
  read: boolean;
}

const STORAGE_KEY = 'petri:notification-center:v1';
const MAX_NOTICES = 50;

const KINDS: ReadonlySet<string> = new Set(['turn_completed', 'turn_failed', 'approval_required', 'schedule_reminder']);

function isNotice(value: unknown): value is AppNotice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as Record<string, unknown>;
  return typeof notice.id === 'string'
    && typeof notice.title === 'string'
    && typeof notice.body === 'string'
    && typeof notice.createdAt === 'string'
    && typeof notice.read === 'boolean'
    && KINDS.has(String(notice.kind));
}

function loadNotices(): AppNotice[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isNotice).slice(0, MAX_NOTICES);
  } catch {
    return [];
  }
}

let notices: AppNotice[] = loadNotices();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notices));
  } catch {
    // 存储不可用=仅内存态，不影响本次会话。
  }
}

export function pushNotice(input: Omit<AppNotice, 'id' | 'createdAt' | 'read'>): AppNotice {
  const notice: AppNotice = {
    ...input,
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    read: false,
  };
  notices = [notice, ...notices].slice(0, MAX_NOTICES);
  persist();
  emit();
  return notice;
}

export function listNotices(): AppNotice[] {
  return notices;
}

export function unreadNoticeCount(): number {
  return notices.reduce((count, notice) => count + (notice.read ? 0 : 1), 0);
}

export function markAllNoticesRead(): void {
  if (!notices.some((notice) => !notice.read)) return;
  notices = notices.map((notice) => ({ ...notice, read: true }));
  persist();
  emit();
}

export function clearNotices(): void {
  if (notices.length === 0) return;
  notices = [];
  persist();
  emit();
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only：清空内存与本地存储。 */
export function __resetNotificationCenterForTests(): void {
  notices = [];
  listeners.clear();
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}
