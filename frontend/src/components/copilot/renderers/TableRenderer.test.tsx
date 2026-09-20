// ============================================================
// TableRenderer — P1.5 export action bar (UI-AGENTWB-006)
//
// Tests cover:
//   - Both buttons render for a valid table (CSV / Markdown)
//   - All five malformed payloads render the fallback path
//     with no action bar / no download buttons
//   - CSV byte format: BOM prefix, comma/semicolon escapes,
//     null cells become empty strings, numeric cells unquoted
//   - CSV MIME type from the Blob construction
//   - CSV filename: title slug + ISO timestamp segment
//   - Markdown format: `| col |`, `| --- |`, null cells empty
//   - Markdown MIME type
//   - Markdown filename mirrors the CSV slug
//   - Button aria-labels match the spec
//   - Download uses Blob + URL.createObjectURL + revokeObjectURL
//
// Pure helpers (`buildCsv`, `buildMarkdown`, `buildFilename`)
// are exported as top-level functions from the renderer so the
// byte-format tests do not need to mount React.
// ============================================================

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResultNode } from '../types';
import {
  buildCsv,
  buildFilename,
  buildMarkdown,
  TableRenderer,
} from './TableRenderer';

function makeValidNode(): ResultNode {
  return {
    id: 'table-p1-5',
    type: 'table',
    title: 'Cell counts',
    payload: {
      columns: ['gene', 'control', 'treated'],
      rows: [
        ['TP53', 10, 12],
        ['BRCA1', 20, 18],
        ['MYC', null, 35],
      ],
    },
    createdAt: '2026-08-15T07:30:00Z',
  };
}

type CapturedDownload = {
  blob: Blob;
  filename: string;
  anchor: HTMLAnchorElement;
};

