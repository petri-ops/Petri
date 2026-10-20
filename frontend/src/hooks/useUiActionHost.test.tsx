import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiActionHost } from './useUiActionHost';
import { petriEvents } from '@/lib/events';
import {
  WORK_SURFACE_UI_ACTION_EVENT,
  WORK_SURFACE_UI_ACTION_RESULT_EVENT,
  type WorkSurfaceUiActionDetail,
} from '@/lib/workSurface/uiActionBus';
import type { PackUiActionDescriptor, WorkSurfaceDescriptor } from '@/lib/workSurface/types';

const ACTION: PackUiActionDescriptor = {
  id: 'pack:bio:action:focus',
  label: '聚焦',
  source: 'pack',
  packId: 'bio',
  surfaceId: 'pack:bio:lab',
};

const SURFACE: WorkSurfaceDescriptor = {
  id: 'pack:bio:lab',
  kind: 'pack-view',
  title: '实验台',
  icon: 'puzzle',
  source: 'pack',
  packId: 'bio',
  singleton: true,
  closeable: true,
  persist: true,
  order: 100,
  entry: 'ui/lab.html',
};

function Harness({ onOpen = vi.fn() }: { onOpen?: (id: string) => void }): React.ReactElement {
  useUiActionHost({
    uiActions: [ACTION],
    openRightPanel: onOpen,
    descriptorFor: (id) => (id === SURFACE.id ? SURFACE : undefined),
  });
  return <div>host</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(): {
  calls: Array<{ url: string; body?: string }>;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const calls: Array<{ url: string; body?: string }> = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === 'string' ? input : '(request object)',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    } as Response);
  });
  return { calls, fetchMock };
}

describe('useUiActionHost', () => {
  it('opens the target pack surface, dispatches one request, and acks the iframe result', async () => {
    const { calls, fetchMock } = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    const dispatched: WorkSurfaceUiActionDetail[] = [];
    const onAction = (event: Event) => dispatched.push((event as CustomEvent<WorkSurfaceUiActionDetail>).detail);
    window.addEventListener(WORK_SURFACE_UI_ACTION_EVENT, onAction);

    window.dispatchEvent(new CustomEvent(petriEvents.uiActionRequest, {
      detail: {
        actionId: ACTION.id,
        surfaceId: SURFACE.id,
        packId: 'bio',
        ackToken: 'ack_1',
        payload: { cluster: '5' },
      },
    }));

    expect(onOpen).toHaveBeenCalledWith(SURFACE.id);
    expect(dispatched).toHaveLength(1);
    const requestId = dispatched[0].requestId;
    expect(requestId).toBeTruthy();

    window.dispatchEvent(new CustomEvent(WORK_SURFACE_UI_ACTION_RESULT_EVENT, {
      detail: { requestId, actionId: ACTION.id, ok: true, message: 'done' },
    }));
    window.removeEventListener(WORK_SURFACE_UI_ACTION_EVENT, onAction);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = calls[0];
    expect(call.url).toContain('/ai/act-ack/ack_1');
    const body = JSON.parse(call.body || '{}') as {
      ok: boolean; info: { message?: string; error?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.info.message).toBe('done');
  });

  it('acks failure without opening a surface when no pack view owns the action', async () => {
    const { calls, fetchMock } = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    window.dispatchEvent(new CustomEvent(petriEvents.uiActionRequest, {
      detail: { actionId: 'pack:missing:action:none', ackToken: 'ack_missing' },
    }));

    expect(onOpen).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = calls[0];
    expect(call.url).toContain('/ai/act-ack/ack_missing');
    const body = JSON.parse(call.body || '{}') as {
      ok: boolean; info: { message?: string; error?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.info.error).toBe('ui_action_not_available');
  });
});
