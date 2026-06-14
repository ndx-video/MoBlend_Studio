# Dot Progress (super light-weight context engineering)

Dot Progress (.progress/) is an immutable audit trail technique which acts as a light weight context engineering solution for those who don't want the token (or cognitive) overhead of a comprehensive one. The work is tied to [ROADMAP.md](../ROADMAP.md) milestones, and is recorded here — not by editing old entries, but by **appending** new files.

To use Dot Progress, simply copy this README.md file and tell your agent to implement it.

This folder is **tracked in git**. Do not add `.progress/` to `.gitignore`.

## Filename convention (strict)

```
{milestone}.{index}.{descriptor}.md
```

| Segment | Format | Example |
|---------|--------|---------|
| `milestone` | `M` + the ROADMAP milestone number **zero-padded to three digits** (`M000` = M0, `M001` = M1, … `M006` = M6; adhoc `M0NN` if ROADMAP gains new milestones) | `M000`, `M002` |
| `index` | Three-digit zero-padded sequence **per milestone**, monotonic | `001`, `002`, `013` |
| `descriptor` | Lowercase kebab-case summary of this entry | `websocket-viewport-spec` |

**Full example:** `M000.002.websocket-viewport-spec.md`

> Only the **filename** milestone token is zero-padded. Prose references to a roadmap milestone (e.g. "M0 — Specs & Scaffold", the `milestone` frontmatter field) keep the ROADMAP's short form.

### Index rules

- Each milestone has its **own** counter starting at `001`.
- Always use the **next** available index for that milestone (scan existing files in `.progress/`).
- Never reuse or renumber an index after a file is committed.
- Gaps are allowed; do not backfill.

### Descriptor rules

- Short, stable, human-readable slug.
- Describe **this** entry only (not the whole milestone).
- Regressions, reversals, and corrections get **new** descriptors (e.g. `revert-m9-milestone`, `fix-m2-ws-handshake`).

## Immutability (strict)

| Allowed | Forbidden |
|---------|-----------|
| Create a **new** file with the next index | Edit, rename, or delete an existing progress file |
| Document a regression as a **new** entry | “Fix” or overwrite a prior entry |
| Reference earlier entries by filename/link | Consolidate multiple events into one retroactive doc |

If milestone M9 is added then removed, you might have:

- `M009.001.add-m9-milestone.md`
- `M009.013.deleted-m9-milestone.md`

All prior `M009.*` files remain. Nothing is deleted.

## When to write an entry

Agents **must** create a progress document **automatically** at the end of any session that:

- Completes or partially completes roadmap work
- Changes specs, architecture, or conventions
- Makes a decision future agents should understand
- Introduces a regression or reverts direction (say so explicitly in the new doc)

Skip progress docs only for trivial typo fixes with zero design impact.

## Entry template

Copy into each new file:

```markdown
---
file: {filename}
date: YYYY-MM-DD
milestone: M{n} — {name from ROADMAP}
related_commits: {hash or uncommitted}
---

# M{n} — {short title}

## Summary

One paragraph: what happened and why.

## Changes

- Bullet list of artifacts touched

## Decisions

- Anything entailed for downstream work

## Follow-ups

- Open items, if any

## References

- Links to PRDs, prior progress entries, issues
```

## Relationship to other docs

| Document | Role |
|----------|------|
| [ROADMAP.md](../ROADMAP.md) | **What** to build, milestone gates (may be updated) |
| [specs/](../specs/) | Product requirements (evolve with new progress entries noting spec changes) |
| `.progress/` | **Historical record** of what was done, when, and why (append-only) |

ROADMAP “done when” checklists describe targets; `.progress/` records evidence and narrative as work lands.

## Finding the next index

Before creating a file, list existing entries for the milestone:

```bash
ls .progress/M000.*.md
```

Use max(index) + 1. If none exist, start at `001`.
