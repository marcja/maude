---
name: run-pre-commit-check
description: Run the full pre-commit quality gate before committing. Invoke
  manually before any git commit to catch failures before the OS hook blocks
  the commit.
disable-model-invocation: true
allowed-tools: Bash
---

# Run Pre-Commit Check

Run in sequence. Stop on the first failure and report the exact error output.

1. `pnpm type-check` — zero TypeScript errors
2. `pnpm lint` — zero Biome errors or warnings
3. `pnpm test` — all tests pass
4. `pnpm test:coverage` — coverage has not decreased

Only proceed to `git commit` when all four exit 0.
Fix all failures before retrying. Do not suppress errors.
