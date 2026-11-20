import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonEvidencePanel } from './LessonEvidencePanel';

const lessonEvidence = vi.fn();

beforeEach(() => {
  lessonEvidence.mockReset();
  Object.defineProperty(window, 'petriDesktop', {
    configurable: true,
    value: { data: { lessonEvidence } },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'petriDesktop');
  cleanup();
});

describe('LessonEvidencePanel', () => {
  it('只读渲染频率曲线与状态，不提供写操作', async () => {
    lessonEvidence.mockResolvedValue({
      ok: true,
      lessons: [{
        id: 1, source_fingerprint: 'fp', title: '工具名纠错', scope: 'auto',
        status: 'active', confidence: 0.8, occurrences_before: 1, occurrences_after: 5,
        created_at: '2026-01-01', last_seen_at: '2026-01-02',
      }],
      incidentTrend: [{ day: '2026-01-01', count: 3 }, { day: '2026-01-02', count: 7 }],
    });
    render(<LessonEvidencePanel />);
    await waitFor(() => expect(screen.getByTestId('lesson-evidence-curve')).toBeTruthy());
    expect(screen.getByTestId('lesson-status-1').textContent).toContain('active');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('失败不伪造曲线', async () => {
    lessonEvidence.mockResolvedValue({ ok: false, error: 'db busy' });
    render(<LessonEvidencePanel />);
    await waitFor(() => expect(screen.getByTestId('lesson-evidence-panel').textContent).toContain('db busy'));
    expect(screen.queryByTestId('lesson-evidence-curve')).toBeNull();
  });

  it('缺桥时静默不渲染', () => {
    Reflect.deleteProperty(window, 'petriDesktop');
    const { container } = render(<LessonEvidencePanel />);
    expect(container.firstChild).toBeNull();
    expect(lessonEvidence).not.toHaveBeenCalled();
  });

  it('db-not-found 如实呈现空态，无代签徽标', async () => {
    lessonEvidence.mockResolvedValue({ ok: true, reason: 'db-not-found', lessons: [], incidentTrend: [] });
    render(<LessonEvidencePanel />);
    await waitFor(() => expect(screen.getByTestId('lesson-evidence-panel').textContent).toContain('尚不存在'));
    expect(screen.queryByTestId('lesson-evidence-curve')).toBeNull();
  });
});
