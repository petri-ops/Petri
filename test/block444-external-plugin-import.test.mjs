import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { importExternalPlugin } from '../scripts/import-external-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test', 'fixtures', 'external-plugins');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `b444-${p}-`));

test('BLOCK-444 ZCode 扩展形态：skills 可迁移，extension/ui/hooks 显式诊断', async () => {
  const r = await importExternalPlugin({ sourceDir: path.join(FIX, 'zcode-demo') });
  assert.equal(r.ok, true);
  assert.equal(r.plugin.id, 'zcode-demo');
  assert.equal(r.plugin.version, '1.2.0');
  assert.deepEqual(r.imported.skills.map((s) => s.id).sort(), ['excalidraw-like', 'json-form']);
  // SKILL.md 的未知 frontmatter 键不阻断，description 正常解析
  const md = r.imported.skills.find((s) => s.id === 'excalidraw-like');
  assert.equal(md.format, 'SKILL.md');
  assert.equal(md.description, '用画板画架构图，可继续编辑');
  assert.ok(md.frontmatterKeys.includes('allowed-tools'));
  // MCP：.mcp.json 优先，stdio + http 都归一
  assert.deepEqual(r.imported.mcpServers.map((m) => `${m.id}:${m.transport}`).sort(), ['demo-http:http', 'demo-missing:stdio', 'demo-stdio:stdio']);
  // commands 投影为模板
  assert.equal(r.imported.commandTemplates.length, 1);
  assert.equal(r.imported.commandTemplates[0].name, 'summarize');
  // 不可迁移能力必须显式列出（不静默丢弃）
  const caps = r.unsupported.map((u) => u.capability).sort();
  assert.deepEqual(caps, ['extension-host', 'hooks', 'mcp-apps-ui', 'slash-commands']);
  assert.equal(r.applied, false, '默认 dry-run 不写入');
});

test('BLOCK-444 Claude Marketplace 形态：skills + sse 远程 MCP', async () => {
  const r = await importExternalPlugin({ sourceDir: path.join(FIX, 'claude-demo') });
  assert.equal(r.ok, true);
  assert.equal(r.plugin.id, 'claude-demo');
  assert.deepEqual(r.imported.skills.map((s) => s.id), ['doc-writer']);
  assert.equal(r.imported.mcpServers[0].transport, 'sse');
  assert.equal(r.imported.mcpServers[0].url, 'https://example.com/sse');
  assert.deepEqual(r.unsupported, []);
});

test('BLOCK-444 --apply：技能真实落到隔离 dataDir，MCP/命令模板落 JSON', async () => {
  const dataDir = tmp('apply');
  const prev = process.env.PETRI_USER_DATA_DIR;
  const r = await importExternalPlugin({ sourceDir: path.join(FIX, 'zcode-demo'), apply: true, dataDir });
  assert.equal(r.applied, true);
  // 技能落盘（SKILL.md 合成件 + skill.json 原样）
  const mdDest = path.join(dataDir, 'skills', 'excalidraw-like');
  assert.ok(fs.existsSync(path.join(mdDest, 'skill.json')), 'SKILL.md 分支应合成 skill.json');
  assert.ok(fs.existsSync(path.join(mdDest, 'prompts', 'system.md')), 'SKILL.md 正文应落为 prompts/system.md');
  assert.ok(fs.existsSync(path.join(dataDir, 'skills', 'json-form', 'skill.json')));
  // BLOCK-445：两个原技能 + 一个命令投影的合成技能，全部安装成功
  assert.deepEqual(r.imported.skills.map((s) => s.installed), [true, true, true]);
  const synthetic = r.imported.skills.find((s) => s.synthetic);
  assert.ok(synthetic, 'commands/ 应投影为合成技能');
  assert.ok(fs.existsSync(path.join(dataDir, 'skills', synthetic.id, 'skill.json')));
  // MCP / 命令模板输出
  assert.ok(fs.existsSync(path.join(dataDir, 'mcp-imported.json')));
  assert.ok(fs.existsSync(path.join(dataDir, 'command-templates.json')));
  const mcp = JSON.parse(fs.readFileSync(path.join(dataDir, 'mcp-imported.json'), 'utf8'));
  assert.equal(mcp.servers.length, 3);
  // 引用插件内脚本且不存在 → 显式诊断（不是静默给一个跑不起来的配置）
  const missing = r.diagnostics.find((d) => d.code === 'mcp_entry_script_missing');
  assert.ok(missing, '缺脚本必须有诊断');
  assert.equal(missing.entries[0].serverId, 'demo-missing');
  // ROOT 变量已替换为真实复制目录
  const missingSrv = r.imported.mcpServers.find((x) => x.id === 'demo-missing');
  assert.ok(String(missingSrv.args[0]).startsWith(r.pluginCopyDir), '${ZCODE_PLUGIN_ROOT} 应替换为复制目录');
  // 不得污染调用方环境变量
  assert.equal(process.env.PETRI_USER_DATA_DIR, prev);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('BLOCK-444 无清单目录：fail-closed 且给出候选清单', async () => {
  const dir = tmp('empty');
  const r = await importExternalPlugin({ sourceDir: dir });
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].code, 'manifest_not_found');
  assert.ok(Array.isArray(r.diagnostics[0].candidates));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('BLOCK-444 zip 分支：穿越条目被拒，不产生导入结果', async () => {
  // 最小 stored zip 构造器（与既有 zip 测试同思路）
  const makeZip = (entries) => {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, content] of entries) {
      const nameBuf = Buffer.from(name, 'utf8');
      const data = Buffer.from(content, 'utf8');
      let c = ~0;
      for (const b of data) {
        c ^= b;
        for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
      }
      const crc = (~c) >>> 0;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      locals.push(local, nameBuf, data);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, nameBuf);
      offset += 30 + nameBuf.length + data.length;
    }
    const centralBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBuf, end]);
  };
  const dir = tmp('zip');
  const zipPath = path.join(dir, 'evil.zip');
  fs.writeFileSync(zipPath, makeZip([['../evil.txt', 'pwned']]));
  const r = await importExternalPlugin({ zipFile: zipPath });
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].code, 'zip_extract_failed');
  assert.equal(fs.existsSync(path.join(dir, '..', 'evil.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});


test('BLOCK-445 --no-command-skills：关闭命令投影后只装原技能', async () => {
  const dataDir = tmp('no-cmd');
  const r = await importExternalPlugin({
    sourceDir: path.join(FIX, 'zcode-demo'), apply: true, dataDir, commandsAsSkills: false,
  });
  assert.deepEqual(r.imported.skills.map((s) => s.id).sort(), ['excalidraw-like', 'json-form']);
  assert.equal(r.imported.commandTemplates.length, 1, '命令模板仍报告（只是不投影）');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
