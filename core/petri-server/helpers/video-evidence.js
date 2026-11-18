'use strict';

/*
 * BLOCK-483 注记：本文件的动态属性访问经 ownGet（own-enumerable 查找）收敛，
 * 全部作用于内部确定性数据结构（rows[i].sources[j]、checks[i]），无外部可控键注入面，
 * 故无需 security/detect-object-injection 豁免（同 BLOCK-456 ownGet 先例）。
 */

/**
 * helpers/video-evidence.js — BLOCK-483 / C-55 VIDEO-P1 科学证据与质量闭环。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P1。
 * 把「能查资料」升级为「每个关键说法都能解释从哪来」：纯函数、零新依赖，
 * 消费 VideoProjectSpec（BLOCK-482 产物）+ AV 探针结构化读数，产出：
 *   - classifySource           来源分级（五档 + DOI 启发式）
 *   - buildClaimEvidenceTable  Claim–Evidence 表（逐论断定位来源原文）
 *   - checkNumericClaims       数字/单位/数量级换算确定性检查
 *   - detectConflicts          冲突来源并列展示，不静默择一
 *   - markLowConfidence        低置信/无来源论断显著标记
 *   - checkScienceAlignment    画面/讲稿与论断的科学语义对照
 *   - auditAV                  成片 AV 质检（黑帧/静音/响度/音画时长/字幕溢出/编码错误）
 *   - buildEvidenceReport      六组汇总 + humanReview 留白
 *
 * 红线：观感/科学专业性终审为 pending_human_eye，Agent 不代签；零新增运行时依赖；
 * 不修改 VideoProjectSpec 主链、不新造 Job/Artifact、不外推 G1+。
 */

const SCHEMA_VERSION = 1;
const SOURCE_KINDS = Object.freeze(['official_doc', 'paper', 'authority', 'web', 'user_material']);
const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);
const AV_CHECK_NAMES = Object.freeze([
  'black_frame', 'silence', 'loudness', 'av_duration_skew', 'subtitle_overflow', 'codec_error',
]);
const EVIDENCE_SECTIONS = Object.freeze([
  'claimEvidence', 'numeric', 'conflicts', 'lowConfidence', 'alignment', 'av',
]);

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const asArray = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v == null ? '' : String(v));

const UNIT_SCALE = Object.freeze({
  nm: 1e-9, um: 1e-6, 'μm': 1e-6, mm: 1e-3, cm: 1e-2, m: 1, km: 1e3,
  mg: 1e-6, g: 1e-3, kg: 1, s: 1, ms: 1e-3,
});
const CONVERSION_RE = /([0-9]+(?:\.[0-9]+)?)\s*(nm|μm|um|mm|cm|km|mg|kg|ms|m|g|s)\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*(nm|μm|um|mm|cm|km|mg|kg|ms|m|g|s)/g;
const DOI_RE = /(?:doi\.org\/|doi\s*:\s*|10\.\d{4,}\/)/i;
const AUTHORITY_RE = /(?:\.gov(?:\.cn)?\/|\.org\.cn\/|nih\.gov|who\.int|nasa\.gov|gov\.cn)/i;
const OFFICIAL_RE = /(?:官方|official|specification|rfc|标准文档)/i;
const NM_VALUE_RE = /([0-9]+(?:\.[0-9]+)?)\s*nm/i;
const ANY_NUMBER_RE = /([0-9]+(?:\.[0-9]+)?)/;
const OK_AV_CODECS = Object.freeze(['h264', 'h265', 'hevc', 'vp9', 'av1']);

/**
 * 来源分级：五档 + 启发式推断。已知 kind 原样归一；未知但能从 URL 判定者标注 inferred；
 * 其余归 web（不丢来源）。
 */
function classifySource(source = {}) {
  const declared = str(ownGet(source, 'kind') || '').trim().toLowerCase();
  if (SOURCE_KINDS.includes(declared)) return { ok: true, kind: declared, inferred: false };
  const url = str(ownGet(source, 'urlOrPath') || '');
  const title = str(ownGet(source, 'title') || '');
  if (DOI_RE.test(url) || DOI_RE.test(title)) return { ok: true, kind: 'paper', inferred: true };
  if (AUTHORITY_RE.test(url)) return { ok: true, kind: 'authority', inferred: true };
  if (OFFICIAL_RE.test(title)) return { ok: true, kind: 'official_doc', inferred: true };
  return { ok: true, kind: 'web', inferred: true };
}

