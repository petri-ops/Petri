// ============================================================
// FolderPicker — UI-259 应用内文件夹选择器
//
// 系统目录面板对"文件共享"标记路径会禁用「打开」按钮，导致部分
// 路径无法选定。此组件经 file:list-directory IPC 在应用内直接
// 浏览文件夹：面包屑导航 + 一级子目录列表 + 「选择此文件夹」。
// 选中的路径由调用方写回各自的路径输入框（不直接创建/保存）。
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import styles from './FolderPicker.module.css';

interface DirEntry {
  name: string;
  path: string;
}

interface ListResult {
  ok: boolean;
  data?: { path: string; parent: string | null; home: string; dirs: DirEntry[] };
  error?: string;
}

export function FolderPicker({
  initialPath,
  pickLabel = '选择此文件夹',
  onPick,
  onCancel,
}: {
  /** 初始浏览位置；空串/非法路径时回退到用户主目录 */
  initialPath?: string;
  pickLabel?: string;
  onPick: (path: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [cur, setCur] = useState('');
  const [home, setHome] = useState('');
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (target: string) => {
    const list = window.biof3Desktop?.files?.listDirectory;
    if (typeof list !== 'function') {
      setError('当前运行环境不支持文件夹浏览（请在 Gewu 桌面应用中使用）。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res: ListResult = await list(target);
      if (!res.ok || !res.data) {
        setError(res.error || '无法读取该文件夹');
        return;
      }
      setCur(res.data.path);
      setHome(res.data.home);
      setParent(res.data.parent);
      setDirs(res.data.dirs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(initialPath || '');
  }, [initialPath, load]);

  // 面包屑：按 / 切分累计拼接，点击跳到对应层级；home 段显示为 ~
  const segments = cur ? cur.split('/').filter(Boolean) : [];
  const crumbs: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
  segments.forEach((seg, i) => {
    const p = '/' + segments.slice(0, i + 1).join('/');
    crumbs.push({ label: home && p === home ? '~' : seg, path: p });
  });

  return (
    <div className={styles.picker} data-testid="folder-picker">
      <div className={styles.crumbBar}>
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className={styles.crumbItem}>
            {i > 0 && <span className={styles.crumbSep}>/</span>}
            <button
              type="button"
              className={styles.crumbBtn}
              onClick={() => void load(crumb.path)}
              disabled={loading}
              title={crumb.path}
            >
              {crumb.label}
            </button>
          </span>
        ))}
        {parent && (
          <button
            type="button"
            className={styles.upBtn}
            onClick={() => parent && void load(parent)}
            disabled={loading}
            title="上一级"
            aria-label="上一级"
          >
            <Icon name="arrow-up" size={13} />
          </button>
        )}
      </div>
      {error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : (
        <ul className={styles.dirList}>
          {loading && <li className={styles.empty}>读取中…</li>}
          {!loading && dirs.length === 0 && <li className={styles.empty}>此文件夹下没有子文件夹</li>}
          {!loading && dirs.map((d) => (
            <li key={d.path}>
              <button
                type="button"
                className={styles.dirRow}
                onClick={() => void load(d.path)}
                title={d.path}
              >
                <Icon name="folder" size={14} />
                <span className={styles.dirName}>{d.name}</span>
                <Icon name="chevron-right" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="gewu-btn gewu-btn--sm"
          onClick={() => onPick(cur)}
          disabled={loading || !cur}
          title={cur}
        >
          <Icon name="check" size={13} /> {pickLabel}
        </button>
        <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" onClick={onCancel}>
          收起
        </button>
      </div>
    </div>
  );
}
