---
name: write-progress-entry
description: Append a new immutable progress log entry under .progress/. Use at the end of any non-trivial implementation session, spec change, or architectural decision.
paths:
  - ".progress/**"
  - "engine/**"
  - "desktop/**"
  - "clients/**"
  - "specs/**"
disable-model-invocation: true
---

# Write progress entry

Follow [.progress/AGENTS.md](../../../.progress/AGENTS.md) and [.progress/README.md](../../../.progress/README.md).

## Checklist

1. **Determine milestone** from [ROADMAP.md](../../../ROADMAP.md) for the work completed.
2. **Find next index:** list `.progress/M{NNN}.*.md` for that milestone; use max(index) + 1, or `001` if none exist.
3. **Choose descriptor:** lowercase kebab-case describing this entry only.
4. **Create file:** `.progress/M{NNN}.{index}.{descriptor}.md` — never edit existing files.
5. **Apply template** from `.progress/README.md` (frontmatter + Summary, Changes, Decisions, Follow-ups, References).
6. **Link** related PRDs, prior progress entries, and commits.

## Immutability

- Regressions and reversals get **new** files — never revise prior entries.
- Gaps in numbering are allowed; renumbering is forbidden.