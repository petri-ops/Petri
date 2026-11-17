# Module State Matrix

Every interactive module must account for all eight states. An empty cell is a defect unless it is explicitly marked `cancelled` with a reason.

## Eight states

| State | Meaning | Required evidence |
| --- | --- | --- |
| `default` | Normal visible state | DOM text / aria-label / token class |
| `hover` | Pointer affordance | single hover token, no layout jump |
| `active` | Pressed or selected | aria-pressed / data-state / active token |
| `disabled` | Not available | real `disabled`, reason surfaced, not tabbable |
| `loading` | Async work in flight | visible progress + `aria-busy` |
| `empty` | No content | explanatory empty text + next action |
| `error` | Failure | `role=status` or `role=alert`, cause visible |
| `focus-visible` | Keyboard focus | visible ring, never bare `outline:none` |

## Per-module checklist

- Identify every interactive element: button, icon button, input, list item/card, navigation item/tab.
- For each element × state, state the concrete behavior.
- Define focus order and focus return after dialogs, menus, and async updates.
- Define long-content handling: complete / in-container scroll / narrow viewport.
- Define geometry assertions: no overlap, same-row alignment, no parent overflow, ancestor right edge within visible column.
- Define whether the state is mechanical or human-eye evidence.

## Petri-specific rules

- Menu and popover surfaces must not close while the pointer is crossing from anchor to panel; use a short delayed close and cancel-on-enter.
- Panels anchored to rows use the row's live rectangle; clamp only by the panel's measured height.
- Disabled reasoning/thinking controls must show the honest reason ("model did not declare reasoning"), not silently disappear.
- Loading/success/failure for prompt enhancement stays in the composer; failure must not overwrite the draft.
