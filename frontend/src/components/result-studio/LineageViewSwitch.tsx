/**
 * LineageViewSwitch — BLOCK-138 P1 血缘形态切换（plan D1：条带/画布并存）。
 *
 * 挂在 LineageStrip 原挂载点（ResultArtifactShell stateBlock，result 模式）：
 * 默认保持条带（零行为平迁），用户可切到 LineageGraph 只读 DAG。两种形态各自
 * 诚实自隐（无链/单节点链/端点失败均不渲染自身），切换器本身始终可见。
 */

import React from 'react';
import { LineageGraph } from './LineageGraph';
import { LineageStrip } from './LineageStrip';
import styles from './LineageViewSwitch.module.css';

type LineageViewMode = 'strip' | 'graph';

export function LineageViewSwitch({ projectId, jobId }: {
  projectId: string | null;
  jobId: string;
}): React.ReactElement {
  const [view, setView] = React.useState<LineageViewMode>('strip');

  return (
    <div className={styles.lineageView}>
      <div className={styles.switch} role="group" aria-label="血缘形态">
        <button
          type="button"
          className={`${styles.switchBtn} ${view === 'strip' ? styles.switchBtnActive : ''}`}
          aria-pressed={view === 'strip'}
          onClick={() => setView('strip')}
        >
          条带
        </button>
        <button
          type="button"
          className={`${styles.switchBtn} ${view === 'graph' ? styles.switchBtnActive : ''}`}
          aria-pressed={view === 'graph'}
          onClick={() => setView('graph')}
        >
          画布
        </button>
      </div>
      {view === 'strip'
        ? <LineageStrip projectId={projectId} jobId={jobId} />
        : <LineageGraph projectId={projectId} jobId={jobId} />}
    </div>
  );
}
