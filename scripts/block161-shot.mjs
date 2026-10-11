/** W2-4 批次截图对（前态/后态由调用时机区分，argv[2]=文件名）。 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-161');
const name = process.argv[2] || 'w2-radius-batch.png';
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const {
  pollTargets, filterPageTargets, selectPageTarget, evalJs, screenshotPng, connectTarget,
} = await import(pathToFileURL(libPath).href).then((m) => m.default ?? m);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await pollTargets({ timeoutMs: 20_000 });
const target = await selectPageTarget(filterPageTargets(targets, /localhost:3000/), {
  probe: async (c) => !!(await evalJs(c, 'document.querySelector("#root")')),
});
const client = await connectTarget(target);
await sleep(800);
if (process.argv[3]) {
  await evalJs(client, `location.href = 'http://localhost:3000/project/" + process.argv[3] + "'`);
  await sleep(3500);
}
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
await screenshotPng(client, EVIDENCE_DIR, name);
console.log('saved:', path.join(EVIDENCE_DIR, name));
process.exit(0);
