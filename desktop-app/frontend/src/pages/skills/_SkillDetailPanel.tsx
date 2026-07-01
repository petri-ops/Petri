import React, { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Skill, parseCoverageLink, skillsData } from './_data';
import styles from './skills.module.css';
import 'highlight.js/styles/github.css';

// 桌面版无 Docusaurus baseUrl，useBaseUrl 直接返回原路径
function useBaseUrl(path: string): string {
  return path;
}

// rehype-sanitize: 允许 className(代码高亮需要),但仍过滤 script / on* 事件
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
    div: [...(defaultSchema.attributes?.div || []), ['className']],
  },
};

interface Props {
  skill: Skill;
  onClose: () => void;
}

export function SkillDetailPanel({ skill, onClose }: Props) {
  const [md, setMd] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const mdUrl = useBaseUrl(skill.md_path);
  const zipUrl = useBaseUrl(skill.zip_path);

  // ESC 关闭
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

  // 拉 SKILL.md(本站静态资源,无网络依赖问题)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(mdUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        setMd(text);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mdUrl]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const source = skillsData.sources.find((s) => s.id === skill.source_id) || skillsData.sources[0];
  const coverage = skill.biof3_coverage;
  const zh = skill.biof3_zh;

  return (
    <div className={styles.detailOverlay} onClick={handleOverlayClick}>
      <div className={styles.detailPanel}>
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleArea}>
            <h2 className={styles.detailTitle}>
              {skill.title}
              {zh?.title_zh && (
                <span style={{ fontSize: 14, color: '#6b7280', marginLeft: 8 }}>
                  {' '}
                  · {zh.title_zh}
                </span>
              )}
            </h2>
            <div className={styles.detailMeta}>
              <span>📂 {skill.category}</span>
              {skill.primary_tool && <span>🔧 {skill.primary_tool}</span>}
              {skill.tool_type && <span>📦 {skill.tool_type}</span>}
              <span>📄 {skill.line_count} 行</span>
              <span>
                🔖 上游 commit <code>{source.commit}</code>
              </span>
            </div>
          </div>
          <div className={styles.detailActions}>
            <a href={zipUrl} download className={`${styles.detailBtn} ${styles.detailBtnPrimary}`}>
              ⬇ 下载 zip
            </a>
            <a href={skill.github_url} target="_blank" rel="noopener" className={styles.detailBtn}>
              ↗ GitHub
            </a>
            <button className={styles.detailClose} onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </div>

        <div className={styles.detailBody}>
          {/* 中文导读 wrapper(显式分离,作者编辑加注)*/}
          {zh && (
            <div className={styles.zhWrapper}>
              <div className={styles.zhWrapperTitle}>📝 BioF3 中文导读</div>
              <div className={styles.zhWrapperContent}>
                <p>{zh.summary_zh}</p>
                {zh.biof3_tip && (
                  <p style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #a7f3d0' }}>
                    💡 <strong>BioF3 提示</strong>:
                    <span
                      dangerouslySetInnerHTML={{
                        __html: zh.biof3_tip.replace(
                          /\[([^\]]+)\]\(([^)]+)\)/g,
                          '<a href="$2">$1</a>'
                        ),
                      }}
                    />
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 覆盖度提示 */}
          {coverage && (
            <div className={styles.coverageInDetail}>
              <strong>BioF3 覆盖</strong>(质量:{coverage.match_quality}):
              {coverage.covered_by.map((raw) => {
                const link = parseCoverageLink(raw);
                return link.href ? (
                  <a key={raw} href={link.href} className={styles.coverageLink}>
                    {link.label}
                  </a>
                ) : (
                  <span key={raw} className={styles.coverageLink}>
                    {link.label}
                  </span>
                );
              })}
              {coverage.notes && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>{coverage.notes}</div>
              )}
            </div>
          )}

          {/* SKILL.md 原文渲染 */}
          {loading && <div className={styles.mdLoading}>加载中...</div>}
          {err && <div className={styles.mdLoading}>加载失败: {err}</div>}
          {!loading && !err && (
            <div className={styles.markdownBody}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
              >
                {md}
              </ReactMarkdown>
            </div>
          )}

          {/* 强制 attribution(MIT 合规)*/}
          <div className={styles.detailAttribution}>
            📚 <strong>内容来源</strong>:{source.name} ({source.license} License)
            <br />
            原作者:GPTomics 社区贡献者(
            <a href={source.url} target="_blank" rel="noopener">
              仓库
            </a>
            )<br />
            上游链接:
            <a href={skill.github_url} target="_blank" rel="noopener">
              {skill.github_url.replace('https://github.com/', '')}
            </a>
            <br />
            上游 commit:<code>{source.commit}</code>(同步于 {source.fetched_at.slice(0, 10)})<br />
            完整体验:用官方安装脚本(Claude Code / Codex / Gemini / OpenCode / OpenClaw),详见{' '}
            <a href={source.url} target="_blank" rel="noopener">
              上游仓库 README
            </a>
            <br />
            BioF3 仅做内容索引、分类、中文导览、镜像下载,不修改原文,不参与 skill 创作。
          </div>
        </div>
      </div>
    </div>
  );
}
