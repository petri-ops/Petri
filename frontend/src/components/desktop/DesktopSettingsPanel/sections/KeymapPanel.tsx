import { useCallback, useEffect, useState } from 'react';
import { KEYMAP_COMMANDS, comboFromEvent, formatCombo } from '@/lib/appKeymap';
import { useKeymapSafe } from '@/lib/appKeymapContext';
import styles from './SettingsQuickwins.module.css';

/**
 * KeymapPanel — 应用级命令键位设置面（BLOCK-200 P0-1 / UI-514）。
 *
 * 三条纪律：
 *  · 这里显示的组合串**就是派发器读的同一个值**（不存在"显示 A 实际按 B"的第二份真相）；
 *  · 录制用捕获阶段监听并 preventDefault，避免录制中的按键顺手触发旧绑定；
 *  · 写失败必须可见（`sync`），且解绑/恢复默认都走同一条写侧守卫（非法值 400 + 诊断）。
 */
export function KeymapPanel(): React.ReactElement {
  const { bindings, overrides, conflicts, sync, save } = useKeymapSafe();
  const [recording, setRecording] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        setHint(null);
        return;
      }
      const combo = comboFromEvent(event);
      if (!combo) {
        setHint('至少需要一个修饰键——裸键绑定会劫持输入框里的打字，本面不接受');
        return;
      }
      setHint(null);
      void save({ [recording]: combo });
      setRecording(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, save]);

  const resetOne = useCallback((id: string) => { void save({ [id]: null }); }, [save]);

  return (
    <div className={styles.panel} data-testid="keymap-panel">
      <p className={styles.hint}>
        应用级命令的快捷键。`Mod` 在 macOS 是 ⌘、其余平台是 Ctrl。这里显示的组合串与真正派发的组合串
        是同一个值；未列出的就近快捷键（保存、提交、关闭标签、Esc 类）仍由各自界面固定处理，不在本面改。
      </p>

      {conflicts.length > 0 && (
        <div className={styles.banner} data-tone="conflict" data-testid="keymap-conflicts">
          键位冲突：{conflicts.map((row) => `${formatCombo(row.combo)} 同时被 ${row.commandIds.length} 个命令占用（${row.commandIds.join('、')}）`).join('；')}
          ——冲突的组合只有登记在前的命令会触发，请把其中一个改成别的键或解绑。
        </div>
      )}

      {sync.state === 'failed' && (
        <div className={styles.banner} data-tone="failed" data-testid="keymap-sync-failed">
          键位未保存到本机设置（当前只对本窗口生效，重启或换窗口会回到已保存的键位）：{sync.error}
        </div>
      )}

      {hint && <div className={styles.banner} data-tone="failed" data-testid="keymap-hint">{hint}</div>}

      <div className={styles.rows}>
        {KEYMAP_COMMANDS.map((command) => {
          const combo = bindings[command.id];
          const isRecording = recording === command.id;
          return (
            <div className={styles.row} key={command.id} data-testid={`keymap-row-${command.id}`}>
              <div className={styles.rowMain}>
                <span className={styles.rowLabel}>{command.label}</span>
                <span className={styles.rowDesc}>{command.description}</span>
              </div>
              <div className={styles.rowSide}>
                <span
                  className={styles.combo}
                  data-state={isRecording ? 'recording' : combo ? 'bound' : 'unbound'}
                  data-testid={`keymap-combo-${command.id}`}
                >
                  {isRecording ? '按下组合键…（Esc 取消）' : formatCombo(combo) || '未绑定'}
                </span>
                <button type="button" onClick={() => { setHint(null); setRecording(isRecording ? null : command.id); }}>
                  {isRecording ? '取消' : '改键'}
                </button>
                {combo && <button type="button" onClick={() => resetOne(command.id)}>解绑</button>}
                {overrides[command.id] !== undefined && (
                  <button type="button" onClick={() => resetOne(command.id)}>恢复默认</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
