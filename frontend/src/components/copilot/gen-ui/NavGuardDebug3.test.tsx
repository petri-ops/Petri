import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GenUiCard } from './GenUiCard';

const prepare = vi.fn(() => Promise.resolve({ ok: true, url: 'petri-genui://gen-test123/index.html' }));
vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => (window as unknown as { petri?: { genUi?: unknown } }).petri?.genUi ?? null,
}));

describe('debug3', () => {
  it('three signals', async () => {
    let sink: ((p: { frameUrl?: string }) => void) | null = null;
    (window as unknown as { petri?: unknown }).petri = {
      genUi: {
        prepare,
        onSandboxHijacked: (cb: (p: { frameUrl?: string }) => void) => {
          console.log('SUBSCRIBE');
          sink = (p) => { console.log('SIGNAL GOT', p.frameUrl); cb(p); };
          return () => { sink = null; };
        },
      },
    };
    const { container } = render(
      <GenUiCard reference={{ path: 'C:/ws/x.html', title: 't' }} projectId="p1" conversationId="conv-1" cardKey="k1" />,
    );
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    await waitFor(() => expect(sink).not.toBeNull());
    const fire = () => sink?.({ frameUrl: 'petri-genui://gen-test123/index.html' });
    fire(); fire(); fire();
    await new Promise((r) => setTimeout(r, 150));
    console.log('SUSPENDED:', container.querySelector('[data-testid="gen-ui-sandbox-suspended"]') !== null);
    expect(true).toBe(true);
  });
});
