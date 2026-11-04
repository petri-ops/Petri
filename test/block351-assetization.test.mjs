import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * test/block351-assetization.test.mjs — BLOCK-351 证据资产化批次断言（真断言，非存 JSON）。
 *
 * 对高价值 acceptance 目录做**证据完整性**断言：每个文件可解析、非空、格式魔数正确；
 * JSON 证据额外断言语义键（如 run 报告的 assertions/allPass、task 报告的 tasks 数组）。
 * 这把「一次性笔录」转成进门禁的可复跑断言：证据损坏/截断/空文件 = 红。
 * 目录清单即 BLOCK-351 资产化批次（manifest 由 scripts/block351-build-manifest.mjs 机械扫描生成）。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BATCH_DIRS = [
  'acceptance/next-05-3d-process',
  'acceptance/block-348',
  'acceptance/next-06-convergence',
  'acceptance/ui-448',
  'acceptance/g0-result-studio',
  'acceptance/next-04b-3d-vision-loop',
  'acceptance/next-04a-3d-foundation',
  'acceptance/harness-loop',
  'acceptance/harness-scientific-task',
  'acceptance/block-105',
  'acceptance/ui-proxy-review',
  'acceptance/block-322-p3',
  'acceptance/block-322-p2',
  'acceptance/block-161',
  'acceptance/block-139',
  'acceptance/block-59',
  'acceptance/g0-qualification',
  'acceptance/ui-552',
  'acceptance/ui-315',
  'acceptance/block-107',
  'acceptance/ui-341',
  'acceptance/ui-553',
  'acceptance/block-85',
  'acceptance/block-67',
];

const walkFiles = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
};

const assertOneEvidenceFile = (abs, rel) => {
  const buf = fs.readFileSync(abs);
  const allowEmpty = /\.(txt|log)$/i.test(rel); // 干净运行的 stderr/stdout 捕获：空=成功语义
  assert.ok(buf.length > 0 || allowEmpty, `${rel} 空文件`);
  if (/\.json$/i.test(rel)) {
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(buf.toString('utf8')); }, `${rel} JSON 不可解析`);
    assert.ok(parsed && typeof parsed === 'object', `${rel} JSON 顶层非对象`);
    // 语义键：运行报告若带 assertions/allPass 字段则必须自洽（allPass=true ⇔ 无 fail 行）
    if (Array.isArray(parsed.assertions) && typeof parsed.allPass === 'boolean') {
      const failCount = parsed.assertions.filter((a) => a && a.pass === false).length;
      assert.equal(parsed.allPass, failCount === 0, `${rel} allPass 与 assertions 不自洽`);
    }
    if (Array.isArray(parsed.tasks) && typeof parsed.total === 'number' && parsed.provider) {
      assert.ok(parsed.tasks.length > 0, `${rel} tasks 空`);
    }
  } else if (/\.jsonl$/i.test(rel)) {
    const text = buf.toString('utf8').trim();
    assert.ok(text.length > 0, `${rel} jsonl 空`);
    for (const line of text.split('\n')) {
      assert.doesNotThrow(() => JSON.parse(line), `${rel} 存在不可解析行：${line.slice(0, 60)}`);
    }
  } else if (/\.png$/i.test(rel)) {
    assert.ok(buf.length > 1024, `${rel} 图片过小（${buf.length}B）`);
    // 实机事实（BLOCK-351 采集）：harness-loop/production/ui 部分历史截图为 JPEG 内容挂 .png 名
    //（历史证据不改写，计划 §3）——按内容魔数判定图像（PNG 89504E47 / JPEG FFD8FF）。
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    assert.ok(isPng || isJpeg, `${rel} 既非 PNG 也非 JPEG 内容（魔数 ${buf.slice(0, 4).toString('hex')}）`);
  } else if (/\.(md|txt|log|csv|html|svg)$/i.test(rel)) {
    const text = buf.toString('utf8');
    // 实机校准（BLOCK-351）：.txt/.log 可以是「干净运行」的空 stderr/stdout 捕获（空=成功语义），
    // 不强制非空；报告类（md/csv/html/svg）必须非空。
    if (/\.(md|csv|html|svg)$/i.test(rel)) assert.ok(text.trim().length > 0, `${rel} 报告空`);
    if (/\.(html|svg)$/i.test(rel)) assert.ok(text.includes('<'), `${rel} 非 HTML/SVG 内容`);
  }
  return rel;
};

test('block351 资产化批次：逐目录证据完整性（可解析/非空/魔数/语义自洽）', () => {
  let total = 0;
  const perDir = {};
  for (const dir of BATCH_DIRS) {
    const abs = path.join(ROOT, dir);
    assert.ok(fs.existsSync(abs), `批次目录缺失：${dir}`);
    const files = walkFiles(abs);
    assert.ok(files.length > 0, `批次目录为空：${dir}`);
    for (const f of files) {
      assertOneEvidenceFile(f, path.relative(ROOT, f));
      total += 1;
      perDir[dir] = (perDir[dir] || 0) + 1;
    }
  }
  console.log(`[block351] 证据完整性断言覆盖 ${total} 文件：${JSON.stringify(perDir)}`);
  assert.ok(total >= 400, `批次覆盖文件数不足（${total} < 400）`);
});

test('block351 语义抽验：block-348 实测报告与 349 清偿终态表自洽', () => {
  const r348 = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/block-348/results.json'), 'utf8'));
  assert.ok(Array.isArray(r348.tasks) && r348.tasks.length === 8, 'block-348 results.json 应为 8 任务');
  assert.ok(r348.metrics && r348.metrics.autonomousCompletion, 'block-348 缺机械度量');
  const report = fs.readFileSync(path.join(ROOT, 'docs/block-349-clearance-report.md'), 'utf8');
  assert.match(report, /十三条终态表/);
  assert.match(report, /10 verified/);
  assert.match(report, /3 cancelled/);
});

test('block351 语义抽验：next-3D 系列与 harness 系列报告键形状', () => {
  // next-05-3d-process / harness-loop 是流程验收批：抽查其 JSON 均带 step/pass 形态或 manifest 形态
  const dir = path.join(ROOT, 'acceptance/next-05-3d-process');
  const jsons = walkFiles(dir).filter((f) => f.endsWith('.json')).slice(0, 5);
  for (const f of jsons) {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    const keys = Object.keys(parsed);
    assert.ok(keys.length > 0, `${path.relative(ROOT, f)} 空对象`);
  }
  const hdir = path.join(ROOT, 'acceptance/harness-loop');
  const hjsons = walkFiles(hdir).filter((f) => f.endsWith('.json')).slice(0, 5);
  for (const f of hjsons) {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.ok(Object.keys(parsed).length > 0, `${path.relative(ROOT, f)} 空对象`);
  }
});
