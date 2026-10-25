/**
 * CrashNoticeBanner — BLOCK-228 Q9 K2 异常退出提示。
 *
 * 启动时向主进程查询上次是否干净退出；异常时显示一条可关闭横幅：
 * 时间 + 转储文件名（只读文件级证据，不解析栈、不上传）。
 * `userPrefs.crashNotice === false` 时完全不渲染。
 */

import React, { useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface CrashStatus {
  uncleanExit?: boolean;
  previousStartedAt?: string | null;
  dumps?: Array<{ name: string; size: number; mtime: string }>;
}

interface CrashDumpSummary {
  ok: boolean;
  name?: string;
  modules?: Array<{ name: string; size: number }>;
  exception?: { threadId: number; code: string; address: string | null } | null;
  system?: { arch: string; processors: number; osVersion: string } | null;
  processId?: number | null;
  error?: string;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `（${date.toLocaleString()}）`;
}

export function CrashNoticeBanner(): React.ReactElement | null {
  const [status, setStatus] = useState<CrashStatus | null>(null);
  const [summary, setSummary] = useState<CrashDumpSummary | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bridge = getBridge('diagnostic');
        const result = await bridge?.crashStatus?.();
        if (cancelled || !result?.ok || !result.uncleanExit) return;
        const response = await fetch(`${getPlatformApiPrefix()}/user/prefs`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (response.ok) {
          const body: unknown = await response.json();
          const prefs = body && typeof body === 'object'
            ? (body as Record<string, unknown>).prefs
            : null;
          if (prefs && typeof prefs === 'object' && (prefs as Record<string, unknown>).crashNotice === false) {
            return;
          }
        }
        if (!cancelled) setStatus(result);
        if (result.dumps?.[0]?.name) {
          const parsed = await bridge?.crashDumpSummary?.(result.dumps[0].name);
          if (!cancelled && parsed) setSummary(parsed);
        }
      } catch {
        // 查询失败=不打扰。
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!status || dismissed) return null;
  const dump = status.dumps?.[0];
  const summaryText = summary
    ? summary.ok
      ? `${summary.modules?.length || 0} 个模块${summary.system ? ` · ${summary.system.arch} ${summary.system.osVersion}` : ''}${summary.exception ? ` · 异常 ${summary.exception.code}` : ''}`
      : `摘要不可用（${summary.error || 'unknown'}）`
    : null;

  return (
    <div
      role="status"
      data-testid="crash-notice"
      style={{
        position: 'fixed',
        top: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '8px 12px',
        border: '1px solid var(--petri-border-card)',
        borderRadius: 'var(--petri-radius-md)',
        background: 'var(--petri-bg-elevated)',
        color: 'var(--petri-text-secondary)',
        fontSize: 12,
        boxShadow: '0 8px 24px color-mix(in srgb, var(--petri-bg-canvas) 50%, transparent)',
      }}
    >
      <span>
        上次运行未正常结束{formatTime(status.previousStartedAt)}。本地记录，未上传。
        {dump ? ` 转储：${dump.name}` : ''}
        {summaryText ? `（${summaryText}）` : ''}
      </span>
      {summary?.ok && (
        <button
          type="button"
          data-testid="crash-notice-details-toggle"
          onClick={() => setDetailsOpen((open) => !open)}
          style={{ background: 'transparent', border: 'none', color: 'var(--petri-accent)', cursor: 'pointer', fontSize: 12 }}
        >
          {detailsOpen ? '收起详情' : '详情'}
        </button>
      )}
      {detailsOpen && summary?.ok && (
        <div data-testid="crash-notice-details" style={{ flexBasis: '100%', color: 'var(--petri-text-tertiary)', fontSize: 11 }}>
          {summary.processId ? `进程 ${summary.processId} · ` : ''}
          {summary.exception ? `线程 ${summary.exception.threadId} 异常 ${summary.exception.code}${summary.exception.address ? ` @ ${summary.exception.address}` : ''} · ` : ''}
          模块：{(summary.modules || []).slice(0, 5).map((module) => module.name).join('、') || '未记录'}
        </div>
      )}
      {dump && (
        <button
          type="button"
          onClick={() => { void getBridge('diagnostic')?.crashOpenDumps?.(); }}
          style={{ background: 'transparent', border: 'none', color: 'var(--petri-accent)', cursor: 'pointer', fontSize: 12 }}
        >
          打开崩溃目录
        </button>
      )}
      <button
        type="button"
        data-testid="crash-notice-dismiss"
        onClick={() => setDismissed(true)}
        style={{ background: 'transparent', border: 'none', color: 'var(--petri-text-tertiary)', cursor: 'pointer', fontSize: 12 }}
      >
        知道了
      </button>
    </div>
  );
}
