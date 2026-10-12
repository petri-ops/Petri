import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

/**
 * GenerationDefaultsPanel — 生成参数全局缺省（BLOCK-172 CP-7）。
 *
 * temperature/max_tokens 进 ai-settings.json `generation` 键（env
 * PETRI_LLM_TEMPERATURE/PETRI_LLM_MAX_TOKENS 覆盖优先，UI 如实提示）；
 * 消费方=agent loop reqBody 与预算 headroom。未保存=loop 侧既有 0.4/16384。
 */
interface GenerationDefaults {
  temperature?: number;
  maxTokens?: number;
}

export function GenerationDefaultsPanel(): React.ReactElement {
  const [temperature, setTemperature] = useState<string>('');
  const [maxTokens, setMaxTokens] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const token = getToken();
        const response = await fetch(`${getPlatformApiPrefix()}/ai/generation-defaults`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = (await response.json().catch(() => ({}))) as { status?: string; generation?: GenerationDefaults };
        if (!cancelled && response.ok && data.status === 'ok') {
          const generation = data.generation || {};
          setTemperature(typeof generation.temperature === 'number' ? String(generation.temperature) : '');
          setMaxTokens(typeof generation.maxTokens === 'number' ? String(generation.maxTokens) : '');
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setNotice('加载失败');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const parsedTemperature = temperature.trim() === '' ? undefined : Number(temperature);
      const parsedMaxTokens = maxTokens.trim() === '' ? undefined : Number(maxTokens);
      if (parsedTemperature !== undefined && (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2)) {
        setNotice('temperature 需在 0–2 之间');
        return;
      }
      if (parsedMaxTokens !== undefined && (!Number.isFinite(parsedMaxTokens) || parsedMaxTokens < 256)) {
        setNotice('max_tokens 需 ≥256');
        return;
      }
      const token = getToken();
      const response = await fetch(`${getPlatformApiPrefix()}/ai/generation-defaults`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...(parsedTemperature !== undefined ? { temperature: parsedTemperature } : {}),
          ...(parsedMaxTokens !== undefined ? { maxTokens: parsedMaxTokens } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
      if (response.ok && data.status === 'ok') {
        setNotice('已保存（新任务生效）');
      } else {
        setNotice('保存失败：' + (data.error || `HTTP ${response.status}`));
      }
    } catch (e) {
      setNotice('保存失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [maxTokens, temperature]);

  return (
    <div className="petri-generation-defaults" data-testid="generation-defaults">
      <div className="petri-settings-section__heading">
        <h3>生成参数（全局缺省）</h3>
        <p>Agent 循环请求体的 temperature 与 max_tokens；留空=内置缺省（0.4 / 16384）。env PETRI_LLM_TEMPERATURE / PETRI_LLM_MAX_TOKENS 覆盖优先。</p>
      </div>
      {loaded ? (
        <div className="petri-generation-defaults__fields">
          <label className="petri-generation-defaults__field">
            <span>temperature（0–2）</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              placeholder="0.4"
              data-testid="generation-temperature"
            />
          </label>
          <label className="petri-generation-defaults__field">
            <span>max_tokens（≥256）</span>
            <input
              type="number"
              step="256"
              min="256"
              value={maxTokens}
              onChange={(event) => setMaxTokens(event.target.value)}
              placeholder="16384"
              data-testid="generation-max-tokens"
            />
          </label>
          <button
            type="button"
            className="petri-generation-defaults__save"
            disabled={busy}
            data-testid="generation-save"
            onClick={() => void save()}
          >
            保存生成参数
          </button>
          {notice && (
            <span className="petri-generation-defaults__notice" role="status">{notice}</span>
          )}
        </div>
      ) : (
        <p className="petri-generation-defaults__notice">加载中…</p>
      )}
    </div>
  );
}
