// ============================================================
// ActResult card — shown when the AI auto-executes a write op.
// Provides a 5-second undo window with countdown.
// ============================================================

import { errMsg } from '@/lib/error';
import React, { useEffect, useState } from 'react';
import { getApiPrefix } from './copilotClient';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

const ACT_LABELS: Record<string, string> = {
  start_analysis: '🧬 已发起分析',
  recluster: '🔄 已发起重聚类',
  rename_project: '✏ 已重命名项目',
  rename_dataset: '✏ 已重命名数据集',
  rename_analysis: '✏ 已重命名分析',
  update_analysis_params: '🔧 已更新参数',
};

export interface ActExecution {
  actType: string;
  message?: string;
  undoToken?: string;
  undoableUntil?: number;
  error?: string;
  analysisId?: string;
}

export function ActResultCard({ act }: { act: ActExecution }) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!act.undoableUntil) return 0;
    return Math.max(0, Math.ceil((act.undoableUntil - Date.now()) / 1000));
  });
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  useEffect(() => {
    if (!act.undoableUntil || undone) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((act.undoableUntil! - Date.now()) / 1000));
      setSecondsLeft(s);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [act.undoableUntil, undone]);

  const onUndo = async () => {
    if (!act.undoToken || undoing) return;
    setUndoing(true);
    setUndoErr(null);
    try {
      const resp = await fetch(
        getApiPrefix() + '/ai/agent-undo/' + encodeURIComponent(act.undoToken),
        {
          method: 'POST',
          headers: getAuthHeader(),
        }
      );
      const data = await resp.json();
      if (data.ok) {
        setUndone(true);
      } else {
        setUndoErr(data.message || data.error || '撤销失败');
      }
    } catch (e: unknown) {
      setUndoErr(errMsg(e) || '请求失败');
    }
    setUndoing(false);
  };

  // Failure state
  if (act.error) {
    return (
      <div className="cp-actres cp-actres-error">
        <div className="cp-actres-head">
          <span className="cp-actres-icon">⚠</span>
          <span className="cp-actres-label">操作失败</span>
        </div>
        <div className="cp-actres-msg">{act.error}</div>
      </div>
    );
  }

  const label = ACT_LABELS[act.actType] || '✓ 已自动执行';
  return (
    <div className={`cp-actres ${undone ? 'cp-actres-undone' : ''}`}>
      <div className="cp-actres-head">
        <span className="cp-actres-icon">⚡</span>
        <span className="cp-actres-label">{undone ? '已撤销' : label}</span>
        {!undone && act.undoToken && secondsLeft > 0 && (
          <button className="cp-actres-undo" onClick={onUndo} disabled={undoing}>
            {undoing ? '撤销中…' : `撤销 (${secondsLeft}s)`}
          </button>
        )}
      </div>
      {act.message && !undone && <div className="cp-actres-msg">{act.message}</div>}
      {undoErr && <div className="cp-actres-err">{undoErr}</div>}
    </div>
  );
}
