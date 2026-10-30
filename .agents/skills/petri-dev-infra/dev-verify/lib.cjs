#!/usr/bin/env node
'use strict';

/**
 * .agents/skills/petri-dev-infra/dev-verify/lib.cjs — 实机校验公共原语（BLOCK-71）
 *
 * canonical 家在 petri-dev-infra skill 内（自洽可移植工具包）。
 * 从 block*-live.cjs 系列反复出现的样板中沉淀的四个原语：
 *   ready   pollTargets()        轮询 CDP /json 直到 dev Electron 就绪
 *   target  selectPageTarget()   按.URL 正则 + 主窗探测选中目标页
 *                                （BLOCK-68 教训：多窗口并存时壳窗口也可见，
 *                                 必须按项目树+右栏判真主窗，visibilityState 不可靠）
 *   assert  createRun()          断言记录 + PASS/FAIL 日志 + 证据 JSON 落盘
 *   capture evalJs()/screenshotPng()  带超时/异常透传的页面求值与截图
 *   pixels  pngPixelStats()      PNG 像素统计（把「真的进成像了」变成可数值断言）
 *
 * 环境纪律（AUDIT-LOG 2026-09-09）：dev 栈以 fnm Node 24 启动且带
 * PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"；本库默认连 9222，
 * 可用 PETRI_DEBUG_PORT 覆盖。本库只连接既有 dev 栈，不负责启动/重启 Electron
 * （后端代码变更后必须重启 dev Electron——这一步留在人/Agent 手里）。
 *
 * CDP 客户端单源复用宿主仓库 scripts/g0-rs-p7-cdp.cjs 的 CdpClient（按仓库根
 * 懒解析，不建第二套连接层）；跨仓库复用时按 PORTING.md 提供等价客户端。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

const REPO_ROOT = findRepoRoot(__dirname);
let _cdpClient = null;

/** 懒解析宿主仓库的 CDP 客户端；缺失时给可移植指引而非静默失败。 */
function loadCdpClient() {
  if (_cdpClient) return _cdpClient;
  const rel = path.join('scripts', 'g0-rs-p7-cdp.cjs');
  try {
    _cdpClient = require(path.join(REPO_ROOT, rel)).CdpClient;
  } catch {
    throw new Error(`cdp_client_missing: ${rel} 未找到 — 跨仓库复用见本 skill 的 PORTING.md（自备等价 CdpClient 或拷贝宿主客户端）`);
  }
  return _cdpClient;
}

const DEFAULT_PORT = process.env.PETRI_DEBUG_PORT || '9222';
// BLOCK-100 P3 — 测试实例专用 CDP 端口（与用户主实例 9222 隔离，永久红线：探针禁导航用户窗口）。
const TEST_INSTANCE_PORT = 9223;

function log(msg) {
  try { fs.writeSync(1, `[dev-verify] ${msg}\n`); } catch { /* stdout closed */ }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

/** ready 原语：轮询 CDP 端点直到可列出 targets；超时抛错（信息里带启动提示）。 */
async function pollTargets({ port = DEFAULT_PORT, timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      if (Array.isArray(targets)) return targets;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `cdp_not_ready_on_port_${port}${lastErr ? `: ${lastErr.message}` : ''}` +
    ` — 先启动 dev 栈：PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=${port}" npm run dev`,
  );
}

/** 连接一个 CDP target，返回已连接的 CdpClient。 */
async function connectTarget(target) {
  const CdpClient = loadCdpClient();
  return new CdpClient(target.webSocketDebuggerUrl).connect();
}

/** target 纯预筛：URL 命中 pattern 的 page 目标（不含探测，供测试与预筛用）。 */
function filterPageTargets(targets, urlPattern) {
  return (targets || []).filter((t) => t.type === 'page' && (!urlPattern || urlPattern.test(t.url)));
}

/**
 * target 原语：在候选页里选「真主窗」。
 * probe(client, target) 应返回 truthy 判定（如 projectTree+rightCol 探测）。
 * 依次探测，首个 truthy 即选中；全部不中则回退 fallbackSelector 或第一个候选
 * （保持 block68 行为，但探测优先）。connect 可注入以便纯逻辑单测。
 */
async function selectPageTarget(candidates, { probe, fallbackSelector, connect = connectTarget } = {}) {
  let fallback = null;
  for (const p of candidates) {
    if (!probe) return p;
    let client;
    try {
      client = await connect(p);
      const ok = await probe(client, p);
      if (ok) return p;
      if (!fallback && fallbackSelector) {
        const fb = await fallbackSelector(client, p);
        if (fb) fallback = p;
      }
    } catch { /* 探测失败的目标跳过 */ } finally {
      try { client?.socket?.close(); } catch { /* already closed */ }
    }
  }
  return fallback || candidates[0] || null;
}

/** capture 原语：带超时与异常透传的 Runtime.evaluate，返回 result.value。 */
async function evalJs(client, expr, timeoutMs = 30_000) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`eval_timeout_${timeoutMs}ms`)), timeoutMs)),
  ]);
  if (r.exceptionDetails) {
    throw new Error('eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
  }
  return r.result?.value;
}

