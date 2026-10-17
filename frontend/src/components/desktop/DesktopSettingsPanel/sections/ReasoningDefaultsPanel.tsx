import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './SettingsQuickwins.module.css';

/**
 * ReasoningDefaultsPanel — 推理档位设置面（BLOCK-200 P0-5 / UI-515）。
 *
 * 此前档位默认值、Anthropic 预算与逐协议映射硬编码在 `thinking-level.js` 的 switch 里：
 * 想常驻高档或调预算只能改代码。本面把它们变成注册表声明的可编辑项，同时诚实显示
 * 「出厂值 vs 生效值」——映射表按协议给出**允许令牌**，跨协议错配由写侧拒（不是前端猜）。
 *
 * 边界：档位仍是**中性三档**，本面不出现任何供应商参数之外的语义承诺；未声明
 * `reasoning` 能力的渠道仍一律不发参（能力门在后端，本面只显示事实）。
 */

interface TierState { effective: string; default: string }
interface ReasoningSnapshot {
  levels: string[];
  effective: { defaultLevel: string; anthropicHighBudgetTokens: number };
  factory: { defaultLevel: string; anthropicHighBudgetTokens: number };
  protocols: Record<string, { allowed: string[]; tiers: Record<string, TierState> }>;
}
interface Diagnostic { path?: string; code?: string; message?: string }

