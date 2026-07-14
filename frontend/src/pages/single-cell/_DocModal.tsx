import React, { useCallback, useRef } from 'react';

interface DocSection {
  category: string;
  title: string;
  subtitle: string;
  biologicalQuestion: string;
  scenarios: string[];
  inputFormat: string;
  keyParams: string[];
  packages: string[];
  imageUrl?: string;
}

interface Props {
  meta: DocSection;
  onClose: () => void;
}

/**
 * In-app HTML document viewer for plot/file metadata.
 * Mirrors FigCode tutorial doc style.
 */
export function DocModal({ meta, onClose }: Props) {
  const docRef = useRef<HTMLDivElement>(null);

  const handleDownloadPdf = useCallback(async () => {
    if (!docRef.current) return;
    try {
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(docRef.current, { scale: 2, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = canvas.width / canvas.height;
      const w = pageW - 20;
      const h = w / ratio;
      const y = 10;
      if (h <= pageH - 20) {
        pdf.addImage(imgData, 'PNG', 10, y, w, h);
      } else {
        // Multi-page
        const totalH = h;
        let drawn = 0;
        while (drawn < totalH) {
          if (drawn > 0) pdf.addPage();
          pdf.addImage(imgData, 'PNG', 10, y - drawn, w, h);
          drawn += pageH - 20;
        }
      }
      pdf.save(`${meta.title}.pdf`);
    } catch {
      // Fallback: print
      window.print();
    }
  }, [meta]);

  return (
    <div className="sc-modal-overlay" onClick={onClose}>
      <div
        className="sc-modal sc-doc-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720, width: '90vw' }}
      >
        <div className="sc-modal-header">
          <div>
            <span className="sc-info-badge" style={{ marginBottom: 4 }}>
              {meta.category}
            </span>
            <h2 className="sc-modal-title" style={{ marginTop: 4 }}>
              {meta.title}
            </h2>
            <div style={{ fontSize: 11, color: 'var(--biof3-text-muted)', marginTop: 2 }}>{meta.subtitle}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="sc-btn sc-btn-sm" onClick={handleDownloadPdf}>
              下载 PDF
            </button>
            <button className="sc-modal-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div className="sc-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <div ref={docRef} className="sc-doc-content">
            {meta.imageUrl && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <img
                  src={meta.imageUrl}
                  alt={meta.title}
                  style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--biof3-border)' }}
                />
              </div>
            )}

            <h3 className="sc-doc-h3">解决的生物学问题</h3>
            <p className="sc-doc-p">{meta.biologicalQuestion}</p>

            <h3 className="sc-doc-h3">应用场景</h3>
            <ul className="sc-doc-ul">
              {meta.scenarios.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>

            <h3 className="sc-doc-h3">输入格式</h3>
            <p className="sc-doc-p">{meta.inputFormat}</p>

            <h3 className="sc-doc-h3">关键参数 / 字段</h3>
            <ul className="sc-doc-ul sc-doc-code-list">
              {meta.keyParams.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>

            <h3 className="sc-doc-h3">依赖包</h3>
            <div className="sc-doc-pkgs">
              {meta.packages.length > 0 ? (
                meta.packages.map((pkg) => (
                  <span key={pkg} className="sc-info-pkg-tag">
                    {pkg}
                  </span>
                ))
              ) : (
                <span style={{ fontSize: 11, color: 'var(--biof3-text-muted)' }}>无</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
