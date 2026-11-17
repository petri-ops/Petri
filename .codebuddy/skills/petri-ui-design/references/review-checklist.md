# Pre-delivery Review Checklist

Run before declaring any Petri UI or design artifact complete.

## Design truth

- [ ] Canonical module and UI issue identified.
- [ ] Design charter and acceptance checklist consulted.
- [ ] No second source of truth created.
- [ ] All U-rulings listed explicitly.

## State completeness

- [ ] Eight states covered or explicitly cancelled with reason.
- [ ] Focus order and focus return defined.
- [ ] Empty, loading, and error states visible and honest.
- [ ] Long-content three states handled.

## Token and component discipline

- [ ] All colors use `--petri-*` tokens.
- [ ] Font sizes use charter scale; small-font ratchet not widened.
- [ ] Borders use input/card/divider semantics.
- [ ] Motion uses charter duration/ease tokens and carries feedback.
- [ ] Existing controls reused; new component single-source declared.

## Geometry and interaction

- [ ] Geometry four checks measured (`no overlap`, `same row`, `within parent`, `ancestor within column`).
- [ ] Anchor/panel interaction survives pointer transfer.
- [ ] Narrow viewport and long content checked.
- [ ] No hardcoded container geometry without a layout reason.

## Evidence and honesty

- [ ] Static, mechanical, and human-eye evidence separated.
- [ ] Targeted tests and dev-verify flows run where applicable.
- [ ] Screenshots unavailable are recorded as unavailable, not passed.
- [ ] Aesthetic judgement marked `pending_human_eye`.
- [ ] External references and licenses recorded; nothing copied from brands.

## Product capability mode

- [ ] Output is a design brief, not an unverified claim of implementation.
- [ ] Any prototype uses existing Gen UI rules and sandbox restrictions.
- [ ] No new dependency without user ruling and dependency checklist.
