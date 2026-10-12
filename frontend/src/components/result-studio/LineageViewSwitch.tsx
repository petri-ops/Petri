/**
 * LineageViewSwitch — BLOCK-138 P1 血缘形态切换（plan D1：条带/画布并存）。
 *
 * 挂在 LineageStrip 原挂载点（ResultArtifactShell stateBlock，result 模式）：
 * 默认保持条带（零行为平迁），用户可切到 LineageGraph 只读 DAG。两种形态各自
 * 诚实自隐（无链/单节点链/端点失败均不渲染自身），切换器本身始终可见。
 *
 * BLOCK-140 R-1 — 空态切换器：切换器自取 /lineage（fetchResultLineage，D3：
 * 判空与 builder 真值同源）——lineage null 或 chain<2（单节点链）时整组不渲染
 * （无切换钮无形态），加载中同样渲染 null（防瞬态闪现）；取数失败按无图处理
 * （诚实，不猜）。chain≥2 维持现状渲染。子组件自隐保持双保险。
 */

import React from 'react';
import { fetchResultLineage } from './resultStudioClient';
import { LineageGraph } from './LineageGraph';
import { LineageStrip } from './LineageStrip';
import styles from './LineageViewSwitch.module.css';

type LineageViewMode = 'strip' | 'graph';

export function LineageViewSwitch({ projectId, jobId, onPinArtifact }: {
  projectId: string | null;
  jobId: string;
  /** BLOCK-140 P1 — 钉住次级动作透传（条带=悬停小钮 / 画布=右键）。 */
  onPinArtifact?: (request: { projectId: string | null; toolJobId: string }) => void;
}): React.ReactElement | null {
  const [view, setView] = React.useState<LineageViewMode>('strip');
  // R-1：只有确认链≥2 才亮组；加载中/无图/单节点链/取数失败一律 null。
  // 状态携带观察键：换 job/项目时键失配即同步隐藏（旧链不闪现），响应落地才复亮
  // ——避免在 effect 体内同步 setState（react-hooks/set-state-in-effect）。
  const observedKey = `${jobId}::${projectId ?? ''}`;
  // BLOCK-169 A4-2 — 三态化：ready（链≥2 亮组）/ empty（链<2）/ error（取数失败）；
  // empty/error 不再整组静默，给最低限度行内提示（键失配仍 null——旧链不闪现）。
  const [observation, setObservation] = React.useState<{ key: string; state: 'loading' | 'ready' | 'empty' | 'error' }>({
    key: observedKey,
    state: 'loading',
  });

  React.useEffect(() => {
    let cancelled = false;
    fetchResultLineage(jobId, projectId)
      .then((response) => {
        if (cancelled) return;
        setObservation({
          key: `${jobId}::${projectId ?? ''}`,
          state: Boolean(response.lineage && response.lineage.chain.length >= 2) ? 'ready' : 'empty',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setObservation({ key: `${jobId}::${projectId ?? ''}`, state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, projectId]);

  if (observation.key !== observedKey) return null;
  if (observation.state === 'empty' || observation.state === 'error') {
    return (
      <div className={styles.lineageView}>
        <div className={styles.emptyHint} role="status">
          {observation.state === 'error'
            ? '血缘取数失败，暂无可视血缘链'
            : '暂无可视血缘链（单节点任务无可展示的上下游）'}
        </div>
      </div>
    );
  }
  if (observation.state !== 'ready') return null;

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
        ? <LineageStrip projectId={projectId} jobId={jobId} onPinArtifact={onPinArtifact} />
        : <LineageGraph projectId={projectId} jobId={jobId} onPinArtifact={onPinArtifact} />}
    </div>
  );
}
