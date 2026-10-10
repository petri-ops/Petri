import React, { useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import styles from './TestInstanceBadge.module.css';

/**
 * BLOCK-100 / UI-409+UI-413 — 测试实例窗口管理条。
 *
 * 身份判定：preload 经 webPreferences.additionalArguments 注入
 * `--petri-test-instance=1`，petriDesktop.__testInstance === true 才渲染。
 * 严格 === true：投影 shim（Proxy 属性访问返回 callable proxy）与普通主实例
 * （undefined）都不会误亮。
 *
 * UI-413 交互模型（用户实测「悬停自动解锁拖拽不顺畅」后改为显式双稳态）：
 * - 默认锁定：整窗鼠标穿透（OS 层），内容碰不到；管理条显示解锁快捷键。
 * - Ctrl+Alt+M（主进程 globalShortcut，仅测试实例注册）切换管理模式：
 *   解锁后窗口即普通窗口——拖管理条移动/边缘拉伸调整大小/点按钮，零翻转竞态；
 *   再按一次锁回穿透。主进程经 testManageModeChanged 事件广播状态。
 * - 📌置顶默认开，管理模式下可点切换。
 */
const isTestInstance =
  typeof window !== 'undefined' &&
  (window as { petriDesktop?: { __testInstance?: unknown } }).petriDesktop
    ?.__testInstance === true;

// UI-421 — 快捷键由主进程经启动参数透传（默认 Ctrl+Alt+Shift+M：
// Ctrl+Alt+M 在部分机器被第三方程序 RegisterHotKey 占用导致静默失败）。
const manageShortcut =
  (window as { petriDesktop?: { __testManageShortcut?: string } }).petriDesktop
    ?.__testManageShortcut || 'Ctrl+Alt+M';

export function TestInstanceBadge(): React.ReactElement | null {
  const [manageMode, setManageMode] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  useEffect(() => {
    if (!isTestInstance) return undefined;
    const bridge = getBridge('window') as
      | { onTestManageModeChanged?: (cb: (manageMode: boolean) => void) => () => void }
      | null;
    const unsub = bridge?.onTestManageModeChanged?.((manage: boolean) => setManageMode(manage));
    return () => unsub?.();
  }, []);

  if (!isTestInstance) return null;

  const toggleOnTop = () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    // screen-saver 层：默认 level 创建期/恢复期不稳（实机二分结论）
    void getBridge('window')?.setAlwaysOnTop?.(next, 'screen-saver');
  };

  return (
    <div
      className={`${styles.bar}${manageMode ? ` ${styles.barUnlocked}` : ''}`}
      title={
        manageMode
          ? `管理模式：拖本条移动窗口 / 拖边缘调整大小 / 点按钮操作；${manageShortcut} 锁回穿透`
          : `已穿透（内容碰不到）。按 ${manageShortcut} 解锁窗口管理（拖动移动/边缘调整大小）`
      }
    >
      <span className={styles.badge}>测试实例 · TEST</span>
      {manageMode ? (
        <>
          <button
            type="button"
            className={`${styles.btn}${alwaysOnTop ? ` ${styles.btnOn}` : ''}`}
            onClick={toggleOnTop}
            aria-pressed={alwaysOnTop}
            title={alwaysOnTop ? '置顶中——点击取消置顶' : '点击置顶'}
          >
            📌 置顶{alwaysOnTop ? '开' : '关'}
          </button>
          <span className={styles.hint}>管理模式 · 拖本条移动 / 拖边缘调整大小 · {manageShortcut} 锁回</span>
        </>
      ) : (
        <span className={styles.hint}>内容已穿透 · {manageShortcut} 解锁窗口管理</span>
      )}
    </div>
  );
}