export function ReasoningDefaultsPanel(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<ReasoningSnapshot | null>(null);
  const [defaultLevel, setDefaultLevel] = useState('standard');
  const [budget, setBudget] = useState('');
  const [mapping, setMapping] = useState<Record<string, Record<string, string | null>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [busy, setBusy] = useState(false);

  const applySnapshot = useCallback((next: ReasoningSnapshot): void => {
    setSnapshot(next);
    setDefaultLevel(next.effective.defaultLevel);
    setBudget(String(next.effective.anthropicHighBudgetTokens));
    setMapping({});
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/ai/reasoning-defaults`, { headers: authHeader() });
        const data = (await response.json().catch(() => ({}))) as { status?: string; reasoning?: ReasoningSnapshot };
        if (!cancelled && response.ok && data.reasoning) applySnapshot(data.reasoning);
        else if (!cancelled) setNotice('加载失败');
      } catch {
        if (!cancelled) setNotice('加载失败');
      }
    })();
    return () => { cancelled = true; };
  }, [applySnapshot]);

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    setDiagnostics([]);
    setNotice(null);
    const patch: Record<string, unknown> = {};
    if (snapshot && defaultLevel !== snapshot.effective.defaultLevel) patch.defaultLevel = defaultLevel;
    if (snapshot && budget !== String(snapshot.effective.anthropicHighBudgetTokens)) {
      // `<input type=number>` 对非法输入给空串、`Number('')` 又是 0（会被当成合法值发出去），
      // 所以这里按"必须是 ≥1024 的有限数值"拦在客户端，而不是把 0 交给后端去 400。
      const parsed = Number(budget);
      if (!Number.isFinite(parsed) || parsed < 1024) {
        setNotice('预算需为 ≥1024 的数值（Anthropic 下限；留空视为无效输入，不会发送）');
        setBusy(false);
        return;
      }
      patch.anthropicHighBudgetTokens = parsed;
    }
    if (Object.keys(mapping).length > 0) patch.mapping = mapping;
    if (Object.keys(patch).length === 0) {
      setNotice('没有需要保存的改动');
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/reasoning-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(patch),
      });
      const data = (await response.json().catch(() => ({}))) as { status?: string; reasoning?: ReasoningSnapshot; diagnostics?: Diagnostic[]; error?: string };
      if (response.ok && data.status === 'ok' && data.reasoning) {
        applySnapshot(data.reasoning);
        setNotice('已保存（下一次请求生效）');
      } else {
        setDiagnostics(data.diagnostics || [{ message: data.error || `HTTP ${response.status}` }]);
        setNotice('保存被拒绝');
      }
    } catch (e) {
      setNotice('保存失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, budget, defaultLevel, mapping, snapshot]);

  if (!snapshot) {
    return <div className={styles.panel} data-testid="reasoning-defaults">{notice || '加载中…'}</div>;
  }

  const changed = (defaultLevel !== snapshot.effective.defaultLevel)
    || (budget !== String(snapshot.effective.anthropicHighBudgetTokens))
    || Object.keys(mapping).length > 0;

  return (
    <section className="petri-settings-section" data-testid="reasoning-section">
      <div className="petri-settings-section__heading">
        <h3>推理档位</h3>
        <p>思考档位的默认值、Anthropic 高档预算与逐协议参数映射；出厂值与生效值并列显示，非法写回被注册表拒。</p>
      </div>
    <div className={styles.panel} data-testid="reasoning-defaults">
      <p className={styles.hint}>
        思考档位（关闭 / 标准 / 高）如何翻译成上游参数。默认档=请求未显式选档时使用哪一档；
        标准档=不发任何思考参数（与不配时行为完全一致）。逐协议映射只列出该协议真正支持的参数，
        跨协议写法会被写侧拒绝。
      </p>

      <div className={styles.field}>
        <label htmlFor="reasoning-default-level">默认档位</label>
        <select
          id="reasoning-default-level"
          data-testid="reasoning-default-level"
          value={defaultLevel}
          onChange={(event) => setDefaultLevel(event.target.value)}
        >
          {snapshot.levels.map((level) => (
            <option key={level} value={level}>{level === 'standard' ? '标准（不发参数）' : level === 'off' ? '关闭' : '高'}</option>
          ))}
        </select>
        <span className={styles.hint}>出厂：{snapshot.factory.defaultLevel}</span>
      </div>

      <div className={styles.field}>
        <label htmlFor="reasoning-anthropic-budget">Anthropic 高档思考预算（tokens）</label>
        <input
          id="reasoning-anthropic-budget"
          data-testid="reasoning-anthropic-budget"
          type="number"
          min={1024}
          max={128000}
          step={1}
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
        <span className={styles.hint}>出厂：{snapshot.factory.anthropicHighBudgetTokens}（Anthropic 要求 ≥1024）</span>
      </div>

      <table className={styles.mappingTable} data-testid="reasoning-mapping-table">
        <thead>
          <tr><th>协议</th>{snapshot.levels.map((level) => <th key={level}>{level}</th>)}</tr>
        </thead>
        <tbody>
          {Object.entries(snapshot.protocols).map(([protocol, spec]) => (
            <tr key={protocol} data-testid={`reasoning-row-${protocol}`}>
              <td>{protocol}</td>
              {snapshot.levels.map((level) => {
                const state = spec.tiers[level];
                const current = mapping[protocol]?.[level] ?? state.effective;
                return (
                  <td key={level}>
                    <select
                      data-testid={`reasoning-cell-${protocol}-${level}`}
                      value={current}
                      onChange={(event) => {
                        const value = event.target.value === state.default ? null : event.target.value;
                        setMapping((prev) => ({ ...prev, [protocol]: { ...(prev[protocol] || {}), [level]: value } }));
                      }}
                    >
                      {spec.allowed.map((token) => (
                        <option key={token} value={token}>
                          {token === state.default ? `${token}（出厂）` : token}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.actions}>
        <button type="button" onClick={() => { void save(); }} disabled={busy || !changed} data-testid="reasoning-save">
          {busy ? '保存中…' : '保存'}
        </button>
        {notice && <span className={styles.hint} data-testid="reasoning-notice">{notice}</span>}
      </div>

      {diagnostics.length > 0 && (
        <div className={styles.banner} data-tone="failed" data-testid="reasoning-diagnostics">
          {diagnostics.map((d, index) => <div key={`${d.path || 'x'}-${index}`}>{d.path ? `${d.path}：` : ''}{d.message}</div>)}
        </div>
      )}
    </div>
    </section>
  );
}

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
