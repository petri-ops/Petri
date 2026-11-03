'use strict';

/**
 * helpers/godot-tools.js — BLOCK-341 P2/P3 受治理 Godot 桥核心实现。
 *
 * 红线（plan §3）：不开放任意 shell 参数与路径逃逸；项目路径必须在工作区内（或显式
 * 项目目录内）；白名单外改动走坡道（P3 的 apply 面在此文件只做白名单校验，坡道接线
 * 由 agent-tool-interceptor 的既有契约承载——godot_scene_apply 走 propose/apply 两步）。
 *
 * 截图序列：优先 `--write-movie <dir>/movie.png`（PNG 序列 + frames.wav）；
 * headless 模式下 viewport 无渲染 → 默认带显示驱动跑（mac 实机探针验证）；
 * `--quit-after N` 控制帧数；超时 killTree（复用 dev-task-runner 先例）。
 */

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { probeGodot } = require('./godot-provider');

const RUN_DEFAULT_FRAMES = 60;
const RUN_MAX_FRAMES = 600;
const RUN_TIMEOUT_MS_MAX = 120_000;
const SCENE_EXT_RE = /\.(tscn|gd|godot)$/i;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 项目目录安全校验：必须含 project.godot；不允许越出 workspaceRoot。 */
function resolveProjectDir(workspaceRoot, projectPath) {
  const rel = String(projectPath || '.');
  const resolved = path.resolve(workspaceRoot, rel);
  if (!resolved.startsWith(path.resolve(workspaceRoot) + path.sep) && resolved !== path.resolve(workspaceRoot)) {
    return { ok: false, code: 'path_escape', message: '项目路径必须在工作区内' };
  }
  if (!fs.existsSync(path.join(resolved, 'project.godot'))) {
    return { ok: false, code: 'project_missing', message: '项目目录必须包含 project.godot' };
  }
  return { ok: true, dir: resolved };
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSyncSpawn('taskkill', ['/PID', String(pid), '/T', '/F']);
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch { /* already dead */ }
}

function execFileSyncSpawn(cmd, args) {
  const { spawnSync } = require('node:child_process');
  spawnSync(cmd, args, { stdio: 'ignore' });
}

/**
 * P2 — godot_run：跑项目 ≤N 渲染帧，采集 stdout/stderr/退出码/截图序列 → manifest。
 * 截图序列经 --write-movie PNG 输出（同目录 frames%08d.png + frames.wav）。
 * @param {{workspaceRoot: string, projectPath?: string, frames?: number,
 *   captureFrames?: boolean, scene?: string}} options
 * @returns {Promise<object>} manifest 或 { ok:false, code, message }
 */
