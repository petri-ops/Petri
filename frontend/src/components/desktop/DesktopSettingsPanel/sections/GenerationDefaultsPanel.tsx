import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

/**
 * GenerationDefaultsPanel — 生成意图覆盖档（试用反馈③深化，owner msg_b9d146535752）。
 *
 * 用户选意图（精准/平衡/创作/长文）而非裸 temperature/max_tokens 滑杆；
 * 写 ai-settings.json `generation.intentPreset`（策展四档，oneOf 注册）。
 * 未设置=自动档：loop 按任务意图本地规则选预设（判定失败落平衡）。
 */
interface GenerationDefaults {
  temperature?: number;
  maxTokens?: number;
  intentPreset?: string;
}
const PRESET_OPTIONS = [
  { value: '', label: '自动（按任务意图）' },
  { value: 'precise', label: '精准（0.2）' },
  { value: 'balanced', label: '平衡（0.4）' },
  { value: 'creative', label: '创作（0.8）' },
  { value: 'longform', label: '长文（预算自适应）' },
];
function legacyToPreset(g: GenerationDefaults): string {
  if (g.intentPreset) return g.intentPreset;
  if (typeof g.temperature === 'number') {
    if (g.temperature <= 0.3) return 'precise';
    if (g.temperature >= 0.7) return 'creative';
    return 'balanced';
  }
  return '';
}

export function GenerationDefaultsPanel(): React.ReactElement {
  const [preset, setPreset] = useState<string>('');
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
          setPreset(legacyToPreset(data.generation || {}));
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
      const token = getToken();
      const response = await fetch(`${getPlatformApiPrefix()}/ai/generation-defaults`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ intentPreset: preset || null }),
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
  }, [preset]);

  return (
    <div className="petri-generation-defaults" data-testid="generation-defaults">
      <div className="petri-settings-section__heading">
        <h3>生成参数（全局缺省）</h3>
        <p>选意图不选参数；自动档按任务意图本地判定（失败落平衡 0.4）。</p>
      </div>
      {loaded ? (
        <div className="petri-generation-defaults__fields">
          <label className="petri-generation-defaults__field">
            <span>生成意图（用户选意图，不选参数）</span>
            <select
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
              data-testid="generation-intent-preset"
            >
              {PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="petri-generation-defaults__save"
            disabled={busy}
            data-testid="generation-save"
            onClick={() => void save()}
          >
            保存生成意图
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
