import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import {
  CopilotContextProvider,
  useCopilotContext,
  useSetCopilotContext,
} from '@/lib/copilotContextProvider';
import { getCopilotContext, setCopilotContext } from '@/lib/copilotContext';

// Reset the module-scope singleton between tests so cross-test
// state doesn't leak. (Plan 1.6 §4.2 the singleton is preserved as
// a read-fallback shim; the Provider still mirrors into it.)
function resetSingleton() {
  setCopilotContext({ page: 'unknown' });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <CopilotContextProvider>{children}</CopilotContextProvider>;
}

describe('CopilotContextProvider', () => {
  it('starts with page=unknown fallback', () => {
    resetSingleton();
    const { result } = renderHook(() => useCopilotContext(), { wrapper });
    expect(result.current.page).toBe('unknown');
  });

  it('useSetCopilotContext applies the patch on mount', () => {
    resetSingleton();
    const { result } = renderHook(
      () => {
        useSetCopilotContext({ page: 'spatial-result', projectId: 'p-1' });
        return useCopilotContext();
      },
      { wrapper }
    );
    expect(result.current.page).toBe('spatial-result');
    expect(result.current.projectId).toBe('p-1');
  });

  it('useSetCopilotContext resets stale fields from a prior page', () => {
    resetSingleton();
    // First, mount page A
    const first = renderHook(
      () => {
        useSetCopilotContext({
          page: 'single-cell-result',
          projectId: 'p-A',
          datasetId: 'd-A',
          analysisId: 'a-A',
        });
        return useCopilotContext();
      },
      { wrapper }
    );
    expect(first.result.current.analysisId).toBe('a-A');

    // Then, mount page B. The new hook should reset first, so stale
    // fields from page A don't leak into the new context.
    const second = renderHook(
      () => {
        useSetCopilotContext({
          page: 'spatial-project',
          projectId: 'p-B',
        });
        return useCopilotContext();
      },
      { wrapper }
    );
    expect(second.result.current.page).toBe('spatial-project');
    expect(second.result.current.projectId).toBe('p-B');
    expect(second.result.current.datasetId).toBeUndefined();
    expect(second.result.current.analysisId).toBeUndefined();
  });

  it('mirrors context into the vendor singleton for legacy readers', () => {
    resetSingleton();
    renderHook(
      () => useSetCopilotContext({ page: 'tools', toolId: 't-42' }),
      { wrapper }
    );
    // getCopilotContext is the legacy read path; after the Provider
    // mount, the singleton should reflect the same value.
    expect(getCopilotContext().page).toBe('tools');
    expect(getCopilotContext().toolId).toBe('t-42');
  });

  it('re-applies the patch when deps change', () => {
    resetSingleton();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => {
        useSetCopilotContext({ page: 'spatial-result', analysisId: id }, [id]);
        return useCopilotContext();
      },
      {
        wrapper,
        initialProps: { id: 'a-1' },
      }
    );
    expect(result.current.analysisId).toBe('a-1');

    rerender({ id: 'a-2' });
    expect(result.current.analysisId).toBe('a-2');
  });

  it('handle re-render without infinite update loop', () => {
    resetSingleton();
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount += 1;
        // Patch contents are constant across renders — naive
        // implementation using object identity in the deps array
        // would loop. The hook stringifies the patch to gate re-runs.
        useSetCopilotContext({ page: 'home', pageTitle: 'static' });
        return useCopilotContext();
      },
      { wrapper }
    );
    expect(result.current.page).toBe('home');
    expect(renderCount).toBeLessThan(10);
  });

  it('clears the page on the next mount after the prior hook unmounts', () => {
    resetSingleton();
    const first = renderHook(
      () => {
        useSetCopilotContext({ page: 'single-cell-dataset', datasetId: 'd-1' });
        return useCopilotContext();
      },
      { wrapper }
    );
    expect(first.result.current.page).toBe('single-cell-dataset');

    first.unmount();

    const second = renderHook(
      () => {
        useSetCopilotContext({ page: 'home' });
        return useCopilotContext();
      },
      { wrapper }
    );
    expect(second.result.current.page).toBe('home');
    expect(second.result.current.datasetId).toBeUndefined();
  });
});