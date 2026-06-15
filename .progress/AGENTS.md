# Progress log — Dot Progress

Append-only audit trail tied to [ROADMAP.md](../ROADMAP.md) milestones. Full template and examples: [README.md](README.md).

## When to write

Create a new entry at the end of any session that:

- Completes or partially completes roadmap work
- Changes specs, architecture, or conventions
- Makes a decision future agents should understand
- Introduces a regression or reverts direction

Skip only for trivial typo fixes with zero design impact.

## Strict rules

1. **Append only.** Never edit, rename, or delete an existing progress file.
2. **Filename:** `{milestone}.{index}.{descriptor}.md` — e.g. `M003.015.agent-directives-refactor.md`. Milestone: `M` + zero-padded ROADMAP number; index: three-digit per milestone; descriptor: kebab-case.
3. **Regressions** get new entries — do not revise prior files.
4. **Immutability:** gaps in numbering are fine; renumbering is forbidden.

## Procedure

Use `/write-progress-entry` for the full checklist (find next index, apply template, link PRDs and prior entries).