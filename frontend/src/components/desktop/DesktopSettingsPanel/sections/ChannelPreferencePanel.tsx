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

const EMPTY_OCR: OcrEffective = { enabled: false, provider: 'none', purpose: 'rich_layout_recognition', timeoutMs: 60000 };

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function ChannelPreferencePanel(): React.ReactElement {
  const [searchProvider, setSearchProvider] = useState<string>('none');
  const [ocr, setOcr] = useState<OcrEffective>({ ...EMPTY_OCR });
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [webRes, ocrRes] = await Promise.all([
        fetch(`${getPlatformApiPrefix()}/web-access`, { headers: authHeader() }),
        fetch(`${getPlatformApiPrefix()}/ocr-access`, { headers: authHeader() }),
      ]);
      const webData = await webRes.json().catch(() => ({})) as { webAccess?: { effective?: { provider?: string } } };
      const ocrData = await ocrRes.json().catch(() => ({})) as { ocrAccess?: { effective?: OcrEffective } };
      if (webData.webAccess?.effective?.provider !== undefined) setSearchProvider(webData.webAccess.effective.provider);
      if (ocrData.ocrAccess?.effective) setOcr({ ...EMPTY_OCR, ...ocrData.ocrAccess.effective });
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
          {notice && <p className="petri-field__hint" role="alert">{notice}</p>}
        </div>
      )}
    </div>
  );
}
