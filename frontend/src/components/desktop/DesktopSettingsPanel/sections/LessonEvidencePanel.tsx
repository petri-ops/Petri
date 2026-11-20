import React, { useEffect, useState } from 'react';
import styles from './LessonEvidencePanel.module.css';

type Lesson = {
  id: number;
  source_fingerprint: string;
  title: string;
  scope: string;
  status: string;
  confidence: number;
  occurrences_before: number;
  occurrences_after: number;
  created_at: string;
  last_seen_at: string;
};

type Payload = {
  ok: boolean;
  lessons?: Lesson[];
  incidentTrend?: Array<{ day: string; count: number }>;
  reason?: 'db-not-found';
  error?: string;
};

/** 只读证据快照：本机 lessons/incidents 汇总，无写入、无外发、无观感代签徽标。 */
export function LessonEvidencePanel(): React.ReactElement | null {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    // setState 发生在异步回调（外部 IPC 读取完成）而非 effect 体内同步调用——
    // 符合 react-hooks/set-state-in-effect 对「订阅外部系统、回调里更新」的允许形态。
    let active = true;
    const read = window.petriDesktop?.data?.lessonEvidence;
    if (!read) return;
    read().then(
      (result) => { if (active && result && typeof result === 'object') setData(result); },
      (err) => { if (active) setData({ ok: false, error: String(err) }); }
    );
    return () => { active = false; };
  }, []);

  if (!window.petriDesktop?.data?.lessonEvidence) return null;

  const trend = data?.incidentTrend ?? [];
  const peak = Math.max(1, ...trend.map((p) => p.count));
  const lessons = data?.lessons ?? [];

  return (
    <div className={styles.panel} data-testid="lesson-evidence-panel" role="note">
      <p className={styles.hint}>只读证据快照：本机 lessons/incidents 汇总，无写入、无外发。</p>

      {!data && <p className={styles.hint}>读取中…</p>}
      {data && !data.ok && <p className={styles.error}>读取失败：{data.error ?? '未知错误'}</p>}
      {data?.ok && data.reason === 'db-not-found' && (
        <p className={styles.hint}>本地数据库尚不存在，暂无证据曲线。</p>
      )}

      {trend.length > 0 && (
        <div className={styles.curve} data-testid="lesson-evidence-curve">
          {trend.map((p) => (
            <div
              key={p.day}
              className={styles.bar}
              title={`${p.day}: ${p.count}`}
              style={{ height: `${Math.max(4, Math.round((p.count / peak) * 100))}%` }}
            />
          ))}
        </div>
      )}

      {lessons.map((l) => (
        <div key={l.id} className={styles.row}>
          <span className={styles.title} title={l.source_fingerprint}>{l.title}</span>
          <span className={styles.status} data-testid={`lesson-status-${l.id}`}>
            {l.status} · {l.occurrences_before}→{l.occurrences_after}
          </span>
        </div>
      ))}
      {data?.ok && lessons.length === 0 && trend.length === 0 && !data.reason && (
        <p className={styles.hint}>暂无 lesson / incident 记录。</p>
      )}
    </div>
  );
}
