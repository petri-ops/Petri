# UI Translation — 从艺术原则到可检界面规则

Every aesthetic idea must land as a token, component, layout, motion, or copy decision with a checkable criterion. If it cannot be checked, it is not a design decision — it is a mood.

## Translation table

| Art principle | UI decision | Checkable criterion |
|---|---|---|
| Structure honesty (architecture) | Surface ladder = real containment; card never darker than page | navy ladder ascending; no "hole in page" on screenshot |
| Frame first (architecture) | Region px budgets, frame before content | region boundaries named; no overflow at narrow viewport |
| Light as material (architecture) | Light = paper daylight; dark = ink with accent glow, not inversion | theme pairs measured; accent not full-saturation fill |
| Negative space / 留白 | occupancy budget, spacing before dividers | content ≤40% on identity surfaces; space above heading > below |
| Shot hierarchy (film) | one hero, one accent point, one focal number | ≤1 primary action; ≤8 accent refs per view |
| Color script (film) | palette family used by semantic context, not arbitrary themes | one skeleton + one accent role per scene; theme switch = same product |
| Focus/continuity (film) | focus ring, selected state, origin return, Escape | focus-visible coverage; focus returns; overlay portal escapes clipping |
| Shot timing (film/music) | duration tokens, one authored motion | only token durations; single motion moment; reduced-motion honored |
| 骨法用笔 (painting) | icons: front-on, 1.5px, flat caps, geometric arcs | one stroke family; no perspective icons; no emoji as icons |
| 随类赋彩 (painting) | color encodes semantic class only | accent only for action/selection/link/focus/status |
| 气韵生动 (painting) | states complete, feedback immediate | eight-state matrix no empty cells; loading/empty/error truthful |
| 传移模写 (painting) | single-source components | one control library; new button class is a red gate |
| 宾主分明 | one primary + one accent + supporting | primary action count = 1; accent point count = 1 |
| Gestalt grouping | spacing/similarity group before borders | grouping via gap; borders only for input/card/divider semantics |
| Harmony (Itten) | accent area budget and contrast floors | accent area <5%; text ≥4.5:1, large ≥3:1, controls ≥3:1 |

## Verification protocol

1. **Static** — tokens only; no raw hex; contrast pairs measured; counts (accent refs, z-levels, font sizes).
2. **Mechanical** — extend existing contract tests with negative tests; ratchets only tighten.
3. **Rendered** — element-level screenshots at shipping size; per-criterion pass/fail; long-content three states; narrow viewport.
4. **Human-eye** — a named preference standard (user's own words where available); ≤3 review→optimize→verify rounds; presentation-only changes; do not claim `verified` from static evidence.

## Do not conflate

- A passing token contract ≠ visual quality.
- A screenshot of one state ≠ all states.
- "It looks clean" ≠ readable, accessible, or complete.
- Art knowledge ≠ permission to add decoration.
