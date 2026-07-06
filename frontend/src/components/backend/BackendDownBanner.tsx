// M1-1 后端降级 banner — r-server 不通时顶部显示
// isReady=true 或 downReason 为空时不渲染。
// 「点此诊断」打开诊断日志导出（复用既有 diagnostic.export IPC）。
import React, { useState } from 'react';
import { useBackendStatus } from './BackendStatusProvider';

export function BackendDownBanner(): React.ReactElement | null {
  const status = useBackendStatus();
  const [dismissed, setDismissed] = useState(false);

  // 就绪或没原因时不显示
  if (status.isReady || !status.downReason) return null;
  // 用户手动关闭后，直到状态变化前不再显示（downReason 变化会重置 dismissed）
  if (dismissed) return null;

  const handleDiagnose = async () => {
    try {
      await window.biof3Desktop?.diagnostic?.export();
    } catch {
      // 忽略导出失败
    }
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '8px 16px',
        background: '#b91c1c',
        color: '#fff',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <span>⚠️ {status.downReason}</span>
      <button
        type="button"
        onClick={handleDiagnose}
        style={{
          background: 'rgba(255,255,255,0.18)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: '4px',
          color: '#fff',
          padding: '2px 10px',
          fontSize: '12px',
          cursor: 'pointer',
        }}
      >
        导出诊断
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="关闭"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
