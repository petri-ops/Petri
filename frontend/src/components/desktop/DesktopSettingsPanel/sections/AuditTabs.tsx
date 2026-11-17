import React, { useState } from 'react';

export interface AuditTabSpec {
  id: string;
  label: string;
  content: React.ReactNode;
}

export function AuditTabs({ tabs }: { tabs: AuditTabSpec[] }): React.ReactElement {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className="petri-audit-tabs" data-testid="audit-tabs">
      <div className="petri-audit-tabs__bar" role="tablist" aria-label="治理审计视图">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={current?.id === tab.id}
            className={`petri-btn petri-btn--ghost petri-btn--sm${current?.id === tab.id ? ' is-active' : ''}`}
            data-testid={`audit-tab-${tab.id}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current && (
        <div role="tabpanel" data-testid={`audit-panel-${current.id}`}>
          {current.content}
        </div>
      )}
    </div>
  );
}
