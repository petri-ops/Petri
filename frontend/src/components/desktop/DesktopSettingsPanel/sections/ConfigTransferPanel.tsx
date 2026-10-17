import { useCallback, useRef, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { exportConfigEnvelope, importConfigEnvelope, type ConfigDiagnostic, type ConfigEnvelope } from '@/lib/configTransfer';
import styles from './SettingsQuickwins.module.css';

/**
 * ConfigTransferPanel — 设置全景导出 / 导入（BLOCK-201 W2 / P0-3）。
 *
 * 诚实边界（与后端 helper 同一口径，UI 不美化）：
 *  · 只覆盖 shared-config 注册表的 6 族（开关/决策接点/生成参数/成本上限/键位/推理档位）；
 *  · **凭据、模型渠道 profiles、外观偏好、计算路径不在导出里**——排除清单由后端随信封回传，
 *    导入后若有键被 env 覆盖，导出时的 `envShadowed` 会明说「导进去也不会生效」；
 *  · 导入是**合并覆盖**（只写文件里出现的键），不是整机恢复；要回到默认用「按区重置」。
 */
interface Props {
  /** 导入成功后通知父层刷新分区面板（设置值是各面板挂载时拉的）。 */
  onChanged?: () => void;
}

export function ConfigTransferPanel({ onChanged }: Props): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ConfigDiagnostic[]>([]);
  const [envShadowed, setEnvShadowed] = useState<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const exportConfig = useCallback(async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    setDiagnostics([]);
    try {
      const envelope = await exportConfigEnvelope();
      const content = JSON.stringify(envelope, null, 2) + '\n';
      const name = `petri-config-${new Date().toISOString().slice(0, 10)}.json`;
      const bridge = getBridge('files');
      if (bridge?.saveTextFile) {
        const result = await bridge.saveTextFile(name, content);
        if (result.canceled) {
          setNotice('已取消导出');
          return;
        }
        if (!result.ok) {
          setDiagnostics([{ message: result.error || '写入文件失败' }]);
          return;
        }
        setNotice(`已导出 ${name}（${Object.keys(envelope.families).length} 族；不含凭据）`);
      } else {
        // 浏览器投影环境：退化为下载
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        URL.revokeObjectURL(url);
        setNotice(`已下载 ${name}（${Object.keys(envelope.families).length} 族；不含凭据）`);
      }
      setEnvShadowed(Array.isArray(envelope.envShadowed) ? envelope.envShadowed.length : 0);
    } catch (error) {
      setDiagnostics([{ message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
    }
  }, []);

  const importConfig = useCallback(async (file: File): Promise<void> => {
    setBusy(true);
    setNotice(null);
    setDiagnostics([]);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ConfigEnvelope;
      const result = await importConfigEnvelope(parsed);
      if (!result.ok) {
        setDiagnostics(result.diagnostics.length > 0 ? result.diagnostics : [{ message: '导入被拒绝' }]);
        setNotice(result.applied.length > 0 ? `部分已写入：${result.applied.join('、')}（其余未落盘）` : '未写入任何配置');
        return;
      }
      setNotice(`已导入 ${result.applied.length} 族：${result.applied.join('、')}（合并覆盖，不删除未出现的键）`);
      onChanged?.();
    } catch (error) {
      setDiagnostics([{ message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  return (
    <div className={styles.panel} data-testid="config-transfer-panel">
      <div className="petri-settings-section__heading">
        <h4>配置备份（导出 / 导入）</h4>
        <p>
          导出注册表 6 族（功能开关、决策接点、生成参数、成本上限、键位、推理档位）。
          <strong>不含 API Key、模型渠道与外观偏好</strong>——排除清单随文件一起写出，便于核对。
          导入为合并覆盖：只写文件里出现的键，不会删除未出现的键。
        </p>
      </div>

      <div className={styles.actions}>
        <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" disabled={busy} onClick={() => void exportConfig()}>
          {busy ? '处理中…' : '导出配置'}
        </button>
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          导入配置
        </button>
        <input
          ref={fileRef}
          className={styles.hiddenInput}
          type="file"
          accept=".json,application/json"
          data-testid="config-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importConfig(file);
          }}
        />
      </div>

      {notice && <p className={styles.hint} data-testid="config-transfer-notice">{notice}</p>}
      {envShadowed > 0 && (
        <p className={styles.hint} data-testid="config-transfer-shadow">
          注意：有 {envShadowed} 项配置正被环境变量覆盖（导出文件里看到的不是当前生效值）；导入这些键后仍会被 env 盖住。
        </p>
      )}
      {diagnostics.length > 0 && (
        <div className={styles.diagnostics} data-testid="config-transfer-diagnostics">
          {diagnostics.map((row, index) => (
            <span key={`${row.path || row.code || 'diag'}-${index}`} className={styles.diagnosticRow}>
              {[row.family, row.path, row.code].filter(Boolean).join(' · ')}
              {row.message ? `：${row.message}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
