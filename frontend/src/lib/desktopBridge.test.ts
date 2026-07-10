import { describe, expect, it, beforeEach } from 'vitest';
import {
  getBridge,
  requireBridge,
  isDesktop,
  BridgeUnavailableError,
  type DesktopBridgeName,
} from '@/lib/desktopBridge';

function installBridge<K extends DesktopBridgeName>(
  name: K,
  // The handle shape comes from electron.d.ts; the test installs
  // a stub that satisfies whatever the chosen bridge declares.
  handle: unknown
) {
  (window as unknown as Record<string, unknown>).biof3Desktop = {
    [name]: handle,
  };
}

function uninstallBridge() {
  delete (window as unknown as { biof3Desktop?: unknown }).biof3Desktop;
}

beforeEach(() => {
  uninstallBridge();
});

describe('isDesktop', () => {
  it('returns false when window.biof3Desktop is absent', () => {
    expect(isDesktop()).toBe(false);
  });

  it('returns true when window.biof3Desktop is populated', () => {
    installBridge('aiSettings', { get: () => Promise.resolve({}) });
    expect(isDesktop()).toBe(true);
  });
});

describe('getBridge', () => {
  it('returns null outside the desktop context', () => {
    expect(getBridge('aiSettings')).toBeNull();
    expect(getBridge('terminal')).toBeNull();
    expect(getBridge('plugins')).toBeNull();
  });

  it('returns the requested sub-bridge when populated', () => {
    const handle = { get: () => Promise.resolve({}) };
    installBridge('aiSettings', handle);
    expect(getBridge('aiSettings')).toBe(handle);
  });

  it('returns null when the bridge exists but the sub-handle is missing', () => {
    (window as unknown as Record<string, unknown>).biof3Desktop = {
      isDesktop: true,
      platform: 'darwin',
      arch: 'arm64',
    };
    expect(getBridge('aiSettings')).toBeNull();
  });

  it('preserves the canonical shape for every bridge', () => {
    // Compile-time check: each bridge name resolves to its
    // declared shape in electron.d.ts.
    const terminalHandle = {
      writeSession: () => Promise.resolve({ ok: true }),
      onData: () => () => {},
    };
    installBridge('terminal', terminalHandle);
    const got = getBridge('terminal');
    expect(got?.writeSession).toBeTypeOf('function');
    expect(got?.onData).toBeTypeOf('function');
  });
});

describe('requireBridge', () => {
  it('returns the sub-bridge when available', () => {
    const handle = { get: () => Promise.resolve({}) };
    installBridge('aiSettings', handle);
    expect(requireBridge('aiSettings')).toBe(handle);
  });

  it('throws BridgeUnavailableError outside the desktop context', () => {
    expect(() => requireBridge('terminal')).toThrow(BridgeUnavailableError);
  });

  it('names the missing bridge in the error message', () => {
    try {
      requireBridge('plugins');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeUnavailableError);
      expect((e as BridgeUnavailableError).bridgeName).toBe('plugins');
      expect((e as Error).message).toContain('plugins');
    }
  });
});