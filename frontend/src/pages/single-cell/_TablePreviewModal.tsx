import React, { useState, useEffect, useMemo } from 'react';
import { getApiPrefix } from './_config';
import { getAuthHeaders } from './_auth';

interface Props {
  fileName: string;
  fileUrl: string;
  onClose: () => void;
}

export function TablePreviewModal({ fileName, fileUrl, onClose }: Props) {
  const [raw, setRaw] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Fetch CSV via R Server proxy (avoids CORS)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const proxyUrl = (() => {
      return `${getApiPrefix()}/proxy-file?url=${encodeURIComponent(fileUrl)}`;
    })();
    fetch(proxyUrl, { headers: getAuthHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) {
          setRaw(text);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // Parse CSV (simple — handles quoted fields)
  const { headers, rows } = useMemo(() => {
    if (!raw) return { headers: [], rows: [] };
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const parseLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i++;
            } else inQ = false;
          } else cur += c;
        } else {
          if (c === ',') {
            out.push(cur);
            cur = '';
          } else if (c === '"') inQ = true;
          else cur += c;
        }
      }
      out.push(cur);
      return out;
    };
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
  }, [raw]);

  // Filter
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(q)));
  }, [rows, search]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="sc-modal-overlay" onClick={onClose}>
      <div
        className="sc-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1100, width: '95vw', maxHeight: '90vh' }}
      >
        <div className="sc-modal-header">
          <div>
            <h2 className="sc-modal-title">{fileName}</h2>
            <div style={{ fontSize: 11, color: 'var(--biof3-text-muted)', marginTop: 2 }}>
              {loading
                ? '加载中...'
                : err
                  ? `错误: ${err}`
                  : `${rows.length} 行 · ${headers.length} 列`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <a className="sc-btn sc-btn-sm" href={fileUrl} download={fileName}>
              下载
            </a>
            <button className="sc-modal-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div
          className="sc-modal-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}
        >
          <input
            className="sc-form-input"
            placeholder="搜索（在所有列中匹配）..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />

          {loading && (
            <div className="sc-empty">
              <div className="sc-empty-desc">加载中...</div>
            </div>
          )}
          {err && (
            <div className="sc-error-box">
              <strong>加载失败</strong>
              <pre>{err}</pre>
            </div>
          )}

          {!loading && !err && (
            <>
              <div
                style={{
                  flex: 1,
                  overflow: 'auto',
                  border: '1px solid var(--biof3-border)',
                  borderRadius: 6,
                  maxHeight: '60vh',
                }}
              >
                <table className="sc-table">
                  <thead>
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((cell, ci) => (
                          <td key={ci}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--biof3-text-secondary)',
                  }}
                >
                  <span>
                    第 {page + 1} / {totalPages} 页 · 共 {filteredRows.length} 行
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="sc-btn sc-btn-sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      上一页
                    </button>
                    <button
                      className="sc-btn sc-btn-sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
