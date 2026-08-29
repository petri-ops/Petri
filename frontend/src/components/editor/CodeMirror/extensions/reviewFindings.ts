/**
 * BLOCK-26 P1 — review findings as inline diff annotations.
 *
 * Renders AI review findings directly on the readonly diff: a severity
 * gutter marker at the finding's line plus a block card below it (priority
 * badge + title + collapsible body). Presentation-only — safe for the
 * readonly review surface. The panel list and these annotations are two
 * views of the same data; `expanded` marks the finding the panel currently
 * highlights (two-way).
 */

import { Decoration, EditorView, GutterMarker, WidgetType, gutter, type DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';

export interface ReviewLineFinding {
  /** 1-based line in the modified (B-side) document. */
  line: number;
  priority: number | null;
  title: string;
  body: string;
  /** Panel-driven highlight (two-way). */
  expanded?: boolean;
}

export const setReviewFindings = StateEffect.define<ReviewLineFinding[]>();

const reviewFindingsField = StateField.define<ReviewLineFinding[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReviewFindings)) return effect.value;
    }
    return value;
  },
});

function priorityLabel(priority: number | null): string {
  return priority === null || priority < 0 || priority > 3 ? 'P?' : `P${priority}`;
}

class ReviewGutterBadge extends GutterMarker {
  constructor(private readonly priority: number | null) {
    super();
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-review-gutter-badge cm-review-gutter-p${this.priority ?? 'unknown'}`;
    el.textContent = priorityLabel(this.priority);
    el.setAttribute('aria-label', `review finding ${priorityLabel(this.priority)}`);
    return el;
  }
}

class FindingCardWidget extends WidgetType {
  constructor(readonly finding: ReviewLineFinding) {
    super();
  }
  eq(other: FindingCardWidget): boolean {
    return other.finding.line === this.finding.line
      && other.finding.title === this.finding.title
      && other.finding.body === this.finding.body
      && other.finding.expanded === this.finding.expanded;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-review-card' + (this.finding.expanded ? ' cm-review-card-active' : '');
    wrap.setAttribute('role', 'note');
    const head = document.createElement('div');
    head.className = 'cm-review-card-head';
    const badge = document.createElement('span');
    badge.className = `cm-review-card-priority cm-review-card-priority-${this.finding.priority ?? 'unknown'}`;
    badge.textContent = priorityLabel(this.finding.priority);
    const title = document.createElement('span');
    title.className = 'cm-review-card-title';
    title.textContent = this.finding.title;
    head.append(badge, title);
    const body = document.createElement('div');
    body.className = 'cm-review-card-body';
    body.textContent = this.finding.body;
    body.style.display = this.finding.expanded ? 'block' : 'none';
    head.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });
    wrap.append(head, body);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function clampLineNumber(docLines: number, line: number): number {
  return Math.min(Math.max(1, Math.round(line) || 1), docLines);
}

const reviewDecorations = EditorView.decorations.compute([reviewFindingsField], (state): DecorationSet => {
  const findings = state.field(reviewFindingsField);
  if (!findings.length) return Decoration.none;
  // One card per line: multiple findings on the same line collapse into the
  // most severe one (the panel list still shows every finding).
  const byLine = new Map<number, ReviewLineFinding>();
  for (const finding of findings) {
    const existing = byLine.get(finding.line);
    if (!existing || (finding.priority ?? 9) < (existing.priority ?? 9)) byLine.set(finding.line, finding);
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const finding of [...byLine.values()].sort((a, b) => a.line - b.line)) {
    const line = state.doc.line(clampLineNumber(state.doc.lines, finding.line));
    builder.add(line.to, line.to, Decoration.widget({
      widget: new FindingCardWidget(finding),
      side: 1,
      block: true,
    }));
  }
  return builder.finish();
});

const findingsGutter = gutter({
  class: 'cm-review-findings-gutter',
  lineMarker(view, line) {
    const lineNumber = view.state.doc.lineAt(line.from).number;
    const findings = view.state.field(reviewFindingsField, false) || [];
    const hit = findings.find((f) => f.line === lineNumber);
    return hit ? new ReviewGutterBadge(hit.priority) : null;
  },
});

export function createReviewFindingsExtension(): Extension {
  return [reviewFindingsField, reviewDecorations, findingsGutter];
}

export function reviewFindingsEffect(findings: ReviewLineFinding[]): StateEffect<ReviewLineFinding[]> {
  return setReviewFindings.of(findings);
}

export const __testing = { FindingCardWidget, ReviewGutterBadge, priorityLabel };
