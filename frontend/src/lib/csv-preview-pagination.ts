/**
 * csv-preview-pagination — UI-454（G0-BIO BIO-2）静态 CSV 预览的本地分页。
 *
 * 静态预览是无交互清单时的降级路径（没有服务端分页通道可复用），文件
 * 全文已在前端（受预览文本预算有界），此前只渲染前 24 行——本模块把
 * 「有界文本内的全部行」按 50 行/页翻页展示；页码越界钳制到有效域，
 * 不渲染空页。数据的截断口径（预览文本预算）由调用方负责如实标注。
 */

export const CSV_PREVIEW_PAGE_SIZE = 50;

export function csvPreviewPageCount(totalRows: number): number {
  if (!Number.isFinite(totalRows) || totalRows <= 0) return 1;
  return Math.ceil(totalRows / CSV_PREVIEW_PAGE_SIZE);
}

export function csvPreviewPageRows<T>(rows: T[], page: number): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const last = csvPreviewPageCount(rows.length) - 1;
  const clamped = Math.min(Math.max(page || 0, 0), Math.max(last, 0));
  return rows.slice(clamped * CSV_PREVIEW_PAGE_SIZE, (clamped + 1) * CSV_PREVIEW_PAGE_SIZE);
}
