const fs = require('fs');
const path = require('path');

/**
 * 生成中性夹具 sample-metrics 的 golden revision fixture（digest 用核心 SDK 实算）。
 * 契约变更后重跑：node test/fixtures/neutral-plugins/regen-golden.cjs
 *
 * 实现：先从**原始** descriptor（normalizeResultStudioDescriptor，不含 golden 校验）
 * 实算 digest 落盘——避免「lint 先校验 golden → golden 坏则永远无法自愈」的鸡生蛋；
 * 随后立刻经完整 lint 验证自洽。
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const sdk = require(path.join(ROOT, 'core/shared-backend/result-studio-plugin-sdk'));
const pluginDir = path.join(__dirname, 'sample-metrics');

const plugin = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
const toolDef = JSON.parse(fs.readFileSync(path.join(pluginDir, 'tool-definition.json'), 'utf8'));

const raw = sdk.normalizeResultStudioDescriptor(toolDef.resultStudio);
if (!raw || !raw.source || !raw.source.entryPoint) {
  console.error('descriptor missing source.entryPoint');
  process.exit(1);
}

const golden = {
  schemaVersion: 1,
  pluginId: 'sample-metrics',
  pluginVersion: plugin.version,
  descriptorVersion: raw.descriptorVersion,
  sourceScriptSha256: sdk.digest(fs.readFileSync(path.join(pluginDir, raw.source.entryPoint))),
  inputBindingDigest: sdk.digest(raw.inputBindings),
  artifactContractDigest: sdk.digest(raw.artifacts),
  revisionSourceStrategy: raw.source.strategy,
  independentScriptPathTemplate: raw.independentScriptPathTemplate,
  fixtureInput: 'demo-data/demo-samples.csv',
  expectedArtifactIds: raw.artifacts.map((a) => a.id),
};

const out = path.join(pluginDir, 'golden-revisions', 'result-studio-v1.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(golden, null, 2) + '\n', 'utf8');
console.log('[neutral-fixture] golden written:', out);
console.log('  expectedArtifactIds:', golden.expectedArtifactIds.join(','));

// 自洽复验：完整 lint（含 golden 校验）必须通过
const lint = sdk.lintResultStudioPlugin({
  plugin: { ...plugin, pluginDir },
  toolDefinition: toolDef,
  pluginDir,
});
if (!lint.valid) {
  console.error('[neutral-fixture] lint FAIL after regeneration:', JSON.stringify(lint.errors, null, 1));
  process.exit(1);
}
console.log('[neutral-fixture] lint valid after regeneration');
