# Tool Adoption Matrix

Source article: 《让 AI 做出好看又专业的 UI》(Aoi523, 2026-11-13).

| Tool | Borrow | Do not borrow | Petri stance |
| --- | --- | --- | --- |
| Pinterest | Reference-board method; module-level search terms | Brand imitation; mood without acceptance criteria | Internal reference process only |
| Refero Styles | Convert style into a structured `DESIGN.md` | Blindly use generated styles over design charter | Highest-value method; feed design brief |
| CTA Gallery | Primary/secondary action hierarchy | Marketing-page patterns in desktop agent UI | Limited, internal review only |
| Footer Design | Information grouping for footers | Whole-page layout | Mostly not applicable |
| React Bits | Feedback-only motion patterns | Decorative animation; component copies without license | Token-bound motion reference; MIT + Commons Clause |
| assistant-ui | Streaming messages, tool confirmation, attachments, structured data | Whole chat framework replacement | Pattern reference only; MIT; do not replace `SimpleChat` |
| 21st.dev | Component/module ideas | Direct code/style copies; dependency growth | Inspiration only; per-component license review |

## Default decision

Zero new dependencies. Any adoption beyond reference material requires the dependency-change checklist, a user ruling when behavior/defaults change, and a targeted acceptance gate.
