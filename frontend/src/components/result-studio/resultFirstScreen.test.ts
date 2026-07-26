import { describe, expect, it } from 'vitest';
import { shouldShowDeliveryCard } from './resultFirstScreen';

describe('shouldShowDeliveryCard', () => {
  it('hides the card when there is nothing to generate and nothing generated', () => {
    // The state that made this worth changing: the card rendered anyway, with a
    // disabled 生成 button and copy explaining the feature was not yet usable —
    // directly above the result the user opened.
    expect(shouldShowDeliveryCard({ reportArtifact: null, finalReportUrl: null })).toBe(false);
    expect(shouldShowDeliveryCard({})).toBe(false);
  });

  it('shows the card when a report can be generated', () => {
    expect(shouldShowDeliveryCard({ reportArtifact: { name: 'report.html' } })).toBe(true);
  });

  it('shows the card when a report already exists, even without the source artifact', () => {
    // 查看 and 导出 are driven by finalReportUrl alone, so a generated report
    // stays reachable if its source artifact is no longer listed.
    expect(shouldShowDeliveryCard({ reportArtifact: null, finalReportUrl: '/x/final-report.html' }))
      .toBe(true);
  });

  it('treats an empty url as nothing generated', () => {
    expect(shouldShowDeliveryCard({ reportArtifact: null, finalReportUrl: '' })).toBe(false);
  });
});