function captureDownload(node: ResultNode, testId: string): CapturedDownload {
  const captured: CapturedDownload = {
    // Sentinel — replaced by the actual Blob created inside
    // the production path. The placeholder lets the type
    // stay non-null while the spy installs.
    blob: undefined as unknown as Blob,
    filename: '',
    anchor: undefined as unknown as HTMLAnchorElement,
  };

  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  // Track the revocations so we can assert them on the spy.
  const revoked: string[] = [];
  const urlSpy = vi.fn((blob: Blob) => {
    captured.blob = blob;
    return 'blob:mock-table-renderer-url';
  });
  const revokeSpy = vi.fn((url: string) => {
    revoked.push(url);
  });
  URL.createObjectURL = urlSpy;
  URL.revokeObjectURL = revokeSpy;

  // Spy on the anchor click so the production path's
  // `anchor.click()` does not actually navigate happy-dom.
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function mockClick(this: HTMLAnchorElement) {
      captured.anchor = this;
      captured.filename = this.download;
    });

  try {
    render(<TableRenderer node={node} />);
    fireEvent.click(screen.getByTestId(testId));
    // Expose the revocation log via the captured object.
    (captured as CapturedDownload & { revoked: string[] }).revoked = revoked;
    return captured;
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    clickSpy.mockRestore();
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TableRenderer — P1.5 CSV / Markdown export rows', () => {
  it('renders both CSV and Markdown buttons for a valid table', () => {
    render(<TableRenderer node={makeValidNode()} />);

    expect(
      screen.getByTestId('result-renderer-table-download-csv'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('result-renderer-table-download-markdown'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Download CSV')).toBeTruthy();
    expect(screen.getByLabelText('Download Markdown')).toBeTruthy();
  });

  it('does not render the CSV / Markdown buttons on the fallback path', () => {
    const malformedPayloads: Array<{ name: string; payload: unknown }> = [
      { name: 'missing-columns', payload: { rows: [] } },
      { name: 'wrong-column-type', payload: { columns: [1, 2, 3], rows: [] } },
      { name: 'wrong-row-shape', payload: { columns: ['g'], rows: [[true]] } },
      { name: 'empty-columns', payload: { columns: [], rows: [] } },
      { name: 'not-an-object', payload: 'this is not a table' },
    ];

    for (const { name, payload } of malformedPayloads) {
      const node: ResultNode = {
        id: `bad-${name}`,
        type: 'table',
        title: `Bad (${name})`,
        payload,
        createdAt: '2026-08-15T07:30:00Z',
      };
      const { container } = render(<TableRenderer node={node} />);

      expect(
        screen.getByTestId('result-renderer-table-fallback'),
      ).toBeTruthy();
      expect(screen.queryByLabelText('Download CSV')).toBeNull();
      expect(screen.queryByLabelText('Download Markdown')).toBeNull();
      expect(container.querySelectorAll('button').length).toBe(0);
      cleanup();
    }
  });
});

describe('TableRenderer — CSV format', () => {
  it('builds CSV with a UTF-8 BOM, header row, and numeric cells unquoted', () => {
    const csv = buildCsv(
      ['gene', 'control', 'treated'],
      [
        ['TP53', 10, 12],
        ['BRCA1', 20, 18],
      ],
    );

    // BOM prefix is mandatory for Excel / UTF-8 robustness.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('gene,control,treated');
    // Numeric cells remain unquoted — values are preserved as-is.
    expect(csv).toContain('TP53,10,12');
    expect(csv).toContain('BRCA1,20,18');
  });

  it('escapes cells containing commas, double quotes, and newlines', () => {
    const csv = buildCsv(['note'], [['has, comma']]);
    expect(csv).toContain('"has, comma"');

    const csvQuote = buildCsv(['note'], [['has "quote" inside']]);
    expect(csvQuote).toContain('"has ""quote"" inside"');

    const csvNewline = buildCsv(['note'], [['line one\nline two']]);
    expect(csvNewline).toContain('"line one\nline two"');
  });

  it('emits an empty string for null cells', () => {
    const csv = buildCsv(['gene', 'value'], [['TP53', null]]);
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    expect(lines[0]).toBe('gene,value');
    // After the comma, the row should end with nothing (no `null`,
    // no `—`, no quoted empty cell).
    expect(lines[1]).toBe('TP53,');
  });
});

describe('TableRenderer — Markdown format', () => {
  it('builds Markdown with header, separator, and body rows', () => {
    const md = buildMarkdown(
      ['gene', 'control', 'treated'],
      [
        ['TP53', 10, 12],
        ['BRCA1', 20, 18],
      ],
    );

    const lines = md.split('\n');
    expect(lines[0]).toBe('| gene | control | treated |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toBe('| TP53 | 10 | 12 |');
    expect(lines[3]).toBe('| BRCA1 | 20 | 18 |');
  });

  it('emits empty cells for null values in Markdown', () => {
    const md = buildMarkdown(['gene', 'value'], [['MYC', null]]);
    // The boundary between the cell and the closing pipe must be
    // two spaces surrounding an empty cell, never `—` or `null`.
    expect(md).toContain('| MYC |  |');
    expect(md).not.toContain('—');
    expect(md).not.toContain('null');
  });
});

describe('TableRenderer — filename', () => {
  it('uses a kebab-case title slug plus an ISO timestamp segment', () => {
    const csvName = buildFilename(
      'Cell counts',
      '2026-08-15T07:30:00Z',
      'csv',
    );
    expect(csvName).toBe('cell-counts-2026-08-15T07-30.csv');

    const mdName = buildFilename(
      'Cell counts',
      '2026-08-15T07:30:00Z',
      'md',
    );
    expect(mdName).toBe('cell-counts-2026-08-15T07-30.md');
  });

  it('falls back to `table-` prefix when the title is empty', () => {
    const csvName = buildFilename('', '2026-08-15T07:30:00Z', 'csv');
    expect(csvName).toMatch(/^table-2026-08-15T07-30\.csv$/);
  });

  it('strips unsafe characters from the title slug', () => {
    const csvName = buildFilename(
      'My / Weird * Title?',
      '2026-08-15T07:30:00Z',
      'csv',
    );
    // The slug should retain only word characters and dashes.
    expect(csvName).toBe('my-weird-title-2026-08-15T07-30.csv');
  });
});

describe('TableRenderer — download wiring', () => {
  it('constructs a Blob with the CSV MIME type and BOM-prefixed content', () => {
    const captured = captureDownload(
      makeValidNode(),
      'result-renderer-table-download-csv',
    );

    expect(captured.blob).toBeInstanceOf(Blob);
    expect(captured.blob.type).toBe('text/csv;charset=utf-8');
    // The first byte of the Blob content must be the BOM.
    // happy-dom stores the raw parts; we read them via `text()`.
    return (captured.blob).text().then((text) => {
      expect(text.charCodeAt(0)).toBe(0xfeff);
    });
  });

  it('constructs a Blob with the Markdown MIME type on Markdown click', () => {
    const captured = captureDownload(
      makeValidNode(),
      'result-renderer-table-download-markdown',
    );

    expect(captured.blob).toBeInstanceOf(Blob);
    expect(captured.blob.type).toBe('text/markdown;charset=utf-8');
    return (captured.blob).text().then((text) => {
      expect(text).toContain('| gene | control | treated |');
      expect(text).toContain('| --- | --- | --- |');
    });
  });

  it('uses URL.createObjectURL and revokes the object URL after the click', () => {
    const captured = captureDownload(
      makeValidNode(),
      'result-renderer-table-download-csv',
    );

    expect(captured.blob).toBeInstanceOf(Blob);
    const revoked = (captured as CapturedDownload & { revoked: string[] })
      .revoked;
    expect(revoked.length).toBe(1);
    expect(revoked[0]).toBe('blob:mock-table-renderer-url');
  });

  it('attaches the correct `download` attribute to the anchor element', () => {
    const captured = captureDownload(
      makeValidNode(),
      'result-renderer-table-download-csv',
    );

    expect(captured.anchor).toBeTruthy();
    expect(captured.filename).toBe('cell-counts-2026-08-15T07-30.csv');
    expect(captured.anchor.download).toBe('cell-counts-2026-08-15T07-30.csv');
  });

  it('attaches the correct filename to the Markdown anchor', () => {
    const captured = captureDownload(
      makeValidNode(),
      'result-renderer-table-download-markdown',
    );

    expect(captured.filename).toBe('cell-counts-2026-08-15T07-30.md');
  });
});

describe('TableRenderer — accessibility hints', () => {
  it('exposes aria-label="Download CSV" / "Download Markdown" on the buttons', () => {
    render(<TableRenderer node={makeValidNode()} />);
    expect(screen.getByLabelText('Download CSV').tagName.toLowerCase()).toBe(
      'button',
    );
    expect(
      screen.getByLabelText('Download Markdown').tagName.toLowerCase(),
    ).toBe('button');
  });

  it('uses button[type="button"] so the action does not submit a parent form', () => {
    render(<TableRenderer node={makeValidNode()} />);
    const csv = screen.getByTestId('result-renderer-table-download-csv');
    const md = screen.getByTestId('result-renderer-table-download-markdown');
    expect(csv.getAttribute('type')).toBe('button');
    expect(md.getAttribute('type')).toBe('button');
  });
});
