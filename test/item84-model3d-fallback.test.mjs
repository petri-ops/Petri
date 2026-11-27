/**
 * item84 HK-01：3D 凭据误诊修复 + 无凭据降级三选一 + 本地近似如实标注。
 * 只读核真证据：conv_4459b1f7-b7e 中 Ark key 可用（image/video 成功），
 * model3d 失败是 referenceArtifactId 退化成文生 + 模型不可用，非凭据缺失。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// generate-tools 经 registry 触发 DB 初始化——自举临时库（同既有 agent 测试口径）。
{
  const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'item84-db-'));
  const boot = new Database(path.join(dir, 'petri.db'));
  const migrations = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrations, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(dir, 'petri.db');
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
}

const generateTools = read('core/petri-server/agent-tools/generate-tools.js');
const plugin = read('resources/built-in-packs/petri-pack-create/plugins/generate-model3d/index.js');
const defs = read('core/petri-server/agent-tools/tool-defs/generate.js');

test('HK-01 凭据误诊：错误串与工具描述不再引导独立 Hyper3D key', () => {
  assert.match(plugin, /未开通\/不可用/);
  assert.match(plugin, /无需独立 Hyper3D key/);
  assert.doesNotMatch(plugin, /请配置独立 Hyper3D 凭据/);
  assert.match(defs, /同一把 Ark key/);
  assert.match(defs, /非凭据缺失|不是凭据缺失/);
  assert.match(generateTools, /reference_artifact_unresolved/);
  assert.match(generateTools, /imageDataUrlFromBuffer/);
});

test('HK-01 referenceArtifactId 裸 sha 解析为 data URL，解析失败 fail-closed 不退化文生', async () => {
  const { resolveReferenceImage } = require_(path.join(ROOT, 'core/petri-server/agent-tools/generate-tools.js'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'item84-ref-'));
  const imageDir = path.join(dataDir, 'generated', 'generate-image');
  fs.mkdirSync(imageDir, { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const sha = crypto.createHash('sha256').update(png).digest('hex');
  fs.writeFileSync(path.join(imageDir, `${sha}.png`), png);
  try {
    const resolved = await resolveReferenceImage({ referenceArtifactId: sha }, { dataDir });
    assert.match(resolved, /^data:image\/png;base64,/);
    const passthrough = 'https://example.test/a.png';
    assert.equal(await resolveReferenceImage({ referenceImage: passthrough }, { dataDir }), passthrough);
    await assert.rejects(
      () => resolveReferenceImage({ referenceArtifactId: 'f'.repeat(64) }, { dataDir }),
      /reference_artifact_unresolved/,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('HK-01 三选一降级问题带三个明确选项', () => {
  const { buildModel3DFallbackQuestion } = require_(path.join(ROOT, 'core/petri-server/helpers/model3d-fallback.js'));
  const question = buildModel3DFallbackQuestion();
  assert.deepEqual(question.options.map((o) => o.id), [
    'model3d-fallback-continue',
    'model3d-fallback-configure',
    'model3d-fallback-cancel',
  ]);
  assert.match(question.question, /本地|凭据|取消/);
});

test('HK-01 本地近似产物如实标注（provider/synthetic/title/missingInfo）', () => {
  const { buildRecipe } = require_(path.join(ROOT, 'core/petri-server/helpers/model3d-recipes.js'));
  const built = buildRecipe('box-enclosure', {}, { annotation: true });
  assert.equal(built.ok, true);
  assert.equal(built.scene.metadata.provider, 'local');
  assert.equal(built.scene.metadata.synthetic, true);
  assert.match(built.scene.metadata.title, /本地近似非 AI 生成/);
  assert.ok(Object.prototype.hasOwnProperty.call(built, 'missingInfo'), '不得夸大能力：missingInfo 字段须在');
});
