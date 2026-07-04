// MCP 端到端验收（手动跑，不进测试套件）
// 用真实 MCP client 连 biof3-mcp，调已装的 deseq2 跑完整 DESeq2 流程
// 运行：cd desktop-app && node test/mcp-acceptance-deseq2.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const demoDir = join(homedir(), 'Documents', 'BioF3-Local', 'plugins', 'deseq2', 'demo-data');

console.log('=== MCP 端到端验收：deseq2 ===');
console.log('demo 数据目录:', demoDir);
console.log('counts 存在:', existsSync(join(demoDir, 'demo-counts.csv')));
console.log('coldata 存在:', existsSync(join(demoDir, 'demo-coldata.csv')));

const transport = new StdioClientTransport({ command: 'biof3-mcp', args: [] });
const client = new Client({ name: 'acceptance-test', version: '1.0.0' });
await client.connect(transport);

console.log('\n--- 1. tools/list ---');
const { tools } = await client.listTools();
console.log(`返回 ${tools.length} 个工具:`, tools.map((t) => t.name).join(', '));
const deseq2 = tools.find((t) => t.name === 'deseq2');
if (!deseq2) {
  console.error('✗ deseq2 未在工具列表（插件未装？）');
  await client.close();
  process.exit(1);
}
console.log('deseq2 inputSchema required:', deseq2.inputSchema.required);

console.log('\n--- 2. tools/call deseq2（真实跑 DESeq2，可能 30-60s）---');
const t0 = Date.now();
const result = await client.callTool({
  name: 'deseq2',
  arguments: {
    counts: join(demoDir, 'demo-counts.csv'),
    coldata: join(demoDir, 'demo-coldata.csv'),
    design: 'condition',
    contrast_ref: 'Control',
    contrast_treat: 'Treatment',
  },
});
const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`耗时 ${dt}s, isError=${result.isError}`);

const summary = JSON.parse(result.content[0].text);
if (result.isError) {
  console.error('✗ 执行失败:', summary);
  await client.close();
  process.exit(1);
}

console.log('\n--- 3. 结果 ---');
console.log('jobDir:', summary.jobDir);
console.log('outputs:');
for (const o of summary.outputs || []) {
  const ok = existsSync(o.path);
  const label = o.id || o.filename || o.name || o.path.split('/').pop();
  console.log(`  ${ok ? '✓' : '✗'} ${label} (${o.type}) → ${o.path}`);
}
console.log('manifest.summary:', JSON.stringify(summary.manifest?.summary || {}, null, 2));

await client.close();
console.log('\n=== 验收完成 ===');
