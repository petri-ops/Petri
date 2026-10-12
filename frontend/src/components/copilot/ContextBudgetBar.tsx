import React, { useState, useRef, useEffect } from 'react';

export interface TokenBudget {
  contextWindow: number;
  messagesTokensUsed: number;
  messagesKept: number;
  messagesDropped: number;
  pct: number;
  trimmed: boolean;
  /** BLOCK-69 — 知识空间自动召回注入块的估算 token（无注入为 0/缺省） */
  knowledgeTokens?: number;
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

const RING_SIZE = 18;
const RING_STROKE = 2;
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
  const color = active ? barColor(pct) : '#9ca3af';
  const contextWindow = displayBudget?.contextWindow ?? activeContextWindow ?? 0;
  const messageBudget = contextWindow > 0 ? contextWindow - 8192 : 0;

  // Content: ring only (no label)
  // UI-400-5 — 初始/待机也渲染 0% 空环，不再显示「—」占位（用户裁决：哪怕初始状态也该有 0%）
  const buttonContent = hasData ? (
    <Ring pct={pct} color={color} />
  ) : (
    <Ring pct={0} color="#9ca3af" />
  );

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="上下文用量（点击查看详情）"
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '999px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          transition: 'background 0.15s ease',
          /* UI-215 补充：纯图标圆钮收敛 UA 默认字号到 token */
          fontSize: 'var(--petri-font-size-sm)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--petri-bg-subtle, rgba(0,0,0,0.04))';
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
            background: 'var(--petri-bg-elevated)',
            border: '1px solid var(--petri-border)',
            borderRadius: '10px',
            padding: '10px 12px',
            fontSize: 'var(--petri-font-size-sm)',
            color: 'var(--petri-text)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            whiteSpace: 'nowrap',
            zIndex: 200,
            minWidth: '240px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--petri-font-size-sm)' }}>上下文用量</span>
            <span style={{ fontSize: 'var(--petri-font-size-sm)', color, fontWeight: 600 }}>
              {hasData ? `${pct}%` : '待机'}
              {isIdle && lastBudget && <span style={{ fontSize: 'var(--petri-font-size-xs)', color: 'var(--petri-text-tertiary)', fontWeight: 400 }}> · 上次</span>}
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: 'var(--petri-font-size-sm)', color: 'var(--petri-text-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>消息 tokens</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--petri-text)' }}>
                {hasData ? `${formatTokens(displayBudget.messagesTokensUsed)}${messageBudget > 0 ? ` / ${formatTokens(messageBudget)}` : ''}` : '—'}
              </span>
            </div>
            {/* BLOCK-69 — 知识空间注入块预算透明 */}
            {(displayBudget?.knowledgeTokens ?? 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8b5cf6' }}>
                <span>知识空间</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--petri-text)' }}>
                  {formatTokens(displayBudget!.knowledgeTokens!)}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>上下文窗口</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--petri-text)' }}>
                {contextWindow > 0 ? formatTokens(contextWindow) : '—'}
              </span>
            </div>
            {contextWindow === 0 && (
              <div style={{ fontSize: 'var(--petri-font-size-xs)', color: 'var(--petri-text-tertiary)', marginTop: '2px' }}>
                模型上下文窗口未知，可在设置中配置
              </div>
            )}
            {hasData ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>保留消息</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--petri-text)' }}>
                    {displayBudget.messagesKept} 条
                  </span>
                </div>
                {displayBudget.messagesDropped > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color }}>
                    <span>已压缩</span>
                    <span style={{ fontFamily: 'monospace' }}>{displayBudget.messagesDropped} 条</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>状态</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--petri-text)' }}>待机</span>
              </div>
            )}
          </div>

          {displayBudget?.categories && (
            <div style={{ marginTop: '8px', borderTop: '1px solid var(--petri-border)', paddingTop: '8px' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--petri-font-size-sm)', marginBottom: '6px', color: 'var(--petri-text-secondary)' }}>
                用量分布（占上下文窗口）
              </div>
              {([
                { key: 'systemInstructions' as const, label: '系统指令', color: '#8b5cf6' },
                { key: 'messages' as const, label: '消息内容', color: '#3b82f6' },
                { key: 'tools' as const, label: '工具调用', color: '#22c55e' },
                { key: 'other' as const, label: '其他', color: '#9ca3af' },
              ]).map(({ key, label, color }) => {
                const catValue = displayBudget.categories![key];
                const catPct = contextWindow > 0 ? (catValue / contextWindow) * 100 : 0;
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ width: '60px', fontSize: 'var(--petri-font-size-xs)', color: 'var(--petri-text-secondary)', flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: '4px', background: '#e5e7eb', borderRadius: '2px' }}>
                      <div style={{
                        width: `${Math.min(catPct, 100)}%`,
                        height: '100%',
                        background: color,
                        borderRadius: '2px',
                      }} />
                    </div>
                    <span style={{ width: '45px', fontSize: 'var(--petri-font-size-xs)', fontFamily: 'monospace', textAlign: 'right', color: 'var(--petri-text)', flexShrink: 0 }}>
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
