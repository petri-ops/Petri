/**
 * EmbeddingRoleBindingPanel — 试用反馈②：向量模型配置从「模型接口」迁到「知识空间」。
 *
 * 只做配置 UI 归属迁移：读写同一 `model_role_bindings.embedding` 与派生
 * `embed_provider`（applyEmbeddingBinding 纯函数），底层 embedding/provider/回退链零改。
 * 老用户配置：get() 原样读取、缺绑定显示「未绑定」，迁移零丢失。
 */
import React from 'react';
import { useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { parseModelBinding } from '@/lib/model-capabilities';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { EmbeddingRoleBinding } from '@/components/desktop/DesktopSettingsPanel/EmbeddingRoleBinding';
import { applyEmbeddingBinding, readEmbeddingBinding, type EmbeddingBindingSettings } from './embeddingBindingMigration';
import styles from './KnowledgeSpacePanel.module.css';

export function EmbeddingRoleBindingPanel(): React.ReactElement {
  const [settings, setSettings] = useState<EmbeddingBindingSettings | null>(null);
  const [profiles, setProfiles] = useState<ChatModelPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(() => (getBridge('aiSettings') ? '' : '当前环境不支持模型设置读取'));

  useEffect(() => {
    let alive = true;
    const bridge = getBridge('aiSettings');
    if (!bridge) return;
    void bridge.get().then((s) => {
      if (!alive) return;
      setSettings(s);
      const list = Array.isArray(s.model_profiles) ? (s.model_profiles as ChatModelPreset[]) : [];
      setProfiles(list);
    }).catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : '读取模型设置失败');
    });
    return () => { alive = false; };
  }, []);

  const current = readEmbeddingBinding(settings);
  const onChange = async (binding: string): Promise<void> => {
    const bridge = getBridge('aiSettings');
    if (!bridge || !settings) return;
    const parsed = parseModelBinding(binding);
    const bound = profiles.find((p) => (p.endpointProfileId || p.id) === parsed.profileId);
    const next = applyEmbeddingBinding(settings, binding, bound?.provider);
    setSaving(true);
    setError('');
    try {
      await bridge.save(next);
      setSettings(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存向量模型绑定失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.noticeCard} data-testid="knowledge-embedding-binding" aria-busy={saving}>
      <div className={styles.noticeRow}>
        <span className={styles.noticeText}>语义检索模型（向量）</span>
      </div>
      <EmbeddingRoleBinding profiles={profiles} value={current} onChange={(b) => void onChange(b)} />
      {error && <div className={styles.noticeRowError} role="alert">{error}</div>}
    </section>
  );
}
