import { useCallback, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './SettingsQuickwins.module.css';

/**
 * ChannelPreferencePanel — models「能力渠道」折叠块（UI-704 · BLOCK-454 渠道槽位显化）。
 *
 * 设计源（settings-ia-simplification-design.md §六）：BLOCK-454 全部新设置项统一进
 * models 的「能力渠道」折叠块，不新增左栏分组——设置页骨架一次定型，后续只填槽位。
 * 本面板承载两个后端渠道（REST 写面均已在 BLOCK-454 P2/P3 落地）：
 *  · 联网检索后端（GET/PUT /api/web-access）：SearXNG 为默认（本地主权 P3-c），
 *    DeepSeek 搜索为可选云渠道；
 *  · OCR 渠道（GET/PUT /api/ocr-access）：默认关（云调用=付费副作用 P5-a），
 *    DeepSeek OCR 云渠道可选，local 槽位留接口（D1）。
 *
 * 诚实边界：与后端配置面同口径——即时生效、写失败显式提示（不静默）、诊断项照抄。
 */
interface OcrEffective {
  enabled: boolean;
  provider: string;
  purpose: string;
  timeoutMs: number;
}

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

const LOCAL_MODEL_ID = 'sensevoice-small-int8-2024-07-17';
const LOCAL_LANGUAGES = [
  { value: 'auto', label: '自动检测（SenseVoice 原生多语）' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'yue', label: '粤语' },
];

const EMPTY_OCR: OcrEffective = { enabled: false, provider: 'none', purpose: 'rich_layout_recognition', timeoutMs: 60000 };

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
  const [searchProvider, setSearchProvider] = useState<string>('none');
  const [ocr, setOcr] = useState<OcrEffective>({ ...EMPTY_OCR });
  const [speech, setSpeech] = useState<SpeechEffective>({ ...EMPTY_SPEECH });
  const [localModels, setLocalModels] = useState<LocalAsrModel[]>([]);
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const loadModels = useCallback(async () => {
    const response = await fetch(`${getPlatformApiPrefix()}/speech/local-models`, { headers: authHeader() });
    const data = await response.json().catch(() => ({})) as { status?: string; models?: LocalAsrModel[] };
    if (response.ok && data.status === 'ok' && Array.isArray(data.models)) setLocalModels(data.models);
  }, []);

  const load = useCallback(async () => {
    try {
      const [webRes, ocrRes, speechRes, modelRes] = await Promise.all([
        fetch(`${getPlatformApiPrefix()}/web-access`, { headers: authHeader() }),
        fetch(`${getPlatformApiPrefix()}/ocr-access`, { headers: authHeader() }),
        fetch(`${getPlatformApiPrefix()}/speech-access`, { headers: authHeader() }),
        fetch(`${getPlatformApiPrefix()}/speech/local-models`, { headers: authHeader() }),
      ]);
      const webData = await webRes.json().catch(() => ({})) as { webAccess?: { effective?: { provider?: string } } };
      const ocrData = await ocrRes.json().catch(() => ({})) as { ocrAccess?: { effective?: OcrEffective } };
      const speechData = await speechRes.json().catch(() => ({})) as { speechAccess?: { effective?: SpeechEffective } };
      const modelData = await modelRes.json().catch(() => ({})) as { status?: string; models?: LocalAsrModel[] };
      if (webData.webAccess?.effective?.provider !== undefined) setSearchProvider(webData.webAccess.effective.provider);
      if (ocrData.ocrAccess?.effective) setOcr({ ...EMPTY_OCR, ...ocrData.ocrAccess.effective });
      if (speechData.speechAccess?.effective) setSpeech({ ...EMPTY_SPEECH, ...speechData.speechAccess.effective });
      if (modelRes.ok && modelData.status === 'ok' && Array.isArray(modelData.models)) setLocalModels(modelData.models);
    } catch {
      setNotice('加载失败');
    }
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) void load();
      return next;
    });
  }, [load]);

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

  async function handleSearchProvider(next: string) {
    const prev = searchProvider;
    setSearchProvider(next);
    const ok = await put('/web-access', { provider: next });
    if (!ok) setSearchProvider(prev);
  }

  async function handleOcrProvider(next: string) {
    const prev = ocr;
    const enabled = next !== 'none';
    setOcr({ ...ocr, provider: next, enabled });
    const ok = await put('/ocr-access', { provider: next, enabled });
    if (!ok) setOcr(prev);
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
      <button
        type="button"
        className={styles.collapsibleToggle}
        data-testid="channel-panel-toggle"
        onClick={toggleOpen}
        aria-expanded={open}
      >
        <span>{open ? '▾' : '▸'} 能力渠道</span>
        <small>识图 / 检索 / OCR 的后端渠道（BLOCK-454）</small>
      </button>
      {open && (
        <div className={styles.body}>
          <label className={styles.field}>
            <span>联网检索后端</span>
            <select
              className="petri-select"
              data-testid="channel-search-provider"
              value={searchProvider}
              onChange={(e) => void handleSearchProvider(e.target.value)}
              aria-label="联网检索后端"
            >
              <option value="none">未选择</option>
              <option value="searxng">SearXNG（自建 · 默认推荐）</option>
              <option value="deepseek">DeepSeek 搜索（云渠道，Key 与对话共用）</option>
            </select>
          </label>
          <p className="petri-field__hint">
            SearXNG 是本地主权默认（自建、来源可审计）；DeepSeek 为可选云渠道，Key 与对话共用同一凭据。
            检索总开关与实例地址在「联网与代理」分区。
          </p>
          <label className={styles.field}>
            <span>OCR 渠道（扫描件识别）</span>
            <select
              className="petri-select"
              data-testid="channel-ocr-provider"
              value={ocr.provider}
              onChange={(e) => void handleOcrProvider(e.target.value)}
              aria-label="OCR 渠道"
            >
              <option value="none">未开启（默认）</option>
              <option value="deepseek">DeepSeek OCR（云渠道，Key 与对话共用）</option>
              <option value="local">本地引擎（未引入依赖，选择会诚实报未实现）</option>
            </select>
          </label>
          <p className="petri-field__hint">
            开启后 knowledge 摄取对无文本层扫描件 PDF 自动 OCR（云调用按量计费，产物落 ocr.json 留痕）。
          </p>
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
              <p className="petri-field__hint">
                模型未落盘前不会标记为「使用中」；auto = SenseVoice 原生多语自动识别（配置透传，不写 native 参数）。
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
      )}
    </div>
  );
}
