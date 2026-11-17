import React from 'react';

export function DiagnosticsFold({
  open = false,
  children,
}: {
  open?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details className="petri-settings-advanced-details" data-testid="diagnostics-fold" open={open}>
      <summary>诊断：本地服务状态、日志与系统终端（按需展开）</summary>
      {children}
    </details>
  );
}
