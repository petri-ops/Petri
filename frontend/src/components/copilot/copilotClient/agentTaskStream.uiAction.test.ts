import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybeDispatchUiAction } from './agentTaskStream';
import { petriEvents } from '@/lib/events';
import type { ToolResultEvent } from './types';

function event(overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    name: 'act',
    summary: 'ok',
    ackToken: 'ack_1',
    ackExpiresAt: Date.now() + 5_000,
    uiAction: {
      actionId: 'pack:bio:action:focus',
      surfaceId: 'pack:bio:lab',
      packId: 'bio',
      payload: { cluster: '5' },
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agentTaskStream ui_action dispatch', () => {
  it('dispatches one unexpired act ui_action with routing fields', () => {
    const listener = vi.fn();
    window.addEventListener(petriEvents.uiActionRequest, listener);
    maybeDispatchUiAction(event());
    window.removeEventListener(petriEvents.uiActionRequest, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      actionId: 'pack:bio:action:focus',
      surfaceId: 'pack:bio:lab',
      packId: 'bio',
      ackToken: 'ack_1',
      payload: { cluster: '5' },
    });
  });

  it('ignores expired actions (history replay must not re-run UI side effects)', () => {
    const listener = vi.fn();
    window.addEventListener(petriEvents.uiActionRequest, listener);
    maybeDispatchUiAction(event({ ackExpiresAt: Date.now() - 1 }));
    window.removeEventListener(petriEvents.uiActionRequest, listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores non-act tools and actions without ack token', () => {
    const listener = vi.fn();
    window.addEventListener(petriEvents.uiActionRequest, listener);
    maybeDispatchUiAction(event({ name: 'workspace_read' }));
    maybeDispatchUiAction(event({ ackToken: undefined }));
    window.removeEventListener(petriEvents.uiActionRequest, listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
