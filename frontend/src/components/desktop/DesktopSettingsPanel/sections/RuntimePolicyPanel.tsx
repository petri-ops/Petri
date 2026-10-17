import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './SettingsQuickwins.module.css';

/**
 * RuntimePolicyPanel — 全局审批默认档位 / 派生并发与深度 / 工具曝光黑名单（BLOCK-202 W3 / P0-2）。
 *
 * 三条诚实边界：
 *  · **审批档位只是默认值**：请求显式带 accessMode 时永远优先；四档判定与审批资源链零改动。
 *  · **并发/深度仍受 env 覆盖**（PETRI_SPAWN_*）：面板同时显示 effective 与 envShadowed，
 *    不把「设置了但被 env 盖住」藏起来。
 *  · **工具黑名单是曝光层，不是安全边界**：只把工具从模型可见列表摘掉，直接调用仍走既有
 *    策略/审批门——文案与 plan 都这么写，避免被理解成"禁用工具"。
 */

interface RuntimeSnapshot {
  configured: {
    approvalDefaultMode: string;
    spawnConcurrency: number;
    spawnMaxDepth: number;
    toolAllow: string;
    toolDeny: string;
  };
  effective: {
    approvalDefaultMode: string;
    spawnConcurrency: number;
    spawnMaxDepth: number;
  };
  modes: string[];
  envShadowed: Array<{ key: string; envKey: string; envValue: string }>;
}

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const MODE_LABELS: Record<string, string> = {
  read: '只读（read）',
  plan: '计划（plan）',
  'workspace-write': '工作区写入（workspace-write）',
  full: '完全（full）',
};