/** Claim–Evidence 表：逐论断定位来源原文 + 访问/发布/引用片段，缺项显著标记。 */
function buildClaimEvidenceTable(spec = {}) {
  const sources = asArray(ownGet(spec, 'sources'));
  const sourceById = new Map(sources.map((s) => [str(ownGet(s, 'id')), s]));
  const claims = asArray(ownGet(spec, 'claims'));
  const rows = claims.map((claim) => {
    const ids = asArray(ownGet(claim, 'sourceIds'));
    const flags = [];
    if (ids.length === 0) flags.push('no_source');
    const linked = ids.map((sid) => {
      const src = sourceById.get(str(sid));
      if (!src) {
        flags.push('unknown_source');
        return { id: str(sid), traceStatus: 'unknown_source', excerptRef: '', accessedAt: '', publishedAt: '', urlOrDoi: '' };
      }
      const excerptRef = str(ownGet(src, 'excerptRef'));
      const accessedAt = str(ownGet(src, 'accessedAt'));
      const urlOrDoi = str(ownGet(src, 'urlOrPath'));
      const classified = classifySource(src);
      if (!excerptRef) flags.push('missing_excerpt');
      if (!accessedAt) flags.push('missing_accessedAt');
      if (!urlOrDoi) flags.push('missing_url');
      const traceStatus = excerptRef && accessedAt && urlOrDoi ? 'traced' : 'incomplete';
      return {
        id: str(sid), kind: classified.kind, kindInferred: classified.inferred,
        title: str(ownGet(src, 'title')), urlOrDoi, accessedAt,
        publishedAt: str(ownGet(src, 'publishedAt')), excerptRef,
        license: str(ownGet(src, 'license')) || 'license_unknown', traceStatus,
      };
    });
    const traced = ids.length > 0 && linked.length === ids.length
      && linked.every((s) => s.traceStatus === 'traced');
    return {
      claimId: str(ownGet(claim, 'id')), text: str(ownGet(claim, 'text')),
      confidence: str(ownGet(claim, 'confidence')) || 'medium',
      sources: linked, traced, flags: [...new Set(flags)],
    };
  });
  const traced = rows.filter((r) => r.traced).length;
  return {
    ok: true,
    rows,
    stats: {
      claims: rows.length,
      traced,
      untraced: rows.length - traced,
      conflicts: detectConflicts(spec).conflicts.length,
      lowConfidence: markLowConfidence(spec).count,
    },
  };
}

/**
 * 数字/单位/数量级确定性检查：对 "a unit = b unit" 换算断言做单位基准比对。
 * 相对误差 > 1e-6 视为换算不一致（fail-closed）。
 */
function checkNumericClaims(claims = []) {
  const issues = [];
  let checked = 0;
  for (const claim of asArray(claims)) {
    const claimId = str(ownGet(claim, 'id'));
    const text = str(ownGet(claim, 'text'));
    for (const match of text.matchAll(CONVERSION_RE)) {
      checked += 1;
      const left = Number(match[1]) * ownGet(UNIT_SCALE, match[2]);
      const right = Number(match[3]) * ownGet(UNIT_SCALE, match[4]);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        issues.push({ claimId, type: 'unknown_unit', detail: `${match[2]} / ${match[4]}` });
        continue;
      }
      const diff = Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1e-12);
      if (diff > 1e-6) {
        issues.push({ claimId, type: 'unit_conversion_mismatch', detail: match[0], left, right, relativeError: diff });
      }
    }
  }
  return { ok: issues.length === 0, checked, issues };
}

/** 从来源引用片段抽取用于比对的数值（优先带 nm 单位，退回首个数字）。 */
function excerptValue(excerptRef) {
  const nm = NM_VALUE_RE.exec(str(excerptRef));
  if (nm) return Number(nm[1]);
  const any = ANY_NUMBER_RE.exec(str(excerptRef));
  return any ? Number(any[1]) : null;
}

