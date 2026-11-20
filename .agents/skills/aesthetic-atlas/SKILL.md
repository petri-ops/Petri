---
name: aesthetic-atlas
description: Comprehensive cross-disciplinary aesthetics atlas for making design decisions with the literacy of architecture, film, painting, art history, music, sculpture, photography, and typography. This skill should be used when designing or critiquing visual interfaces, choosing color harmony, form language, icon angle, composition, rhythm, or visual identity — especially when the work needs to rise above generic SaaS look and carry a distinctive product identity. Translates art-discipline knowledge into concrete, checkable UI rules rather than decorative pastiche.
---

# Aesthetic Atlas — 全艺术门类审美图谱

## Purpose

Provide the **cross-disciplinary literacy** behind visual decisions. A UI that only follows tokens is correct but generic. This skill supplies the art-historical and perceptual reasoning that turns "looks ordinary" into "has a point of view" — then translates it into concrete, verifiable design rules.

**Core stance**: Art disciplines are a **grammar for judgment**, not a sticker library. Borrow principles (structure, harmony, attention, rhythm, negative space); never paste period ornaments, brand marks, or genre clichés. Every borrowed idea must answer: *what does this buy the user's task and the product's identity?*

## When to use

- Choosing or defending a product's visual world: color scheme, form language, icon style, composition, motion character.
- A review says "lacks quality / looks amateur / too generic / feels fragmented".
- Building a design system that must carry a distinct cultural or product identity.
- Translating an existing brand identity (logo, palette) into an interface.
- **Skip** for pure backend, algorithms, or non-visual work.

## How to use

1. **Read the discipline map** in `references/00-map.md` to select which art disciplines are relevant to the request. Do not load every reference by default.
2. **Ground in perception**: read `references/01-foundations.md` for the shared grammar (Gestalt, balance, hierarchy, rhythm, contrast, unity) that all disciplines rest on.
3. **Pull only the needed discipline references**:
   - Color harmony → `references/02-color-harmony.md`
   - Architecture / space → `references/03-architecture.md`
   - Film / cinematography → `references/04-film.md`
   - Painting / Eastern theory → `references/05-painting.md`
   - Art history movements → `references/06-art-history.md`
   - Other arts (music, sculpture, dance, literature, photography, typography, industrial design) → `references/07-other-arts.md`
4. **Translate, don't decorate**: apply `references/08-ui-translation.md` to convert each principle into token/component/layout/motion decisions with a checkable criterion.
5. **Identity test**: run `references/09-identity-test.md` — five questions that separate a product's own visual world from a borrowed skin.
6. **Verify**: any aesthetic decision must end with a rendered, element-level check (screenshot + per-criterion pass/fail). Static values alone never prove visual quality.

## Hard rules

1. Never copy a brand's marks, copy, illustrations, or whole-page layout. Borrow principles only.
2. Never introduce decoration whose only job is "looking artistic" — no film grain, glass blur, neon glow, gradient text, or ornament unless the product's committed world explicitly calls for it and it passes the identity test.
3. Color harmony is a **relationship**, not a palette dump: define the skeleton color, the accent color, their ratio, and the semantic role of each before choosing hex values.
4. Every aesthetic claim gets a checkable criterion (ratio, count, contrast, angle, stroke weight, occupancy, or per-criterion human-eye judgment).
5. Respect the host project's canonical design system: this skill informs decisions; it never overrides an established token contract, accessibility floor, or governance ruling.
6. Distinguish "restraint is a choice" from "cheap and unfinished" — a minimal surface still needs deliberate rhythm, browser-surface theming, and complete states.
7. When working on Petri Desktop, read its `docs/design-charter.md`, `petri-css-theme` skill, and existing brand assets under `petri-logo-concepts_assets/` before proposing any identity-level change; identity changes are user-ruling items.

## Resources

- `references/00-map.md` — discipline-to-problem routing table.
- `references/01-foundations.md` — shared perceptual grammar (Gestalt, balance, hierarchy, rhythm, contrast, unity).
- `references/02-color-harmony.md` — harmony schemes, Itten contrasts, OKLCH, neutral tinting, semantic roles.
- `references/03-architecture.md` — space, structure honesty, light as material, proportion, circulation.
- `references/04-film.md` — shot hierarchy, color script, focus, continuity, lighting, framing.
- `references/05-painting.md` — Western composition and Chinese six principles (谢赫六法), 留白/计白当黑.
- `references/06-art-history.md` — movements and what to take / refuse from each.
- `references/07-other-arts.md` — music, sculpture, dance, literature, photography, typography, industrial design.
- `references/08-ui-translation.md` — translate principles into UI tokens, components, layout, motion + checkable criteria.
- `references/09-identity-test.md` — five-question test for a product's own visual world.
- `scripts/audit_harmony.py` — optional local helper to compute contrast and harmony relations for a candidate palette (no network, no dependencies).
