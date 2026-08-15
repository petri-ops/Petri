// ============================================================
// UI-AGENTWB-007 — flag 生产态切换 Settings 子区测试。
//
// 覆盖（>=8 项）：
//   1. 渲染 / 子节标题
//   2. 切换后写 localStorage
//   3. 切换后 dispatchEvent('storage')
//   4. bridge 优先初始值
//   5. 与 main IPC 状态同步（bridge.set 异步回写）
//   6. a11y label / role switch
//   7. hover 状态
//   8. focus 状态
//   9. 默认 false（无 bridge 无 localStorage）
//  10. localStorage fallback 当 bridge 不可用
// ============================================================

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPERIMENTAL_FEATURES_LABEL,
  EXTRA_RENDERERS_LABEL,
  ExperimentalFeaturesSection,
} from './ExperimentalFeaturesSection';
import { EXTRA_RENDERERS_STORAGE_KEY } from '@/components/copilot/extraRenderers';

type AgentWorkbenchFlagBridge = NonNullable<Window['biof3']>['agentWorkbenchFlags'];

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(EXTRA_RENDERERS_STORAGE_KEY);
  // The Section writes window.biof3 directly. Restore a clean state.
  delete (window as { biof3?: unknown }).biof3;
});

function readCssSource(): string {
  // Tests run from the frontend/ root; resolve the module CSS source so
  // we can assert the :hover / :focus-visible rules are present without
  // depending on the vite CSS-Modules runtime.
  const here = fileURLToPath(import.meta.url);
  return readFileSync(
    `${here.replace(/[^/]+$/, '')}ExperimentalFeaturesSection.module.css`,
    'utf8',
  );
}

function makeBridge(initial: boolean, setResult: { ok: boolean; extraRenderers: boolean; error?: string }): {
  bridge: AgentWorkbenchFlagBridge;
  setSpy: ReturnType<typeof vi.fn>;
  listeners: Array<(value: boolean) => void>;
} {
  const listeners: Array<(value: boolean) => void> = [];
  let current = initial;
  const setSpy = vi.fn(async (value: boolean) => {
    current = setResult.ok ? value : current;
    return { ...setResult, extraRenderers: setResult.ok ? value : current };
  });
  const bridge = {
    getExtraRenderers: () => current,
    set: setSpy,
    onChange: (cb: (value: boolean) => void) => {
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
  return { bridge, setSpy, listeners };
}

describe('ExperimentalFeaturesSection', () => {
  it('renders the section heading and the extra-renderers toggle', () => {
    render(<ExperimentalFeaturesSection />);
    expect(screen.getByText(EXPERIMENTAL_FEATURES_LABEL)).toBeTruthy();
    expect(screen.getByText(EXTRA_RENDERERS_LABEL)).toBeTruthy();
    expect(screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL })).toBeTruthy();
  });

  it('defaults the toggle to off when no bridge and no localStorage exist', () => {
    render(<ExperimentalFeaturesSection />);
    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('falls back to localStorage when the bridge is absent', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    render(<ExperimentalFeaturesSection />);
    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('initialises from the bridge value when both bridge and localStorage are present', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    const { bridge } = makeBridge(false, { ok: true, extraRenderers: false });
    (window as { biof3?: unknown }).biof3 = { agentWorkbenchFlags: bridge };
    render(<ExperimentalFeaturesSection bridge={bridge} />);
    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('writes the new value to localStorage and dispatches a storage event when toggled on', async () => {
    const { bridge } = makeBridge(false, { ok: true, extraRenderers: true });
    const onStorage = vi.fn();
    window.addEventListener('storage', onStorage);
    render(<ExperimentalFeaturesSection bridge={bridge} />);

    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    fireEvent.click(toggle);
    // Wait for the async bridge.set() promise to resolve before assertions.
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(EXTRA_RENDERERS_STORAGE_KEY)).toBe('true');
    });
    // Storage event is dispatched synchronously inside notifyStorage.
    const storageEvents = onStorage.mock.calls.filter(([event]) => event.type === 'storage');
    expect(storageEvents.length).toBeGreaterThan(0);
    const lastStorageEvent = storageEvents[storageEvents.length - 1]![0] as StorageEvent;
    expect(lastStorageEvent.key).toBe(EXTRA_RENDERERS_STORAGE_KEY);
    expect(lastStorageEvent.newValue).toBe('true');
    window.removeEventListener('storage', onStorage);
  });

  it('mirrors the bridge.set() response so the UI tracks the main-process state', async () => {
    const { bridge, setSpy } = makeBridge(false, { ok: true, extraRenderers: true });
    render(<ExperimentalFeaturesSection bridge={bridge} />);

    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(setSpy).toHaveBeenCalled();
    });
    expect(toggle.checked).toBe(true);
    expect(window.localStorage.getItem(EXTRA_RENDERERS_STORAGE_KEY)).toBe('true');
  });

  it('rolls back when the bridge rejects the update', async () => {
    const { bridge, setSpy } = makeBridge(false, { ok: false, extraRenderers: false, error: 'unauthorized' });
    render(<ExperimentalFeaturesSection bridge={bridge} />);

    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(setSpy).toHaveBeenCalled();
    });
    // The setEnabled(previous) inside the catch fires after the
    // bridge.set promise rejects. waitFor re-reads the DOM until the
    // rollback has been committed.
    await vi.waitFor(() => {
      expect(toggle.checked).toBe(false);
    });
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(EXTRA_RENDERERS_STORAGE_KEY)).toBe('false');
    });
  });

  it('exposes the toggle as role=switch with a descriptive aria-label', () => {
    render(<ExperimentalFeaturesSection />);
    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    expect(toggle.getAttribute('aria-label')).toBe(EXTRA_RENDERERS_LABEL);
    expect(toggle.getAttribute('aria-describedby')).toBe('biof3-extra-renderers-description');
    // The description span carries the live "已开启/已关闭" copy.
    expect(screen.getByText('已关闭')).toBeTruthy();
  });

  it('renders the hover state when the toggle control is hovered', () => {
    render(<ExperimentalFeaturesSection />);
    const container = screen.getByTestId('experimental-feature-extra-renderers');
    // happy-dom does not apply :hover styles, but the CSS rule must exist
    // and the markup must allow the hover selector to match. Assert the
    // CSS source defines a :hover rule on the toggle control path.
    const css = readCssSource();
    expect(css).toMatch(/\.toggleControl:hover|\.toggle:hover/);
    // The control sits inside the data-testid wrapper so the hover
    // pseudo-class can reach the inner toggle.
    const control = container.querySelector('input[type="checkbox"]');
    expect(control).toBeTruthy();
  });

  it('keeps the focus-visible ring reachable via the :focus-visible CSS selector', () => {
    render(<ExperimentalFeaturesSection />);
    const toggle = screen.getByRole('switch', { name: EXTRA_RENDERERS_LABEL }) as HTMLInputElement;
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    const css = readCssSource();
    expect(css).toMatch(/\.toggle:focus-visible/);
  });
});