/** 冲突来源并列展示：同一论断多源给出分歧数值时保留双方，不静默择一。 */
function detectConflicts(spec = {}) {
  const sources = asArray(ownGet(spec, 'sources'));
  const sourceById = new Map(sources.map((s) => [str(ownGet(s, 'id')), s]));
  const conflicts = [];
  for (const claim of asArray(ownGet(spec, 'claims'))) {
    const values = [];
    for (const sid of asArray(ownGet(claim, 'sourceIds'))) {
      const src = sourceById.get(str(sid));
      if (!src) continue;
      const value = excerptValue(ownGet(src, 'excerptRef'));
      if (value == null || !Number.isFinite(value)) continue;
      values.push({ sourceId: str(sid), value });
    }
    if (new Set(values.map((v) => v.value)).size >= 2) {
      conflicts.push({
        claimId: str(ownGet(claim, 'id')),
        resolution: 'parallel_display',
        values,
        note: '冲突来源并列展示，不静默择一；由用户或授权专业人员裁决',
      });
    }
  }
  return { ok: true, conflicts };
}

/** 低置信/无来源论断显著标记。 */
function markLowConfidence(spec = {}) {
  const flagged = [];
  for (const claim of asArray(ownGet(spec, 'claims'))) {
    const confidence = str(ownGet(claim, 'confidence')) || 'medium';
    if (confidence === 'low') flagged.push({ claimId: str(ownGet(claim, 'id')), reason: 'low_confidence' });
    if (asArray(ownGet(claim, 'sourceIds')).length === 0) {
      flagged.push({ claimId: str(ownGet(claim, 'id')), reason: 'no_source' });
    }
  }
  return { ok: true, flagged, count: flagged.length };
}

/** 画面/讲稿与论断的科学语义对照：evidenceRefs 悬空即红，缺失为可见警告。 */
function checkScienceAlignment(spec = {}) {
  const claims = asArray(ownGet(spec, 'claims'));
  const claimIds = new Set(claims.map((c) => str(ownGet(c, 'id'))));
  const flags = [];
  const rows = [];
  for (const scene of asArray(ownGet(spec, 'scenes'))) {
    const sceneId = str(ownGet(scene, 'id'));
    const refs = asArray(ownGet(scene, 'evidenceRefs'));
    const narration = str(ownGet(scene, 'narration'));
    const visual = ownGet(scene, 'visual') || {};
    const visualText = `${str(ownGet(visual, 'title'))} ${str(ownGet(visual, 'text'))}`.trim();
    if (refs.length === 0) flags.push({ type: 'missing_evidence_ref', sceneId, detail: '镜头未绑定任何论断' });
    for (const ref of refs) {
      if (!claimIds.has(str(ref))) {
        flags.push({ type: 'unknown_evidence_ref', sceneId, detail: str(ref) });
      }
    }
    rows.push({ sceneId, narration, visualText, evidenceRefs: refs });
  }
  const ok = !flags.some((f) => f.type === 'unknown_evidence_ref');
  return { ok, rows, flags };
}

