---
name: analyze-refactoring
description: Analyze the most recent git commit for refactoring opportunities.
  Invoked automatically after every commit. Examines the diff for mixed
  responsibilities, duplication, unclear naming, unnecessary length, or low
  testability. Returns actionable refactoring tasks or confirms none needed.
context: fork
agent: Explore
user-invocable: false
---

Analyze the most recent commit for refactoring opportunities.

1. Run `git diff HEAD~1 HEAD --name-only` to get changed files
2. Run `git diff HEAD~1 HEAD` to read the full diff
3. Read the current version of each changed file

Analyze for:
- **Mixed responsibilities**: Any function or component doing more than one thing?
- **Duplication**: Same logic appearing 2+ times? (2x = candidate; 3x = mandatory)
- **Unnecessary length**: Anything longer than it needs to be?
- **Unclear naming**: Names that could be clearer?
- **Low testability**: Structure that makes testing harder than necessary?

Output — choose exactly one format:

If improvements found:
  List each as: `refactor(<scope>): <description>` — file: <path>, lines: <range>

If none found:
  `Refactoring analysis: no actions identified`

Read only. Do not modify files.