export function RuntimePolicyPanel(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [mode, setMode] = useState('full');
  const [concurrency, setConcurrency] = useState('3');
  const [maxDepth, setMaxDepth] = useState('1');
  const [toolAllow, setToolAllow] = useState('');
  const [toolDeny, setToolDeny] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Array<{ path?: string; message?: string }>>([]);
  const [busy, setBusy] = useState(false);

  const applySnapshot = useCallback((next: RuntimeSnapshot) => {
    setSnapshot(next);
    setMode(next.effective.approvalDefaultMode);
    setConcurrency(String(next.effective.spawnConcurrency));
    setMaxDepth(String(next.effective.spawnMaxDepth));
    setToolAllow(next.configured.toolAllow || '');
    setToolDeny(next.configured.toolDeny || '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/runtime-policy`, { headers: authHeader() });
        const data = (await response.json().catch(() => ({}))) as { status?: string; runtime?: RuntimeSnapshot };
        if (!cancelled && response.ok && data.runtime) applySnapshot(data.runtime);
        else if (!cancelled) setNotice('加载失败');
      } catch {
        if (!cancelled) setNotice('加载失败');
      }
    })();
    return () => { cancelled = true; };
  }, [applySnapshot]);

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    setDiagnostics([]);
    const parsedConcurrency = Number(concurrency);
    const parsedDepth = Number(maxDepth);
    if (!Number.isFinite(parsedConcurrency) || parsedConcurrency < 1 || parsedConcurrency > 8) {
      setNotice('并发需为 1-8 的整数（留空或越界不会发送）');
      setBusy(false);
      return;
    }
    if (!Number.isFinite(parsedDepth) || parsedDepth < 1 || parsedDepth > 3) {
      setNotice('派生深度需为 1-3 的整数（沿用既有硬上限 3）');
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/runtime-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          approvalDefaultMode: mode,
          spawnConcurrency: parsedConcurrency,
          spawnMaxDepth: parsedDepth,
          toolAllow,
          toolDeny,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        status?: string; runtime?: RuntimeSnapshot; diagnostics?: Array<{ path?: string; message?: string }>; error?: string;
      };
      if (response.ok && data.status === 'ok' && data.runtime) {
        applySnapshot(data.runtime);
        setNotice('已保存（审批与黑名单下一轮任务生效；并发/深度下一轮派生生效）');
      } else {
        setDiagnostics(data.diagnostics || [{ message: data.error || `HTTP ${response.status}` }]);
      }
    } catch (error) {
      setDiagnostics([{ message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
    }
  }, [mode, concurrency, maxDepth, toolAllow, toolDeny, applySnapshot]);

  return (
    <div className={styles.panel} data-testid="runtime-policy-panel">
      <div className="petri-settings-section__heading">
        <h4>审批与编排</h4>
        <p>
          全局审批默认档位、子智能体并发/深度、工具曝光黑名单。档位只是默认值——对话里显式
          选择的档位永远优先；<strong>黑名单只影响模型可见的工具面，不是安全边界</strong>
          （直接调用仍走既有策略与审批门）。
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor="runtime-approval-mode">默认审批档位</label>
        <select
          id="runtime-approval-mode"
          data-testid="runtime-approval-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          {(snapshot?.modes || ['read', 'plan', 'workspace-write', 'full']).map((option) => (
            <option key={option} value={option}>{MODE_LABELS[option] || option}</option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="runtime-spawn-concurrency">子智能体并发上限</label>
        <input
          id="runtime-spawn-concurrency"
          data-testid="runtime-spawn-concurrency"
          type="number"
          min={1}
          max={8}
          value={concurrency}
          onChange={(event) => setConcurrency(event.target.value)}
        />
        <span className={styles.hint}>1-8；soft 指引非硬拒。env PETRI_SPAWN_CONCURRENCY_LIMIT 存在时以其为准。</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="runtime-spawn-max-depth">派生深度上限</label>
        <input
          id="runtime-spawn-max-depth"
          data-testid="runtime-spawn-max-depth"
          type="number"
          min={1}
          max={3}
          value={maxDepth}
          onChange={(event) => setMaxDepth(event.target.value)}
        />
        <span className={styles.hint}>1-3（沿用既有硬上限）；1 = 子不可再生子。env PETRI_SPAWN_MAX_DEPTH 优先。</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="runtime-tool-allow">工具曝光白名单</label>
        <input
          id="runtime-tool-allow"
          data-testid="runtime-tool-allow"
          value={toolAllow}
          placeholder="留空=全部（除黑名单）"
          onChange={(event) => setToolAllow(event.target.value)}
        />
        <span className={styles.hint}>非空时模型只看到这些工具；仍受黑名单二次收窄，且不改变执行策略。</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="runtime-tool-deny">工具曝光黑名单</label>
        <input
          id="runtime-tool-deny"
          data-testid="runtime-tool-deny"
          value={toolDeny}
          placeholder="workspace_exec,computer_click"
          onChange={(event) => setToolDeny(event.target.value)}
        />
        <span className={styles.hint}>逗号分隔的工具名；只从模型可见列表摘除，不改变执行策略。</span>
      </div>

      <div className={styles.actions}>
        <button type="button" className="petri-btn petri-btn--primary petri-btn--sm" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存编排策略'}
        </button>
        {snapshot && (
          <span className={styles.toolbarMeta} data-testid="runtime-effective">
            生效：{snapshot.effective.approvalDefaultMode} · 并发 {snapshot.effective.spawnConcurrency} · 深度 {snapshot.effective.spawnMaxDepth}
          </span>
        )}
      </div>
      {snapshot && snapshot.envShadowed.length > 0 && (
        <div className={styles.banner} data-tone="conflict" data-testid="runtime-env-shadowed">
          以下项被环境变量覆盖（设置页改它不会生效）：{snapshot.envShadowed.map((row) => `${row.key}←${row.envKey}=${row.envValue}`).join('；')}
        </div>
      )}
      {notice && <p className={styles.hint} data-testid="runtime-notice">{notice}</p>}
      {diagnostics.length > 0 && (
        <div className={styles.diagnostics} data-testid="runtime-diagnostics">
          {diagnostics.map((row, index) => (
            <span key={`${row.path || 'diag'}-${index}`} className={styles.diagnosticRow}>
              {[row.path, row.message].filter(Boolean).join('：')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
