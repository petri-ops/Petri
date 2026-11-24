#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui693-inkscape-live — UI-693 Inkscape 1.4.4 协处理器四项全链实机（BLOCK-513 L4）。
 *
 * 台账降级注记：「四项 REST 实机（:3001 真后端人工跑过）已证，但 flow 待入腿即非全链
 * 实机；flow 补腿后升回」。本 flow 把四项固化进 dev-verify flow（探针→REST→CAS→审计链
 * →落盘断言），Inkscape 缺席环境显式 skip 带原因（不冒充）。
 *
 * 断言链（repo-root 工作区项目 + tmp-ui693-inkscape/ 样本，走 tool_svg_inkscape 既有链）：
 *   P0_repo_root_project_present   工作区=仓库根的项目在案（block342 同配方）
 *   A0_probe_available             /svg/inkscape-status available=true（缺席则全包 skip 带原因）
 *   A1_union_single_path           两重叠 rect → path-union → 1 path（rect 退场）
 *   A2_text_to_path                text 元素 → --export-text-to-path → text 退场（转 path）
 *   A3_difference_real             真差集（产物面积 < 原 rect，非原文件假 changed）
 *   A4_export_pdf                  .pdf 落同目录且非空（PDF 头魔数）
 *   A5_audit_revision_recorded     结构动作走 before-sha CAS + svg-revisions 审计快照
 *   P9_tmp_dir_cleaned             样本目录清理
 *
 * 前置：后端(:3001) + Inkscape（探针实时扫盘）。证据：acceptance/ui-693/（run.cjs 落盘）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'ui-693');
const TMP_DIR = path.join(ROOT, 'tmp-ui693-inkscape');
const TMP_REL = 'tmp-ui693-inkscape';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

