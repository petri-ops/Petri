import React from 'react';

/**
 * BLOCK-334 D3 — 原右栏 Inspector 的「技术详情」折进导航器次级动作区（渐进披露不变）。
 * 取值全部由壳传入，不自行取数。
 */
export function ResultTechnicalDetails({
  jobId,
  toolId,
  familyId,
  revisionId,
  entityType,
  idField,
  selectionId,
}: {
  jobId: string;
  toolId: string | null | undefined;
  familyId: string | null | undefined;
  revisionId: string | null | undefined;
  entityType: string | null | undefined;
  idField: string | null | undefined;
  selectionId: string | null | undefined;
}): React.ReactElement {
  return (
    <details data-testid="result-technical-details">
      <summary>技术详情</summary>
      <dl>
        <dt>Job</dt><dd>{jobId}</dd>
        <dt>来源工具</dt><dd>{toolId || '未知工具'}</dd>
        <dt>Family</dt><dd>{familyId || '未建立'}</dd>
        <dt>Revision</dt><dd>{revisionId || '未建立'}</dd>
        <dt>实体</dt><dd>{entityType || '未声明'}</dd>
        <dt>ID 字段</dt><dd>{idField || '未声明'}</dd>
        <dt>Selection</dt><dd>{selectionId || '未选择'}</dd>
      </dl>
    </details>
  );
}
