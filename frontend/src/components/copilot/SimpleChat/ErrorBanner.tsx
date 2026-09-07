// ============================================================
// ErrorBanner — 错误/警告横幅（可展开技术详情）
//
// UI-305 P0.1 从 SimpleChat.tsx 尾部整簇平移（原 2179-2209 行），零行为变化。
// ============================================================
import React, { useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import type { ErrorBannerProps } from './types';

export function ErrorBanner({ message, severity, showDetails, technicalDetails }: ErrorBannerProps): React.ReactElement {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const severityClass = `sc-error-${severity}`;
  const iconName: IconName = severity === 'error' ? 'alert-circle' : severity === 'warning' ? 'alert-triangle' : 'help-circle';

  return (
    <div className={`sc-error-banner ${severityClass}`} role="alert">
      <div className="sc-error-header">
        <Icon name={iconName} size={16} />
        <span className="sc-error-message">{message}</span>
      </div>
      {showDetails && technicalDetails && (
        <button
          type="button"
          className="sc-error-toggle"
          onClick={() => setDetailsExpanded((prev) => !prev)}
          aria-expanded={detailsExpanded}
        >
          {detailsExpanded ? '收起详情' : '查看详情'}
          <Icon name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
        </button>
      )}
      {showDetails && detailsExpanded && technicalDetails && (
        <details className="sc-error-details" open>
          <pre className="sc-error-details-content">{technicalDetails}</pre>
        </details>
      )}
    </div>
  );
}
