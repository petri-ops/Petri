/**
 * item 87 第一阶段 HK-01 — 引用验真函数（DOI 反查）。
 * 真调用 Crossref/DataCite；不可达环境走录制 fixture（本文件全部 fixture 注入，
 * 真调用另有 live 测试在网络可达时执行、不可达时如实 skip——绝不把 mock 冒充真值）。
 * fail-closed：网络错误/解析失败永远不得给 'verified'。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {
  normalizeDoi,
  verifyCitation,
} = require(path.join(ROOT, 'core', 'shared-backend', 'citation-verify.js'));

const LOVE_2014 = {
  doi: '10.1186/s13059-014-0550-8',
  title: 'Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2',
};

const fixtureFetch = (routes) => async (url) => {
  const hit = routes.find(([prefix]) => String(url).startsWith(prefix));
  if (!hit) throw new Error(`fixture miss: ${url}`);
  const [, respond] = hit;
  return respond(url);
};

const crossrefOk = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: 'ok',
    message: {
      DOI: LOVE_2014.doi,
      title: [LOVE_2014.title],
      author: [
        { given: 'Michael I', family: 'Love' },
        { given: 'Wolfgang', family: 'Huber' },
        { given: 'Simon', family: 'Anders' },
      ],
      'container-title': ['Genome Biology'],
      issued: { 'date-parts': [[2014]] },
    },
  }),
});

test('HK-87-6：normalizeDoi 剥 URL 前缀/大小写，非法形态拒绝', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1186/s13059-014-0550-8'), '10.1186/s13059-014-0550-8');
  assert.equal(normalizeDoi('http://dx.doi.org/10.1186/S13059-014-0550-8'), '10.1186/s13059-014-0550-8');
  assert.equal(normalizeDoi('doi:10.1186/s13059-014-0550-8'), '10.1186/s13059-014-0550-8');
  assert.equal(normalizeDoi('10.1186/s13059-014-0550-8'), '10.1186/s13059-014-0550-8');
  assert.equal(normalizeDoi('https://bioconductor.org/'), null);
  assert.equal(normalizeDoi('not-a-doi'), null);
  assert.equal(normalizeDoi(''), null);
});

test('HK-87-7：Crossref 反查命中→verified，题录回填', async () => {
  const fetchMock = fixtureFetch([['https://api.crossref.org/works/', crossrefOk]]);
  const result = await verifyCitation({ doi: LOVE_2014.doi }, { fetch: fetchMock });
  assert.equal(result.status, 'verified');
  assert.equal(result.via, 'crossref');
  assert.equal(result.record.title, LOVE_2014.title);
  assert.equal(result.record.year, 2014);
  assert.equal(result.record.container, 'Genome Biology');
  assert.ok(result.checkedAt);
});

test('HK-87-8：题录不匹配→title_mismatch（拒绝入库的依据之一）', async () => {
  const fetchMock = fixtureFetch([['https://api.crossref.org/works/', crossrefOk]]);
  const result = await verifyCitation(
    { doi: LOVE_2014.doi, expectedTitle: '一篇完全不同的论文标题' },
    { fetch: fetchMock }
  );
  assert.equal(result.status, 'title_mismatch');
  assert.notEqual(result.status, 'verified');
});

test('HK-87-9：Crossref 404 时 DataCite 兜底（bioconductor 包 DOI 走 DataCite）', async () => {
  const dataciteRecord = {
    data: {
      attributes: {
        doi: '10.18129/b9.bioc.deseq2',
        titles: [{ title: 'DESeq2: Differential gene expression analysis based on the negative binomial distribution' }],
        publicationYear: 2025,
        publisher: 'Bioconductor',
      },
    },
  };
  const fetchMock = fixtureFetch([
    ['https://api.crossref.org/works/', () => ({ ok: false, status: 404, json: async () => ({}) })],
    ['https://api.datacite.org/dois/', () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...dataciteRecord }),
    })],
  ]);
  const result = await verifyCitation({ doi: '10.18129/B9.bioc.DESeq2' }, { fetch: fetchMock });
  assert.equal(result.status, 'verified');
  assert.equal(result.via, 'datacite');
  assert.match(result.record.title, /DESeq2/);
});

test('HK-87-10：两库都查不到→doi_unresolvable；网络错误→network_error；两者都不是 verified', async () => {
  const fetchMock = fixtureFetch([
    ['https://api.crossref.org/works/', () => ({ ok: false, status: 404, json: async () => ({}) })],
    ['https://api.datacite.org/dois/', () => ({ ok: false, status: 404, json: async () => ({}) })],
  ]);
  const missing = await verifyCitation({ doi: '10.9999/not-real' }, { fetch: fetchMock });
  assert.equal(missing.status, 'doi_unresolvable');

  const broken = await verifyCitation(
    { doi: LOVE_2014.doi },
    { fetch: async () => { throw new Error('ECONNREFUSED'); } }
  );
  assert.equal(broken.status, 'network_error');
  assert.ok(broken.error);
});

test('HK-87-11（live）：真调用 Crossref 反查 DESeq2 论文（网络不可达则如实 skip，不冒充实测）', { timeout: 30000 }, async () => {
  const result = await verifyCitation({ doi: LOVE_2014.doi, expectedTitle: LOVE_2014.title });
  if (result.status === 'network_error') {
    console.warn('[item87 live] 网络不可达，live 验真跳过（如实标注，非实测通过）');
    return;
  }
  assert.equal(result.status, 'verified');
  assert.equal(result.via, 'crossref');
  assert.equal(result.record.title, LOVE_2014.title);
});
