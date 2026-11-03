'use strict';

/**
 * agent-tools/svg-tools.js — BLOCK-342 W1 P2 受治理 SVG 编辑工具。
 *
 * svg_inspect：只读结构清单（元素 path/id/tag/文本节选）+ 危险面标记（载入编辑器前会脱敏）。
 * svg_edit：白名单 op 的 propose/apply 两步——
 *   - propose：只校验并回 beforeSha256（不写盘、不触碰文件）；
 *   - apply：必须以同一 beforeSha256 为前提；期间人/外部工具改过 ⇒ svg_hash_mismatch，
 *     agent 必须基于新真值重新 propose（人的修正天然不可被覆盖）。
 *   写盘前把旧版本落 `.petri/svg-revisions/`（审计副本；真值仍是工作区文件本身，不建第二真值）。
 *   白名单外 op / 危险 markup 走 require-ack 语义（与 godot_scene_apply 同款）。
 */

const fs = require('node:fs');
const path = require('node:path');
const svgOps = require('../helpers/svg-ops');
const inkscape = require('../helpers/inkscape');

/** 单文件上限：科研出图 SVG 通常 <2MB；8MB 为解析/编辑的诚实边界。 */
const MAX_SVG_BYTES = 8 * 1024 * 1024;
/** 审计快照目录（工作区内，非真值；真值永远是用户文件）。 */
const SNAPSHOT_REL_DIR = path.join('.petri', 'svg-revisions');

/** 需要人工确认的拒绝码（拦截器坡道用；与工具结果 error 字段并存）。 */
const REQUIRE_ACK_CODES = new Set(['svg_op_not_allowed', 'svg_unsafe_markup']);

function resolveProject(ctx) {
  const projectId = ctx && ctx.projectId;
  if (!projectId) return { ok: false, code: 'project_required', message: 'SVG 工具需要有效项目工作区' };
  // ctx.db 仅供测试/隔离栈注入（生产恒走真实 db 单例）
  const dbMod = (ctx && ctx.db) || require('../db');
  const project = dbMod.getProject(String(projectId));
  if (!project || !project.workspace_path) {
    return { ok: false, code: 'workspace_required', message: 'SVG 工具需要本地工作区项目' };
  }
  return { ok: true, workspaceRoot: project.workspace_path };
}

function resolveFile(workspaceRoot, filePath) {
  const rel = String(filePath === undefined || filePath === null ? '' : filePath);
  if (rel === '') return { ok: false, code: 'path_invalid', message: 'filePath 必填' };
  const rootAbs = path.resolve(workspaceRoot);
  const abs = path.resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    return { ok: false, code: 'path_escape', message: '文件路径必须在工作区内' };
  }
  if (!/\.svg$/i.test(abs)) {
    return { ok: false, code: 'unsupported_format', message: '只支持 .svg 文件（位图像素编辑不在本工具范围）' };
  }
  return { ok: true, abs, rel: path.relative(rootAbs, abs).split(path.sep).join('/') };
}

function readSvgFile(abs, rel) {
  if (!fs.existsSync(abs)) return { ok: false, code: 'file_not_found', message: `文件不存在：${rel}` };
  const stat = fs.statSync(abs);
  if (!stat.isFile()) return { ok: false, code: 'file_not_found', message: `不是普通文件：${rel}` };
  if (stat.size > MAX_SVG_BYTES) {
    return {
      ok: false,
      code: 'file_too_large',
      message: `SVG 文件 ${Math.round(stat.size / 1024)}KB 超过上限 ${MAX_SVG_BYTES / 1024 / 1024}MB（本工具不做流式改写）`,
    };
  }
  const text = fs.readFileSync(abs, 'utf8');
  return { ok: true, text, sha256: svgOps.sha256(text), sizeBytes: stat.size };
}

