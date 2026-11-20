# Shared Perceptual Foundations — 所有艺术门类的共同语法

These principles are cross-disciplinary: they appear in painting, architecture, film, photography, and interface design. Treat them as the floor before any style-specific choice.

## 1. Gestalt perception (how the eye groups)

- **Proximity** — near elements read as a group. In UI: spacing is the primary grouping tool; use it before dividers.
- **Similarity** — alike elements read as related. One icon stroke weight, one corner radius family, one accent meaning.
- **Closure** — the eye completes incomplete forms. An open ring still reads as a ring; a gap can signal "in progress / not closed" (identity-bearing in Petri's mark).
- **Continuity** — the eye follows lines and paths. Alignment and shared baselines create flow; broken alignment reads as error.
- **Figure/ground** — contrast determines what is subject vs background. Decide deliberately: accent = figure, neutral = ground; never let decoration compete for figure.
- **Prägnanz** — the eye prefers simple, orderly forms. Complexity must earn its place.

**Checkable**: a viewer can name the figure within 2 seconds; grouping is achieved by spacing/similarity, not by adding borders; elements on a shared axis align within 1px.

## 2. Balance (visual weight)

- **Symmetrical** — formal, stable, ceremonial. Use for identity surfaces, never for dense tools (too rigid).
- **Asymmetrical** — dynamic, modernist; balance large-quiet against small-loud. Default for professional tools.
- **Radial** — focus to center; use sparingly (loading, empty states).

Visual weight = size × contrast × color intensity × isolation. A single accent dot can balance a large neutral block.

## 3. Hierarchy (order of reading)

Three reliable channels, use at least two together: **scale**, **contrast**, **position**. Color alone is not hierarchy (accessibility + color-blindness). Define, per screen: primary (one), secondary (2–3), supporting, deferred. If everything is emphasized, nothing is.

## 4. Rhythm and repetition

Repetition with variation creates rhythm — in architecture (columns), music (meter), film (cut cadence), typography (baseline grid). In UI: consistent row heights and gaps; break rhythm only to mark a state change. Repetition without variation is monotonous; variation without repetition is noise.

## 5. Contrast and variety

- Contrast is difference: light/dark, large/small, warm/cool, dense/sparse, smooth/rough (material metaphor).
- Variety prevents monotony but must stay inside a uniting idea (see unity). In a design system, variety comes from state and content, not from per-component styling.

## 6. Unity / harmony (the governing principle)

All other principles serve unity: every element should look like it belongs to one world. Test: remove the logo — is the screen still recognizably this product? If not, identity is being carried by decoration, not by structure.

## 7. Proportion and scale

- Classical systems (golden ratio, Modulor) are tools, not laws. What matters is a **consistent ratio family** across typography, spacing, and containers.
- Human scale reference: body text and touch targets anchor the system; everything else scales from them.

## 8. Economy / "less is more" — with a caveat

Reduction is a decision, not an absence. A minimal surface still requires: deliberate spacing rhythm, tuned typography, themed browser surfaces, complete interaction states. Otherwise "minimal" is just unfinished.

## Delivery check

For any visual decision: name which of these principles it uses, and which checkable signal proves it (ratio, count, alignment, contrast measurement, or per-criterion screenshot review).
