# Petri Design Brief Template

Use this template for user-facing design tasks. Keep every section; write `n/a` with a reason when a section does not apply.

```markdown
# Design Brief — <module or product>

## 1. Goal and non-goals

- User goal:
- Product constraint:
- Non-goals:

## 2. Canonical anchors

- UI issue / module:
- Design charter rules:
- Token contract:
- Existing component single-source:

## 3. Information hierarchy

1. Primary action:
2. Secondary actions:
3. Supporting information:
4. Deferred / advanced information:

## 4. Module state matrix

| Element | default | hover | active | disabled | loading | empty | error | focus-visible |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## 5. Layout and responsive contract

- Container boundaries:
- Narrow behavior:
- Long-content behavior (complete / in-container scroll / narrow viewport):
- z-index and portal policy:

## 6. Token and component mapping

- Colors: only `--petri-*`; note semantic role.
- Font scale: only charter-defined levels.
- Border: `input` / `card` / `divider` semantics.
- Motion: only `--petri-duration-*` and `--petri-ease-*`.
- Components: reuse existing controls; any new component needs a single source.

## 7. Interaction and keyboard

- Pointer flow:
- Keyboard flow:
- Focus return:
- Escape / cancel:
- Async feedback:

## 8. Anti-patterns and exclusions

- What must not be copied:
- What must not be changed:
- U-rulings needed:

## 9. External references and licenses

| Reference | What is borrowed | Source | License | Do-not-copy |
| --- | --- | --- | --- | --- |

## 10. Verification plan

- Static:
- Mechanical:
- Targeted tests:
- dev-verify / live:
- Human-eye item (never agent-signed):
```

## Completion rule

A design brief is complete only when every section is filled, every U-ruling is explicit, and the verification plan distinguishes static evidence from human-eye evidence.