function godotRun({ workspaceRoot, projectPath = '.', frames, captureFrames = true, scene }) {
  const probe = probeGodot();
  if (!probe.ok) return probe;

  const project = resolveProjectDir(workspaceRoot, projectPath);
  if (!project.ok) return project;

  const frameCount = Math.min(Math.max(1, Number(frames) || RUN_DEFAULT_FRAMES), RUN_MAX_FRAMES);
  const timeoutMs = Math.min(RUN_TIMEOUT_MS_MAX, Math.max(1000, frameCount * 100 + 5000));

  const outDir = path.join(project.dir, '.petri', 'godot-runs');
  const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const runDir = path.join(outDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const args = ['--path', project.dir];
  if (scene) args.push('--scene', String(scene));
  if (captureFrames) {
    // PNG 序列写到 runDir/movie.png（Godot 按 movie.png 去后缀生成 movie00000000.png...）
    args.push('--write-movie', path.join(runDir, 'movie.png'), '--fixed-fps', '10');
  }
  args.push('--quit-after', String(frameCount));

  const startedAt = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(probe.bin, args, { cwd: project.dir, env: { ...process.env } });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; if (stdout.length > 256 * 1024) stdout = stdout.slice(-131072); });
    child.stderr.on('data', (c) => { stderr += c; if (stderr.length > 128 * 1024) stderr = stderr.slice(-65536); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: 'godot_spawn_failed', message: String((error && error.message) || error).slice(0, 200) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      // 收集截图序列（PNG 序列命名 movie%08d.png）
      let screenshots = [];
      if (captureFrames) {
        try {
          // Godot 以 --path（项目目录）为基准写输出 → 帧的 workspace 相对路径须含 projectPath 段
          const runDirRel = path.relative(workspaceRoot, runDir);
          screenshots = fs.readdirSync(runDir)
            .filter((f) => /^movie\d+\.png$/.test(f))
            .sort()
            .map((f) => {
              const fp = path.join(runDir, f);
              return { file: path.join(runDirRel, f), sha256: sha256(fs.readFileSync(fp)), sizeBytes: fs.statSync(fp).size };
            });
        } catch { /* runDir 缺失 → 空 */ }
      }
      const logFile = path.join(runDir, 'stdout.log');
      try { fs.writeFileSync(logFile, `--stdout--\n${stdout}\n--stderr--\n${stderr}`, 'utf8'); } catch { /* best-effort */ }

      const manifest = {
        ok: timedOut ? true : code === 0,
        runId,
        timedOut,
        exitCode: code,
        durationMs,
        frames: frameCount,
        captureFrames,
        screenshots,
        screenshotCount: screenshots.length,
        screenshotsDir: path.join('.petri', 'godot-runs', runId),
        logFile: path.join('.petri', 'godot-runs', runId, 'stdout.log'),
        stdoutTail: stdout.slice(-600),
        stderrTail: stderr.slice(-400),
        projectPath: projectPath || '.',
        engine: probe.version,
      };
      try {
        fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      } catch { /* best-effort */ }
      resolve(manifest);
    });
  });
}

/**
 * P3 — godot_scene_apply 白名单校验（propose/apply 两步的 propose 侧）。
 * 只接受：节点属性 / 资源引用 / 脚本片段替换三类操作；文件必须 .tscn/.gd/.godot 且在工作区内。
 * 白名单外一律返回 require-ack（拦截器契约承载坡道），绝不静默放行。
 * @param {{workspaceRoot: string, filePath: string, op: string, payload?: object}} options
 */
function validateSceneApply({ workspaceRoot, filePath, op, payload }) {
  const rel = String(filePath || '');
  const resolved = path.resolve(workspaceRoot, rel);
  if (!resolved.startsWith(path.resolve(workspaceRoot) + path.sep)) {
    return { ok: false, code: 'path_escape', message: '文件路径必须在工作区内' };
  }
  if (!SCENE_EXT_RE.test(resolved)) {
    return { ok: false, code: 'unsupported_format', message: '仅支持 .tscn / .gd / .godot' };
  }
  const ALLOWED_OPS = new Set(['set_node_property', 'set_resource_ref', 'replace_script_snippet']);
  if (!ALLOWED_OPS.has(String(op))) {
    return { ok: false, code: 'op_not_whitelisted', message: `操作「${op}」不在白名单（set_node_property / set_resource_ref / replace_script_snippet）——须走人工审批（require-ack）` };
  }
  // payload 形状校验先行（file 缺席时 payload 错误也应如实报 payload_invalid——
  // 校验顺序 = 白名单 op → payload 形状 → 文件在场）
  if (op === 'set_node_property' && (!payload || !payload.node || !payload.property)) {
    return { ok: false, code: 'payload_invalid', message: 'set_node_property 需要 payload.node + payload.property' };
  }
  if (op === 'set_resource_ref' && (!payload || !payload.target || !payload.resourcePath)) {
    return { ok: false, code: 'payload_invalid', message: 'set_resource_ref 需要 payload.target + payload.resourcePath' };
  }
  if (op === 'replace_script_snippet' && (!payload || typeof payload.find !== 'string' || typeof payload.replace !== 'string')) {
    return { ok: false, code: 'payload_invalid', message: 'replace_script_snippet 需要 payload.find + payload.replace（字符串）' };
  }
  const beforeSha = fs.existsSync(resolved) ? sha256(fs.readFileSync(resolved)) : null;
  if (beforeSha === null) {
    return { ok: false, code: 'file_not_found', message: `文件不存在: ${filePath}` };
  }
  return { ok: true, filePath: rel, op, payload, beforeSha256: beforeSha };
}

