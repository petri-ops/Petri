import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './SettingsQuickwins.module.css';

/**
 * ChannelPreferencePanel — item 40「语音」独立分区（v2 视觉稿，主人「过，开工」）。
 *
 * 从 models 的能力渠道折叠块迁出，作为 `?section=speech` 独立页常驻呈现（无外层折叠）。
 * 页内只留四块：语音渠道 / ASR 语言 / 本地模型（SenseVoice + Whisper）/ TTS 声音。
 * 旧检索后端与扫描识别两块 UI 已按主人裁决删除；其 REST 面与后端默认值原样保留
 *（功能零删除、零默认值变更），本页只承载语音设置。
 * Vision/Embedding 角色绑定仍留 models（知识库/记忆硬依赖，不随迁）。
 */
interface SpeechEffective {
  enabled: boolean;
  provider: string;
  provider_chain?: string[];
  local_model?: { modelId: string; language: string };
  ttsVoice: string;
  ttsFormat: string;
  filterMarkdown: boolean;
  timeoutMs: number;
}

interface LocalAsrModel {
  id: string;
  label: string;
  installed: boolean;
  language: string;
  sha256?: string | null;
}

// BLOCK-519 阶段二 — whisper 并列模型（与 SenseVoice 同形，二选一下载）
interface WhisperAsrModel {
  id: string;
  label: string;
  installed: boolean;
  language: string;
  bytes?: number;
  sha256?: string | null;
}

const LOCAL_MODEL_ID = 'sensevoice-small-int8-2024-07-17';
const LOCAL_LANGUAGES = [
  { value: 'auto', label: '自动检测（SenseVoice 原生多语）' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'yue', label: '粤语' },
];

