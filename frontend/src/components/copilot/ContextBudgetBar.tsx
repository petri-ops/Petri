import React, { useState, useRef, useEffect } from 'react';

export interface TokenBudget {
  contextWindow: number;
  messagesTokensUsed: number;
  messagesKept: number;
  messagesDropped: number;
  pct: number;
  trimmed: boolean;
  categories?: {
    systemInstructions: number;
    messages: number;
    tools: number;
    other: number;
  };
}

interface ContextBudgetButtonProps {
  budget: TokenBudget | null | undefined;
  /** Cached context window from the last active run — used in idle to show a meaningful ring. */
  activeContextWindow?: number;
}

function barColor(pct: number): string {
  if (pct < 60) return '#22c55e';
  if (pct < 80) return '#f59e0b';
  return '#ef4444';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

const RING_SIZE = 24;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** SVG ring — `pct` is 0–100, `color` is the stroke. */
function Ring({ pct, color }: { pct: number; color: string }) {
  const dashoffset = CIRCUMFERENCE * (1 - pct / 100);
  return (
    <svg width={RING_SIZE} height={RING_SIZE} style={{ display: 'block', flexShrink: 0 }}>
      {/* Track */}
      <circle
        cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={RING_STROKE}
      />
      {/* Progress */}
      <circle
        cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={dashoffset}
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        style={{ transition: 'stroke-dashoffset 0.35s ease' }}
      />
    </svg>
  );
}

/** Idle ring — always at 0% but shows the configured context window size. */
function IdleRing({ contextWindow }: { contextWindow: number }) {
  const color = '#9ca3af';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
      <Ring pct={0} color={color} />
      <span style={{ fontSize: '10px', color, fontFamily: 'monospace', fontWeight: 600, lineHeight: 1 }}>
        {formatTokens(contextWindow)}
      </span>
    </div>
  );
}

export function ContextBudgetButton({ budget, activeContextWindow }: ContextBudgetButtonProps) {
  const [open, setOpen] = useState(false);
  const [lastBudget, setLastBudget] = useState<TokenBudget | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // 缓存最近一次 budget，待机时显示
  useEffect(() => {
    if (budget) {
      setLastBudget(budget);
    }
  }, [budget]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 优先显示实时 budget，待机时使用缓存的 lastBudget
  const displayBudget = budget ?? lastBudget;
  const hasData = !!displayBudget;
  const isIdle = !budget; // 待机状态

  const active = hasData;
  const pct = displayBudget?.pct ?? 0;
  const trimmed = displayBudget?.trimmed ?? false;
  const color = active ? barColor(pct) : '#9ca3af';
  const contextWindow = displayBudget?.contextWindow ?? activeContextWindow ?? 0;
  const messageBudget = contextWindow > 0 ? contextWindow - 8192 : 0;

  // Content: ring only (no label)
  const buttonContent = hasData ? (
    <Ring pct={pct} color={color} />
  ) : contextWindow > 0 ? (
    <Ring pct={0} color="#9ca3af" />
  ) : (
    <span style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'monospace' }}>—</span>
  );

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="上下文用量（点击查看详情）"
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '999px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--biof3-bg-subtle, rgba(0,0,0,0.04))';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {buttonContent}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: '6px',
            background: 'var(--color-bg-elevated, #fff)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '10px',
            padding: '10px 12px',
            fontSize: '12px',
            color: 'var(--color-text-primary, #111827)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            whiteSpace: 'nowrap',
            zIndex: 200,
            minWidth: '240px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: 600, fontSize: '12px' }}>上下文用量</span>
            <span style={{ fontSize: '11px', color, fontWeight: 600 }}>
              {hasData ? `${pct}%` : '待机'}
              {isIdle && lastBudget && <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary, #9ca3af)', fontWeight: 400 }}> · 上次</span>}
            </span>
          </div>

          <div style={{ height: '4px', background: '#e5e7eb', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              width: hasData ? `${Math.min(pct, 100)}%` : '0%',
              height: '100%',
              background: color,
              borderRadius: '2px',
              transition: 'width 0.3s ease',
            }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--color-text-secondary, #6b7280)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>消息 tokens</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>
                {hasData ? `${formatTokens(displayBudget!.messagesTokensUsed)}${messageBudget > 0 ? ` / ${formatTokens(messageBudget)}` : ''}` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>上下文窗口</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>
                {contextWindow > 0 ? formatTokens(contextWindow) : '—'}
              </span>
            </div>
            {contextWindow === 0 && (
              <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary, #9ca3af)', marginTop: '2px' }}>
                模型上下文窗口未知，可在设置中配置
              </div>
            )}
            {hasData ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>保留消息</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>
                    {displayBudget!.messagesKept} 条
                  </span>
                </div>
                {displayBudget!.messagesDropped > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color }}>
                    <span>已压缩</span>
                    <span style={{ fontFamily: 'monospace' }}>{displayBudget!.messagesDropped} 条</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>状态</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>待机</span>
              </div>
            )}
          </div>

          {displayBudget?.categories && (
            <div style={{ marginTop: '8px', borderTop: '1px solid var(--color-border, #e5e7eb)', paddingTop: '8px' }}>
              <div style={{ fontWeight: 600, fontSize: '11px', marginBottom: '6px', color: 'var(--color-text-secondary, #6b7280)' }}>
                用量分布（占上下文窗口）
              </div>
              {([
                { key: 'systemInstructions' as const, label: '系统指令', color: '#8b5cf6' },
                { key: 'messages' as const, label: '消息内容', color: '#3b82f6' },
                { key: 'tools' as const, label: '工具调用', color: '#22c55e' },
                { key: 'other' as const, label: '其他', color: '#9ca3af' },
              ]).map(({ key, label, color }) => {
                const catValue = displayBudget!.categories![key];
                const catPct = contextWindow > 0 ? (catValue / contextWindow) * 100 : 0;
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ width: '60px', fontSize: '10px', color: 'var(--color-text-secondary, #6b7280)', flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: '4px', background: '#e5e7eb', borderRadius: '2px' }}>
                      <div style={{
                        width: `${Math.min(catPct, 100)}%`,
                        height: '100%',
                        background: color,
                        borderRadius: '2px',
                      }} />
                    </div>
                    <span style={{ width: '45px', fontSize: '10px', fontFamily: 'monospace', textAlign: 'right', color: 'var(--color-text-primary)', flexShrink: 0 }}>
                      {formatTokens(catValue)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
