import React from 'react';
import { Icon } from '@/components/icons/Icon';
import button from '@/components/ui/controls/button.module.css';
import { generateModelAssetAsNode, type GeneratedModelAssetNode } from '@/lib/model3dAssetImport';
import type { Model3DCapability } from '@/lib/model3dClient';
import type { Scene3DSpec } from '@/lib/scene3d';
import styles from './Model3DGenerateDialog.module.css';

const MAX_PROMPT = 1024;
const MIN_PROMPT = 3;

export function Model3DGenerateDialog({
  projectId,
  scene,
  generation,
  onClose,
  onGenerated,
}: {
  projectId: string;
  scene: Scene3DSpec;
  generation: Model3DCapability['generation'];
  onClose: () => void;
  onGenerated: (result: GeneratedModelAssetNode) => void;
}): React.ReactElement {
  const [prompt, setPrompt] = React.useState('');
  const [phase, setPhase] = React.useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const available = generation?.status === 'ready';
  const external = generation?.privacy?.external === true;

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase !== 'running') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const generate = async () => {
    const text = prompt.trim();
    if (text.length < MIN_PROMPT || text.length > MAX_PROMPT) {
      setError(`提示词需为 ${MIN_PROMPT}..${MAX_PROMPT} 字。`);
      return;
    }
    setPhase('running');
    setError(null);
    try {
      const result = await generateModelAssetAsNode({ projectId, prompt: text, scene });
      onGenerated(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'generation_failed');
      setPhase('error');
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="AI 生成 3D 模型">
      <div className={styles.dialog}>
        <header className={styles.header}>
          <span className={styles.title}><Icon name="layers" size={15} /><strong>AI 生成 3D</strong></span>
          <button type="button" className={button.ghost} onClick={onClose} disabled={phase === 'running'}>关闭</button>
        </header>

        <div className={styles.notice}>
          {available
            ? `生成服务：${generation?.provider || 'unknown'}${generation?.model ? ` · ${generation.model}` : ''}`
            : (generation?.message || '外部 3D 生成服务未配置。')}
          {external ? (
            <div>
              隐私：提示词会发送到外部服务；生成链接有效期有限，结果会立即下载并按 sha256 存入本地资产库。
              费用：每次生成按服务商计价，请确认后使用。
            </div>
          ) : null}
        </div>

        <label className={styles.field}>
          <span>提示词（描述几何、用途、尺寸/风格；不要放密钥或隐私数据）</span>
          <textarea
            value={prompt}
            maxLength={MAX_PROMPT}
            disabled={!available || phase === 'running'}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：一个带圆角的壁挂支架，两个 M4 安装孔，黑色磨砂"
          />
        </label>
        <span className={styles.meta}>{prompt.trim().length} / {MAX_PROMPT} 字 · 生成成功后自动加入当前 SceneSpec（派生 GLB 资产）</span>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {phase === 'running' ? <div className={styles.notice}>生成中，外部服务可能需要数分钟；完成后会自动加入场景，请勿关闭。</div> : null}

        <div className={styles.actions}>
          <button type="button" className={button.primary} disabled={!available || phase === 'running' || prompt.trim().length < MIN_PROMPT} onClick={() => { void generate(); }}>
            {phase === 'running' ? '生成中…' : '生成并加入场景'}
          </button>
          <span className={styles.meta}>默认关闭；只有显式配置 key 才会出站。</span>
        </div>
      </div>
    </div>
  );
}
