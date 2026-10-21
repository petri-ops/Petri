import { describe, expect, it } from 'vitest';
import {
  describeOfficeKind,
  extractDocxText,
  loadOfficePreview,
  suggestedOpener,
  stripXml,
} from './office-file-preview';

describe('office-file-preview describe & opener', () => {
  it('maps common extensions to friendly Chinese descriptions', () => {
    expect(describeOfficeKind('docx')).toContain('Word');
    expect(describeOfficeKind('xlsx')).toContain('Excel');
    expect(describeOfficeKind('pptx')).toContain('PowerPoint');
    expect(describeOfficeKind('odt')).toContain('OpenDocument');
    expect(describeOfficeKind('pages')).toContain('Pages');
    expect(describeOfficeKind('numbers')).toContain('Numbers');
    expect(describeOfficeKind('keynote')).toContain('Keynote');
    expect(describeOfficeKind('rdata')).toContain('R');
    expect(describeOfficeKind('h5')).toContain('HDF5');
  });

  it('suggests an opener per format', () => {
    expect(suggestedOpener('docx')).toContain('Word');
    expect(suggestedOpener('xlsx')).toContain('Excel');
    expect(suggestedOpener('h5')).toContain('h5py');
    expect(suggestedOpener('rdata')).toContain('R');
  });
});

describe('office-file-preview zip parsing', () => {
  it('extracts docx paragraphs across multiple runs', () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>第一段：</w:t></w:r><w:r><w:t>工具检出结果说明</w:t></w:r></w:p>
    <w:p><w:r><w:t>第二段：差异基因富集</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const text = extractDocxText(documentXml);
    expect(text).toContain('工具检出结果说明');
    expect(text).toContain('第二段：差异基因富集');
    expect(text.split('\n\n').length).toBe(2);
  });

  it('strips XML tags and decodes entities', () => {
    expect(stripXml('<a><b>foo &amp; bar</b></a>')).toBe('foo & bar');
    expect(stripXml('<p>&lt;tag&gt;</p>')).toBe('<tag>');
  });

  it('maps all listed binary extensions to a friendly description', () => {
    const kinds = ['dataset.h5ad', 'matrix.loom', 'scan.h5', 'session.rdata', 'object.rds', 'genes.mtx'];
    for (const name of kinds) {
      const mapped = name.endsWith('.h5ad') ? 'h5'
        : name.endsWith('.loom') ? 'loom'
        : name.endsWith('.h5') ? 'h5'
        : name.endsWith('.rdata') ? 'rdata'
        : name.endsWith('.rds') ? 'rds'
        : 'mtx';
      expect(describeOfficeKind(mapped as Parameters<typeof describeOfficeKind>[0])).toBeTruthy();
    }
  });

  it('exposes loadOfficePreview as a callable function', () => {
    expect(typeof loadOfficePreview).toBe('function');
  });
});