/** capture 原语：整页 PNG 截图写入证据目录。 */
async function screenshotPng(client, evidenceDir, filename) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(evidenceDir, filename);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

/**
 * assert 原语：一次校验运行的断言记录器。
 * finish() 落盘 <slug>-live.json 并返回 allPass；证据契约与 block*-live 系列同构
 * （{startedAt, finishedAt, assertions:[{name,pass,detail}], allPass}）。
 */
// ── BLOCK-100 P3 — 测试实例原语 ─────────────────────────────────
// 连接测试实例（CDP 9223）。9223 为测试实例专属端口 = 第一层判别（绝不触碰
// 9222 用户主窗口）；?test=1 URL 标记 = 第二层。SPA 路由导航会丢查询串
// （2026-09-18 实机抓真：ui341 首问导航后 URL 变 /project/:id），故标记匹配
// 失败时回退 9223 上任意页面目标并告警——端口专属保证回退仍不误连。
async function connectTestTarget({ timeoutMs = 30_000 } = {}) {
  const targets = await pollTargets({ port: TEST_INSTANCE_PORT, timeoutMs });
  const pages = targets.filter((t) => t.type === 'page');
  if (!pages.length) {
    throw new Error('no_test_page_target_on_9223: ' + targets.map((t) => t.url).join(' | '));
  }
  const marked = pages.find((t) => String(t.url).includes('test=1'));
  if (!marked) {
    log(`warn: 9223 页面目标均无 ?test=1 标记（SPA 导航丢失查询串），按端口专属回退: ${pages[0].url}`);
  }
  return connectTarget(marked || pages[0]);
}

/** 只读断言 flow 的人因干扰屏蔽：测试期间忽略真实输入事件（含鼠标/键盘/触摸）。
 *  注意（D6 裁决）：会连 CDP 合成输入一并屏蔽——交互型 flow（合成点击）禁用，
 *  仅纯断言型 flow 使用。finally 恢复，探针崩溃不留「假死窗口」。 */
async function withInputShield(client, fn) {
  await client.send('Input.setIgnoreInputEvents', { ignore: true });
  try {
    return await fn();
  } finally {
    try {
      await client.send('Input.setIgnoreInputEvents', { ignore: false });
    } catch {
      // 连接已断时忽略；CDP 会话销毁后 Chromium 不再路由该 session 的屏蔽
    }
  }
}

function createRun({ name, evidenceDir }) {
  const slug = String(name || 'run').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  const startedAt = new Date().toISOString();
  const assertions = [];
  return {
    get allPass() { return assertions.length > 0 && assertions.every((a) => a.pass); },
    assertions,
    assert(assertName, pass, detail = '') {
      assertions.push({ name: assertName, pass: !!pass, detail: String(detail).slice(0, 400) });
      log(`${pass ? 'PASS' : 'FAIL'} ${assertName}${detail ? ` :: ${String(detail).slice(0, 140)}` : ''}`);
    },
    async finish(extra = {}) {
      const payload = { name, startedAt, finishedAt: new Date().toISOString(), assertions, allPass: this.allPass, ...extra };
      if (evidenceDir) {
        fs.mkdirSync(evidenceDir, { recursive: true });
        const file = path.join(evidenceDir, `${slug}-live.json`);
        fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
        log(`evidence: ${file}`);
      }
      log(`run "${name}": ${assertions.filter((a) => a.pass).length}/${assertions.length} assertions, allPass=${payload.allPass}`);
      return payload;
    },
  };
}

/**
 * PNG 像素统计（BLOCK-322 P2-02 首用，P2-03 复用）：纯 Node 解 IDAT（zlib inflate +
 * 五种行滤波），只支持 8bit 非隔行。用途=把「声明的东西真的进成像了」变成**可数值断言**，
 * 而不是靠观感。第二次出现即从 flow 里抽到公共原语，避免两份解码器彼此漂移。
 */
function pngPixelStats(buffer) {
  const zlib = require('node:zlib');
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not_png');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced_unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) throw new Error(`unsupported_png_depth_or_color(depth=${bitDepth},color=${colorType})`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
        value = (value + predictor) & 0xff;
      }
      line[x] = value;
    }
    line.copy(out, y * stride);
    previous = line;
  }
  let sum = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;
  for (let i = 0; i < out.length; i += channels) {
    if (channels === 1) {
      sum += out[i];
      red += out[i];
      green += out[i];
      blue += out[i];
      samples += 1;
      continue;
    }
    red += out[i];
    green += out[i + 1];
    blue += out[i + 2];
    sum += 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
    samples += 1;
  }
  if (!samples) return { mean: 0, r: 0, g: 0, b: 0, width, height, samples: 0 };
  return {
    mean: sum / samples,
    r: red / samples,
    g: green / samples,
    b: blue / samples,
    width,
    height,
    samples,
  };
}

module.exports = {
  DEFAULT_PORT,
  TEST_INSTANCE_PORT,
  connectTestTarget,
  withInputShield,
  findRepoRoot,
  log,
  fetchJson,
  pollTargets,
  connectTarget,
  filterPageTargets,
  selectPageTarget,
  evalJs,
  screenshotPng,
  pngPixelStats,
  createRun,
};
