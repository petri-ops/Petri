import React from 'react';

/**
 * item88 第二波：工作台新 UI 的总闸。flag 关闭时渲染与 v1.0 逐字节等价的基线，
 * 不挂载任何第二波节点（HK-01 快照钉）。
 */
export function WorkbenchFlagGate({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  if (!enabled) return <div data-testid="wb-flag-gate" data-enabled="false">baseline</div>;
  return <div data-testid="wb-flag-gate" data-enabled="true">{children}</div>;
}
