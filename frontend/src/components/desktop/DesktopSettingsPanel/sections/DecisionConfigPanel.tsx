// ============================================================
// DesktopSettingsPanel — Decision config panel section (BLOCK-116 P4)
//
// 决策原语配置面：五个运行时接点的启用开关与阈值（校准默认预填、可调整、
// 一键还原）。数据源=GET/PUT /ai/decisions/config（decision-config.json 持久化，
// env='0' 杀开关永远最高）。口径诚实：偏离校准默认值时显式标记；决策台账
// （decision_log）逐条记录实际生效阈值，可审计。
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface PointConfig {
  point: string;
  label: string;
  enabled: boolean;
  envOverride: 'on' | 'off' | null;
  threshold: number | null;
  defaultThreshold: number | null;
  gates: Record<string, number> | null;
  evidence: string | null;
  enabledDefault: boolean;
}

interface ConfigResponse {
  status: string;
  points?: PointConfig[];
  error?: string;
}

const POINT_NOTES: Record<string, string> = {
  'topic-shift': '多轮对话偏离原话题时提示「话题已切换」。默认启用。',
  'knowledge-guard': '知识库检索结果的语义相关性与注入拦截。需知识空间已启用。',
  'marker-celltype': '单细胞 cluster 的 marker→细胞类型提示附置信度。需项目打开。',
  'intent-route': '闲聊消息走轻量直答，不启动完整 agent 循环。',
  'tool-route': '按任务语义只下发相关工具域，降低 token 与误选率。',
};

export function DecisionConfigPanel(): React.ReactElement {
  const [points, setPoints] = useState<PointConfig[] | null>(null);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = getToken();
      const response = await fetch(`${getPlatformApiPrefix()}/ai/decisions/config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data: ConfigResponse = await response.json();
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '配置不可用');
      setPoints(Array.isArray(data.points) ? data.points : []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback(async (point: string, body: Record<string, unknown>) => {
    const token = getToken();
    const response = await fetch(`${getPlatformApiPrefix()}/ai/decisions/config/${encodeURIComponent(point)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const data: ConfigResponse & { point?: PointConfig } = await response.json();
    if (!response.ok || data?.status !== 'ok' || !data.point) throw new Error(data?.error || '保存失败');
    setPoints((prev) => (prev || []).map((p) => (p.point === point ? { ...p, ...data.point! } : p)));
    setSavedAt(new Date().toLocaleTimeString());
  }, []);

  return (
    <div className="gewu-usage-resource">
      <p className="gewu-field__hint">
        决策原语=「该用规则还是问模型」的判断接点：全部默认关闭或保守值（校准证据预填），
        可在此启用与微调；每次调用都会记录实际生效阈值（决策台账可审计）。
        环境变量 BIOF3_JEV_*（=0）仍是最高级紧急开关。
      </p>
      {error && <p className="gewu-field__hint" role="alert">{error}</p>}
      {!points && !error ? <p className="gewu-field__hint">读取中…</p> : null}
      {points?.map((p) => {
        const drifted = p.threshold != null && p.defaultThreshold != null && p.threshold !== p.defaultThreshold;
        return (
          <div key={p.point} className="gewu-resource-heading" style={{ alignItems: 'flex-start' }}>
            <div>
              <strong>{p.label}</strong>
              <p>{POINT_NOTES[p.point] || ''}</p>
              {p.gates ? (
                <p className="gewu-field__hint">
                  双门限（只读）：{Object.entries(p.gates).map(([k, v]) => `${k}=${v}`).join(' · ')}
                </p>
              ) : null}
              {p.envOverride ? (
                <p className="gewu-field__hint">环境变量覆盖中：{p.envOverride === 'off' ? '强制关闭（杀开关）' : '强制启用'}</p>
              ) : null}
              {drifted ? (
                <p className="gewu-field__hint">已偏离校准默认值 {p.defaultThreshold}——建议重校准后再调整。</p>
              ) : null}
            </div>
            <div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => void patch(p.point, { enabled: e.target.checked }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
                />
                启用
              </label>
              {p.threshold != null ? (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                  阈值
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={p.threshold}
                    style={{ width: 72 }}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isFinite(value) && value >= 0 && value <= 1) {
                        void patch(p.point, { threshold: value }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
                      }
                    }}
                  />
                  {p.defaultThreshold != null && p.threshold !== p.defaultThreshold ? (
                    <button
                      type="button"
                      className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                      onClick={() => void patch(p.point, { threshold: p.defaultThreshold! }).catch(() => {})}
                    >
                      还原 {p.defaultThreshold}
                    </button>
                  ) : null}
                </label>
              ) : null}
            </div>
          </div>
        );
      })}
      {savedAt ? <p className="gewu-field__hint">已保存（{savedAt}）。调整立即生效，无需重启。</p> : null}
    </div>
  );
}