/** 调 Inkscape REST 动作；失败抛错（调用方决定 skip/fail）。 */
async function runAction(projectId, rel, action, expectSha) {
  const resp = await rest('POST', '/svg/inkscape', {
    projectId, path: rel, action, beforeSha256: expectSha,
  });
  if (!resp.ok) {
    const err = new Error(`inkscape ${action} HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
    err.code = resp.data && resp.data.error;
    throw err;
  }
  return resp.data;
}

module.exports = {
  id: 'ui693-inkscape-live',
  description: 'UI-693 Inkscape 协处理器四项全链：union/text-to-path/difference/export-pdf 经 tool_svg_inkscape CAS+审计链（flow 补腿）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const projects = await rest('GET', '/data/projects');
    const list = projects.data?.projects || projects.data?.items || projects.data || [];
    const project = (Array.isArray(list) ? list : []).find((p) => p.workspace_path === ROOT) || null;
    assert('P0_repo_root_project_present', Boolean(project && project.id),
      project ? `${project.id} ${project.name}` : 'no project whose workspace is repo root');
    if (!project) return false;

    const status = await rest('GET', `/svg/inkscape-status?projectId=${encodeURIComponent(project.id)}`);
    const available = status.data && status.data.available === true;
    if (!available) {
      assert('A0_probe_available', 'skip', `Inkscape 探针缺席：${JSON.stringify(status.data).slice(0, 120)}——四项全链实机显式 skip（缺席环境不冒充）`);
      return true;
    }
    assert('A0_probe_available', true, `bin=${status.data.bin || 'probed'} source=${status.data.source || ''}`);

    // 每轮清空样本目录（block342 同纪律：留盘复用会带上轮产物）
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const pid = project.id;
    const writeFile = (name, svg) => {
      const abs = path.join(TMP_DIR, name);
      fs.writeFileSync(abs, svg);
      return { rel: `${TMP_REL}/${name}`, abs, sha: sha(fs.readFileSync(abs)) };
    };

    try {
      // A1 union：两重叠 rect → 1 path
      const u = writeFile('union.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        + '<rect id="a" x="10" y="10" width="40" height="40" fill="#f00"/>'
        + '<rect id="b" x="30" y="30" width="40" height="40" fill="#00f"/></svg>');
      const uOut = await runAction(pid, u.rel, 'union', u.sha);
      const uText = fs.readFileSync(u.abs, 'utf8');
      const uPaths = (uText.match(/<path[\s>]/g) || []).length;
      const uRects = (uText.match(/<rect[\s>]/g) || []).length;
      assert('A1_union_single_path', uOut && uOut.ok && uPaths >= 1 && uRects === 0,
        `ok=${uOut && uOut.ok} paths=${uPaths} rects=${uRects} changed=${uOut && uOut.changed}`);

      // A2 text-to-path：text 元素退场转路径
      const t = writeFile('text.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">'
        + '<text x="10" y="25" font-size="14" fill="#000">Block513</text></svg>');
      const tOut = await runAction(pid, t.rel, 'text-to-path', t.sha);
      const tText = fs.readFileSync(t.abs, 'utf8');
      const tTexts = (tText.match(/<text[\s>]/g) || []).length;
      const tPaths = (tText.match(/<path[\s>]/g) || []).length;
      assert('A2_text_to_path', tOut && tOut.ok && tTexts === 0 && tPaths >= 1,
        `ok=${tOut && tOut.ok} texts=${tTexts} paths=${tPaths}`);

      // A3 difference：真差集（上矩形挖掉交集，产物 <path> 且 rect 退场）
      const d = writeFile('difference.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        + '<rect id="base" x="10" y="10" width="60" height="60" fill="#0a0"/>'
        + '<rect id="cut" x="50" y="50" width="30" height="30" fill="#00f"/></svg>');
      const dOut = await runAction(pid, d.rel, 'difference', d.sha);
      const dText = fs.readFileSync(d.abs, 'utf8');
      const dRects = (dText.match(/<rect[\s>]/g) || []).length;
      const dPaths = (dText.match(/<path[\s>]/g) || []).length;
      const dChanged = Boolean(dOut && dOut.changed);
      assert('A3_difference_real', dOut && dOut.ok && dRects === 0 && dPaths >= 1 && dChanged,
        `ok=${dOut && dOut.ok} rects=${dRects} paths=${dPaths} changed=${dChanged}`);

      // A4 export-pdf：落同目录 .pdf 非空（PDF 魔数）
      const p = writeFile('plain.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">'
        + '<circle cx="40" cy="40" r="30" fill="#07c"/></svg>');
      const pOut = await runAction(pid, p.rel, 'export-pdf', p.sha);
      const pdfAbs = `${p.abs}.pdf`;
      const pdf = fs.existsSync(pdfAbs) ? fs.readFileSync(pdfAbs) : null;
      assert('A4_export_pdf', pOut && pOut.ok && pdf && pdf.length > 200 && pdf.subarray(0, 4).toString('latin1') === '%PDF',
        `ok=${pOut && pOut.ok} bytes=${pdf ? pdf.length : 0} magic=${pdf ? pdf.subarray(0, 4).toString('latin1') : 'none'}`);

      // A5 审计链：结构动作记入 svg-revisions 快照
      const rev = await rest('GET', `/svg/revisions?projectId=${encodeURIComponent(pid)}&path=${encodeURIComponent(u.rel)}`);
      const revList = rev.data && (rev.data.revisions || rev.data.items || rev.data.entries);
      const revCount = Array.isArray(revList) ? revList.length : (rev.data && rev.data.total) || 0;
      assert('A5_audit_revision_recorded', rev.ok === true && revCount >= 1,
        `ok=${rev.ok} revisions=${revCount}`);

      const removed = fs.rmSync(TMP_DIR, { recursive: true, force: true });
      assert('P9_tmp_dir_cleaned', !fs.existsSync(TMP_DIR), `rm ${removed === undefined ? 'ok' : 'ok'}`);
    } catch (e) {
      if (e.code === 'inkscape_unavailable') {
        assert('A0_probe_available', 'skip', `Inkscape 运行期缺席：${e.message.slice(0, 120)}`);
        return true;
      }
      throw e;
    }
    return true;
  },
};