/** 成片 AV 质检：六项机械检查 + humanReview 留白。输入为 ffprobe 结构化读数。 */
function auditAV(probe = {}) {
  const video = ownGet(probe, 'video') || {};
  const audio = ownGet(probe, 'audio') || {};
  const subtitles = ownGet(probe, 'subtitles') || {};
  const vDur = Number(ownGet(video, 'durationSec')) || 0;
  const aPresent = ownGet(audio, 'present') === true;
  const aDur = Number(ownGet(audio, 'durationSec')) || 0;
  const peakDbfs = Number(ownGet(audio, 'peakDbfs'));
  const silentSec = Number(ownGet(audio, 'silentSec')) || 0;
  const checks = [
    {
      name: 'black_frame',
      passed: Number(ownGet(video, 'blackFrames')) === 0,
      detail: `blackFrames=${ownGet(video, 'blackFrames') ?? 'n/a'}`,
    },
    {
      name: 'silence',
      passed: aPresent && silentSec < Math.max(1, vDur * 0.5),
      detail: `present=${aPresent} silentSec=${silentSec}`,
    },
    {
      // 上界 -0.5 dBTP 防 0dB 削波（真实成片峰值 -2.2dB 合法通过）；下界 -30dB 防近静音。
      name: 'loudness',
      passed: Number.isFinite(peakDbfs) && peakDbfs >= -30 && peakDbfs <= -0.5,
      detail: `peakDbfs=${ownGet(audio, 'peakDbfs') ?? 'n/a'}`,
    },
    {
      name: 'av_duration_skew',
      passed: aPresent && Math.abs(vDur - aDur) <= 0.5,
      detail: `video=${vDur} audio=${aDur}`,
    },
    {
      name: 'subtitle_overflow',
      passed: Number(ownGet(subtitles, 'overflowCount')) === 0,
      detail: `overflowCount=${ownGet(subtitles, 'overflowCount') ?? 'n/a'}`,
    },
    {
      name: 'codec_error',
      passed: OK_AV_CODECS.includes(str(ownGet(video, 'codec')).toLowerCase()),
      detail: `codec=${ownGet(video, 'codec') ?? 'n/a'}`,
    },
  ];
  const ok = checks.every((c) => c.passed);
  return {
    ok, status: ok ? 'machine_pass' : 'machine_fail', checks,
    humanReview: { status: 'pending_human_eye', note: '成片观感/科学专业性终审由用户签字，Agent 不代签' },
  };
}

/** 六组汇总，供 evidence-report.json 落盘；观感留白。 */
function buildEvidenceReport(spec = {}, probe = {}) {
  const claimEvidence = buildClaimEvidenceTable(spec);
  const numeric = checkNumericClaims(asArray(ownGet(spec, 'claims')));
  const conflicts = detectConflicts(spec);
  const lowConfidence = markLowConfidence(spec);
  const alignment = checkScienceAlignment(spec);
  const av = auditAV(probe);
  const sections = { claimEvidence, numeric, conflicts, lowConfidence, alignment, av };
  const ok = claimEvidence.ok && numeric.ok && conflicts.ok && lowConfidence.ok && alignment.ok && av.ok;
  return {
    ok,
    schemaVersion: SCHEMA_VERSION,
    status: ok ? 'machine_pass' : 'machine_fail',
    sections,
    humanReview: { status: 'pending_human_eye', note: '观感与科学专业性终审由用户签字，Agent 不代签' },
  };
}

/** 完整性 fail-closed：篡改 status / 检查项 / 观测矛盾即红。 */
function validateEvidenceIntegrity(report = {}) {
  const issues = [];
  const sections = ownGet(report, 'sections');
  if (!sections || !EVIDENCE_SECTIONS.every((key) => ownGet(sections, key))) {
    issues.push('六组读数结构不完整');
  }
  const humanReview = ownGet(report, 'humanReview') || {};
  if (ownGet(humanReview, 'status') !== 'pending_human_eye') issues.push('humanReview 观感状态被改写（零代签红线）');
  const av = ownGet(sections, 'av') || {};
  const avChecks = asArray(ownGet(av, 'checks'));
  const avNames = new Set(avChecks.map((c) => str(ownGet(c, 'name'))));
  for (const name of AV_CHECK_NAMES) if (!avNames.has(name)) issues.push(`AV 检查缺项: ${name}`);
  for (const check of avChecks) {
    if (!AV_CHECK_NAMES.includes(str(ownGet(check, 'name')))) issues.push(`AV 检查项被注入: ${str(ownGet(check, 'name'))}`);
    if (ownGet(check, 'passed') === true && /\bFAIL\b/i.test(str(ownGet(check, 'detail')))) {
      issues.push(`AV 检查 passed 与 detail 自相矛盾: ${str(ownGet(check, 'name'))}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

module.exports = {
  SCHEMA_VERSION,
  SOURCE_KINDS,
  CONFIDENCE_LEVELS,
  AV_CHECK_NAMES,
  EVIDENCE_SECTIONS,
  classifySource,
  buildClaimEvidenceTable,
  checkNumericClaims,
  detectConflicts,
  markLowConfidence,
  checkScienceAlignment,
  auditAV,
  buildEvidenceReport,
  validateEvidenceIntegrity,
};
