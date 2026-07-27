/**
 * BioF3 Desktop — typed event bus
 *
 * Replaces magic string CustomEvent names with const-typed symbols.
 * Producers and consumers import from here; one typo now = TS compile error.
 *
 * Payload types mirror the actual `CustomEvent.detail` shape at each call-site.
*/

import type { CopilotContext } from '@/lib/copilotContext';

export const biof3Events = {
  /** Fired by DesktopOnboarding on completion; listened by App's DesktopOnboardingMount */
  onboardingDone: 'biof3:onboarding-done',

  /** Fired by main.js preload on Cmd+R; listened by project-workspace to refetch state */
  softRefresh: 'biof3:soft-refresh',

  /** Fired by project-workspace right-panel handlers; listened by project-workspace itself */
  projectOpenResult: 'biof3:project-open-result',

  /**
   * Fired by SimpleChat when the user clicks an internal artifact link in
   * the copilot reply. project-workspace subscribes and either focuses the
   * current job + selects the named artifact, or — when the artifact belongs
   * to a different project — navigates there first.
   */
  projectOpenArtifact: 'biof3:project-open-artifact',

  /**
   * Fired by SimpleChat when the user clicks an internal workspace-file link
   * in the copilot reply. project-workspace validates the target project,
   * opens the file in the right Files panel and adds/focuses the tab.
   */
  projectOpenWorkspaceFile: 'biof3:project-open-workspace-file',

  /**
   * Signals that files in one project may have changed. Agent workspace
   * writes emit this immediately; the Files panel also polls while visible
   * so terminal and external-editor writes converge without manual reload.
   */
  projectWorkspaceChanged: 'biof3:project-workspace-changed',

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
  /**
   * P4R-3：结果 Composer 的原子上下文快照。token 不写入 prompt；
   * SimpleChat 将该快照覆盖到本轮请求 context，避免异步建会话期间漂移。
   */
  resultContext?: {
    contextToken: string;
    activeArtifact: NonNullable<CopilotContext['activeArtifact']>;
    editRequest: NonNullable<CopilotContext['resultEditRequest']>;
  };
}

export interface ProjectOpenResultDetail {
  toolJobId: string;
  projectId?: string | null;
}

/**
 * Payload for `projectOpenArtifact`. `projectId` is optional — when present
 * it indicates the artifact belongs to a different project than the current
 * one and the host should navigate there before focusing the artifact.
 */
export interface ProjectOpenArtifactDetail {
  jobId: string;
  artifactName: string;
  projectId?: string | null;
}

/**
 * Payload for `projectOpenWorkspaceFile`. `projectId` is required and must
 * be validated by the host before opening — the resolver never trusts
 * user-supplied cross-project paths.
 */
export interface ProjectOpenWorkspaceFileDetail {
  projectId: string;
  relativePath: string;
  name?: string;
  openWithSystemApp?: boolean;
}

export interface ProjectWorkspaceChangedDetail {
  projectId: string;
  source: 'agent' | 'terminal' | 'external' | 'manual';
}

export type BioF3EventMap = {
  [biof3Events.onboardingDone]: undefined;
  [biof3Events.softRefresh]: undefined;
  [biof3Events.projectOpenResult]: ProjectOpenResultDetail;
  [biof3Events.projectOpenArtifact]: ProjectOpenArtifactDetail;
  [biof3Events.projectOpenWorkspaceFile]: ProjectOpenWorkspaceFileDetail;
  [biof3Events.projectWorkspaceChanged]: ProjectWorkspaceChangedDetail;
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
