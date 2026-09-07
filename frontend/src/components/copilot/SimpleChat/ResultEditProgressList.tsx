// ============================================================
// ResultEditProgressList — 结果修改五阶段进度条
//
// UI-305 P0.1 从 SimpleChat.tsx 尾部整簇平移（原 2152-2175 行），零行为变化。
// 主文件按既有惯例 re-export，保持 `from './SimpleChat'` 导入路径可用
// （SimpleChat.progress.test.ts 依赖）。
// ============================================================
import React from 'react';
import type { ResultEditProgressEvent } from '../copilotClient';

export function ResultEditProgressList({
  events,
}: {
  events: ResultEditProgressEvent[];
}): React.ReactElement {
  const phases = new Map<string, { label: string; status: string }>();
  for (const event of events) {
    if (!event.publicPhase || !event.publicPhaseLabel) continue;
    phases.set(event.publicPhase, { label: event.publicPhaseLabel, status: event.status });
  }
  const terminal = [...events].reverse().find((event) => event.status === 'terminal');
  return (
    <div className="sc-result-edit-progress" aria-label="结果修改五阶段进度">
      {[...phases.entries()].map(([phase, item]) => (
        <span key={phase} data-status={item.status}>
          {item.label}
        </span>
      ))}
      {terminal && (
        <strong>{terminal.stage === 'cancelled' ? '修改已停止' : '修改未完成'}</strong>
      )}
    </div>
  );
}