const EMPTY_SPEECH: SpeechEffective = {
  enabled: false, provider: 'none', provider_chain: ['local', 'deepseek'],
  local_model: { modelId: LOCAL_MODEL_ID, language: 'auto' },
  ttsVoice: 'stella', ttsFormat: 'wav', filterMarkdown: true, timeoutMs: 60000,
};

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function ChannelPreferencePanel(): React.ReactElement {
  const [speech, setSpeech] = useState<SpeechEffective>({ ...EMPTY_SPEECH });
  const [localModels, setLocalModels] = useState<LocalAsrModel[]>([]);
  const [whisperModels, setWhisperModels] = useState<WhisperAsrModel[]>([]);
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    const [res, wRes] = await Promise.all([
      fetch(`${getPlatformApiPrefix()}/speech/local-models`, { headers: authHeader() }),
      fetch(`${getPlatformApiPrefix()}/speech/whisper-models`, { headers: authHeader() }),
    ]);
    const data = await res.json().catch(() => ({})) as { status?: string; models?: LocalAsrModel[] };
    const wData = await wRes.json().catch(() => ({})) as { status?: string; models?: WhisperAsrModel[] };
    if (res.ok && data.status === 'ok' && Array.isArray(data.models)) setLocalModels(data.models);
    if (wRes.ok && wData.status === 'ok' && Array.isArray(wData.models)) setWhisperModels(wData.models);
  }, []);

  const load = useCallback(async () => {
    try {
      const [speechRes, modelRes, wRes] = await Promise.all([
        fetch(`${getPlatformApiPrefix()}/speech-access`, { headers: authHeader() }),
        fetch(`${getPlatformApiPrefix()}/speech/local-models`, { headers: authHeader() }),
        fetch(`${getPlatformApiPrefix()}/speech/whisper-models`, { headers: authHeader() }),
      ]);
      const speechData = await speechRes.json().catch(() => ({})) as { speechAccess?: { effective?: SpeechEffective } };
      const modelData = await modelRes.json().catch(() => ({})) as { status?: string; models?: LocalAsrModel[] };
      if (speechData.speechAccess?.effective) setSpeech({ ...EMPTY_SPEECH, ...speechData.speechAccess.effective });
      const wData = await wRes.json().catch(() => ({})) as { status?: string; models?: WhisperAsrModel[] };
      if (modelRes.ok && modelData.status === 'ok' && Array.isArray(modelData.models)) setLocalModels(modelData.models);
      if (wRes.ok && wData.status === 'ok' && Array.isArray(wData.models)) setWhisperModels(wData.models);
    } catch {
      setNotice('加载失败');
    }
  }, []);

  // 独立页进页即加载（无外层折叠开关，mount 时拉一次真实配置）
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  async function put(path: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as { status?: string; diagnostics?: Array<{ message?: string }> };
      if (!response.ok || data.status !== 'ok') {
        const detail = data.diagnostics?.map((d) => d.message).filter(Boolean).join('；');
        setNotice(`保存失败${detail ? `：${detail}` : ''}`);
        return false;
      }
      setNotice(null);
      return true;
    } catch {
      setNotice('保存失败');
      return false;
    }
  }

  async function handleSpeechVoice(next: string) {
    const prev = speech;
    setSpeech({ ...speech, ttsVoice: next });
    const ok = await put('/speech-access', { ttsVoice: next });
    if (!ok) setSpeech(prev);
  }

  async function handleSpeechProvider(next: string) {
    const prev = speech;
    const enabled = next !== 'none';
    setSpeech({ ...speech, enabled, provider: next });
    const ok = await put('/speech-access', enabled ? { enabled: true, provider: next } : { enabled: false });
    if (!ok) setSpeech(prev);
  }

  async function handleLanguage(next: string) {
    const prev = speech;
    const localModel = { modelId: speech.local_model?.modelId || LOCAL_MODEL_ID, language: next };
    setSpeech({ ...speech, local_model: localModel });
    const ok = await put('/speech-access', { local_model: localModel });
    if (!ok) setSpeech(prev);
  }

  async function handleModelUse(id: string) {
    const localModel = { modelId: id, language: speech.local_model?.language || 'auto' };
    const prev = speech;
    setSpeech({ ...speech, local_model: localModel });
    const ok = await put('/speech-access', { local_model: localModel });
    if (!ok) setSpeech(prev);
  }

  // BLOCK-519 阶段二 — whisper 模型下载/删除（独立 REST 面，与 SenseVoice 并存）
  async function handleWhisperAction(id: string, method: 'POST' | 'DELETE') {
    setBusyModel(id);
    setNotice(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/speech/whisper-models/${encodeURIComponent(id)}${method === 'POST' ? '/download' : ''}`, {
        method,
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as { status?: string; message?: string };
      if (!response.ok || data.status !== 'ok') {
        setNotice(data.message || 'whisper 模型操作失败');
      } else {
        setNotice(method === 'POST' ? '下载完成（以落盘状态为准）' : '已删除 whisper 模型');
        await loadModels();
      }
    } catch {
      setNotice('whisper 模型操作失败');
    } finally {
      setBusyModel(null);
    }
  }

  async function handleModelAction(id: string, method: 'POST' | 'DELETE') {
    setBusyModel(id);
    setNotice(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/speech/local-models/${encodeURIComponent(id)}${method === 'POST' ? '/download' : ''}`, {
        method,
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as { status?: string; message?: string };
      if (!response.ok || data.status !== 'ok') {
        setNotice(data.message || '本地模型操作失败');
      } else {
        setNotice(method === 'POST' ? '下载完成（以落盘状态为准）' : '已删除本地模型');
        await loadModels();
      }
    } catch {
      setNotice('本地模型操作失败');
    } finally {
      setBusyModel(null);
    }
  }

  return (
    <div className={styles.section} data-testid="channel-panel">
      <div className={styles.body}>
          <label className={styles.field}>
            <span>语音渠道（ASR 转写 / TTS 朗读）</span>
            <select
              className="petri-select"
              data-testid="channel-speech-provider"
              value={speech.enabled ? speech.provider : 'none'}
              onChange={(e) => void handleSpeechProvider(e.target.value)}
              aria-label="语音渠道"
            >
              <option value="none">未开启（默认）</option>
              <option value="local">本地 SenseVoice（离线，需先下载模型）</option>
              <option value="deepseek">DeepSeek 语音（云渠道，Key 与对话共用）</option>
              <option value="chain">本地优先 → 云端回退</option>
            </select>
          </label>
          {speech.enabled && speech.provider !== 'deepseek' && (
            <>
              <label className={styles.field}>
                <span>ASR 语言</span>
                <select
                  className="petri-select"
                  data-testid="channel-speech-language"
                  value={speech.local_model?.language || 'auto'}
                  onChange={(e) => void handleLanguage(e.target.value)}
                  aria-label="ASR 语言"
                >
                  {LOCAL_LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                  ))}
                </select>
              </label>
              <div className={styles.field} data-testid="channel-local-models">
                <span>本地模型（下载 / 使用中 / 删除）</span>
                {localModels.length === 0 && <p className="petri-field__hint">暂无可管理的本地模型。</p>}
                {localModels.map((model) => (
                  <div key={model.id} className={styles.field} data-testid={`local-model-row-${model.id}`}>
                    <span>{model.label} · {model.installed ? '已下载（真实落盘）' : '未下载'}</span>
                    {model.installed ? (
                      <>
                        <button
                          type="button"
                          className="petri-btn petri-btn--ghost petri-btn--sm"
                          data-testid={`local-model-use-${model.id}`}
                          disabled={speech.local_model?.modelId === model.id || busyModel === model.id}
                          onClick={() => void handleModelUse(model.id)}
                        >
                          {speech.local_model?.modelId === model.id ? '使用中' : '设为使用中'}
                        </button>
                        <button
                          type="button"
                          className="petri-btn petri-btn--ghost petri-btn--sm"
                          data-testid={`local-model-delete-${model.id}`}
                          disabled={busyModel === model.id}
                          onClick={() => void handleModelAction(model.id, 'DELETE')}
                        >
                          删除
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="petri-btn petri-btn--ghost petri-btn--sm"
                        data-testid={`local-model-download-${model.id}`}
                        disabled={busyModel === model.id}
                        onClick={() => void handleModelAction(model.id, 'POST')}
                      >
                        {busyModel === model.id ? '下载中…' : '下载'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className={styles.field} data-testid="channel-whisper-models">
                <span>Whisper 并列模型（可选，与 SenseVoice 二选一）</span>
                {whisperModels.length === 0 && <p className="petri-field__hint">暂无可下载的 whisper 模型。</p>}
                {whisperModels.map((model) => (
                  <div key={model.id} className={styles.field} data-testid={`whisper-model-row-${model.id}`}>
                    <span>{model.label} · {model.installed ? '已下载（真实落盘）' : '未下载'}</span>
                    {model.installed ? (
                      <>
                        <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm"
                          data-testid={`whisper-model-use-${model.id}`}
                          disabled={speech.local_model?.modelId === model.id || busyModel === model.id}
                          onClick={() => void handleModelUse(model.id)}>
                          {speech.local_model?.modelId === model.id ? '使用中' : '设为使用中'}
                        </button>
                        <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm"
                          data-testid={`whisper-model-delete-${model.id}`}
                          disabled={busyModel === model.id}
                          onClick={() => void handleWhisperAction(model.id, 'DELETE')}>删除</button>
                      </>
                    ) : (
                      <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm"
                        data-testid={`whisper-model-download-${model.id}`}
                        disabled={busyModel === model.id}
                        onClick={() => void handleWhisperAction(model.id, 'POST')}>
                        {busyModel === model.id ? '下载中…' : '下载'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="petri-field__hint">
                模型未落盘前不会标记为「使用中」；auto = 原生多语自动识别（配置透传，不写 native 参数）。whisper 与 SenseVoice 同为本地引擎，二选一下载。
              </p>
            </>
          )}
          {speech.enabled && (
            <label className={styles.field}>
              <span>TTS 声音</span>
              <select
                className="petri-select"
                data-testid="channel-speech-voice"
                value={speech.ttsVoice}
                onChange={(e) => void handleSpeechVoice(e.target.value)}
                aria-label="TTS 声音"
              >
                <option value="stella">stella（女声）</option>
                <option value="tide">tide（男声）</option>
              </select>
            </label>
          )}
          <p className="petri-field__hint">
            开启后 agent 可用 transcribe_audio（工作区音频转写）与 speak_text（文本朗读，产物落 .petri/audio/）。
          </p>
          {notice && <p className="petri-field__hint" role="alert">{notice}</p>}
      </div>
    </div>
  );
}
