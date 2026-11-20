# Color Harmony — 调和色的专业方法

Color harmony is a **relationship structure**, not a set of pretty hex values. Define roles and ratios before hues.

## 1. The five harmony schemes (color wheel)

| Scheme | Relation | Character | UI use |
|---|---|---|---|
| Monochromatic | one hue, varied lightness/saturation | disciplined, calm | safe base for dense tools; risk = flat |
| Analogous | 2–3 adjacent hues | coherent, quiet, "Eastern celadon" | product accent families, calm work surfaces |
| Complementary | opposite hues | high energy, tension | reserve for one focal accent + neutral ground |
| Split-complementary | base + two neighbors of its complement | lively but less harsh | warm accent on cool skeleton (e.g. brass on navy) |
| Triadic | three evenly spaced hues | vivid, playful | rare in professional tools; use only with large neutral majority |

Plus **neutral-dominant** schemes: skeleton neutrals carry >90% of area; one accent hue carries the rest. This is the professional-tool default.

## 2. Itten's seven contrasts (Bauhaus) — the deeper vocabulary

Beyond wheel schemes, every color pair can be analyzed by seven independent contrasts: hue, lightness, saturation, temperature, complementary, simultaneous, extension (quantity). Harmony is often about **extension** (how much area each color gets) rather than hue choice. A "loud" hue becomes elegant at 3% area; a "quiet" hue becomes oppressive at 80%.

**Actionable**: set the accent area budget explicitly (e.g. <5% of pixels) before judging a palette.

## 3. OKLCH for predictable ramps

- Build ramps by varying **L** (lightness) monotonically and reducing **C** (chroma) near white and black.
- Keep hue stable within a ramp; rotate only for semantic families.
- Dark theme: do not mechanically invert; design elevation via lightness steps and keep accent chroma lower than light theme.
- Prefer explicit colors over stacked alpha overlays when contrast must be deterministic.

## 4. Tinted neutrals (the "paper" move)

Pure gray often looks cheap. A neutral tinted 2–6% toward the brand hue (warm paper, cool slate, greenish ink) reads as intentional material. Rule: tint only if it creates cohesion across the whole surface family; keep contrast ratios verified after tinting.

## 5. Semantic role map (assign before choosing color)

1. Canvas / surface / subtle / elevated (the ground family)
2. Text primary / secondary / tertiary / muted
3. Accent: primary action, active selection, link, focus ring, one status family
4. Status: success / warning / error / info — distinct from accent
5. Data categories: distinguishable by lightness/chroma/shape, never color alone

## 6. Contrast floors (non-negotiable)

- Body text ≥ 4.5:1; large text ≥ 3:1; controls/icons/focus ≥ 3:1 (WCAG AA).
- On colored surfaces, derive secondary text from the surface hue or foreground, not generic gray.
- Verify every state, overlay, and both themes — not just the default pair.

## 7. Workflow

1. Determine product character (instrument? archive? playful?) and pick a harmony scheme.
2. Assign semantic roles; decide skeleton vs accent and the area ratio.
3. Build ramps in OKLCH; verify contrast pairs.
4. Apply to real components at real density; judge at the shipping size.
5. Record the rationale (scheme, ratio, roles) so future changes don't drift.

## 8. Anti-patterns

- Multiple unrelated accent hues competing for figure.
- Accent used for decoration (icons, borders) instead of action/selection/focus.
- Mechanically inverted dark theme.
- Choosing hex values before defining roles and area budget.
- Relying on color alone to encode state.
