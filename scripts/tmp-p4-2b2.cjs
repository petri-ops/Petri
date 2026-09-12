const fs = require('fs');

function edit(file, fn) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = fn(s);
  if (s === before) { console.error('NO CHANGE: ' + file); process.exitCode = 1; return; }
  fs.writeFileSync(file, s, 'utf8');
  console.log('ok ' + file);
}

// ── plugin-loader-refresh：deseq2 → sample-metrics（内置目录在切片 2c 删除后由 env 指向夹具）──
edit('test/plugin-loader-refresh.test.mjs', (s) => {
  s = s.replace("test('legacy disk refresh cannot shadow builtin-canonical DESeq2', () => {",
    "test('legacy disk refresh cannot shadow builtin-canonical sample-metrics', () => {");
  s = s.replace("  const pluginDir = path.join(tmpDir, 'deseq2');", "  const pluginDir = path.join(tmpDir, 'sample-metrics');");
  s = s.replace("    JSON.stringify([{ id: 'deseq2', type: 'analysis-plugin' }], null, 2),",
    "    JSON.stringify([{ id: 'sample-metrics', type: 'analysis-plugin' }], null, 2),");
  s = s.replace(`    JSON.stringify({
      id: 'deseq2',
      pluginManifestVersion: 1,
      title: 'Stale DESeq2',
      version: '0.0.1',
      language: 'r',
    }),`, `    JSON.stringify({
      id: 'sample-metrics',
      pluginManifestVersion: 1,
      title: 'Stale Sample Metrics',
      version: '0.0.1',
      language: 'r',
    }),`);
  s = s.replace("    JSON.stringify({ id: 'deseq2', title: 'Stale DESeq2', inputs: [], outputs: [] }),",
    "    JSON.stringify({ id: 'sample-metrics', title: 'Stale Sample Metrics', inputs: [], outputs: [] }),");
  s = s.replace("  fs.writeFileSync(path.join(scriptsDir, 'deseq2.R'), 'stop(\"stale copy must not run\")\\n');",
    "  fs.writeFileSync(path.join(scriptsDir, 'sample-metrics.R'), 'stop(\"stale copy must not run\")\\n');");
  s = s.replace("    const selected = pluginLoader.getPlugin('deseq2');", "    const selected = pluginLoader.getPlugin('sample-metrics');");
  s = s.replace("      pluginLoader.getScriptForTool('deseq2'),", "      pluginLoader.getScriptForTool('sample-metrics'),");
  s = s.replace("      path.resolve('resources', 'built-in-plugins', 'deseq2', 'scripts', 'deseq2.R'),",
    "      path.resolve('test', 'fixtures', 'neutral-plugins', 'sample-metrics', 'scripts', 'sample-metrics.R'),");
  s = s.replace(/.*demo-counts\.csv\\\/\\\/sample-metrics[\s\S]{0,40}/, '');
  return s;
});

console.log('plugin-loader-refresh done (注意：demoPrompt 断言需人工核对)');