/** 审计快照：写盘前把旧版本按 `<name>-<时间戳>-<sha8>.svg` 落 .petri/svg-revisions/。 */
function writeRevisionSnapshot(workspaceRoot, rel, text, sha) {
  const dir = path.join(workspaceRoot, SNAPSHOT_REL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(rel).replace(/\.svg$/i, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${base}-${stamp}-${sha.slice(0, 8)}.svg`);
  fs.writeFileSync(file, text, 'utf8');
  return path.relative(workspaceRoot, file).split(path.sep).join('/');
}

function opSummary(applied) {
  return (applied || []).map((entry) => {
    const op = entry.op || {};
    const target = entry.target || {};
    const where = target.id ? `#${target.id}` : `<${target.tag || '?'} path=[${(target.path || []).join(',')}]>`;
    const detail = op.op === 'set_attr' ? `${op.name}=${JSON.stringify(op.value)}`
      : op.op === 'remove_attr' ? `${op.name}`
        : op.op === 'set_style' ? JSON.stringify(op.props)
          : op.op === 'set_text' ? JSON.stringify(op.text)
            : op.op === 'insert' ? `${(op.markup || '').slice(0, 60)}`
              : op.op === 'move' ? `→ index ${op.index}`
                : '';
    return { op: op.op, target: where, detail, changed: entry.before !== entry.after };
  });
}

/**
 * tool_svg_inspect — 只读结构清单。
 * @param {object} args { filePath, target?, tag?, limit? }
 * @param {object} ctx { projectId }
 */
function tool_svg_inspect(args, ctx) {
  const project = resolveProject(ctx);
  if (!project.ok) return { error: project.code, message: project.message };
  const file = resolveFile(project.workspaceRoot, args && args.filePath);
  if (!file.ok) return { error: file.code, message: file.message };
  const read = readSvgFile(file.abs, file.rel);
  if (!read.ok) return { error: read.code, message: read.message };

  const inspected = svgOps.inspectSvg(read.text, {
    tag: args && typeof args.tag === 'string' ? args.tag : undefined,
    limit: args && Number.isFinite(args.limit) ? Math.max(1, Math.min(1000, Number(args.limit))) : 200,
  });
  if (!inspected.ok) return { error: inspected.code, message: inspected.message };

  // 单元素定位（可选）：目标详情 + 其子元素数量，便于编辑前确认 span
  let target = null;
  if (args && args.target) {
    const safe = svgOps.applyOpsSafe(read.text, []);
    if (safe.ok) {
      try {
        const tree = svgOps.parseSvg(read.text);
        const node = svgOps.resolveTarget(tree, args.target);
        target = {
          tag: node.tag,
          path: node.path,
          id: node.id,
          attrCount: node.attrs.length,
          childCount: node.children.length,
          textPreview: node.text,
          selfClosing: node.selfClosing,
        };
      } catch (e) {
        return { error: (e && e.code) || 'svg_error', message: (e && e.message) || 'target 解析失败' };
      }
    }
  }

  const unsafeNote = inspected.unsafe.any
    ? `⚠ 文件含危险面（script=${inspected.unsafe.script} foreignObject=${inspected.unsafe.foreignObject} on事件=${inspected.unsafe.eventAttrs} 危险链接=${inspected.unsafe.dangerousHref}）——编辑器载入时会脱敏，agent 编辑不会删除这些既有内容。`
    : '未发现危险面。';

  const lines = [
    `${file.rel}：<${inspected.rootTag}> 共 ${inspected.total} 个元素${inspected.truncated ? `（已截断到 ${inspected.returned} 条，用 tag/limit 收窄）` : ''}`,
    ...inspected.elements.slice(0, 20).map((el) => {
      const label = el.id ? `#${el.id}` : `<${el.tag} path=[${(el.path || []).join(',')}]>`;
      const text = el.textPreview ? ` "${el.textPreview.slice(0, 40)}"` : '';
      return `  ${label}${text}（attr ${el.attrCount}）`;
    }),
    inspected.returned > 20 ? `  … 其余 ${inspected.returned - 20} 条省略` : '',
    target ? `目标：<${target.tag}> path=[${(target.path || []).join(',')}] ${target.selfClosing ? '（自闭合）' : `子元素 ${target.childCount} 个`}` : '',
    unsafeNote,
  ].filter(Boolean);

  return {
    ok: true,
    filePath: file.rel,
    sha256: read.sha256,
    sizeBytes: read.sizeBytes,
    rootTag: inspected.rootTag,
    total: inspected.total,
    returned: inspected.returned,
    truncated: inspected.truncated,
    elements: inspected.elements,
    target,
    unsafe: inspected.unsafe,
    description: lines.join('\n'),
  };
}

