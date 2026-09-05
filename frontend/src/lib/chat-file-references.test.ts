import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  classifyLink,
  extractFileReferenceCandidates,
  resolveFileReferences,
  __resetFileReferenceCache,
  type ResolveResponse,
} from './chat-file-references';
import type { CopilotContext } from './copilotContext';

const context: CopilotContext = {
  page: 'desktop-project',
  projectId: 'proj-1',
  activeJobId: 'job-1',
  activeArtifact: { jobId: 'job-1', toolId: 'deseq2', name: 'report.html', type: 'report' },
};

beforeEach(() => {
  __resetFileReferenceCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetFileReferenceCache();
});

describe('chat-file-references: URL safety', () => {
  it('classifies external http(s) links as external', () => {
    expect(classifyLink('https://example.com/path')).toBe('external');
    expect(classifyLink('http://localhost:3001/api/foo')).toBe('external');
  });

  it('classifies relative paths and anchors as internal', () => {
    expect(classifyLink('/tools/deseq2')).toBe('internal');
    expect(classifyLink('./data/foo.csv')).toBe('internal');
    expect(classifyLink('../sibling/bar.tsv')).toBe('internal');
    expect(classifyLink('#results')).toBe('internal');
  });

  it('does not treat local absolute paths as app routes', () => {
    expect(classifyLink('/Users/demo/project/data.csv')).toBe('dangerous');
    expect(classifyLink('/Volumes/Data/sample.tsv')).toBe('dangerous');
  });

  it('classifies mailto links as external when address is valid', () => {
    expect(classifyLink('mailto:hi@example.com')).toBe('external');
  });

  it('rejects mailto without a valid address', () => {
    expect(classifyLink('mailto:hi@')).toBe('dangerous');
  });

  it('rejects dangerous schemes', () => {
    expect(classifyLink('javascript:alert(1)')).toBe('dangerous');
    expect(classifyLink('data:text/html,<script>alert(1)</script>')).toBe('dangerous');
    expect(classifyLink('file:///etc/passwd')).toBe('dangerous');
    expect(classifyLink('vbscript:msgbox(1)')).toBe('dangerous');
    expect(classifyLink('ftp://files.example.com/x')).toBe('dangerous');
  });

  it('rejects biof3:// schemes that are not artifact/workspace', () => {
    expect(classifyLink('gewu://admin/exec')).toBe('dangerous');
    expect(classifyLink('gewu://')).toBe('dangerous');
  });

  it('accepts biof3://artifact and biof3://workspace', () => {
    expect(classifyLink('gewu://artifact/job-1/deg.csv')).toBe('artifact');
    expect(classifyLink('gewu://workspace/proj-1/data/foo.csv')).toBe('workspace');
  });

  it('rejects URLs with control characters', () => {
    expect(classifyLink('https://example.com/\u0000path')).toBe('dangerous');
    expect(classifyLink('https://example.com/\nfoo')).toBe('dangerous');
  });
});

