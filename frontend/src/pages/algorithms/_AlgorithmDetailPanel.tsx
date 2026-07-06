import React, { useEffect, useCallback } from 'react';
import { AlgorithmCard } from './_data';
import { VolcanoExplorer } from './_VolcanoExplorer';
import styles from './algorithms.module.css';

interface Props {
  card: AlgorithmCard;
  onClose: () => void;
}

export function AlgorithmDetailPanel({ card, onClose }: Props) {
  // ESC 关闭 + 锁滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return (
    <div className={styles.detailOverlay} onClick={handleOverlayClick}>
      <div className={styles.detailPanel}>
        {/* Header */}
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderLeft}>
            <h2>{card.name}</h2>
            <div className={styles.nameZh}>{card.name_zh}</div>
          </div>
          <button className={styles.detailClose} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={styles.detailBody}>
          {/* 一句话 + 原理合并为紧凑块 */}
          <div className={styles.detailSectionCompact}>
            <div className={styles.oneLinerFull}>{card.one_liner}</div>
            {card.principle && <div className={styles.principleText}>{card.principle}</div>}
          </div>

          {/* 公式 */}
          <div className={styles.detailSectionCompact}>
            <h3 className={styles.detailSectionTitle}>公式</h3>
            <pre className={styles.formulaBlock}>{card.formula}</pre>
          </div>

          {/* 交互式探索器（仅 DESeq2） */}
          {card.id === 'deseq2-nb' && (
            <div className={styles.detailSectionCompact}>
              <h3 className={styles.detailSectionTitle}>交互式探索</h3>
              <VolcanoExplorer />
            </div>
          )}

          {/* 流程 */}
          <div className={styles.detailSectionCompact}>
            <h3 className={styles.detailSectionTitle}>流程</h3>
            <div className={styles.flowDiagram}>
              {card.flow.map((step, i) => (
                <React.Fragment key={i}>
                  <span className={styles.flowStep}>{step}</span>
                  {i < card.flow.length - 1 && <span className={styles.flowArrow}>→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* 关键参数 + 适用场景合并为两列 */}
          <div className={styles.twoColGrid}>
            <div>
              <h3 className={styles.detailSectionTitle}>关键参数</h3>
              <table className={styles.paramTable}>
                <tbody>
                  {card.key_params.map((p, i) => (
                    <tr key={i}>
                      <td>{p.name}</td>
                      <td>{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className={styles.detailSectionTitle}>适用场景</h3>
              <div className={styles.suitabilityCompact}>
                <div className={styles.suitGood}>
                  {card.suitable.map((s, i) => (
                    <div key={i}>✅ {s}</div>
                  ))}
                </div>
                <div className={styles.suitBad}>
                  {card.not_suitable.map((s, i) => (
                    <div key={i}>❌ {s}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 相关链接 */}
          <div className={styles.detailSectionCompact}>
            <div className={styles.relatedLinks}>
              {card.related_tool && (
                <a
                  href={card.related_tool}
                  className={`${styles.relatedLink} ${styles.relatedLinkTool}`}
                >
                  🧪 在线体验
                </a>
              )}
              {card.related_tutorial && (
                <a
                  href={card.related_tutorial}
                  className={`${styles.relatedLink} ${styles.relatedLinkTutorial}`}
                >
                  📖 看教程
                </a>
              )}
              {card.related_code && (
                <a
                  href={`/${card.related_code}`}
                  className={`${styles.relatedLink} ${styles.relatedLinkCode}`}
                >
                  💻 看代码
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
