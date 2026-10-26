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
  /** BLOCK-264（C-39）— 待审批通知携带审批 token（点击深定位到审批卡） */
  ackToken?: string;
  createdAt: string;
  read: boolean;
}

const STORAGE_KEY = 'petri:notification-center:v1';
const MAX_NOTICES = 50;

const KINDS: ReadonlySet<string> = new Set(['turn_completed', 'turn_failed', 'approval_required', 'schedule_reminder']);

export interface AppNoticePrefs {
  kinds: Record<AppNoticeKind, boolean>;
  sound: boolean;
}

const PREFS_KEY = 'petri:notification-center:prefs:v1';
const DEFAULT_NOTICE_PREFS: AppNoticePrefs = Object.freeze({
  kinds: Object.freeze({
    turn_completed: true,
    turn_failed: true,
    approval_required: true,
    schedule_reminder: true,
  }),
  sound: false,
});

function loadPrefs(): AppNoticePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_NOTICE_PREFS, kinds: { ...DEFAULT_NOTICE_PREFS.kinds } };
    const parsed = JSON.parse(raw) as unknown;
    const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
    const kinds = { ...DEFAULT_NOTICE_PREFS.kinds };
    if (obj && obj.kinds && typeof obj.kinds === 'object' && !Array.isArray(obj.kinds)) {
      const rawKinds = obj.kinds as Record<string, unknown>;
      for (const kind of KINDS) {
        const value = rawKinds[kind];
        if (typeof value === 'boolean') kinds[kind as AppNoticeKind] = value;
      }
    }
    return { kinds, sound: Boolean(obj && obj.sound === true) };
  } catch {
    return { ...DEFAULT_NOTICE_PREFS, kinds: { ...DEFAULT_NOTICE_PREFS.kinds } };
  }
}

let prefs: AppNoticePrefs = loadPrefs();
const prefListeners = new Set<() => void>();

function persistPrefs(): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 仅内存态
  }
}

export function getNoticePrefs(): AppNoticePrefs {
  return prefs;
}

export function subscribeNoticePrefs(listener: () => void): () => void {
  prefListeners.add(listener);
  return () => { prefListeners.delete(listener); };
}

export function setNoticePrefs(patch: { kinds?: Partial<Record<AppNoticeKind, boolean>>; sound?: boolean }): void {
  prefs = {
    kinds: { ...prefs.kinds, ...(patch.kinds || {}) },
    sound: patch.sound === undefined ? prefs.sound : Boolean(patch.sound),
  };
  persistPrefs();
  prefListeners.forEach((listener) => listener());
}

function playNoticeSound(): void {
  try {
    const Ctor = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.035;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => { void context.close().catch(() => {}); };
  } catch {
    // WebAudio 不可用（测试/受限环境）静默
  }
}

export interface NoticeTarget {
  projectId: string;
  mode: 'chat' | 'scheduled';
  conversationId?: string;
}

/** 通知点击去向：提醒进计划看板，其余回对应会话；无项目=不可跳转。 */
export function noticeTarget(notice: AppNotice): NoticeTarget | null {
  if (!notice.projectId) return null;
  if (notice.kind === 'schedule_reminder') return { projectId: notice.projectId, mode: 'scheduled' };
  return { projectId: notice.projectId, mode: 'chat', conversationId: notice.conversationId };
}

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

export function pushNotice(input: Omit<AppNotice, 'id' | 'createdAt' | 'read'>): AppNotice | null {
  // BLOCK-259 K4 — 类型开关：该类通知被关闭时不再入本地历史/未读（系统 toast 由主进程偏好独立控制）。
  if (!prefs.kinds[input.kind]) return null;
  const notice: AppNotice = {
    ...input,
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    read: false,
  };
  notices = [notice, ...notices].slice(0, MAX_NOTICES);
  persist();
  emit();
  if (prefs.sound) playNoticeSound();
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

/** BLOCK-259 K4 — 点击单条通知即视为已读（跳转前先落状态）。 */
export function markNoticeRead(id: string): void {
  const target = notices.find((notice) => notice.id === id);
  if (!target || target.read) return;
  notices = notices.map((notice) => (notice.id === id ? { ...notice, read: true } : notice));
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
  prefs = { ...DEFAULT_NOTICE_PREFS, kinds: { ...DEFAULT_NOTICE_PREFS.kinds } };
  prefListeners.clear();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(PREFS_KEY);
  } catch {}
}
