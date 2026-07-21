import { describe, expect, it } from 'vitest';
import { shouldOpenWithSystemApp } from './SimpleChat';

describe('SimpleChat file open policy', () => {
  it('opens office legacy / iWork / image formats with the system app', () => {
    expect(shouldOpenWithSystemApp('report.doc')).toBe(true);
    expect(shouldOpenWithSystemApp('legacy.xls')).toBe(true);
    expect(shouldOpenWithSystemApp('slides.ppt')).toBe(true);
    expect(shouldOpenWithSystemApp('scan.TIFF')).toBe(true);
    expect(shouldOpenWithSystemApp('iwork.pages')).toBe(true);
    expect(shouldOpenWithSystemApp('paper.rtf')).toBe(true);
    expect(shouldOpenWithSystemApp('book.epub')).toBe(true);
    expect(shouldOpenWithSystemApp('photo.heic')).toBe(true);
  });

  it('keeps R / scanpy binary data inside the app', () => {
    // No default macOS app can open these; auto-opening would just pop the
    // "Choose Application" dialog. Users with RStudio / scanpy can still
    // open them manually from the preview card.
    expect(shouldOpenWithSystemApp('analysis.RData')).toBe(false);
    expect(shouldOpenWithSystemApp('seurat.rds')).toBe(false);
    expect(shouldOpenWithSystemApp('dataset.h5ad')).toBe(false);
    expect(shouldOpenWithSystemApp('matrix.mtx')).toBe(false);
    expect(shouldOpenWithSystemApp('anndata.h5')).toBe(false);
    expect(shouldOpenWithSystemApp('counts.hdf5')).toBe(false);
    expect(shouldOpenWithSystemApp('clusters.loom')).toBe(false);
  });

  it('keeps inline-previewable office documents inside the app', () => {
    expect(shouldOpenWithSystemApp('report.docx')).toBe(false);
    expect(shouldOpenWithSystemApp('results.xlsx')).toBe(false);
    expect(shouldOpenWithSystemApp('slides.pptx')).toBe(false);
    expect(shouldOpenWithSystemApp('draft.odt')).toBe(false);
    expect(shouldOpenWithSystemApp('table.ods')).toBe(false);
    expect(shouldOpenWithSystemApp('slides.odp')).toBe(false);
  });

  it('keeps browser-previewable and executable files inside the app', () => {
    expect(shouldOpenWithSystemApp('report.pdf')).toBe(false);
    expect(shouldOpenWithSystemApp('figure.svg')).toBe(false);
    expect(shouldOpenWithSystemApp('script.sh')).toBe(false);
    expect(shouldOpenWithSystemApp('archive.zip')).toBe(false);
  });
});
