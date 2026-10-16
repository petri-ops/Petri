#!/usr/bin/env node
/**
 * scripts/block185-p3-live.mjs — BLOCK-185 P3 冷启动深链 live 冒烟（dev Electron 测试实例 9223）。
 *
 * 诚实边界（如实登记，不冒充已验）：
 *  - last-url 真机重启恢复：测试实例按设计禁用恢复（护 CDP 探针红线）→ 本探针**不**验证恢复，
 *    恢复决策逻辑由 test/block185-main-window-state.test.mjs 纯函数单测覆盖（computeStartupLoadUrl 三分支）。
 *  - 后端未就绪时序竞态（Race B 真因）：需 kill 后端在就绪窗口内 reload 才能确定复现，非稳定探针范畴
 *    → 由 coldStartRetry.test.ts 退避重试原语单测覆盖。
 *  - 本探针验证：①主进程 loadURL 改动未破坏启动/导航（app boots + 页面 target 健康）
 *    ②深链路由端到端不崩（handleOpenResult 经 retryOnThrow 路径跑完，缺 job 给诚实态而非白屏/异常）
 *    ③整页 reload 后项目深链路由保持（不被重置回 `/`）。
 *
 * 证据落 acceptance/block-184/../block-185/。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const lib = await import(pathToFileURL(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs')).href).then((m) => m.default ?? m);
const { connectTestTarget, evalJs, screenshotPng, createRun, log } = lib;

const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };
const API = 'http://127.0.0.1:3001/api';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-185');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(id, ok, detail = '') {
  results.push({ id, ok: !!ok, detail: String(detail).slice(0, 300) });
  log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` :: ${String(detail).slice(0, 140)}` : ''}`);
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const run = createRun({ name: 'block185-p3', evidenceDir: EVIDENCE });
  const client = await connectTestTarget({ timeoutMs: 25000 });
  await client.send('Page.enable');
  log('attached test instance (9223)');

  // 取一个真实项目做深链锚（无 job，测端到端不崩 + 路由保持）
  const projList = await (await fetch(`${API}/data/projects`, { headers: AUTH })).json().catch(() => ({}));
  const projects = projList.projects || projList.items || [];
  const pid = projects[0]?.id;
  record('SMOKE.projects-available', !!pid, `projects=${projects.length} pid=${pid || 'none'}`);
  if (!pid) {
    await run.finish({ results });
    fs.writeFileSync(path.join(EVIDENCE, 'block185-p3-live.json'), JSON.stringify({ results, allPass: false }, null, 2) + '\n');
    return;
  }

  const deepUrl = `http://localhost:3000/project/${pid}?mode=result&job=b185-nonexistent-job`;
  await client.send('Page.navigate', { url: deepUrl });
  await sleep(6000); // 覆盖 handleOpenResult 退避重试窗口（0/1/2/4s）+ 余量

  const afterOpen = await evalJs(client, `(() => ({
    url: location.href,
    body: (document.body.innerText || '').slice(0, 400),
  }))()`);
  // 端到端不崩：仍在项目路由（未白屏/未跳回 /），且 handleOpenResult 跑完（诚实「找不到」态或结果面板）
  record('SMOKE.no-crash-on-deeplink', String(afterOpen.url).includes(`/project/${pid}`), `url=${afterOpen.url}`);
  const honestOrResult = /找不到这个结果|无权访问|结果|分析入口|暂无|对话/.test(afterOpen.body);
  record('SMOKE.deeplink-path-completes', honestOrResult, `body~=${afterOpen.body.replace(/\s+/g, ' ').slice(0, 120)}`);
  await screenshotPng(client, EVIDENCE, 'b185-deeplink-nonexistent-job-honest-state.png');

  // 整页 reload：项目深链路由应保持（不被重置回根 /）
  await client.send('Page.reload');
  await sleep(4000);
  const afterReload = await evalJs(client, `location.href`);
  record('DEEPLINK.route-preserved-after-reload', String(afterReload).includes(`/project/${pid}`), `url=${afterReload}`);
  await screenshotPng(client, EVIDENCE, 'b185-after-reload-route-preserved.png');

  const fail = results.filter((r) => r.ok === false).length;
  const payload = await run.finish({ results });
  if (payload && typeof payload === 'object') {
    payload.allPass = fail === 0;
    fs.writeFileSync(path.join(EVIDENCE, 'block185-p3-live.json'), JSON.stringify(payload, null, 2) + '\n');
  }
  log(`block185-p3: ${results.filter((r) => r.ok).length} pass / ${fail} fail`);
  if (fail > 0) process.exitCode = 2;
  client.socket?.close?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
