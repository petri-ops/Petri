import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OnboardingChecklist } from '@/components/desktop/OnboardingChecklist';

// BLOCK-264（C-35）— 首启分步引导清单

function mockFetch(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(payload),
  });
}

describe('OnboardingChecklist（BLOCK-264 · C-35）', () => {
  beforeEach(() => { vi.stubGlobal('fetch', mockFetch({})); });
  afterEach(() => { vi.unstubAllGlobals(); cleanup(); });

  it('未完成时显示清单，步数与真实状态一致', async () => {
    vi.stubGlobal('fetch', mockFetch({
      ok: true,
      allDone: false,
      steps: { modelConfigured: false, hasProject: false, hasConversation: true },
    }));
    render(<OnboardingChecklist apiBase="http://mock/api" />);
    await waitFor(() => {
      expect(screen.getByText(/开始使用（1\/3）/)).toBeTruthy();
    });
    const stepModel = document.querySelector('[data-onboarding-step="modelConfigured"]');
    const stepConv = document.querySelector('[data-onboarding-step="hasConversation"]');
    expect(stepModel?.getAttribute('data-done')).toBe('false');
    expect(stepConv?.getAttribute('data-done')).toBe('true');
  });

  it('全部完成时整块隐藏（老用户零打扰）', async () => {
    vi.stubGlobal('fetch', mockFetch({
      ok: true,
      allDone: true,
      steps: { modelConfigured: true, hasProject: true, hasConversation: true },
    }));
    const { container } = render(<OnboardingChecklist apiBase="http://mock/api" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-onboarding-checklist]')).toBeNull();
  });

  it('接口失败不渲染（不虚构进度）', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false }));
    const { container } = render(<OnboardingChecklist apiBase="http://mock/api" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-onboarding-checklist]')).toBeNull();
  });

  it('点击「已完成」态不可交互——状态只来自后端', async () => {
    vi.stubGlobal('fetch', mockFetch({
      ok: true,
      allDone: false,
      steps: { modelConfigured: false, hasProject: false, hasConversation: false },
    }));
    render(<OnboardingChecklist apiBase="http://mock/api" />);
    await waitFor(() => expect(document.querySelector('[data-onboarding-checklist]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-onboarding-step="modelConfigured"]')!);
    await waitFor(() => {
      expect(document.querySelector('[data-onboarding-step="modelConfigured"]')?.getAttribute('data-done')).toBe('false');
    });
  });
});
