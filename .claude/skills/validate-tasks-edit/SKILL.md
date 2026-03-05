---
name: validate-tasks-edit
description: Validate TASKS.md structure before saving any edit. Use before
  writing to TASKS.md to prevent structural corruption — missing sections,
  invalid task IDs, broken Depends references, or removed tasks.
user-invocable: false
allowed-tools: Read, Bash
---

# Validate Tasks Edit

Before saving any edit to TASKS.md, run:

```bash
node .claude/hooks/validate_tasks.js TASKS.md
```

If it exits non-zero, report the specific violation and do not save the edit.

Checks performed:
- Required sections present (Status legend + Phase sections with milestones)
- Status legend text unchanged
- No existing sections or tasks deleted
- Task IDs in T## format, sequential with no gaps, unique
- Statuses only from the allowed set: [ ] [~] [x] [!]
- All Depends: references resolve to real task IDs in the file
- Blocked tasks ([!]) include a note explaining the blocker
