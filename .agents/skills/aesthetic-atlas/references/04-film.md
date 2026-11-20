# Film — 影视给界面的语法

Film is the art of directing attention through time. Its transferable ideas: shot hierarchy, continuity, focus, and color script.

## 1. Shot hierarchy (镜头层级)

- **Establishing shot** → overview: page hero, dashboard top.
- **Medium shot** → relationships: sections, groups, cards.
- **Close-up** → the one critical detail: primary number, active item, accent mark.

One screen should have one "close-up". If everything is a close-up, attention is diffused. This is the filmic version of a single primary action and a single accent point.

## 2. Color script (色彩剧本)

Films plan a palette arc across scenes, not per shot. In product terms: a family of related palettes used by **semantic context**, not by user whim. Work state / evidence state / identity state / data state can share one harmonic skeleton with different accent roles — like scenes in one film.

**Rule**: switching theme must feel like the same film in a different scene, not a different product.

## 3. Focus as attention (焦点即注意力)

Rack focus tells the viewer where to look. In UI: use focus-ring, selected state, and one accent point to direct attention. Do not animate the entire page; do not scatter micro-animations. One authored motion moment per product is enough when it carries meaning (e.g. a seal-stamp confirmation).

## 4. Continuity editing (剪辑连续性)

The 180° rule and match cuts maintain spatial orientation. In UI: overlays, drawers, and navigation must explain where things came from; focus returns to origin; Escape cancels; no teleporting elements. A jump cut in interface = a state change with no visual cause.

## 5. Lighting and mood (光与气氛)

Film lighting sets mood: hard light = tension, soft light = calm, backlight = mystery. In UI, mood comes from contrast and surface temperature. A tool surface should be legibly lit (soft, even); moments of emphasis can be harder (single saturated accent on quiet ground).

## 6. Framing and safe area (构图与安全区)

Composition respects the frame edges; titles/actions stay within safe areas. In UI: respect containers, keep controls within visible column bounds, avoid edge-bleed on text, verify narrow viewports. The "invisible frame" is the content column, not the screen.

## 7. Timing (节奏)

Edit rhythm = pacing of information. Streaming output, step transitions, and skeleton timing are all pacing. Too fast feels jittery; too slow feels broken. Reuse established duration tokens; let content arrive in meaningful chunks.

## Anti-patterns to refuse

- Film grain, light leaks, VHS glitch as "cinematic" decoration.
- Cinematic wipes/transitions in a productivity tool.
- Multiple simultaneous animated elements competing for focus.
- Dramatic letterboxing that hides content.
