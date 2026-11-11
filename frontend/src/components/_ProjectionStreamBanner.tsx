import styles from './projection-stream-banner.module.css';

/**
 * _ProjectionStreamBanner — L3-7（蓝图 L-68）：全局失效通知流断线相位横幅。
 *
 * phase='connected' 不渲染；retrying/failed 呈现 role=status + aria-live=polite
 * 的可见轻提示（数据由消费方兜底轮询供给，时延可能上升——不阻塞主流程）。
 */
export function ProjectionStreamBanner({ phase }: { phase: 'connected' | 'retrying' | 'failed' | undefined }): React.ReactElement | null {
  if (!phase || phase === 'connected') return null;
  return (
    <div
      className={styles.banner}
      role="status"
      aria-live="polite"
      data-testid="invalidation-stream-banner"
      data-phase={phase}
    >
      {phase === 'retrying' ? '数据同步流重连中——列表可能短暂滞后，自动恢复。' : '数据同步流已断开——列表由兜底轮询供给（时延上升），可刷新重试。'}
    </div>
  );
}
