/**
 * BLOCK-454 P3 — 通用 OCR 窄口 + DeepSeek OCR adapter + knowledge 扫描件接入。
 *
 * 契约源：docs/block-454-endpoint-contract-findings.md §2 OCR 行（VERIFIED）：
 *   POST https://api.deepseek.com/v1/tools/ocr，multipart/form-data，Bearer；
 *   file + purpose(text_recognition | rich_layout_recognition) 均必填；
 *   PDF/DOC/DOCX/PPT/PPTX/图片，≤100MiB/1000 页；响应 pages[].text + <｜ref｜>/<｜box｜> 版面标记。
 *
 * 窄口契约（工具语义，不进 registerProvider capabilities；D1 预置=本地 OCR 留接口不引依赖）：
 *   A) 窄口：disabled/未配置/未实现 provider 诚实报；multipart 请求形态；pages 归一 +
 *      cost.requests/cost.pages 计量；purpose 白名单；100MiB 上限；401 不可重试。
 *   B) knowledge 集成：扫描件（无文本层）PDF → OCR 启用时文档转 ready（产物落 ocr.json
 *      artifact + note 留痕）；未启用时诚实 failed 带可行动指引；OCR 失败诚实上抛。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'petri-server');
const require = createRequire(import.meta.url);

// ---------- A) 窄口契约（无 DB 依赖） ----------

const { ocrDocument, OCR_PROVIDERS, OCR_MAX_UPLOAD_BYTES, OCR_PURPOSES } = require('../core/petri-server/helpers/ocr-provider.js');

const OCR_ENDPOINT = 'https://api.deepseek.com/v1/tools/ocr';

function mockOcrFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return responder(calls.length, { url, init });
  };
  impl.calls = calls;
  return impl;
}

function ocrJsonResponse(pages) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ pages }),
  };
}

const ENABLED_CONFIG = { enabled: true, provider: 'deepseek', purpose: 'rich_layout_recognition', timeoutMs: 10000 };

test('P3-A0 — OCR_PROVIDERS 窄口清单：deepseek 在册，local 留接口（D1 不引依赖）', () => {
  assert.ok(OCR_PROVIDERS.includes('deepseek'));
  assert.ok(OCR_PROVIDERS.includes('local'), 'local 槽位必须在册（未实现→诚实报）');
});

test('P3-A1 — enabled=false → ocr_access_disabled（联网/云渠道默认关，P3-c 本地主权）', async () => {
  const fetchImpl = mockOcrFetch(() => { throw new Error('不应发起请求'); });
  const r = await ocrDocument({
    buffer: Buffer.from('x'), filename: 'scan.pdf',
    config: { ...ENABLED_CONFIG, enabled: false }, fetchImpl, getApiKeyFn: () => 'sk-test',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocr_access_disabled');
  assert.equal(fetchImpl.calls.length, 0);
});

test('P3-A2 — provider=none → ocr_not_configured；provider=local → ocr_provider_not_implemented（诚实不硬造）', async () => {
  const fetchImpl = mockOcrFetch(() => { throw new Error('不应发起请求'); });
  const none = await ocrDocument({
    buffer: Buffer.from('x'), filename: 'scan.pdf',
    config: { ...ENABLED_CONFIG, provider: 'none' }, fetchImpl, getApiKeyFn: () => 'sk-test',
  });
  assert.equal(none.ok, false);
  assert.equal(none.code, 'ocr_not_configured');
  const local = await ocrDocument({
    buffer: Buffer.from('x'), filename: 'scan.pdf',
    config: { ...ENABLED_CONFIG, provider: 'local' }, fetchImpl, getApiKeyFn: () => '',
  });
  assert.equal(local.ok, false);
  assert.equal(local.code, 'ocr_provider_not_implemented', `本地 OCR 是留接口不是缺陷: ${JSON.stringify(local)}`);
});

test('P3-A3 — 已选 deepseek 但无 key → ocr_not_configured（P3-b 失败诚实）', async () => {
  const fetchImpl = mockOcrFetch(() => { throw new Error('不应发起请求'); });
  const r = await ocrDocument({
    buffer: Buffer.from('x'), filename: 'scan.pdf',
    config: ENABLED_CONFIG, fetchImpl, getApiKeyFn: () => '',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocr_not_configured');
  assert.ok(r.message.includes('DeepSeek'), r.message);
  assert.equal(fetchImpl.calls.length, 0);
});

test('P3-A4 — 请求形态：POST 官方端点 + Bearer + multipart(file+purpose 必填)', async () => {
  const fetchImpl = mockOcrFetch(() => ocrJsonResponse([{ text: '页一' }]));
  const buffer = Buffer.from('%PDF-fake');
  const r = await ocrDocument({
    buffer, filename: 'scan.pdf',
    config: ENABLED_CONFIG, fetchImpl, getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, OCR_ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer sk-test-key');
  const form = init.body;
  assert.ok(typeof form.get === 'function', 'body 必须是 FormData（multipart）');
  assert.equal(form.get('purpose'), 'rich_layout_recognition');
  const file = form.get('file');
  assert.ok(file, 'file 字段必填');
  assert.equal(file.size, buffer.length);
});

test('P3-A5 — 响应归一：pages[].text → text 拼接 + pages 明细 + cost.requests/pages 计量 + 版面标记探针', async () => {
  const fetchImpl = mockOcrFetch(() => ocrJsonResponse([
    { text: '第一页正文 <｜ref｜>标题<｜/ref｜>' },
    { text: '第二页正文 <｜box｜>0,0,100,100<｜/box｜>' },
  ]));
  const r = await ocrDocument({
    buffer: Buffer.from('%PDF-fake'), filename: 'scan.pdf',
    config: ENABLED_CONFIG, fetchImpl, getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.pages.length, 2);
  assert.equal(r.pages[0].index, 1);
  assert.equal(r.pages[1].index, 2);
  assert.ok(r.text.includes('第一页正文') && r.text.includes('第二页正文'), 'pages 按序拼接');
  assert.equal(r.layoutMarkers, true, '<｜ref｜>/<｜box｜> 版面标记探针为 true');
  assert.equal(r.cost.requests, 1);
  assert.equal(r.cost.pages, 2);
  assert.ok(r.cost.bytes > 0);
});

test('P3-A6 — purpose 白名单外 → ocr_purpose_invalid（契约面诚实拒绝）', async () => {
  const fetchImpl = mockOcrFetch(() => { throw new Error('不应发起请求'); });
  const r = await ocrDocument({
    buffer: Buffer.from('x'), filename: 'scan.pdf',
    config: { ...ENABLED_CONFIG, purpose: 'made_up_purpose' }, fetchImpl, getApiKeyFn: () => 'sk',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocr_purpose_invalid');
  assert.deepEqual([...OCR_PURPOSES].sort(), ['rich_layout_recognition', 'text_recognition']);
  assert.equal(fetchImpl.calls.length, 0);
});

test('P3-A7 — 上传体超 100MiB 上限 → ocr_too_large（不发请求）', async () => {
  const fetchImpl = mockOcrFetch(() => { throw new Error('不应发起请求'); });
  const r = await ocrDocument({
    buffer: Buffer.alloc(8), filename: 'big.pdf',
    config: ENABLED_CONFIG, fetchImpl, getApiKeyFn: () => 'sk',
    maxUploadBytes: 4,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocr_too_large');
  assert.equal(fetchImpl.calls.length, 0);
  assert.ok(OCR_MAX_UPLOAD_BYTES === 100 * 1024 * 1024, '默认上限=100MiB（findings 契约）');
});

test('P3-A8 — HTTP 401 → ocr_http_error 不可重试（key 配置面）', async () => {
  const fetchImpl = mockOcrFetch(() => ({ ok: false, status: 401, text: async () => '{"error":{"message":"bad key"}}' }));
  const r = await ocrDocument({
    buffer: Buffer.from('x'), filename: 'scan.pdf',
    config: ENABLED_CONFIG, fetchImpl, getApiKeyFn: () => 'sk-bad',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocr_http_error');
  assert.equal(r.status, 401);
  assert.equal(r.retryable, false);
});

test('P3-A9 — 响应非 JSON → ocr_bad_response（不静默吞）', async () => {
  const fetchImpl = mockOcrFetch(() => ({ ok: true, status: 200, text: async () => 'not-json' }));
  const r = await ocrDocument({
    buffer: Buffer.from('x'), filename: 'scan.pdf',
    config: ENABLED_CONFIG, fetchImpl, getApiKeyFn: () => 'sk',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocr_bad_response');
});

// ---------- B) knowledge 扫描件集成（DB boot，同 knowledge-space.test 自举） ----------

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block454-p3-'));
process.env.PETRI_DB_PATH = path.join(tempRoot, 'petri.db');
process.env.PETRI_LOCAL_DATA_DIR = tempRoot;
process.on('exit', () => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});
process.env.PETRI_BETTER_SQLITE3_ROOT = R_SERVER;
const { runMigrations } = require('../src/migration-runner.js');
const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
await runMigrations(process.env.PETRI_DB_PATH, migrationsDir);

const ks = require('../core/petri-server/helpers/knowledge-space.js');
const { createDocument, ingestDocument } = require('../core/petri-server/helpers/knowledge-ingest.js');

/** 极简无文本层 PDF（扫描件模拟）：单空白页、精确 xref，pdfjs 提取文本为空。 */
function buildScannedPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((content, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${content}\nendobj\n`;
  });
  const xrefOffset = body.length;
  let xref = 'xref\n0 4\n0000000000 65535 f \n';
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'utf8');
}

/** 测试嵌入桩：按文本长度产稳定向量（嵌入通道与 OCR 正交，已有独立测试面）。 */
function fakeEmbed(texts) {
  return Promise.resolve(texts.map((t) => new Float32Array([t.length, 1, 0])));
}

async function ingestScannedPdf({ ocrFn, ocrConfig }) {
  const doc = await createDocument({ name: 'scanned.pdf', buffer: buildScannedPdf(), mime: 'application/pdf', autoIngest: false });
  return { doc, result: await ingestDocument(doc.id, { embed: fakeEmbed, ocrFn, ocrConfig }) };
}

test('P3-B1 — 扫描件 PDF + OCR 未启用 → 诚实 failed 且指路（不静默空索引）', async () => {
  const { doc, result } = await ingestScannedPdf({});
  assert.equal(result.status, 'failed', JSON.stringify(result));
  assert.ok(result.error.includes('扫描件') || result.error.includes('无文本层'), `错误须说明扫描件成因: ${result.error}`);
  assert.ok(result.error.includes('ocr') || result.error.includes('OCR'), `错误须给 OCR 指路: ${result.error}`);
});

test('P3-B2 — 扫描件 PDF + OCR 启用（mock adapter）→ ready；OCR 文本入块；ocr.json artifact + note 留痕', async () => {
  const ocrCalls = [];
  const { doc, result } = await ingestScannedPdf({
    ocrFn: async ({ buffer, filename, config }) => {
      ocrCalls.push({ filename, purpose: config.purpose, size: buffer.length });
      return {
        ok: true, provider: 'deepseek', purpose: config.purpose,
        pages: [{ index: 1, text: 'OCR 识别出的正文：TP53 是抑癌基因。' }, { index: 2, text: '第二页：BRCA1 参与同源重组。' }],
        text: 'OCR 识别出的正文：TP53 是抑癌基因。\n\n第二页：BRCA1 参与同源重组。',
        layoutMarkers: false,
        cost: { requests: 1, bytes: 2048, pages: 2 },
      };
    },
    ocrConfig: { ...ENABLED_CONFIG },
  });
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(ocrCalls.length, 1);
  assert.equal(ocrCalls[0].filename, 'scanned.pdf');
  assert.equal(ocrCalls[0].purpose, 'rich_layout_recognition');
  const fresh = ks.getDocument(doc.id);
  assert.equal(fresh.chunk_count > 0, true, `OCR 文本必须入块: ${JSON.stringify(fresh)}`);
  const ftsRow = require('../core/petri-server/db.js').getDatabase()
    .prepare("SELECT text FROM knowledge_chunks WHERE doc_id = ? ORDER BY seq LIMIT 1").get(doc.id);
  assert.ok(ftsRow && ftsRow.text.includes('TP53'), '块文本来自 OCR 结果');
  // artifact 留痕：docDir/ocr.json（provider/pages/cost 可审计）
  const artifactPath = path.join(ks.docDir(doc.id), 'ocr.json');
  assert.ok(fs.existsSync(artifactPath), 'OCR 产物必须落 ocr.json artifact');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.provider, 'deepseek');
  assert.equal(artifact.pageCount, 2);
  assert.equal(artifact.cost.pages, 2);
  assert.ok(Array.isArray(artifact.pages) && artifact.pages.length === 2, 'artifact 保留 pages 明细');
});

test('P3-B3 — OCR adapter 失败 → 文档诚实 failed 且错误带 ocr 码（不静默吞）', async () => {
  const { result } = await ingestScannedPdf({
    ocrFn: async () => ({ ok: false, code: 'ocr_http_error', message: 'DeepSeek OCR 返回 HTTP 503。', retryable: true, status: 503 }),
    ocrConfig: { ...ENABLED_CONFIG },
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.error.includes('ocr_http_error'), `错误须携带 ocr 代码: ${result.error}`);
});
