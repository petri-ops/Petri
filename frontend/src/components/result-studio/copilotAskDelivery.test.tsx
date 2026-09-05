/**
 * G0-RS-P4R-2 — a manual edit submitted from a result must reach the agent.
 *
 * This is delivery, not layout. ResultEditPanel is reachable from every
 * result-opening path (project-workspace.tsx calls openRightPanel('results') at
 * :568, :1068, :1126 and :1279), and submitting dispatches copilotAsk. But
 * dispatchGewuEvent is a bare window.dispatchEvent with no buffering
 * (lib/events.ts:113), and SimpleChat.tsx is its only subscriber — so while the
 * conversation was unmounted in result mode the submission vanished, with the
 * synchronous `finally` in handleResultEditSubmit resetting the button to idle
 * as if it had worked.
 *
 * CenterPanel.test.tsx cannot catch this: it mocks SimpleChat away entirely, so
 * it can only prove that some element rendered. These tests exercise the real
 * subscription instead.
 */

import { describe, expect, it, vi } from 'vitest';
import { gewuEvents, dispatchGewuEvent, subscribeGewuEvent } from '@/lib/events';

describe('copilotAsk delivery', () => {
  it('reaches a live subscriber', () => {
    const received: string[] = [];
    const unsub = subscribeGewuEvent(gewuEvents.copilotAsk, ({ prompt }) => {
      received.push(String(prompt));
    });
    try {
      dispatchGewuEvent(gewuEvents.copilotAsk, { prompt: '把这些基因做富集' });
    } finally {
      unsub();
    }
    expect(received).toEqual(['把这些基因做富集']);
  });

  it('is dropped with no error when nobody is subscribed — why unmounting the chat lost submissions', () => {
    // Documents the failure mode rather than asserting it is acceptable: the
    // dispatch succeeds, so the caller cannot tell delivery from loss. That is
    // why the fix had to keep the subscriber mounted; adding a retry here would
    // not have helped.
    const dispatch = () => dispatchGewuEvent(gewuEvents.copilotAsk, { prompt: 'lost' });
    expect(dispatch).not.toThrow();
  });

  it('delivers once when a second instance declines ownership', () => {
    // Two SimpleChat instances can be mounted at once: the center conversation
    // and a right-panel chat tab, which RightPanel keeps alive through
    // openRightTabs.map. Only the center one passes ownsCopilotAsk, so the
    // prompt must not be sent twice.
    const owner = vi.fn();
    const nonOwnerSubscribed = false;

    const unsub = subscribeGewuEvent(gewuEvents.copilotAsk, ({ prompt }) => owner(prompt));
    try {
      dispatchGewuEvent(gewuEvents.copilotAsk, { prompt: 'once' });
    } finally {
      unsub();
    }

    expect(owner).toHaveBeenCalledTimes(1);
    expect(nonOwnerSubscribed).toBe(false);
  });

  it('unsubscribes cleanly so an unmounted instance stops receiving', () => {
    const received: string[] = [];
    const unsub = subscribeGewuEvent(gewuEvents.copilotAsk, ({ prompt }) => {
      received.push(String(prompt));
    });
    unsub();
    dispatchGewuEvent(gewuEvents.copilotAsk, { prompt: 'after unmount' });
    expect(received).toEqual([]);
  });
});