/** 提案预览上限（1MB）：超出截断为前缀并显式标记，避免把大文件整份塞进会话/UI。 */
const PREVIEW_LIMIT = 1024 * 1024;

function capPreview(text) {
  if (typeof text !== 'string') return '';
  if (text.length <= PREVIEW_LIMIT) return text;
  return `${text.slice(0, PREVIEW_LIMIT)}\n<!-- preview truncated at ${PREVIEW_LIMIT} chars -->`;
}

/**
 * tool_svg_revisions — 只读：该文件的修订快照历史（.petri/svg-revisions/，人/agent 同一时间线）。
 * 只列目录，不读内容、不写、不建第二真值。
 * @param {object} args { filePath, limit? }
 * @param {object} ctx { projectId }
 */
function tool_svg_revisions(args, ctx) {
  const project = resolveProject(ctx);
  if (!project.ok) return { error: project.code, message: project.message };
  const file = resolveFile(project.workspaceRoot, args && args.filePath);
  if (!file.ok) return { error: file.code, message: file.message };
  const dir = path.join(project.workspaceRoot, SNAPSHOT_REL_DIR);
  const base = path.basename(file.rel).replace(/\.svg$/i, '');
  const limit = args && Number.isFinite(args.limit) ? Math.max(1, Math.min(100, Number(args.limit))) : 30;
  let entries = [];
  try {
    entries = fs.readdirSync(dir)
      .filter((name) => name.startsWith(`${base}-`) && name.endsWith('.svg'))
      .map((name) => {
        const match = /^(.*)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)-([0-9a-f]{8})\.svg$/.exec(name);
        return {
          file: `${SNAPSHOT_REL_DIR}/${name}`,
          at: match ? match[2] : '',
          sha8: match ? match[3] : '',
          sizeBytes: (() => { try { return fs.statSync(path.join(dir, name)).size; } catch { return 0; } })(),
        };
      })
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit);
  } catch {
    entries = [];
  }
  return { ok: true, filePath: file.rel, total: entries.length, revisions: entries };
}

/**
 * tool_svg_revision — 只读：按快照文件名读历史内容（供「点历史预览那一版」）。
 * 路径双重限定：必须在 .petri/svg-revisions 下，且前缀与该文件 stem 匹配。
 * @param {object} args { filePath, revision }
 * @param {object} ctx { projectId }
 */
function tool_svg_revision(args, ctx) {
  const project = resolveProject(ctx);
  if (!project.ok) return { error: project.code, message: project.message };
  const file = resolveFile(project.workspaceRoot, args && args.filePath);
  if (!file.ok) return { error: file.code, message: file.message };
  const name = typeof (args && args.revision) === 'string' ? path.basename(args.revision) : '';
  const base = path.basename(file.rel).replace(/\.svg$/i, '');
  if (!name || !name.startsWith(`${base}-`) || !name.endsWith('.svg')) {
    return { error: 'revision_invalid', message: '快照文件名不合法（必须属于该 SVG 的修订）' };
  }
  const abs = path.join(project.workspaceRoot, SNAPSHOT_REL_DIR, name);
  if (!fs.existsSync(abs)) return { error: 'file_not_found', message: `快照不存在：${name}` };
  const text = fs.readFileSync(abs, 'utf8');
  const inspected = svgOps.inspectSvg(text, { limit: 500 });
  return {
    ok: true,
    filePath: file.rel,
    revision: name,
    text,
    total: inspected.ok ? inspected.total : 0,
    elements: inspected.ok ? inspected.elements : [],
  };
}

