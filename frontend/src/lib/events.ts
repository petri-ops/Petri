/**
 * BioF3 Desktop — typed event bus
 *
 * Replaces magic string CustomEvent names with const-typed symbols.
 * Producers and consumers import from here; one typo now = TS compile error.
 *
 * Payload types mirror the actual `CustomEvent.detail` shape at each call-site.
 */

export const biof3Events = {
  /** Fired by DesktopOnboarding on completion; listened by App's DesktopOnboardingMount */
  onboardingDone: 'biof3:onboarding-done',

  /** Fired by main.js preload on Cmd+R; listened by project-workspace to refetch state */
  softRefresh: 'biof3:soft-refresh',

  /** Fired by project-workspace right-panel handlers; listened by project-workspace itself */
  projectOpenResult: 'biof3:project-open-result',

  /**
   * Fired by project-workspace (handleAskAgent); listened by SimpleChat to inject
   * a prompt into the chat input without navigating.
   */
  copilotAsk: 'biof3:copilot-ask',

  /** Fired by the shared TitleBar; listened by BrowserPanel */
  browserBack: 'biof3:browser-back',
  browserForward: 'biof3:browser-forward',
} as const;

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

export type BioF3EventName = (typeof biof3Events)[keyof typeof biof3Events];

export interface CopilotAskDetail {
  prompt: string;
}

export interface ProjectOpenResultDetail {
  toolJobId: string;
  projectId?: string | null;
}

export type BioF3EventMap = {
  [biof3Events.onboardingDone]: undefined;
  [biof3Events.softRefresh]: undefined;
  [biof3Events.projectOpenResult]: ProjectOpenResultDetail;
  [biof3Events.copilotAsk]: CopilotAskDetail;
  [biof3Events.browserBack]: undefined;
  [biof3Events.browserForward]: undefined;
};

/** Dispatch a typed event on window */
export function dispatchBioF3Event<K extends BioF3EventName>(
  name: K,
  detail?: BioF3EventMap[K]
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: detail as unknown as CustomEventInit }));
}

/**
 * Subscribe to a typed event. Returns an unsubscribe function.
 * Set `{ once: true }` for one-shot listeners.
 */
export function subscribeBioF3Event<K extends BioF3EventName>(
  name: K,
  handler: (detail: BioF3EventMap[K]) => void,
  options?: { once?: boolean }
): () => void {
  const wrapped = (e: Event) => {
    handler((e as CustomEvent).detail as BioF3EventMap[K]);
  };
  window.addEventListener(name, wrapped);
  if (options?.once) {
    // replace with a self-unsubscribing wrapper
    window.addEventListener(name, () => {
      window.removeEventListener(name, wrapped);
    });
  }
  return () => window.removeEventListener(name, wrapped);
}
