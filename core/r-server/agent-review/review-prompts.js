'use strict';

/**
 * agent-review/review-prompts.js — BLOCK-25 review prompt construction.
 *
 * Adapted from openai/codex (codex-rs/prompts/templates/review/rubric.md and
 * codex-rs/prompts/src/review_request.rs). The rubric keeps Codex's review
 * judgement rules and JSON contract; the delivery around it is adapted to the
 * BioF3 review sub-agent (read-only tool boundary, workspace-relative paths,
 * zh UI hint text lives in the renderer, not here).
 */

const REVIEW_TARGET_TYPES = Object.freeze([
  'uncommitted_changes',
  'base_branch',
  'commit',
  'custom',
]);

const UNCOMMITTED_PROMPT =
  'Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.';

const BASE_BRANCH_PROMPT =
  "Review the code changes against the base branch '{{baseBranch}}'. " +
  'The merge base commit for this comparison is {{mergeBaseSha}}. ' +
  'Run `git diff {{mergeBaseSha}}` to inspect the changes relative to {{baseBranch}}. ' +
  'Provide prioritized, actionable findings.';

const BASE_BRANCH_PROMPT_BACKUP =
  "Review the code changes against the base branch '{{baseBranch}}'. " +
  'Start by finding the merge diff between the current branch and the upstream of ' +
  '{{baseBranch}}, then diff against that SHA to see what changes would merge into it. ' +
  'Provide prioritized, actionable findings.';

const COMMIT_PROMPT_WITH_TITLE =
  'Review the code changes introduced by commit {{sha}} ("{{title}}"). ' +
  'Provide prioritized, actionable findings.';

const COMMIT_PROMPT =
  'Review the code changes introduced by commit {{sha}}. Provide prioritized, actionable findings.';

const REVIEW_RUBRIC = `# Review guidelines

You are acting as a reviewer for a proposed code change made by another engineer.

You operate in a strictly READ-ONLY boundary: you may inspect the repository with the
provided read-only tools (git inspection and file reading). You must never attempt to
modify files, create files, run builds/tests that write, or perform any state-changing
action. If a check you need would require writing, report that limitation in the finding
body instead of working around it.

Below are the default guidelines for determining whether the original author would
appreciate the issue being flagged. More specific guidelines found in developer messages,
user messages, project instruction files (e.g. AGENTS.md), or elsewhere override these
general instructions.

Here are the general guidelines for determining whether something is a bug and should be flagged:

1. It meaningfully impacts the accuracy, performance, security, or maintainability of the code.
2. The bug is discrete and actionable (i.e. not a general issue with the codebase or a combination of multiple issues).
3. Fixing the bug does not demand a level of rigor that is not present in the rest of the codebase.
4. The bug was introduced in the reviewed change (pre-existing bugs should not be flagged).
5. The author would likely fix the issue if they were made aware of it.
6. The bug does not rely on unstated assumptions about the codebase or author's intent.
7. It is not enough to speculate that a change may disrupt another part of the codebase; you must identify the other parts of the code that are provably affected.
8. The bug is clearly not just an intentional change by the original author.

When flagging a bug, also provide an accompanying comment:

1. The comment should be clear about why the issue is a bug.
2. The comment should appropriately communicate the severity. It should not claim an issue is more severe than it actually is.
3. The comment should be brief: at most one paragraph, no unnecessary line breaks.
4. The comment should not include chunks of code longer than 3 lines; wrap code in inline code tags or a code block.
5. The comment should clearly state the scenarios, environments, or inputs required for the bug to arise.
6. The tone should be matter-of-fact and not accusatory or overly positive.
7. The comment should be understandable without close reading.
8. Avoid flattery and unhelpful phrasing ("Great job ...", "Thanks for ...").

HOW MANY FINDINGS TO RETURN:

Output all findings that the original author would fix if they knew about them. If no
finding qualifies, prefer outputting zero findings. Do not stop at the first qualifying
finding; list every qualifying finding.

ADDITIONAL GUIDELINES:

- Ignore trivial style unless it obscures meaning or violates documented standards.
- Use one finding per distinct issue (or the smallest multi-line range necessary).
- Respect repository instruction files that apply to the changed files (for example
  AGENTS.md / AGENTS.override.md); more-specific guidance wins on conflict. A finding is
  rule-supported only when applicable guidance materially contributes scope, an
  invariant, a remedy, or a convention beyond generic correctness advice. Do not omit
  ordinary findings or invent findings solely because a rule file exists.
- Review the diff independently and deduplicate findings by changed location and
  defect/remedy.
- The findings will be presented as inline comments next to the diff. Keep line ranges as
  short as possible for interpreting the issue (avoid ranges over 5-10 lines).
- At the beginning of each finding title, tag the priority: "[P0] ..." through "[P3] ...".
  [P0] drop-everything, blocking; [P1] urgent, next cycle; [P2] normal, eventually;
  [P3] low, nice to have.
- Also set the numeric "priority" field for each finding: 0 for P0, 1 for P1, 2 for P2,
  3 for P3. Omit or use null when it cannot be determined.
- At the end, output an overall correctness verdict for the whole patch: "patch is
  correct" or "patch is incorrect". Correct means existing code and tests will not break
  and the patch is free of blocking issues. Ignore non-blocking issues (style, typos,
  docs, nits).

OUTPUT FORMAT — MUST MATCH EXACTLY:

{
  "findings": [
    {
      "title": "<= 80 chars, imperative",
      "body": "valid Markdown explaining why this is a problem; cite files/lines/functions",
      "confidence_score": <float 0.0-1.0>,
      "priority": <int 0-3, optional>,
      "code_location": {
        "absolute_file_path": "<file path>",
        "line_range": {"start": <int>, "end": <int>}
      }
    }
  ],
  "overall_correctness": "patch is correct" | "patch is incorrect",
  "overall_explanation": "<1-3 sentence explanation justifying the verdict>",
  "overall_confidence_score": <float 0.0-1.0>
}

- Do not wrap the JSON in markdown fences or extra prose. Your final message must be
  exactly one JSON object and nothing else.
- code_location is required for every finding and must overlap with the diff.
- Do not generate a fix patch; report findings only.`;

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