/**
 * tool_svg_edit — 白名单 op 的 propose/apply。
 * @param {object} args { filePath, ops, apply?, beforeSha256? }
 * @param {object} ctx { projectId }
 */
function tool_svg_edit(args, ctx) {
  const project = resolveProject(ctx);
  if (!project.ok) return { error: project.code, message: project.message };
  const file = resolveFile(project.workspaceRoot, args && args.filePath);
  if (!file.ok) return { error: file.code, message: file.message };
  const read = readSvgFile(file.abs, file.rel);
  if (!read.ok) return { error: read.code, message: read.message };

  const ops = args ? args.ops : undefined;
  if (!Array.isArray(ops)) return { error: 'svg_op_invalid', message: 'ops 必须是数组' };

  const isApply = !!(args && args.apply === true);

  // propose：只校验（不写盘）。apply：以调用方回传的 beforeSha256 为前提重跑同一批 op。
  const expectedSha = isApply ? args.beforeSha256 : undefined;
  if (isApply && (typeof expectedSha !== 'string' || expectedSha === '')) {
    return {
      error: 'before_sha_required',
      message: 'apply 必须携带 propose 返回的 beforeSha256（防止覆盖期间的人为改动）',
    };
  }

  const applied = svgOps.applyOpsSafe(read.text, ops, expectedSha ? { expectedSha } : undefined);
  if (!applied.ok) {
    return {
      error: applied.code,
      message: applied.message,
      requireAck: REQUIRE_ACK_CODES.has(applied.code) || undefined,
      beforeSha256: read.sha256,
      hint: applied.code === 'svg_hash_mismatch' ? '文件在 propose 之后被改动过：重新 svg_inspect 取新 beforeSha256 再 propose。' : undefined,
    };
  }

  const summary = opSummary(applied.applied);

  if (!isApply) {
    return {
      ok: true,
      propose: true,
      filePath: file.rel,
      beforeSha256: read.sha256,
      afterSha256: applied.afterSha,
      changed: applied.changed,
      semanticDiff: summary,
      // BLOCK-342 W4 — 提案预览文本（仅在内存返回，不落盘、不进第二真值）：供编辑器做幽灵叠加与逐元素取舍
      previewMarkup: applied.changed ? capPreview(applied.text) : read.text,
      next: applied.changed
        ? '确认无误后再次调用并携带 apply:true 与 beforeSha256 执行写盘。'
        : '本批操作不产生任何字节变化（零操作零 diff），无需写盘。',
    };
  }

  if (!applied.changed) {
    // 零改动：不写盘（不触碰 mtime，不制造 diff）
    return {
      ok: true,
      apply: true,
      filePath: file.rel,
      beforeSha256: read.sha256,
      afterSha256: read.sha256,
      changed: false,
      semanticDiff: summary,
      description: '本批操作未产生任何字节变化，文件未被写入（零操作零 diff）。',
    };
  }

  const snapshotPath = writeRevisionSnapshot(project.workspaceRoot, file.rel, read.text, read.sha256);
  fs.writeFileSync(file.abs, applied.text, 'utf8');

  const diffLines = summary.map((s) => `  ${s.op} ${s.target}${s.detail ? ` → ${s.detail}` : ''}`).join('\n');
  return {
    ok: true,
    apply: true,
    filePath: file.rel,
    beforeSha256: read.sha256,
    afterSha256: applied.afterSha,
    changed: true,
    semanticDiff: summary,
    snapshotPath,
    description: [
      `已写盘 ${file.rel}（${summary.length} 个操作，before ${read.sha256.slice(0, 8)} → after ${applied.afterSha.slice(0, 8)}）`,
      diffLines,
      `旧版本审计快照：${snapshotPath}`,
    ].filter(Boolean).join('\n'),
  };
}


