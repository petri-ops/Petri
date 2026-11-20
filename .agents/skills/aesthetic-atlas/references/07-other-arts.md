# Other Arts — 其余艺术门类的可迁移原则

## Music

- **Rhythm / meter** → UI timing: consistent intervals, one accent beat. Repeating durations with a single authored emphasis.
- **Theme and variation** → design system: one component vocabulary, state/content variations. Variation without theme = noise.
- **Counterpoint** → multiple information streams (streaming output + status + timeline) must be independently legible yet harmonize; avoid simultaneous emphasis.
- **Rest (休止)** → silence is structural. Pauses in streaming/step transitions let information land; not every gap needs a spinner.

## Sculpture

- **Mass and void** → solid components and negative space are equally designed.
- **Viewpoint** → an interface has a primary reading angle (screen front-on); avoid faux 3D angles that imply a viewpoint the user doesn't have. Icons: front-on geometric, zero perspective, consistent stroke.
- **Material truth** → surfaces look like what they are; no fake skeuomorphic leather/wood.

## Dance / theatre

- **Blocking and staging** → where elements appear and move on the "stage" (viewport); one focal performer per scene.
- **Entrance/exit** → overlays enter and leave with clear cause; focus returns. Motion conveys state change, never decoration.
- **Timing and presence** → loading/empty/error states are "presence" of the system; they must speak truthfully (real reasons, recovery).

## Literature

- **Narrative voice** → product copy has one voice; noun-phrase titles, verb-phrase buttons; no marketing tone.
- **Editing** → cut redundant words; "文字少" is an aesthetic and usability choice.
- **Show, don't tell** → state through visual feedback and concrete evidence, not verbose labels.

## Photography

- **Framing / composition** → rule of thirds, leading lines, depth of field as attention tools; in UI, crop avatars/thumbnails consistently, keep text in safe area.
- **Exposure** → highlight and shadow tone; dark theme isn't inverted — it's a different exposure of the same world.
- **Series consistency** → a photo series shares a grade; a product's screens share a palette script.

## Typography (graphic design)

- **One family often right** for product UI; fixed scale (1.125–1.2 ratio); semantic weights; tabular numerals for data.
- **Measure 45–75ch** for prose; tighter for dense UI; line-height tuned inversely to measure.
- **Hierarchy from scale + weight + space**, not color alone.
- **Text-wrap balance/pretty** as progressive enhancement; avoid widows/orphans in headings.
- **Localization** → leave room for expansion; don't hard-break labels.

## Industrial design / product design

- **Affordance** → controls invite their action; a button is pressed, a switch is toggled.
- **Consistency of vocabulary** → same control looks the same everywhere; one component source.
- **Tolerance and feedback** → physics-like response (press/release, snap) within 150–250ms; reduced-motion respected.
- **Ergonomics** → touch targets, keyboard reach, visible focus; function before flourish.

## Cross-arts synthesis

All disciplines agree on: **hierarchy, rhythm, balance, contrast, unity, economy, and deliberate negative space**. They differ only in medium. Use the discipline whose metaphor best explains the current problem, then translate back into concrete tokens/components/states.