describe('chat-file-references: candidate extraction', () => {
  it('extracts internal biof3:// URIs verbatim', () => {
    const out = extractFileReferenceCandidates(
      'See [report](biof3://artifact/job-1/report.html) and also biof3://workspace/proj-1/data/x.csv',
    );
    expect(out).toContain('gewu://artifact/job-1/report.html');
    expect(out).toContain('gewu://workspace/proj-1/data/x.csv');
  });

  it('extracts tools/file/<jobId>/<filename> URLs into job/filename tokens', () => {
    const out = extractFileReferenceCandidates(
      'Download at /api/tools/file/job-1/deg.csv and /api/py/tools/file/job-2/vocab.tsv',
      { activeJobId: 'job-1' },
    );
    expect(out).toContain('job-1/deg.csv');
    expect(out).toContain('job-2/vocab.tsv');
    // activeJobId filter only affects the *bare* filename path (used when
    // the assistant says "see deg.csv" and we infer the active job is the
    // source) — it does NOT block cross-project URLs.
    expect(out).toContain('deg.csv');
  });

  it('extracts project-relative paths', () => {
    const out = extractFileReferenceCandidates(
      'Open ./data/foo.csv and ../results/volcano.png and raw/notes.md',
    );
    expect(out).toContain('./data/foo.csv');
    expect(out).toContain('../results/volcano.png');
    expect(out).toContain('raw/notes.md');
  });

  it('extracts inline-code workspace paths and internal artifact URIs', () => {
    const out = extractFileReferenceCandidates(
      'Open `results/deg.csv` or `gewu://artifact/job-1/report.html`.',
    );
    expect(out).toContain('results/deg.csv');
    expect(out).toContain('gewu://artifact/job-1/report.html');
  });

  it('keeps fenced code inert but extracts standalone file references from inline code', () => {
    const md = [
      'Real link: data.csv',
      '',
      '```ts',
      'const file = "ignored.csv";',
      'const skip = "package.json";',
      '```',
      '',
      'Open `report.html` directly.',
      '',
      'Expressions like `read.csv("hidden.csv")` stay inert, while `package.json` is a file.',
    ].join('\n');
    const out = extractFileReferenceCandidates(md);
    expect(out).toContain('data.csv');
    expect(out).toContain('report.html');
    expect(out).toContain('package.json');
    expect(out).not.toContain('ignored.csv');
    expect(out).not.toContain('hidden.csv');
  });

  it('extracts common project, source, notebook, and bioinformatics file names', () => {
    const out = extractFileReferenceCandidates(
      'See package.json, tsconfig.json, model-registry.ts, analysis.ipynb, variants.vcf, and Fig5_intermediate.RData.',
    );
    expect(out).toEqual(expect.arrayContaining([
      'package.json',
      'tsconfig.json',
      'model-registry.ts',
      'analysis.ipynb',
      'variants.vcf',
      'Fig5_intermediate.RData',
    ]));
  });

  it('extracts common office documents and browser image formats', () => {
    const out = extractFileReferenceCandidates([
      '报告.docx 旧稿.doc 演示.pptx 数据.xlsx 开放文档.odt 项目.pages',
      '动画.gif 插图.svg 动画.webp 图像.apng 照片.heic 扫描.tiff',
    ].join('\n'));
    expect(out).toEqual(expect.arrayContaining([
      '报告.docx',
      '旧稿.doc',
      '演示.pptx',
      '数据.xlsx',
      '开放文档.odt',
      '项目.pages',
      '动画.gif',
      '插图.svg',
      '动画.webp',
      '图像.apng',
      '照片.heic',
      '扫描.tiff',
    ]));
  });

  it('extracts unicode names, quoted paths with spaces, and project absolute paths', () => {
    const out = extractFileReferenceCandidates(
      '查看 差异基因.csv、"results/final report.html" 和 /Users/demo/Gewu/data/sample matrix.tsv。',
    );
    expect(out).toEqual(expect.arrayContaining([
      '差异基因.csv',
      'results/final report.html',
      '/Users/demo/Gewu/data/sample matrix.tsv',
    ]));
  });

  it('extracts file targets from markdown links for verified resolution', () => {
    const out = extractFileReferenceCandidates(
      '打开 [工作区配置](frontend/src/config.ts) 和 [结果](biof3://artifact/job-1/report.html)。',
    );
    expect(out).toEqual(expect.arrayContaining([
      'frontend/src/config.ts',
      'gewu://artifact/job-1/report.html',
    ]));
  });

  it('skips the currently active artifact self-reference', () => {
    const out = extractFileReferenceCandidates(
      'Look at report.html next to volcano.png',
      { activeArtifactName: 'report.html' },
    );
    expect(out).not.toContain('report.html');
    expect(out).toContain('volcano.png');
  });

  it('caps the returned list at the limit and keeps first-seen order', () => {
    const md = ['a.csv', 'b.csv', 'c.csv', 'd.csv'].map((n) => `Open ${n}`).join('\n');
    const out = extractFileReferenceCandidates(md, {}, 2);
    expect(out).toEqual(['a.csv', 'b.csv']);
  });
});

describe('chat-file-references: resolveFileReferences', () => {
  it('caches by (projectId, activeJobId, reference) and reuses the same promise', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          ({
            ok: true,
            results: [
              {
                reference: 'data/foo.csv',
                resolved: {
                  kind: 'workspace',
                  projectId: 'proj-1',
                  relativePath: 'data/foo.csv',
                },
              },
            ],
          }) satisfies ResolveResponse,
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    const a = resolveFileReferences(context, ['data/foo.csv']);
    const b = resolveFileReferences(context, ['data/foo.csv']);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.get('data/foo.csv')?.resolved?.kind).toBe('workspace');
    expect(rb.get('data/foo.csv')?.resolved?.kind).toBe('workspace');
    // Same promise reused -> single network call
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes the server artifact name field for rendering and clicks', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          ({
            ok: true,
            results: [{
              reference: 'deg_table.csv',
              resolved: {
                kind: 'artifact',
                name: 'deg_table.csv',
                jobId: 'job-1',
                projectId: 'proj-1',
              },
            }],
          }) as ResolveResponse,
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await resolveFileReferences(context, ['deg_table.csv']);
    expect(out.get('deg_table.csv')?.resolved).toEqual(expect.objectContaining({
      kind: 'artifact',
      name: 'deg_table.csv',
      artifactName: 'deg_table.csv',
      jobId: 'job-1',
    }));
  });

  it('returns null entries when the server resolves none of the references', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, results: [] }) satisfies ResolveResponse,
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await resolveFileReferences(context, ['missing.csv']);
    expect(out.get('missing.csv')).toBeNull();
  });

  it('skips resolution entirely when projectId is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await resolveFileReferences({ ...context, projectId: '' }, ['x.csv']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.size).toBe(0);
  });
});

describe('chat-file-references: synthetic URI round-trip', () => {
  it('produces a stable biof3://artifact URI from an artifact resolution', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          ({
            ok: true,
            results: [
              {
                reference: 'job-1/deg.csv',
                resolved: {
                  kind: 'artifact',
                  jobId: 'job-1',
                  artifactName: 'deg.csv',
                },
              },
            ],
          }) satisfies ResolveResponse,
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await resolveFileReferences(context, ['job-1/deg.csv']);
    const resolved = out.get('job-1/deg.csv')?.resolved;
    expect(resolved).toEqual(expect.objectContaining({
      kind: 'artifact',
      jobId: 'job-1',
      artifactName: 'deg.csv',
    }));
    expect(classifyLink('gewu://artifact/job-1/deg.csv')).toBe('artifact');
  });
});