/**
 * 切片5 — Inkscape 无头协处理器动作（探针缺席时诚实 `inkscape_unavailable`）。
 * 结构动作（union/difference/intersection/text-to-path）产物经 before-sha 守卫 + 审计快照写回原文件
 * （与 svg_edit 同治理）；export-pdf 产物落同目录 .pdf，不写回 SVG。
 * callback 风格（Inkscape 执行是异步的）：tool_svg_inkscape(args, ctx, onDone)。
 */
function tool_svg_inkscape(args, ctx, onDone) {
  // 能力探针前置：缺席即 503 语义（路由层已做项目鉴权；工具层不因探针触 DB）
  const status = inkscape.inkscapeStatus();
  if (!status.available) {
    onDone({ error: 'inkscape_unavailable', message: status.hint || 'Inkscape 不可用', available: false });
    return null;
  }
  const project = resolveProject(ctx);
  if (!project.ok) { onDone({ error: project.code, message: project.message }); return null; }
  const file = resolveFile(project.workspaceRoot, args && args.filePath);
  if (!file.ok) { onDone({ error: file.code, message: file.message }); return null; }
  const read = readSvgFile(file.abs, file.rel);
  if (!read.ok) { onDone({ error: read.code, message: read.message }); return null; }
  const action = args && args.action;

  const tmpAbs = action === 'export-pdf'
    ? `${file.abs}.pdf`
    : path.join(path.dirname(file.abs), `.${path.basename(file.rel)}.inktmp.svg`);
  return inkscape.runInkscapeAction({ action, svgAbs: file.abs, outAbs: tmpAbs }, (runErr, runOk) => {
    if (runErr) {
      onDone({ error: runErr.code || 'inkscape_run_failed', message: runErr.message, hint: runErr.hint });
      return;
    }
    if (action === 'export-pdf') {
      onDone({
        ok: true,
        action,
        filePath: file.rel,
        outPath: `${file.rel}.pdf`,
        description: `已导出 PDF：${file.rel}.pdf（未改动 SVG 文件）`,
      });
      return;
    }
    let outText;
    try {
      outText = fs.readFileSync(tmpAbs, 'utf8');
    } catch (readErr) {
      onDone({ error: 'inkscape_no_output', message: `结果文件不可读：${readErr.message}` });
      return;
    } finally {
      try { fs.unlinkSync(tmpAbs); } catch { /* 临时文件清理失败不阻塞 */ }
    }
    if (outText === read.text) {
      onDone({ ok: true, action, filePath: file.rel, changed: false, description: '协处理器输出与原文一致（零改动，未写盘）。' });
      return;
    }
    // before-sha 守卫：执行期间文件被人改动 → 拒绝覆盖（协处理器不绕过治理）
    const current = readSvgFile(file.abs, file.rel);
    if (!current.ok) { onDone({ error: current.code, message: current.message }); return; }
    const expectedSha = args && args.beforeSha256;
    if (typeof expectedSha === 'string' && expectedSha !== '' && current.sha256 !== expectedSha) {
      onDone({ error: 'svg_hash_mismatch', message: '文件在执行期间被外部改动，已阻止协处理器覆盖（人的修改优先）' });
      return;
    }
    const snapshotPath = writeRevisionSnapshot(project.workspaceRoot, file.rel, current.text, current.sha256);
    fs.writeFileSync(file.abs, outText, 'utf8');
    onDone({
      ok: true,
      action,
      filePath: file.rel,
      changed: true,
      beforeSha256: current.sha256,
      snapshotPath,
      description: `Inkscape ${action} 已写盘 ${file.rel}（旧版本审计快照：${snapshotPath}）`,
    });
  });
}

module.exports = {
  tool_svg_inspect,
  tool_svg_inkscape,
  tool_svg_revisions,
  tool_svg_revision,
  tool_svg_edit,
  MAX_SVG_BYTES,
  SNAPSHOT_REL_DIR,
};
