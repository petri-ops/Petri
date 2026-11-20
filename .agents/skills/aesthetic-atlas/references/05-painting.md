# Painting — 绘画给界面的语法（含东方六法）

## 1. Western painting: composition and weight

- **Figure/ground** decides subject; **balance** (symmetrical/asymmetrical) decides stability.
- **Golden ratio / rule of thirds** are heuristics for off-center emphasis; use as tendency, not law.
- **Color temperature** (warm advances, cool recedes) can build depth without shadows.
- **Brushwork** carries energy; in UI the analogue is stroke consistency and deliberate marks (one accent mark per view).
- **Layers / impasto** → in UI, surface elevation must be subtle and meaningful, not decorative thickness.

## 2. Xie He's Six Principles (谢赫六法, 古画品录, Southern Qi)

Authoritative original order (verified via 新华网 / 文汇报 / 广元市政府 cultural references):

1. **气韵生动** — spirit/vitality: the work breathes; the highest principle. UI analogue: an interface that feels alive through responsive states and appropriate rhythm, not an over-animated one.
2. **骨法用笔** — structural stroke: lines have bone, tension, elasticity. UI analogue: icons drawn with consistent 1.5px linear stroke, flat caps, geometric arcs; "笔断意连" — an open ring still reads complete.
3. **应物象形** — form follows the object's nature. UI analogue: controls look like what they do; a status indicator is not mistaken for a button; semantic shapes match semantic roles.
4. **随类赋彩** — color follows category. UI analogue: color encodes semantic class (accent/action, status, data), not decoration. Each class has one color rule.
5. **经营位置** — composition/placement is deliberate arrangement. UI analogue: frame-first layout, one focal point, content occupancy budget.
6. **传移模写** — transmission/copying as learning. UI analogue: reuse proven components and patterns; a design system is institutionalized 传移; never invent a new button vocabulary per screen.

## 3. 留白 / 计白当黑 (counting white as black)

In Chinese painting, empty space is a compositional element, not leftover. The unwritten is as meaningful as the written.

**UI translation**: whitespace occupancy ≥ a defined budget (e.g. 40–60%); grouped elements tight, groups separated generously; more space above a heading than below. A surface is not "unfinished" because it is sparse — it is unfinished only if rhythm, states, and typography are not tuned.

## 4. 墨分五色 (ink in five tones)

Depth in ink painting comes from tonal gradation of one material, not many pigments.

**UI translation**: build depth within the neutral family (4 text levels, 4 surface levels) before adding accent. If a surface needs color to be legible, the neutral ramp is under-designed.

## 5. 宾主分明 (guest/host distinction)

A painting has a host (subject) and guests (supporting). Equal emphasis is a failure.

**UI translation**: one primary action, one accent point, one focal number per view. Everything else is guest.

## Anti-patterns to refuse

- Literal ink-wash textures, brush strokes, calligraphy fonts pasted on UI.
- "Zen" empty pages that hide functionality or lack states.
- Using 留白 as an excuse for missing content.
