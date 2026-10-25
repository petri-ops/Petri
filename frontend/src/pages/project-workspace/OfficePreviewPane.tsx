// ============================================================
// OfficePreviewPane — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2920-2973 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
//
// BLOCK-254 P7 — 文本段落/表格行的批注入口：Office 预览没有版面几何（文字是抽取出来的），
// 所以批注锚在**段落序号 / 行号**上，而不是归一化矩形；宽度/窗口变化不影响复现。
// 没有 onAnnotate* 回调时（例如只读场景）不渲染按钮，避免死按钮。
// ============================================================
import React from 'react';
import { type OfficePreviewModel } from '@/lib/office-file-preview';
import styles from '../project-workspace.module.css';
import { PreviewAssets } from './PreviewAssets';
import { TextBlock } from './TextBlock';

/** 段落批注上限：超出后只展示前 N 段，避免长文档把面板撑成无限列表。 */
const MAX_ANNOTATABLE_PARAGRAPHS = 120;
/** 单行 quote 上限（与契约 MAX_ANCHOR_QUOTE_CHARS 对齐，后端仍会二次校验）。 */
const MAX_ROW_QUOTE_CHARS = 500;

function splitParagraphs(text?: string): string[] {
  if (!text) return [];
  const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
  return clipped
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, MAX_ANNOTATABLE_PARAGRAPHS);
}

function ParagraphList({
  text,
  onAnnotate,
}: {
  text?: string;
  onAnnotate?: (paragraphIndex: number, quote: string) => void;
}): React.ReactElement | null {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return null;
  return (
    <div className={styles.workspaceOfficeParagraphs} data-testid="office-paragraphs">
      {paragraphs.map((paragraph, index) => (
        <div className={styles.workspaceOfficeParagraph} key={index} data-testid="office-paragraph">
          {onAnnotate && (
            <button
              type="button"
              className={styles.workspaceOfficeAnnotate}
              data-testid="office-paragraph-annotate"
              data-paragraph={index + 1}
              title={`为第 ${index + 1} 段添加批注`}
              onClick={() => onAnnotate(index, paragraph)}
            >
              批注
            </button>
          )}
          <p className={styles.workspaceOfficeParagraphText}>{paragraph}</p>
        </div>
      ))}
    </div>
  );
}

export function OfficePreviewPane({
  preview,
  onAssetOpen,
  onAnnotateParagraph,
  onAnnotateRow,
}: {
  preview: OfficePreviewModel;
  onAssetOpen: (url: string) => void;
  /** 段落批注（docx/pptx/odt/odp/rtf）：index 从 0 起，宿主负责换算成 1 起的锚点序号。 */
  onAnnotateParagraph?: (paragraphIndex: number, quote: string) => void;
  /** 表格行批注（xlsx/ods）：rowIndex 从 0 起，对应数据行。 */
  onAnnotateRow?: (rowIndex: number, quote: string) => void;
}): React.ReactElement {
  if (preview.sheet) {
    return (
      <div className={styles.workspaceOfficeSheet}>
        <div className={styles.workspaceOfficeHeader}>{preview.sheet.name}</div>
        <table>
          <tbody>
            {preview.sheet.rows.length === 0 && (
              <tr><td>未读取到任何行内容，建议在外部表格工具打开</td></tr>
            )}
            {preview.sheet.rows.map((row, idx) => (
              <tr key={idx}>
                {onAnnotateRow && (
                  <td className={styles.workspaceOfficeAnnotateCell}>
                    <button
                      type="button"
                      className={styles.workspaceOfficeAnnotate}
                      data-testid="office-row-annotate"
                      data-row={idx + 1}
                      title={`为表格第 ${idx + 1} 行添加批注`}
                      onClick={() => onAnnotateRow(idx, row.cells.filter(Boolean).join(' | ').slice(0, MAX_ROW_QUOTE_CHARS))}
                    >
                      批注
                    </button>
                  </td>
                )}
                {row.cells.map((cell, cellIdx) => (
                  <td key={cellIdx}>{cell || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {preview.sheet.rows.length >= 80 && (
          <p className={styles.workspaceOfficeHint}>仅展示前 80 行，完整内容请在外部工具打开。</p>
        )}
        <PreviewAssets assets={preview.assets} onAssetOpen={onAssetOpen} />
        <TextBlock text={preview.text} />
      </div>
    );
  }
  if (preview.contents && preview.contents.length > 0) {
    return (
      <div className={styles.workspaceOfficeListing}>
        <p className={styles.workspaceOfficeHint}>
          Apple iWork 容器列出了 {preview.contents.length} 个内嵌资源；如需完整版式，请在系统应用（Pages / Numbers / Keynote）中打开。
        </p>
        <ul>
          {preview.contents.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className={styles.workspaceOfficeDoc}>
      {onAnnotateParagraph ? (
        <ParagraphList text={preview.text} onAnnotate={onAnnotateParagraph} />
      ) : (
        <TextBlock text={preview.text} />
      )}
      <PreviewAssets assets={preview.assets} onAssetOpen={onAssetOpen} />
    </div>
  );
}
