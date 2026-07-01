// ============================================================
// AI interpretation card — shown at top of analysis results
// ============================================================

import React, { useState, useEffect } from 'react';
import { interpretAnalysis, type InterpretResult } from './_aiClient';

interface Props {
  analysisType: string;
  summary: Record<string, unknown>;
  /** Top markers per cluster (from result.markers if available) */
  topMarkers?: Record<string, string[]>;
}

export function AICard({ analysisType, summary, topMarkers }: Props) {
  const [result, setResult] = useState<InterpretResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!analysisType || !summary) return;
    setLoading(true);
    interpretAnalysis({ analysisType, summary, topMarkers })
      .then((r) => {
        setResult(r);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisType, JSON.stringify(summary), JSON.stringify(topMarkers)]);

  if (loading) {
    return (
      <div className="sc-ai-card">
        <div className="sc-ai-card-header">
          <span className="sc-ai-card-icon">🤖</span>
          <span className="sc-ai-card-title">AI 正在解读...</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="sc-ai-card">
      <div
        className="sc-ai-card-header"
        onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer' }}
      >
        <span className="sc-ai-card-icon">🤖</span>
        <span className="sc-ai-card-title">AI 解读</span>
        <span className="sc-ai-card-source">
          {result.source === 'deepseek' ? '· DeepSeek' : '· 本地推断'}
        </span>
        <span className="sc-ai-card-toggle">{collapsed ? '▾' : '▴'}</span>
      </div>
      {!collapsed && (
        <div className="sc-ai-card-body">
          <div className="sc-ai-card-text">
            {result.interpretation.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          {result.cellTypeHints && Object.keys(result.cellTypeHints).length > 0 && (
            <div className="sc-ai-card-hints">
              <div className="sc-ai-card-hints-title">细胞类型快速推断</div>
              <div className="sc-ai-card-hints-grid">
                {Object.entries(result.cellTypeHints).map(([cluster, type]) => (
                  <div key={cluster} className="sc-ai-card-hint">
                    <span className="sc-ai-card-hint-cluster">C{cluster}</span>
                    <span className="sc-ai-card-hint-type">{type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
