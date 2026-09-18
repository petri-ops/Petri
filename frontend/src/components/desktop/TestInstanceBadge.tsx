import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import styles from './TestInstanceBadge.module.css';

/**
 * BLOCK-100 / UI-409+UI-411 — 测试实例窗口管理条。
 *
 * 身份判定：preload 经 webPreferences.additionalArguments 注入
 * `--gewu-test-instance=1`，biof3Desktop.__testInstance === true 才渲染。
 * 严格 === true：投影 shim（Proxy 属性访问返回 callable proxy）与普通主实例
 * （undefined）都不会误亮。
 *
 * UI-411 交互模型（用户裁决「不允许外部点击」但可移动/调大小/置顶）：
 * - 默认整窗鼠标穿透（OS 层 WS_EX_TRANSPARENT，forward:true 使渲染层仍收
 *   mousemove）；内容区恒穿透——人因手滑物理上碰不到测试界面。
 * - 鼠标悬停顶部管理条或贴近窗口边缘 → 自动临时解锁（真实鼠标可拖管理条移动
 *   窗口、拖边缘调整大小、点按钮）；移开内容区 → 自动恢复穿透。
 * - 解锁/恢复仅在状态翻转时调 IPC（mousemove 高频，不每次都发）。
 * - 按下鼠标期间不自动上锁，避免拖拽中途被穿透打断。
 */
const isTestInstance =
  typeof window !== 'undefined' &&
  (window as { biof3Desktop?: { __testInstance?: unknown } }).biof3Desktop
    ?.__testInstance === true;

export function TestInstanceBadge(): React.ReactElement | null {
  const [ignoreMouse, setIgnoreMouse] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const ignoreRef = useRef(true);

  const applyIgnore = useCallback((value: boolean) => {
    if (ignoreRef.current === value) return;
    ignoreRef.current = value;
    setIgnoreMouse(value);
    void getBridge('window')?.setIgnoreMouseEvents?.(value);
  }, []);

  useEffect(() => {
    if (!isTestInstance) return undefined;
    // 穿透态（forward:true）下 mousemove 仍会派发到渲染层——据此检测指针
    // 是否处于管理条/边缘解锁区，并仅在状态翻转时切换穿透。
    const onMove = (event: MouseEvent) => {
      if (event.buttons !== 0) return; // 拖拽中不自动上锁
      const w = window.innerWidth;
      const h = window.innerHeight;
      const inUnlockZone =
        event.clientY <= 30 ||
        event.clientX <= 8 ||
        event.clientX >= w - 8 ||
        event.clientY >= h - 8;
      applyIgnore(!inUnlockZone);
    };
    window.addEventListener('mousemove', onMove, true);
    return () => window.removeEventListener('mousemove', onMove, true);
  }, [applyIgnore]);

  if (!isTestInstance) return null;

  const toggleOnTop = () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    void getBridge('window')?.setAlwaysOnTop?.(next);
  };

  return (
    <div className={styles.bar} title="测试实例管理条：悬停可拖动移动/边缘调整大小；内容区已穿透">
      <span className={styles.badge}>测试实例 · TEST</span>
      <button
        type="button"
        className={`${styles.btn}${alwaysOnTop ? ` ${styles.btnOn}` : ''}`}
        onClick={toggleOnTop}
        aria-pressed={alwaysOnTop}
        title={alwaysOnTop ? '置顶中——点击取消置顶' : '点击置顶'}
      >
        📌 置顶{alwaysOnTop ? '开' : '关'}
      </button>
      <span className={styles.hint}>{ignoreMouse ? '内容已穿透' : '已临时解锁'}</span>
    </div>
  );
}