/**
 * Validate and normalize a review target from the route layer.
 * Returns { ok: true, target } or { ok: false, error }.
 */
function normalizeReviewTarget(input) {
  const type = input && typeof input === 'object' ? input.type : null;
  if (!REVIEW_TARGET_TYPES.includes(type)) {
    return { ok: false, error: `review target type 必须是 ${REVIEW_TARGET_TYPES.join(' | ')}` };
  }
  if (type === 'base_branch') {
    const branch = typeof input.branch === 'string' ? input.branch.trim() : '';
    if (!branch || branch.length > 200 || /[\s`$;&|<>]/.test(branch)) {
      return { ok: false, error: 'base_branch.target.branch 非法' };
    }
    return { ok: true, target: { type, branch } };
  }
  if (type === 'commit') {
    const sha = typeof input.sha === 'string' ? input.sha.trim() : '';
    if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
      return { ok: false, error: 'commit.target.sha 必须是 7-40 位十六进制' };
    }
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : '';
    return { ok: true, target: { type, sha: sha.toLowerCase(), title: title || null } };
  }
  if (type === 'custom') {
    const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : '';
    if (!instructions || instructions.length > 8000) {
      return { ok: false, error: 'custom.target.instructions 必须是 1-8000 字符' };
    }
    return { ok: true, target: { type, instructions } };
  }
  return { ok: true, target: { type: 'uncommitted_changes' } };
}

/**
 * Build the reviewer user prompt for a resolved target.
 * `gitMergeBaseSha` is precomputed by the runner for base_branch targets
 * (mirrors Codex resolving merge-base before prompting).
 */
function buildReviewPrompt(target, { mergeBaseSha = null } = {}) {
  switch (target.type) {
    case 'uncommitted_changes':
      return UNCOMMITTED_PROMPT;
    case 'base_branch':
      return mergeBaseSha
        ? renderTemplate(BASE_BRANCH_PROMPT, { baseBranch: target.branch, mergeBaseSha })
        : renderTemplate(BASE_BRANCH_PROMPT_BACKUP, { baseBranch: target.branch });
    case 'commit':
      return target.title
        ? renderTemplate(COMMIT_PROMPT_WITH_TITLE, { sha: target.sha, title: target.title })
        : renderTemplate(COMMIT_PROMPT, { sha: target.sha });
    case 'custom':
      return target.instructions;
    default:
      throw new Error(`unknown review target type: ${target && target.type}`);
  }
}

function userFacingHint(target) {
  switch (target.type) {
    case 'uncommitted_changes':
      return '当前未提交变更';
    case 'base_branch':
      return `相对分支 '${target.branch}' 的变更`;
    case 'commit': {
      const shortSha = String(target.sha).slice(0, 7);
      return target.title ? `提交 ${shortSha}: ${target.title}` : `提交 ${shortSha}`;
    }
    case 'custom':
      return String(target.instructions).slice(0, 60);
    default:
      return '代码审阅';
  }
}

module.exports = {
  REVIEW_RUBRIC,
  REVIEW_TARGET_TYPES,
  buildReviewPrompt,
  normalizeReviewTarget,
  userFacingHint,
};