/** P3 apply 执行侧：白名单操作落到 .tscn/.gd 文本（propose 返回的 payload 原样执行）。 */
function applySceneEdit({ workspaceRoot, filePath, op, payload, beforeSha256 }) {
  const resolved = path.resolve(workspaceRoot, String(filePath || ''));
  if (!resolved.startsWith(path.resolve(workspaceRoot) + path.sep)) {
    return { ok: false, code: 'path_escape' };
  }
  const currentSha = sha256(fs.readFileSync(resolved));
  if (beforeSha256 && currentSha !== beforeSha256) {
    return { ok: false, code: 'stale_propose', message: '文件在 propose 之后已被修改——重新 propose（防覆盖并发改动）' };
  }
  const text = fs.readFileSync(resolved, 'utf8');
  let after = text;
  if (op === 'set_node_property') {
    // .tscn 节点属性：在 [node name="X"] 段内改/增 property=value（文本级最小实现）
    const { node, property, value } = payload;
    const nodeRe = new RegExp(`(\\[node name="${String(node).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^\\]]*\\])([^[]*)`);
    if (nodeRe.test(after)) {
      after = after.replace(nodeRe, (_m, head, body) => {
        const propRe = new RegExp(`^${String(property).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=.*$`, 'm');
        const newBody = propRe.test(body)
          ? body.replace(propRe, `${property} = ${JSON.stringify(value)}`)
          : `${body}${property} = ${JSON.stringify(value)}\n`;
        return head + newBody;
      });
    } else {
      return { ok: false, code: 'node_not_found', message: `节点「${node}」不存在于 ${filePath}` };
    }
  } else if (op === 'replace_script_snippet') {
    if (!text.includes(payload.find)) {
      return { ok: false, code: 'snippet_not_found', message: 'payload.find 未在文件中出现（逐字匹配）' };
    }
    after = text.replace(payload.find, payload.replace);
  } else if (op === 'set_resource_ref') {
    // 资源引用：把 target 属性值改为 resourcePath（ExtResource 行由 Godot 导入器自管——文本级替换 target=value）
    const { target, resourcePath } = payload;
    const re = new RegExp(`(${String(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*)("[^"]*"|ExtResource\\([^)]*\\))`);
    if (re.test(after)) {
      after = after.replace(re, `$1"${String(resourcePath).replace(/"/g, '')}"`);
    } else {
      return { ok: false, code: 'target_not_found', message: `属性「${target}」未在文件中出现` };
    }
  }
  fs.writeFileSync(resolved, after, 'utf8');
  const afterSha = sha256(fs.readFileSync(resolved));
  return {
    ok: true,
    filePath: String(filePath),
    op,
    beforeSha256,
    afterSha256: afterSha,
    changed: after !== text,
    semanticDiffHead: after !== text ? diffHead(text, after) : '(no change)',
  };
}

function diffHead(before, after) {
  const b = before.split('\n');
  const a = after.split('\n');
  const changes = [];
  for (let i = 0; i < Math.max(b.length, a.length) && changes.length < 5; i += 1) {
    if (b[i] !== a[i]) changes.push(`L${i + 1}: ${String(b[i] || '(absent)').trim().slice(0, 60)} → ${String(a[i] || '(absent)').trim().slice(0, 60)}`);
  }
  return changes.join(' | ');
}

module.exports = {
  RUN_DEFAULT_FRAMES,
  RUN_MAX_FRAMES,
  SCENE_EXT_RE,
  resolveProjectDir,
  godotRun,
  validateSceneApply,
  applySceneEdit,
};
