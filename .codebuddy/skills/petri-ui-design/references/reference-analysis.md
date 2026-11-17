# Reference Analysis

Use this method when the user supplies screenshots, sites, or tools from design articles.

## Step 1: Separate observation from borrowing

For each reference, write two columns:

- **Observed**: what the reference actually does (layout, hierarchy, density, color role, motion, state).
- **Borrowable**: the principle that can be applied to Petri without copying its surface.

Never write "make it look like this site" as the requirement.

## Step 2: Extract design atoms only

Allowed to extract:

- information hierarchy;
- spacing rhythm and alignment;
- how primary/secondary actions differ;
- empty/loading/error states;
- state transition timing and feedback;
- accessibility affordances.

Not allowed:

- logos, brand marks, product names, copy, illustrations;
- whole-page layouts or exact component skins;
- hardcoded colors/fonts that bypass Petri tokens;
- external component code before license review.

## Step 3: Map to Petri tokens

Every extracted atom must be rewritten in Petri language:

- color → `--petri-*` semantic role;
- font size → charter scale;
- border → input / card / divider semantics;
- motion → `--petri-duration-*` / `--petri-ease-*`;
- component → existing control single-source, or explicit new component proposal.

## Step 4: Record provenance

Store source URL or filename, author/site when available, and license/terms. If the source is unknown, mark `license_unknown` and do not import code.

## Step 5: Decide product vs internal

- Internal reference: used only to improve Petri's own UI; no runtime dependency.
- Product reference: used by Petri to generate a user-facing design brief; still no copying, still cite source.
