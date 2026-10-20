import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkSurfaceTabs } from './useWorkSurfaceTabs';

const PACKS = vi.hoisted(() => [{
  packId: 'bio',
  views: [{ id: 'lab', title: '实验台', entry: 'ui/lab.html', singleton: true, order: 100 }],
  resultSurfaces: [],
  uiActions: [],
}]);

vi.mock('@/lib/workSurface/packContributionsClient', () => ({
  usePackContributions: () => ({ packs: PACKS, loading: false, error: null }),
}));

function Harness({ projectId = 'project-1' }: { projectId?: string }): React.ReactElement {
  const ws = useWorkSurfaceTabs(projectId);
  return (
    <div>
      <span data-testid="active">{ws.rightTab}</span>
      <span data-testid="tabs">{ws.openRightTabs.join(',')}</span>
      <span data-testid="surfaces">{ws.surfaces.map((surface) => surface.id).join(',')}</span>
      <button type="button" onClick={() => ws.openRightPanel('files')}>open-files</button>
      <button type="button" onClick={() => ws.openRightPanel('pack:bio:lab')}>open-pack</button>
      <button type="button" onClick={() => ws.closeRightPanelTab('pack:bio:lab')}>close-pack</button>
      <button type="button" onClick={() => ws.closeOtherTabs('files')}>close-others-on-files</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('useWorkSurfaceTabs (host integration)', () => {
  it('opens core and pack surfaces through one tab model', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('surfaces').textContent).toContain('pack:bio:lab'));
    expect(screen.getByTestId('active').textContent).toBe('home');

    fireEvent.click(screen.getByRole('button', { name: 'open-pack' }));
    expect(screen.getByTestId('active').textContent).toBe('pack:bio:lab');
    expect(screen.getByTestId('tabs').textContent).toBe('home,pack:bio:lab');

    fireEvent.click(screen.getByRole('button', { name: 'open-files' }));
    expect(screen.getByTestId('tabs').textContent).toBe('home,pack:bio:lab,files');

    fireEvent.click(screen.getByRole('button', { name: 'close-pack' }));
    expect(screen.getByTestId('tabs').textContent).toBe('home,files');
    expect(screen.getByTestId('active').textContent).toBe('files');
  });

  it('keeps non-closable home and applies close-others', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('surfaces').textContent).toContain('pack:bio:lab'));
    fireEvent.click(screen.getByRole('button', { name: 'open-pack' }));
    fireEvent.click(screen.getByRole('button', { name: 'open-files' }));
    fireEvent.click(screen.getByRole('button', { name: 'close-others-on-files' }));
    expect(screen.getByTestId('tabs').textContent).toBe('home,files');
  });

  it('restores known tabs and drops unknown pack surfaces', async () => {
    window.localStorage.setItem('petri.workSurfaceTabs.v1.project-1', JSON.stringify({
      version: 1,
      tabs: [
        { id: 'files', surfaceId: 'files' },
        { id: 'pack:missing:gone', surfaceId: 'pack:missing:gone' },
        { id: 'pack:bio:lab', surfaceId: 'pack:bio:lab' },
      ],
      activeId: 'pack:missing:gone',
    }));
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('tabs').textContent).toBe('home,files,pack:bio:lab'));
    expect(screen.getByTestId('active').textContent).toBe('pack:bio:lab');
  });
});
