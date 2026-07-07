import React, { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { figCards, categories, stages } from '@/pages/figcode/_data';
import type { FigCard } from '@/pages/figcode/_data';
import RunModal from '@/components/RunModal';
import { setCopilotContext } from '@/components/copilot';
import { fetchCopilotIndex } from '@/components/copilot/copilotIndexClient';
import { CopilotProgressTracker } from '@/components/copilot/CopilotProgressTracker';
import { reportProgress } from '@/components/copilot/copilotProgressClient';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from '@/pages/figcode.module.css';

// 桌面版无 Docusaurus baseUrl，useBaseUrl 直接返回原路径
function useBaseUrl(path: string): string {
  return path;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    },
    [text]
  );

  return (
    <button
      className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
      onClick={handleCopy}
      type="button"
      title={copied ? '已复制' : '复制代码'}
      aria-label={copied ? '已复制' : '复制代码'}
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function CardFront({
  card,
  onRunClick,
  needsPlugin,
  onInstall,
}: {
  card: FigCard;
  onRunClick: (card: FigCard) => void;
  needsPlugin?: boolean;
  onInstall?: (cardId: string) => void;
}) {
  const imgSrc = useBaseUrl(card.image);
  const docHtmlHref = useBaseUrl(`/exports/figcode/${card.id}/index.html`);
  const docPdfHref = useBaseUrl(`/exports/figcode/${card.id}/article.pdf`);
  const isPython = card.language === 'python';
  return (
    <div
      className={
        styles.cardFace + ' ' + styles.cardFront + (needsPlugin ? ' figcode-card-locked' : '')
      }
    >
      <div className={styles.cardTopLabel}>
        {isPython ? (
          <span className={styles.langBadgePy}>Python</span>
        ) : (
          <span className={styles.langBadgeR}>R</span>
        )}
        {card.title}
        {needsPlugin && <span className="figcode-card-locked-badge">需安装插件</span>}
      </div>
      <div className={styles.cardImage}>
        <img src={imgSrc} alt={card.title} loading="lazy" />
        {needsPlugin && <div className="figcode-card-locked-overlay" />}
      </div>
      <div className={styles.cardInfo}>
        <div className={styles.cardTitleRow}>
          <h3>{card.subtitle}</h3>
          <div className={styles.cardBtns}>
            <a
              className={styles.cardMiniBtn}
              href={docHtmlHref}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
            >
              HTML
            </a>
            <a
              className={styles.cardMiniBtn}
              href={docPdfHref}
              download
              onClick={(e) => e.stopPropagation()}
            >
              PDF
            </a>
            <a
              className={styles.cardMiniBtnPrimary}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (needsPlugin && onInstall) {
                  onInstall(card.id);
                } else {
                  onRunClick(card);
                }
              }}
            >
              {needsPlugin ? '安装插件' : '在线绘图'}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function FigCardComponent({
  card,
  onSelect,
  isSelected,
  onRunClick,
  needsPlugin,
  onInstall,
}: {
  card: FigCard;
  onSelect: (c: FigCard) => void;
  isSelected: boolean;
  onRunClick: (card: FigCard) => void;
  needsPlugin?: boolean;
  onInstall?: (cardId: string) => void;
}) {
  return (
    <div
      className={`${styles.cardWrapper} ${isSelected ? styles.cardSelected : ''}`}
      id={card.id}
      data-figcard-id={card.id}
    >
      <div
        className={styles.card}
        onClick={() => onSelect(card)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(card);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <CardFront
          card={card}
          onRunClick={onRunClick}
          needsPlugin={needsPlugin}
          onInstall={onInstall}
        />
      </div>
    </div>
  );
}

function TutorialLinkSection({ card }: { card: FigCard }): React.ReactElement | null {
  const [docInfo, setDocInfo] = useState<{
    title: string;
    domain?: string;
    minutes?: number;
  } | null>(null);
  const tutorialUrl = card.tutorialUrl;
  useEffect(() => {
    if (!tutorialUrl) {
      setDocInfo(null);
      return;
    }
    let cancelled = false;
    fetchCopilotIndex().then((idx) => {
      if (cancelled || !idx) return;
      const norm = tutorialUrl.replace(/\/$/, '');
      const doc = (idx.docs || []).find((d) => d.url === norm);
      if (!doc) {
        setDocInfo({ title: tutorialUrl });
        return;
      }
      const meta = doc.copilot || undefined;
      setDocInfo({
        title: doc.title || tutorialUrl,
        domain: meta?.domain,
        minutes: meta?.estimated_minutes,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tutorialUrl]);

  if (!tutorialUrl) return null;

  const handleClick = () => {
    // Treat clicking the tutorial link as 'started' for that doc — gives the
    // recommender signal that this user moved from the figure to the lesson.
    reportProgress('started', tutorialUrl);
  };

  return (
    <div className={styles.rightSection + ' ' + styles.rightTutorialLink}>
      <strong>📖 这张图属于哪节课</strong>
      <Link to={tutorialUrl} onClick={handleClick} className={styles.tutorialLinkCard}>
        <div className={styles.tutorialLinkTitle}>{docInfo?.title || tutorialUrl}</div>
        <div className={styles.tutorialLinkMeta}>
          {docInfo?.domain && <span className={styles.tutorialLinkBadge}>{docInfo.domain}</span>}
          {typeof docInfo?.minutes === 'number' && <span>约 {docInfo.minutes} 分钟</span>}
          <span className={styles.tutorialLinkArrow}>去学一下 →</span>
        </div>
      </Link>
    </div>
  );
}

// Online tool link — shows when card has onlineToolUrl pointing to a specific /tools?tool=xxx
function OnlineToolSection({ card }: { card: FigCard }): React.ReactElement | null {
  const url = card.onlineToolUrl;
  if (!url) return null;
  return (
    <div className={styles.rightSection + ' ' + styles.rightTutorialLink}>
      <strong>🧪 在 BioF3 上跑这个分析</strong>
      <Link to={url} className={styles.tutorialLinkCard}>
        <div className={styles.tutorialLinkTitle}>点击打开在线工具，上传你的数据直接跑</div>
        <div className={styles.tutorialLinkMeta}>
          <span className={styles.tutorialLinkArrow}>去试一下 →</span>
        </div>
      </Link>
    </div>
  );
}

function RightPanel({ card }: { card: FigCard | null }) {
  if (!card) {
    return (
      <aside className={styles.rightPanel}>
        <div className={styles.rightEmpty}>
          <p>点击卡片查看详情</p>
        </div>
      </aside>
    );
  }
  return (
    <aside className={styles.rightPanel}>
      <div className={styles.rightContent}>
        <span className={styles.badge}>{card.category}</span>
        <h3>{card.title}</h3>
        <p className={styles.rightSubtitle}>{card.subtitle}</p>

        <div className={styles.rightSection}>
          <strong>解决的生物学问题</strong>
          <p>{card.biologicalQuestion}</p>
        </div>

        <div className={styles.rightSection}>
          <strong>应用场景</strong>
          <ul className={styles.scenarioList}>
            {card.scenarios.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>

        <div className={styles.rightSection}>
          <strong>输入格式</strong>
          <p>{card.inputFormat}</p>
        </div>

        <div className={styles.rightSection}>
          <strong>关键参数</strong>
          <ul className={styles.paramList}>
            {card.keyParams.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>

        <div className={styles.rightSection}>
          <strong>依赖包</strong>
          <div className={styles.pkgList}>
            {card.packages.map((pkg) => (
              <span key={pkg} className={styles.pkgTag}>
                {pkg}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.rightSection}>
          <div className={styles.backHeader}>
            <strong>代码</strong>
            <CopyButton text={card.code} />
          </div>
          <pre className={styles.codeBlock}>
            <code>{card.code}</code>
          </pre>
        </div>

        {/* 桌面端已移除教程入口，TutorialLinkSection / OnlineToolSection 不再渲染。
            组件定义保留在文件中，如需恢复取消下面注释即可。 */}
        {/* <TutorialLinkSection card={card} /> */}
        {/* <OnlineToolSection card={card} /> */}
      </div>
    </aside>
  );
}

export default function FigCode(): React.ReactElement {
  const [filter, setFilter] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [langFilter, setLangFilter] = useState<'all' | 'r' | 'python'>('all');
  const [selected, setSelected] = useState<FigCard | null>(null);
  const [modalCard, setModalCard] = useState<FigCard | null>(null);
  // Desktop: 卡片插件安装状态 { cardId: { installed, needsPlugin, ... } }
  const [cardStatuses, setCardStatuses] = useState<
    Record<
      string,
      { installed: boolean; needsPlugin: boolean; pluginId?: string; title?: string; size?: number }
    >
  >({});
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 260;
    const saved = localStorage.getItem('biof3-figcode-left-w');
    return saved ? parseInt(saved, 10) : 260;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 260;
    const saved = localStorage.getItem('biof3-figcode-right-w');
    return saved ? parseInt(saved, 10) : 260;
  });

  // Desktop: 查询所有卡片的插件安装状态
  useEffect(() => {
    if (typeof window === 'undefined' || !window.biof3Desktop?.figcode) return;
    const allIds = figCards.map((c) => c.id);
    window.biof3Desktop.figcode
      .cardStatus(allIds)
      .then((result) => {
        if (result.ok && result.statuses) setCardStatuses(result.statuses);
      })
      .catch(() => {});
  }, []);

  // 安装卡片插件 → 打开插件商店
  const handleInstallPlugin = useCallback((cardId: string) => {
    // 触发打开插件商店（通过自定义事件，DesktopToolbar 监听）
    window.dispatchEvent(new CustomEvent('biof3:open-plugin-store', { detail: { cardId } }));
  }, []);

  const onResizeLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftWidth;
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(160, Math.min(400, startW + (ev.clientX - startX)));
        setLeftWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setLeftWidth((w) => {
          localStorage.setItem('biof3-figcode-left-w', String(w));
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [leftWidth]
  );

  const onResizeRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = rightWidth;
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(180, Math.min(450, startW - (ev.clientX - startX)));
        setRightWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setRightWidth((w) => {
          localStorage.setItem('biof3-figcode-right-w', String(w));
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [rightWidth]
  );

  // Pre-compute the active stage's card-id set for fast lookup
  const activeStage = stageFilter ? stages.find((s) => s.id === stageFilter) : null;
  const activeStageIds = activeStage ? new Set(activeStage.cardIds) : null;

  const filtered = figCards.filter((c) => {
    if (filter && c.category !== filter) return false;
    if (activeStageIds && !activeStageIds.has(c.id)) return false;
    if (langFilter === 'r' && c.language === 'python') return false;
    if (langFilter === 'python' && c.language !== 'python') return false;
    return true;
  });

  // Default to showing the first card's detail when the user lands without
  // explicitly picking one (and without a #hash deep-link). Runs once on mount
  // so it never fights the user's later clicks or hash navigation.
  useEffect(() => {
    if (selected) return;
    const hash =
      typeof window !== 'undefined' && window.location.hash
        ? window.location.hash.replace(/^#/, '')
        : '';
    if (hash && figCards.some((c) => c.id === hash)) return; // hash effect handles it
    if (filtered.length > 0) setSelected(filtered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunClick = useCallback((card: FigCard) => {
    setModalCard(card);
    // Phase α — clicking 'Run' counts as a completion for the card.
    reportProgress('completed', '/figcode#' + card.id);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalCard(null);
  }, []);

  // FIGCODE_ACT_v1: when AI dispatches a code-replace event, auto-open RunModal if needed
  useEffect(() => {
    const onReplace = () => {
      // If a card is selected but RunModal is not open, open it on the selected card
      if (selected && !modalCard) {
        setModalCard(selected);
      }
    };
    window.addEventListener('biof3:figcode-replace-code', onReplace);
    return () => window.removeEventListener('biof3:figcode-replace-code', onReplace);
  }, [selected, modalCard]);

  // Auto-select card from URL hash, e.g. /figcode#volcano (used by Copilot navigations)
  useEffect(() => {
    const applyHash = () => {
      const hash =
        typeof window !== 'undefined' && window.location.hash
          ? window.location.hash.replace(/^#/, '')
          : '';
      if (!hash) return;
      const card = figCards.find((c) => c.id === hash);
      if (card) {
        setSelected(card);
        // Smoothly scroll the card into view
        setTimeout(() => {
          try {
            const el = document.querySelector(`[data-figcard-id="${card.id}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch {}
        }, 100);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  // Open Run modal on demand (Copilot can fire this directly or via sessionStorage)
  useEffect(() => {
    const tryOpen = (cardId: string) => {
      const card = figCards.find((c) => c.id === cardId);
      if (!card) return;
      setSelected(card);
      setModalCard(card);
      setTimeout(() => {
        try {
          const el = document.querySelector(`[data-figcard-id="${card.id}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {}
      }, 100);
    };

    // Check for a pending intent from cross-page navigation
    try {
      const pending = sessionStorage.getItem('biof3_pending_figcode_open');
      if (pending) {
        sessionStorage.removeItem('biof3_pending_figcode_open');
        // Wait one tick so the figCards array is rendered
        setTimeout(() => tryOpen(pending), 200);
      }
    } catch {}

    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail?.cardId;
      if (id) tryOpen(id);
    };
    window.addEventListener('biof3:figcode-open-run', onOpen as EventListener);
    return () => window.removeEventListener('biof3:figcode-open-run', onOpen as EventListener);
  }, []);

  // Push the currently focused FigCode tool into Copilot context.
  // Priority: open RunModal (用户主动跑) > 右侧详情 selected > 无
  useEffect(() => {
    const active = modalCard || selected;
    if (active) {
      const summaryBits: string[] = [];
      if (active.subtitle) summaryBits.push(active.subtitle);
      if (active.category) summaryBits.push('分类: ' + active.category);
      if (active.inputFormat) summaryBits.push('输入: ' + active.inputFormat);
      if (active.biologicalQuestion)
        summaryBits.push('回答的生物学问题: ' + active.biologicalQuestion);
      if (active.keyParams && active.keyParams.length)
        summaryBits.push('关键参数: ' + active.keyParams.join(', '));
      if (active.packages && active.packages.length)
        summaryBits.push('R 包: ' + active.packages.join(', '));
      const synopsis =
        (active.description || '') + (summaryBits.length ? '\n' + summaryBits.join('\n') : '');

      setCopilotContext({
        page: 'figcode',
        pageTitle: active.title + (active.subtitle ? ' · ' + active.subtitle : ''),
        plotName: active.title,
        codeContent: active.code,
        pageContent: synopsis,
      });
    } else {
      // No card focused — clear figcode-specific bits but keep page='figcode'
      setCopilotContext({
        page: 'figcode',
        pageTitle: 'FigCode — SCI 绘图代码集',
        plotName: undefined,
        codeContent: undefined,
        pageContent: undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, modalCard?.id]);

  return (
    <>
      <PageHeader
        title="FigCode"
        subtitle="SCI 论文常见图类型的可复制代码集合"
        icon="image"
        breadcrumb={[{ label: '首页', href: '/' }, { label: 'FigCode' }]}
      />
      {selected && (
        <CopilotProgressTracker resource={'/figcode#' + selected.id} autoComplete="never" />
      )}
      <main className={styles.page}>
        <section
          className={styles.layout}
          style={{ gridTemplateColumns: `${leftWidth}px 4px 1fr 4px ${rightWidth}px` }}
        >
          {/* Left sidebar */}
          <nav className={styles.sidebar}>
            <div className={styles.sidebarMain}>
              <div className={styles.langFilter}>
                <button
                  className={`${styles.langChip} ${langFilter === 'all' ? styles.langChipActive : ''}`}
                  onClick={() => setLangFilter('all')}
                >
                  全部
                </button>
                <button
                  className={`${styles.langChip} ${langFilter === 'r' ? styles.langChipActive : ''}`}
                  onClick={() => setLangFilter('r')}
                >
                  R
                </button>
                <button
                  className={`${styles.langChip} ${langFilter === 'python' ? styles.langChipActive : ''}`}
                  onClick={() => setLangFilter('python')}
                >
                  Python
                </button>
              </div>
              <div className={styles.sidebarLabel}>分析阶段</div>
              <ul className={styles.sidebarList}>
                <li>
                  <button
                    className={`${styles.sidebarBtn} ${!stageFilter ? styles.active : ''}`}
                    onClick={() => setStageFilter(null)}
                    title="不按阶段筛选"
                  >
                    全部阶段 <span className={styles.count}>{figCards.length}</span>
                  </button>
                </li>
                {stages.map((s) => {
                  const ids = new Set(s.cardIds);
                  const n = figCards.filter((c) => ids.has(c.id)).length;
                  return (
                    <li key={s.id}>
                      <button
                        className={`${styles.sidebarBtn} ${stageFilter === s.id ? styles.active : ''}`}
                        onClick={() => setStageFilter(stageFilter === s.id ? null : s.id)}
                        title={s.description}
                      >
                        {s.label} <span className={styles.count}>{n}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className={styles.sidebarLabel}>分类筛选</div>
              <ul className={styles.sidebarList}>
                <li>
                  <button
                    className={`${styles.sidebarBtn} ${!filter ? styles.active : ''}`}
                    onClick={() => setFilter(null)}
                  >
                    全部 <span className={styles.count}>{figCards.length}</span>
                  </button>
                </li>
                {categories.map((cat) => {
                  const n = figCards.filter((c) => c.category === cat).length;
                  return (
                    <li key={cat}>
                      <button
                        className={`${styles.sidebarBtn} ${filter === cat ? styles.active : ''}`}
                        onClick={() => setFilter(cat)}
                      >
                        {cat} <span className={styles.count}>{n}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className={styles.sidebarQrcode}>
              <aside className="biof3-sidebar-wechat">
                <img
                  src={useBaseUrl('/img/shengxinf3-qrcode.jpg')}
                  alt="生信F3微信公众号二维码"
                  loading="lazy"
                />
                <div>
                  <strong>扫码关注【生信F3】</strong>
                  <p>获取文章完整内容，分享生物信息学最新知识。</p>
                </div>
              </aside>
            </div>
          </nav>

          {/* Left resize handle */}
          <div className={styles.resizeHandle} onMouseDown={onResizeLeft} title="拖拽调整宽度" />

          {/* Center: card grid */}
          <div className={styles.center}>
            {activeStage && (
              <div className={styles.stageBanner}>
                <div className={styles.stageBannerLabel}>分析阶段</div>
                <div className={styles.stageBannerTitle}>{activeStage.label}</div>
                <div className={styles.stageBannerDesc}>{activeStage.description}</div>
                <div className={styles.stageBannerCount}>共 {filtered.length} 张图卡</div>
              </div>
            )}
            <div className={styles.grid}>
              {filtered.map((card) => {
                const status = cardStatuses[card.id];
                const needsPlugin = status?.needsPlugin && !status.installed;
                return (
                  <FigCardComponent
                    key={card.id}
                    card={card}
                    onSelect={setSelected}
                    isSelected={selected?.id === card.id}
                    onRunClick={handleRunClick}
                    needsPlugin={needsPlugin}
                    onInstall={handleInstallPlugin}
                  />
                );
              })}
            </div>
          </div>

          {/* Right resize handle */}
          <div className={styles.resizeHandle} onMouseDown={onResizeRight} title="拖拽调整宽度" />

          {/* Right panel */}
          <RightPanel card={selected} />
        </section>
      </main>

      {/* Run Modal */}
      <RunModal
        isOpen={modalCard !== null}
        onClose={handleCloseModal}
        title={modalCard ? `${modalCard.subtitle} — 在线绘图` : ''}
        initialCode={modalCard?.code ?? ''}
        cardId={modalCard?.id}
        subtitle={modalCard?.subtitle}
        slogan={modalCard?.slogan}
        language={modalCard?.language || 'r'}
        figLayout={modalCard?.figLayout || 'default'}
        packages={modalCard?.packages}
      />
    </>
  );
}
