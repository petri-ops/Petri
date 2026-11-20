# Architecture — 建筑学给界面的语法

Architecture is the art of organizing space and light for human use. Its transferable ideas to interfaces are about structure, circulation, and material honesty — never about literal building imagery.

## 1. Structure honesty (结构诚实)

A building should show how it stands. In UI: a panel's visual boundary should reflect a real containment/ownership relation. Do not use shadows to fake elevation that has no interaction meaning; do not use borders to group unrelated items.

**UI translation**: surface ladder (canvas → surface → subtle → elevated) maps to real containment depth. A card darker than its page is "a hole in the page" — a structural lie.

## 2. Frame first (框架先行)

Architects lay out the structural grid before placing furniture. In UI: define region budgets (top bar, nav, main, side panel), their container policy, and responsive behavior before designing content. Content-first layouts produce prototype-like padded columns.

**UI translation**: name each region with a landmark; fix its px budget and min/max; long content scrolls inside the region, not the whole page.

## 3. Light as material (光作为材料)

Light defines space rather than merely illuminating it. A room's character comes from where light enters and what it grazes.

**UI translation**: light and dark are two different lighting designs, not inversions.
- Light = paper under daylight: warm neutral, hairline dividers, low saturation.
- Dark = ink with localized glow: structural deep tone, accent as the only light source, never full-saturation fills.
- Elevation is expressed by gentle lightness steps + offset soft shadow; not by glow or glass.

## 4. Negative space / 空

In architecture, void is designed. The ratio of built to open space determines calm vs claustrophobia.

**UI translation**: content occupancy budget (e.g. ≤40% in identity surfaces); whitespace as the primary separator before lines or color. Every empty area is intentional or removed.

## 5. Circulation and threshold (动线与门槛)

How people move through a building; thresholds mark transitions. In UI: navigation paths, focus order, and modal/drawer transitions are circulation. A threshold should be legible: where am I, where did I come from, how do I return?

**UI translation**: focus returns to origin; Escape cancels; overlays use portal to escape clipping; breadcrumbs/headers show place.

## 6. Proportion and module (模度)

Le Corbusier's Modulor and classic proportion systems are attempts to make scale coherent. In UI: pick a base unit and derive spacing/typography/container sizes from a small ratio family. Consistency of ratio matters more than the specific numbers.

## 7. Material honesty and tactility

A material should look like what it is. In UI: avoid skeuomorphic fake textures; let "material" come from surface tone, density, and motion feedback. A control feels tactile because its state changes are immediate and physical (press, release), not because it has a leather texture.

## Anti-patterns to refuse

- Glassmorphism / heavy `backdrop-filter` as default (decorative depth, hurts legibility and performance).
- Parallax and 3D tilt in productivity tools (motion without task meaning).
- Fake shadows that don't correspond to interaction depth.
- Filling every region because "space is wasted".
